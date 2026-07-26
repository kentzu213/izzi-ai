# Customer AI Marketing Room Plan

Product status: in_progress (60% weighted local scope)
Vertical slice status: verified_local_media_pending_approval
Backend foundation status: verified_local_not_deployed
Scope: first production-shaped customer slice on the existing Starizzi / IzziAPI core.

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

## Next phases

1. [x] Implement the local backend schema, RLS contract, authenticated workspace APIs, invitations, and remote workspace/quota synchronization.
2. [x] Complete server-authoritative member listing and role administration; the local implementation is verified and not deployed.
3. [ ] Synchronize onboarding and customer profiles across devices with revision/conflict handling. (active wave)
4. [ ] Prove RLS and tenant isolation against a real local/staging Postgres instance using two authenticated users.
5. [ ] Reconcile quota reservations with the real billing ledger and productize hard plan entitlement enforcement.
6. [ ] Productize skill/tool registry metadata, permissions, stability labels, credit estimates, and server-side plan filtering.
7. [ ] Add one backend-owned, resumable seven-day content workflow with real registry agents, tenant-scoped artifacts, Brand Guardian review, and customer approval; no external publish action.
8. [ ] Add approved social, SEO, email/CRM, and analytics workflows; HyperFrames/F5 runtime discovery is started but generation/render execution remains gated.
9. [ ] Add integration token vaulting, scoped grants, revocation, audit records, and real campaign/content/assets/knowledge routes.
10. [ ] Add end-to-end tests for publish gates, spend gates, integrations, billing, recovery, console/network health, and Internal Marketing Room regression.
11. [ ] Deploy a staging environment, complete security review, and obtain reviewer approval.

## Explicitly not claimed complete

- Production deployment of the local multi-tenant backend migration, RLS policies, or feature gate.
- Production deployment of team invitations, server-authoritative roles, and member role administration; the local implementation is complete and verified against a mocked backend, but no deployed IzziAPI instance has served these routes.
- Cross-device onboarding, run, approval, media job, and artifact persistence.
- Real billing-ledger reconciliation; local atomic quota enforcement exists but production billing authority is not claimed.
- Fully wired publishing, ads, email, CRM, HyperFrames render, or F5-TTS generation execution.
- A commercially licensed and authoritatively verified Vietnamese voice model for IzziAPI advertising.
- A recorded consent artifact bound to the reference voice used by a media job.
- A complete end-to-end marketing campaign with external actions.
- Staging URL, release branch, or deployment approval.
