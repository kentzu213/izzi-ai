# NM-011 provider grant v2

Date: 2026-08-27 (Asia/Ho_Chi_Minh)

## Scope

Close the smallest missing local authority contract in MKT-02 without enabling a
publish executor. Credential bytes stay encrypted in the Electron main process.
Every new credential is bound to its workspace and provider, carries an explicit
permission set and expiry, and exposes only a redacted status summary to the
renderer.

The user authorized `relaxed_mode` with the exact phrase `cho phép nới rule`.
Claude Code was not used because its usage is exhausted. ChatGPT web was not
requested or used.

## Decisions

- Envelope v2 stores `validate` and/or `sandbox_execute`, an expiry no more than
  90 days after issue, and a SHA-256 digest bound to workspace hash, provider,
  permissions, expiry, and issue time.
- Reading credential bytes now requires one explicit permission. Validation and
  sandbox execution request different permissions.
- The exact expiry boundary fails closed. Health and Telegram canary readiness
  report the provider unavailable without reading credential bytes.
- Legacy v1 envelopes have no scoped grant, so they are reported invalid and
  require an explicit reconnect. They are never silently promoted.
- Revoke deletes the credential envelope and its embedded grant. Existing
  workspace-role checks and durable revoke/health receipts remain authoritative.
- The renderer receives provider, state, issue time, permission names, expiry,
  and grant digest only. It receives no credential, OAuth URL, endpoint, chat id,
  or filesystem path.

## Verification

| Gate | Command | Result |
| --- | --- | --- |
| Focused NM-011 tests | `pnpm --filter @openclaw/desktop exec vitest run src/main/customer-marketing/customer-marketing-credential-vault.test.ts src/main/customer-marketing/customer-marketing-connector-vault-adapter.test.ts src/main/customer-marketing/customer-marketing-service.test.ts src/renderer/pages/CustomerMarketingChannels.contract.test.ts` | PASS, 273/273 |
| Full desktop suite | `pnpm --filter @openclaw/desktop test` | PASS, 1695/1695 in 122 files |
| Main TypeScript | `pnpm --filter @openclaw/desktop exec tsc -p tsconfig.main.json --noEmit` | PASS |
| Renderer TypeScript | `pnpm --filter @openclaw/desktop exec tsc -p tsconfig.json --noEmit` | PASS |
| Workspace lint | `pnpm lint` | PASS |
| Production build | `pnpm build` | PASS |
| Renderer bundle budget | `pnpm test:renderer-budget` | PASS, 2/2 |
| High-confidence credential scan | Scoped `rg` scan for OpenAI, GitHub, and AWS key shapes in desktop source/scripts and root tools | PASS, 0 hits |
| Dependency audit | `pnpm audit` | 1 high advisory in Electron's `extract-zip` devDependency; no patched version listed |
| Electron directory package | `pnpm --filter @openclaw/desktop run pack` | PASS; packaged FileVersion `1.14.0-beta.59` |
| Packaged dependency inventory | Read `app.asar` with the installed `@electron/asar` library and scan unpacked files | PASS; 9135 ASAR entries, 0 `extract-zip` entries |
| Packaged desktop UI | Playwright Electron smoke using the bundled Codex Playwright runtime | PASS at 1280x800 and 390x844; no horizontal overflow |
| Keyboard focus | Playwright focused the connection reload control and pressed Tab | PASS; visible button received `:focus-visible` with a 2px outline |

No external provider action was performed. Publish, spend, bulk send, and
commercial render behavior remain unchanged.

The current IzziAPI environment reports Native Marketing API unavailable, so
the packaged visual smoke exercised the real no-workspace state. Grant rows are
covered by the focused contract and renderer tests; no synthetic or real token
was inserted into the retained user profile.

## Release state

- Commit `dc30bd6` was pushed to `main` and tagged `v1.14.0-beta.59`.
- Desktop CI passed on Windows and macOS. Release Desktop run `33075519884`
  passed Windows packaging, macOS x64/arm64 packaging, the 12-asset inventory
  gate, and prerelease publication.
- The public release contains 12 uploaded assets with GitHub SHA-256 digests.
  The Windows installer is 185,956,016 bytes with SHA-256
  `a7b64d0a9ff0b1a37d5db970e4525b3fea765ae34b0e31ef5e0895512c8f291f`.
- The public installer was downloaded to drive F, matched the GitHub digest,
  and installed with exit code 0 at `F:\IzziAI\Izzi\Izzi AI.exe`.
- The installed executable reports FileVersion `1.14.0-beta.59`. Playwright
  opened the retained `%APPDATA%\@openclaw\desktop` profile, navigated to
  `AI Marketing -> Kênh -> Trung tâm kết nối`, observed no page or console
  errors, and measured no horizontal overflow at 1280x800.
- The retained profile stayed at 3,489 files across the install and smoke; its
  byte count changed by only 19 bytes of runtime state. No onboarding reset or
  external provider action occurred.
- Installed smoke screenshot:
  `F:\Ai Tools\Codex\Temp\izzi-ai-v1.14.0-beta.59-installed-marketing-channels.png`.
