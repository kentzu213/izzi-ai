# Izzi AI current state

Timestamp: 2026-08-27 19:35 ICT

## Canonical product

- Repository: `kentzu213/izzi-ai`
- Branch: `main`
- Released desktop: `v1.14.0-beta.58`
- Released commit: `df0e120`
- Installed Windows app: `F:\IzziAI\Izzi\Izzi AI.exe`
- Stable profile: `%APPDATA%\@openclaw`
- Windows installer remains unsigned because no signing certificate is configured.

## Goal state

- MKT-01 Channel connection center: complete.
- MKT-02 Integration authority and provider routes: in progress.
- MKT-03 through MKT-07: pending in the dependency order in `MASTER_PLAN.md`.
- Video work is out of the active scope. Technical Marketing Room work has priority.

## Released baseline

- Beta.57 shipped the bounded native Auto Post manifest import: exact-byte
  SHA-256 binding, Owner/Manager authority, one POST maximum, one GET
  reconciliation after an uncertain outcome, strict redacted receipts, and no
  token migration.
- Beta.58 narrowed optional native Marketing connection errors to the existing
  renderer-safe fallback.
- Both releases passed Windows and macOS CI and published a complete 12-asset
  inventory.

## Active NM-011 candidate

Candidate version: `1.14.0-beta.59`.

- Credential envelope v2 binds workspace, provider, permissions, expiry, issue
  time, and a redacted SHA-256 grant digest.
- Permissions are explicit: `validate` and `sandbox_execute`.
- Grant lifetime is capped at 90 days and fails closed at the exact expiry
  boundary.
- Legacy envelopes without a scoped grant are invalid and require reconnect;
  they are never silently promoted.
- Health, revoke, and Telegram canary readiness inherit the grant state without
  reading credential bytes.
- Renderer receives no token, OAuth URL, backend secret, chat id, endpoint, or
  filesystem path.
- Publish, spend, bulk send, and commercial render behavior are unchanged.

## Local evidence

- Focused NM-011 suite: 273/273 pass using the command recorded in
  `worklogs/2026-08-27-nm-011-provider-grant-v2.md`.
- Full desktop suite: 1695/1695 pass in 122 files with
  `pnpm --filter @openclaw/desktop test`.
- Main and renderer TypeScript, workspace lint, production build, and renderer
  budget 2/2 pass using the commands in the NM-011 worklog.
- High-confidence credential pattern scan: 0 hits in desktop source/scripts and
  root tools using the scoped command in the NM-011 worklog.
- Dependency audit: one high advisory in Electron's `extract-zip` devDependency;
  the advisory lists no patched release. The packaged inventory contains 9135
  ASAR entries and 0 `extract-zip` entries.
- Electron directory package starts at FileVersion `1.14.0-beta.59` with the
  retained profile. Playwright smoke passes at 1280x800 and 390x844 with no
  horizontal overflow; keyboard focus reaches a visible button with a 2px
  focus outline.
- No external provider action was performed.

## Operating mode

- `relaxed_mode` is active from the user's exact authorization
  `cho phép nới rule`.
- Claude was not used because its usage is exhausted.
- ChatGPT web was not requested or used.
- Codex remains implementation owner, verifier, integrator, and reporter.

## Next action

Review the exact diff, then commit, push, tag, verify the release assets, install
the public Windows artifact, and exercise the installed Marketing Channels
workflow.
