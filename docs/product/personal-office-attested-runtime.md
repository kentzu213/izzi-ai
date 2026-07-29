# Personal Office attested browser runtime

Status: Loop 17 provisional adapter boundary

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
least-privilege scopes cannot be widened. The output is a digest-bound launch
authorization, not evidence that a browser or external action ran.

This code does not bundle or start Playwright. Production registration and the
complete Market → install → provision → open → delegate → artifact proof remain
blocked on audited adapters and a hot-file composition lease.
