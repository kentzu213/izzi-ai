# Release Gate R5 — beta.10 HyperFrames path reconciliation

## Trigger

Read-only local-ref inspection on 2026-07-29 found that `origin/main` advanced
from the beta.9 evidence commit `8330b4609a834d6741a4ba47d527013833d312ba`
to `bc0d5d6b88fdab1936ad78be00a0dbec8d4f87e8`.

The new commit moves the managed HyperFrames runtime profile and snapshot
staging into a short-lived system-temp directory to avoid the Windows legacy
path boundary. The Personal Office integration ref already contains beta.9 plus
the accepted R2-R4 release/security reconciliation, so blindly merging either
line would risk dropping reviewed work.

The source worktree contains untracked local packaging directories. It is
read-only input for this gate; no file from those directories may be copied,
committed, cleaned, reset, stashed, moved, or deleted.

## Lease

`LEASE-R5-BETA10-RECONCILIATION-20260729` grants one Codex producer an isolated
worktree based on the exact Personal Office integration commit
`177b6a902b340feff4d67678f90c76dfdc512a54`.

Owned paths:

- `apps/desktop/CHANGELOG.md`
- `apps/desktop/package.json`
- `apps/desktop/scripts/run-cmr210-packaged-smoke.ps1`
- `apps/desktop/scripts/verify-managed-hyperframes-preview.cjs`
- `apps/desktop/src/main/customer-marketing/customer-video-studio-service.test.ts`
- `apps/desktop/src/main/customer-marketing/customer-video-studio-service.ts`
- `apps/desktop/src/main/index.ts`
- `docs/handoffs/personal-office/release-gate-r5-beta10.json`
- `worklogs/personal-office-release-gate-r5-beta10.md`

The seven source paths must be restored from the exact Git objects in
`bc0d5d6b88fdab1936ad78be00a0dbec8d4f87e8`, then reviewed against the
Personal Office integration base. No untracked packaging output is an input.

## Required verification

1. Confirm all seven source blobs match `bc0d5d6` after replay.
2. Verify the temp runtime root is fail-closed against symlinks/junctions and
   is removed on success and failure.
3. Verify staged snapshots are validated before and after no-overwrite copy to
   the durable preview run.
4. Run focused Customer Marketing/HyperFrames tests.
5. Run main TypeScript, full desktop tests, renderer production build, lint
   ceiling, diff check, ownership audit, conflict-marker scan, and diff-only
   secret scan.
6. Re-fingerprint the quarantine worktree before and after; it must remain at
   HEAD `959e2d28ece81ceaa1a0f51dde5cc8a0b8d330c5` with the same status digest.

## Prohibited

No push, tag, publish, deployment, installer execution, package installation,
secret retrieval, GitHub environment mutation, DB/schema change, browser
automation enablement, or quarantine/source-worktree mutation.
