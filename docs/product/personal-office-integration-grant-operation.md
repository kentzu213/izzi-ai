# Personal Office integration grant operation

Status: Loop 16 main-operation boundary

Loop 10 established the strict secret-free grant contracts. Loop 16 adds the
main-only operation boundary that connects and revokes an exact grant through
injected authorities. It does not register a production OAuth adapter, expose a
new renderer bridge, retrieve a secret, or mutate the legacy integration flow.

## Authority and approval

The caller supplies only an integration name, least-privilege scopes and an
idempotency key. Authenticated main authority resolves the exact tenant, user,
workspace and grant id. Connect and revoke each create a deterministic operation
id and approval binding digest. A missing, pending, rejected, expired,
invalidated or digest-mismatched approval stops every later effect.

## Secret boundary

The OAuth/connect adapter must vault credentials itself and return only a
`SecretRef` with `store: integration_vault`. Raw access tokens, refresh tokens,
OAuth codes, passwords, API keys and cookies are not valid connector output and
cannot be persisted or returned in receipts.

After connect, the accepted `GrantVault` independently verifies the exact scope
binding and reference resolvability. Metadata persistence happens only after
that check succeeds. A runtime may treat a grant as active only through this
vault-backed authority.

## Revocation order

Revocation is deliberately ordered:

1. authenticated exact scope and existing grant;
2. exact approval binding;
3. remote disconnect;
4. vault reference invalidation;
5. metadata marked revoked.

If remote disconnect fails, no local authority is changed. If remote disconnect
succeeds but vault or metadata cleanup fails, the grant is marked invalid and
the receipt remains failed. Partial work is never labelled revoked.

## Production boundary

Production account/OAuth, repository and vault adapters remain unregistered in
this loop. Registering them requires a separate hot-file lease for the main IPC
composition root and an audited server/API contract. No push, deploy, external
OAuth action, secret retrieval or browser automation is authorized here.
