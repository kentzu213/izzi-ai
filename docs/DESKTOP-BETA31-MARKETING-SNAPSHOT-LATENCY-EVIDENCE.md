# Izzi AI Desktop Beta31 Marketing Snapshot Latency Evidence

Date: 2026-08-11 ICT

Scope: remove optional media readiness probes from the initial AI Marketing render path, preserve
the fail-closed security boundary, publish a verified beta, install it over beta30, and smoke the
real Windows application. Video/F5 production work remains deferred.

## Product Change

- Commit `6d0159dd382e9c83316ef8e784a1e4713434eda2` gives the first snapshot a
  250 ms optional-media budget and paints the workspace before full toolchain readiness is known.
- HyperFrames, Node, FFmpeg, F5, and Voice Studio readiness refreshes in the background.
- Concurrent toolchain probes are deduplicated, and a renderer request ID prevents an old refresh
  from replacing a newer snapshot.
- Initial and refresh IPC handlers accept no renderer payload. Tenant identity remains main-process
  derived, and unavailable media readiness keeps preview, commercial render, publish, and spend
  unavailable.

## Verification

| Gate | Result |
|---|---|
| Five-workspace build | PASS, 1,140 renderer modules |
| Workspace lint | PASS |
| Desktop suite | PASS, 88/88 files and 1,268/1,268 tests |
| Renderer budget | PASS, 2/2 |
| Actions / lint / Socrates contracts | PASS, 5/5, 4/4, 4/4 |
| Full and production dependency audits | PASS, no known vulnerability |
| Product commit CI | PASS, run `31485690064`, Windows/macOS, zero annotations |
| Release candidate CI | PASS, run `31485996696`, Windows/macOS, zero annotations |
| Release workflow | PASS, run `31486194623`, Windows/macOS/inventory, zero annotations |

Production-renderer smoke with the retained authenticated profile measured:

- immediate navigation after a fresh process: 1,826 ms;
- navigation after Chat settled and preloaded the route: 890 ms;
- installed beta31 navigation after Chat settled: 963 ms.

Desktop 1280 x 800 and mobile 390 x 844 had no horizontal overflow. No renderer console error or
page error was captured. No workflow was started and external actions remained locked.

## Public Release And Installed Smoke

- Release: `https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.31`
- State: public prerelease with 12 assets and a GitHub SHA-256 digest for every asset.
- Windows installer: `Izzi-AI-1.14.0-beta.31-win-x64.exe`, 185,852,189 bytes.
- Verified installer SHA-256:
  `33527249f4bc90afe311e88cfc359fd218dc55b4d19dc916243fc70d055c6473`.
- Silent upgrade exited `0`; installed app version is `1.14.0-beta.31` at
  `F:\IzziAI\Izzi\Izzi AI.exe`.
- Installed desktop smoke showed the operational IzziAPI Marketing dashboard in 963 ms, with no
  horizontal overflow, loading state left behind, console error, or page error.
- Local screenshots remain outside Git because the retained profile contains workspace details.

## Residual Gates

- The Windows installer is not Authenticode signed. Its local SHA-256 matches the public GitHub
  digest, but SmartScreen reputation is not solved.
- Remote staging and production remain at 0% until a reviewed host allowlist and staging
  infrastructure exist.
- No publish, spend, production deployment, direct F5 generation, or commercial render occurred.
