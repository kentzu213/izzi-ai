# Release Gate R9 quick spec — pinned-key trust-envelope verifier

Status: `LEASE_READY`

Canonical base: `99c3c568b59c6575b0fea01313b2203f3860b906`

## Intent

Cryptographically verify detached signatures over immutable R7 platform
evidence and raw operator E2E evidence, while remaining fail-closed about the
approval status of the caller-supplied public-key fingerprints.

## User journey

As a release reviewer, I want a deterministic verifier to prove that the exact
R7 and operator evidence bytes represented by canonical JSON were signed by
two distinct expected public keys, so that a later human-controlled trust-anchor
decision can review cryptographic evidence without running an installer,
workflow or platform verifier.

## Scope

In:

- dependency-free Node ESM verifier and built-in tests;
- Ed25519 SPKI public-key parsing and SHA-256 fingerprint pinning;
- domain-separated detached-signature verification;
- exact R7/R8 replay and evidence digest binding;
- canonical input/output containment and create-only result;
- public-key-only operator playbook.

Out:

- private-key generation, loading or signing;
- trust-anchor approval;
- workflow, installer, application, browser, platform or network execution;
- package/lockfile, product-source or release-workflow changes;
- release-gate advancement, stable acceptance, push, tag, publish or deploy.

## Requirements

1. WHEN either key file contains private-key material or is not Ed25519 SPKI,
   THEN validation fails before signature verification.
2. WHEN a key fingerprint differs from the exact caller pin, THEN validation
   fails closed.
3. WHEN both signer roles reuse the same key id or key fingerprint, THEN
   validation fails closed.
4. WHEN the R8 structure output differs from a fresh deterministic replay over
   the supplied R7 and operator evidence, THEN validation fails closed.
5. WHEN any signed payload, signature, signer role, key id, timestamp or digest
   is changed, THEN validation fails closed.
6. WHEN all cryptographic checks pass, THEN output reports
   `signatureVerificationSucceeded: true` but keeps
   `trustAnchorAccepted: false`, `evidenceAuthenticated: false`,
   `releaseGateAdvanceAllowed: false` and `stableReleaseAccepted: false`.

## TDD tasks

- [ ] Write deterministic Ed25519 fixtures and happy-path test.
- [ ] Write tampered payload/signature/key/fingerprint tests.
- [ ] Write same-key role-reuse and private-key-material rejection tests.
- [ ] Write R8 replay mismatch and exact envelope schema tests.
- [ ] Write canonical containment, junction and create-only output tests.
- [ ] Implement the minimum verifier required to make all tests pass.
- [ ] Produce immutable handoff, artifact hashes and worklog.

## Verification

- `node --test` and `node --check`;
- changed-file ESLint on canonical toolchain;
- exact ownership/prohibited-path/secret audit;
- independent correctness and security/Socrates review;
- full canonical desktop test/build/lint gates after exact replay.
