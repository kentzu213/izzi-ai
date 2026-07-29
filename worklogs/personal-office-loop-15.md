# Loop 15 — Host-validated Marketplace operation

**Status:** `READY_FOR_REVIEW`
**Branch:** `feature/personal-office-loop-15-20260729`
**Canonical base:** `fefe740a046723f9b0dc91e2ac51afb19f680736`
**Producer implementation:** `bee907c`
**Lease:** `LEASE-L15-MARKETPLACE-OPERATION-20260729`

## Outcome

- The production Marketplace route no longer falls back to renderer-created
  demo catalog data.
- Main owns catalog loading, authenticated reviewer scope and the canonical
  personal workspace.
- Every submitted plan is strictly parsed, recreated from current host
  authority and compared canonically before package verification.
- Package identity, byte digest and publisher-signature digest bind the exact
  Work approval.
- Grant resolution, workspace provisioning and package installation are
  ordered injected ports. A pending, blocked, failed or unavailable stage
  prevents every later effect.
- Strict renderer-safe receipts record only stable ids, digests, timestamps and
  stage outcomes. Package handles, paths, URLs, tokens and raw user ids never
  cross preload.
- Production catalog and effect adapters remain deliberately unavailable. The
  bridge fails closed and is not connected to
  `extensions:runtime:installFromMarketplace`.

## Security corrections

- Receipt parsing now requires a unique ordered prefix of the six-stage
  pipeline, exact UTC timestamps and status/terminal-stage consistency.
- Completed receipts require exact workspace and package evidence; approval
  ids must bind the Work approval stage.
- Resume rejects an approval object whose id or binding digest differs from
  the requested approval.
- Malformed renderer plans are normalized to the stable `PLAN_DRIFT` failure
  before package verification.
- Trusted top-level sender validation occurs before request parsing or service
  execution.

No auth implementation, DB/schema, Work internals, capability registry,
grant-vault, provisioning contracts, extension manager/installer, runtime,
package manifest, lockfile, quarantine or secret surface changed.

## Verification

- Focused final Marketplace suite: **PASS**, 5 files / 20 tests.
- Full desktop suite after the final implementation commit: **PASS**, 127 files
  / 1388 tests.
- Main TypeScript: **PASS** with `--noEmit`.
- Renderer TypeScript: **PASS** with `--noEmit`.
- Production renderer build: **PASS**, 1176 modules; existing large-chunk
  advisory only.
- Targeted changed-surface lint: **PASS**, 0 warnings with `--max-warnings 0`.
- Repository lint ceiling: **PASS**, 0 errors / 350 warnings, maximum 358.
- Ownership/prohibited paths: **PASS**, exactly 17 implementation paths and all
  inside the active lease.
- `git diff --check` and credential-shaped content scan: **PASS**.
- GitNexus detect-changes: **DEGRADED_LOW**, 11 mapped symbols, no affected
  process; new unindexed files required manual review and full verification.
- Quarantine: **UNCHANGED**, HEAD `959e2d28`, 459 expanded entries, status
  SHA-256
  `07f2e713c57599d4787c36d67394f6573dfab702a42e454f1c0f3b8e09160ca5`.

The isolated toolchain was exposed through temporary NTFS junctions to the
clean canonical worktree. Tests ran with cache disabled; the production build
used `apps/desktop/dist/.vite-cache`. The canonical toolchain `.vite` timestamp
remained byte-for-byte unchanged, and both junctions were removed after each
verification pass.

## Role audit

Loop 15 was executed directly by Codex with the builder, orchestrator and
Socrates review checklists applied in-process. Kiro and subagents had no writer
authority. Security review and verification were performed directly against
the leased paths; no deployment or browser-automation action was run.

## Two-phase provenance

Phase 1 is the immutable producer implementation at `bee907c`. Phase 2 contains
only this worklog and
`docs/handoffs/personal-office/loop-15.json`.

`READY_FOR_REVIEW` is not `ACCEPTED`. W0 must exact-path replay the 17
implementation paths, verify producer/canonical Git blobs, create the acceptance
record, update the ledger and revoke the lease in separate governance commits.
