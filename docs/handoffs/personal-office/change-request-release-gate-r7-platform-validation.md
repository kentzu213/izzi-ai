# CHANGE_REQUEST — Release Gate R7 non-publishing platform validation

Status: `APPROVED_FOR_ISOLATED_PRODUCER`

Gate: `RELEASE-GATE-R7-PLATFORM-VALIDATION`

Decision authority: W0 Control Tower / Codex

Canonical base: `c8f616ed206d43ab79e90cf27c0034a46ef09f00`

## Purpose

Release Gate R is ready for platform validation but cannot yet claim Windows
install/upgrade/uninstall or signed/notarized macOS evidence. R7 adds the
non-publishing evidence harness and operator playbook needed before an
authorized platform run.

## Exact producer paths

- `.github/workflows/desktop-platform-validation.yml`
- `apps/desktop/scripts/platform-validation-harness.mjs`
- `apps/desktop/scripts/platform-validation-harness.test.mjs`
- `docs/desktop-platform-validation-playbook.md`
- `docs/handoffs/personal-office/release-gate-r7-platform-validation.json`
- `worklogs/personal-office-release-gate-r7-platform-validation.md`

No existing hot file is included.

## Authorized implementation

1. Validate artifact containment, regular-file status, version/platform/arch
   identity, SHA-256 and byte size without launching an artifact.
2. Support injected/fixed read-only platform verifiers:
   `Get-AuthenticodeSignature`, `codesign --verify`, `xcrun stapler validate`
   and `spctl --assess`.
3. Produce deterministic JSON evidence that distinguishes unsigned/static
   preflight from signed platform acceptance.
4. Add built-in Node tests with no new dependency.
5. Add a manual-only, read-only workflow whose packaging commands use
   `--publish never`.
6. Document the later authorized Windows/macOS validation procedure and
   rollback/evidence retention rules.

## Constraints

- Do not modify package manifests, lockfiles, DB/schema, auth, preload,
  renderer, production release workflow or electron-builder config.
- Do not install dependencies, run an installer/application, retrieve secrets,
  mutate GitHub settings, push, tag, publish, deploy or promote stable.
- Do not execute any new workflow in this session.
- Do not write, reset, stash, clean or commit the quarantine worktree.
- The producer may write only the six exact paths above.

## Required proof

- focused harness tests pass;
- workflow policy parse proves manual-only, read-only and `--publish never`;
- no command construction through a shell;
- traversal/symlink and false-signed evidence fail closed;
- independent correctness, security and Socrates PASS;
- full canonical verification before integration acceptance.
