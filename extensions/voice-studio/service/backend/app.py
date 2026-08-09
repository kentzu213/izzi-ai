"""
Izzi Voice TTS - a bounded FastAPI wrapper around VieNeu-TTS.
Runs fully local; no cloud, no secrets, and no reference-audio input.

API (consumed by the voice-studio .ocx over loopback):
  GET  /health        - liveness (process up)
  GET  /health/live   - liveness alias
  GET  /health/ready  - readiness (200 only once the model is loaded, else 503)
  GET  /voices        - built-in default voices
  POST /tts           - { text, voice } -> { ok, format, audio_b64 }
"""
import base64
import os
import re
import tempfile
import threading
import time

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, StrictStr

from audio_validation import MAX_AUDIO_BYTES, valid_wav
from model_runtime import (
    CODEC_REPO,
    CODEC_REVISION,
    MODEL_REPO,
    MODEL_REVISION,
    PINNED_SDK_VERSION,
    PRESET_CATALOG_SHA256,
    installed_sdk_version,
    load_pinned_engine,
)

app = FastAPI(title="Izzi Voice TTS (VieNeu-TTS)")

MAX_TEXT_LENGTH = 500
# Keep retrying through the host's ten-minute readiness window. Model downloads
# can fail transiently after the process has already started.
MODEL_LOAD_RETRY_DELAYS = (0, 5, 20, 40) + (60,) * 8
VOICE_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")

_tts = None
_ready = False
_load_error: str | None = None
_load_attempts = 0
_load_lock = threading.Lock()
_infer_lock = threading.BoundedSemaphore(1)

# Stable public ids mapped to audited VieNeu 3.2.3 preset names.
VOICE_PRESETS = {
    "pham-tuyen": "Phạm Tuyên",
    "truc-ly": "Trúc Ly",
    "xuan-vinh": "Xuân Vĩnh",
    "thuy-dung": "Thùy Dung",
}
DEFAULT_VOICES = list(VOICE_PRESETS)


def _validate_preset_contract(engine) -> None:
    list_presets = getattr(engine, "list_preset_voices", None)
    if not callable(list_presets):
        raise RuntimeError("preset_voice_contract_mismatch")
    available = {voice_id for _label, voice_id in list_presets()}
    if not set(VOICE_PRESETS.values()).issubset(available):
        raise RuntimeError("preset_voice_contract_mismatch")


def _load():
    """Load the pinned model once. A later call may retry a failed attempt."""
    global _tts, _ready, _load_error, _load_attempts
    if _tts is not None:
        return _tts
    with _load_lock:
        if _tts is not None:
            return _tts
        _load_attempts += 1
        try:
            engine = load_pinned_engine()
            _validate_preset_contract(engine)
            _tts = engine
            _ready = True
            _load_error = None
        except Exception as exc:  # noqa: BLE001
            _tts = None
            _ready = False
            _load_error = "model_load_failed"
            print(f"[voice-tts] model load failed: {type(exc).__name__}", flush=True)
    return _tts


def _warm_model() -> None:
    for delay_seconds in MODEL_LOAD_RETRY_DELAYS:
        if delay_seconds:
            time.sleep(delay_seconds)
        if _load() is not None:
            return


@app.on_event("startup")
def _startup() -> None:
    # Warm the model in the background so liveness stays responsive during the
    # first immutable model download.
    threading.Thread(target=_warm_model, daemon=True).start()


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/health/live")
def live():
    return {"status": "ok"}


def _sdk_version() -> str | None:
    try:
        return installed_sdk_version()
    except Exception:  # noqa: BLE001
        return None


@app.get("/health/ready")
def ready():
    if _ready and _tts is not None:
        return {
            "status": "ready",
            "sdk": "vieneu",
            "sdk_version": _sdk_version(),
            "model_repo": MODEL_REPO,
            "model_revision": MODEL_REVISION,
            "codec_repo": CODEC_REPO,
            "codec_revision": CODEC_REVISION,
            "preset_catalog_sha256": PRESET_CATALOG_SHA256,
        }
    return JSONResponse(
        {
            "status": "loading",
            "error": _load_error,
            "load_attempts": _load_attempts,
            "required_sdk_version": PINNED_SDK_VERSION,
        },
        status_code=503,
    )


@app.get("/voices")
def voices():
    return {"voices": DEFAULT_VOICES}


class TTSRequest(BaseModel):
    text: StrictStr
    voice: StrictStr

    model_config = ConfigDict(extra="forbid")


def _valid_text(value: str) -> bool:
    return (
        0 < len(value) <= MAX_TEXT_LENGTH
        and value.strip() == value
        and not any((ord(char) < 32 and char not in "\t\n\r") or ord(char) == 127 for char in value)
    )


@app.post("/tts")
def tts(req: TTSRequest):
    if not _valid_text(req.text) or not VOICE_PATTERN.fullmatch(req.voice):
        return JSONResponse({"ok": False, "error": "invalid_request"}, status_code=400)
    preset_voice = VOICE_PRESETS.get(req.voice)
    if preset_voice is None:
        return JSONResponse({"ok": False, "error": "unknown_voice"}, status_code=400)
    if not _infer_lock.acquire(blocking=False):
        return JSONResponse({"ok": False, "error": "busy"}, status_code=429)

    out_path = None
    try:
        engine = _load()
        if engine is None:
            return JSONResponse({"ok": False, "error": "model_not_ready"}, status_code=503)
        # Fail closed if the pinned SDK no longer accepts the audited preset.
        audio = engine.infer(
            text=req.text,
            voice=preset_voice,
            apply_watermark=False,
        )

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
            out_path = handle.name
        engine.save(audio, out_path)
        with open(out_path, "rb") as file:
            data = file.read(MAX_AUDIO_BYTES + 1)
        if not valid_wav(data):
            return JSONResponse({"ok": False, "error": "invalid_audio_output"}, status_code=502)
        return {"ok": True, "format": "wav", "audio_b64": base64.b64encode(data).decode("ascii")}
    except Exception as exc:  # noqa: BLE001
        print(f"[voice-tts] inference failed: {type(exc).__name__}", flush=True)
        return JSONResponse({"ok": False, "error": "tts_failed"}, status_code=500)
    finally:
        if out_path and os.path.exists(out_path):
            try:
                os.remove(out_path)
            except OSError:
                pass
        _infer_lock.release()
