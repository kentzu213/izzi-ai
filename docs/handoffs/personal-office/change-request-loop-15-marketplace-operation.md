# CHANGE_REQUEST — Loop 15 host-validated Marketplace operation

Status: `APPROVED`
Requester: W0 Control Tower / Codex
Lease: `LEASE-L15-MARKETPLACE-OPERATION-20260729`
Decision authority: W0

## Target

- `apps/desktop/src/shared/marketplace/**`
  - add versioned operation receipt/result contracts and strict parsing;
  - keep the accepted catalog and install-plan contracts authoritative.
- `apps/desktop/src/main/marketplace/**`
  - add catalog authority, install-operation orchestration, injected side-effect
    ports, stable error codes and trusted-sender IPC.
- `apps/desktop/src/main/index.ts`
  - register the bounded Marketplace IPC using authenticated main authority,
    canonical personal workspace and safe unavailable production effect ports;
  - do not connect the legacy `extensions:runtime:installFromMarketplace`.
- `apps/desktop/src/main/preload.ts`
  - expose catalog, create-plan, request-operation and resume-operation methods.
- `apps/desktop/src/renderer/pages/Marketplace.tsx`
  - load only the host catalog and delegate plan/operation creation to main.
- `apps/desktop/src/renderer/store/marketplacePersonalOffice.ts`
  - track async plan and operation stages without renderer-owned identity scope.
- `apps/desktop/src/renderer/components/marketplace/MarketplacePageView.tsx`
  - present approval-pending, blocked, failed and completed receipts truthfully.
- bounded tests, renderer global typing, Marketplace CSS and product docs for the
  paths above.

## Reason

The accepted Loop 09 UI intentionally shows non-installable demo records and
creates only `effect: plan_only`. The legacy extension installer is a separate
unaudited path: it accepts renderer extension ids, lacks the Personal Office
plan/approval/grant/provisioning boundary and does not verify a publisher
signature over the package bytes. Connecting the new UI directly to it would
turn a review receipt into fabricated authority.

## Intended patch

1. Main loads strict public catalog metadata and an audited capability registry
   through injected authority ports, then uses the accepted catalog adapter.
2. Main derives a non-PII reviewer id and canonical `personal` workspace scope;
   renderer may never submit tenant/user/workspace authority.
3. Main creates the plan, and every request/resume re-parses and re-creates it
   from current authority before comparing canonical bytes.
4. Package verification binds exact package identity, content digest and
   publisher-signature digest.
5. Work approval binds canonical plan plus package evidence. Only an unchanged,
   approved receipt may advance.
6. Exact grants, workspace provisioning and installation execute in order
   through injected ports. A failed or unavailable stage stops later stages.
7. Renderer receives stable, secret-free stage receipts. No URL, local path,
   token, raw user id or package handle crosses preload.
8. Production ports remain unavailable until their later-loop authorities are
   operational; tests use fakes and perform no download/install.

## Security decision

- `main/index.ts`, `main/preload.ts` and Marketplace renderer paths are hot and
  leased only for the bounded bridge above.
- Auth implementation, DB/schema, Work internals, capability registry/policies,
  grant-vault internals, provisioning contracts, extension manager/loader/
  installer/download code, runtime adapters, packages and manifests are
  read-only.
- Unknown/child-frame senders, unauthenticated users, foreign workspace scope,
  catalog/registry/plan drift, digest/signature mismatch, unapproved Work gates,
  unresolved grants and unavailable effect ports fail closed.
- No push, deploy, package install, real Marketplace download, browser
  automation enablement or secret retrieval is authorized.

## Proof

1. Service tests prove exact stage order and that later ports are not called
   after every failure/pending branch.
2. IPC tests prove trusted sender and main-derived identity/workspace authority.
3. Renderer tests prove no demo fallback, no identity scope form and no false
   install-success copy.
4. Main/renderer TypeScript, focused/full tests, build and lint ceiling pass.
5. Ownership, prohibited paths, secret scan, provenance, `git diff --check`,
   GitNexus detect-changes and quarantine fingerprint pass.
