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

Added an encrypted atomic evidence store. Its key binds tenant, user, workspace,
package, integration, grant, run, runtime id and the SHA-256 digest of the full
runtime spec. Persisted records carry their own canonical digest, are validated
again after decryption, and are rejected on scope, policy or ciphertext drift.
An injectable Electron safeStorage adapter supplies the OS-backed encryption
boundary without importing or initializing Electron in tests.

Added a dependency-injected managed Playwright-compatible driver in commit
`0c31987db0c14e2da83a6edc5d179d83e25511d9`. It imports no Playwright package
and therefore cannot silently rely on a transitive dependency. A future adapter
must supply the exact browser type port and executable verifier.

Added the offline authoritative operation-receipt lifecycle in commit
`d863c03afe7bf93faa73d8ab4a86f6f1a5ff44da`. Completed Marketplace receipts and
connected IntegrationGrant receipts are now stored in a separate encrypted,
digest-validated authority store keyed without raw tenant, user, workspace,
package or grant identifiers in filenames. Connected grant receipts carry
main-derived tenant and user authority. Revocation writes an encrypted tombstone
before remote disconnect, vault cleanup or metadata mutation, so restart and
execute-time revalidation deny stale grants.

Marketplace now requires the authoritative receipt sink before workspace
provisioning or package installation. A successful install is returned as
`completed` only after the exact completed receipt is durably recorded. If
recording fails after installation, the returned receipt remains truthfully
`blocked`, preserves the real workspace/package evidence and ends at the
`operational_evidence` stage.

IntegrationGrant connect and revoke now fail closed before connector effects
when the evidence authority is unavailable. If connected-receipt persistence
fails, the service records a tombstone first, attempts remote and credential
cleanup, marks repository metadata invalid, and returns
`EVIDENCE_COMPENSATION_FAILED` whenever any compensation step is incomplete.
The operational browser service calls authoritative `ensure()` before both
prepare and execute and removes stale cached evidence when authoritative
receipts are absent or revoked.

The managed boundary requires an exact absolute executable path and matching
SHA-256 verification before launch. Launch is headed and sandboxed. Every open
creates one fixed-viewport non-persistent context with service workers blocked,
downloads disabled, encrypted state import/export and bounded timeouts.

Security review found that origin allowlisting alone would let page JavaScript
issue an allowlisted POST during the nominal read phase. The final route policy
therefore permits only GET/HEAD/OPTIONS while preparing. Submit permits one
exact POST only after endpoint-specific idempotency authority, then permits
allowlisted GET/HEAD redirects. Requests outside an active operation are
aborted. WebSockets are denied because the accepted runtime contract has no
socket-effect authority.

Raw Playwright trace archives and screenshot pixels are not persisted. Audit
traces remove query/hash data, page text is redacted, screenshots become only a
SHA-256/byte-count record, and response bodies are bounded and kept in memory
only long enough for the coordinator to create its exact digest.

Created
`docs/handoffs/personal-office/change-request-loop-17-production-runtime.md`.
It requests, but does not grant, the package/lockfile provenance lease,
`main/index.ts` composition lease, authoritative operation-to-evidence hooks
and real adapter-backed E2E authority.

Verification: focused 8 files / 55 tests; full desktop 136 files / 1447 tests; main and
renderer TypeScript pass; production build passes with the existing large-chunk
advisory; changed-surface lint 0 warnings; repository lint 0 errors / 350
warnings. Ownership, prohibited-path, undeclared-import, secret and diff checks
pass. All 13 implementation paths are covered by the active exact-path lease.
Independent read-only review initially found that the Marketplace evidence gate
ran after workspace provisioning; it was moved before provisioning and the
re-review passed. GitNexus remained degraded because the baseline index returned
11 changed files but zero changed symbols, so manual dependency review plus the
focused/full gates were used. Canonical remains clean. Quarantine remains read-only at
`959e2d28ece81ceaa1a0f51dde5cc8a0b8d330c5`, 459 entries, fingerprint
`b8b124cd1de43b73ef1cf3697df519f1049ccd923ecb024dd9bf166be82c1c8d`
using the established LF/no-trailing-newline method.

The offline authoritative-receipt subphase is `REVIEWED_PASS`, but Loop 17 as a
whole intentionally remains `PROVISIONAL`, not ACCEPTED. Production Playwright
dependency/lock provenance, audited `main/index.ts` composition, production
adapter registration and the real adapter-backed Market → install → provision
→ open → delegate → artifact proof remain missing.
No browser, network, install, secret or external effect was used.

Method: Codex-only under the `security-review`, `backend-patterns` and
`verification-loop` skills; Kiro held no writer authority.
