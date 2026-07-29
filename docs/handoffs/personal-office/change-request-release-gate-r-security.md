# Release Gate R — dependency and signing security change request

## Authority

- Owner: W0 Control Tower
- Lease: `LEASE-R-DEPENDENCY-SIGNING-20260729`
- Canonical base: `08a1c7b676e6e3eaf0354310dd06d942137f9320`
- Scope: release-readiness correction only; no push, tag, publish, deployment,
  installer execution, database migration, auth change, or secret retrieval.

## Evidence requiring a correction

1. `pnpm audit --prod` reports two HIGH `brace-expansion` advisories and one
   MODERATE `@hono/node-server` advisory.
2. The locally packaged Windows `app.asar` contains
   `@hono/node-server@1.19.17` through `hyperframes@0.7.57`, so the Hono issue
   is part of the desktop artifact rather than repository-only tooling debt.
3. The upstream Hono v2 release keeps the public API and requires Node 20+;
   v2.0.5 is the security-fixed release. Starizzi CI uses Node 22 and the local
   release verification uses Node 24.
4. The macOS release job explicitly disables signing discovery and does not
   provide the Apple signing/notarization variables listed by the release
   checklist. The stable Gatekeeper criterion therefore cannot be met.

## Exact owned paths

- `package.json`
- `pnpm-lock.yaml`
- `apps/desktop/electron-builder.json`
- `.github/workflows/release-desktop.yml`
- `docs/desktop-release-checklist.md`
- `docs/handoffs/personal-office/release-gate-r.json`
- `docs/handoffs/personal-office/acceptance/release-gate-r.json`
- `worklogs/personal-office-release-gate-r.md`

## Intended patch

1. Override `@hono/node-server` to `2.0.5`.
2. Override the resolved vulnerable `brace-expansion` 2.x and 5.x versions to
   `2.1.2` and `5.0.8`.
3. Enable electron-builder's built-in macOS notarization.
4. Wire existing secret names into the macOS release job without exposing
   their values.
5. Record Windows packaging, artifact inspection, runtime smoke, dependency
   audit and the macOS verification limitation in Release Gate R artifacts.

## Required verification

- frozen lockfile install succeeds;
- `pnpm audit --prod` has no HIGH or MODERATE findings;
- lint, full workspace build and all desktop tests pass;
- Windows NSIS packages locally with `--publish never`;
- packaged `app.asar` contains `@hono/node-server@2.0.5` and no vulnerable
  `brace-expansion` version;
- packaged app launches under mock/fail-closed configuration;
- workflow/config parsing confirms signing and notarization are required;
- macOS stable status remains conditional until a real signed/notarized CI
  artifact passes Gatekeeper on macOS.

