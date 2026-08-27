# MKT-04 packaged safety suite

Date: 2026-08-28 (Asia/Ho_Chi_Minh)

## Routing

- Technical tier: T3 because the task changes release CI and verifies auth,
  billing, model, secret, and external-action boundaries.
- Route: Codex direct implementation under `relaxed_mode`. The user previously
  authorized the exact phrase `cho phép nới rule`, and Claude Code usage was
  exhausted for this continuation.
- Claude Code and ChatGPT web were not invoked. Codex owned integration,
  verification, release inspection, installed smoke, and reporting.

## Delivered

- Product PR [#19](https://github.com/kentzu213/izzi-ai/pull/19) merged as
  `38e7be0747e04f5aede63e349d47b5f002e3ecb2`.
- Release PR [#20](https://github.com/kentzu213/izzi-ai/pull/20) merged as
  `315c105b047ed816c1bd91e1bdc386cc09b712c4` and published
  [v1.14.0-beta.64](https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.64).
- The core harness covers publish, spend, bulk, destructive, kill-switch,
  spend-cap, provider-route, recovery, retry/idempotency, billing, model
  identity, provenance, and pending-approval gates.
- The packaged UI harness loads the real renderer at 1280x900 and 390x844 while
  blocking fetch, HTTP/HTTPS, net, TLS, WebSocket, and renderer requests.
- Windows release CI runs the packaged suite after package creation and before
  signing policy enforcement.

## Installed verification

- Installed executable: `F:\IzziAI\Izzi\Izzi AI.exe`.
- FileVersion and updater version: `1.14.0-beta.64`.
- Authentication persisted across installation.
- Provider contract: 7 workflow-ready providers, 4 internal resources,
  allowed operations `read`, `draft`, and `validate`; external execution remains
  blocked.
- Installed UI smoke receipt:
  `F:\Ai Tools\Codex\Temp\izzi-ai-beta64-installed-smoke-receipt.json`.
- Installed-package safety receipt:
  `F:\Ai Tools\Codex\Temp\izzi-ai-beta64-mkt04-packaged-safety-final\customer-marketing-packaged-safety-receipt.json`.
- Final receipt: core pass, UI pass, 2 viewports, 0 console errors, 0 load
  errors, 0 renderer-process failures, 0 network attempts, 0 secret leaks, and
  0 external marketing actions.

## Portability correction

Running the release runner against an installation outside the repository
exposed one test-orchestration defect: the Electron-as-Node harness could not
resolve the repository's `electron` package. The package itself and installed
app remained healthy.

PR [#21](https://github.com/kentzu213/izzi-ai/pull/21) resolves the desktop
dependency root once, provides it only to the core subprocess, removes inherited
Node module resolution from the UI subprocess, and adds a contract assertion.
The corrected runner passed directly against `F:\IzziAI\Izzi` without a caller
environment override. No application runtime byte or provider behavior changed,
so no additional product release is required.

## Verification

- Focused MKT-04 contract: 4/4.
- Full desktop suite: 1,734/1,734 across 127 files.
- Lint: pass.
- Build: pass.
- Production dependency audit: no known vulnerabilities.
- Added-line credential-pattern scan: 0 matches.
- Release workflow
  [33122607322](https://github.com/kentzu213/izzi-ai/actions/runs/33122607322):
  Windows, macOS, inventory verification, and publication all passed.
- Windows installer SHA-256:
  `214d421493b8f9010d383989ad1b7e85d9f61e5245dd631b335f418e9f647231`,
  matching the GitHub release digest.

## Security decision

- Credentials, OAuth, publish, upload, send, spend, bulk, and destructive paths
  were not invoked.
- Test subprocesses strip sensitive environment variables.
- Proof output is constrained to the selected proof directory.
- MKT-05 remains `pending_external`; MKT-04 does not authorize staging or
  production provider execution.

## Next

Prepare the disposable MKT-05 staging host, host allowlist, secret ownership,
rollback command, migration digest, security review, and reviewer approval.
