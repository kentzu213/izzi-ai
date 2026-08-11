# Customer AI Marketing Room Plan

Product status: in_progress (68% weighted delivery scope; 98% local product scope)
Vertical slice status: verified_public_beta31_marketing_snapshot_latency
Backend foundation status: verified_local_not_deployed
Quality gate status: verified_workspace_eslint9_dependency_audit_and_renderer_budget
Last verified: 2026-08-11 ICT. Beta31 is public and installed; its fail-closed initial Marketing snapshot, background readiness refresh, 963 ms installed smoke, release inventory, and security evidence are recorded in `docs/DESKTOP-BETA31-MARKETING-SNAPSHOT-LATENCY-EVIDENCE.md`. Video/F5 work is deferred by user decision; the active scope is technical Marketing Room reliability and staging readiness.
Scope: first production-shaped customer slice on the existing Starizzi / IzziAPI core.

The weighted delivery score is intentionally not a raw checkbox count. The
source rubric is this plan, `CUSTOMER-AI-MARKETING-ROOM-PLAN.md`: 20% complete
foundation/auth/tenant guardrails, 20% complete customer UX/context/approvals,
16% of the 20% local content/media allocation, 7% of the 20%
backend-sync/billing allocation, and 5% of the 20%
integrations/staging/production-E2E allocation: 68% total.

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

## Next phases

1. [x] Implement the local backend schema, RLS contract, authenticated workspace APIs, invitations, and remote workspace/quota synchronization.
2. [x] Complete server-authoritative member listing and role administration; the local implementation is verified and not deployed.
3. [ ] Synchronize onboarding and customer profiles across devices with revision/conflict handling. (active wave)
4. [ ] Prove RLS and tenant isolation against a real local/staging Postgres instance using two authenticated users.
5. [ ] Reconcile quota reservations with the real billing ledger and productize hard plan entitlement enforcement.
6. [ ] Productize skill/tool registry metadata, permissions, stability labels, credit estimates, and server-side plan filtering.
7. [ ] Add one backend-owned, resumable seven-day content workflow with real registry agents, tenant-scoped artifacts, Brand Guardian review, and customer approval; no external publish action.
8. [ ] Add approved social, SEO, email/CRM, and analytics workflows; Voice Studio local preview
   and HyperFrames plus Voice Studio local MP4 generation are verified, while direct F5
   generation, commercial rendering, and every external publish action remain gated.
9. [ ] Add integration token vaulting, scoped grants, revocation, audit records, and real campaign/content/assets/knowledge routes.
10. [ ] Add end-to-end tests for publish gates, spend gates, integrations, billing, recovery, console/network health, and Internal Marketing Room regression.
11. [ ] Deploy a staging environment, complete security review, and obtain reviewer approval.
12. [x] Finish the production Voice Studio image and managed runtime: resolve the `perth`
    dependency, preserve Docker connection variables, rebuild, publish, and run end-to-end TTS
    smoke tests.
13. [ ] Restore persistent GitNexus MCP connectivity and index the active Voice worktree while
    retaining shell/CLI fallback.
14. [x] Establish a workspace-wide ESLint 9 flat-config gate, bounded migration suppressions,
    deterministic contract tests, and CI/release enforcement.
15. [x] Reduce authenticated Customer Marketing workspace first-open latency; precise beta31
    production-renderer smoke measured 890 ms after Chat settled and 1,826 ms for immediate
    fresh-process navigation, with optional media readiness refreshed in the background.

## Explicitly not claimed complete

- Production deployment of the local multi-tenant backend migration, RLS policies, or feature gate.
- Production deployment of team invitations, server-authoritative roles, and member role administration; the local implementation is complete and verified against a mocked backend, but no deployed IzziAPI instance has served these routes.
- Cross-device onboarding, run, approval, media job, and artifact persistence.
- Real billing-ledger reconciliation; local atomic quota enforcement exists but production billing authority is not claimed.
- Fully wired publishing, ads, email, CRM, commercial rendering, or direct F5-TTS generation.
- A commercially enabled advertising render on the installed app. The audited VieNeu chain is
  available, but the runtime gate remains closed until its operator license evidence is configured.
- A recorded consent artifact bound to the reference voice used by a media job.
- A complete end-to-end marketing campaign with external actions.
- Staging URL, release branch, or deployment approval.
- Windows Authenticode signing and SmartScreen reputation; beta31 remains unsigned even though its
  installer SHA-256 matches the digest published by the verified GitHub release workflow.
