# Izzi AI current state

Timestamp: 2026-08-28 00:20 ICT

## Canonical product

- Repository: `kentzu213/izzi-ai`
- Branch: `main`
- Released desktop: `v1.14.0-beta.60`
- Released desktop commit: `81086103eec446bc6672549ba6f99684d49d81ee`
- Production backend commit: `f6cb454c7c8e34650807153ce828bcb155bf310f`
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
- Beta.59 added scoped provider grants. Beta.60 added backend-owned account
  readiness and corrected the workspace activation contract.
- Every product release through beta.60 passed Windows and macOS CI and
  published a complete 12-asset inventory.

## Released NM-011 provider grant v2

Released version: `1.14.0-beta.59`.

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

## NM-012 production account readiness

- Desktop account health now uses the backend OAuth authority and returns only
  renderer-safe readiness summaries. Workspace activation sends the supported
  `name` and optional `operatingMode` fields and validates names at 2-100
  characters.
- The 17-file Marketing migration bundle was applied atomically in production.
  Postflight confirms the schema is ready, prior row counts are unchanged, and
  no existing catalog data was lost.
- The first real app request exposed a missing VPS
  `SUPABASE_PUBLISHABLE_KEY`. The public key was added securely to the runtime
  environment, a dated backup was retained, and no secret value was written to
  the repository or worklogs.
- Backend live, ready, and version checks pass after restoring the reviewed
  `f6cb454` image. Publishing, scheduling, spend, customer import, bulk send,
  and provider OAuth actions remain disabled.

## Verification evidence

- Full backend suite: 1546 passed, 93 skipped. Production security audit: 0
  findings.
- Production migration: 17/17 applied atomically; postflight schema and data
  preservation checks passed. Receipt:
  `F:\Ai Tools\Codex\Temp\izzi-marketing-production-cutover-f6cb454-receipt.json`.
- Full desktop suite: 1704/1704. Lint, main and renderer type checks, full
  workspace build, release contracts, renderer budget, and signing policy all
  passed.
- Production dependency audit: 0 known vulnerabilities.
- No external provider action was performed and spend remained `0 VND`.

## Release and installed smoke

- Desktop CI passed on Windows and macOS. Release Desktop run `33096486915`
  published all 12 required assets at `v1.14.0-beta.60`.
- Public Windows installer: 185,958,122 bytes, SHA-256
  `d7c5fb7ea5ed75ca0b77fbe6ccb5da5afb472f7ad5f2877359bda9b6dd3e2803`.
- The installer completed with exit code 0. The executable and Windows registry
  report `1.14.0-beta.60`; manual updater check returns `idle` at the current
  version.
- The retained profile stayed at 3,493 files, and database, Preferences, and
  Local State hashes were unchanged across installation.
- The authenticated smoke found exactly one `Izzi Marketing` Owner/Pro
  workspace with zero credits used. Account health returned
  `authority=backend_oauth`, `externalActionPerformed=false`, and no connected
  accounts. No OAuth control was clicked.
- No horizontal overflow, header collision, or tab clipping was observed at
  1280x800 or 1024x720. Screenshots:
  `F:\Ai Tools\Codex\Temp\izzi-ai-v1.14.0-beta.60-installed-marketing-channels.png`
  and
  `F:\Ai Tools\Codex\Temp\izzi-ai-v1.14.0-beta.60-installed-marketing-compact.png`.

## Operating mode

- `relaxed_mode` is active from the user's exact authorization
  `cho phép nới rule`.
- Claude was not used because its usage is exhausted.
- ChatGPT web was not requested or used.
- Codex remains implementation owner, verifier, integrator, and reporter.

## Next action

Add a deployment preflight guard for the required Supabase publishable key,
then continue MKT-02 with the smallest authenticated backend provider-route
contract. Keep publish, schedule, spend, bulk send, customer import, and
external provider actions disabled.
