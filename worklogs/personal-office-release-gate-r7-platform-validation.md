# Personal Office Release Gate R7 — platform validation harness

Status: `READY_FOR_REVIEW`

Base: `e6f2f9eeeed4aac0adfd1321bf9d95d7f2effeb9`

R7 adds a dependency-free evidence harness for already-produced Windows and
macOS desktop artifacts. It validates canonical containment, rejects
traversal/symlink/non-file inputs, binds version/platform/architecture, records
SHA-256 and byte size and emits deterministic JSON without executing the
artifact.

Optional signed-platform mode uses only fixed verifier binaries and argument
arrays with `shell: false`. The signature target must be one of the exact
artifacts already hashed by static preflight. Windows uses
`Get-AuthenticodeSignature`; macOS validates the DMG itself with codesign,
stapler and Gatekeeper. Any missing/non-zero probe fails before a
signed-platform PASS can be emitted.

The new workflow is manual-only and root read-only. It performs unsigned static
preflight packaging with `--publish never`, exposes no token/secret to shell
commands and retains evidence JSON only. It does not edit or replace the
production release workflow and cannot satisfy stable release acceptance.

The playbook keeps static preflight, signed platform evidence and real
install/upgrade/uninstall acceptance as three separate claims.

## Producer verification

- Implementation commit:
  `a68efbf03925fa78993150f1b1ec7f843250c596`.
- Focused Node tests: PASS, 8/8.
- Node syntax checks: PASS for harness and test.
- Workflow YAML parse/policy assertions: PASS; only `workflow_dispatch`,
  read-only permissions, both packaging commands use `--publish never`, no
  release action, token or secret reference.
- Ownership/prohibited-path audit: PASS; six dirty paths before commit, all
  exact lease paths, and the implementation commit contains four artifact
  paths.
- Secret scan and `git diff --check`: PASS.
- Producer lint: not runnable without violating isolation. The producer has no
  `node_modules`; invoking canonical ESLint could not resolve the producer-local
  ESM config dependency `@eslint/js`. No install or junction was authorized.
  Canonical lint remains mandatory after exact-path replay.

Security corrections made before the implementation commit:

- removed `NODE_AUTH_TOKEN`/secret exposure from install steps;
- bound every signed-mode target to an artifact already hashed;
- changed macOS signed evidence to verify the DMG itself with codesign,
  stapler and Gatekeeper `type open`, preventing a PASS on an unrelated app.

Artifact SHA-256 values are recorded in the producer handoff JSON.

No package, lockfile, DB/schema, auth, preload, renderer, existing release
workflow/config, dependency installation, installer/application execution,
secret retrieval, GitHub mutation, push, tag, publish, deploy, stable promotion
or quarantine write is authorized or performed.
