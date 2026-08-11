# Izzi AI Desktop Beta30 Renderer Performance Evidence

Date: 2026-08-11 ICT

Scope: close the renderer bundle warning without weakening Customer Marketing security gates,
publish a verified beta, install it over beta29, and smoke the real Windows application. Video/F5
work is explicitly deferred.

## Product Change

- Commit `15b9eff5c646b31ad2198fae49c86f87f9ec0ff2` keeps Login and Chat eager and
  lazy-loads 17 secondary workspaces.
- The renderer entry fell from 1,018,843 bytes to 355,260 bytes.
- Customer Marketing is 168,846 bytes and the largest lazy chunk is Knowledge Universe at
  245,678 bytes.
- CI and release enforce a 400,000-byte entry ceiling and 500,000-byte per-chunk ceiling.
- Customer Marketing preloads after Chat becomes interactive. Shared mobile navigation CSS stays
  eager, and a three-test contract prevents the prior unstyled Chat regression.

## Verification

| Gate | Result |
|---|---|
| Five-workspace build | PASS, 1,140 renderer modules, no chunk-size warning |
| Workspace lint | PASS |
| Desktop suite | PASS, 88/88 files and 1,265/1,265 tests |
| Renderer budget | PASS, 2/2 |
| Actions / lint / Socrates contracts | PASS, 5/5, 4/4, 4/4 |
| Full and production dependency audits | PASS, no known vulnerability |
| Desktop CI performance commit | PASS, run `31481534646`, Windows/macOS, zero annotations |
| Desktop CI release commit | PASS, run `31481805015`, Windows/macOS, zero annotations |
| Release workflow | PASS, run `31482074009`, Windows/macOS/inventory, zero annotations |

## Public Release And Installed Smoke

- Release: `https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.30`
- State: public prerelease, 12 uploaded assets, every asset has a GitHub SHA-256 digest.
- Windows installer: `Izzi-AI-1.14.0-beta.30-win-x64.exe`, 185,851,607 bytes.
- Verified SHA-256: `fbd5c933d1c28e272b1dbed7d610163227d1467778723b2467192c5d08150b93`.
- Silent upgrade exited `0`; installed file version is `1.14.0-beta.30` at
  `F:\IzziAI\Izzi\Izzi AI.exe`.
- Packaged `app.asar` reports beta30 and contains `index-sleBsGw5.js`,
  `CustomerMarketingRoom-DRBnd11A.js`, and its separated stylesheet.
- The installed app opened the retained authenticated profile. Chat rendered normally, direct
  navigation opened AI Marketing, and the operational IzziAPI Marketing dashboard settled after
  about 17 seconds. No workflow was started; external actions remained locked.

## Residual Gates

- Windows Authenticode signing is absent. The installer hash is verified, but SmartScreen
  reputation is not solved.
- The approximately 17-second first-open Marketing workspace latency is the next local technical
  performance slice.
- Remote staging and production remain at 0% until a reviewed host allowlist and staging
  infrastructure exist. No publish, spend, or production deployment occurred in this slice.
