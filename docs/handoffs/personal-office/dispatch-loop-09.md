# Loop 09 runnable handoff — Marketplace and installer planning

Status: READY_TO_START
Base: current `feature/personal-office-baseline-20260728`
Lease: `LEASE-L09-MARKETPLACE-UI-20260729`

## Goal

Turn the existing Marketplace page into a trustworthy Personal Office catalog
and install-intent surface that consumes Loop 07 capability metadata. A user
must understand what an application needs before confirming it. This loop plans
installation; it does not activate runtimes, download code, mutate accounts or
provision a workspace without a later exact seam lease.

## Exclusive write scope

- `apps/desktop/src/shared/marketplace/**`
- `apps/desktop/src/main/marketplace/**`
- `apps/desktop/src/renderer/components/marketplace/**`
- `apps/desktop/src/renderer/store/marketplacePersonalOffice.ts`
- `apps/desktop/src/renderer/pages/Marketplace.tsx`
- `apps/desktop/src/renderer/styles/marketplace-personal-office.css`
- `docs/product/personal-office-marketplace.md`

Loop 07 capability contracts, extension runtime, Electron seams, shell, package
manifests and Marketplace API are read-only. Request a new W0 lease before
touching any of them.

## Required behavior

1. Model catalog, package detail, compatibility and install intent with strict
   versioned validation and stable package identity.
2. Display permissions, trust zone, classifications and side effects from the
   accepted capability registry; never infer broader authority.
3. Separate remote, cached, offline, demo, installed and incompatible states.
   Demo data must be visibly labelled and cannot drive an install confirmation.
4. Confirmation creates only a deterministic, reviewable install plan. It
   cannot download, execute, grant permissions, activate a runtime or claim
   provisioning succeeded.
5. Keep existing Marketplace navigation mounted without editing `App.tsx`.
6. Cover loading, empty, error, offline, incompatible, permission review and
   canceled confirmation states with focused unit/component tests.
7. Use two-phase commits: implementation/artifact, then handoff/worklog
   `READY_FOR_REVIEW`.

## Security gate

Fail closed on untrusted package metadata, permission widening, unsigned or
unsupported versions, tenant/workspace ambiguity, raw secrets, command/env
execution, remote downloads and fabricated install success.

## Mandatory process

Use Socrates to challenge trust and install claims, orchestrator for the bounded
plan, and builder for implementation. Apply:

`/search-first`, `/context-gatherer`, `/quick-spec`, `/backend-patterns`,
`/frontend-patterns`, `/deployment-patterns`, `/security-review`,
`/verification-loop`, `/understand-codebase`, `Design`, `/gpt-taste`,
`/design-taste-frontend`, `/stitch-design-taste`.

Report gate, files, tests/typecheck/lint, visual accessibility checks, blockers
and next seam request. No push, deploy, install or quarantine write.
