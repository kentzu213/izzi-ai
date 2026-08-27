# NM-012 production account readiness

Date: 2026-08-28 (Asia/Ho_Chi_Minh)

## Scope

Connect the native Izzi AI Marketing account-readiness surface to the deployed
IzziAPI backend authority, correct the workspace activation request contract,
apply the reviewed Marketing schema to production, release the desktop change,
and verify the installed application without connecting a provider or executing
an external action.

The session uses `relaxed_mode` from the user's authorization because Claude
Code usage is exhausted. Codex implemented, integrated, and independently
verified the work. ChatGPT web was not requested or used.

## Security gate

SECURITY GATE: authentication, secrets, production deployment, and customer
data - risk: a missing public runtime key could fail authenticated account
health, and a schema migration could affect existing data; checked: exact
release SHA, migration hashes, atomic apply receipt, before/after row counts,
runtime health/version, redacted responses, and credential scan; decision:
proceed only with the reviewed schema/account-readiness slice while publish,
schedule, spend, bulk send, customer import, OAuth, and provider actions remain
disabled.

- No secret value is present in this note, the cutover receipt, source control,
  renderer responses, or screenshots.
- The migration receipt reports `externalProviderAction=false`, `spendVnd=0`,
  and unchanged existing row counts.
- The production database reports WAL-G enabled and PITR disabled in the
  cutover receipt. This note does not claim a restore drill.

## Backend production cutover

- Reviewed backend commit:
  `f6cb454c7c8e34650807153ce828bcb155bf310f`.
- The 17-file Marketing bundle was applied as one managed transaction. All
  17/17 migrations were recorded, postflight reported `schemaReady=true`, and
  existing row counts remained unchanged.
- Production receipt:
  `F:\Ai Tools\Codex\Temp\izzi-marketing-production-cutover-f6cb454-receipt.json`.
- The first real desktop request returned HTTP 500 because the VPS runtime did
  not contain `SUPABASE_PUBLISHABLE_KEY`. The public key was added securely to
  `/root/izzi-deploy/.env`; the pre-change environment backup is
  `/root/izzi-deploy/.env.codex-20260827T163346Z.bak`.
- The reviewed `izzi-backend:rc-f6cb454...` container was restored after the
  configuration repair. Live, ready, and version endpoints returned success,
  and the version endpoint reported the reviewed commit.

## Desktop implementation

- PR `kentzu213/izzi-ai#8` merged at `b5e886b`.
- Workspace activation no longer sends the unsupported `slug`; it sends `name`
  plus optional `operatingMode` and rejects names outside 2-100 characters.
- The Marketing renderer consumes backend-owned account readiness and never
  receives provider credentials or a second token authority.
- The Marketing header and tabs no longer overlap or clip at 1280 and 1024
  pixel desktop widths.
- Release bump PR `kentzu213/izzi-ai#9` merged at
  `81086103eec446bc6672549ba6f99684d49d81ee`.

## Verification

| Gate | Result |
| --- | --- |
| Backend full suite | PASS, 1546 passed and 93 skipped |
| Backend production audit | PASS, 0 findings |
| Atomic production migration | PASS, 17/17 applied; existing rows unchanged |
| Desktop full suite | PASS, 1704/1704 |
| Desktop lint and type checks | PASS |
| Full workspace production build | PASS |
| Release contracts and renderer budget | PASS |
| Signing policy | PASS |
| Production dependency audit | PASS, 0 known vulnerabilities |
| External action and spend | PASS, no action; `0 VND` |

## Release and installation

- Public prerelease:
  `https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.60`.
- Release workflow `33096486915` passed Windows, macOS, and the 12-asset
  inventory gate.
- Windows installer SHA-256:
  `d7c5fb7ea5ed75ca0b77fbe6ccb5da5afb472f7ad5f2877359bda9b6dd3e2803`.
- Installation completed with exit code 0 at
  `F:\IzziAI\Izzi\Izzi AI.exe`. The executable and registry report
  `1.14.0-beta.60`.
- The retained profile stayed at 3,493 files. Database, Preferences, and Local
  State hashes were unchanged across installation. Manual updater check
  returned `idle` at the current version.

## Installed application smoke

- The user remained authenticated. Exactly one `Izzi Marketing` workspace was
  present with Owner role, Pro plan, and zero credits used.
- Account health returned `authority=backend_oauth`,
  `externalActionPerformed=false`, and an empty account list.
- No OAuth control was clicked and no provider account was connected.
- No horizontal overflow, header collision, or tab clipping was observed at
  1280x800 and 1024x720.
- Screenshots:
  `F:\Ai Tools\Codex\Temp\izzi-ai-v1.14.0-beta.60-installed-marketing-channels.png`
  and
  `F:\Ai Tools\Codex\Temp\izzi-ai-v1.14.0-beta.60-installed-marketing-compact.png`.

## Remaining work

MKT-02 remains `in_progress`. The next technical patch must make deployment
preflight fail closed when the required Supabase publishable key is absent,
then continue with the smallest authenticated provider-route contract. This
documentation-only reconciliation does not change product bytes and therefore
must not create beta.61.
