# Loop 10 dispatch — Auth, integrations and grant vault

## Control-plane authority

- Integration ref: `feature/personal-office-baseline-20260728`
- Dispatch base: integration ref containing Loop 08 acceptance (`c594149`)
- Producer branch: `feature/personal-office-loop-10-20260729`
- Producer worktree: `F:\Ai Tools\_wt-starizzi-personal-office-loop10`
- Lease: `LEASE-L10-INTEGRATION-GRANTS-20260729`
- Dependencies: Loops 01, 04 and 08 are ACCEPTED.
- Status authority: only W0 may set `ACCEPTED`.

Kiro W4 is the only authorised Loop 10 writer. Codex remains the only Loop 06
writer. Other Kiro windows are read-only reviewers/spec lanes until W0 grants a
new exact lease.

## Objective

Define a deterministic, secret-free integration-grant contract and a local
grant-vault boundary that can truthfully derive connected, disconnected,
pending, error, locked and invalid/re-auth states without storing raw
credentials in Personal Office artifacts.

This loop creates contracts, validation, mapping and an injected vault facade.
It does not wire IPC, persistence, OAuth, browser redirects, remote APIs or the
existing production `IntegrationsService`.

## Existing seams to reuse

- `IntegrationGrant` and `SecretRef` under `shared/personal-office/` are the
  contract of record.
- Loop 08 blueprint plans carry only integration-grant references.
- `customer-marketing-credential-types.ts` is a legacy input for mapping, not a
  second canonical contract.
- `main/agent/secret-store.ts` is custom-model-key-specific and read-only. Do
  not generalise or modify it in this loop.
- `main/integrations/integrations-service.ts` performs real remote/shell work
  and is read-only.

## Exclusive write paths

- `apps/desktop/src/shared/integration-grants/**`
- `apps/desktop/src/main/integrations/grant-vault/**`
- `apps/desktop/src/shared/personal-office/entities.ts`
- `apps/desktop/src/shared/personal-office/index.ts`
- `apps/desktop/src/shared/personal-office/serialization.test.ts`
- `docs/product/personal-office-integration-grants.md`
- `docs/handoffs/personal-office/loop-10.json`
- `worklogs/personal-office-loop-10.md`

No other path is writable without a new exact W0 change request and lease
amendment.

## Read-only inputs

- `apps/desktop/src/shared/personal-office/**` except the three exact leased
  contract files
- `apps/desktop/src/shared/customer-marketing-credential-types.ts`
- `apps/desktop/src/main/integrations/integrations-service.ts`
- `apps/desktop/src/main/agent/secret-store.ts`
- `apps/desktop/src/main/auth/**`
- `apps/desktop/src/main/db/**`
- `apps/desktop/src/shared/workspace-blueprint/**`
- accepted Loop 04, 07, 08 and 09 contracts

## Hard prohibitions

- No raw token, password, API key, cookie, OAuth code or refresh token in a
  contract, fixture, log, error, event, hash input or handoff.
- No package manifest, lockfile, install or dependency.
- No DB/schema/migration, `main/index.ts`, preload, IPC or renderer.
- No edit to `integrations-service.ts`, `secret-store.ts`, `auth-manager.ts` or
  customer-marketing production services.
- No network, shell/openExternal, OAuth redirect, account mutation, revoke
  request, remote list/connect/disconnect or persistence side effect.
- No workspace/tenant wildcard and no cross-workspace grant reuse.
- No quarantine write, merge, blind cherry-pick, push, main, deploy or publish.

## Required behavior

1. Add a strict versioned integration-grant read model and validators under
   `shared/integration-grants`.
2. Amend canonical `IntegrationGrant` additively with `lastErrorAt?: string`
   and `invalid?: boolean`; do not bump `PERSONAL_OFFICE_SCHEMA_VERSION`.
3. A grant is active only when it is unrevoked, unexpired, not invalid and its
   `SecretRef` is resolvable for the exact workspace/integration/scopes.
4. Derive legacy statuses deterministically:
   - connected → active grant;
   - disconnected → absent/revoked grant;
   - pending → requested but not active;
   - error → grant plus redacted last-error evidence;
   - locked → vault resolver unavailable;
   - invalid → grant requires re-auth.
5. Preserve only redacted reason codes/timestamps. Never preserve legacy error
   strings that may contain credentials.
6. Validate exact tenant/user/workspace/grant/integration scope and sorted,
   unique least-privilege scopes. Reject wildcards, unknown fields and
   credential-shaped identifiers.
7. Add an injected `GrantVault` facade under `main/integrations/grant-vault`.
   It may ask whether a `SecretRef` is resolvable, but must never return or log
   the raw value. Tests use fakes only.
8. Revocation is represented as a deterministic plan/result contract only.
   This loop performs no actual vault deletion or remote disconnect.
9. Serialization/tamper tests must reject raw secrets, scope substitution,
   workspace substitution, forged active state and unknown success fields.
10. Use two-phase commits:
    - Phase 1: leased implementation, tests and product contract.
    - Phase 2: only `loop-10.json` and the worklog.

## Acceptance checks

- Contract, mapping and vault-facade targeted tests.
- Raw-secret and credential-shaped metadata rejection.
- Exact scope, expiry, revoke, locked and invalid/re-auth tests.
- Deterministic canonical serialization and tamper revalidation.
- Main and renderer-compatible TypeScript for shared contracts.
- Exact ownership, prohibited-path, canonical Git-blob hash and secret scans.
- Independent security review is mandatory.
- Full desktop tests/lint/build run only at W0 integration.

## Required roles and skills

Use Socrates to challenge auth, scope and secret assumptions; orchestrator to
sequence; builder to implement. Apply:

`/search-first /context-gatherer /quick-spec /backend-patterns /frontend-patterns /deployment-patterns /security-review /verification-loop /understand-codebase Design /gpt-taste /design-taste-frontend /stitch-design-taste`

Mark UI/design skills as boundary checks because this loop has no renderer
output.
