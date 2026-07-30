# Personal Office Release Gate R8 — platform E2E evidence

Status: `READY_FOR_REVIEW`

Base: `5eb0a36b4f4850af86fb481fb6f6f1a68f2793a2`

R8 adds a dependency-free validator for evidence collected by a separately
authorized Windows or macOS platform run. It requires R7 signed-platform
evidence, binds the exact artifact and signer identity, verifies the complete
platform-specific and shared product-flow check catalog and emits deterministic
create-only validation evidence.

The validator rejects static-only R7 evidence, artifact or commit mismatch,
unknown/missing/duplicate/failed checks, invalid timestamps, non-clean profiles,
wrong Windows data-retention outcome, secret-like content and symlink/junction
input or output paths.

The output decision is `PLATFORM_E2E_EVIDENCE_VALIDATED` and always keeps
`stableReleaseAccepted: false`. Stable acceptance remains a W0 decision after
real authorized platform execution and independent review.

## Producer verification

- Implementation commit:
  `d7e872695f92d77c6b502295ce9fb5e4116c4061`.
- Focused tests: PASS, 8/8.
- R7 compatibility: PASS using the exact Windows signed-evidence object emitted
  by `platform-validation-harness.mjs`.
- Syntax: PASS for validator and test.
- Ownership, prohibited-path, secret scan and `git diff --check`: PASS.
- Producer lint remains pending canonical replay because the isolated worktree
  has no `node_modules`; no install or junction was authorized.

The validator digests the complete raw canonical JSON inputs after validating
their strict schemas. Probe commands, arguments and stdout/stderr digests are
therefore part of the immutable R7-to-R8 chain rather than being discarded by
normalization.

Artifact hashes and sizes are recorded in the producer handoff JSON.

No package, lockfile, workflow, release configuration, product source,
DB/schema, auth, preload, renderer or quarantine path is changed. No install,
workflow, installer/application/browser/verifier/network action, secret
retrieval, GitHub mutation, push, tag, publish, deploy or stable promotion is
authorized or performed.
