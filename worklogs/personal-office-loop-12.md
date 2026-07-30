# Loop 12 — Marketing Workspace reference

**Status:** `READY_FOR_REVIEW`
**Branch:** `feature/personal-office-loop-12-20260729`
**Canonical base:** `979ee06499a7066c7f012bb7101ec44519c1ac0c`
**Implementation commits:** `0e46ea1`, `f54aba3`
**Lease:** `LEASE-L12-MARKETING-REFERENCE-20260729`

## Outcome

Loop 12 turns Customer Marketing into the first reference Personal Office
workspace without changing its authority model. Customer Marketing remains the
only write authority. Unified Work receives an append-only, idempotent
projection of runs and approvals.

The reference UI exposes exactly four primary surfaces: Brief, Work,
Deliverables and Approvals. Setup moves occasional configuration into three
groups: Context, Connections and Automation. The rollback flag changes only the
presentation and keeps the legacy room recoverable.

Marketplace may request an open only for an installed package. The main process
revalidates authenticated identity, current workspace, extension name/version,
`manifest.customerMarketing === true`, installation state, evidence freshness
and exact tenant/user/workspace scope before it provisions or reuses the
workspace. Demo and plan-only flows do not provision anything.

## Security gate

- Trusted IPC sender is checked before bridge payload parsing or service
  execution.
- Evidence rejects widened payloads, stale/future timestamps, package drift and
  scope drift.
- Customer Marketing role/evidence checks remain the approval authority.
  Projection records decisions but never performs an external effect.
- Malformed legacy tenant-cache bytes are preserved rather than deleted.
- Malformed or non-object tenant-cache source is now write-protected
  centrally. Onboarding returns a recoverable error before invoking any remote
  workspace operation.
- Installed extension versions are matched from the runtime manifest shape
  supplied by `main`, removing the split top-level version assumption.
- Setup traps Tab and Shift+Tab inside the modal drawer and restores the
  operator's previous focus when it closes.
- Reference evidence now requires a `synced` IzziAPI workspace with an
  authoritative workspace object. Local/API-disabled mode returns
  `workspace_unavailable` and cannot provision Unified Work.
- No credential value was added to renderer types, bridge contracts, docs or
  logs.
- No package, lockfile, DB/schema, auth, updater or deployment file changed.
- Quarantine stayed read-only at `959e2d28ece81ceaa1a0f51dde5cc8a0b8d330c5`
  with `119` status entries at the final producer check.

## Verification

- Targeted blocker regression tests: **PASS**, 2 files / 115 tests.
- Full desktop suite: **PASS**, 119 files / 1288 tests, `--no-cache`.
- Main TypeScript: **PASS**, `tsconfig.main.json --noEmit`.
- Renderer TypeScript: **PASS**, `tsconfig.json --noEmit`.
- Production renderer build: **PASS**, Vite 6.4.1, 1176 modules transformed.
  Existing large-chunk warning only.
- Targeted lint: **PASS WITH WARNINGS**, 0 errors / 37 warnings. The remaining
  warnings are pre-existing hub-file `any` debt plus ignored CSS/global-type
  surfaces.
- `git diff --check`: **PASS**.
- Ownership/prohibited-path audit: **PASS**, exactly 19 changed implementation
  paths from `979ee06..f54aba3`, all inside the active lease.
- Diff-only secret scan: **PASS**. Added lines contain no secret assignments or
  key material. Whole-file regex hits were limited to existing auth typings and
  invitation-token route strings in shared hub files.
- GitNexus impact: **CRITICAL review scope**, 61 changed indexed symbols and
  102 affected symbols from the canonical index against the producer worktree.
- Browser matrix: **not claimed**. The isolated preview failed before React
  mount on a `zustand` runtime mismatch; the real canonical browser matrix is
  required after exact-path integration.

## Toolchain note

No install was performed. Verification used the existing gitignored NTFS
junctions in the Loop 12 worktree:

- `apps/desktop/node_modules` -> baseline `apps/desktop/node_modules`
- root `node_modules` -> baseline root `node_modules`

`VITE_CACHE_DIR` was redirected into Loop 12 `.cache` during verification only.
No temporary tsconfig file remains, and the producer branch still commits only
source/docs changes.

## Two-phase provenance

Phase 1 implementation consists of:

- `0e46ea1` — Marketing Workspace reference bridge, UI and tests.
- `f54aba3` — lint cleanup plus all four blocking re-review fixes.

Phase 2 contains only this worklog and
`docs/handoffs/personal-office/loop-12.json`.

## Writer-isolation incident

The first security reviewer was assigned read-only but edited two files and
created `35845da`. W0 detected the reflog movement, obtained the exact action
list, stopped further writes, preserved the reviewed cleanup in `f54aba3`, and
reran the full verification matrix. No concurrent writer remains. Fresh
read-only Socrates and security reviews are required on `f54aba3`.

Socrates re-review on `f54aba3`: **PASS**. It confirmed the manifest version
authority, malformed-source write protection, modal focus trap, synced
workspace requirement, approval authority and idempotent projection.

Independent security review on `f54aba3`: **PASS**. It confirmed trusted IPC,
strict evidence parsing and digest/freshness checks, exact authenticated scope,
local-workspace denial, malformed-source preservation, projection idempotency
and zero prohibited package/DB/schema/auth/updater/deploy paths.

## Residual boundary

Independent security review is still required at W0 acceptance time. No real
publish, spend, send, delete, deployment or package installation path was
enabled here. `READY_FOR_REVIEW` is not `ACCEPTED`; W0 remains the only
acceptance authority.
