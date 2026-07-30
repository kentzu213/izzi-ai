# Loop 14 — Authenticated Live context runtime

**Status:** `READY_FOR_REVIEW`
**Branch:** `feature/personal-office-loop-14-20260729`
**Canonical base:** `cd567e23c5a8573f7f039c7d0330854893137dff`
**Producer implementation:** `e903540`, `3c4b112`
**Canonical implementation:** `80545a2`, `80038bb`
**Lease:** `LEASE-L14-CONTEXT-RUNTIME-20260729`

## Outcome

- Main derives the owner from the authenticated session and never accepts
  renderer-supplied owner or workspace authority.
- The only accepted workspace is the persisted canonical `personal` workspace.
- Live.md is stored below
  `userData/personal-office/live/<scope-hash>/Live.md`; no raw user id is part
  of the path.
- Missing Live.md initializes a minimal `personal_graph` document.
- The deterministic compiler binds the trusted host safety prompt, exact raw
  request, fixed workspace policy and effective Live directives.
- Only Work snapshot metadata is persisted.
- Agent mode removes renderer-supplied system history and rejects multimodal
  context until the whole payload can be canonically bound.
- Unknown and child-frame senders cannot start, abort or inject into an agent
  turn.

## Security corrections

Two blocking findings were closed before handoff:

1. Arbitrary Live/filesystem errors were initially returned through
   `error.message`, which could expose a userData path. The renderer now
   receives only a stable ContextCompilationError code or
   `context-preparation-failed`.
2. Existing abort/inject handlers had no sender trust check. W0 expanded the
   change request and hot-file lease first, then added fail-closed checks before
   turn lookup and input parsing.

No auth implementation, DB/schema, Work/Live/compiler/kernel contract,
host-agent implementation, preload, renderer, package manifest, runtime,
quarantine or secret surface changed.

## Verification

- Targeted final correction: **PASS**, 2 files / 11 tests.
- Complete context matrix: **PASS**, 6 files / 28 tests.
- Full desktop suite: **PASS**, 124 files / 1376 tests.
- Main TypeScript: **PASS**.
- Renderer TypeScript: **PASS**.
- Production build: **PASS**, existing large-chunk advisory only.
- Lint ceiling: **PASS**, 0 errors / 350 warnings, maximum 358.
- Ownership/prohibited paths: **PASS**, exactly 3 implementation paths.
- `git diff --check` and added-line secret scan: **PASS**.
- Producer/canonical final Git blobs: **PASS**, 3/3.
- Quarantine: **UNCHANGED**, HEAD `959e2d28`, 459 entries, status SHA-256
  `b8b124cd1de43b73ef1cf3697df519f1049ccd923ecb024dd9bf166be82c1c8d`.

GitNexus was degraded: its canonical index was seven commits stale and could
not map the three changed files to symbols. Re-index was intentionally not run
because it rewrites W0-reserved managed files. The hot `setupIPC` surface was
therefore covered by manual diff review, the full test suite, both typechecks,
production build and lint.

## Skill and role audit

This loop was executed directly with the Socrates, orchestrator and builder
checklists in-process, as requested after Kiro was removed from the workflow.
The active task skills were `security-review` and `verification-loop`.
Frontend/design/deployment skills were not invoked because Loop 14 changed no
UI, design system or deployment surface.

## Two-phase provenance

Phase 1 is the immutable producer implementation ending at `3c4b112`. Phase 2
contains only this worklog and
`docs/handoffs/personal-office/loop-14.json`.

`READY_FOR_REVIEW` is not `ACCEPTED`. W0 must reconcile only the two handoff
artifacts, create the acceptance record, update the ledger and revoke the lease
in separate governance commits.
