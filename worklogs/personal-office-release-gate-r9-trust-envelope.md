# Personal Office Release Gate R9 — pinned-key trust envelope

Status: `READY_FOR_REVIEW`

Base: `2223c88f48b7c2725d457ab267bb8fe6d0d16304`

Implementation: `fd21814d0a610a472c46246dc8fab4058f216c89`

R9 verifies detached Ed25519 signatures over the exact canonical R7 platform
evidence and raw operator E2E evidence. It replays R8 over those inputs and
requires the supplied structure-validation output to match exactly.

The verifier accepts only Ed25519 SPKI public keys. It rejects private-key
material, malformed/non-Ed25519 keys, fingerprint mismatch, same-key role
reuse, envelope identity/digest drift, malformed signatures, invalid signer
roles, out-of-window timestamps, R8 replay mismatch, path traversal, junctions
and output overwrite.

## Trust ruling

The exact expected public-key fingerprints are caller inputs. R9 proves that
the supplied public keys match those pins and that both detached signatures are
valid, but it cannot prove the pins themselves are approved trust anchors.

Successful output therefore reports:

- `decision: PINNED_PUBLIC_KEY_SIGNATURES_VERIFIED`;
- `signatureVerificationSucceeded: true`;
- `trustAnchorAccepted: false`;
- `evidenceAuthenticated: false`;
- `releaseGateAdvanceAllowed: false`;
- `stableReleaseAccepted: false`.

## TDD and verification

- Red phase session observation: the test file was added first and the test
  command failed with `ERR_MODULE_NOT_FOUND` before implementation. This was not
  preserved as a separate Git commit, so branch history cannot independently
  reconstruct the red phase.
- Green phase: 9/9 built-in Node tests pass.
- Real crypto: RFC 8032 Ed25519 public test vector passes and a tampered message
  fails.
- Coverage for the new verifier: 86.27% lines, 83.33% branches and 93.75%
  functions.
- Syntax: `node --check` passes for verifier and test.
- Ownership, prohibited-path, secret scan and `git diff --check`: PASS.
- GitNexus returned no indexed symbol result for the new untracked files before
  commit; exact shell ownership and path audit remain the evidence.
- Producer lint remains pending canonical replay because the isolated worktree
  has no `node_modules`; no install or junction was authorized.

## Security boundary

No private key, signing secret, credential or personal operator identity was
read, generated, logged or stored. Public RFC test-vector keys/signatures are
the only cryptographic fixtures.

No package, lockfile, workflow, release configuration, product source,
DB/schema, auth, preload, renderer or quarantine path is changed. No install,
workflow, installer/application/browser/platform-verifier/network action,
GitHub mutation, push, tag, publish, deploy, release-gate advancement or stable
promotion is authorized or performed.
