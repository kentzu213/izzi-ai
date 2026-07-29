# CHANGE_REQUEST — Loop 13 real Work bridge

Status: `APPROVED`
Requester: W0 Control Tower / Codex
Lease: `LEASE-L13-REAL-WORK-BRIDGE-20260729`
Decision authority: W0

## Target

- `apps/desktop/src/main/work/work-preload-api.ts`
  - add an authorized `listWorkspaces` preload contract and IPC channel.
- `apps/desktop/src/main/work/work-ipc.ts`
  - bootstrap the canonical local workspace idempotently at registration;
  - return only workspaces visible to the current main-process identity.
- `apps/desktop/src/main/preload.ts`
  - expose only the new bounded `listWorkspaces` method.
- `apps/desktop/src/renderer/shell/workAdapter.ts`
  - replace the production empty datasource with a preload-backed datasource;
  - project engine DTOs into renderer read models without fabricating contract
    owner, blueprint, tenant, or execution state.
- `apps/desktop/src/renderer/shell/useWorkSnapshot.ts`
  - fail closed when no workspace is available;
  - refresh after durable Work events.

## Reason

The accepted shell still resolves production data to an empty in-memory source
even though the authorized Work IPC/preload API is already registered. The
renderer consequently cannot discover an accessible workspace, create a durable
run, or observe updates from the engine.

The renderer must never invent tenant, user, owner, blueprint, or workspace
identity. Main remains authoritative for sender trust and workspace scope.

## Intended patch

1. Register the canonical `personal` workspace with the existing idempotent
   `WorkService.ensureWorkspace()` during Work IPC setup.
2. Add `work:listWorkspaces`. Resolve authorization fresh per call and return
   only rows allowed by the existing `work-authz` policy.
3. Add a preload-backed renderer datasource that:
   - feature-detects `window.electronAPI.work`;
   - lists authorized workspaces;
   - loads bounded runs and their bundles;
   - maps only fields required by shell read models;
   - creates runs through `work:createRun`;
   - reloads on workspace-scoped Work events.
4. Keep demo data opt-in. A non-Electron production surface reports the Work
   bridge as unavailable instead of presenting fabricated or silently empty
   data.
5. Reject delegation when there is no authorized workspace or main declines
   run creation.

## Security decision

- IPC sender trust remains the first operation in every handler.
- Tenant/user identity is never accepted from renderer input.
- The personal workspace is the canonical local workspace, not a fabricated id.
- Tenant workspaces require the existing authenticated reviewer binding.
- Forbidden and missing workspaces remain indistinguishable to the renderer.
- No secret, token, credential, raw filesystem path, DB/schema migration,
  runtime adapter, package change, installation, push, or deployment is in scope.

## Proof

1. Work IPC authz tests cover signed-out personal visibility, signed-in bound
   tenant visibility, stale binding rejection, and untrusted sender rejection.
2. Renderer adapter tests cover real load/projection, unavailable bridge,
   rejected create-run, and event subscription cleanup.
3. Targeted Work and shell tests pass.
4. Full desktop tests, main/renderer TypeScript, production build, and lint
   ceiling pass.
5. GitNexus `detect-changes`, ownership/prohibited-path audit, diff check, and
   added-line secret scan pass before any implementation commit.

