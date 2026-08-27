# Izzi AI current state

Timestamp: 2026-08-28 02:59 ICT

## Canonical product

- Repository: `kentzu213/izzi-ai`
- Branch: `main`
- Released desktop: `v1.14.0-beta.62`
- Released desktop merge commit: `7a890e5a056928092227d709cd748f048c1a765d`
- Released product merge commit: `80461dfc1ebedbc919c3841de5f12c75d933a856`
- Production backend commit: `7c8821bd11f95433d170d8e25ffdd4a1edc676c9`
- Installed Windows app: `F:\IzziAI\Izzi\Izzi AI.exe`
- Stable profile: `%APPDATA%\@openclaw\desktop`
- Windows installer remains unsigned because a signing certificate is not configured.

## Goal state

- MKT-01 Channel connection center: complete.
- MKT-02 Integration authority and provider routes: complete.
- MKT-03 through MKT-07: pending in the dependency order in `MASTER_PLAN.md`.
- Video work is outside the active scope. Technical Marketing Room work has priority.

## Released baseline

- Beta.57 shipped the bounded native Auto Post manifest import. Beta.58 narrowed
  optional Native Marketing connection errors. Beta.59 added scoped provider
  grants. Beta.60 added backend-owned account readiness and corrected workspace
  activation.
- Beta.61 restores Provider Vault through the Native Marketing workspace
  authority without moving resource, workflow, or canary-send execution off the
  fail-closed legacy bridge. Beta.62 adds the authenticated, fail-closed
  provider-route manifest and its bounded readiness UI.
- Release Desktop workflow `33109842909` completed successfully and published
  12 assets; evidence: `gh release view v1.14.0-beta.62 --repo kentzu213/izzi-ai`.

## Production backend

- Backend PR [#25](https://github.com/kentzu213/izzi-backend/pull/25)
  merged and deployed the provider-route contract at
  `7c8821bd11f95433d170d8e25ffdd4a1edc676c9` while preserving the fail-closed
  Supabase public-key deployment preflight from PR #24.
- `GET /api/marketing/provider-routes` is authenticated and workspace-bound. It
  allows only `read`, `draft`, and `validate`, reports
  `externalExecution=blocked`, and exposes no provider executor or token.
- Public `Invoke-WebRequest` probes to `https://api.izziapi.com/healthz/live`,
  `/healthz/ready`, and `/version` returned HTTP 200 and the exact production SHA
  `7c8821bd11f95433d170d8e25ffdd4a1edc676c9`.

## NM-014 Provider Vault native authority

- Provider Vault resolves the uniquely bound Native Marketing workspace and
  uses that authority for credential summaries, operation summaries, health,
  revoke, canary readiness, and Telegram sandbox configuration.
- Multiple available workspaces without an unambiguous binding fail closed.
  Read-only authority resolution does not overwrite the Customer Marketing
  workspace record.
- Resource, workflow, canary-send, OAuth, publish, schedule, spend, customer
  import, bulk send, and every external provider action remain outside this
  authority slice.
- Implementation evidence is in
  `worklogs/2026-08-28-nm-014-provider-vault-native-authority.md`.

## NM-015 Provider routes

- The desktop main process parses `marketing-provider-routes.v1` fail-closed,
  revalidates the exact allowed/denied operation arrays, route IDs, provider
  ordering, adapter states, connection counts, tenant binding, and the blocked
  external-execution policy.
- IPC/preload expose no token, provider payload, local path, URL, or executor.
  The renderer displays 7/7 workflow readiness, the three allowed internal
  operations, four internal resources, and the external-action lock.
- Implementation and release evidence is in
  `worklogs/2026-08-28-nm-015-provider-routes.md`.

## Verification evidence

- Desktop PR [#13](https://github.com/kentzu213/izzi-ai/pull/13) passed Windows
  and macOS CI. Local verification passed lint, build, 27 focused contract tests,
  and all 1,723 desktop tests across 126 files.
- Production dependency audit and scoped credential-pattern scan each reported
  zero findings. GitNexus reviewed the cross-module IPC/UI change before commit.
- Backend PR [#25](https://github.com/kentzu213/izzi-backend/pull/25) passed CI,
  1,555 backend tests with 93 skipped, and a clean production dependency audit.

## Release and installed smoke

- Public prerelease:
  `https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.62`.
- Windows installer SHA-256:
  `24c58445bd4b0188b796c4bcbb10c442129fc16dfa7ee055aa7da2399d18f1b5`.
- Windows registry and the in-app updater report `1.14.0-beta.62`; updater state
  is `idle` with no available newer version.
- Installed smoke through
  `F:\Ai Tools\Codex\Temp\nm-015-installed-app-smoke.cjs` retained
  authentication, found Native Marketing connected, and validated the provider
  route contract without invoking OAuth or a provider action.
- The smoke returned 7 providers, 4 route resources, 0 connected providers,
  `liveReady=false`, `externalExecution=blocked`, and
  `externalActionPerformed=false`; it found zero request, console, page, or
  horizontal-overflow errors at 1280x900 and 390x844.
- Screenshots:
  `F:\Ai Tools\Codex\Temp\izzi-ai-beta62-nm015-provider-routes-desktop.png`
  and `F:\Ai Tools\Codex\Temp\izzi-ai-beta62-nm015-provider-routes-compact.png`.

## Operating mode

- `relaxed_mode` remains active from the user's authorization because Claude
  usage is exhausted.
- Claude and ChatGPT web were not used for this continuation.
- Codex remains implementation owner, verifier, integrator, and reporter.

## Next action

Start MKT-03 with the smallest approved, budgeted model-backed draft path behind
the existing feature flag. Preserve reviewer approval, tenant scope, retry
idempotency, and the zero-external-action boundary.
