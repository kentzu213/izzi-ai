# Izzi AI Desktop Beta.24 Voice Studio Evidence

Date: 2026-08-10 ICT

Repository: `kentzu213/izzi-ai`

- Feature commit: `9e64ca3`
- Release commit: `026a15a`
- Public tag: `v1.14.0-beta.24`
- Release: <https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.24>

## Closed release slice

Voice Studio 0.2 is now the bounded local TTS runtime used by IzziAPI Marketing.
The installed desktop repairs a missing or old first-party extension from the
bundled OCX, keeps only permissions declared by the current manifest, starts the
managed service on loopback, and requires the complete runtime provenance
contract before reporting ready.

The backend accepts text plus one audited built-in voice. It does not accept
reference audio, voice cloning, or arbitrary voice IDs. VieNeu-TTS, model and
codec revisions, dependencies, image digest, and preset catalog are pinned.

## Source verification

The final source and release commits were checked with:

```powershell
pnpm --filter @openclaw/desktop test
pnpm --filter @openclaw/desktop build
pnpm --filter @openclaw/desktop exec vitest run src/main/customer-marketing/customer-marketing-voice-studio-runtime.test.ts src/main/extensions/local-service-manager.test.ts src/main/extensions/voice-studio-runtime-contract.test.ts src/main/extensions/voice-studio-manifest.contract.test.ts
python -m unittest -v test_audio_validation.py test_model_runtime.py test_vieneu_dependency_compat.py
docker build --target test --tag izzi-voice-tts:beta24-local-test extensions/voice-studio/service/backend
pnpm audit --prod --audit-level high
node tools/socrates-tier1.mjs --changed
npx gitnexus detect-changes --scope staged --repo <repo-root>
```

Measured results:

- `pnpm --filter @openclaw/desktop test` reported 86 files and 1,195 tests passed.
- The focused `pnpm --filter @openclaw/desktop exec vitest run ...` command
  reported 4 files and 42 tests passed.
- `pnpm --filter @openclaw/desktop build` passed TypeScript plus Vite and
  reported 1,139 transformed modules.
- The `python -m unittest -v ...` command above reported 12 tests passed.
- The `docker build --target test ...` command above reported 21 tests passed,
  including the FastAPI tests.
- Production audit: no high or critical finding; 4 moderate and 1 low finding remain.
- GitNexus reported low risk for the feature commit.
- Socrates returned PASS after the required OCX, Docker context, and permission
  bypass findings were fixed.

The packer was also executed from a staged Git tree materialized into a clean
temporary directory. It generated `voice-studio-0.2.0.ocx` with the expected
manifest and four permissions. The final packer removes stale OCX versions,
excludes Python cache files, and fails the desktop package when the required
Voice Studio archive cannot be generated.

## Published image

GitHub Actions run
<https://github.com/kentzu213/izzi-ai/actions/runs/31332932328> built and pushed
linux/amd64 and linux/arm64 from feature commit `9e64ca3`. It completed with
SBOM, BuildKit provenance, and GitHub build attestation.

Published digest:

```text
ghcr.io/kentzu213/izzi-voice-tts@sha256:b3201f4e98a920d21e86e6c674335acb677c1b91c7b858b706fab632ab180441
```

Verification commands:

```powershell
docker buildx imagetools inspect ghcr.io/kentzu213/izzi-voice-tts:beta24-candidate
gh attestation verify oci://ghcr.io/kentzu213/izzi-voice-tts@sha256:b3201f4e98a920d21e86e6c674335acb677c1b91c7b858b706fab632ab180441 --repo kentzu213/izzi-ai --deny-self-hosted-runners
docker pull ghcr.io/kentzu213/izzi-voice-tts@sha256:b3201f4e98a920d21e86e6c674335acb677c1b91c7b858b706fab632ab180441
```

The pulled image label recorded source revision
`9e64ca32d6d40bfca1926612376897d436f396f5` and backend tree hash
`0c99b3c17889465d29ba29f2e28c7687a2cbba4c4d898952c71faf15b30af2a6`.
Public-image smoke returned the full readiness contract, four voice IDs, a
207,404-byte RIFF/WAVE, HTTP 400 for an unknown voice, and HTTP 422 for a
reference-audio field.

## Desktop release

GitHub Actions run
<https://github.com/kentzu213/izzi-ai/actions/runs/31333388955> completed both
Windows and macOS jobs successfully. The public prerelease contains 12 assets.

The downloaded Windows installer was checked against both GitHub and
`latest.yml`:

- Asset: `Izzi-AI-1.14.0-beta.24-win-x64.exe`
- Size: 184,685,209 bytes
- SHA-256: `9165F3E519FC774FE9034A78D948460B5109D9D1D5A261099907AEA0941F1740`
- SHA-512 base64:
  `1Fia9qWCjlx7V6cmNt8ha0v29pukCmyFQPLtDv2FCVA2t6e3uABlnL22n80TVzgDU1X2pMbq0iwNKljNMVSPkw==`

The SHA-256 matched the GitHub asset digest. The size and SHA-512 matched the
public updater manifest exactly.

## Installed dogfood

The verified installer exited zero and registered Izzi AI
`1.14.0-beta.24`. The active install is `F:\IzziAI\Izzi`; both Desktop and
Start Menu shortcuts target `F:\IzziAI\Izzi\Izzi AI.exe`. The existing profile
remained at `%APPDATA%\@openclaw\desktop` and loaded the authenticated IzziAPI
Marketing workspace.

Installed artifact measurements:

- `Izzi AI.exe`: 190,635,008 bytes, SHA-256
  `66DC6AE16F00A263E794B9DE3FCDE3C104C8F7544A4BDFB24E802C0465187412`.
- `F:\IzziAI\Izzi\resources\app.asar`: 114,276,322 bytes, SHA-256
  `9C7C107FCF01946B0D43743FECB9F310AD5C1685E7C415460FDE88539CCD7B85`.
- Bundled Voice Studio OCX: version `0.2.0`, four declared permissions, no
  stale `0.1.0` OCX in the active package.

The installed app was launched with local CDP on port 9333. Its user agent and
updater state reported `1.14.0-beta.24`; a real manual updater check returned
`idle` with the same version.

Before repair, the Marketing Room displayed Voice Studio `0.1.0` and
`CẦN THIẾT LẬP`. Clicking the installed app's `Khởi động Voice Studio` control
performed the real upgrade and reached `0.2.0 / SẴN SÀNG` in 13,259 ms with no
captured page or console error. The installed manifest then reported 0.2.0 and
the exact VieNeu 3.2.3 readiness contract.

The app-managed container used the published digest on loopback port 58746.
Its direct TTS smoke returned a 222,764-byte RIFF/WAVE and rejected reference
audio with HTTP 422. Through the installed extension client itself:

- status returned HTTP 200 and the injected loopback URL;
- voice listing returned `pham-tuyen`, `truc-ly`, `xuan-vinh`, and `thuy-dung`;
- TTS returned a validated WAV payload with 389,180 base64 characters;
- a payload containing `refAudioB64` was rejected before backend execution;
- requested and granted permissions were exactly `storage.local`,
  `ui.notification`, `ui.panel`, and `net.http`.

Installed UI measurements:

- Desktop 1280 x 800: document and body width 1280; no horizontal overflow;
  screenshot `F:\3 AI-Automation\izziAi Marketing\artifacts\izzi-beta24-marketing-room-desktop.png`.
- Mobile 390 x 844: document and body width 390; no horizontal overflow;
  screenshot `F:\3 AI-Automation\izziAi Marketing\artifacts\izzi-beta24-marketing-room-mobile.png`.
- Voice Studio 0.2.0 remained visible and ready at both viewports.

Local evidence files:

- `F:\3 AI-Automation\izziAi Marketing\artifacts\izzi-beta24-marketing-room-desktop.png`
- `F:\3 AI-Automation\izziAi Marketing\artifacts\izzi-beta24-marketing-room-mobile.png`
- `F:\3 AI-Automation\izziAi Marketing\artifacts\izzi-ai-beta24-voice-studio-smoke.wav`

## Automatic update from beta.23

The public beta.23 package was extracted under an isolated temporary directory,
launched with its own user-data directory and CDP port 9334, and left separate
from the registered beta.24 installation. A listener on
`window.electronAPI.updater.onState` followed by a real
`window.electronAPI.updater.check()` observed this sequence without a mock:

```text
idle 1.14.0-beta.23
available 1.14.0-beta.24
downloading 1.14.0-beta.24
downloaded 1.14.0-beta.24, 100%
```

The updater cache then contained the downloaded beta.24 installer in its
pending directory. These commands measured the downloaded artifact and checked
that the sandbox was no longer running:

```powershell
$cache = Join-Path $env:LOCALAPPDATA '@openclawdesktop-updater'
$pending = Join-Path (Join-Path $cache 'pending') 'Izzi-AI-1.14.0-beta.24-win-x64.exe'
Get-Item $pending |
  Select-Object Length, LastWriteTime
Get-FileHash (Join-Path $cache 'installer.exe') -Algorithm SHA256
Get-CimInstance Win32_Process |
  Where-Object { $_.ExecutablePath -like '*izzi-beta23-sandbox*' }
Invoke-RestMethod 'http://127.0.0.1:9334/json/version' -TimeoutSec 2
```

The cached installer measured 184,685,209 bytes and SHA-256
`9165F3E519FC774FE9034A78D948460B5109D9D1D5A261099907AEA0941F1740`,
matching the public beta.24 installer above. No sandbox process remained and
CDP port 9334 was unavailable after its normal close.

The active registered installation was then rechecked independently. The
registry still reported `1.14.0-beta.24`; its executable and ASAR hashes still
matched the installed-artifact measurements above. The active app was launched
from `F:\IzziAI\Izzi\Izzi AI.exe` with CDP port 9333. A fresh updater check
returned `idle / 1.14.0-beta.24`.

The same installed run repaired Voice Studio to a healthy state within the
readiness polling window; the CDP harness measured 8,736 ms from click to the
stable `SẴN SÀNG` state.
The extension remained version 0.2.0 with the same four requested and granted
permissions. Its managed container was healthy at `127.0.0.1:5111`, used image
digest `sha256:b3201f4e98a920d21e86e6c674335acb677c1b91c7b858b706fab632ab180441`,
and returned the pinned VieNeu 3.2.3 readiness contract. An extension-client TTS
call returned a validated WAV payload with 358,460 base64 characters (the value
of `result.audioB64.length`), while a
payload containing `refAudioB64` was rejected as invalid. The Video Studio view
again measured no horizontal overflow at 1280 x 800 and 390 x 844.

This proves real automatic discovery and download from beta.23 to beta.24. It
does not claim an independently observed auto-install relaunch: the registered
installation already contained beta.24, so a sandbox quit could not establish
that final replacement step without risking the verified active installation.

## Known residuals

- The Windows executable remains unsigned (`NotSigned`); installer hashes were
  verified independently before execution.
- ESLint 9 still has no repository `eslint.config.*`, so the lint command is not
  an available gate. TypeScript, tests, build, Docker tests, audit, and installed
  smoke were used instead.
- The workspace audit retains four moderate and one low advisory outside this
  Voice Studio path.
- The silent local install used `F:\IzziAI\Izzi` because the custom destination
  argument contained a space. Active shortcuts and the registry point to the
  beta24 directory; older unregistered files under `F:\IzziAI` were not deleted.

## Rollback

The prior public installer remains available at
<https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.23>. Reinstalling
it returns desktop product bytes to beta23 while the profile and Docker model
volume remain outside the installation directory.
