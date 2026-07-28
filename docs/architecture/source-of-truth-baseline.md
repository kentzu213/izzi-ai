# Source-of-Truth Baseline — Personal Office OS (Loop 00)

> **Purpose.** Establish one verified, reproducible base for the Starizzi / Izzi AI
> **Personal Office OS** programme. Every later loop anchors to the commit recorded here
> instead of to whichever worktree happens to be open.
>
> **Read the gate first.** Loop 01 must confirm `HEAD == 84a57b3` before making any design
> decision. If it differs, stop and re-run Loop 00.

Machine-readable twin: [`source-of-truth-baseline.json`](./source-of-truth-baseline.json).
Narrative log: [`worklogs/personal-office-loop-00.md`](../../worklogs/personal-office-loop-00.md).

---

## 1. Canonical base

| Field | Value |
| --- | --- |
| Canonical commit | `84a57b38117ee7544691115be5aca7a141af1abf` (`84a57b3`) |
| Canonical tag | `v1.14.0-beta.3` |
| Commit subject | `chore(release): prepare Izzi AI 1.14.0-beta.3` |
| Commit date | 2026-07-28T14:19:38+07:00 |
| `origin/main` | same commit — verified, not assumed |
| Installed / migration reference | `v1.14.0-beta.2` = `824e2e5`, confirmed **ancestor** of beta.3 |
| Integration branch | `feature/personal-office-baseline-20260728` |
| Integration worktree | `F:\Ai Tools\_wt-starizzi-personal-office-baseline` |
| Desktop package version | `1.14.0-beta.3` |
| Verified at | 2026-07-28T08:12:03Z |

`v1.14.0-beta.2` is a **reference only** — useful for reasoning about what an installed
build contains. It is never a build or design base.

### What this baseline deliberately is not

The prior worktree `F:\Ai Tools\Tool Starizzi - B2C - Openclaw` (branch
`feature/aibase-my-graph-ui-sync`, tip `959e2d2`) was **not** used as the base, and Loop 00
**wrote nothing to it** — read-only git plumbing and file reads only. Its `HEAD` sits on a
lineage that forked at `d1ff965`, before the beta.1→beta.3 releases.

> It is, however, **not a stable reference point**. A concurrent session changed it *during* this
> loop: 83 entries (31 modified + 52 untracked) at start, 113 (35 + 78) at end, `HEAD` unchanged.
> Any loop that diffs against that worktree must re-snapshot it first — see §7.4 PQ-08.

---

## 2. Environment

| Field | Local | CI (`desktop-ci.yml`) |
| --- | --- | --- |
| Node | **v24.13.0** | **22** |
| pnpm | 10.33.0 | 10 |
| OS | Windows_NT 10.0.26200 | windows-latest, macos-latest |
| Lockfile | `pnpm-lock.yaml` v9.0 | same |

`engines` declares `node >=20`, `pnpm >=9`. There is **no `packageManager` field**, so the
pnpm version is not pinned — a drift risk worth closing at some point, noted rather than
fixed here.

The Node 22 ↔ 24 gap matters for exactly one thing: **native module ABI**. Treat CI as
authoritative for anything that compiles.

---

## 3. Verified command set

```bash
# install (see BF-01 — the documented form does not complete on this host)
pnpm install --frozen-lockfile              # documented; FAILS locally
pnpm install --frozen-lockfile --ignore-scripts   # what actually works here

# build (this is also the typecheck — there is no separate typecheck script)
pnpm --filter @openclaw/desktop build       # tsc -p tsconfig.main.json && vite build
pnpm build:all                              # what CI runs

# test
pnpm --filter @openclaw/desktop test        # vitest run

# lint — neither form works at canonical, see BF-03 / BF-04
pnpm lint:ci                                # script does not exist
pnpm -r lint                                # no ESLint config exists
```

CI runs three steps only: install → `pnpm build:all` → `pnpm --filter @openclaw/desktop test`.
**There is no lint step in CI at canonical.**

---

## 4. Check results

| Check | Command | Result |
| --- | --- | --- |
| CHK-01 | `git worktree add … 84a57b3` | **pass** — 540 files, clean tree, correct branch |
| CHK-02 | `git diff --check` | **pass** — exit 0 |
| CHK-03 | AGENTS.md GitNexus block count | **pass** — exactly 1 |
| CHK-04 | `pnpm install --frozen-lockfile` | **fail** → BF-01 (environment) |
| CHK-05 | `pnpm install … --ignore-scripts` | **pass** — 743 packages, 35.5s |
| CHK-06 | `pnpm --filter @openclaw/desktop build` | **pass** — exit 0, 14.9s, 1136 modules |
| CHK-07 | full test, before Electron fetch | **fail** — 891 pass / 3 fail, all Electron-binary |
| CHK-08 | those 3 suites, after Electron fetch | **pass** — 10/10 |
| CHK-09 | full test, after Electron fetch | **fail-flaky** — 900 pass / 1 fail → BF-02 |
| CHK-10 | the failing suite, isolated | **pass** — 14/14 in 4.71s |
| CHK-11 | `pnpm lint:ci` | **fail** → BF-03 (script absent) |
| CHK-12 | `pnpm -r lint` | **fail** → BF-04 (no config) |
| CHK-13 | `gitnexus analyze` | **pass** — 6898 nodes, 15596 edges |
| CHK-14 | `gitnexus impact ensureSqliteSchema` | **pass** — exact, risk LOW |
| CHK-15 | dirty worktree — Loop 00 wrote nothing | **pass, with finding** — this loop wrote nothing there, but a *concurrent* session changed it: 83 → 113 entries (see §7.4) |

### Build evidence

```
tsc -p tsconfig.main.json && vite build
vite v6.4.1 building for production...
✓ 1136 modules transformed.
../../dist/renderer/index.html                   0.82 kB │ gzip:   0.45 kB
../../dist/renderer/assets/index-Dm-6l7bQ.css  362.69 kB │ gzip:  56.82 kB
../../dist/renderer/assets/index-B7j3vZGB.js   985.22 kB │ gzip: 288.47 kB
✓ built in 14.90s
```

### Test evidence

```
Test Files  1 failed | 69 passed (70)
     Tests  1 failed | 900 passed (901)
```

The single failure is a 40ms timeout overrun under load, not a defect — see BF-02.

---

## 5. Baseline failures — what was already broken

Recorded separately from regressions so that no later loop is blamed for, or blocked by,
pre-existing conditions.

### BF-01 · `pnpm install --frozen-lockfile` cannot complete on this host
**Environment, local only.** `better-sqlite3@11.10.0` has no prebuild for Node 24, falls
back to `node-gyp`, and needs the MSVC *Desktop development with C++* workload. `vswhere.exe`
is absent; no Visual Studio is installed.

Consequence worth internalising: **no compiled `better_sqlite3.node` exists anywhere on this
machine** — verified across both worktrees. The dirty worktree never had one either. So
Loop 01+ cannot exercise a real SQLite handle locally. **Design SQLite-facing contracts to be
unit-testable without a live native binding.** CI (with MSVC, Node 22) remains the real gate.

Workaround used: `--ignore-scripts`, then fetch Electron's prebuilt binary separately
(`node install.js` inside the electron package — a download, no compiler needed).

### BF-02 · One test flakes on a 5000ms timeout
`customer-video-studio-service.test.ts` → *"reports an installed offline runtime without
exposing its local path or enabling commercial render"* hit 5040ms against the 5000ms
default during a loaded full run (transform 53.93s, import 79.15s). It **passed** in an
earlier full run and passes isolated (14/14, tests 3.47s).

Not a regression signal. If it recurs, give the suite an explicit `testTimeout` rather than
hunting a logic bug.

### BF-03 · `lint:ci` does not exist at canonical
Root scripts at `84a57b3` are `dev`, `dev:marketplace`, `build`, `build:all`, `lint`, `clean`.
No `lint:ci`, `lint:fix`, or `lint:strict`.

### BF-04 · No ESLint configuration exists anywhere at canonical
`eslint ^9.18.0` is a devDependency of `apps/desktop` and its script is `eslint src/`, but
`git ls-tree -r 84a57b3` finds **no** `eslint.config.*` and **no** `.eslintrc*`. ESLint 9
dropped implicit eslintrc discovery, so the script exits 2 before linting anything.

> **Consequence for acceptance criteria.** Any requirement phrased as *"lint does not
> increase the warning budget"* has **no baseline number** on canonical, because lint cannot
> run at all. The `--max-warnings 359` ceiling lives only on the old branch and was measured
> against a different file set. Land PQ-01, re-measure on canonical, then enforce.

### Non-blocking warnings

- **W-01** — vite renderer chunk 985.22 kB > 500 kB advisory. Pre-existing bundle debt; a
  sweeper concern, not a domain-modelling one.
- **W-02** — `Failed to replace env in config: ${NODE_AUTH_TOKEN}` twice per pnpm command.
  `.npmrc` declares the `@kentzu213` GitHub Packages scope and the token env var is unset
  locally. Verified harmless: no workspace package resolves `@kentzu213/graph-view` from that
  registry — `apps/desktop` consumes a vendored tarball
  (`file:vendor/kentzu213-graph-view-0.1.1.tgz`). Secret referenced **by name only**; no
  value was read, printed, or logged.
- **W-03** — GitNexus full-text/BM25 and vector search unavailable offline. Graph traversal
  works and reports `epistemic: "exact"`. Prefer graph queries over text search here.

**Regressions introduced by Loop 00: none.** This loop added three documents and changed no
source, config, schema, or dependency.

---

## 6. Code intelligence

| Field | Value |
| --- | --- |
| CLI | gitnexus 1.6.9 |
| Index commit | `84a57b38117ee7544691115be5aca7a141af1abf` — **matches canonical HEAD** |
| Indexed at | 2026-07-28T08:09:39.722Z |
| Scale | 450 files · 6,898 nodes · 15,596 edges · 347 clusters · 300 flows |
| Graph / FTS / vector | available / unavailable / unavailable |

Two operational notes:

1. **Always scope by path.** Many repositories are registered on this host and **three share
   the name `izzi-ai`**. A bare call errors with an ambiguity list. Use
   `--repo "F:\Ai Tools\_wt-starizzi-personal-office-baseline"`.
2. **`gitnexus analyze` has a side effect.** It rewrote its managed doc blocks in 8 tracked
   files (`AGENTS.md`, `CLAUDE.md`, six `.claude/skills/gitnexus/*/SKILL.md`). Loop 00
   reverted all 8 to canonical content, since canonical `AGENTS.md` was already correct with
   exactly one block. Expect this on every re-index; revert it so diffs stay honest.

Verification query — `impact ensureSqliteSchema --direction upstream`:

```
target: Function:apps/desktop/src/main/db/sqlite-schema.ts:ensureSqliteSchema
impactedCount: 3 · risk: LOW · epistemic: exact
affected process: initServices (apps/desktop/src/main/index.ts)
```

---

## 7. Port matrix — `feature/aibase-my-graph-ui-sync` → canonical

13 commits unique to the old branch; 15 unique to canonical; merge-base `d1ff965`.

**Headline: canonical is ahead almost everywhere.** Per-subsystem diffs from canonical to the
old tip are dominated by *deletions*, meaning the old branch **lacks** what canonical has.
Exactly **one** file exists on the old branch and not on canonical: `eslint.config.mjs`.

That reframes the job. This is not "port 13 commits" — it is "port one lint gate, and
deliberately leave the rest."

### 7.1 Must port

| ID | What | Why | Risk |
| --- | --- | --- | --- |
| **PQ-01** | `eslint.config.mjs` (147 lines); root `lint` / `lint:ci` / `lint:fix` / `lint:strict`; root eslint devDeps (`@eslint/js`, `eslint`, `eslint-plugin-react-hooks`, `globals`, `typescript-eslint`); CI Lint step + report-only `pnpm audit --prod \|\| true` | Resolves BF-03 **and** BF-04. Without it, no loop can meet a lint-based acceptance criterion. | **LOW** — additive tooling, no runtime source |

Two cautions: take **only** the lint keys from the old `package.json` (the rest is PQ-05 /
PQ-06 poison), and **re-measure** the warning ceiling on canonical before enforcing 359.

### 7.2 Already in canonical — do not port

| ID | Subsystem | Evidence |
| --- | --- | --- |
| PQ-02 | Customer AI Marketing Room | `066b2d9` → `3b338d3`, same subject; canonical carries *more* (subsystem delta is 6 insertions / 51 deletions in canonical's favour) |
| PQ-03 | CMR-007 commercial voice licence gate | `e3a3e5e` → `644b901`, **identical `patch-id`** `f5eced54…` — byte-for-byte the same change |
| PQ-04 | Scheduled sessions · CMR-404 audit · updater contract test | `apps/desktop/src/main/scheduler` is **identical**; audit doc, contract test, and the `builder-util-runtime 9.7.0` exact pin all present at canonical |

### 7.3 Do not port — porting would regress

| ID | What the old branch would do | Risk |
| --- | --- | --- |
| PQ-05 | Rename `izzi-ai` → `starizzi-app`; downgrade desktop `1.14.0-beta.3` → `1.12.0`; revert descriptions/URLs; downgrade `axios ^1.16.0` → `^1.15.1` | **HIGH** — reverts the deliberate rebrand (`824e2e5`) and downgrades a dependency |
| PQ-06 | Loosen exact pins to carets (`fast-uri`, `js-yaml`, `lodash`, `form-data`) and **drop** `ws 8.21.0`, `sharp 0.35.3`, `adm-zip 0.6.0` entirely | **HIGH — security regression.** Canonical's posture is strictly stronger |
| PQ-07 | Comment-only additions to `allowBuilds` | none; pure diff noise |

One genuine exception inside PQ-06: `@hono/node-server ^1.19.13` exists only on the old
branch. Decide it on its own merits; do not sweep it in with a wholesale port.

### 7.4 Needs manual review

#### PQ-08 · A second Personal Office implementation is being built *right now* — **highest priority**

This is the most consequential finding of Loop 00, and it is not a dormant sketch.

The dirty worktree holds a Personal Office implementation that exists in **no commit on any
branch**, ships its own tests, is **already wired into the main process and renderer**, and was
**still being written during this loop's final verification**.

**Shared contracts** (~30 KB):

| File | Size | Contents |
| --- | --- | --- |
| `shared/work-model.ts` | 16,657 B | Run / Step / Artifact / Approval / Event / Checkpoint / ContextSnapshot / Workspace; `WORK_RUN_TRANSITIONS` state machine; `canonicalJson`; action-hash binding; `WORK_SCHEMA_VERSION = 1` |
| `shared/work-redaction.ts` | 7,465 B | secret-by-shape + PII redaction, prototype-pollution safe |
| `shared/work-model.test.ts`, `work-redaction.test.ts` | 6,223 B | tests |

**Execution plane** — `apps/desktop/src/main/work/`, 13 modules (~160 KB) including
`work-service.ts` (31 KB) + test (15 KB), `run-repository.ts` (38 KB), `work-adapters.ts` + test,
`work-migration.ts` + test, `work-ipc.ts`, `work-approvals.ts`, `work-hash.ts`, `work-sqlite.ts`,
`work-backup.ts`.

**Already-wired integration.** Four tracked files were rewritten at `15:26:06` — which is why the
dirty worktree's modified count moved 31 → 35 mid-loop:

- `main/db/database.ts` — imports `runWorkModelMigration`, `backupSqliteFile`, `WorkService`;
  holds `workService` and a `workEventSink` fan-out; runs the migration during schema setup with
  a pre-change snapshot
- `main/index.ts` (service init), `main/preload.ts` (IPC surface), `renderer/App.tsx` (renderer wiring)

> **Security note for whoever owns this code.** The migration's error path deliberately *logs and
> proceeds* rather than failing closed, justified in-comment by v1 being purely additive. That
> justification expires the moment a destructive migration step is added. Flag it in that loop's
> security review.

**Also present, "Loop 02" layer:** `renderer/shell/*`, `docs/product/personal-office-ia.md`
(5-route IA behind flag `izzi.shell.personalOffice`, default ON), `vault-ops` / `vault-types` /
`wikilink`, `.kiro/specs/graph-view-shared-package/`.

`personal-office-ia.md` independently reaches the same conclusion this loop did: the Loop 00/01
artifacts never existed, so that work was typed against the **existing** contract
`main/agent/types.ts`, keeping `ApprovalRequest` shell-local pending a real approval engine.

**Three compounding risks — CRITICAL:**

1. **Duplicate divergent models.** Loop 01's brief says to create contracts under
   `shared/personal-office/`. A more advanced implementation already lives at
   `shared/work-model.ts`. Building the former without ruling on the latter yields two competing
   models for the same entities.
2. **Unrecoverable if cleaned.** ~190 KB of implementation plus five test files are committed
   *nowhere*. A `git clean` in that worktree destroys all of it.
3. **Contradictory instructions over the same files.** Loop 01 is told *"only schema/contracts/
   skeleton and tests; do not change UI and do not migrate the real database."* Loop 03 has
   **already** wired a real SQLite migration into `database.ts` and edited `App.tsx`. Two active
   loops are editing the same files.

**Recommended sequence:** (1) **preserve the work first** — commit to a branch or export a patch,
because it is currently unrecoverable; (2) have the orchestrator / Socrates rule on adopt vs
supersede vs refactor for `work-model.ts`, and on which loop owns
`database.ts` / `index.ts` / `preload.ts` / `App.tsx`.

#### PQ-09 · 31 modified tracked files in flight

Concentrated in agent runtime and graph UI: `main/agent/{agent-service,custom-openai-provider,host-agent,provider-settings-store}.ts`,
`main/integrations/integrations-service.ts`, `renderer/store/{agentGateway,graphWorkspace}.ts`,
`renderer/pages/{GraphWorkspace,KnowledgeUniverse,ModelConnections}.tsx`,
`renderer/types/{agent-registry,model-catalog}.ts`, `vite.config.ts`, plus two new tests.

`agentGateway.ts` is on the Loop 01 required-reading list **and** is modified-uncommitted — so
the canonical copy is not the copy in flight. Meanwhile canonical already contains
`agentGateway-routing.ts` + test, which the old branch lacks. Diff three ways (canonical vs old
committed vs dirty working copy) before treating any version as source of truth.

---

## 8. Domain surface at canonical

Recorded so Loop 01 reconciles against what exists rather than against an assumption.

**16 SQLite tables:** `settings`, `user_data`, `installed_extensions`, `extension_settings`,
`sync_log`, `diagnostic_events`, `chat_sessions`, `chat_messages`, `agent_state`,
`agent_tasks`, `agent_memories`, `agent_runs`, `agent_run_entries`, `scheduled_sessions`,
`scheduled_session_runs`, `offline_queue`.

Four findings that bear directly on the Loop 01 design constraints:

1. **No `schema_version` table.** Migration style is idempotent DDL plus an `ensureColumn`
   helper. So "schema must be versionable" is **net-new**, not an adjustment.
2. **Chat is currently the spine.** `agent_tasks` keys off `session_id` — a *chat session*.
   The constraint *"chat is not the source of truth of a Run"* is precisely what this
   arrangement has to undo.
3. **Events lack ordering and idempotency.** `agent_run_entries` orders only by `created_at`
   — no sequence number, no idempotency key. But `offline_queue` already demonstrates the
   wanted pattern: `seq INTEGER PRIMARY KEY AUTOINCREMENT` plus `base_updated_at` for
   optimistic concurrency. **Reuse that precedent instead of inventing one.**
4. **The two-plane split is already documented in code.** `graph-types.ts` names the backend
   at `api.izziapi.com/api/aibase/*` as the single source of truth for the personal graph and
   the desktop copy as a mirror — direct evidence for the cloud control plane ↔ desktop
   execution plane split Loop 01 must formalise.

**Trust surfaces** (for the package/runtime trust ADR): `main/extensions/ocx-manifest.ts`
(429 lines) and `permissions.ts`; `packages/agent-bundle/src/manifest.ts` (375 lines);
`main/agent/secret-store.ts` and `agent-permissions.ts`; `main/infra/audit-log.ts` and
`device-guard.ts`.

**Shared contracts:** `agent-turn-events.ts` (delta / reasoning / step / done),
`graph-types.ts`, `customer-marketing-types.ts` (747 lines) and its action-gate /
capability-manifest / credential siblings, `offline-queue.ts`, `universe-adapter.ts`,
`graph-mapper.ts`, `marketing-types.ts`, `model-credit-policy.ts`.

---

## 9. Carry-forward constraints for Loop 01

1. **Verify `HEAD == 84a57b3` before any design work.** Stop if it differs.
2. **Resolve PQ-08 first** — adopt, supersede, or refactor `work-model.ts`. Writing new
   domain contracts before this ruling risks two competing models.
3. **Do not treat BF-02 as a regression.** Confirmed timing flake.
4. **Do not claim a lint warning budget** until PQ-01 lands and the ceiling is re-measured
   on canonical.
5. **Keep new contracts unit-testable without a live `better-sqlite3` binding** (BF-01).
6. **Scope every GitNexus call** with `--repo <absolute worktree path>`.

## 10. Scope boundary

Loop 00 **did not**: cherry-pick or port any feature code; write to, reset, stash, clean, or
check out anything in the dirty worktree; change navigation, UI, database schema, or
dependencies; delete any legacy type or store; or advance to Loop 01.

The one thing Loop 00 *did* write outside its own three artifacts was a revert: `gitnexus analyze`
had rewritten its managed blocks in 8 tracked files **inside the new worktree**, and those were
restored to canonical content. The worktree-local `core.pager` set while debugging was also unset.
Net effect on tracked files: **zero**.

Loop 00 **produced** exactly three artifacts: this document, its JSON twin, and
`worklogs/personal-office-loop-00.md`.
