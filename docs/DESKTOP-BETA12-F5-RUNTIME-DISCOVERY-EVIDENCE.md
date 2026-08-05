# Izzi AI Desktop Beta.12 F5-TTS Runtime Discovery Evidence

Date: 2026-08-05
Repository: `kentzu213/izzi-ai`
Product commit: `c8c5c71f653330571ef8aae647c7623c4a977d79`
Public tag: `v1.14.0-beta.12`
Release: https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.12

## Release slice

This closes the bounded local F5-TTS discovery slice from the public packaged
build. The source worktree was not used as the product under test.

- Release workflow run `30486810008` succeeded on both jobs: `build-windows`
  in 3m48s and `build-mac`.
- Release is public, non-draft, prerelease, and complete with 12 assets,
  published `2026-07-29T20:04:25Z`.
- Windows publish artifacts are exactly three: the installer, its blockmap,
  and `latest.yml`. No extra or missing Windows artifact.
- Downloaded artifact digests matched the GitHub release digests:
  - installer `7ba825adcfc15eb125fcff20d65949bb6fef8c64f2afe692244b54fa3c7a78d7`
  - blockmap `cd0cefa19f8c2b75b3a106013628fbd8930e967a76b9e2e56f27f2a84245ba56`
  - `latest.yml` `b4202930d0478edcd56839c418456c3bdeae273a568bcdea85a2a30c31ffc3be`
- `latest.yml` bound the release exactly: version `1.14.0-beta.12`, size
  `184554582`, and a SHA-512 that matched the installer bytes recomputed
  locally.
- The installer carried a valid `MZ` DOS header and a `PE` signature at the
  header offset.

## Installed build under test

- Install target `F:\IzziAI`, silent NSIS install over the previous
  `1.14.0-beta.11` build, per-user, no data reset.
- Installed executable `FileVersion` was `1.14.0-beta.12`.
- Installed executable digest
  `70a9cdb455d6efbc065d1bf8d266a02607d3634dc8e25b6cbbb59dff827dfa28`.
- Installed `app.asar` digest
  `9887d143cd57ff43062f26d6ae6118d123431962b9b3f6676c93d20bd37218dd`.

UI evidence is kept outside Git under the local
`artifacts/starizzi-marketing-room/cmr-220` directory. Private screenshots and
local profile paths are intentionally not committed.

## Discovery input present on the machine

Two HyperFrames projects existed under the user's OneDrive `Documents` folder
at `Content/HyperFrames/videos/<project>`. Both carried every component the
discovery contract requires:

- `.f5-venv/Scripts/python.exe`
- `.models/f5-tts-vietnamese-vivoice/model_last.pt`
- `.models/f5-tts-vietnamese-vivoice/config.json`
- `.models/vocos-mel-24khz/config.yaml`
- `.models/vocos-mel-24khz/pytorch_model.bin`
- `.tools/F5-TTS-Vietnamese/src/f5_tts`

## Packaged proof, two runtime modes

The installed app was driven over the Chrome DevTools Protocol through the
rendered UI only: navigation to `AI Marketing`, then the `Video Studio` tab.
No import, preview, publish, spend, credential, or workspace mutation was
performed. Both runs were captured at desktop `1280x800` and mobile
`390x844`.

The environment claim is not taken from what the launching shell believed it
removed. Each run also attached to the main process over the Node inspector and
listed the `STARIZZI_F5_TTS_*` key names present in `process.env` inside that
process. Only key names were collected; no value was read or recorded. Main
process fingerprint in both runs: Electron `34.5.8`, Node `20.19.1`, `win32`.

### Mode A — discovery only

- Main process held **zero** `STARIZZI_F5_TTS_*` keys, measured inside the main
  process, not in the parent shell.
- `F5-TTS` card version: `ViVoice 50228cc`, which equals the discovery constant
  in `f5-tts-runtime.ts`.
- Because no key was present, `explicitCandidate` could not return a candidate,
  so the reported status must come from the filesystem discovery branch. The
  version string alone would not prove this: `statusForCandidate` falls back to
  the same constant when `STARIZZI_F5_TTS_VERSION` is empty, so the zero-key
  measurement is the part that closes the argument.
- `F5-TTS` card status: `Cần thiết lập`, detail `F5-TTS local đã cài nhưng
  service chưa chạy. Commercial render vẫn khóa.`
- Evidence: `artifacts/starizzi-marketing-room/cmr-220/discovery-only/cmr220-f5-discovery-smoke.json`

### Mode B — explicit environment configuration

- Main process held all **eleven** configured `STARIZZI_F5_TTS_*` keys.
- `F5-TTS` card version: `ViVoice 50228ccc`, which differs from the discovery
  constant, so the explicit version override still wins over discovery.
- Scope of this claim: it covers the version field only. The run did not
  cross-check `modelHash`, `license`, `licenseSource`, or the endpoint probe
  against their configured values, so mode B is evidence that the explicit
  override path still applies, not a full contract test of it.
- Evidence: `artifacts/starizzi-marketing-room/cmr-220/env-configured/cmr220-f5-discovery-smoke.json`

The smoke script asserts the mode explicitly: mode A requires zero keys in the
main process and an exact match with the discovery constant, mode B requires a
non-empty key set and a version different from that constant. A discovery
regression can therefore no longer pass as a success.

### Shared observations in both modes

- Gate strip: `Local preview: Đang chặn`, `Commercial render: Chưa được phép`,
  `External actions: Đang khóa`.
- No layout overflow: document width equalled viewport width at `1280` and at
  `390`.
- Zero console errors, zero runtime exceptions, zero network loading failures,
  zero HTTP responses at or above 400, and zero external HTTP requests.
- Other toolchain cards rendered real local state: HyperFrames `0.7.57`
  needing a Chrome Headless Shell, Node runtime `v20.19.1` ready, FFmpeg
  `8.1.1-essentials_build-www.gyan.dev` ready, Voice Studio `0.1.0` installed
  and not running.

## Automated checks

- Focused unit suite `src/main/customer-marketing/f5-tts-runtime.test.ts`:
  5/5 passed.
- Full desktop suite in the default parallel mode: 74 files, 976 tests passed,
  Vitest `4.1.2`.
- CI for this exact commit ran the `Build desktop app` and `Run desktop tests`
  steps in the `build-windows` job before the `Package and Publish` step that
  produced the artifact under test, per
  `.github/workflows/release-desktop.yml`.
- That workflow triggers only on `tags: v*`, so the documentation-only commit
  pushed to `main` for this record cannot start a build or create a release.

## Rollback path

- `v1.14.0-beta.11` remains a non-draft public release with all three Windows
  artifacts in `uploaded` state: installer
  `85571c870bdb516f6662d5764197b00fc2e2d681af09b643357677a2bfe147d1`
  at `184551752` bytes, its blockmap, and `latest.yml`. Reinstalling that
  installer returns the machine to the previous build.
- After the proof runs, every `Izzi AI` process was terminated and both debug
  ports `9222` and `9229` were confirmed no longer listening.

## Limits of this evidence

- The pre-fix behaviour was not re-measured on a packaged `1.14.0-beta.11`
  install. The claim that the previous build reported the runtime as missing
  without explicit configuration is derived from the replaced implementation,
  which read only the `STARIZZI_F5_TTS_*` variables, and from the focused unit
  suite.
- Discovery reports installation only. It performs no inference, no process
  launch, no download, no upload, and no publish action.
- ViVoice remains `CC-BY-NC-SA-4.0`. Commercial render stayed locked in both
  modes.
- The installer is still `NotSigned`, and clean-machine install, upgrade, and
  uninstall proof remains open under CMR-214 and CMR-216.
- Status: `local_verified_only`. No staging or production deploy was performed.
