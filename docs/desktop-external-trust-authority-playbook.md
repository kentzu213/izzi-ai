# Desktop external trust-authority playbook

Status: `BLOCKED_AWAITING_APPROVED_TRUST_ANCHORS`

This playbook defines the authority boundary after Release Gate R9. R9 can
verify that two detached Ed25519 signatures match caller-pinned public keys,
but it cannot prove that the caller-selected pins are approved trust anchors.

Repository-local commits, fixtures, local configuration, self-authored
approval records and additional local validators are not independent
authority. They cannot authenticate their own trust roots.

## Claims that remain false

Until the external evidence in this playbook exists and is independently
reviewed:

- `trustAnchorAccepted` is `false`;
- `evidenceAuthenticated` is `false`;
- `releaseGateAdvanceAllowed` is `false`;
- `stableReleaseAccepted` is `false`.

R10 does not inspect GitHub, read a key, execute a workflow, run an installer or
advance Release Gate R.

## Required external approval record

Each proposed trust anchor needs an immutable approval record created outside
the evidence-producing repository. The record must bind:

- the exact SHA-256 fingerprint of one Ed25519 SPKI public key;
- one signer role: platform evidence or operator E2E evidence;
- the release repository and product scope;
- the permitted source-commit, version or release-candidate scope;
- the authority that approved the anchor;
- the approval time and validity interval;
- the current revocation state;
- an immutable external reference to the approval decision;
- the protected-environment policy observation used during approval.

No value in this document is an approved fingerprint, authority identity or
production approval record.

## Separation of duties

Approval must fail closed unless all of these are true:

1. The evidence producer is not the sole trust-anchor approver.
2. Self-review is disabled or independently prevented.
3. The platform-evidence signer and operator-evidence signer use distinct keys,
   key identifiers and approval records.
4. Required reviewers are enforced by an authority outside the local
   repository checkout.
5. The approval reference is immutable and independently retrievable.
6. The approval scope exactly matches the repository, product, source commit,
   version and release candidate being reviewed.

A local actor asserting that these controls exist is not proof that they exist.

## Protected-environment evidence

Before a later trust decision, an authorized read-only observation must capture:

- environment name and repository identity;
- required reviewer count and reviewer authority;
- self-review prevention state;
- deployment-branch or tag policy;
- observation time;
- immutable provider-side reference or audit identifier;
- the identity of the independent observer.

This observation must not contain tokens, credentials, private keys or signing
secrets. R10 does not authorize creating or changing the environment.

## Validity, rotation and revocation

- An expired, revoked, unknown or out-of-scope anchor is unusable.
- Rotation creates a new approval record; it never rewrites old evidence.
- Revocation blocks future acceptance immediately while preserving historical
  records for audit.
- A compromised or ambiguously controlled key triggers fail-closed revocation,
  incident review and fresh evidence under a newly approved anchor.
- One key must never satisfy both signer roles.
- An approval record must not outlive the authority or protected policy that
  justified it.

## Later authorized verification sequence

Only after separate authority is granted:

1. Observe the protected environment without mutating it.
2. Retrieve public approval metadata without retrieving any secret.
3. Verify the approval record's immutable external reference.
4. Match its fingerprint, role, scope, validity and revocation state to the R9
   signer.
5. Re-run R7, R8 and R9 against the exact immutable evidence.
6. Obtain independent review of the combined platform, E2E, signature and
   authority evidence.

Even then, evidence authentication is not stable release acceptance. Windows
and macOS platform checks, an approved release-candidate run and separate admin
promotion remain independent gates.

## Stop conditions

Stop and keep the gate blocked when:

- an approval source is repository-local or self-authored;
- the approver and evidence producer are not independent;
- self-review prevention cannot be proven;
- a fingerprint, role, scope, validity or revocation field is missing;
- the two signer roles share a key;
- the external reference is mutable or cannot be independently verified;
- any requested action would read a secret, mutate GitHub, execute a workflow
  or installer, publish, deploy or promote stable.

The only valid R10 outcome is
`BLOCKED_AWAITING_APPROVED_TRUST_ANCHORS`.
