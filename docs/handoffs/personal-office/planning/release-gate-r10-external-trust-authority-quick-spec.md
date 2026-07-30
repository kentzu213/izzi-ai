# Release Gate R10 quick spec — external trust-authority boundary

Status: `LEASE_READY`

Canonical base: `d3cd917c3080f42d43cb0aa7e8daefa757cdf2ab`

## Intent

Record the point at which safe local automation ends. Define the external
authority evidence required to approve R9 public-key fingerprints without
pretending that repository-local assertions can authenticate themselves.

## User journey

As a release authority, I need one bounded checklist for approving, rotating
and revoking trust anchors so that future signed platform evidence can be
reviewed under real separation of duties.

## Scope

In:

- external trust-anchor approval requirements;
- protected-environment and reviewer-policy evidence requirements;
- signer-role separation, validity, rotation, revocation and incident rules;
- blocked handoff and operator playbook.

Out:

- real keys or fingerprints;
- GitHub environment creation or inspection;
- network, workflow, installer, application or platform execution;
- evidence-authentication or release-gate advancement;
- package, workflow, release configuration or product-source changes.

## Requirements

1. Local commits, fixtures and self-authored JSON must be explicitly
   insufficient to approve a trust anchor.
2. Approval requirements must bind each fingerprint to algorithm, signer role,
   release scope, validity window, revocation state, approving authority and an
   immutable external reference.
3. The evidence producer must not be the sole approver; self-review must be
   rejected.
4. Rotation and revocation must invalidate future use without rewriting
   historical evidence.
5. R10 output must remain
   `BLOCKED_AWAITING_APPROVED_TRUST_ANCHORS` with every authority flag false.

## Verification

- JSON parse and exact schema/flag audit;
- ownership, prohibited-path, secret-pattern and `git diff --check`;
- independent correctness, security and Socrates claim review;
- exact-path canonical replay only after PASS.
