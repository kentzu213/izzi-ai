# Personal Office Release Gate R8 — unauthenticated E2E evidence structure

Status: `READY_FOR_REVIEW`

Base: `5eb0a36b4f4850af86fb481fb6f6f1a68f2793a2`

R8 adds a dependency-free structure validator for evidence collected by a
separately authorized Windows or macOS platform run. It requires the exact R7
signed-evidence shape, binds the artifact and signer identity, verifies the
complete platform-specific and shared product-flow check catalog and emits
deterministic create-only structure evidence.

The validator rejects static-only R7 evidence, artifact or commit mismatch,
unknown/missing/duplicate/failed checks, invalid timestamps, non-clean profiles,
wrong Windows data-retention outcome, secret-like content and symlink/junction
input or output paths.

The output decision is `UNAUTHENTICATED_E2E_EVIDENCE_STRUCTURE_PASS` and always
sets `evidenceAuthenticated: false`, `releaseGateAdvanceAllowed: false` and
`stableReleaseAccepted: false`. R8 cannot prove who produced a self-consistent
JSON bundle. Stable acceptance remains blocked until an external trust step
authenticates the immutable R7 and operator evidence.

## Producer verification

- Implementation commit:
  `8fb2bdb5aa679225176c8673bc0c19c6b57ddd04`.
- Focused tests: PASS, 8/8.
- R7 compatibility: PASS using the exact Windows signed-evidence object emitted
  by `platform-validation-harness.mjs`; macOS command/argv arrays are also
  compared exactly, with explicit fail-closed drift tests for both platforms.
- Syntax: PASS for validator and test.
- Ownership, prohibited-path, secret scan and `git diff --check`: PASS.
- Producer lint remains pending canonical replay because the isolated worktree
  has no `node_modules`; no install or junction was authorized.

The validator digests the complete raw canonical JSON inputs after validating
their strict schemas. Probe commands, arguments and stdout/stderr digests are
therefore part of the immutable R7-to-R8 chain rather than being discarded by
normalization.

Artifact hashes and sizes are recorded in the producer handoff JSON.

## Independent-review correction

The first correctness and security reviews failed because the producer
overstated probe strictness and evidence authenticity. The correction:

- compares every R7 macOS verifier command and argv array exactly;
- compares the Windows fixed flags and SHA-256 of the complete embedded
  Authenticode script;
- preserves full raw-input canonical digests;
- explicitly labels the result unauthenticated and prohibits release-gate
  advancement, publish, deployment and stable promotion.

This makes R8 a preparation and review tool, not an attestation authority.

No package, lockfile, workflow, release configuration, product source,
DB/schema, auth, preload, renderer or quarantine path is changed. No install,
workflow, installer/application/browser/verifier/network action, secret
retrieval, GitHub mutation, push, tag, publish, deploy or stable promotion is
authorized or performed.
