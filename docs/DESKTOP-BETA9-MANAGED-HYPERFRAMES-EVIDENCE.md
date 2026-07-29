# Izzi AI Desktop 1.14.0-beta.9 Managed HyperFrames Evidence

Date: 2026-07-29
Repository: `kentzu213/izzi-ai`
Release commit: `6cb2c9b8a96d7b85c07f5a37640c3b2052552265`
Tag: `v1.14.0-beta.9`
Release workflow: `30473361818`
Main CI workflow: `30473350097`

## Closed release slice

- Izzi AI verifies the packaged HyperFrames `0.7.57` package and CLI before
  exposing local preview readiness.
- Electron `34.5.8` / Node `20.19.1` is accepted only for the attested
  check-and-snapshot path. It cannot enable commercial render.
- Izzi AI discovers an existing Chrome Headless Shell but does not download or
  install a browser.
- HyperFrames commands run with a scrubbed environment, blocked outbound proxy,
  isolated profiles, bounded output, timeout, and process-tree cleanup.
- Snapshot times are derived from scene interiors. The verified guide uses
  `3s`, `26s`, and `56.5s`.
- Compact run IDs reduce Windows path length while preserving timestamp and
  entropy.
- F5 ViVoice remains blocked for commercial use under
  `CC-BY-NC-SA-4.0`.

## Verification before release

- Full desktop regression: `965/965` tests passed.
- TypeScript checks: passed.
- Production build: passed with `1,136` modules.
- Local packaged smoke: passed.
- Installed public-package smoke: passed with an attested executable,
  `app.asar`, harness, browser, and application version.
- `git diff --check`: passed.
- Reviewer and Socrates reviews: approved.
- Security review: approved after the packaged smoke bound all four input
  artifacts by SHA-256 before and after execution.

## Published release

- Commit `6cb2c9b8a96d7b85c07f5a37640c3b2052552265` is on `origin/main`.
- Release workflow `30473361818` passed on Windows and macOS.
- Main CI workflow `30473350097` passed on Windows and macOS.
- Release `v1.14.0-beta.9` is public, non-draft, and marked prerelease.
- All 12 release assets are uploaded:

| Asset | SHA-256 |
| --- | --- |
| `Izzi-AI-1.14.0-beta.9-win-x64.exe` | `f600b407b91329e175863b29dd9936e13240d91a6da616dd49be79db6db80696` |
| `Izzi-AI-1.14.0-beta.9-win-x64.exe.blockmap` | `04ae9a3f9f379e577729d4d90c906167758d0bcc54db0981bb0943ec033bde69` |
| `Izzi-AI-1.14.0-beta.9-mac-x64.dmg` | `2f724a3819586fdb19ec0fe2538d0f92a99b81c289364837e28c68458efaffeb` |
| `Izzi-AI-1.14.0-beta.9-mac-x64.dmg.blockmap` | `9d35f1a79d959594377bfa14d222392deae1dcf117edde0deb65c6f6a84744ab` |
| `Izzi-AI-1.14.0-beta.9-mac-x64.zip` | `8136977e65bb7c86424c099c918f98a2cb724c337d35b623acb146a7ca105972` |
| `Izzi.AI-1.14.0-beta.9-mac-x64.zip.blockmap` | `3009a0b6b25ae254ec6fd171285612f30fbc5aef797455638dfa90d59d61ea06` |
| `Izzi-AI-1.14.0-beta.9-mac-arm64.dmg` | `57a6c2d37dc761e14e734ed12472b48013cf441cf58af712073deb515dd3f2ec` |
| `Izzi-AI-1.14.0-beta.9-mac-arm64.dmg.blockmap` | `266b11686f2c15a871c372a3a652ebd4fd26588c078297107d5ad87b2fdb69a7` |
| `Izzi-AI-1.14.0-beta.9-mac-arm64.zip` | `abdc4b2798e77b7544934dcd891c9f36562d585213eef2baddae5c22392814ac` |
| `Izzi.AI-1.14.0-beta.9-mac-arm64.zip.blockmap` | `68902fe1a2a1cf416128ac9df120c15197d86de8de5a693e571bf137342c76fd` |
| `latest.yml` | `8250d5003ea5e2d5034125d7cd932371c4be4bd50586a805b1c8dab2e9e315e7` |
| `latest-mac.yml` | `ceed8aeba5af55f1f6cffb2677b8252d60691d7a6dfc040a3dc1831b51521ce4` |

## Installed public artifact

- The public Windows installer was downloaded and verified at SHA-256
  `f600b407b91329e175863b29dd9936e13240d91a6da616dd49be79db6db80696`.
- It was installed at `F:\IzziAI`.
- Installed application version: `1.14.0-beta.9`.
- Installed executable SHA-256:
  `7d8023cb1fd3a6ae1d937e1f9c0e2eaa219c89703e85a3e70aee2b9f05e7f9e6`.
- Installed `app.asar` SHA-256:
  `1f8f9ef51caa7f0ede9ad9fece7fa0f91df1fa1835683f74544758e4d1347e4f`.
- Packaged smoke harness SHA-256:
  `a8a4f7441e1333de46cfe9fadd58d32873ef45c978b481f25ba101393f108486`.
- Chrome Headless Shell SHA-256:
  `6316e533d6df44dfb50fa34bbb96117f5ab8cdd85beee9165b6b293440a51153`.
- Final passing packaged-smoke receipt SHA-256:
  `2e9ef8346cc868ce30add067f07134ee90ac7ed1f49d679557f8e40aa5a580d1`.
- The smoke reported Electron `34.5.8`, Node `20.19.1`, HyperFrames
  `0.7.57`, three snapshots, no external actions, no host tool use, no project
  mutation, no profile mutation, no synthetic-secret leak, no input artifact
  mutation, and no remaining Chrome process.

## Real UI experience

- The installed application was launched from `F:\IzziAI\Izzi AI.exe`.
- AI Marketing -> Video Studio reported HyperFrames `0.7.57`, managed Node
  `v20.19.1`, and local preview as ready.
- FFmpeg and F5-TTS still require setup. Voice Studio `0.1.0` is installed but
  was not running.
- Commercial render remained blocked and external actions remained locked.
- The operator used `Chạy lại kiểm tra` in the installed UI.
- The visible receipt changed from prefix `b9d0a25843bd` to
  `9d8aedfc46fa`, reported zero warnings, and recorded three snapshots.
- Installed-UI receipt SHA-256:
  `9d8aedfc46fa77071d57e2187c7724384bf93e6e5496e0702e205a3ce63eef0a`.

Installed-UI snapshot evidence:

| Time | Visible scene | SHA-256 |
| --- | --- | --- |
| `3s` | `open the room` | `b481691d410864ed0f60e743204e199788ec966651d321075a9cb5eb22d1dd07` |
| `26s` | `decide as a human` | `95493afd09032578c31220fa4b93637947d509f5766460b6f9ab158fd266a96b` |
| `56.5s` | `review before delivery` | `73834667d8ae0fd9060445db9f27004d629b7d2b314e464196946dd262fb000d` |
| contact sheet | three nonblank frames | `b5cd6e80ae668f1bc4b5eb93f29bf1ec21a42e8291d923e4b554209f6ab365ba` |

The UI artifacts remain outside the repository because they contain local
workspace screenshots.

## Reproduced post-release defect

- The installed package passes when the proof parent is short.
- The same executable, `app.asar`, harness, browser, and project fail when the
  eventual frame path reaches 264 characters.
- The long-path run stopped before producing a receipt. It caused zero input
  artifact mutations, zero project/profile deltas, zero external tool hits,
  zero synthetic-secret hits, and zero remaining Chrome processes.
- This narrows the defect to HyperFrames snapshot output under an extreme
  Windows path, not to the published artifact, browser, project, or managed
  runtime.
- The next bounded patch will stage HyperFrames snapshot output under the
  shorter managed-runtime directory, validate it, then copy only approved image
  bytes into the durable preview run.

## Safety and remaining gates

- No marketing publish, advertising spend, bulk send, credential mutation,
  integration mutation, voice generation, commercial render, or production
  service deployment was performed.
- The Windows installer is not digitally signed.
- F5 ViVoice cannot be used for commercial output under its current license.
- ESLint 9 still has no repository flat config.
- Existing dependency advisories remain baseline debt and were not introduced
  by this release.
- The guide still contains `Starizzi` in some content strings. That branding
  cleanup remains a separate content-only release after the reproduced
  long-path defect is closed.
