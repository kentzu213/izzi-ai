# NM-014 Provider Vault native authority

Date: 2026-08-28 (Asia/Ho_Chi_Minh)

## Scope

Repair the installed Izzi AI Provider Vault so its safe status and maintenance
operations use the same Native Marketing workspace authority already owned by
IzziAPI. Preserve the legacy Customer Marketing bridge for resource, workflow,
and canary-send execution, and keep all external provider actions disabled.

This continuation uses `relaxed_mode` from the user's authorization because
Claude Code usage is exhausted. Codex implemented, integrated, and independently
verified the slice. ChatGPT web was not requested or used.

## Security gate

SECURITY GATE: authentication, provider credentials, customer workspace
binding, and installed-app verification - risk: resolving the wrong workspace
could expose or mutate another tenant's connection state, while broadening the
new authority could accidentally reach an external provider; checked: unique
workspace binding, Owner/Manager mutation guards, redacted renderer contracts,
legacy-bridge isolation, secret scans, production health, and an installed smoke
that performed no external action; decision: release only six bounded vault
operations and fail closed for every ambiguous or unsupported path.

- Credential bytes stay in the Electron main process and are absent from
  renderer responses, logs, screenshots, and this worklog.
- OAuth, publish, schedule, spend, customer import, bulk send, resource
  execution, workflow execution, and canary send are not enabled by NM-014.

## Implementation

- `apps/desktop/src/main/customer-marketing/customer-marketing-integration-authority.ts`
  resolves the uniquely bound Native Marketing workspace and rejects missing,
  malformed, or ambiguous authority.
- `apps/desktop/src/main/customer-marketing/customer-marketing-service.ts` uses
  that authority only for credential summaries, connector-operation summaries,
  integration health, credential revoke, canary readiness, and Telegram sandbox
  configuration.
- `apps/desktop/src/main/index.ts` injects the Native Marketing workspace
  authority into the Customer Marketing service.
- Read-only authority resolution never writes a replacement Customer Marketing
  workspace record. Existing resource, workflow, and canary-send methods remain
  bound to the legacy bridge and fail closed when that bridge is unavailable.

## Verification

- Desktop PR [#11](https://github.com/kentzu213/izzi-ai/pull/11) records
  262 passing focused tests and 1,714 passing desktop tests across 124 files.
  Build, main and renderer typechecks, lint, renderer budget, and repository
  contracts passed.
- PR #11 also records 11 passing signing-policy checks, zero production
  dependency vulnerabilities, and zero scoped credential-pattern findings.
- Desktop CI run
  [33101784604](https://github.com/kentzu213/izzi-ai/actions/runs/33101784604)
  passed on Windows and macOS.
- Release Desktop run
  [33102035989](https://github.com/kentzu213/izzi-ai/actions/runs/33102035989)
  completed successfully and `gh release view v1.14.0-beta.61 --repo kentzu213/izzi-ai`
  returned the complete 12-asset release inventory.
- Public `Invoke-WebRequest` probes to `https://api.izziapi.com/healthz/live`,
  `/healthz/ready`, and `/version` returned HTTP 200 at backend SHA
  `0c900b7d645b2bbb818f000c7c14f8cd2642a105`.

## Release and installation

- Product commit: `cdbee30561507c534aeacff0ba272ae4cedf28bf`.
- Desktop merge commit and tag target:
  `a44821c222019cd0fbb0d983e5868ec21d76b753`.
- Public prerelease:
  `https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.61`.
- Windows installer SHA-256:
  `9cd2a632b938fa2a20a8ab4c57d5bd7c1c681ba10d662ce4ada98db138b537a7`.
- Installation target: `F:\IzziAI\Izzi\Izzi AI.exe`. Windows registry and
  the in-app updater both report `1.14.0-beta.61`.

## Installed application smoke

The read-only smoke command used the bundled Playwright runtime to execute
`F:\Ai Tools\Codex\Temp\nm-014-installed-app-smoke.cjs` against the single
already-running installed app over its local debugging port.

- Authentication survived installation and Native Marketing remained connected.
- Provider Vault displayed `Vault sẵn sàng`; credential, operation, and canary
  readiness responses all returned `status=synced`.
- The renderer received nine disconnected provider summaries with no grants,
  zero operation receipts, `liveReady=false`, and
  `externalActionPerformed=false`.
- The smoke recorded zero failed IzziAPI requests, zero console errors, zero
  page errors, zero vault alerts, and zero horizontal-overflow findings.
- Screenshot:
  `F:\Ai Tools\Codex\Temp\izzi-ai-beta61-nm014-provider-vault-smoke.png`.
- The post-install profile contained 3,489 files. Database, Preferences, and
  Local State byte counts and hashes matched the pre-install receipt at
  `F:\Ai Tools\Codex\Temp\izzi-ai-beta61-preinstall-profile.json`.

## Result

NM-014 is complete and publicly installed. Provider Vault now has a usable,
tenant-bound Native Marketing authority for its six safe operations without
creating a second token authority or widening external-action permissions.

MKT-02 remains in progress. The next product slice is the smallest authenticated
provider-route contract, with OAuth, publish, schedule, spend, customer import,
bulk send, and external provider actions still disabled.
