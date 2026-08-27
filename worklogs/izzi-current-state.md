# Izzi AI current state

Timestamp: 2026-08-28 04:29 ICT

## Canonical product

- Repository: `kentzu213/izzi-ai`
- Branch: `main`
- Released desktop: `v1.14.0-beta.63`
- Released desktop merge commit: `2930169bf77a425d5e630e5aebbd25302dc999c6`
- Released product merge commit: `78f133a24ffbe587faa46e4b230a9ca34627e6d0`
- Production backend commit: `7c8821bd11f95433d170d8e25ffdd4a1edc676c9`
- Installed Windows app: `F:\IzziAI\Izzi\Izzi AI.exe`
- Stable profile: `%APPDATA%\@openclaw\desktop`
- Windows installer remains unsigned because a signing certificate is not configured.

## Goal state

- MKT-01 Channel connection center: complete.
- MKT-02 Integration authority and provider routes: complete.
- MKT-03 Live model execution: complete.
- MKT-04 through MKT-07: pending in the dependency order in `MASTER_PLAN.md`.
- Video work is outside the active scope. Technical Marketing Room work has priority.

## Released baseline

- Beta.57 shipped the bounded native Auto Post manifest import. Beta.58 narrowed
  optional Native Marketing connection errors. Beta.59 added scoped provider
  grants. Beta.60 added backend-owned account readiness and corrected workspace
  activation.
- Beta.61 restores Provider Vault through the Native Marketing workspace
  authority without moving resource, workflow, or canary-send execution off the
  fail-closed legacy bridge. Beta.62 adds the authenticated, fail-closed
  provider-route manifest and its bounded readiness UI. Beta.63 adds the
  staging-only, approval-gated `gpt-5.6-sol` model draft with bounded cost and
  provenance evidence.
- Release Desktop workflow
  [33117009878](https://github.com/kentzu213/izzi-ai/actions/runs/33117009878)
  completed successfully and published 12 assets; evidence:
  `gh release view v1.14.0-beta.63 --repo kentzu213/izzi-ai`.

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

## NM-016 Model-backed draft

- The model-backed path is enabled only by the existing Customer Marketing
  staging profile. Normal agent chat still uses the `izzi-smart` route.
- The Marketing Director requests `gpt-5.6-sol` with high reasoning and no
  tools. One workspace credit is reserved before the call; a single ambiguous
  network retry reuses the exact payload and main-owned idempotency key.
- Exact draft JSON, requested/served model identity, usage totals, and evidence
  hashes are required. Any malformed output, missing provenance, route drift,
  or Brand Guardian rejection blocks the run while approval remains pending.
- Product PR [#16](https://github.com/kentzu213/izzi-ai/pull/16) and release PR
  [#17](https://github.com/kentzu213/izzi-ai/pull/17) passed Windows and macOS
  CI. Full implementation and release evidence is in
  `worklogs/2026-08-28-nm-016-model-backed-draft.md`.

## Verification evidence

- Desktop PR [#16](https://github.com/kentzu213/izzi-ai/pull/16) passed Windows
  and macOS CI in workflow
  [33116402078](https://github.com/kentzu213/izzi-ai/actions/runs/33116402078).
  Local verification passed lint, build, the 12-check staging launcher, and all
  1,730 desktop tests across 126 files; commands and receipts are recorded in
  `worklogs/2026-08-28-nm-016-model-backed-draft.md`.
- `pnpm audit --prod --audit-level high` reported no known vulnerabilities,
  while the added-line credential-pattern scan reported zero matches. GitNexus
  classified the aggregate chat/approval diff as critical, so the full suite,
  release CI, live canary, and packaged canary were all retained as gates.
- Backend PR [#25](https://github.com/kentzu213/izzi-backend/pull/25) passed CI,
  1,555 backend tests with 93 skipped, and a clean production dependency audit.

## Release and installed smoke

- Public prerelease:
  `https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.63`.
- Windows installer SHA-256:
  `b6c9ef3968f25b1b473dcd82708da012487c1cc3c84ff69af0f005e4ea49e0db`,
  verified by `Get-FileHash` against the GitHub asset digest.
- Windows registry and the in-app updater report `1.14.0-beta.63`; updater state
  is `idle` with no available newer version.
- Installed smoke through
  `F:\Ai Tools\Codex\Temp\izzi-ai-beta63-installed-smoke.cjs` retained
  authentication, found Native Marketing connected, and validated the provider
  route contract without invoking OAuth or a provider action.
- The smoke returned 7 providers, 4 route resources, 0 connected providers,
  `liveReady=false`, `externalExecution=blocked`, and
  `externalActionPerformed=false`; it found zero request, console, page, or
  horizontal-overflow errors at 1280x900 and 390x844.
- Screenshots:
  `F:\Ai Tools\Codex\Temp\izzi-ai-beta63-mkt03-desktop.png`
  and `F:\Ai Tools\Codex\Temp\izzi-ai-beta63-mkt03-compact.png`.
- The packaged model canary receipt at
  `F:\Ai Tools\Codex\Temp\mkt03-installed-canary-beta63-20260828-042806.json`
  records one quota reservation, one Sol-high call, pending approval, zero
  external marketing actions, and successful temporary-key revocation.

## Operating mode

- `relaxed_mode` remains active from the user's authorization because Claude
  usage is exhausted.
- Claude and ChatGPT web were not used for this continuation.
- Codex remains implementation owner, verifier, integrator, and reporter.

## Next action

Start MKT-04 by composing the existing model, approval, provider-route, billing,
recovery, and renderer checks into one deterministic packaged-staging safety
suite. External provider execution remains disabled.
