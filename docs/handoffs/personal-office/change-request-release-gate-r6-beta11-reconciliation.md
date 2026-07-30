# Release Gate R6 — beta.11 safe media re-import reconciliation

## Trigger

Read-only inspection on 2026-07-29 found an uncommitted beta.11 successor draft
in:

`F:\3 AI-Automation\izziAi Marketing\.cmr218-product-context-release-20260729`

The source worktree is mutable and contains seven tracked edits plus packaged
release directories. It is evidence only. It must not be reset, cleaned,
stashed, committed, or used as a whole-file source.

Independent security review blocked the draft's `legacy_ids` behavior. A local
project manifest could claim an unrelated project ID and cause jobs, artifacts,
and approvals to be removed from the current workspace without authoritative
lineage or explicit confirmation.

## Decision

R6 may reconcile only these safe behaviors:

1. Re-importing from the same runtime-derived source identity replaces that
   source's prior media job, artifact, and approval chain. The identity is
   bound to the authenticated workspace and canonical real path; it is not
   read from the project manifest and is never exposed in the renderer
   snapshot.
2. A preview result that completes after its job was replaced is discarded.
3. The renderer displays the service-provided import result message.
4. Desktop release metadata advances from beta.10 to beta.11.

Manifest-declared project IDs, aliases, or `legacy_ids` are not accepted as
replacement authority. A project moved to a different source directory is
imported as a separate project. A project renamed in place keeps service-owned
continuity through the runtime-derived source identity.

## Lease

`LEASE-R6-BETA11-SAFE-REIMPORT-20260729` grants one Codex producer an isolated
worktree based on the current authoritative integration ref.

Owned source paths:

- `apps/desktop/CHANGELOG.md`
- `apps/desktop/package.json`
- `apps/desktop/src/main/customer-marketing/customer-marketing-service.ts`
- `apps/desktop/src/main/customer-marketing/customer-marketing-service.test.ts`
- `apps/desktop/src/main/customer-marketing/customer-video-studio-service.ts`
- `apps/desktop/src/main/customer-marketing/customer-video-studio-service.test.ts`
- `apps/desktop/src/renderer/pages/CustomerMarketingRoom.tsx`

Owned handoff paths:

- `docs/handoffs/personal-office/release-gate-r6-beta11.json`
- `worklogs/personal-office-release-gate-r6-beta11.md`

All other paths, including `pnpm-lock.yaml`, database/schema files, IPC/preload
files, and packaged release directories, are read-only.

## Required verification

1. Same-source re-import replaces only the matching project chain, including
   when the manifest project ID changes.
2. Forged `projectId` or `legacyProjectIds` properties from a different source
   cannot remove unrelated project history.
3. Stale preview success and failure results cannot restore or mutate a
   replaced job.
4. Tenant/workspace authorization and existing path/link defenses remain
   unchanged.
5. Run focused Customer Marketing tests, desktop TypeScript, production build,
   lint ceiling, full desktop tests if practical, diff check, ownership audit,
   conflict-marker scan, and diff-only secret scan.
6. Re-fingerprint the mutable source and quarantine worktrees before and after;
   neither may be written.

## Prohibited

No push, tag, publish, deployment, installer execution, package installation,
secret retrieval, GitHub environment mutation, DB/schema change, browser
automation enablement, or mutation of either read-only source worktree.
