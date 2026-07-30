# Personal Office operational attested browser runtime

Status: Loop 17 `PROVISIONAL`

The accepted browser coordinator already enforces exact runtime/grant
authorization, per-request URL checks, encrypted storage state, approval
binding and atomic external-effect claims. This boundary prevents an arbitrary
browser implementation from being registered beneath it.

A managed driver must present a current attestation binding its adapter id,
version, Playwright kind, executable/package digest, exact package id and the
maximum allowed origins. Runtime policy may narrow those origins but cannot
widen them. Hidden mode, plaintext storage state, stale attestations and
non-idempotent drivers fail before `open()`.

The operational launch gate additionally joins the previously separate
Marketplace, grant and runtime evidence. A planned, blocked or partial install
cannot open; a foreign workspace/package/grant cannot be substituted; missing
or excess scopes cannot be accepted. The complete runtime spec, exact receipt
evidence and matching Work approvals are bound into the authorization. The
output is a digest-bound launch authorization, not evidence that a browser or
external action ran.

`OperationalBrowserService` resolves authoritative Marketplace and grant
receipts before preparation and again before execution. It rejects evidence,
scope, budget, network or runtime drift before delegating to the browser
coordinator.

`EncryptedOperationalEvidenceStore` and the browser state store encrypt atomic
writes through an injected provider. Evidence lookup binds tenant, user,
workspace, package, integration, grant, run, runtime id and the SHA-256 digest
of the complete runtime spec. Decrypted records are parsed and digest-verified
again before use.

The provisional managed driver defines a narrow Playwright-compatible port
without importing Playwright. A production adapter must supply an exact
attested executable, headed sandboxed launch, one isolated fixed-viewport
context, blocked service workers, disabled downloads, phase-aware
HTTP/redirect routing, bounded timeouts, encrypted state handoff and an
explicit endpoint idempotency authority. WebSockets remain deny-all under
`WEBSOCKET_AUTHORITY_NOT_REQUIRED_FOR_V1`: no accepted v1 browser workflow
requires a socket, HTTP allowlisting does not imply socket authority, and the
separate `.ocx` `net.websocket` permission is not transitive browser-runtime
authority. A future socket consumer must first pass a contract change request.

Raw Playwright traces are intentionally disabled at this boundary because they
may contain DOM, headers or session material. The driver emits only
query-stripped audit URLs and stores only screenshot SHA-256/byte metadata; it
does not persist screenshot pixels.

This code does not declare, bundle, register or start Playwright. Production
registration and the complete Market → install → grant → open → delegate →
artifact proof remain blocked on the requested dependency provenance,
main-authoritative operation hooks, runtime composition leases and a real
adapter-backed E2E.
