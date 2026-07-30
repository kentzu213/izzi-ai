# Desktop platform E2E trust-envelope playbook

Status: Release Gate R9 cryptographic evidence preparation

R9 verifies detached Ed25519 signatures over the exact canonical R7 platform
evidence and raw operator E2E evidence. It also replays R8 and requires the
supplied structure-validation record to match exactly.

R9 does not decide whether the caller-pinned public-key fingerprints are
approved trust anchors. A successful result therefore verifies signatures but
does not authenticate evidence for release-gate purposes.

## Trust boundary

The verifier consumes only:

- R7 `SIGNED_PLATFORM_EVIDENCE_PASS` JSON;
- raw operator `desktop-platform-e2e-evidence` JSON;
- R8 `UNAUTHENTICATED_E2E_EVIDENCE_STRUCTURE_PASS` JSON;
- one strict detached-signature envelope;
- one Ed25519 SPKI public key for the platform-evidence attestor;
- one distinct Ed25519 SPKI public key for the operator-evidence attestor;
- exact expected SHA-256 fingerprints for both public keys.

Private keys, signing secrets, credentials and personal operator identity must
not be placed in the input directory or passed to R9. Signature creation happens
only in a separately authorized signing system.

## Signature envelope

The envelope must use:

- `artifactKind: desktop-platform-e2e-trust-envelope`;
- the same platform, architecture, version and source commit as R7/R8;
- SHA-256 digests of the canonical R7, operator and R8 records;
- exactly two signatures in this order:
  1. `platform-evidence-attestor`;
  2. `operator-evidence-attestor`;
- distinct key ids and distinct public-key fingerprints;
- `algorithm: Ed25519`;
- signed timestamps no earlier than R8 completion and no more than 24 hours
  later.

Each signature covers a domain-separated canonical payload containing signer
metadata, release identity, the full canonical evidence object, its digest and
the R8 structure-validation digest.

## Public-key fingerprints

R9 fingerprints the DER-encoded SPKI public key:

```text
sha256:<64 lowercase hexadecimal characters>
```

The exact expected values must come from a separately reviewed trust policy.
Supplying a fingerprint to the CLI does not make it approved.

## Safe verification

Create separate canonical input and output directories. Neither directory nor
any input path may be a symlink or junction. The output directory must already
exist.

```powershell
node apps/desktop/scripts/platform-e2e-trust-envelope-validator.mjs `
  --input-root "C:\release-evidence\input" `
  --platform-evidence "windows-signed.json" `
  --e2e-evidence "windows-e2e.json" `
  --structure-validation "windows-structure.json" `
  --envelope "windows-trust-envelope.json" `
  --platform-public-key "platform-attestor.pub.pem" `
  --operator-public-key "operator-attestor.pub.pem" `
  --platform-key-fingerprint "sha256:<approved-platform-key-fingerprint>" `
  --operator-key-fingerprint "sha256:<approved-operator-key-fingerprint>" `
  --output-root "C:\release-evidence\output" `
  --output "windows-signatures-verified.json"
```

Expected decision: `PINNED_PUBLIC_KEY_SIGNATURES_VERIFIED`.

The output always keeps:

- `trustAnchorAccepted: false`;
- `evidenceAuthenticated: false`;
- `releaseGateAdvanceAllowed: false`;
- `stableReleaseAccepted: false`.

## Failure handling

- Preserve failed inputs and detached evidence unchanged.
- Never overwrite a prior verification result.
- Reject any private-key PEM immediately.
- Treat signature, key, fingerprint, digest, timestamp, role or R8 replay
  mismatch as a hard failure.
- Correct the evidence/signing source; never edit a verifier output.
- Require a separate W0 trust-anchor acceptance before making any evidence
  authentication or release-gate advancement decision.
