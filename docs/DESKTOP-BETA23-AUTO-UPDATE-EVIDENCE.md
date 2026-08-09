# Izzi AI beta.23 automatic update evidence

Date: 2026-08-10 ICT

Scope: make installed Windows packages download updates in the background,
install them on a normal zero-exit quit, and keep the existing explicit Restart
action. Development, mock, and unpacked-directory safeguards remain enabled.

## Release

- Public tag: `v1.14.0-beta.23`
- Release: <https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.23>
- Feature commit: `868b333`
- Release commit: `c7014d9`
- GitHub Actions run: `31329331908`, Windows and macOS jobs both concluded
  `success`.

The release and commit relationship was checked with:

```powershell
git show -s --format=%H refs/tags/v1.14.0-beta.23
gh run view 31329331908 --repo kentzu213/izzi-ai --json status,conclusion,jobs
gh release view v1.14.0-beta.23 --repo kentzu213/izzi-ai --json assets,isDraft,isPrerelease
```

The public Windows installer is
`Izzi-AI-1.14.0-beta.23-win-x64.exe`. The downloaded public bytes measured
`184620719` bytes and produced SHA-256
`446472551A76E520299B78C4E75FAE594845E8747AA417FD21E566699A0E9327`; the
GitHub asset digest and the local hash matched. The same bytes matched the
SHA-512 and size declared by the public `latest.yml`, checked by parsing the
manifest with `js-yaml` and hashing the downloaded file.

## Verification

The following commands passed after the updater and dependency changes:

```powershell
pnpm --filter @openclaw/desktop exec tsc -p tsconfig.main.json --noEmit
pnpm --filter @openclaw/desktop exec tsc -p tsconfig.json --noEmit
pnpm --filter @openclaw/desktop exec vitest run src/main/updater/updater-service.test.ts src/main/updater/updater-dependency-contract.test.ts
pnpm --filter @openclaw/desktop test
pnpm --filter @openclaw/desktop build
pnpm --filter @openclaw/desktop run pack
node tools/socrates-tier1.mjs --changed
```

The focused updater contract contained `17` passing tests. The full desktop
run contained `1174` passing tests across `85` files. The production renderer
build transformed `1139` modules. The local directory package completed
electron-builder packaging and its ASAR contained `js-yaml 4.3.1`,
`fast-uri 3.1.5`, `nanoid 3.3.17`, `autoDownload = true`, and
`autoInstallOnAppQuit = true`.

The focused and full test counts were read directly from the Vitest output of
the commands above. The ASAR checks used the local `@electron/asar` reader
against `apps/desktop/release/win-unpacked/resources/app.asar`.

## Installed dogfood

The public installer was run over the existing per-user installation at
`F:\IzziAI\Izzi AI`. Windows recorded `Izzi AI 1.14.0-beta.23` in the current
user uninstall entry, and the installed ASAR reported `1.14.0-beta.23`.
The installed executable was responsive after launch. Its update manifest
pointed to the GitHub provider and `kentzu213/izzi-ai`.

The real packaged updater check returned:

```json
{"state":"idle","version":"1.14.0-beta.23"}
```

This is the expected result because beta.23 was the newest public release at
the time of the check. The Settings > Cập nhật view showed `State: idle`,
`Current version: 1.14.0-beta.23`, and no available version.

The authenticated Marketing Room also loaded from the installed package and
showed the persisted `IzziAPI Marketing` workspace, workflow state, approval
inbox, local-only action guard, and the Video Studio entry. Screenshots:

- [Installed desktop chat smoke](../.artifacts/beta23-installed-desktop.png)
- [Installed mobile chat smoke](../.artifacts/beta23-installed-mobile.png)
- [Installed desktop Marketing Room](../.artifacts/beta23-marketing-room-desktop.png)
- [Installed mobile Marketing Room](../.artifacts/beta23-marketing-room-mobile.png)

The Playwright CDP smoke measured `1280x800` desktop and `390x844` mobile
viewports; in both cases `scrollWidth` equaled the viewport width and the
horizontal-overflow check was false. The measurements and screenshots were
captured against the installed `Izzi AI.exe`, not the source preview.

The profile directory remained at `%APPDATA%\@openclaw` before and after the
upgrade. The raw file count changed from `3318` to `3314` and the byte total
from `896297421` to `896264937` across a clean close and install, so this
record does not claim byte-for-byte profile identity; the persisted workspace
loaded successfully after the upgrade and the application database and
customer-marketing data paths were still present.

## Known residuals

- `pnpm --filter @openclaw/desktop lint` remains unavailable because the repo
  has no `eslint.config.*` for ESLint 9. No new lint diagnostics were produced.
- `pnpm audit --prod` reported `8` workspace findings: `3` high findings in
  the CLI's `brace-expansion` chain, `4` moderate and `1` low finding in the
  marketplace API's Hono chain. The desktop updater/settings/HyperFrames high
  findings were patched to the versions recorded above. CLI and marketplace
  remediation is the next separate CMR-404 slice.
- Windows Authenticode status remains `NotSigned` because no signing
  certificate is configured. The installer digest was verified independently.

## Rollback

The previous public Windows installer is retained at
<https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.22>. Running
that installer over the same per-user directory is the documented rollback
path; the application profile is not removed by the NSIS uninstall policy.

Next slice: remediate the remaining CLI/marketplace dependency findings, then
exercise a newer public release from beta.23 to verify the automatic download
event end to end.
