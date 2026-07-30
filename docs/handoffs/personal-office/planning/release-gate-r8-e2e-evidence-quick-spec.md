# Release Gate R8 quick spec — unauthenticated E2E evidence structure validator

Status: `LEASE_READY`

Canonical base: `95a645d8ab49a6e40834e77a4aead4d2b61b1f7d`

## Intent

Create a deterministic validator that turns separately collected Windows or
macOS platform-run results into a bounded, reviewable structure record tied to
the exact R7 signed artifact. The validator checks structure and internal
binding only: it never performs the platform run, never authenticates the
producer of a self-consistent evidence bundle and never grants release-gate or
stable-release authority.

## Scope

In:

- dependency-free Node ESM validator and built-in tests;
- exact schemas for R7 signed evidence and platform E2E evidence;
- exact R7 macOS verifier command/argv arrays and exact Windows fixed flags plus
  the complete embedded Authenticode script SHA-256;
- Windows install/launch/upgrade/uninstall/data-retention requirements;
- macOS DMG/copy/first-launch/Gatekeeper requirements;
- shared product-flow checks for login boundary, Tasks, Memory, Status,
  Overview, Marketplace, Extensions and Settings;
- canonical input/output containment, deterministic digests and create-only
  result files;
- operator playbook for collecting non-secret evidence.

Out:

- workflow execution or changes;
- packaging, signing, notarization or installer execution;
- browser/network automation;
- package/lockfile or product-source changes;
- stable-release acceptance, push, tag, publish or deploy.
- evidence authentication or release-gate advancement.

## Requirements

1. WHEN the R7 input is not `SIGNED_PLATFORM_EVIDENCE_PASS`, THEN validation
   fails before considering E2E checks.
2. WHEN platform, architecture, version, source commit or artifact identity
   differs across inputs, THEN validation fails closed.
3. WHEN an R7 verifier command or argv shape differs from the exact R7 harness
   contract, THEN validation fails closed.
4. WHEN a required check is missing, duplicated, unknown or not `PASS`, THEN no
   validated result is emitted.
5. WHEN Windows evidence is submitted, THEN fresh install, launch, supported
   upgrade, post-upgrade launch, uninstall and retained app-data policy are
   required.
6. WHEN macOS evidence is submitted, THEN DMG open, copy to Applications,
   first launch, Gatekeeper acceptance and application removal are required.
7. WHEN either platform is submitted, THEN the eight product surfaces and
   login boundary are required exactly once.
8. WHEN validation succeeds, THEN output is deterministic, create-only and
   artifact-bound, with decision
   `UNAUTHENTICATED_E2E_EVIDENCE_STRUCTURE_PASS`,
   `evidenceAuthenticated: false`, `releaseGateAdvanceAllowed: false` and
   `stableReleaseAccepted: false`.
9. WHEN release-gate advancement is considered, THEN a separate trust step
   must first authenticate the immutable R7 and operator evidence.

## Tasks

- [ ] Define exact evidence schemas and required check catalogs.
- [ ] Implement canonical input reading, validation and digest binding.
- [ ] Implement safe create-only output under a pre-existing canonical root.
- [ ] Add Windows/macOS happy-path and fail-closed tests.
- [ ] Add operator collection and review playbook.
- [ ] Produce immutable handoff and worklog.

## Verification

- `node --test` and `node --check`;
- changed-file ESLint on canonical toolchain;
- schema/determinism, mismatch, secret, timestamp, duplicate and junction tests;
- exact ownership/prohibited-path/secret audits;
- independent correctness and security review;
- full canonical desktop test/build/lint gates after exact replay.
