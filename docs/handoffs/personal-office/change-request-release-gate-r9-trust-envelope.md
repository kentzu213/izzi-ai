# CHANGE_REQUEST — Release Gate R9 pinned-key trust-envelope verifier

Status: `APPROVED_FOR_ISOLATED_PRODUCER`

Gate: `RELEASE-GATE-R9-TRUST-ENVELOPE`

Decision authority: W0 Control Tower / Codex

Canonical base: `99c3c568b59c6575b0fea01313b2203f3860b906`

## Purpose

R8 proves only that supplied R7 and operator JSON records have valid structure
and internal binding. R9 adds a dependency-free cryptographic verifier for
detached Ed25519 signatures over the immutable R7 platform evidence and raw
operator E2E evidence.

R9 requires caller-supplied expected SHA-256 fingerprints for two distinct
public keys. It verifies signatures and binds the resulting record to the exact
R8 structure-validation output. It does not decide whether those fingerprints
are approved trust anchors, and therefore cannot authenticate the evidence for
release-gate purposes or advance Release Gate R.

## Exact producer paths

- `apps/desktop/scripts/platform-e2e-trust-envelope-validator.mjs`
- `apps/desktop/scripts/platform-e2e-trust-envelope-validator.test.mjs`
- `docs/desktop-platform-e2e-trust-envelope-playbook.md`
- `docs/handoffs/personal-office/release-gate-r9-trust-envelope.json`
- `worklogs/personal-office-release-gate-r9-trust-envelope.md`

All five paths are new. R7 and R8 artifacts are read-only dependencies.

## Authorized implementation

1. Read exact R7 platform evidence, raw operator E2E evidence, R8 structure
   validation, a detached-signature envelope and two public-key files under
   canonical, non-symlink input roots.
2. Re-run the R8 structural validator and require exact canonical equality with
   the supplied R8 output.
3. Require two distinct Ed25519 SPKI public keys and exact caller-pinned
   `sha256:<hex>` fingerprints. Reject private-key material.
4. Verify domain-separated detached signatures over canonical R7 platform
   evidence and canonical raw operator E2E evidence.
5. Bind platform, architecture, version, source commit, evidence digests,
   signer roles, key ids, key fingerprints and signed timestamps exactly.
6. Emit deterministic create-only verification evidence with
   `signatureVerificationSucceeded: true`, `trustAnchorAccepted: false`,
   `evidenceAuthenticated: false`, `releaseGateAdvanceAllowed: false` and
   `stableReleaseAccepted: false`.

## Constraints

- No private key, signing secret, credential or personal operator identity may
  be read, generated, logged or stored.
- Do not claim caller-supplied fingerprints are approved trust anchors.
- Do not modify package manifests, lockfiles, workflows, release configuration,
  product source, DB/schema, auth, preload or renderer paths.
- Do not install dependencies or execute workflow, installer, application,
  browser, platform verifier or network actions.
- Do not push, tag, publish, deploy, mutate GitHub or promote stable.
- Do not write, reset, stash, clean or commit the quarantine worktree.
- The producer may write only the five exact paths above.

## Required proof

- tests are written before implementation and cover valid signatures, tampered
  payload/signature/key, same-key role reuse, private-key rejection, R8 replay
  mismatch, fingerprint mismatch, traversal/junction and create-only output;
- independent correctness and security/Socrates review pass;
- full canonical tests, TypeScript, build and lint pass before acceptance.
