# Izzi / Starizzi — current state

Timestamp: **2026-07-27 15:40 ICT**
Repo: `F:\Ai Tools\Tool Starizzi - B2C - Openclaw`
Branch: `feature/aibase-my-graph-ui-sync`
HEAD before this session: `066b2d9` (feat(desktop): Customer AI Marketing Room + server-authoritative member roles)
Working tree: **dirty before this session began** — 84 modified files of pre-existing user WIP
(Agent / Graph / Vault / ProjectsHub work). None of it was touched, reverted or committed by this
session except where explicitly noted below.

No secrets are recorded in this file. Configuration is referenced by variable NAME only.

## Gate status

| Gate | State | Evidence |
|---|---|---|
| CMR-007 commercial TTS | **PASS (local)** — LICENSE_VERIFIED + TEST_VERIFIED | Socrates `APPROVE`; `docs/compliance/tts-model-license-evidence.md` |
| CMR-404 dependency audit | **PARTIAL** — audit 74 → 20; ESLint still absent | `docs/compliance/cmr-404-dependency-audit.md` |
| CMR-406 staging deploy | **HUMAN_ONLY_BLOCKER** | no staging infra exists — see below |
| CMR-407 final sign-off | **BLOCKED_BY_CMR_406** | dependency unsatisfied by design |
| izzi session-memory hook | **NOT STARTED** | deferred; see below |

## CMR-007 — commercial TTS gate (PASS, local scope)

Verdict: **VieNeu-TTS v3 Turbo (Apache-2.0) is approved for commercial render; F5 ViVoice
(CC-BY-NC-SA-4.0) is not.** F5 remains usable for non-commercial/internal work.

Chain verified from upstream sources on 2026-07-27: project code, `vieneu` PyPI package and the
v3 Turbo checkpoint are Apache-2.0; the MOSS-Audio-Tokenizer-Nano codec ships under the
Apache-2.0 MOSS-TTS family licence; `sea-g2p` carries an Apache-2.0 `LICENSE`. v3 Turbo is a
from-scratch architecture, so it does not inherit the NeuTTS Air / Emilia non-commercial lineage.

Code delivered:
- `apps/desktop/src/main/customer-marketing/commercial-voice-license.ts` (new) — audited
  registry + `verifyCommercialVoiceLicense` + `readVoiceStudioLicenseEvidence`.
- `apps/desktop/src/main/customer-marketing/customer-video-studio-service.ts` — commercial voice
  gate is now provider-agnostic; Voice Studio evidence fields; async readiness.
- `apps/desktop/src/main/index.ts` — verifier is now actually wired (it never was), Voice Studio
  readiness uses the managed-service `/health/ready` check on the allocated port.
- `extensions/voice-studio/service/backend/{app.py,requirements.txt}` — `/health/ready` reports
  the installed SDK version; `vieneu==3.2.3` pinned.
- `extensions/voice-studio/service/docker-compose.izzi.yml` — image pinned by digest
  (`sha256:746cead1…295f`, resolved live) instead of `:latest`.

Two rounds of Socrates review were required. Round 1 found the real defect: the gate depended on
a verifier callback that was never wired, and a declared model id could be unpinned. Both closed:
the verifier now requires `repo@<hex>` plus a full SHA-256 checkpoint hash.

Known residual (documented, not hidden): the gate verifies the operator's **declaration**; it does
not cryptographically attest the downloaded weights. The pinned image predates the `vieneu==3.2.3`
pin, so `/health/ready` will report a lower SDK version until the image is rebuilt.

## CMR-404 — dependency + lint (PARTIAL)

`pnpm audit --prod`: **74 → 47 → 20** findings (26 high → 14 high). Fixed by raising two direct
dependency floors inside their existing caret ranges (`axios ^1.15.1`, `hono ^4.12.27`) and a
`pnpm dedupe` that dropped a stale `@hono/node-server@…(hono@4.12.9)` peer resolution. Includes the
Hono JWT NumericDate advisory, which matters for tenant isolation.

Verified after the change: `tsc -p tsconfig.main.json --noEmit` exit 0; full desktop suite
**824/824 pass (65 files)**; `vite build` exit 0, max chunk 375.83 kB.

Remaining 20 are transitive through the electron-builder / sharp packaging chain and need
`pnpm.overrides` plus a packaging smoke test — deliberately not forced.

**ESLint: not installed at all** — no `eslint.config.*`, no `.eslintrc*`, and `eslint` /
`@typescript-eslint/*` absent from `node_modules`, so `lint` (`eslint src/`) cannot run. This is a
green-field ESLint 9 flat-config build-out across 6 workspace projects, left as the next task
rather than half-applied. `tsc --noEmit` is the currently enforced static gate.

**Uncommitted on purpose:** `apps/desktop/package.json` and `pnpm-lock.yaml` hold the axios floor
raise **mixed with pre-existing user WIP** (version 1.11.0 → 1.12.0, `test:smoke` change, added
`hyperframes` dependency). Committing them would sweep that WIP into an unrelated commit, so they
were left in the working tree for the owner to commit. `apps/marketplace-api/package.json`
contained only the hono change and was committed.

## CMR-406 — staging deploy (HUMAN_ONLY_BLOCKER)

Searched before declaring the blocker: no `fly.toml`, `render.yaml`, `railway.json`, `vercel.json`,
no `.env.staging*`, no staging CI workflow (`.github/workflows` has only `desktop-ci.yml`,
`publish-voice-image.yml`, `release-desktop.yml`), no deploy script in `apps/marketplace-api`
(`dev`/`build`/`start`/`seed` only), and `apps/marketplace-api/supabase/migrations/` is **empty**.
No Starizzi staging credentials exist in the environment (the `KIRO_*` variables present belong to
a different project).

So this is not a permissions problem — **the staging target does not exist yet**. What is missing,
precisely:

1. A staging host/target decision for `apps/marketplace-api` (container host, Supabase project, or
   VPS) — nothing in the repo names one.
2. Values, supplied through the environment or a secret manager (never pasted into chat or a repo
   file), for the names already declared in `apps/marketplace-api/.env.example`:
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `FRONTEND_URL`, `IZZI_BACKEND_URL`, `PORT`,
   `EXTENSION_STORAGE_PATH`, `COMMISSION_RATE`, `MAX_EXTENSION_SIZE_MB`.
3. Actual migration files. The Supabase migrations directory is empty, so there is no
   production-like schema to apply or approve yet.
4. Explicit owner approval for applying a production-like migration.

Next command once 1–3 exist (nothing destructive before approval):

```powershell
pnpm --filter ./apps/marketplace-api build
# then, against the staging project only:
supabase link --project-ref <staging-ref>
supabase db push --dry-run
```

## CMR-407 — final sign-off (BLOCKED_BY_CMR_406)

Unchanged and correctly blocked. Socrates will not approve a final release while the
staging/production gates are open, and no route around that was attempted.

## izzi session-memory hook (not started)

Historic failure: `MODULE_NOT_FOUND` for `.kiro/hooks/izzi-session-memory.mjs` because the hook
command uses a path relative to a cwd that is not the workspace root. Parked deliberately: it does
not block any CMR gate, and the CMR work had priority. Requires verifying the actual Kiro hook
runtime (events fired, real cwd, duplicate writers) before changing anything.

## Test / build status at close

- Full desktop suite: **824/824 pass**, 65 files.
- `tsc -p tsconfig.main.json --noEmit`: clean.
- `vite build`: clean, max chunk 375.83 kB.
- `pnpm audit --prod`: 20 findings (14 high, 6 moderate), triaged above.

## Next action

1. Build out ESLint 9 flat config across the workspace, then re-run `lint` (CMR-404 remainder).
2. `pnpm.overrides` for the leaf transitive advisories + packaging smoke.
3. Repair the session-memory hook against the verified Kiro hook runtime.
4. CMR-406 needs the four items above from the owner; CMR-407 follows it.
