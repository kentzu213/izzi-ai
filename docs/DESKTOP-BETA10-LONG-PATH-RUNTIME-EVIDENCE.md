# Izzi AI Desktop 1.14.0-beta.10 Long-Path Runtime Evidence

Date: 2026-07-29
Repository: `kentzu213/izzi-ai`
Release commit: `bc0d5d6b88fdab1936ad78be00a0dbec8d4f87e8`
Tag: `v1.14.0-beta.10`
Main CI workflow: `30476887501`
Release workflow: `30477019719`

## Closed release slice

- Izzi AI creates each managed HyperFrames runtime under an atomic
  `izzi-ai-hf-*` directory in the system temp directory.
- `HOME`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, the command working directory,
  Chrome/fontconfig caches, and snapshot staging all stay under that short
  runtime profile.
- HyperFrames never writes directly into the durable customer preview run.
- Staged PNG and JPEG files are validated, copied with no-overwrite writes,
  re-read, and byte-compared before artifact evidence is returned.
- The short-lived runtime profile is removed after success or failure.
- Commercial render and all external actions remain blocked.

## Verification before release

- Focused Customer Video Studio tests: `32/32` passed.
- Full desktop regression: `965/965` passed.
- Main TypeScript check: passed.
- Production build: passed with `1,136` modules.
- Added-secret scan: `0` findings.
- `git diff --check`: passed.
- Reviewer and Security Reviewer: approved.
- Socrates release gate: `GO`.
- Main CI `30476887501`: Windows and macOS passed.

## Published release

- Commit `bc0d5d6b88fdab1936ad78be00a0dbec8d4f87e8` is on
  `origin/main`.
- Release workflow `30477019719` passed on Windows and macOS.
- Release `v1.14.0-beta.10` is public, non-draft, and marked prerelease.
- All 12 expected assets are present and expose SHA-256 digests:

| Asset | SHA-256 |
| --- | --- |
| `Izzi-AI-1.14.0-beta.10-win-x64.exe` | `4a8fcb34b8dbaaa0aa059dbb1f07d822cc3b8e571730f2caaae5b1cf5ab764e5` |
| `Izzi-AI-1.14.0-beta.10-win-x64.exe.blockmap` | `c46df49b073cce482b93f385793c31db11f6fb5ca934c8d1291fd41fce99e133` |
| `Izzi-AI-1.14.0-beta.10-mac-x64.dmg` | `4b2523ff60816b73123590cc20d4807f89f7bd91ce4aa9600eb0f54ed617a603` |
| `Izzi-AI-1.14.0-beta.10-mac-x64.dmg.blockmap` | `be8af5e0653b44f6f573afc20f85e612ea9e6cce6371a9827e7b17fd7bffed24` |
| `Izzi-AI-1.14.0-beta.10-mac-x64.zip` | `8e1ba7519dd3aafb6a5e2eff20b559c43f98ce0555874dfa04cd23e28149563e` |
| `Izzi.AI-1.14.0-beta.10-mac-x64.zip.blockmap` | `f94d3f429eeed971ac35efa9f2041154213311de40b43bcf763378f7761a5d1e` |
| `Izzi-AI-1.14.0-beta.10-mac-arm64.dmg` | `6f4a644d5d80241dcce9cc49abf3cb1648f1bbf5589624160c538d79cb8a981e` |
| `Izzi-AI-1.14.0-beta.10-mac-arm64.dmg.blockmap` | `d6b467d4e52b66ae24afff1811a106228ac2c08c602405c020707ca93b1f2d3d` |
| `Izzi-AI-1.14.0-beta.10-mac-arm64.zip` | `35c426479c04c046289e9e299205c840f89e04fa1f6ca75ae8c2cfbb0fb9e3ce` |
| `Izzi.AI-1.14.0-beta.10-mac-arm64.zip.blockmap` | `84eeb38416b3b85b5938ae7d7e65827cb960b12874e307d3fd7f655009670ccf` |
| `latest.yml` | `b0e5e0ba8ab3641dc5e22228b4e60a017825af1adb30d3e53f08bc0a2cb3464d` |
| `latest-mac.yml` | `c862cdcc894b8baa89b1a7d21317208369ff2b97c50bcb9b602d201ef816ebc6` |

## Installed public artifact

- The public Windows installer was downloaded from the GitHub release.
- Downloaded installer SHA-256 matched the GitHub digest:
  `4a8fcb34b8dbaaa0aa059dbb1f07d822cc3b8e571730f2caaae5b1cf5ab764e5`.
- Beta.9 was stopped and beta.10 was installed at `F:\IzziAI`.
- Installer exit code: `0`.
- Installed application version: `1.14.0-beta.10`.
- Installed executable SHA-256:
  `d3a78fcdd39261f882e10640180db0cd8c9ae887a8fed8ca867e87a45e34716d`.
- Installed `app.asar` SHA-256:
  `8824fbe8464b12203b27642e151612174beb2ad51540abdeed3a319698ea009d`.
- Packaged smoke harness SHA-256:
  `f808860018cc9c4d26bd452048082a0d9318e29ca7afee04dc4e4fcee0127642`.
- Chrome Headless Shell SHA-256:
  `6316e533d6df44dfb50fa34bbb96117f5ab8cdd85beee9165b6b293440a51153`.
- The installer and installed executable remain unsigned.

## Public-package long-path smoke

- The installed public package ran through Electron `34.5.8`, Node `20.19.1`,
  and HyperFrames `0.7.57`.
- The durable contact sheet path reached `281` characters.
- The three durable frame paths reached `284`, `285`, and `285` characters.
- The run produced snapshots at `3s`, `26s`, and `56.5s`.
- Packaged-smoke receipt SHA-256:
  `7ddd70ecf918cb8a59a6a1a07f9ac7eb3cf5088e4fa748d6645712b958a36775`.
- `runtimeScratchClean` was `true`.
- Input artifact mutations: `0`.
- Receipt artifact mismatches: `0`.
- Host tool hits: `0`.
- Project deltas: `0`.
- HyperFrames profile deltas: `0`.
- Synthetic-secret hits: `0`.
- Remaining Chrome processes: `0`.
- External actions: `false`.
- Commercial render: `false`.

## Installed UI experience

- The installed application was launched from `F:\IzziAI\Izzi AI.exe` with
  Playwright Electron and remains open on AI Marketing -> Video Studio.
- HyperFrames `0.7.57`, managed Node `v20.19.1`, FFmpeg, and local preview
  reported ready.
- F5-TTS still requires setup. Voice Studio `0.1.0` is installed but was not
  running.
- Commercial render remained blocked and external actions remained locked.
- The operator clicked `Chay lai kiem tra` in the installed UI.
- The visible receipt changed from prefix `9d8aedfc46fa` to
  `e7a5cec6d955`.
- The resulting receipt passed with zero warnings and three snapshots.
- UI receipt SHA-256:
  `e7a5cec6d955c5381cbed8cc3c2656a69e66efe792eb3ee60306ed8974a3fd0b`.
- No renderer console error or page error was observed.

Installed-UI snapshot evidence:

| Time | Visible scene | SHA-256 |
| --- | --- | --- |
| `3s` | `open the room` | `b481691d410864ed0f60e743204e199788ec966651d321075a9cb5eb22d1dd07` |
| `26s` | `decide as a human` | `95493afd09032578c31220fa4b93637947d509f5766460b6f9ab158fd266a96b` |
| `56.5s` | `review before delivery` | `73834667d8ae0fd9060445db9f27004d629b7d2b314e464196946dd262fb000d` |
| contact sheet | three nonblank frames | `b5cd6e80ae668f1bc4b5eb93f29bf1ec21a42e8291d923e4b554209f6ab365ba` |

The UI screenshots remain outside the repository because the installed
profile contains local workspace information. Some generated artifact names
and UI timestamps crossed local midnight; this release evidence remains dated
2026-07-29.

## Reproduced follow-up

- The imported guide project still uses `Starizzi` in its project ID, title,
  and first-frame instruction.
- The installed app branding itself is `Izzi AI`.
- This is a content/branding defect, not a failure of the beta.10 long-path
  runtime patch.
- It must be handled as a separate bounded patch after beta.10 evidence is
  committed.

## Safety and remaining gates

- No marketing content was published, scheduled, uploaded, or bulk-sent.
- No advertising spend or provider mutation occurred.
- No credential was added, changed, logged, or committed.
- F5 ViVoice remains blocked for commercial output under
  `CC-BY-NC-SA-4.0`.
- Existing GitHub Actions runtime deprecation annotations remain workflow
  maintenance debt; both required workflows concluded successfully.
