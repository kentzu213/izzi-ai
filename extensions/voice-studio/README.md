# Voice Studio (VieNeu-TTS) - Managed Local Backend

Text-to-speech preview for Vietnamese and English, running fully on the user's
machine. This runtime accepts text and one audited built-in voice only. It does
not accept reference audio and does not clone or impersonate voices.

## How the host drives it

1. Reads the `service` block in `manifest.json` (project `izzi-svc-voice-studio`,
   health `/health/ready`, loopback only, and the exact pinned `readyContract`).
2. Allocates a free host port, writes a private managed environment file, starts
   the pinned compose service, and injects `backendUrl=http://127.0.0.1:<port>`.
3. The extension has no fixed-port or hosted fallback. Commands fail closed when
   the host-injected URL is missing or malformed.
4. No secrets or user content leave the machine.
5. First run downloads immutable model revisions into the `vieneu_models` volume.

## Extension commands

| Command | Params | Description |
|---|---|---|
| `voice-studio.status` | `{}` | Backend reachable and model loaded? |
| `voice-studio.listVoices` | `{}` | Audited built-in voice IDs |
| `voice-studio.tts` | `{ text, voice }` | Text to WAV preview; returns `{ ok, format, audioB64 }` |

Audited public voice IDs:

| ID | VieNeu preset |
|---|---|
| `pham-tuyen` | `Phạm Tuyên` |
| `truc-ly` | `Trúc Ly` |
| `xuan-vinh` | `Xuân Vĩnh` |
| `thuy-dung` | `Thùy Dung` |

## Immutable runtime contract

The compose service uses a release-audited image digest built by
`.github/workflows/publish-voice-image.yml` from `service/backend/`. The digest
is literal and cannot be replaced through inherited image or bind variables.

- Base image: digest-pinned `python:3.11-slim`.
- SDK: `vieneu==3.2.3`.
- Model: `pnnbao-ump/VieNeu-TTS-v3-Turbo@75ff82a72f54d55ed389e1eeb12041d3c4bac7d4`.
- Codec: `OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX@ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae`.
- Preset catalog SHA-256: `13f17165586ec132efd35076f46ec8de7f7e474a344e262c6360d89726eeb8d9`.
- Engine: `Vieneu(mode="v3turbo", backend="onnx", device="cpu")`.

- Watermark: disabled explicitly for the torch-free CPU image.
- Readiness: the host exposes the injected URL only when the SDK, model revision,
  codec revision, and preset-catalog hash all match the manifest contract.

VieNeu 3.2.3 describes Perth watermarking as optional in its source, but its
wheel metadata incorrectly requires `perth>=0.2.0`. The PyPI distribution named
`perth` is unrelated and has no binary wheel. The image therefore installs the
complete hash-locked dependency set with `--no-deps`, removes exactly that one
metadata requirement, updates the installed `RECORD`, verifies Perth is absent,
and then runs `pip check`. The official VieNeu wheel itself remains pinned by
SHA-256. Build-time `pip` and `setuptools` are removed from the final runtime
layer after `pip check`, so the serving image does not carry the base-image
packaging tools. Any upstream metadata drift fails the build.

`/health/ready` returns the SDK version, model revision, codec revision, and
preset-catalog hash only after all contracts validate and the model loads. The
startup warm-up retries transient load failures at most once per minute through
the host's ten-minute readiness window.

`/tts` rejects unknown fields, text above 500 characters, unknown voices,
concurrent inference, output above 8 MiB, and output that is not PCM16 mono
48 kHz RIFF/WAVE.
