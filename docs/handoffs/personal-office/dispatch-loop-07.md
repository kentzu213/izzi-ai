# Loop 07 runnable handoff — Capability registry and package adapters

Status: READY_TO_START  
Base: `feature/personal-office-baseline-20260728` at `4fa9e1d`  
Lease: `LEASE-L07-CAPABILITY-ADAPTERS-20260729`

## Goal

Create a deterministic, versioned capability registry and least-privilege package
adapters that connect installed skills/apps to the accepted Personal Office contracts
and Loop 03 execution engine.

## Exclusive write scope

- `apps/desktop/src/shared/capabilities/**`
- `apps/desktop/src/main/capabilities/**`
- `packages/agent-bundle/src/adapters/**`
- `docs/product/personal-office-capabilities.md`

Read-only: `shared/personal-office/**`, `main/work/**`, `agent-bundle/src/manifest.ts`.
Prohibited: renderer, DB/index/preload, manifests, package files, lockfile and quarantine.

## Required behavior

1. Registry entries are deterministic, versioned and auditable.
2. Each capability declares permissions, trust zone, data classification and side effects.
3. Package adapters translate manifests into capabilities without redefining domain entities.
4. Unknown or over-privileged capability declarations fail closed.
5. No install/dependency or manifest edit without a separate W0 lease.
6. Add contract, validation, least-privilege and adapter tests.
7. Two-phase commits: implementation/artifact, then handoff/worklog `READY_FOR_REVIEW`.

## Mandatory process

Use Socrates to challenge gates/assumptions, orchestrator for the short execution plan,
and builder for implementation. Use:

`/search-first`, `/context-gatherer`, `/quick-spec`, `/backend-patterns`,
`/frontend-patterns`, `/deployment-patterns`, `/security-review`,
`/verification-loop`, `/understand-codebase`, `Design`, `/gpt-taste`,
`/design-taste-frontend`, `/stitch-design-taste`.

Report: gate, files changed, verification, blockers, next handoff. No push/deploy.
