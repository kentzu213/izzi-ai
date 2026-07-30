# CHANGE_REQUEST — Release Gate R10 external trust-authority boundary

Status: `APPROVED_FOR_ISOLATED_PRODUCER`

Gate: `RELEASE-GATE-R10-EXTERNAL-TRUST-AUTHORITY`

Decision authority: W0 Control Tower / Codex

Canonical base: `d3cd917c3080f42d43cb0aa7e8daefa757cdf2ab`

## Purpose

R9 verifies detached Ed25519 signatures against caller-pinned public keys, but
the repository cannot prove that caller-selected pins are approved trust
anchors. Local commits, fixtures, self-authored approval JSON or another local
validator remain controlled by the same actor and cannot bootstrap external
authority.

R10 is a documentation-only, non-authenticating governance checkpoint. It
defines the exact external inputs and separation-of-duty evidence that a later
authorized trust-anchor decision must supply. R10 must end blocked and must not
change any Release Gate R authority flag.

## Exact producer paths

- `docs/desktop-external-trust-authority-playbook.md`
- `docs/handoffs/personal-office/release-gate-r10-external-trust-authority.json`
- `worklogs/personal-office-release-gate-r10-external-trust-authority.md`

All three paths are new. Every source, workflow, package, release configuration
and prior R7-R9 artifact is read-only.

## Authorized work

1. Explain why local-only artifacts cannot approve their own trust anchors.
2. Define the minimum external evidence required for each trust anchor:
   fingerprint, public-key algorithm, signer role, scope, validity window,
   revocation state, approving authority and immutable approval reference.
3. Require separation of duties: the evidence producer cannot be the sole trust
   approver, self-review is insufficient, and two signer roles cannot share one
   key.
4. Define the protected-environment evidence required before a trust decision:
   required reviewers, self-review prevention and immutable environment-policy
   observation.
5. Define revocation, expiry, rotation and incident handling without storing any
   private key or secret.
6. Emit only a handoff decision of
   `BLOCKED_AWAITING_APPROVED_TRUST_ANCHORS`, with
   `trustAnchorAccepted:false`, `evidenceAuthenticated:false`,
   `releaseGateAdvanceAllowed:false` and `stableReleaseAccepted:false`.

## Constraints

- No public-key fingerprint may be labelled approved.
- No real public key, private key, signing secret, credential, personal
  operator identity or GitHub token may be read, generated, logged or stored.
- No package/lockfile, workflow, release configuration, product source,
  DB/schema, auth, preload or renderer path may change.
- No dependency install, workflow, installer, application, browser, platform
  verifier, network or GitHub action may execute.
- No push, tag, publish, deploy, environment mutation, evidence-authentication
  claim, release-gate advancement or stable promotion is authorized.
- Do not write, reset, stash, clean or commit the quarantine worktree.
- The producer may write only the three exact paths above.

## Required proof

- all authority and release flags remain false;
- no example is representable as an approved production trust anchor;
- independent correctness, security and Socrates claim review pass;
- JSON parse, ownership, prohibited-path, secret-pattern and diff checks pass;
- canonical source verification remains unchanged because R10 is docs-only.
