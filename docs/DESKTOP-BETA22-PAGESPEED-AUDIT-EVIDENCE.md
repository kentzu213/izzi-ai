# Izzi AI Desktop Beta.22 PageSpeed Audit Evidence

Date: 2026-08-10
Repository: `kentzu213/izzi-ai`
Feature commit: `8872d19`
Release commit: `299fc84`
Public tag: `v1.14.0-beta.22`
Release: https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.22

## Closed release slice

CMR-225 turns SEO Workspace into a real, read-only Google PageSpeed workbench.
An entitled owner, manager, or editor can run Mobile or Desktop Lighthouse and
view bounded lab metrics plus optional CrUX field metrics. The report preserves
the URL sent by Izzi AI, the URL Lighthouse received, the final audited URL,
and the CrUX requested URL, dataset id, and URL/origin scope.

The main process owns the fixed Google endpoint, optional
`PAGESPEED_API_KEY`, public-target validation, DNS checks, whole-operation
timeout, JSON content validation, response-size bound, result parsing, request
deduplication, and cooldowns. IPC accepts the exact shared input shape only.
The service denies viewers and workspaces without an executable core
`seo-workspace` entitlement before any PageSpeed request.

Google's discovery document at
https://www.googleapis.com/discovery/v1/apis/pagespeedonline/v5/rest defines
`LighthouseResultV5.requestedUrl`, `LighthouseResultV5.finalUrl`,
`PagespeedApiLoadingExperienceV5.initial_url`, and
`PagespeedApiLoadingExperienceV5.id`; those fields are the upstream provenance
used by the shared report contract.

## Source verification

- `pnpm --filter @openclaw/desktop exec vitest run` over the six focused
  PageSpeed, service, IPC, workbench, and capability-action files passed 270
  tests in 6 files.
- `pnpm --filter @openclaw/desktop test` passed 1,173 tests in 85 files after
  the final provenance and retry-preservation patch.
- `pnpm --filter @openclaw/desktop exec tsc -p tsconfig.main.json --noEmit`
  and `pnpm --filter @openclaw/desktop exec tsc -p tsconfig.json --noEmit`
  both exited zero.
- `pnpm build` transformed 1,139 renderer modules and exited zero.
- `git diff --check` and `node tools/socrates-tier1.mjs --changed` exited zero
  before the feature commit.
- A changed-line scan over the staged diff measured 0 high-confidence secret
  additions. `pnpm audit --prod --json` reported 11 existing production
  advisories: 6 high, 4 moderate, 1 low, and 0 critical.

`pnpm --filter @openclaw/desktop lint` remains a repository residual and exits
2 because ESLint 9 cannot find an `eslint.config.*` file. CMR-225 adds no npm
dependency.

## Public release

- `gh run view 31320515731 --repo kentzu213/izzi-ai --json
  status,conclusion,jobs` reported successful Windows and macOS release jobs
  for `299fc84`.
- `gh release view v1.14.0-beta.22 --repo kentzu213/izzi-ai --json
  assets,isDraft,isPrerelease,url` reported a public, non-draft prerelease with
  12 uploaded assets.
- The GitHub release API and `Get-Item` measured the public Windows installer
  at 184,619,675 bytes. `Get-FileHash -Algorithm SHA256` matched the release
  digest `0a60232ec1b875850a17c81e8ee12a5489878cf30b711bf97058fc9b11e5ffca`.
- `Get-AuthenticodeSignature` returned `NotSigned`, the known beta residual.

## Installed package proof

The previous application files were removed with the beta.21 NSIS uninstaller,
which exited zero while the per-user profile remained present. The checksum-
verified beta.22 installer then recreated `F:\IzziAI\Izzi AI.exe` and
`F:\IzziAI\resources\app.asar`.

An `@electron/asar` extraction of the installed `package.json` reported the
desktop package at version `1.14.0-beta.22` with its expected compiled main
entry. `Get-FileHash -Algorithm SHA256` measured the installed
executable at 190,635,008 bytes with SHA-256
`7b96c00cee0abd4fc39904c0e96d6a50955eefa7fceec8f807590a4f79ad0b4d`,
and the installed ASAR at 114,256,282 bytes with SHA-256
`18d3ca8b6c35ae02cfb2eb5f6545261894398364623a4a1a6d8622283a4b017a`.

The installed app is running with local CDP on port 9228. The CDP user agent
reports desktop version `1.14.0-beta.22` on Electron 34.5.8.

## Packaged smoke

Playwright connected to the installed `file:///F:/IzziAI/` renderer, navigated
through AI Marketing, Apps, and SEO Workspace, and found the Google PageSpeed
workbench. The two device controls exposed radio semantics; ArrowRight moved
selection and focus to Desktop, and Home restored Mobile. The 1,280-pixel
desktop viewport measured body and client widths at 1,280 pixels with no
horizontal overflow.

The installed app submitted a real audit for `https://izziapi.com` through the
renderer, IPC, service, and fixed Google endpoint. Google returned the expected
bounded error `Google PageSpeed đang giới hạn số lần gọi.` because the current
unauthenticated PageSpeed quota is rate-limited; the app remained responsive
and exposed no upstream body or credential.

Before packaging, the same final renderer used a contract fixture to exercise
the success report. Playwright measured both Mobile and Desktop controls at 44
pixels high in a 390-by-844-pixel viewport, with body and client widths both
390 pixels. Requested, Lighthouse, final, CrUX initial, and CrUX dataset URLs
all remained visible without horizontal overflow. Evidence images are stored
outside Git at:

- `F:\3 AI-Automation\izziAi Marketing\.artifacts\cmr225-pagespeed-beta22-local-desktop-mock-result.png`
- `F:\3 AI-Automation\izziAi Marketing\.artifacts\cmr225-pagespeed-beta22-local-mobile-mock-result.png`

## Safety and limits

- The feature is read-only. It does not publish, spend, mutate a website, or
  attach workspace cookies and credentials to the Google request.
- A usable PageSpeed quota or `PAGESPEED_API_KEY` is still required when the
  unauthenticated Google quota returns HTTP 429.
- The Windows installer remains unsigned. macOS artifacts were built and
  published but were not installed or exercised on this Windows workstation.
- Direct screenshot capture on the installed Electron page timed out; packaged
  behavior was verified through CDP DOM, focus, IPC outcome, and overflow
  measurements, while the final success layout was captured before packaging.

## Rollback

`v1.14.0-beta.21` remains the previous public prerelease. Reinstalling its
Windows installer restores the previous desktop binaries while the per-user
profile remains outside the installation directory.
