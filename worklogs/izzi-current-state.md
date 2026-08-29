# Izzi AI current state

Timestamp: 2026-08-29 19:43 ICT

## Canonical product

- Repository: `kentzu213/izzi-ai`
- Branch: `main`
- Released desktop: `v1.14.0-beta.64`
- Released desktop merge commit: `315c105b047ed816c1bd91e1bdc386cc09b712c4`
- Released product merge commit: `38e7be0747e04f5aede63e349d47b5f002e3ecb2`
- Production backend commit: `7c8821bd11f95433d170d8e25ffdd4a1edc676c9`
- Installed Windows app: `F:\IzziAI\Izzi\Izzi AI.exe`
- Stable profile: `%APPDATA%\@openclaw\desktop`
- Windows installer remains unsigned because a signing certificate is not configured.

## Goal state

- MKT-01 Channel connection center: complete.
- MKT-02 Integration authority and provider routes: complete.
- MKT-03 Live model execution: complete.
- MKT-04 Packaged end-to-end safety gate suite: complete.
- MKT-05 staging and rollback gates: complete, awaiting Nguyễn Nghĩa's review.
- MKT-06 and MKT-07: not started; dependency order remains enforced in `MASTER_PLAN.md`.
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
  provenance evidence. Beta.64 adds the deterministic core and packaged UI
  safety suite and runs it after Windows packaging and before signing.
- Release Desktop workflow
  [33122607322](https://github.com/kentzu213/izzi-ai/actions/runs/33122607322)
  completed successfully and published 12 assets; evidence:
  `gh release view v1.14.0-beta.64 --repo kentzu213/izzi-ai`.

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

## MKT-04 Packaged safety suite

- Product PR [#19](https://github.com/kentzu213/izzi-ai/pull/19) and release PR
  [#20](https://github.com/kentzu213/izzi-ai/pull/20) shipped the aggregate suite
  as `v1.14.0-beta.64`.
- Core coverage composes action gates, kill switch, spend cap, provider routes,
  workflow recovery, stable retry/idempotency, billing reconciliation, exact
  `gpt-5.6-sol` identity, disabled tools, provenance, and the pending-approval
  stop into one deterministic receipt.
- UI coverage loads the packaged renderer at 1280x900 and 390x844 while
  blocking fetch, HTTP/HTTPS, net, TLS, WebSocket, and renderer requests.
- Follow-up PR [#21](https://github.com/kentzu213/izzi-ai/pull/21) gives only the
  Electron-as-Node core subprocess a repository-bounded module path, clears it
  from the UI subprocess, and makes the runner work against an independently
  installed package. This test-orchestration patch does not change app bytes.
- Full evidence is in
  `worklogs/2026-08-28-mkt-04-packaged-safety-suite.md`.

## MKT-05 Staging readiness

- Backend PR [#27](https://github.com/kentzu213/izzi-backend/pull/27) is merged at
  `08316aaf85a53b5c5d9128558b51d1385cbf9f55`. The staging runtime is healthy at
  `https://marketing-staging.izziapi.com` on the exact candidate image recorded
  in `worklogs/2026-08-29-mkt-05-staging-readiness.md`.
- The forward-only ACL migration revoked direct trigger-function execution from
  all four API-facing roles without changing the historical migration, trigger
  binding, function identity, or existing usage-event count.
- Security Advisor reports zero errors and no trigger ACL finding. The remaining
  23 warnings are documented and do not expand the MKT-05 execution surface.
- The packaged beta.64 staging smoke exposed an optional Video Studio probe that
  could keep `saveOnboarding` pending after the profile API returned HTTP 200.
  The candidate now bounds every snapshot media probe to 250 ms and returns a
  fail-closed unavailable toolchain while the shared probe continues safely.
- The final packaged smoke completed 70 requests and 19 checks with zero runtime
  errors, zero external actions, and cleanup `0/0`. MKT-05 remains
  `awaiting_reviewer`; production and real providers were not touched.

## Verification evidence

- MKT-04 local verification passed all 1,734 desktop tests across 127 files,
  lint, build, the 4-check suite contract, the installed packaged suite, and a
  production dependency audit with no known vulnerability. Added-line
  credential scan returned zero matches.
- Release workflow
  [33122607322](https://github.com/kentzu213/izzi-ai/actions/runs/33122607322)
  passed Windows and macOS jobs. The Windows job ran the packaged safety suite
  after packaging and before signing policy enforcement.
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
  `https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.64`.
- Windows installer SHA-256:
  `214d421493b8f9010d383989ad1b7e85d9f61e5245dd631b335f418e9f647231`,
  verified by `Get-FileHash` against the GitHub asset digest.
- FileVersion and the in-app updater report `1.14.0-beta.64`; updater state
  is `idle` with no available newer version.
- Installed smoke through
  `F:\Ai Tools\Codex\Temp\izzi-ai-beta64-installed-smoke.cjs` retained
  authentication, found Native Marketing connected, and validated the provider
  route contract without invoking OAuth or a provider action.
- The smoke returned 7 providers, 4 route resources, 0 connected providers,
  `liveReady=false`, `externalExecution=blocked`, and
  `externalActionPerformed=false`; it found zero request, console, page, or
  horizontal-overflow errors at 1280x900 and 390x844.
- Screenshots:
  `F:\Ai Tools\Codex\Temp\izzi-ai-beta64-mkt04-desktop.png`
  and `F:\Ai Tools\Codex\Temp\izzi-ai-beta64-mkt04-compact.png`.
- The installed-package safety receipt at
  `F:\Ai Tools\Codex\Temp\izzi-ai-beta64-mkt04-packaged-safety-final\customer-marketing-packaged-safety-receipt.json`
  reports core/UI pass, two viewports, and zero console, load, renderer-process,
  network, secret, or external-action failures.
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

Reviewer Nguyễn Nghĩa reviews the MKT-05 evidence. MKT-06 and MKT-07 remain
blocked on that sign-off. External provider execution remains disabled, and no
production cutover is authorized.
