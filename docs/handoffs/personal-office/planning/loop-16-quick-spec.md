# Loop 16 quick spec — account and IntegrationGrant operation

Status: `IMPLEMENTING`

Canonical base: `8fbb27fec5cc3a203fcfa659179a925b7187479e`

## Outcome

Create a main-only, dependency-injected operation boundary that can connect or
revoke one exact integration grant without allowing renderer identity, raw
OAuth material or legacy success flags to become authority.

## Owned implementation paths

- `apps/desktop/src/main/integrations/grant-operation/**`
- `docs/product/personal-office-integration-grant-operation.md`
- Loop 16 planning, handoff and worklog artifacts

No hot file is leased in this phase. `main/index.ts`, `preload.ts`, auth,
database/schema, renderer, package manifests and the legacy
`integrations-service.ts` remain read-only.

## Invariants

1. Tenant, user, workspace, grant id, integration and scopes come from an
   authenticated main authority.
2. Connect and revoke effects require an approval whose digest binds exact
   action, operation id and scope.
3. The connector returns only an `integration_vault` `SecretRef`; raw tokens,
   OAuth codes, cookies and passwords are rejected.
4. A grant is persisted only after the accepted `GrantVault` resolves the exact
   reference and scope.
5. Revocation order is remote disconnect, vault invalidation, then metadata
   revocation. Partial failure marks the grant invalid and never reports
   success.
6. Receipts contain stable codes and redacted evidence only.

## Verification

- focused grant-operation tests;
- full desktop tests;
- main and renderer TypeScript;
- production build and lint ceiling;
- exact ownership, prohibited path, secret, whitespace and quarantine checks.
