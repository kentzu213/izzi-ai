# Personal Office integration grants

Loop 10 defines the secret-free read and planning boundary for integrations.
It does not connect accounts, resolve credentials, persist records, open OAuth
flows, call remote APIs, or revoke anything.

## Contract

- `IntegrationGrant` remains on `PERSONAL_OFFICE_SCHEMA_VERSION = 1`.
- `lastErrorAt` and `invalid` are additive optional evidence fields.
- A read model binds tenant, user, workspace, grant, integration and sorted
  least-privilege scopes.
- Tenant/user binding is never inferred from grant metadata. Mapping,
  deserialization and revocation require an `expectedScope` supplied by the
  authenticated host/workspace context; the vault facade independently asks an
  injected scope authority before resolving a reference.
- Raw tokens, passwords, API keys, cookies, OAuth codes, refresh tokens and
  legacy error strings are forbidden.
- A credential is represented only by `SecretRef`. Vault inspection returns
  only `resolvable`, `missing` or `unavailable`.

## State derivation

| Legacy evidence | Personal Office state |
| --- | --- |
| connected + exact live grant + resolvable ref | active |
| disconnected + absent or revoked grant | disconnected |
| pending | pending |
| error + grant | error with redacted timestamp only |
| locked/unavailable resolver | locked |
| invalid, expired, missing ref or inconsistent scope | invalid |

No legacy success flag is authoritative by itself. Active state is fail-closed
and must be revalidated after serialization.

## Revocation

Revocation produces a deterministic `plan_only` contract and a planned/rejected
result. Execution, vault deletion and remote disconnect remain future work
behind an explicit approval and runtime lease.
