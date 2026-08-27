# Izzi AI current state

Timestamp: 2026-08-28 01:29 ICT

## Canonical product

- Repository: `kentzu213/izzi-ai`
- Branch: `main`
- Released desktop: `v1.14.0-beta.61`
- Released desktop merge commit: `a44821c222019cd0fbb0d983e5868ec21d76b753`
- Released product commit: `cdbee30561507c534aeacff0ba272ae4cedf28bf`
- Production backend commit: `0c900b7d645b2bbb818f000c7c14f8cd2642a105`
- Installed Windows app: `F:\IzziAI\Izzi\Izzi AI.exe`
- Stable profile: `%APPDATA%\@openclaw\desktop`
- Windows installer remains unsigned because a signing certificate is not configured.

## Goal state

- MKT-01 Channel connection center: complete.
- MKT-02 Integration authority and provider routes: in progress.
- MKT-03 through MKT-07: pending in the dependency order in `MASTER_PLAN.md`.
- Video work is outside the active scope. Technical Marketing Room work has priority.

## Released baseline

- Beta.57 shipped the bounded native Auto Post manifest import. Beta.58 narrowed
  optional Native Marketing connection errors. Beta.59 added scoped provider
  grants. Beta.60 added backend-owned account readiness and corrected workspace
  activation.
- Beta.61 restores Provider Vault through the Native Marketing workspace
  authority without moving resource, workflow, or canary-send execution off the
  fail-closed legacy bridge.
- Release Desktop workflow `33102035989` completed successfully and published
  12 assets; evidence: `gh release view v1.14.0-beta.61 --repo kentzu213/izzi-ai`.

## Production backend

- Backend PR [#24](https://github.com/kentzu213/izzi-backend/pull/24)
  merged the fail-closed Supabase public-key deployment preflight at
  `0c900b7d645b2bbb818f000c7c14f8cd2642a105`.
- The preflight accepts either supported public-key name, rejects empty values,
  placeholders, unresolved references, and accidental service-role key reuse,
  and does not print credential bytes.
- Public `Invoke-WebRequest` probes to `https://api.izziapi.com/healthz/live`,
  `/healthz/ready`, and `/version` returned HTTP 200 and the exact production SHA
  `0c900b7d645b2bbb818f000c7c14f8cd2642a105`. Readiness reports Supabase,
  fixed-price billing, payload expiry, and Codex LB as healthy.

## NM-014 Provider Vault native authority

- Provider Vault resolves the uniquely bound Native Marketing workspace and
  uses that authority for credential summaries, operation summaries, health,
  revoke, canary readiness, and Telegram sandbox configuration.
- Multiple available workspaces without an unambiguous binding fail closed.
  Read-only authority resolution does not overwrite the Customer Marketing
  workspace record.
- Resource, workflow, canary-send, OAuth, publish, schedule, spend, customer
  import, bulk send, and every external provider action remain outside this
  authority slice.
- Implementation evidence is in
  `worklogs/2026-08-28-nm-014-provider-vault-native-authority.md`.

## Verification evidence

- Desktop PR [#11](https://github.com/kentzu213/izzi-ai/pull/11) records
  262 focused tests and 1,714 full desktop tests across 124 files, plus passing
  build, typecheck, lint, renderer budget, and repository contracts.
- Signing policy passed 11 checks; the production dependency audit and scoped
  credential scan each reported zero findings in PR #11.
- Backend PR [#24](https://github.com/kentzu213/izzi-backend/pull/24) records
  6 focused deployment-gate tests, 1,547 passing backend tests, 93 skipped tests,
  two release-package contract tests, a passing TypeScript build, and a clean
  production dependency audit.

## Release and installed smoke

- Public prerelease:
  `https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.61`.
- Windows installer SHA-256:
  `9cd2a632b938fa2a20a8ab4c57d5bd7c1c681ba10d662ce4ada98db138b537a7`.
- Windows registry and the in-app updater report `1.14.0-beta.61`; updater state
  is `idle` with no available newer version.
- Installed smoke through
  `F:\Ai Tools\Codex\Temp\nm-014-installed-app-smoke.cjs` retained
  authentication, found Native Marketing connected, and reported
  `Vault sẵn sàng`.
- The same smoke returned nine disconnected provider summaries with no grants,
  zero operation receipts, `liveReady=false`, and
  `externalActionPerformed=false`; it found zero request, console, page, or
  horizontal-overflow errors.
- The retained profile contained 3,489 files after installation; database,
  Preferences, and Local State byte counts and hashes matched the pre-install
  receipt at
  `F:\Ai Tools\Codex\Temp\izzi-ai-beta61-preinstall-profile.json`.
- Screenshot:
  `F:\Ai Tools\Codex\Temp\izzi-ai-beta61-nm014-provider-vault-smoke.png`.

## Operating mode

- `relaxed_mode` remains active from the user's authorization because Claude
  usage is exhausted.
- Claude and ChatGPT web were not used for this continuation.
- Codex remains implementation owner, verifier, integrator, and reporter.

## Next action

Continue MKT-02 with the smallest authenticated provider-route contract. Keep
OAuth, publish, schedule, spend, customer import, bulk send, and every external
provider action disabled.
