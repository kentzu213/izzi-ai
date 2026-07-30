# Loop 15 quick spec

## Intent

Replace the renderer-owned demo Marketplace path with a main-authoritative,
host-validated catalog and a resumable install operation that reports every
stage truthfully. A plan or approval receipt is never installation evidence.

## Scope

- In: audited catalog IPC, main-derived identity/workspace scope, immutable plan
  revalidation, package-byte/signature evidence ports, Work approval binding,
  exact-grant checks, workspace provisioning, installer port, stage receipts,
  renderer progress/error states and focused tests.
- Out: OAuth/grant persistence (Loop 16), production browser/native adapters
  (Loop 17), DB/schema changes, package or lockfile changes, secret retrieval,
  legacy installer rewrites, automatic download/install during tests, push,
  deploy or release.

## Requirements

1. WHEN the renderer requests a catalog, THEN main must return only a catalog
   rebuilt from strict public metadata plus a capability registry snapshot whose
   audit verifies. No demo fallback is allowed.
2. WHEN the renderer requests a plan, THEN tenant, user and workspace scope are
   derived in main from the authenticated session and canonical workspace. The
   renderer may select only a package key.
3. WHEN an install operation starts or resumes, THEN main must parse the
   submitted plan and recreate it from current catalog authority; any byte-level
   difference or registry/catalog drift fails closed.
4. WHEN package evidence is checked, THEN package identity, content digest and
   publisher-signature digest must match the reviewed plan/catalog before an
   approval or side effect can be considered.
5. WHEN approval is required, THEN a Work approval binds the exact plan and
   package evidence. Pending, rejected, expired, edited or invalidated approval
   states never execute a grant, provisioning or install port.
6. WHEN grants are required, THEN every exact permission and scope must resolve;
   missing or unavailable grants return a partial receipt and perform no later
   stage.
7. WHEN provisioning or installation fails, THEN completed earlier stages stay
   visible and the receipt must not claim workspace or package success.
8. WHEN production lacks an audited catalog, grant authority, provisioner or
   installer adapter, THEN the host returns a stable unavailable/blocked result;
   it never falls back to legacy unaudited install handlers.

## Tasks

- [ ] Add versioned operation receipts and strict parsers.
- [ ] Add catalog authority and install-operation services with injected ports.
- [ ] Add trusted-sender IPC and typed preload bridge.
- [ ] Replace demo loading and renderer-entered identity scope.
- [ ] Add pending/resume/blocked/completed UI states.
- [ ] Prove no side-effect port runs before all preceding evidence passes.
- [ ] Run security, ownership, provenance and full verification gates.

## Verification

- Focused Marketplace contract/service/IPC/store/component tests.
- Main and renderer TypeScript.
- Full desktop tests, production build and lint ceiling.
- Exact ownership/prohibited-path audit, added-line secret scan and
  `git diff --check`.
- GitNexus detect-changes with the known stale-index limitation recorded.
- Quarantine HEAD, 459-entry status and fingerprint remain unchanged.
