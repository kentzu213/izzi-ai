# Izzi AI Desktop 1.14.0-beta.6 Updater Evidence

Date: 2026-07-29
Repository: `kentzu213/izzi-ai`
Commit: `6adcc5c8fcac46993c9f4489362fef0743f9bfd6`
Tag: `v1.14.0-beta.6`

## Closed defect

An electron-builder directory package such as `release/win-unpacked` does not
contain `resources/app-update.yml`. Izzi AI previously treated that expected
smoke-package condition as an updater failure and exposed the local filesystem
path in the desktop UI.

The updater now:

- recognizes Windows and Linux unpacked directories plus original macOS
  `release/mac-*` bundles;
- leaves the updater idle when a directory package has no update config;
- keeps a missing config actionable for installed packages while replacing the
  local path with a stable error message;
- publishes beta tags as GitHub prereleases on Windows and macOS.

## Verification

- Focused updater and release-contract tests: `10/10` passed.
- Full desktop regression: `935/935` passed.
- Production build and TypeScript compilation: passed.
- `git diff --check`: passed.
- Added-secret scan: passed.
- Reviewer result: no blocker.
- GitHub Actions run `30459213272`: Windows and macOS jobs passed.
- Release `v1.14.0-beta.6`: public, non-draft, and marked prerelease.
- Windows x64 plus macOS x64 and arm64 artifacts are present.
- The packaged Windows runtime reported version `1.14.0-beta.6`.
- Startup and a manual update check both returned:

  `{"state":"idle","version":"1.14.0-beta.6"}`

- Neither `ENOENT` nor `Desktop update configuration is unavailable.` appeared
  after the manual check.
- Local screenshot SHA-256:
  `072AD7AB8B6234286E772C63C3ED32675C87E332BA97DB04F14AC483FE5A92DF`.
  The screenshot remains outside the repository because it contains live
  workspace state.

## GitHub update metadata

The public GitHub provider selects prereleases from release tags. A beta client
enables prerelease updates from its current semantic version, tries beta
metadata for the selected tag, and intentionally accepts that release's
`latest.yml` as a fallback. Therefore the `latest.yml` asset in this GitHub
prerelease is expected and is not a stable-channel promotion.

## Remaining repository gates

- ESLint 9 has no repository flat config, so the desktop lint command cannot
  run until that baseline task is completed.
- Production audit remains at one moderate and two high advisories in the
  existing `packages__cli > archiver` dependency chain.
- Windows artifacts are unsigned in this phase.
- GitHub Actions reports Node.js 20 action-runtime deprecation warnings.
