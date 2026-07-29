# Personal Office Loop 17 — provisional attested browser adapter

Status: `PROVISIONAL`

Base: `0f32a0ca2d3155af0ff103a5fe0239e0f0e62091`

Implemented a new isolated wrapper for future managed Playwright drivers. It
requires a current SHA-256 attestation, exact package identity, visible review
mode, encrypted state, contained URL origins and idempotent replay support
before delegating to the browser driver.

Added an operational launch gate that strictly joins a completed Marketplace
installation receipt, a connected IntegrationGrant receipt and exact browser
runtime authority. Tenant, user, workspace, package, integration, grant, run
and least-privilege scopes must all match before a digest-bound authorization
is minted.

Added a local isolated E2E using the real WorkService, approval decision,
encrypted state store, atomic effect-claim store, BrowserRuntimeCoordinator and
attested driver wrapper. It proves one approved action produces durable draft
and effect-receipt artifacts and invokes the idempotent fake driver once.

Added a fail-closed operational service that resolves Marketplace and grant
receipts from one main-authoritative port before preparation, re-resolves them
before execution, and denies any receipt, scope or authorization drift. Grants
must now use exact least-privilege scopes; completed Marketplace evidence must
show a fully successful ordered pipeline with a matching approval.

Verification: focused 22/22; full desktop 132 files / 1420 tests; main TypeScript
and production build pass; changed-surface lint 0 warnings; repository lint 0
errors / 350 warnings.

This is intentionally not READY_FOR_REVIEW or ACCEPTED. Production Playwright
registration, authoritative receipt adapters, main composition and the real
adapter-backed Market → install → provision → open → delegate → artifact proof
remain missing.
No browser, network, install, secret or external effect was used.

Method: Codex-only under the `security-review`, `backend-patterns` and
`verification-loop` skills; Kiro held no writer authority.
