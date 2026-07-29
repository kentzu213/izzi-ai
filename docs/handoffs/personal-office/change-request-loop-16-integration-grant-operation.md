# CHANGE_REQUEST — Loop 16 account and IntegrationGrant operation

Status: `APPROVED_FOR_ISOLATED_IMPLEMENTATION`
Requester: W0 Control Tower / Codex
Decision authority: W0

## Target

- `apps/desktop/src/main/integrations/grant-operation/**`
- bounded Loop 16 tests and product/governance artifacts

## Reason

Loop 10 is plan/read-only and Loop 15 cannot advance through exact grants.
Personal Office needs a main-only effect boundary that binds izziapi identity to
tenant/user/workspace scope, requires Work approval, accepts only `SecretRef`,
and makes vault resolvability authoritative.

## Security decision

No hot file is leased. `main/index.ts`, `preload.ts`, auth implementation,
database/schema, renderer, legacy integrations service, package manifests,
runtime adapters and quarantine remain read-only. Production adapter
registration is deferred until this boundary passes independent verification.
