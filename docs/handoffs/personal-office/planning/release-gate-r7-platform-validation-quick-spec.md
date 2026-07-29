# Release Gate R7 quick spec — non-publishing platform validation

Status: `LEASE_READY`

Canonical base: `c8f616ed206d43ab79e90cf27c0034a46ef09f00`

## Intent

Add a deterministic, non-publishing validation harness that can inspect
already-produced Windows and macOS desktop artifacts, collect immutable
hash/size evidence and run platform-native signature/notarization verification
without executing an installer or application.

## Scope

In:

- a dependency-free Node harness for artifact containment, naming, digest and
  evidence-manifest validation;
- optional read-only platform probes for Authenticode, codesign, stapler and
  Gatekeeper;
- unit tests using temporary fake artifacts and injected command runners;
- a manual, contents-read-only CI workflow that packages with
  `--publish never`;
- a Windows/macOS operator playbook that distinguishes static preflight from
  signed platform acceptance.

Out:

- package or lockfile changes;
- edits to `release-desktop.yml`, `electron-builder.json` or signing policy;
- installer/application execution;
- dependency installation during this implementation session;
- secret retrieval, GitHub environment mutation, push, tag, publish, deploy or
  stable promotion.

## Requirements

1. WHEN an artifact path escapes the declared release root, is a symlink or
   points to a non-file, THEN validation fails before hashing or probing.
2. WHEN version/platform/architecture metadata does not match the declared
   artifact filename, THEN validation fails closed.
3. WHEN validation succeeds, THEN the evidence JSON contains sorted artifact
   paths, byte sizes and SHA-256 digests plus the exact source commit.
4. WHEN platform probes are requested, THEN the harness executes only the
   fixed verifier binaries with argument arrays and never executes the
   installer/application.
5. WHEN the CI workflow is inspected, THEN it is manual-only, root
   `contents: read`, contains no release upload/write permission and invokes
   electron-builder only with `--publish never`.
6. WHEN signed platform evidence is unavailable, THEN the output is explicitly
   preflight-only and cannot satisfy stable-release acceptance.

## Verification

- Node built-in test suite for traversal, symlink, filename, hash,
  deterministic output and injected verifier behavior.
- YAML parse plus policy assertions for manual-only/read-only/no-publish.
- Secret scan, ownership audit, prohibited-path audit and `git diff --check`.
- Full desktop tests, TypeScript, production build and lint after exact-path
  integration.
- Independent correctness, security and Socrates review.
