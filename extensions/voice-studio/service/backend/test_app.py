import base64
import struct
import unittest
from unittest.mock import patch

from pydantic import ValidationError

import app


def wav_bytes(samples: bytes = b"\x00\x00") -> bytes:
    fmt = struct.pack("<HHIIHH", 1, 1, 48_000, 96_000, 2, 16)
    data_chunk = b"data" + struct.pack("<I", len(samples)) + samples
    if len(samples) % 2:
        data_chunk += b"\x00"
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + data_chunk
    return b"RIFF" + struct.pack("<I", len(body)) + body


class FakeEngine:
    def __init__(self, output: bytes | None = None, preset_names=None):
        self.output = output or wav_bytes()
        self.calls = []
        self.apply_watermark = None
        self.preset_names = preset_names or list(app.VOICE_PRESETS.values())

    def list_preset_voices(self):
        return [(name, name) for name in self.preset_names]

    def infer(self, **kwargs):
        self.apply_watermark = kwargs.pop('apply_watermark', None)
        self.calls.append(kwargs)
        return object()

    def save(self, _audio, destination):
        with open(destination, "wb") as handle:
            handle.write(self.output)


class VoiceApiTests(unittest.TestCase):
    def setUp(self):
        self.original_tts = app._tts
        self.original_ready = app._ready
        self.original_error = app._load_error
        self.original_attempts = app._load_attempts

    def tearDown(self):
        app._tts = self.original_tts
        app._ready = self.original_ready
        app._load_error = self.original_error
        app._load_attempts = self.original_attempts

    def test_request_forbids_reference_audio_and_unknown_fields(self):
        with self.assertRaises(ValidationError):
            app.TTSRequest(
                text="Xin chao",
                voice="truc-ly",
                ref_audio_b64="forbidden",
            )

    def test_text_and_voice_validation_fail_closed(self):
        self.assertFalse(app._valid_text(""))
        self.assertFalse(app._valid_text(" leading"))
        self.assertFalse(app._valid_text("a" * (app.MAX_TEXT_LENGTH + 1)))
        self.assertFalse(app._valid_text("bad\x00text"))
        response = app.tts(app.TTSRequest(text="Xin chao", voice="female-north"))
        self.assertEqual(response.status_code, 400)

    def test_preset_contract_requires_all_audited_upstream_names(self):
        app._validate_preset_contract(FakeEngine())
        with self.assertRaisesRegex(RuntimeError, "preset_voice_contract_mismatch"):
            app._validate_preset_contract(FakeEngine(preset_names=["Phạm Tuyên"]))

    def test_ready_reports_the_full_pinned_runtime_provenance(self):
        app._tts = object()
        app._ready = True
        with patch("app._sdk_version", return_value="3.2.3"):
            self.assertEqual(
                app.ready(),
                {
                    "status": "ready",
                    "sdk": "vieneu",
                    "sdk_version": "3.2.3",
                    "model_repo": app.MODEL_REPO,
                    "model_revision": app.MODEL_REVISION,
                    "codec_repo": app.CODEC_REPO,
                    "codec_revision": app.CODEC_REVISION,
                    "preset_catalog_sha256": app.PRESET_CATALOG_SHA256,
                },
            )

    def test_load_uses_the_pinned_engine_loader(self):
        app._tts = None
        app._ready = False
        engine = FakeEngine()
        with patch("app.load_pinned_engine", return_value=engine) as loader:
            self.assertIs(app._load(), engine)
        loader.assert_called_once_with()
        self.assertTrue(app._ready)

    def test_tts_uses_the_approved_voice_and_returns_bounded_wav(self):
        engine = FakeEngine()
        app._tts = engine
        app._ready = True
        result = app.tts(app.TTSRequest(text="Xin chao", voice="truc-ly"))
        self.assertTrue(result["ok"])
        self.assertEqual(result["format"], "wav")
        self.assertEqual(base64.b64decode(result["audio_b64"]), wav_bytes())
        self.assertEqual(engine.calls, [{"text": "Xin chao", "voice": "Trúc Ly"}])

        self.assertIs(engine.apply_watermark, False)

    def test_tts_rejects_invalid_audio_output(self):
        app._tts = FakeEngine(b"not-a-wav")
        app._ready = True
        response = app.tts(app.TTSRequest(text="Xin chao", voice="truc-ly"))
        self.assertEqual(response.status_code, 502)

    def test_tts_rejects_concurrent_inference(self):
        app._tts = FakeEngine()
        app._ready = True
        self.assertTrue(app._infer_lock.acquire(blocking=False))
        try:
            response = app.tts(app.TTSRequest(text="Xin chao", voice="truc-ly"))
            self.assertEqual(response.status_code, 429)
        finally:
            app._infer_lock.release()

    def test_warm_model_retries_transient_failures(self):
        with (
            patch("app.MODEL_LOAD_RETRY_DELAYS", (0, 0, 0)),
            patch("app._load", side_effect=[None, None, object()]) as load,
        ):
            app._warm_model()
        self.assertEqual(load.call_count, 3)


if __name__ == "__main__":
    unittest.main()
