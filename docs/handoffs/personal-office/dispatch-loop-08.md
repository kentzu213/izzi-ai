# Loop 08 dispatch — Workspace blueprints and scoped provisioning plans

## Control-plane authority

- Integration ref: `feature/personal-office-baseline-20260728`
- Dispatch base: the integration ref containing Loop 09 acceptance (`58278c1491fd7f2214f55ece4fa82d50db53e998`)
- Producer branch: `feature/personal-office-loop-08-20260729`
- Producer worktree: `F:\Ai Tools\_wt-starizzi-personal-office-loop08`
- Lease: `LEASE-L08-WORKSPACE-BLUEPRINTS-20260729`
- Dependencies: Loop 01, Loop 03 and Loop 04 are ACCEPTED.
- Status authority: only W0 may set `ACCEPTED`.

Kiro/provider writers remain disabled. Codex is the only authorised producer for this lease until W0 records a different writer.

## Objective

Create a deterministic, tenant/user/workspace-scoped blueprint and provisioning-plan layer for a single-operator Personal Office. A user may inspect a blueprint, review what the office would contain, and create a plan for a `WorkspaceInstance`. This loop must not claim that an environment, application, account, runtime or integration was actually provisioned.

## Contract ruling carried from Loop 00/01

Loop 08 may add only this optional canonical field:

```ts
WorkspaceInstance.health?: 'ok' | 'attention' | 'blocked' | 'unknown'
```

The field is a non-authoritative health signal. It is separate from `WorkspaceState` and `ProvisioningState`; no health value may force or imply a lifecycle transition. The field remains optional and does not change `PERSONAL_OFFICE_SCHEMA_VERSION`.

## Exclusive write paths

- `apps/desktop/src/shared/workspace-blueprint/**`
- `apps/desktop/src/main/workspace-blueprint/**`
- `apps/desktop/src/renderer/components/workspace-blueprint/**`
- `apps/desktop/src/renderer/store/workspaceBlueprint.ts`
- `apps/desktop/src/renderer/store/workspaceBlueprint.test.ts`
- `apps/desktop/src/shared/personal-office/entities.ts`
- `apps/desktop/src/shared/personal-office/index.ts`
- `apps/desktop/src/shared/personal-office/serialization.test.ts`
- `docs/product/personal-office-workspace-blueprints.md`
- `docs/handoffs/personal-office/loop-08.json`
- `worklogs/personal-office-loop-08.md`

No other path is writable without a new exact W0 change request and lease amendment.

## Read-only inputs

- `apps/desktop/src/shared/personal-office/**` except the three exact leased contract paths
- `apps/desktop/src/shared/live-profile.ts`
- `apps/desktop/src/main/live/**`
- `apps/desktop/src/main/work/**`
- `apps/desktop/src/shared/marketplace/**`
- `apps/desktop/src/shared/capabilities/**`
- `apps/desktop/src/renderer/shell/**`
- `apps/desktop/src/renderer/store/personalOffice.ts`
- `docs/architecture/personal-office-os.md`
- `docs/architecture/legacy-personal-office-mapping.md`
- acceptance records for Loops 01, 03, 04 and 09

## Hard prohibitions

- No `package.json`, workspace manifest, lockfile, dependency or install.
- No DB/schema/migration, `main/index.ts`, preload, IPC registration or persistent storage.
- No `App.tsx`, Sidebar or existing shell-source modification.
- No provider/model routing, agent tools, extensions runtime, process execution, browser automation or external network call.
- No download, application install, permission grant, account mutation, runtime activation or provisioning success.
- No raw secret or credential. `SecretRef` stays opaque.
- No quarantine write, merge, blind cherry-pick, push, main, deploy or publish.

## Required behavior

1. Define strict versioned blueprint descriptors and exact parsers. Reject unknown keys, wildcards, secret-shaped ids, malformed versions and authority-bearing values from untrusted display metadata.
2. Bind every plan to exact `tenantId`, `userId`, target `WorkspaceInstanceId`, `WorkspaceBlueprintId`, blueprint version and immutable plan id.
3. Derive plan contents deterministically: requested apps/packages, required integration grant references, data classifications, trust zones, expected side effects and approval requirement.
4. Emit `effect: 'plan_only'`. The plan schema must not accept command, environment, download, execution, grant, activation, persisted-state or success fields.
5. Keep health independent from lifecycle. Required regression: an active workspace remains active for every health value.
6. Make demo/offline/unavailable states explicit. Never label a blueprint remote-verified, installed or provisioned without trusted evidence.
7. If a renderer component is built, it remains an isolated unmounted consumer surface. It must be responsive, keyboard/focus accessible and truthful about plan-only behavior.
8. Use two-phase commits:
   - Phase 1: leased implementation, tests and product contract.
   - Phase 2: only `loop-08.json` and the worklog.

## Acceptance checks

- Invalid descriptor/scope/transition and tamper tests.
- Deterministic plan/idempotency tests.
- Health/lifecycle separation tests.
- No-side-effect and secret-shaped-input tests.
- Shared/main and renderer TypeScript as applicable.
- Targeted tests and lint; full desktop tests/build at W0 integration.
- Exact ownership, prohibited-path, secret and Git-blob hash audit.
- Independent security review; independent design review if visual output exists.

## Required roles and skills

Use Socrates to challenge claims, orchestrator to sequence work, and builder to implement. Apply:

`/search-first /context-gatherer /quick-spec /backend-patterns /frontend-patterns /deployment-patterns /security-review /verification-loop /understand-codebase Design /gpt-taste /design-taste-frontend /stitch-design-taste`

Mark non-applicable skills as boundary checks rather than inventing work.
