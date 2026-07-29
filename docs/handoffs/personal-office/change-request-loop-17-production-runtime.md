# CHANGE_REQUEST — Loop 17 production browser runtime

Status: `REQUESTED_NOT_GRANTED`
Requester: Loop 17 / Codex control tower
Decision authority: W0

## Purpose

The isolated Loop 17 contracts, attestation wrapper, operational evidence gate,
encrypted stores and dependency-injected managed driver are implemented and
locally testable. They deliberately do not fabricate a production Playwright
registration while the canonical application has no declared Playwright
dependency and `main/index.ts` still registers unavailable/deny-all production
ports.

This request records the exact authority needed for a later production pass. It
does not grant a lease and authorizes no installation or browser execution.

## Requested dependency provenance lease

Targets:

- `apps/desktop/package.json`
- `pnpm-lock.yaml`

Requested action:

1. Declare one exact supported Playwright package/version.
2. Update the lockfile through the repository package manager.
3. Record package and browser-binary provenance, integrity and license evidence.
4. Prohibit imports from undeclared transitive dependencies.

Required approval:

- explicit W0 single-owner package/lockfile lease;
- explicit approval before any install or browser download;
- dependency and supply-chain security review.

## Requested production composition lease

Targets:

- `apps/desktop/src/main/index.ts`
- a new production-only runtime adapter/registration path under
  `apps/desktop/src/main/runtime/**`

Requested action:

1. Register the declared Playwright adapter through the existing
   `ManagedPlaywrightPort`.
2. Resolve one exact executable path and verify its SHA-256 before every open.
3. Construct the accepted `AttestedBrowserDriver`,
   `BrowserRuntimeCoordinator` and `OperationalBrowserService`.
4. Keep runtime authorization main-authoritative and deny launch when any
   dependency, attestation, encryption, evidence, scope or reviewer authority
   is unavailable.

Required approval:

- exact W0 `main/index.ts` hot-file lease;
- no preload/renderer exposure unless separately requested and reviewed;
- no fallback to legacy `IntegrationsService`, renderer-supplied receipts or
  deny-all placeholder ports presented as operational.

## Requested authoritative operation hooks

Targets:

- bounded output hooks in the accepted Marketplace install operation;
- bounded output hooks in the accepted IntegrationGrant operation;
- the accepted encrypted operational evidence store.

Requested action:

1. Record evidence only after a completed Marketplace receipt and a connected
   exact IntegrationGrant receipt have been produced by their authoritative
   services.
2. Bind exact tenant, user, workspace, package, integration, grant, run,
   runtime id, runtime digest and least-privilege scopes.
3. Never accept renderer-, agent- or package-supplied receipts as authority.
4. Define revocation/rotation behavior that makes old evidence unavailable
   before a later execute revalidation.

Required approval:

- exact change request and lease for every accepted operation file touched;
- independent security review for tenant/workspace scope, revocation and
  secret-reference handling.

## Requested real adapter-backed E2E authority

The future proof must cover:

1. host-validated Marketplace catalog and install plan;
2. approved package installation receipt;
3. approved, connected exact IntegrationGrant receipt;
4. encrypted evidence recording;
5. exact executable attestation;
6. visible isolated browser open with service workers blocked;
7. allowlisted read and reviewed Work artifact;
8. explicit Work approval bound to immutable action input;
9. endpoint-specific idempotency authority;
10. one external effect and one durable effect receipt;
11. encrypted state export and cleanup;
12. denial on receipt, scope, runtime, network, executable or approval drift.

This E2E requires explicit authorization for a local browser launch and test
network endpoint. Until that authority exists, fake-port E2E is the strongest
permitted proof.

## Prohibited shortcuts

- No blind merge/cherry-pick.
- No undeclared Playwright/Puppeteer/Electron substitution.
- No hidden/headless production mode.
- No plaintext storage state, raw trace archive or persisted screenshot pixels.
- No browser download or install under an unleased package change.
- No direct secret value in runtime specs, evidence, logs or renderer IPC.
- No use of quarantine as source, dependency or executable authority.
- No push, main merge, deploy or external production effect.

## Verification required after approval

1. Exact-path ownership and lease audit.
2. Package/lockfile provenance and vulnerability review.
3. Focused driver, evidence, operational gate and adapter-backed E2E tests.
4. Full desktop tests, main/renderer TypeScript, production build and lint
   ceiling.
5. Secret scan, prohibited-path audit, GitNexus impact/detect-changes and
   quarantine fingerprint.
6. Independent correctness and security review before W0 integration.
