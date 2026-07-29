# Release Gate R4 — trusted renderer IPC gate

## Trigger

Independent security review of the reconciled candidate found that the new
`work:*` and `runtime:*` IPC handlers enforce workspace/identity scope but do
not reject calls from an untrusted Electron renderer or child frame. Existing
Marketing IPC already enforces the top-level trusted-renderer boundary through
`isTrustedMarketingSender`.

The candidate merge remains uncommitted until this gap is closed.

## Lease

`LEASE-R4-IPC-SENDER-TRUST-20260729` owns only:

- `apps/desktop/src/main/work/work-ipc.ts`
- `apps/desktop/src/main/work/work-ipc-authz.test.ts`
- `apps/desktop/src/main/runtime/runtime-ipc.ts`
- `apps/desktop/src/main/runtime/runtime-ipc.test.ts`

Worktree:
`F:\Ai Tools\_wt-starizzi-personal-office-reconciled-20260729`

## Required result

- every `work:*` and `runtime:*` invoke handler rejects an event that does not
  pass the same top-level trusted-renderer test used by Marketing IPC;
- the gate runs before parsing input, resolving identity/scope, reading rows,
  mutating work, or returning runtime health;
- tests cover trusted top-level renderer, unknown sender, and child-frame
  rejection;
- existing tenant/workspace/approval authorization tests remain green.

## Prohibited

No preload/channel expansion, package or lockfile changes, DB/schema changes,
secret handling, installer execution, push/tag/publish/deploy, or quarantine
mutation.
