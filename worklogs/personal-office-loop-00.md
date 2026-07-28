# Personal Office OS — Loop 00 worklog

**Date:** 2026-07-28 · **Role:** builder · **Status:** complete, handed off
**Goal:** produce a verified canonical baseline (worktree + evidence + port matrix) for the
Personal Office OS programme.
**DONE criteria:** integration worktree exists at `84a57b3`; three artifacts written; build /
test / lint evidence captured; GitNexus index matches canonical HEAD; port matrix complete;
dirty worktree untouched.

Artifacts: [`docs/architecture/source-of-truth-baseline.md`](../docs/architecture/source-of-truth-baseline.md)
· [`.json`](../docs/architecture/source-of-truth-baseline.json) · this file.

---

## What happened, in order

**1. Confirmed the base before touching anything.** `84a57b3` exists, carries tag
`v1.14.0-beta.3`, and `origin/main` points at the same commit — verified rather than assumed.
`v1.14.0-beta.2` (`824e2e5`) confirmed an ancestor via `merge-base --is-ancestor`, so its role
as an installed/migration reference is sound. Merge-base with the old branch is `d1ff965`.

**2. Created the worktree.** `git worktree add -b feature/personal-office-baseline-20260728`
at `84a57b3` → 540 files, `git status --porcelain` empty, `git diff --check` exit 0.

**3. Checked the AGENTS.md claim and it held.** Canonical has exactly **one** GitNexus block.
The duplicated double-block is confined to the dirty worktree. No fix applied — none was
needed, and editing it would have been unrequested churn.

**4. Install hit a wall, and the wall was the machine.** `pnpm install --frozen-lockfile`
died in `better-sqlite3@11.10.0`'s node-gyp step: *"Could not find any Visual Studio
installation to use"*. Rather than guess, I checked the environment — `vswhere.exe` absent, no
node version manager, and no compiled `better_sqlite3.node` anywhere on disk **including the
dirty worktree that has been used for development**. So this isn't new breakage; native SQLite
has never built on this host. Root cause: Node 24 locally (no prebuild for that ABI) plus no
MSVC toolchain. Recorded as **BF-01** and worked around with `--ignore-scripts` (743 packages,
35.5s).

**5. Build passed clean.** `tsc -p tsconfig.main.json && vite build` → exit 0, 1136 modules,
14.90s. Only a chunk-size advisory (W-01).

**6. Tests: chased the failures to root cause instead of reporting a number.** First full run
gave 891 pass / 3 fail with 2 suites failing to load — but all five sites shared one message:
*"Electron failed to install correctly"*. That was a consequence of my own `--ignore-scripts`,
not of the code. Electron's postinstall only *downloads* a binary (no compiler), so I ran it
directly: `electron.exe`, 190,557,184 bytes, exit 0. Re-ran those three suites → **10/10 pass**.

Full re-run then gave **900 pass / 1 fail** — and the failure had *moved* to
`customer-video-studio-service.test.ts`, timing out at 5040ms against the 5000ms default while
the transform phase took 53.93s. A suite that passed minutes earlier failing by 40ms under load
is a flake, not a defect. Confirmed by isolating it: **14/14 pass in 4.71s**. Recorded as
**BF-02**.

**7. Lint does not exist at canonical — this is the real finding.** `pnpm lint:ci` →
*"Command lint:ci not found"*. `pnpm -r lint` → ESLint 9.39.4: *"couldn't find an
eslint.config file"*, exit 2. `git ls-tree -r 84a57b3` confirms **no** `eslint.config.*` and
**no** `.eslintrc*` anywhere, even though `eslint ^9.18.0` is a devDependency with script
`eslint src/`. CI has no lint step either. Recorded as **BF-03** / **BF-04**.

This has a direct consequence for the acceptance criterion *"lint must not increase the
warning budget"*: **there is no baseline number to compare against**, because lint cannot run
at all. The `--max-warnings 359` ceiling exists only on the old branch and was measured against
a different file set.

**8. Indexed GitNexus and verified it, twice over.** `gitnexus analyze` → exit 0, 43.8s, 6,898
nodes / 15,596 edges / 300 flows. `meta.json` `lastCommit` is exactly `84a57b3…` on the right
branch. Then I actually ran a query rather than trusting the banner:
`impact ensureSqliteSchema --direction upstream` → impactedCount 3, risk LOW,
`epistemic: "exact"`, affected process `initServices`. Two gotchas recorded: the bare repo name
is **ambiguous** (three registered repos are called `izzi-ai`, so `--repo <abs path>` is
mandatory), and FTS/vector search are unavailable offline (W-03) so graph queries are the tool
of choice here.

**9. Cleaned up a tool side effect.** `gitnexus analyze` rewrote its managed doc blocks in 8
tracked files (`AGENTS.md`, `CLAUDE.md`, six skill files). Since canonical was already correct,
I reverted all 8 via `git checkout --` so the worktree diff shows only Loop 00's real output.
Also unset the worktree-local `core.pager=cat` I had set while debugging empty `git diff`
output, restoring git config to default.

---

## Port matrix — the headline

I expected "port 13 commits" and found the opposite. **Canonical is ahead of the old branch on
every feature subsystem.** Per-subsystem diffs from canonical → old tip are dominated by
*deletions*, i.e. the old branch **lacks** what canonical has. Exactly one file exists on the
old branch and not on canonical: **`eslint.config.mjs`**.

- **Must port (1):** the ESLint 9 flat config + `lint:ci`/`lint:fix`/`lint:strict` + root
  eslint devDeps + the CI lint step. Fixes BF-03/BF-04. Risk LOW.
- **Already in canonical (3 groups):** Customer Marketing Room (`066b2d9`→`3b338d3`); CMR-007
  voice gate (`e3a3e5e`→`644b901`, **identical `patch-id`** — byte-for-byte); scheduled sessions
  + CMR-404 audit + updater contract test (`scheduler/` is byte-identical).
- **Do not port (3):** the old branch would revert the `izzi-ai` rebrand, downgrade desktop
  `1.14.0-beta.3`→`1.12.0`, downgrade axios, loosen exact security pins to carets, and **drop**
  the `ws`/`sharp`/`adm-zip` pins. Canonical's posture is strictly stronger. Porting these is a
  security and version regression.
- **Needs review (2):** see below.

## The finding that should gate Loop 01

**PQ-08.** The dirty worktree contains a *second* Personal Office implementation that exists in
**no commit on any branch** — and I caught it mid-construction.

I first read `work-model.ts` and `work-redaction.ts` as a static draft. On final verification the
dirty worktree's counts had moved (83 → 113 entries) even though I had written nothing there.
Checking mtimes explained it: `main/db/database.ts`, `main/index.ts`, `main/preload.ts` and
`renderer/App.tsx` were all rewritten at the same instant, `15:26:06` — between my JSON write
(15:23:39) and my worklog write (15:31:26). Files under `main/work/` carry mtimes running
continuously from 14:46:50 to 15:26:21, and the untracked count ticked 77 → 78 while I was
counting it. **A concurrent "Loop 03" session is building in that worktree right now.**

What it amounts to: ~30 KB of shared contracts (`work-model.ts` with a `WORK_RUN_TRANSITIONS`
state machine, `canonicalJson`, action-hash binding, `WORK_SCHEMA_VERSION = 1`; plus
`work-redaction.ts`), ~160 KB of execution plane across 13 modules in `main/work/`
(`work-service.ts` 31 KB, `run-repository.ts` 38 KB, `work-ipc.ts`, `work-migration.ts`,
`work-backup.ts`, …), **five test files**, and live wiring into `database.ts` (a real SQLite
migration with a pre-change snapshot), `preload.ts`, `index.ts` and `App.tsx`.

Three things follow, and none are builder calls:

1. **It is unrecoverable.** ~190 KB plus its tests are committed nowhere. One `git clean` in that
   worktree and it is gone. Preserving it is urgent and comes before any design discussion.
2. **Loop 01's brief collides with it.** Loop 01 is told to create contracts under
   `shared/personal-office/` and *not* to change UI or migrate the real database. Loop 03 already
   put a model at `shared/work-model.ts`, already migrates SQLite, already edited `App.tsx`. Two
   loops are issuing contradictory instructions over the same files.
3. **`personal-office-ia.md` reached my conclusion independently** — from the other direction. It
   records that the Loop 00/01 artifacts never existed, so it typed the shell against the existing
   `main/agent/types.ts` and kept `ApprovalRequest` shell-local. That is a second witness that the
   programme has been running without a baseline, which is exactly what this loop fixes.

I did not act on any of it. Loop 00 is inventory-only, and adopt-vs-supersede is an
orchestrator/Socrates ruling.

One security detail worth carrying into that review: the new migration's error path deliberately
*logs and proceeds* instead of failing closed, justified in-comment by v1 being purely additive.
That justification expires the moment a destructive step is added.

## What I did not do

No cherry-pick or feature port. **No write of any kind to the dirty worktree** — read-only git
plumbing (`log`, `diff`, `show`, `cat-file`, `ls-tree`, `patch-id`, `merge-base`, `status`) and
file reads only; no reset, stash, clean, or checkout. No navigation, UI, schema, or dependency
change. No legacy type or store deleted. Did not advance to Loop 01.

I have to be precise on one acceptance criterion, though. *"The dirty worktree was not modified"*
is true **of my actions** and false **of its state**: it went from 83 to 113 entries during the
loop because another session owns it concurrently. I am not claiming a clean bill of health I
cannot verify. `HEAD` there is unchanged at `959e2d2`, and `work-model.ts` is intact.

Inside the *new* worktree I made exactly one non-artifact change, and reverted it: `gitnexus
analyze` rewrote its managed blocks in 8 tracked files, so I restored all 8 to canonical and unset
the `core.pager` I had set while debugging empty `git diff` output. Net tracked-file change: zero.

---

## Handoff

**Next loop must, in this order:**

0. **Preserve the Loop 03 work first** (branch or patch it out of the dirty worktree). It is
   ~190 KB of uncommitted implementation plus five test files, currently unrecoverable. This
   outranks everything else because it is the only irreversible item on the list.
1. **Resolve PQ-08** — adopt / supersede / refactor `work-model.ts`, and decide which loop owns
   `database.ts` / `index.ts` / `preload.ts` / `App.tsx` — *before* writing new domain contracts.
   Needs orchestrator or Socrates, not a builder.
2. Verify `HEAD == 84a57b3` before any design decision; stop if it differs.
3. Land PQ-01 (lint gate), then re-measure the warning ceiling on canonical before enforcing it.
4. Treat BF-02 as a known flake, not a regression.
5. Keep new contracts unit-testable without a live `better-sqlite3` binding (BF-01).
6. Scope every GitNexus call with `--repo <absolute worktree path>`.
7. Re-snapshot the dirty worktree before diffing against it; a stale snapshot goes wrong within
   minutes while the concurrent session runs.

**Open items parked (not blocking Loop 00):** no `packageManager` field pins pnpm (drift risk);
W-01 bundle-size debt is a sweeper concern; `@hono/node-server ^1.19.13` exists only on the old
branch and needs an independent decision.
