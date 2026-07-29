# Loop 04 runnable handoff — Context, Live.md, vault and MyGraph

Status: READY_TO_START  
Base: `feature/personal-office-baseline-20260728` at `4fa9e1d`  
Lease: `LEASE-L04-LIVE-VAULT-GRAPH-20260729`

## Goal

Implement the personal context layer: `Live.md` preferences/rules, vault and wikilink
operations, and a provenance-preserving projection into MyGraph. Consume the accepted
Loop 03 work engine; do not redefine its model or edit its wired seams.

## Exclusive write scope

- `apps/desktop/src/main/live/**`
- `apps/desktop/src/shared/live-*.ts`
- `apps/desktop/src/shared/vault-*.ts`
- `apps/desktop/src/shared/wikilink.ts`
- `apps/desktop/src/renderer/components/live/**`
- `apps/desktop/src/renderer/components/vault/**`
- `apps/desktop/src/renderer/store/liveProfile.ts`
- `apps/desktop/src/renderer/styles/live-profile.css`
- `docs/product/personal-office-live-graph.md`

Read-only: `shared/personal-office/**`, `main/work/**`, `renderer/shell/MyGraphRoute.tsx`.
Prohibited: App/Sidebar, database/index/preload, manifests/lockfile and quarantine.

## Required behavior

1. `Live.md` stores personal work preferences and rules, never raw secrets.
2. Define precedence and revision/proposal rules; no agent silently overwrites user truth.
3. Vault/wikilink operations validate paths and remain workspace/user scoped.
4. Graph projection preserves source, classification, timestamp and revision provenance.
5. Integrate with Loop 03 only through accepted APIs; request a new lease for any seam edit.
6. Add focused tests for parsing, precedence, proposals, revisions, secrets and wikilinks.
7. Two-phase commits: implementation/artifact, then handoff/worklog `READY_FOR_REVIEW`.

## Mandatory process

Use Socrates to challenge gates/assumptions, orchestrator for the short execution plan,
and builder for implementation. Use:

`/search-first`, `/context-gatherer`, `/quick-spec`, `/backend-patterns`,
`/frontend-patterns`, `/deployment-patterns`, `/security-review`,
`/verification-loop`, `/understand-codebase`, `Design`, `/gpt-taste`,
`/design-taste-frontend`, `/stitch-design-taste`.

Report: gate, files changed, verification, blockers, next handoff. No push/deploy.
