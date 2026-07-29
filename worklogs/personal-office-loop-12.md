# Loop 12 — Marketing Workspace reference

**Status:** `READY_FOR_REVIEW`
**Branch:** `feature/personal-office-loop-12-20260729`
**Canonical base:** `979ee06499a7066c7f012bb7101ec44519c1ac0c`
**Implementation commits:** `0e46ea1`, `35845da`
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
- No credential value was added to renderer types, bridge contracts, docs or
  logs.
- No package, lockfile, DB/schema, auth, updater or deployment file changed.
- Quarantine stayed read-only at `959e2d28ece81ceaa1a0f51dde5cc8a0b8d330c5`
  with `119` status entries at the final producer check.

## Verification

- Targeted Loop 12 tests: **PASS**, 4 files / 146 tests.
- Full desktop suite: **PASS**, 119 files / 1283 tests, `--no-cache`.
- Main TypeScript: **PASS**, `tsconfig.main.json --noEmit`.
- Renderer TypeScript: **PASS**, `tsconfig.json --noEmit`.
- Production renderer build: **PASS**, Vite 6.4.1, 1176 modules transformed.
  Existing large-chunk warning only.
- Targeted lint: **PASS WITH WARNINGS**, 0 errors / 36 warnings. The remaining
  warnings are pre-existing hub-file `any` debt plus ignored CSS/global-type
  surfaces; Loop 12-specific warnings were removed in `35845da`.
- `git diff --check`: **PASS**.
- Ownership/prohibited-path audit: **PASS**, exactly 19 changed implementation
  paths from `979ee06..35845da`, all inside the active lease.
- Diff-only secret scan: **PASS**. Added lines contain no secret assignments or
  key material. Whole-file regex hits were limited to existing auth typings and
  invitation-token route strings in shared hub files.
- GitNexus impact: **not claimed** on the producer branch. `gitnexus status`
  returned `Repository not indexed.` Because this loop touches
  `customer-marketing-service`, `customer-marketing-ipc`, `main/index.ts`,
  `preload.ts` and `CustomerMarketingRoom.tsx`, W0 should treat canonical review
  scope as critical and rerun impact after exact-path integration.

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
- `35845da` — final lint-delta cleanup for one IPC file and one renderer hook.

Phase 2 contains only this worklog and
`docs/handoffs/personal-office/loop-12.json`.

## Residual boundary

Independent security review is still required at W0 acceptance time. No real
publish, spend, send, delete, deployment or package installation path was
enabled here. `READY_FOR_REVIEW` is not `ACCEPTED`; W0 remains the only
acceptance authority.
