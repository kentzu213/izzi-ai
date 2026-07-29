# Loop 13 — Real shell-to-Work bridge

**Status:** `READY_FOR_REVIEW`
**Branch:** `feature/personal-office-loop-13-20260729`
**Canonical base:** `03a2397911b5a6e81103f148ab76d52d034bd11e`
**Implementation commit:** `25c6a945b5b1c3178b46a14b2d374c54f021226e`
**Lease:** `LEASE-L13-REAL-WORK-BRIDGE-20260729`

## Outcome

The Personal Office shell now uses the existing authorized Work engine instead
of resolving to an empty production datasource.

- Main idempotently ensures the canonical `personal` workspace during Work IPC
  registration.
- `work:listWorkspaces` returns only workspaces derived from current main-side
  identity and workspace authority.
- Preload exposes the bounded workspace listing method.
- The renderer maps engine workspaces, runs, steps, artifacts and pending
  approvals into minimal shell read records.
- Delegation creates a durable Work run through preload.
- Scoped Work events trigger a reload.
- Demo remains opt-in. Missing Electron bridge, missing workspace and denied
  create-run requests fail closed.
- Artifact `externalPath` never enters renderer state.

No `WorkService`, database/schema, auth, runtime adapter, package manifest,
`App.tsx`, `main/index.ts` or shared Personal Office contract was changed.

## Security gate

- Trusted top-level renderer validation runs before workspace listing.
- Main owns reviewer identity and accessible-workspace derivation.
- Renderer supplies only a requested workspace id; all Work handlers continue
  to re-check scope in main.
- Renderer data is minimized and does not include absolute artifact paths.
- A null authorized `createRun` response becomes an explicit failure.
- No secret value, token assignment, installer, browser automation, deployment
  or external-effect path was added.
- Quarantine remained read-only at
  `959e2d28ece81ceaa1a0f51dde5cc8a0b8d330c5`.

## Verification

- Targeted Work bridge tests: **PASS**, 2 files / 35 tests.
- Full desktop tests: **PASS**, 123 files / 1370 tests.
- Main TypeScript: **PASS**, `tsconfig.main.json --noEmit`.
- Renderer TypeScript: **PASS**, `tsconfig.json --noEmit`.
- Production build: **PASS**, Vite 6.4.1, 1176 modules transformed; existing
  large-chunk advisory only.
- Lint ceiling: **PASS**, 0 errors / 350 warnings, maximum 358.
- `git diff --check`: **PASS**.
- Ownership/prohibited-path audit: **PASS**, exactly 7 implementation paths,
  all inside the active lease.
- Producer/canonical Git-blob equality: **PASS**, 7/7.
- Diff-only secret scan: **PASS**.
- GitNexus: **CRITICAL review scope**, 7 files / 6 indexed changed symbols /
  265 affected processes. The full verification matrix above covers that blast
  radius.
- Quarantine fingerprint: **PASS**, 459 entries, status SHA-256
  `b8b124cd1de43b73ef1cf3697df519f1049ccd923ecb024dd9bf166be82c1c8d`.

## Toolchain note

No install was run. The copied producer `node_modules` tree did not preserve
pnpm junction semantics, so it was not treated as verification evidence.
Source was committed in the isolated producer, replayed by exact path into the
clean canonical worktree, and verified with canonical's own toolchain. No
toolchain path points into quarantine.

## Two-phase provenance

Phase 1 is implementation commit `25c6a94`. Phase 2 contains only this worklog
and `docs/handoffs/personal-office/loop-13.json`.

`READY_FOR_REVIEW` is not `ACCEPTED`. W0 must commit the verified exact-path
replay, reconcile this handoff, create the acceptance record, update the ledger
and revoke the lease separately.
