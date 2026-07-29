# Release Gate R3 — Customer Marketing beta.8 merge

## Scope

The R2 candidate based on `origin/main` beta.8 was merged with the accepted
Personal Office integration. Git reported four content conflicts where the
beta.8 Product Marketing Context authority work and Loop 12's reference
workspace bridge meet:

- `apps/desktop/src/main/customer-marketing/customer-marketing-ipc.ts`
- `apps/desktop/src/main/customer-marketing/customer-marketing-service.ts`
- `apps/desktop/src/main/customer-marketing/customer-marketing-service.test.ts`
- `apps/desktop/src/renderer/pages/CustomerMarketingRoom.tsx`

R3 must preserve both capabilities. Selecting one side wholesale is
prohibited because it would silently remove either authority-bound product
context or the reference workspace surface.

## Lease

`LEASE-R3-CUSTOMER-MARKETING-MERGE-20260729` grants one Codex builder the four
paths above in `F:\Ai Tools\_wt-starizzi-personal-office-reconciled-20260729`.
The worktree is already in a paused `git merge --no-commit` state with R2 as
ours and the Personal Office integration as theirs.

## Required result

- retain Product Marketing Context read/save IPC, signer/role authority,
  revision/conflict/tamper protections and associated tests;
- retain reference-workspace evidence/provisioning IPC, capability catalog,
  scope/staleness checks and associated tests;
- retain both renderer reference workspace mode and legacy fallback;
- preserve the unified WorkService projection and no cross-tenant leakage;
- remove all conflict markers and run focused customer-marketing tests plus
  TypeScript/build checks available without installing packages.

## Prohibited

No package manifest/lockfile changes, DB/schema changes, secrets, installer
execution, publish/tag/push/deploy, or quarantine mutation.
