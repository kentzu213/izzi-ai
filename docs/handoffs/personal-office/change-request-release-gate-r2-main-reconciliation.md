# Release Gate R2 — default-branch reconciliation

## Trigger

Read-only GitHub verification on 2026-07-29 found that:

- `origin/main` is `7e265286bacf367da4423914d338233c1e47f936`
  (`v1.14.0-beta.8` lineage), ten commits beyond the Personal Office canonical
  ancestor;
- the accepted Gate R hardening exists only on
  `feature/personal-office-baseline-20260728`;
- `.github/workflows/release-desktop.yml` on `origin/main` still publishes on
  every `v*` tag push with repository-wide `contents: write`;
- the GitHub API reports zero repository environments, so
  `desktop-release` has no verified required-reviewer protection.

The earlier Gate R result remains valid for the Personal Office integration
ref, but it cannot be treated as protection for the current default branch.

## Lease

`LEASE-R2-MAIN-RECONCILIATION-20260729` grants one Codex producer an isolated
worktree based on the exact `origin/main` commit above.

Owned paths:

- `.github/workflows/release-desktop.yml`
- `apps/desktop/electron-builder.json`
- `docs/desktop-release-checklist.md`
- `package.json`
- `pnpm-lock.yaml`

The producer must preserve all beta.8 product, branding, icon-build, updater,
marketing, and version changes. Whole-file replacement from the beta.3
integration ref is prohibited for package manifests and the lockfile.

## Required patch

1. Port the manual draft/prerelease-only release workflow and least-privilege
   permissions onto beta.8.
2. Fail closed on missing macOS signing/notarization inputs.
3. Keep the default builder publish type `draft`.
4. Port only the reviewed dependency overrides and their lockfile resolution.
5. Add a non-publishing platform-validation workflow or scripts only if they
   cannot upload, publish, create tags, read secret values into logs, or mutate
   a developer installation.

## Verification

- workflow and JSON parse;
- exact ownership and prohibited-path audit;
- frozen-lockfile install with scripts disabled when possible;
- desktop tests, build, lint ceiling and dependency resolution checks;
- diff-only secret scan;
- independent security and Socrates review.

## Prohibited

No push, tag, publish, deployment, installer execution, stable promotion,
secret retrieval, environment creation, or quarantine mutation.
