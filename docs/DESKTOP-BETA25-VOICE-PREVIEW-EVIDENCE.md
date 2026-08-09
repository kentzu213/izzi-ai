# Izzi AI Desktop Beta.25 Voice Preview Evidence

Date: 2026-08-10 ICT

Repository: `kentzu213/izzi-ai`

- Feature and release commit: `9815523ff6e6dbba5877b83d17c3a21a8a0b8531`
- Public tag: `v1.14.0-beta.25`
- Release: <https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.25>
- GitHub Actions: <https://github.com/kentzu213/izzi-ai/actions/runs/31337751772>

## Closed release slice

The customer Video Studio can now create local Voice Studio previews for an
approved media job. The renderer submits only the job ID. The Electron main
process resolves the authenticated tenant and then verifies the workspace,
role, Pro entitlement, current approval digest, and approved scene captions.

The runtime receives only those approved captions and the fixed audited voice
`pham-tuyen`. Incoming audio remains size-bounded before base64 decoding and
must validate as PCM16 mono at 48 kHz before it is persisted. The resulting
receipt records provider, voice, clip count, total bytes, and the fact that
commercial use is still disallowed. The associated artifact records carry each
file name, byte count, and SHA-256. This slice does not render or publish a
video and does not enable an external action.

## Source verification

The release commit and the current checkout were verified with:

```powershell
git rev-parse 'v1.14.0-beta.25^{commit}'
pnpm --filter @openclaw/desktop test
pnpm --filter @openclaw/desktop exec tsc -p tsconfig.main.json --noEmit
pnpm --filter @openclaw/desktop exec tsc -p tsconfig.json --noEmit
pnpm build:all
pnpm audit --prod --json
pnpm audit --json
pnpm --filter @openclaw/desktop lint
```

Measured results:

- The tag resolves to commit
  `9815523ff6e6dbba5877b83d17c3a21a8a0b8531`.
- Full desktop regression: 86 test files and 1,219 tests passed.
- Main and renderer TypeScript checks passed with zero type errors.
- The five built workspace projects passed; the desktop Vite build transformed
  1,139 modules.
- The production dependency audit reported zero high or critical findings,
  four moderate findings, and one low finding across 424 dependencies.
- The full workspace audit reported 83 existing findings: 11 low, 36 moderate,
  35 high, and one critical across 862 dependencies. No dependency or lockfile
  changed in this release; the deferred Electron 34 and electron-builder 25
  work is tracked in `docs/compliance/cmr-404-dependency-audit.md`.
- ESLint 9.39.4 could not run because this repository has no
  `eslint.config.js`, `eslint.config.mjs`, or `eslint.config.cjs`. TypeScript,
  tests, production build, installed smoke, and document validation are the
  available release gates.

## Public release

GitHub Actions run `31337751772` completed both `build-windows` and
`build-mac` successfully against the release commit. The public prerelease is
not a draft and contains 12 assets.

The downloaded Windows installer and updater manifest were measured with:

```powershell
Get-Item 'F:\3 AI-Automation\izziAi Marketing\artifacts\beta25-public\Izzi-AI-1.14.0-beta.25-win-x64.exe'
Get-FileHash 'F:\3 AI-Automation\izziAi Marketing\artifacts\beta25-public\Izzi-AI-1.14.0-beta.25-win-x64.exe' -Algorithm SHA256
Get-Content -Raw 'F:\3 AI-Automation\izziAi Marketing\artifacts\beta25-public\latest.yml'
gh release view v1.14.0-beta.25 --repo kentzu213/izzi-ai --json assets,isDraft,isPrerelease
```

- Asset: `Izzi-AI-1.14.0-beta.25-win-x64.exe`
- Size: 184,688,853 bytes
- SHA-256:
  `f15978dbe977c22a216763213e05e6095a634798e83b884cee6ed89e46247e68`
- SHA-512 base64:
  `5/yllYbDS0fyd6fsIdOA2QWkdIGIYlCuiIG4c4EyJCPrSSToSqM8+AunNTnivs8Qu9z4y91X0chqb5RQvNPK9g==`

The local SHA-256 matched the GitHub asset digest. The size and SHA-512 matched
the public `latest.yml` exactly.

## Installed dogfood

The public installer was installed over the existing user profile and launched
from `F:\IzziAI\Izzi\Izzi AI.exe`. The running executable reports file version
`1.14.0-beta.25`, and its renderer URL points into the installed ASAR rather
than the source checkout.

Installed bytes were measured with `Get-Item` and `Get-FileHash -Algorithm
SHA256`:

- `F:\IzziAI\Izzi\Izzi AI.exe`: 190,635,008 bytes, SHA-256
  `9e9c6eb40cfc7b8359d957d5ddbc339506d901fac100ca0bb18554ef252b2a7e`.
- `F:\IzziAI\Izzi\resources\app.asar`: 114,305,083 bytes, SHA-256
  `97fc7f6dc0e69457513935814b5e4d05d2a1c7f6203d1a80f5ac1a5b03306ed1`.
- Windows Authenticode status from `Get-AuthenticodeSignature` is `NotSigned`.

The installed preload updater returned this state through CDP:

```json
{"state":"idle","version":"1.14.0-beta.25","checkedAt":"2026-08-09T21:52:50.280Z"}
```

The app-managed container `izzi-svc-voice-studio-tts-1` reported healthy on
`127.0.0.1:5111`; `GET /health` returned `{"status":"ok"}`. The UI reported
Voice Studio `0.2.0 / SAN SANG`, local preview ready, commercial render not
permitted, and external actions locked.

## Real voice output

The installed app repaired Voice Studio and then created eight WAV clips. The
latest persisted run was selected, enumerated, and measured with:

```powershell
$mediaRoot = Join-Path $env:APPDATA '@openclaw\desktop\customer-marketing-media'
$latestRun = Get-ChildItem -LiteralPath $mediaRoot -Recurse -Directory -Filter 'voice-preview' |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
$files = Get-ChildItem -LiteralPath $latestRun.FullName -File -Filter '*.wav'
$files | Measure-Object Length -Sum
$files | Get-FileHash -Algorithm SHA256
```

Each file was then probed with:

```powershell
ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,sample_rate,channels,bits_per_sample,duration -of csv=p=0 <file>
```

| File | Bytes | Duration | SHA-256 |
| --- | ---: | ---: | --- |
| `voice-01.wav` | 422,444 | 4.40 s | `0fa844ea1999207568d10683849caad4b7c9762cf9595128c888dc317d94cec5` |
| `voice-02.wav` | 445,484 | 4.64 s | `ae6d0b4ec722635d999033411813321e708d3bc468d35b53ef0b031733d1d2b3` |
| `voice-03.wav` | 291,884 | 3.04 s | `efa505924c1d78b4f2e089d6b10fef3b33f74d79a6d629ab823208144ff22c35` |
| `voice-04.wav` | 384,044 | 4.00 s | `99dc5a20f786889338f653df75092debe3e4595251d8fb51908ba7d3b731277b` |
| `voice-05.wav` | 483,884 | 5.04 s | `24146ee5236c5fb4bc97575f5fc93bc9534f49aedd4f8f980a5a14b101807d26` |
| `voice-06.wav` | 376,364 | 3.92 s | `ecdfb723dbca7ef2aa7565ae22ff39cefe03df31620253fc32b7e4cd76f19582` |
| `voice-07.wav` | 407,084 | 4.24 s | `9706502a0c639c4ff21f00d66d284a2f08aa2b063d931f7a05cf57a70bf6551b` |
| `voice-08.wav` | 430,124 | 4.48 s | `a4b9883db478e36919b8a191afa9b9759d766cd3788a82574c9255512ceaed2c` |

All eight files are `pcm_s16le`, 48,000 Hz, mono, and 16-bit. Their measured
total is 3,241,312 bytes. The installed receipt records
`commercialUseAllowed=false` and displays `voice-studio / pham-tuyen`, eight
clips, 3.1 MB, and the commercial lock.

## Installed UI smoke

A Playwright CDP smoke attached to the installed process on port 9333. It
selected `Tong quan`, returned to `Video Studio`, exercised the safe
HyperFrames check, verified keyboard focus on the voice-preview button, read
the updater state through the installed preload bridge, and captured console
and page errors.

- Desktop 1280 x 800: `scrollWidth=1280`; horizontal overflow was false.
- Mobile 390 x 844: `scrollWidth=390`; horizontal overflow was false.
- Console errors: zero.
- Page errors: zero.
- The HyperFrames check completed with zero warnings at 04:58 ICT.
- The voice receipt remained visible after navigation and viewport changes.

Evidence screenshots:

- `F:\3 AI-Automation\izziAi Marketing\artifacts\izzi-beta25-installed-voice-studio-desktop.png`
- `F:\3 AI-Automation\izziAi Marketing\artifacts\izzi-beta25-installed-voice-receipt-desktop.png`
- `F:\3 AI-Automation\izziAi Marketing\artifacts\izzi-beta25-installed-voice-receipt-mobile.png`

## Known residuals

- Windows remains unsigned; the public installer and installed bytes were
  independently hashed before this record was written.
- ESLint remains unavailable until the repository receives an ESLint 9 flat
  configuration.
- The full workspace dependency audit remains non-zero as recorded above. The
  production audit has no high or critical finding, and beta25 changed no
  dependency metadata.
- F5-TTS is installed but its local service is not running. Voice Studio is the
  verified local preview provider for this release.
- Commercial render, reference-voice consent, external publish, and spend stay
  fail-closed. Beta25 proves local voice preview only.

## Rollback

The previous public installer remains available at
<https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.24>. Reinstalling
it returns the desktop product bytes to beta24 while keeping the user profile
and Voice Studio model volume outside the installation directory.
