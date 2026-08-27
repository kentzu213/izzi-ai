# NM-015 Authenticated provider routes

Date: 2026-08-28 (Asia/Ho_Chi_Minh)

## Scope

Complete MKT-02 by adding the smallest authenticated provider-route contract to
IzziAPI and consuming it inside Izzi AI Desktop. The route is read-only and
describes internal campaign, content, asset, and knowledge workflows. It does
not expose or invoke a publish executor.

This continuation used `relaxed_mode` under the user's direct instruction to
work without Claude after its usage was exhausted, following the earlier exact
authorization `cho phép nới rule`. Codex implemented, integrated, verified,
released, installed, and reported the slice. ChatGPT web was not requested or
used.

## Security gate

SECURITY GATE: authentication, customer workspace binding, provider state,
desktop IPC, production deployment, and prerelease installation - risk: a
widened or malformed manifest could expose an executor, cross tenant boundaries,
or imply that external actions are available; checked: exact contract parsing,
workspace identity, fixed route/provider ordering, bounded counts, allowlisted
IPC types, credential scans, dependency audits, production health, CI, release
inventory, installer digest, and installed read-only smoke; decision: release
only `read`, `draft`, and `validate` while failing closed on every contract
contradiction.

- OAuth, publish, schedule, send, bulk, spend, customer import, provider writes,
  and contact writes were not invoked or enabled.
- Credentials remain behind backend/Electron main boundaries. Tokens, provider
  payloads, local paths, route URLs, and executors do not cross IPC.

## Backend production

- Backend PR [#25](https://github.com/kentzu213/izzi-backend/pull/25) merged at
  `7c8821bd11f95433d170d8e25ffdd4a1edc676c9` and passed CI workflow
  `33106153395`.
- The production deployment used a commit-pure package and retained a rollback
  snapshot. Live, ready, and version endpoints returned HTTP 200; `/version`
  reported the exact merge SHA.
- `GET /api/marketing/provider-routes` returns
  `marketing-provider-routes.v1`, four internal route resources, and seven
  bounded provider summaries. Unauthenticated access returns HTTP 401 with
  private no-store cache policy.
- Backend verification: 1,555 passed, 93 skipped, and zero known production
  dependency vulnerabilities.

## Desktop implementation

- `NativeMarketingClient` validates the complete provider-route response and
  fails closed on version, tenant, authority, policy, route, provider, adapter,
  count, readiness, or external-action contradictions.
- Main IPC and preload expose one workspace-ID-only read method. The Marketing
  connection center displays the verified 7/7 workflow scope, allowed internal
  operations, four internal resources, and the external-action lock.
- The same product PR fixes the Agent tab's nested-button warning by using an
  accessible keyboard-operable tab container and a separate close button.
- Product PR [#13](https://github.com/kentzu213/izzi-ai/pull/13) merged at
  `80461dfc1ebedbc919c3841de5f12c75d933a856`. Windows and macOS Desktop CI
  passed.

## Verification

- Focused provider-route and Agent tab contracts: 27/27 passed.
- Full desktop suite: 1,723/1,723 across 126 files.
- Desktop lint and production build passed.
- Production dependency audit: zero known vulnerabilities.
- Scoped credential-pattern scan: zero matches.
- Development and installed Electron smokes both returned 7 providers, 4 route
  resources, zero connected providers, `externalExecution=blocked`, and
  `externalActionPerformed=false`.
- Both smokes found zero IzziAPI request failures, console errors, page errors,
  or horizontal overflow at 1280x900 and 390x844.

## Release and installation

- Release PR [#14](https://github.com/kentzu213/izzi-ai/pull/14) merged at
  `7a890e5a056928092227d709cd748f048c1a765d`.
- Release Desktop workflow
  [33109842909](https://github.com/kentzu213/izzi-ai/actions/runs/33109842909)
  passed Windows, macOS, and the exact 12-asset inventory gate.
- Public prerelease:
  `https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.62`.
- Windows installer SHA-256:
  `24c58445bd4b0188b796c4bcbb10c442129fc16dfa7ee055aa7da2399d18f1b5`.
  The digest matched the GitHub release metadata before installation. The beta
  installer is intentionally unsigned under the repository prerelease policy.
- Silent in-place installation completed with exit code 0 at
  `F:\IzziAI\Izzi\Izzi AI.exe`. FileVersion, registry, and updater report
  `1.14.0-beta.62`; the retained profile remained authenticated.

## Installed application smoke

The read-only smoke used
`F:\Ai Tools\Codex\Temp\nm-015-installed-app-smoke.cjs` against the installed
application over a loopback debugging port.

- Updater state was `idle` at `1.14.0-beta.62` with no error or newer version.
- Native Marketing account health returned `authority=backend_oauth`, zero
  accounts, and `externalActionPerformed=false`.
- The provider manifest was tenant-bound, all seven providers were workflow
  ready and not live-ready, and all denied external operations remained visible
  as locked.
- Screenshots:
  `F:\Ai Tools\Codex\Temp\izzi-ai-beta62-nm015-provider-routes-desktop.png`
  and `F:\Ai Tools\Codex\Temp\izzi-ai-beta62-nm015-provider-routes-compact.png`.

## Result

MKT-02 is complete at the internal authority and route-contract layer. MKT-03
may now add a separately approved, budgeted model-backed draft path. External
publishing, scheduling, spend, bulk send, customer import, and provider
execution remain disabled and require later milestones and explicit approval.
