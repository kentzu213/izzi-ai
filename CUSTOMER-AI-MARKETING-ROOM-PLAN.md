# Customer AI Marketing Room Plan

Product status: in_progress (78% weighted delivery scope; 97% local product scope; source:
`CUSTOMER-AI-MARKETING-ROOM-PLAN.md` weighted rubric and verified checklist)
Vertical slice status: verified_local_packaged_seven_day_workflow
Backend foundation status: verified_local_not_deployed
Quality gate status: verified_workspace_eslint9_dependency_audit_and_renderer_budget
Last verified: 2026-08-12 ICT. Beta34 is public, installed, and smoke-tested. The tenant-safe backend, rate limit, two-device profile sync, capability registry, quota reconciliation, aggregate real-billing-ledger reconciliation, backend-owned seven-day workflow API, desktop bridge, CMR-115 retry recovery, CMR-116 server-derived per-run billing linkage, and CMR-117 hard plan entitlement are public. No remote migration or deployment occurred. Video/F5 work is deferred by user decision; the active scope is technical Marketing Room reliability and remote staging readiness.
Scope: first production-shaped customer slice on the existing Starizzi / IzziAPI core.

The weighted delivery score is intentionally not a raw checkbox count. The
source rubric is this plan, `CUSTOMER-AI-MARKETING-ROOM-PLAN.md`: 20% complete
foundation/auth/tenant guardrails, 20% complete customer UX/context/approvals,
16% of the 20% local content/media allocation, 15% of the 20%
backend-sync/billing allocation, and 7% of the 20%
integrations/staging/production-E2E allocation: 78% total.

## Product boundary

- Internal `Phòng Marketing` remains on its existing `marketing` route.
- Customer AI Marketing uses the separate `customer-marketing` route and customer-facing language.
- Tenant identity is resolved only in the Electron main process from the authenticated user.
- Customer records use authenticated-user-derived, hashed keys in the existing SQLite settings store.
- The renderer never submits tenant IDs, API keys, integration tokens, system prompts, or filesystem paths.
- Approval changes workflow state only. Publish, spend, bulk email, destructive actions, and integration mutation remain unavailable.

## Verified vertical slice

1. [x] Audit internal Marketing Room, auth, SQLite, IPC, agent runtime, extension runtime, and navigation.
2. [x] Define the customer product boundary and acceptance criteria.
3. [x] Add a tenant-scoped customer marketing store:
   - onboarding profile
   - customer runs and stages
   - approval records
   - credit/quota projection
4. [x] Add typed customer IPC:
   - get snapshot
   - save onboarding
   - create goal
   - ask AI Marketing Director through the existing `IzziAgent`
   - review approval
5. [x] Add a customer-safe capability catalog from core configuration plus active extension runtime metadata.
6. [x] Add a separate Customer AI Marketing Room route, desktop navigation, and mobile quick navigation.
7. [x] Implement seven-step onboarding and task-first views:
   - outcome-first Home
   - AI Marketing Director
   - Goals and workflow progress
   - Approval inbox
   - AI Team
   - dynamic Apps catalog
   - Brand Center
8. [x] Add focused service tests for tenant isolation, permission, approval, AI failure, and extension filtering.
9. [x] Run renderer typecheck, production build, focused tests, and internal Marketing Room regression.
10. [x] Complete the real IzziAPI onboarding in the authenticated customer workspace.
11. [x] Verify desktop `1440x900` and mobile `390x844` layouts with no horizontal overflow or page error.
12. [x] Pin CodeGraph MCP to the Starizzi path with `--no-watch`; verify MCP queries and CLI fallback against the same graph.
13. [x] Pin HyperFrames `0.7.57` inside Starizzi and verify Node/FFmpeg/FFprobe runtime readiness.
14. [x] Add a tenant-scoped Video Studio with safe directory import, file-budget checks, secret/symlink rejection, and whole-project SHA-256 evidence.
15. [x] Import the real `izziapi-starizzi-howto` project through the native directory picker and create a pending local-preview approval.
16. [x] Connect the existing local F5-TTS installation as a main-process-only runtime configuration; no local path is exposed to the renderer.
17. [x] Verify the F5 source commit, CUDA environment, and 5.4 GB model SHA-256; detect the live loopback service at `127.0.0.1:7861`.
18. [x] Keep commercial render fail-closed because the current ViVoice checkpoint is `CC-BY-NC-SA-4.0` and the imported project has no consent artifact.
19. [x] Add a local production-shaped IzziAPI backend schema for workspaces, memberships, invitations, quotas, and usage events with RLS enabled.
20. [x] Add JWT-authenticated workspace create/list/get, invitation acceptance, and idempotent quota reservation routes; actor, owner, billing identity, and plan are server-derived.
21. [x] Connect Starizzi to the authenticated remote workspace through a main-process-only client and synchronize workspace ID, role, plan, and quota.
22. [x] Reserve one authoritative credit before an AI Marketing Director model call, use `director:<runId>` idempotency, and fail closed when the enabled backend cannot confirm permission or quota.
23. [x] Restore CodeGraph and GitNexus direct MCP health; keep shell and direct-index fallbacks available when semantic FTS is unavailable.
24. [x] Rename the product and canonical repository to Izzi AI, publish Windows
    `v1.14.0-beta.4`, and verify the installed title, shortcuts, profile continuity, and official
    cyan `S` icon.
25. [x] Add CMR-218 Product Marketing Context v1:
    - reviewer identity and SHA-256 evidence are derived in the main process
    - VI/EN positioning, audience, value proposition, brand voice, CTA, proof claims, prohibited
      claims, and HTTPS evidence sources are revisioned together
    - workflows, jobs, artifacts, approvals, and AI Director prompts bind to one structural
      context reference
    - AI Director product claims require an approved proof-claim ID before replacing approval
      evidence
    - stale strategy approvals remain pending after a context revision changes
    - Brand Center preserves drafts across workspace navigation and provides explicit
      revision-conflict recovery
26. [x] Add tenant-safe Voice Studio previews to the customer Video Studio:
    - renderer submits only the media job ID
    - main process verifies workspace, role, Pro entitlement, current digest, and approval
    - only approved captions and the fixed `pham-tuyen` voice reach the local runtime
    - persisted WAV clips must be PCM16 mono at 48 kHz and remain size bounded
    - receipts expose provider, voice, clip count, bytes, and the commercial lock; associated
      artifact records expose file names, byte counts, and SHA-256 evidence
    - publish, spend, reference-audio cloning, and commercial render remain unavailable
27. [x] Add verified local video previews to the customer Video Studio:
    - renderer submits only the approved media job ID
    - main process revalidates tenant, role, entitlement, digest, approval, path, and runtime
    - packaged HyperFrames renders the approved vertical scene sequence
    - FFmpeg muxes approved Voice Studio WAVs into a local H.264/AAC MP4
    - persisted receipts and artifacts bind dimensions, duration, audio format, bytes, and SHA-256
    - `Mo video` opens only an MP4 whose on-disk size and hash still match the artifact
    - commercial render, direct F5 generation, publish, spend, and external actions remain locked
28. [x] Close the renderer performance slice and publish beta30:
    - keep authentication and Chat in the initial renderer and lazy-load 17 secondary workspaces
    - reduce the entry JavaScript from 1,018,843 bytes to 355,260 bytes
    - enforce a 400,000-byte entry budget and 500,000-byte per-chunk ceiling in CI and release
    - preload the primary AI Marketing workspace after Chat becomes interactive
    - keep shared mobile navigation CSS eager and cover the regression with contract tests
    - verify the installed beta30 Chat-to-AI-Marketing flow without publishing or spending
29. [x] Remove optional media probes from the initial AI Marketing render path:
    - return a payload-free, fail-closed initial snapshot within a 250 ms media budget
    - refresh optional toolchain readiness in the background without stale snapshot overwrite
    - deduplicate concurrent toolchain probes in the Electron main process
    - verify 890 ms warm and 1,826 ms immediate fresh-process dashboard rendering
    - verify desktop and mobile layouts with no horizontal overflow, console error, or page error
30. [x] Public the tenant-safe Customer Marketing backend foundation on `izzi-backend/master`:
    - JWT-derived actors and request-scoped Supabase clients keep `auth.uid()` and RLS authoritative
    - onboarding profiles synchronize with integer revisions and stable conflict recovery
    - campaign, content, asset, knowledge, calendar, analytics, invitation, quota, and member APIs
      remain tenant-scoped and fail closed
    - PostgreSQL 16, pinned PostgREST, packaged beta31, Docker image, audit, and offline staging
      gates pass without changing remote state
31. [x] Harden authenticated Customer Marketing routes against request floods:
    - derive the rate-limit key only from the Supabase-validated actor
    - enforce 300 requests per minute through Redis when available
    - keep a bounded 10,000-actor local fallback when Redis is absent or unavailable
    - return stable 429, `Retry-After`, `X-RateLimit-*`, and `Cache-Control: no-store` before
      service dispatch across workspace and nested resource routes
32. [x] Prove packaged two-device profile synchronization against isolated local staging:
    - run two beta31 Electron sessions with separate `APPDATA`, `LOCALAPPDATA`, temp, user-data,
      process, and CDP state
    - synchronize device A revision 1 to device B, then device B revision 2 back to device A
    - race two authenticated updates at one revision and require exactly one 200 plus one
      `409 profile_conflict`
    - reload the winner revision and retry the losing profile successfully to revision 4
    - retain the existing single-device campaign/content/workflow regression with no runtime or
      external-action error
33. [x] Add an aggregate quota-reconciliation receipt for billing integrity:
    - aggregate all four usage metrics inside the active quota cycle
    - allow only owner/manager and bind the SQL actor to `auth.uid()`
    - return only counters, ledger totals, event count, consistency, and discrepancy metric names
    - detect intentional counter drift without exposing actor IDs, idempotency keys, or metadata
    - bind the fourth migration to the staging digest contract and verify it through packaged beta31
34. [x] Reconcile the workspace billing owner against the real aggregate billing ledger:
    - calculate expected balance from completed deposits, bonuses, affiliate credit conversions,
      and negative usage transactions with a 0.01 tolerance
    - aggregate current-cycle `usage_logs` cost and grace-period counts separately from Marketing
      quota units
    - keep owner/manager authorization bound to `auth.uid()` and expose no billing user, transaction,
      reference, description, endpoint, or source-platform identity
    - report quota-to-billing linkage as `unavailable` until a server-derived run ID exists
    - bind the fifth migration to the staging digest contract and verify it through packaged beta31
35. [x] Publish a backend-owned, resumable seven-day workflow API:
    - create one tenant-scoped campaign and seven daily content drafts through five ordered steps
    - bind capability identities to AI Marketing Director, Strategy, Content Studio, Brand Guardian,
      and Approval Center
    - charge one automation run and seven content items, with free-plan denial and idempotent start
    - stop at Brand Guardian review for one explicit customer approval
    - expose no publish, send, spend, bulk, service-role, actor, billing, or raw workflow-table path
    - bind the sixth migration to the staging digest contract and verify it through installed beta32
36. [x] Connect the installed Izzi AI Customer Marketing flow to the backend workflow API:
    - start and resume the backend run through the existing goal/approval IPC boundary
    - mirror the backend UUID into durable local workflow state
    - confirm backend approval before completing local approval, with conflict-safe retry checks
    - fail closed on quota, permission, malformed response, route, and network errors
    - publish beta32 and verify the real packaged executable against disposable local staging
37. [x] Add server-derived per-run Marketing billing provenance:
    - bind every quota usage event to the workspace billing owner inside PostgreSQL
    - derive a stable reference from workspace UUID and the existing idempotency key
    - backfill existing events before making both linkage fields required
    - expose only aggregate linked/unlinked counts to active owner/manager members
    - keep authenticated users off the raw table and preserve `auth.uid()` authorization
    - add no deduction, transaction, publish, spend, send, bulk, or production deployment action
38. [x] Close hard plan entitlement through the public desktop release:
    - authorize all 14 Marketing capabilities from the canonical database plan and active role
    - require a capability identity for quota reservations and bind idempotency to the complete request
    - enforce resource and seven-day workflow mutation authorization inside the database transaction
    - fail the AI Marketing Director closed unless IzziAPI returns an authoritative reservation
    - publish, install, and smoke-test beta34 against isolated local staging before any remote cutover
39. [x] Start independent Customer Marketing profile and capability reads concurrently:
    - keep workspace identity resolution first and derive both reads from the confirmed workspace ID
    - preserve unavailable/forbidden fail-closed mapping and all tenant/auth boundaries
    - prove both read-only requests start before either one completes
    - keep media readiness on its existing bounded initial-snapshot path

## Verification evidence

- Customer Marketing and Video Studio: 25 focused tests passed across three files.
- Internal Marketing Room regression: 6 tests passed.
- Renderer TypeScript: passed.
- Main TypeScript and Vite production build: passed.
- Electron customer workspace: IzziAPI onboarding persisted, project imported, two approvals pending, and no renderer path leak.
- F5 runtime: source commit `e74db9d5`, model SHA-256 `5ae8293d...82ea1f`, Torch `2.4.1+cu124`, CUDA available, local UI HTTP 200.
- Responsive QA: desktop and mobile passed after import; mobile canvas width is 390px, no horizontal overflow, and final approval controls remain reachable.
- Runtime QA: zero route-specific console or page errors. Existing Chat nested-button warning and unrelated budget/integration startup errors remain outside this route.
- CodeGraph: MCP query succeeds with the Starizzi project pinned; forced manual re-index reports `0` pending changes because watch mode is disabled.
- Latest backend verification before the current role-administration wave: 757 tests passed, 16 skipped; build and secretlint passed.
- Role-administration wave close-out: 673 desktop tests passed across 48 executed files; Customer Marketing plus shared contracts 387 passed; Internal Marketing Room regression 6 passed. 16 files were not executed because the runner used lacks `axios`, `fast-check`, `zustand`, `electron-updater`, a JSX transform, or module-registry mocking; none of them import Customer Marketing code.
- Invitation-coordinator hardening: a pending deep-link token is now cleared on sign-out and expires after ten minutes, and a duplicated authenticated deep link is accepted only once. Both defects were reproduced by new tests before the fix; the coordinator suite is now 16 tests.
- Blast radius of the coordinator change is `apps/desktop/src/main/index.ts` only: three sign-in paths, the OAuth callback, the deep-link handler, and one added `auth:logout` call. No public signature changed.
- Latest Starizzi verification before the current role-administration wave: 450 tests passed; main/renderer production build passed.
- Customer runtime smoke passed with no route overflow or error; Internal Marketing Room smoke passed 12/12.
- GitNexus dependency-cycle check reported 0 cycles. Direct context, impact, and change-detection MCP calls are healthy; optional FTS repair is unavailable on this machine.
- Branding release `v1.14.0-beta.4`: clean release worktree, branding tests 3/3, full desktop
  tests 904/904, production build and NSIS package passed. Installed executable metadata is
  `Izzi AI` / `1.14.0-beta.4`; installed and packaged executable hashes match; executable icon
  comparison is `0/1024` pixels different from the source asset.
- Repository and updater artifacts now use `kentzu213/izzi-ai`. The installed app has one uninstall
  entry and retains `%APPDATA%\@openclaw` unchanged across the final install.
- Release-session GitNexus note: the MCP transport closed and the clean release worktree had no
  local CLI index. Prior branding impact evidence remained `LOW` with zero affected flows; shell
  diff, tests, production build, and artifact verification were used as the release fallback.
- CMR-218 clean release verification: focused Product Context/service/workflow/IPC/UI contract
  tests **197/197**, full desktop regression **931/931**, main TypeScript typecheck, and production
  Vite build passed. External actions remain disabled and confirmed spend is **0 VND**.
- Beta24 runtime close-out: the public VieNeu image, installed Voice Studio 0.2.0, real updater
  download from beta23, extension-client TTS, reference-audio rejection, and desktop/mobile
  overflow checks are recorded in `docs/DESKTOP-BETA24-VOICE-STUDIO-EVIDENCE.md`.
- Beta25 Voice Preview close-out: full desktop regression passed 1,219 tests across 86 files;
  main and renderer typechecks plus the five-project production build passed. The public Windows
  installer was installed and created eight validated PCM16 mono 48 kHz WAV clips totaling
  3,241,312 bytes. Installed desktop/mobile smoke, updater `idle / 1.14.0-beta.25`, hashes, and
  remaining commercial gates are recorded in `docs/DESKTOP-BETA25-VOICE-PREVIEW-EVIDENCE.md`.
- Beta26 Local Video Preview close-out: full desktop regression passed 1,251 tests across 86
  files; main TypeScript, five-workspace production build, Windows packaging, Socrates tests,
  and production audit passed. The public installer is installed and produced a verified
  H.264/AAC 1080 x 1920 MP4 with Voice Studio audio. Installed desktop/mobile smoke, updater
  `idle / 1.14.0-beta.26`, hashes, focus states, and remaining commercial gates are recorded in
  `docs/DESKTOP-BETA26-LOCAL-VIDEO-PREVIEW-EVIDENCE.md`.
- CMR-404 lint continuation: `pnpm lint` checks 310 workspace source/config files with zero
  reported errors or warnings; `pnpm test:lint-config` passes 4/4 and proves a new unused variable
  still fails. CI and release gates now run both commands. Exact dependency, suppression, and
  audit evidence is recorded in `docs/CMR-404-ESLINT9-EVIDENCE.md`.
- Beta30 renderer performance close-out: build transformed 1,140 modules with no chunk-size
  warning; entry JavaScript is 355,260 bytes, the largest lazy chunk is 245,678 bytes, and the
  bundle budget passes 2/2. Desktop regression passed 88 files and 1,265 tests. Desktop CI runs
  `31481534646` and `31481805015` passed Windows/macOS with zero annotations. Release run
  `31482074009` published 12 digest-bearing assets; the Windows installer was hash-verified,
  installed, and opened the authenticated IzziAPI Marketing workspace successfully.
- CMR-111 billing-ledger close-out: the [backend commit](https://github.com/kentzu213/izzi-backend/commit/2a3b18ec96a4af2316490c7a8cda1fea16e2a825) is public on `master`; focused
  tests passed 85/85, the full suite passed 309 tests with 38 environment-dependent skips,
  PostgreSQL passed 22/22, the signed-JWT PostgREST boundary passed all 11 checks, and both
  dependency audits found 0 vulnerabilities. Installed beta31 passed a 209-request packaged
  smoke with billing balance consistent, no runtime error, and no publish, spend, send, or bulk action.
- CMR-112 seven-day workflow close-out: the [backend commit](https://github.com/kentzu213/izzi-backend/commit/e6178bed6144553abcbbb6e90986c78f59907943) is public on `master`; workflow-focused tests passed
  15/15, the full suite passed 324 tests with 40 environment-dependent skips, PostgreSQL passed
  24/24, and the signed-JWT PostgREST boundary passed all 12 checks. The clean six-migration
  offline digest verifier passed. Installed beta31 passed a 209-request packaged smoke with zero
  runtime errors and no publish, spend, send, or bulk action.
- CMR-114 desktop workflow close-out: the [desktop commit](https://github.com/kentzu213/izzi-ai/commit/58076df) and
  [backend route-order fix](https://github.com/kentzu213/izzi-backend/commit/5d35362) are public. Full desktop
  regression passed 1,272/1,272, Customer Marketing passed 565/565, the main typecheck, production build,
  renderer budget 2/2, and audit 0 vulnerabilities passed. Beta32 packaged staging passed 271 requests with
  zero runtime errors: one backend workflow was created, resumed four steps, approved, and mirrored into the
  desktop snapshot; PostgreSQL contained 2 approved campaigns and 8 approved content items, quota/billing
  reconciliation had 9 events and no discrepancies, and no publish, spend, send, or bulk action ran.
- CMR-116 billing-linkage close-out: the [backend commit](https://github.com/kentzu213/izzi-backend/commit/ee81b5376e2d860a485e44ed3bbff69d8d96d336) is public on `master`; focused tests passed 84/84, the full backend suite passed 328 tests with 40 DB-backed skips, PostgreSQL passed 24/24, signed-JWT PostgREST passed 12 checks, the seven-migration staging contract passed 16 checks, and the production dependency audit found 0 vulnerabilities. Installed beta33 passed a 273-request packaged smoke with 9/9 linked usage events, zero runtime errors, consistent quota/billing reconciliation, `policy_denied` publishing, and no publish, spend, send, or bulk action.
- PERF-001 remote-read concurrency slice: the Customer Marketing snapshot starts profile and
  capability reads together after resolving the authoritative workspace. Desktop regression passed
  1,279/1,279, build and lint passed, renderer budget passed 2/2, and the scoped source/script scan
  found no high-confidence secret pattern. Product and version CI passed Windows/macOS; the beta35
  release workflow verified 12 digest-bearing assets and kept the unsigned release as an internal
  draft. Installed-runtime timing remains pending an authorized isolated-user or clean-machine run.

## Next phases

1. [x] Implement the local backend schema, RLS contract, authenticated workspace APIs, invitations, and remote workspace/quota synchronization.
2. [x] Complete server-authoritative member listing and role administration; the local implementation is verified and not deployed.
3. [ ] Complete remote cross-device proof for onboarding and customer profile synchronization.
   The revision/conflict backend contract and packaged two-device local staging harness are public
   on `izzi-backend/master` at `41b45c6`; this item remains open until two devices use an isolated
   deployed staging project successfully.
4. [x] Prove RLS and tenant isolation against an ephemeral local Postgres instance using two signed
   authenticated users (`24/24` SQL checks and `12/12` PostgREST boundary checks). Remote staging
   verification remains covered by the deployment gate below.
5. [x] Productize hard plan entitlement enforcement across every Marketing capability. The backend implementation is public at `4b71c14`; desktop beta34 is public, installed, and passed packaged staging with an end-to-end authoritative capability reservation. Migration 8 remains undeployed remotely.
6. [x] Productize skill/tool registry metadata, permissions, stability labels, credit estimates, and server-side plan filtering. Registry revision 3 is actor-scoped, plan/role filtered, public-field allowlisted, and covered by `20/20` focused tests.
7. [x] Add one backend-owned, resumable seven-day content workflow with registry capability
   identities, tenant-scoped artifacts, Brand Guardian review, and customer approval; no external
   publish action. The API and database contract are public; generated drafts remain deterministic
   templates until the desktop/model execution slice is connected.
8. [x] Make desktop workflow creation restart-safe after a network interruption. Persist a
   bounded, tenant-local retry marker with a payload fingerprint and 24-hour TTL, reuse the
   same backend idempotency key on retry, and clear it only after local durable workflow
   persistence succeeds. See `docs/CMR-115-WORKFLOW-RECOVERY-EVIDENCE.md`.
9. [ ] Enable the reviewed remote migration for the installed Izzi AI workflow UI and model/agent
   execution, then add approved social, SEO, email/CRM, and analytics workflows; the desktop bridge
   and local packaged staging proof are complete. Voice Studio local preview
   and HyperFrames plus Voice Studio local MP4 generation are verified, while direct F5
   generation, commercial rendering, and every external publish action remain gated.
10. [ ] Add integration token vaulting, scoped grants, revocation, audit records, and real campaign/content/assets/knowledge routes.
11. [ ] Add end-to-end tests for publish gates, spend gates, integrations, billing, recovery, console/network health, and Internal Marketing Room regression.
12. [ ] Deploy a staging environment, complete security review, and obtain reviewer approval.
13. [x] Finish the production Voice Studio image and managed runtime: resolve the `perth`
    dependency, preserve Docker connection variables, rebuild, publish, and run end-to-end TTS
    smoke tests.
14. [ ] Restore persistent GitNexus MCP connectivity and index the active Voice worktree while
    retaining shell/CLI fallback.
15. [x] Establish a workspace-wide ESLint 9 flat-config gate, bounded migration suppressions,
    deterministic contract tests, and CI/release enforcement.
16. [x] Reduce authenticated Customer Marketing workspace first-open latency; precise beta31
    production-renderer smoke measured 890 ms after Chat settled and 1,826 ms for immediate
    fresh-process navigation, with optional media readiness refreshed in the background.

## Explicitly not claimed complete

- Production deployment of the local multi-tenant backend migration, RLS policies, or feature gate.
- Production deployment of team invitations, server-authoritative roles, and member role administration; the local implementation is complete and verified against a mocked backend, but no deployed IzziAPI instance has served these routes.
- Remote cross-device onboarding, run, approval, media job, and artifact persistence. Local
  packaged cross-device customer-profile synchronization is verified through revision 4.
- Production hard plan entitlement enforcement and deployed billing authority. Aggregate real-ledger
  reconciliation and per-run provenance are verified locally, but no remote migration is claimed.
- Installed Izzi AI UI and live model/agent execution for the public seven-day workflow API; the
  desktop bridge is verified against local staging, but the production remote flag remains disabled;
  the current backend creates deterministic campaign/content drafts and stops for approval.
- Fully wired publishing, ads, email, CRM, commercial rendering, or direct F5-TTS generation.
- A commercially enabled advertising render on the installed app. The audited VieNeu chain is
  available, but the runtime gate remains closed until its operator license evidence is configured.
- A recorded consent artifact bound to the reference voice used by a media job.
- A complete end-to-end marketing campaign with external actions.
- Staging URL, release branch, or deployment approval.
- Windows Authenticode signing and SmartScreen reputation; beta31 remains unsigned even though its
  installer SHA-256 matches the digest published by the verified GitHub release workflow.
