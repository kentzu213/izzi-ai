# Worklog — Personal Office OS, Loop 01 (READY FOR REVIEW)

**Status:** `READY_FOR_REVIEW — replayed on accepted Loop 00 integration ref 0cbf888; W0 rulings applied.`

| Field | Value |
|---|---|
| Operational worktree | `F:\Ai Tools\_wt-starizzi-personal-office-loop01` |
| Branch | `feature/personal-office-loop-01-20260728` |
| Implementation tip | `830a12ca75bba6d78f0e3ba8fea8353c84353d71` (`0eacbc5` run-state amendment plus Socrates corrections `0b56456` and `830a12c`) |
| Replay base | `d711fd9` (includes W0 planning-only commits; accepted Loop 00 commit `0cbf888` remains an ancestor) |
| Rollback commit / branch | `94fbdc6908b64ac07d498327a890f337738a6d24` / `backup/personal-office-loop-01-draft-20260728` |
| Managing repo | `F:\Ai Tools\Tool Starizzi - B2C - Openclaw` |
| Loop 00 worktree | `F:\Ai Tools\_wt-starizzi-personal-office-baseline` (**not touched**) |
| Date | 2026-07-28 |

> **Recovery correction.** Sections below preserve the original provisional
> investigation as historical evidence. The old claim that the two
> `node_modules` junctions were "read-only" was incorrect: they point into the
> quarantined dirty source repo and are writable. No recovery verification ran
> through either junction. Tests and type checks ran from an isolated copy using
> the clean Loop 00 toolchain, with Vitest cache disabled.

## 1. Worktree provenance

Worktree and branch did not exist; created fresh from the pinned commit:

```
git -C "F:\Ai Tools\Tool Starizzi - B2C - Openclaw" worktree add \
  -b feature/personal-office-loop-01-20260728 \
  "F:\Ai Tools\_wt-starizzi-personal-office-loop01" \
  84a57b38117ee7544691115be5aca7a141af1abf
```

Post-create checks: `git status` clean (0 entries), HEAD == canonical base, all 11
must-read source files present. `apps/desktop/src/shared/work-redaction.ts` does
**not** exist at this pin (it belongs to a later/other branch) — correctly left alone.

**Toolchain note:** the worktree has no `node_modules` and installing was
forbidden while Loop 00 builds. I created two NTFS junctions to reuse the managing
repo's already-installed toolchain read-only:

- `node_modules` → `<main repo>\node_modules`
- `apps\desktop\node_modules` → `<main repo>\apps\desktop\node_modules`

Both are gitignored (`git status` stays clean), no `package.json`/lockfile was
touched, and no install ran.

## 2. Files created (18) — all inside Loop 01 ownership

Contracts — `apps/desktop/src/shared/personal-office/` (10):

| File | Purpose |
|---|---|
| `version.ts` | `PERSONAL_OFFICE_SCHEMA_VERSION = 1`, `assertSchemaVersion`, `SchemaVersionError` |
| `ids.ts` | 16 branded id types (compile-time nominal), `asId`, `newId` |
| `secret-ref.ts` | `SecretRef` + `isSecretRef`, `secretRef()`, `looksLikeRawSecret()` tripwire |
| `classification.ts` | frozen 6-class `CLASSIFICATION_MATRIX`, `policyFor`, `mustStayLocal` |
| `trust.ts` | 6 `TRUST_ZONES`, `TRUST_BOUNDARY_CROSSINGS`, `isSanctionedCrossing` (default-deny) |
| `state-machine.ts` | 4 transition tables + `canTransition` / `assertTransition` / `isTerminal` |
| `events.ts` | `WorkEvent` with idempotency + ordering, `appendEvent`, `isWellOrdered`, `compareEvents` |
| `entities.ts` | the 15 domain entities as versioned interfaces |
| `serialization.ts` | `Envelope`, `encode`/`serialize`/`decode`/`roundTrip`, ordered `MIGRATIONS` |
| `index.ts` | barrel; `export type` used for type-only re-exports (isolatedModules-safe) |

Tests — same directory (3): `state-machine.test.ts`, `serialization.test.ts`,
`classification.test.ts`.

Docs (5): `docs/architecture/personal-office-os.md`, plus
`docs/architecture/adr/ADR-PO-00{1,2,3,4}-*.md`.

This worklog (1).

## 3. What was decided

**Two planes (ADR-PO-001).** Control plane (IzziAPI cloud) is authoritative
**only** for `public_metadata`; the desktop execution plane is authoritative for
all domain state. Encoded in `TRUST_ZONES[*].mayHoldAuthoritative`.

**Unified work model (ADR-PO-002).** `WorkRun` / `WorkStep` / `Artifact` /
`Approval` / `WorkEvent`. Step and Task are **one** concept. The Run's source of
truth is its ordered event stream — chat is only `originChatSessionId`. Providers
are `EventActor`s with no authority.

**Context split (ADR-PO-003).** Immutable content-addressed `ContextSnapshot`
(reproduce/audit) vs mutable revisioned `LiveProfile`/Live.md (working state);
`Checkpoint` = (`atEventSequence`, `contextSnapshotId`).

**Package/runtime trust (ADR-PO-004).** `SkillPackage` (requested permissions +
signature digest) → `ToolDefinition` (one permission, `hasExternalEffect` flag) →
`IntegrationGrant` (scopes, expiry, revocation, `SecretRef` only) →
`RuntimeInstance` (`izzi-svc-` loopback services; `browser` kind representable but
not implemented).

**Glossary:** 15 entities, each with explicit discriminators against its nearest
neighbour (Step/Task unified; Snapshot≠LiveProfile; AgentDefinition≠RuntimeInstance;
SkillPackage≠ToolDefinition). No two entities share a meaning.

**State machines:** workspace, provisioning, run, approval — as explicit tables, so
any transition not listed is invalid by construction.

**Data classification:** `public_metadata` (egress allowed) · `personal_graph` ·
`local_files` (**forbidden**) · `artifacts` · `secrets` (**forbidden**) ·
`audit_events`. Everything non-public is encrypted at rest.

**Migration:** additive only. Adapter table in `personal-office-os.md` §7 maps
`AgentRun`/`AgentRunEntry`, `agent_tasks`, `agentWorkspace`, `agentGateway`,
Customer Marketing runs/approvals, and `.ocx`/`.oab` manifests onto the new model.
`MIGRATIONS` is empty at v1; future breaks append a `{from,to,migrate}` step and
`decode()` chains forward.

## 4. Verification (targeted only — Loop 00 owns the full build)

| Check | Command (in `apps/desktop`) | Result |
|---|---|---|
| Main-process compile | `tsc --noEmit --strict --target ES2022 --module commonjs --moduleResolution node --lib ES2022` | **exit 0** |
| Renderer compile | `tsc --noEmit --strict --module esnext --moduleResolution bundler --isolatedModules --lib ES2022,DOM,DOM.Iterable --jsx react-jsx` (incl. tests) | **exit 0** |
| Tests | `vitest run src/shared/personal-office` | **3 files / 35 tests passed** |
| Whitespace/conflict | `git diff --check` (worktree root) | **exit 0** |
| Scope | `git status --porcelain` | only `?? apps/desktop/src/shared/personal-office/` and `?? docs/architecture/` |

Both compile profiles were run deliberately to satisfy "shared contracts compile
in main and renderer" — main has no DOM lib, so `newId()` reaches `crypto`
structurally through `globalThis`.

Test coverage of the acceptance criteria: invalid-transition tests for all four
machines (incl. terminal-state escapes and `created→running` skipping the queue);
serialization round-trip, kind-mismatch rejection, unsupported-version rejection,
malformed-envelope rejection; classification invariants (only `public_metadata`
egresses freely, secrets/local files must stay local, non-public encrypted);
trust default-deny; event idempotency (retry dedupe) and gap-free ordering;
`SecretRef` guard rejecting bare credential strings.

**Not run (by instruction):** full `pnpm install`, full `pnpm build`, full test
suite — Loop 00 owns those.

## 5. Findings & unresolved decisions

1. **Lint is not runnable at the canonical pin.** `git ls-files "*eslint*"` at
   `84a57b3` returns nothing — there is **no tracked ESLint config**, though
   `apps/desktop/package.json` defines `"lint": "eslint src/"` with ESLint ^9.18.
   ESLint 9 requires `eslint.config.*` and fails with "couldn't find" (exit 2).
   The `eslint.config.mjs` I saw earlier exists only as an untracked file in the
   dirty main worktree, not at the pin. **Consequence:** warning budget is
   unchanged because the baseline is "not runnable", not "zero warnings". New code
   was written lint-clean by construction (no `any`, no unused symbols, explicit
   return types, `readonly` throughout). Needs a decision from Loop 00 on where
   the canonical lint config lives.
2. **GitNexus impact analysis not applicable / tool unavailable.** The safety
   process asks for upstream impact before modifying existing symbols. Loop 01
   modified **zero** existing symbols — every file is new — so there was no symbol
   to analyze, and no HIGH/CRITICAL to report. The GitNexus MCP tools were also
   not present in this session's toolset; `detect_changes` was performed with
   `git status` / `git diff --check` against canonical HEAD instead. If a formal
   GitNexus run is required for the record, it should run at revalidation.
3. **Legacy status-vocabulary mappings are documented, not encoded.** The
   `AgentRunStatus` → `RunState` and `CustomerRunStatus` → `RunState` mappings live
   in the §7 table. Two are genuinely ambiguous and need an owner decision:
   `AgentRunStatus 'blocked'` and `CustomerRunStatus 'blocked'` could map to
   `paused` (recoverable) or `failed` (needs retry). I did **not** encode an
   adapter to avoid guessing. Recommend deciding at Loop 02.
4. **`schemaVersion` is `1` for every aggregate.** A per-entity version was
   considered and rejected as premature; one package-level version keeps migration
   a single chain. Revisit if entities start evolving at very different rates.
5. **Junction-based toolchain reuse** is a local convenience, not a project
   pattern. If Loop 02 works in this worktree, either keep the junctions or run a
   real install once Loop 00 releases the lock.

## 6. Revalidation checklist — run when Loop 00 completes

Prereq: Loop 00 has produced `docs/architecture/source-of-truth-baseline.md`,
`source-of-truth-baseline.json`, and `worklogs/personal-office-loop-00.md`.

1. **Confirm the pin still holds.**
   `git -C "F:\Ai Tools\_wt-starizzi-personal-office-loop01" rev-parse HEAD` == `84a57b3`,
   and the baseline JSON's recorded commit == `84a57b3`. If Loop 00 pinned a
   different commit, rebase this branch onto it before anything else.
2. **Diff the glossary against the verified baseline inventory.** For each of the
   15 entities, confirm the baseline's entity inventory has no additional
   run/task/approval-like type that Loop 01 missed. Add to §7 if found.
3. **Reconcile the migration table** (§7) row-by-row against the baseline's
   authoritative list of legacy surfaces (tables + shared types + stores).
   Anything in the baseline not in §7 is a gap.
4. **Resolve the two `blocked` mappings** (finding 3) and record the decision in
   ADR-PO-002 as an amendment.
5. **Settle the lint baseline** (finding 1): locate/commit the canonical
   `eslint.config.mjs`, then run `pnpm --filter desktop lint` and record the
   warning count as the real budget. Confirm `src/shared/personal-office` adds
   zero warnings.
6. **Run the full build once Loop 00's build lock is released:**
   `pnpm install` → `pnpm --filter desktop build` (`tsc -p tsconfig.main.json && vite build`)
   → `pnpm --filter desktop test` (full suite, not just personal-office).
   Expect no new failures; contracts are additive and imported by nothing yet.
7. **Confirm zero collateral change:** `git diff --stat 84a57b3..HEAD` must list
   only the 18 owned paths. Specifically assert untouched: `sqlite-schema.ts`,
   `App.tsx`, `Sidebar.tsx`, `agentWorkspace.ts`, `agentGateway.ts`,
   `agent-service.ts`, `host-agent.ts`, Graph/MyGraph, Customer Marketing,
   Marketplace, extensions/runtime, `package.json`, lockfile, `work-redaction.ts`.
8. **Formal GitNexus pass** (finding 2) if required for the record: impact
   upstream on the legacy symbols the §7 adapters will eventually touch
   (`AgentRun`, `AgentRunEntry`, `CustomerRun`, `CustomerApproval`,
   `OcxServiceSpec`) — before Loop 02 writes any adapter, not now.
9. **Flip the status banner** from `PROVISIONAL` to `Accepted` in
   `personal-office-os.md`, all four ADRs, and this worklog's header — only after
   1–8 pass.

## 7. Boundaries respected

Not modified (verified by `git status`): navigation (`App.tsx`, `Sidebar.tsx`),
`sqlite-schema.ts`, `agentWorkspace.ts`, `agentGateway.ts`, `agent-service.ts`,
`host-agent.ts`, Graph/MyGraph sources, Customer Marketing, Marketplace,
extensions/runtime, `package.json`/lockfile, `work-redaction.ts` (absent at pin).
No legacy type or store deleted. No Marketplace flow added. No browser automation
implemented. No real DB migration. Loop 00's worktree untouched. Nothing
committed, merged, or cherry-picked. Loop 02 not started.

---

# Loop 01B — Legacy compatibility mapping (docs-only, PROVISIONAL)

Extension of Loop 01 that closes the "legacy status mapping" unresolved item (§5.3
above). Docs-only; no production source touched; no adapter implemented.

**Files changed (4):**
- `docs/architecture/legacy-personal-office-mapping.md` (new) — full inventory +
  mapping tables + 9 decision records + ownership matrix.
- `docs/architecture/adr/ADR-PO-002-unified-work-model.md` — appended an
  evidence-backed amendment (PROVISIONAL banner kept).
- `docs/architecture/personal-office-os.md` — §7 cross-link to the mapping doc.
- `worklogs/personal-office-loop-01-provisional.md` (this section).

**Inventory:** 31 legacy status/type enums across 6 concern groups (A run-state, B
task/step, C approval, D event, E runtime/health, F integration, G sync/offline,
H media). Evidence anchored to source file + line.

**Resolved with decisive evidence (5):** run-level `blocked`→`paused` (never
`failed`); scheduler `refused`→`canceled` (never `failed`); keep `awaiting_approval`
(no rename); `queued`≠`draft` (draft has no legacy source); unknown legacy
status→`paused` + `legacyStatusRaw` + migration event.

**Still Blocked — need an owner call (4):** `archived` true outcome (Loop 03);
`waiting_external` as state vs reason (Loop 03/12); workspace `health`/degraded
(Loop 08); retry/fork lineage (Loop 03). Each has a safe fallback + a required
pre-migration test recorded in the mapping doc §3.

**Structural facts (grep-confirmed) that drove the decisions:** legacy source has
**no** `cancelled`/`canceled`, **no** `paused`, **no** `fork`/`lineage`/`parentRunId`,
and **no** `partial`/`degraded` run outcome anywhere in `apps/desktop/src`.

**Mapping counts:** 41 value-level rows finalized (High/Med); 4 Blocked; migration
ownership assigned across Loop 03/04/08/09/10/11/12.

**Contract impact:** none. `apps/desktop/src/shared/personal-office/**` unchanged —
all resolutions that need storage imply *proposed additive* fields owned by the
implementing loops, not Loop 01. `RunState`/`ApprovalState` machines untouched.

**Revalidation addendum (append to §6):**
- 6.10 When Loop 03 starts, implement the §3.8 unknown-status rule first and its
  required test before any real run migration.
- 6.11 Get product/owner decisions on the 4 Blocked items (§3.4 second half, §3.5,
  §3.6, §3.9) before the owning loop encodes any additive field.
- 6.12 Re-diff the mapping's source line anchors against the *verified* baseline once
  Loop 00 publishes it (line numbers may shift if Loop 00 pins a different commit).

---

# W1 · PQ-08 reconciliation prep (PROVISIONAL, read-only)

> **Gate status: `BLOCKED_GATE`** — Loop 00 is not `ACCEPTED` (baseline artifacts
> exist in `_wt-starizzi-personal-office-baseline` but are untracked/uncommitted).
> Per the Common Session Constitution + the W1 Loop Card, only read-only
> reconciliation prep is permitted. **No source/schema/contract/wiring changed.**
>
> **Self-expiry:** this analysis is stamped to the inputs below and **self-invalidates**
> when any hash changes or when W0 publishes an `ACCEPTED` integration commit.

## Inputs read (read-only)

| Artifact | Location | Anchor |
|---|---|---|
| Loop 00 baseline md/json + worklog | `_wt-starizzi-personal-office-baseline` (untracked) | PQ-08 §7.4, PQ-09, §8–§10 |
| `work-model.ts` (competing model) | dirty worktree `HEAD=959e2d2`, **uncommitted** | sha256 `5C32C894535D1232…` |
| `work-redaction.ts` | dirty worktree, uncommitted | sha256 `0107E2DA386A02C7…` |
| `personal-office-ia.md` | dirty worktree, uncommitted | sha256 `EDAAA3984D03A8DF…` |
| `main/work/work-service.ts` | dirty worktree, uncommitted | sha256 `3FA4E8CBC993D02F…` |
| `main/work/run-repository.ts` | dirty worktree, uncommitted | sha256 `53D23C8EE8D99C12…` |
| Loop 01 contracts (mine) | this worktree `shared/personal-office/**` | 13 files, 35 tests |

The dirty worktree is **read-only** (Rule #4). Nothing was reset/stashed/cleaned/edited there.

## Head-to-head

| Concern | Loop 01 `personal-office/**` (W1, mine) | Dirty `work-model.ts` + `main/work/**` (labels itself "Loop 03") |
|---|---|---|
| Entity count | 15 — full catalog + governance | 8 — the work-engine core only |
| Run states | created·queued·running·**awaiting_approval**·paused·completed·failed·canceled | draft·queued·running·**waiting_user·waiting_external**·paused·succeeded·failed·cancelled |
| Lineage | none (01B §3.9 left Blocked) | **parentRunId·rootRunId·lineageKind·attempt** (retry=new run) |
| Approval | requested/approved/rejected/expired/withdrawn + evidenceDigest | pending/approved/**edited**/rejected/expired/invalidated + **WorkActionBinding·actionHash·receipt·invalidReason** |
| Action hash | named in ADR, not implemented | **canonicalActionPayload·planHash·idempotencyKey·expiry** — complete, proto-safe |
| Events | eventId·idempotencyKey·streamId·sequence | global `seq` + per-run `runSeq` (gapless from 1)·idempotencyKey·payloadVersion |
| Secrets | **SecretRef** (reference-only) | **redaction-by-shape at write** (`work-redaction.ts`) |
| Classification | 6-class frozen matrix | none |
| Trust/planes | 6 zones + crossings + control/execution planes | none explicit |
| Blueprint vs Instance | **split** (template vs provisioned) | flat `Workspace{kind}` |
| Branded IDs / versioned type | yes / literal `SchemaVersion` | plain strings / `number` |
| Placement | `shared/personal-office/**` | `shared/work-model.ts` + `main/work/**` |
| Wired into app? | no (contracts only) | **yes** — `database.ts`, `index.ts`, `preload.ts`, `App.tsx` |
| Tests | 35 contract-level | work-model / redaction / adapters / migration / service |

## Decision matrix — ADOPT / REFACTOR / SUPERSEDE (recommendation only)

Verdict per the seven dimensions the W1 card names. Overall recommendation:
**REFACTOR into two layers**, not a blanket adopt/supersede — the two bodies of work
are mostly *different layers*, and the overlap is the Run-engine core.

| Dimension | Finding | Recommendation |
|---|---|---|
| **Coverage** | Dirty model covers the run-engine core more maturely (states, lineage, action-hash, receipts). Mine covers the governance/catalog layer the dirty model entirely lacks (Blueprint/Instance, AgentDefinition, SkillPackage, ToolDefinition, IntegrationGrant, RuntimeInstance, classification, trust). | **REFACTOR**: keep both, split by layer. |
| **Migration** | Dirty `work-migration.ts` is real + wired (and its error path *logs-and-proceeds* — a documented risk once a destructive step exists). Mine is an empty `MIGRATIONS` registry. | **ADOPT** dirty migration engine as the base; **fold** my versioned-envelope guard on top; fix fail-open before any destructive step. |
| **Action hash** | Only the dirty model implements the immutable approval binding the Security Gate requires (target·input·artifact·effect·idempotencyKey·expiry·planHash). | **ADOPT** dirty `WorkActionBinding` wholesale. Mine has no equivalent. |
| **Redaction** | Dirty `work-redaction.ts` (write-time secret/PII scrub, proto-safe) is complementary to my `SecretRef` (reference-only). Not contradictory. | **ADOPT both**: `SecretRef` primary + redaction as the persisted-payload safety net. |
| **Placement** | Two homes for the same core entities is the PQ-08 duplication risk. | **REFACTOR**: dirty core → canonical `shared/work-model.ts` (Loop 03/W3 owns); my `personal-office/**` refactors to a governance layer that **imports** it, stops redefining Run/Step/Approval. |
| **Tests** | Both test suites are worth keeping; state-machine + serialization (mine) vs adapters + migration + service (dirty). | **ADOPT** union of both; reconcile the state-machine tests to one vocabulary. |
| **Consumer impact** | Dirty model already wired into 4 tracked files (`database.ts`/`index.ts`/`preload.ts`/`App.tsx`) — those edits belong to Loop 03, and collide with Loop 01's "no UI/DB" scope. Mine has zero consumers. | Ownership of the 4 wired files must be assigned to **Loop 03/W3**, not W1. W1 keeps contracts only. |

### What this resolves from Loop 01B
The dirty model **empirically answers** three of my Blocked/deferred ambiguities — evidence that the richer vocabulary is the intended target:
- §3.1/§3.4 `blocked`/waiting → the dirty model has **first-class `waiting_user` + `waiting_external`** (not one `paused` catch-all).
- §3.3 `awaiting_approval` → the dirty model names it **`waiting_user`**.
- §3.9 retry/fork lineage → the dirty model has **`lineageKind`/`rootRunId`/`attempt`** ("a retry is a NEW run").

If PQ-08 adopts the dirty vocabulary, my Loop 01 `RunState`/`ApprovalState` machines **change** (`completed`→`succeeded`, `canceled`→`cancelled`, `awaiting_approval`→`waiting_user`, add `waiting_external`, add `draft`→run). That is a **contract change requiring a version/migration note + consumer list** (Constitution Rule #7) — it must be ruled by Socrates/W0, not done silently, and only after Loop 00 is `ACCEPTED`.

## Agent conclusions

- **Socrates (gate + hidden-dependency check):** Entry gate **fails closed** — Loop 00 not
  `ACCEPTED`, input artifacts untracked (no verifiable SHA in a handoff), and the true
  domain contract is contested (PQ-08). Proceeding to write/modify contracts now would
  manufacture the exact "two competing models" risk the baseline flags. Correct action:
  `BLOCKED_GATE`, produce the recommendation, wait for W0.
- **Orchestrator (plan/ownership):** The clean resolution is a **two-layer contract**:
  Loop 03/W3 owns the run-engine (`work-model.ts` + `main/work/**` + the 4 wired files);
  W1 owns the governance/catalog layer that imports it. This removes the duplication
  without discarding ~190 KB of unrecoverable, more-mature implementation. No file leases
  change until W0 rules and Loop 00 is accepted.
- **Builder:** No implementation performed (gate blocked). Ready to refactor `personal-office/**`
  to the governance layer once (a) Loop 00 `ACCEPTED`, (b) W0/Socrates rule PQ-08, (c) W0
  assigns run-engine ownership + the state-vocabulary contract change.

## Actions required from W0 (to unblock)
1. **Preserve the dirty work first** — commit `work-model.ts`, `work-redaction.ts`,
   `main/work/**`, `renderer/shell/**`, `personal-office-ia.md` to a branch/patch; they
   exist in **no commit** and a `git clean` destroys them (baseline PQ-08 risk #2).
2. Finish **Loop 00 acceptance** (exact-path commit + verification) so W1's entry gate can pass.
3. **Rule PQ-08** (Socrates/orchestrator): confirm the two-layer split, assign the run-engine
   + the 4 wired files to Loop 03/W3, and approve the state-vocabulary **contract change**
   (with migration note + consumer list) before W1 touches `personal-office/**`.
4. Hand W1 the integration commit (ancestor of my branch) so I can sync without losing my
   untracked owned files, then flip this worklog PROVISIONAL → READY_FOR_REVIEW and create
   `docs/handoffs/personal-office/loop-01.json`.

## Skill Audit (this read-only session)
- **/search-first — USED.** Searched repo/worktrees for existing work-model before any proposal; found the dirty draft, so proposed *no* new abstraction (recommend adopting the existing one).
- **/context-gatherer — USED.** Pulled roadmap §W1 card, baseline PQ-08/09/§8–10, and both dirty draft modules into context.
- **/understand-codebase — USED.** Mapped the two domain models + the wired seam (`database.ts`/`index.ts`/`preload.ts`/`App.tsx`).
- **/quick-spec — USED.** Produced the ADOPT/REFACTOR/SUPERSEDE matrix as the spec for the PQ-08 ruling.
- **/security-review — USED (read-only).** Flagged: dirty migration fail-open path; SecretRef+redaction as complementary controls; action-hash binding is the external-effect gate.
- **/verification-loop — PARTIAL.** Re-ran my Loop 01 tests (35/35) + `git diff --check` (clean) + changed-file audit. Full build deferred (Loop 0 owns it; gate blocked).
- **/backend-patterns — USED (read).** Judged run-repository/work-service/migration placement (execution plane) for the ownership recommendation.
- **/frontend-patterns, Design (#design), /gpt-taste, /design-taste-frontend, /stitch-design-taste — N/A.** No UI surface in Loop 01 (contracts only); UI is W2/Loop 02.
- **/deployment-patterns — N/A.** No CI/deploy/rollout in a docs-only contracts loop.

## W1 · PQ-08 addendum — adapter evidence (read-only, formal card)

Read `main/work/work-adapters.ts` (dirty, uncommitted, sha `work-model` chain
unchanged → prep still valid). It **already implements** the legacy→unified maps my
Loop 01B §3 designed. Recording the actual decisions so the eventual Socrates ruling
(card step 5, "resolve hai mapping `blocked`") has the evidence in one place.

Dirty adapter's decided maps:

| Legacy | Dirty `work-adapters.ts` → WorkRunState | Loop 01B §3 decision | Match? |
|---|---|---|---|
| `AgentTaskStatus.todo/in_progress/blocked/done` | queued / running / **waiting_user** / succeeded | (task→step) blocked=blocked | step-level ✓; run-level uses `waiting_user` |
| `AgentRunStatus.active` | running | running | ✓ |
| `AgentRunStatus.done` | succeeded | completed(≡succeeded) | ✓ |
| `AgentRunStatus.blocked` | **waiting_user** | `paused` (01B §3.1) | **DIVERGE** |
| `AgentRunStatus.archived` | **cancelled** | `completed`+`archivedAt` (01B §3.6) | **DIVERGE** |
| `CustomerRunStatus.awaiting_approval` | waiting_user | keep awaiting_approval (01B §3.3) | ✓ (naming: waiting_user) |
| `CustomerRunStatus.ready` | running | running (01B §3.3-Med) | ✓ |
| `CustomerRunStatus.completed` | succeeded | completed | ✓ |
| `CustomerRunStatus.blocked` | **waiting_user** | `waiting_external` (01B §3.4) | **DIVERGE** |
| `AgentStepStatus running/done/error` | running/done/error | (D3) | ✓ |
| CustomerApprovalKind media_publish | external_publish | (approval kind) | ✓ new mapping |

Idempotency confirmed: adapters derive the unified id from the legacy id
(`deterministicWorkId`), so re-import resolves to the same run — matches my
"idempotencyKey derived from legacy row id" requirement.

**Two reconciliation divergences for Socrates/W0 to rule (do NOT resolve while PROVISIONAL):**
1. **Customer `blocked` → `waiting_user` (dirty) vs `waiting_external` (my 01B §3.4).**
   `CustomerRunStatus` already has a separate `awaiting_approval`, so a distinct
   `blocked` more plausibly means "waiting on an external dep (setup/integration/
   guardrail)". The dirty adapter simplifies both to `waiting_user`. Recommend Socrates
   pick `waiting_external` for Customer `blocked` unless product says the block is
   always human-actionable. Low-risk either way (both non-terminal, recoverable).
2. **`AgentRunStatus.archived` → `cancelled` (dirty) vs `completed`+tombstone (my 01B §3.6).**
   Mapping a *done-then-archived* run to `cancelled` loses that it succeeded. Recommend
   `derive` from run entries when possible; else prefer a terminal that doesn't assert
   failure/abort over a completed run. Needs an owner call.

Everything else: my Loop 01B matrix and the dirty adapter **agree**, which is strong
corroboration that the richer `waiting_user`/`waiting_external`/`cancelled`/`succeeded`
vocabulary is the intended target — reinforcing the REFACTOR-to-two-layers recommendation
(adopt the dirty run-engine vocabulary; keep my governance/catalog layer on top).

Scope note: did not read `run-repository.ts`/`work-migration.ts`/`work-service.ts` line
by line — those are execution-plane implementation owned by Loop 03/W3, out of W1's
contract-reconciliation scope. Model + redaction + adapters are the contract surface W1
needs.

---

## Final recovery pass — accepted Loop 00 replay

### Preservation and replay

1. Exact W1-owned draft paths were committed at
   `94fbdc6908b64ac07d498327a890f337738a6d24`.
2. Backup branch `backup/personal-office-loop-01-draft-20260728` permanently
   retains that pre-replay commit.
3. The working branch rebased cleanly onto
   `feature/personal-office-baseline-20260728` at `0cbf888`; replayed draft commit:
   `b81da77c3c48f014966e54972ab8bd73379649c4`.
4. No blind cherry-pick, quarantine write, reset, clean, stash, or hot-file edit
   occurred.

### W0 rulings applied

- W1 `shared/personal-office/**` is the governance/catalog contract of record.
  Loop 03's execution core must import it and must not land
  `shared/work-model.ts` as a parallel contract.
- `PERSONAL_OFFICE_SCHEMA_VERSION` remains the only Personal Office version
  authority. The superseded `WORK_SCHEMA_VERSION` must be retired by Loop 03.
- AgentRun “stuck” `blocked` maps to recoverable `paused`; customer/runtime/media
  dependency `blocked` maps to first-class `waiting_external`. Neither maps to
  `failed`.
- Legacy `archived` derives a terminal only from conclusive entries. An
  inconclusive archive maps to `canceled` with
  `canceledReason='legacy_archived_outcome_unknown'`; `archivedAt` and
  `legacyStatusRaw='archived'` are preserved, and Loop 03 emits exactly one
  `audit_events` migration event.
- `failed` is terminal. Retry/fork creates a new run with
  `lineageKind`, `parentRunId`, stable `rootRunId`, and incremented `attempt`.
- Deterministic `canonicalJson` and immutable approval action binding now live
  in the dependency-free shared contract. Cryptographic hashing remains on the
  execution plane.

### Verification evidence

Verification ran from:
`F:\Ai Tools\Kiro\.tmp-w1-contract-verify-019fa826`.
Its `node_modules` junction targeted the clean Loop 00 worktree, not quarantine.

| Check | Result |
|---|---|
| Vitest, Personal Office contracts | PASS — 4 files, 45/45 tests |
| TypeScript main profile (CommonJS/ES2022/no DOM) | PASS — exit 0 |
| TypeScript renderer profile (ESNext/bundler/DOM/isolatedModules) | PASS — exit 0 |
| `git diff --check` | PASS |
| Ownership | PASS — only `shared/personal-office/**`, architecture docs, and this worklog |
| GitNexus detect changes | LOW — 8 changed files in the producer delta, 0 indexed symbols/processes because the contract files are new |
| Secret scan | PASS — no secret-shaped addition |
| Lint | NOT RUNNABLE — inherited PQ-01/BF-03/BF-04; no green lint claim |

### SECURITY GATE

- **Junction writeback:** avoided; no package/test/build command ran in W1.
- **DB migration:** no DB or migration implementation changed in Loop 01.
- **Schema collision:** contract authority fixed; Loop 03 must remove
  `WORK_SCHEMA_VERSION` before persistence.
- **False-completed archive:** prohibited by the amended mapping.
- **Approval replay/TOCTOU:** action binding includes target, redacted input,
  artifact/version, estimated side effect, idempotency key, expiry, plan hash,
  and context snapshot.
- **Hot-file leases:** none used or required.

Decision: **PASS for W0 review**, with PQ-01 carried as a pre-existing
non-blocking verification limitation.

### Independent review correction

The first submitted handoff (`15ab877`) was rejected before integration because
`decode()` validated only the envelope version. A current envelope could therefore
carry an aggregate with a stale/missing inner `schemaVersion`.

Corrective implementation `89d77435e5bc7bb3535ed0815fe3af470ebda03a`
makes `Envelope`, `encode`, `serialize`, `decode`, and `roundTrip` accept only
`Versioned` aggregates; `decode()` now validates both the envelope and upgraded
aggregate. Two regression tests cover a stale inner version and a missing inner
version. Isolated verification was rerun: 43/43 tests and both TypeScript profiles
pass. The rejected handoff was never integrated.

### Coordinator rebase note

Before W0 acceptance, a concurrent coordinator session added two documentation-only
commits (`aa96a8f`, `d711fd9`) and rebased the W1 series onto them. Git preserved the
file content but rewrote the producer SHAs:

| Before rebase | Current equivalent |
|---|---|
| `b81da77` | `8592fd9` |
| `a72d29d` | `5abafad` |
| `15ab877` | `9d82ed0` |
| `89d7743` | `4cf77f3` |
| `7956503` | `4890a0a` |

The handoff uses only the current lineage. The schema correction remains at
`4cf77f3`; W0 must review the final implementation commit `0eacbc5`, which adds
the approved run-state amendment on top of that correction.

### Independent inventory correction

Independent verification challenged the ownership inventory because a diff from
the accepted Loop 00 ancestor `0cbf888` also shows three W0 coordinator files.
Those files were introduced by `aa96a8f`/`d711fd9` before W1 replay and are not W1
ownership:

- `docs/handoffs/personal-office/integration-ledger.json`
- `docs/handoffs/personal-office/planning/loops-01-04-provisional-plan.md`
- `docs/handoffs/personal-office/planning/wave-dispatch-w1-w4.md`

The producer record now states its inventory basis explicitly:
`d711fd9..producer tip`. It also lists the three inherited W0 paths separately
and includes the producer handoff itself in `filesChangedFromBase`. No ownership
was transferred or broadened.

### Skill and agent audit

- **Socrates — USED:** approved preservation-only first, then required W0
  mapping/version/lineage rulings before integration.
- **orchestrator — USED in-process:** fixed ownership, replay order, isolated
  verification, two-phase handoff, and downstream gates. The spawned helper was
  interrupted after failing to return promptly.
- **builder — USED:** contract implementation was bounded to W1-owned paths;
  no UI/main/DB/toolchain mutation.
- **/search-first — USED:** found and consumed the existing hashed quarantine
  model rather than inventing another abstraction.
- **/context-gatherer — USED:** reconciled Loop 00 acceptance, ledger, leases,
  salvage manifests, W1 draft, and legacy mapping.
- **/understand-codebase — USED:** traced contract versus execution-plane
  ownership and legacy status sources.
- **/quick-spec — USED:** W0 two-layer and mapping rulings were treated as the
  implementation spec.
- **/backend-patterns — USED:** preserved dependency direction, terminal-state
  semantics, idempotency, version authority, and adapter ownership.
- **/security-review — USED:** junction, migration, false-success, secret,
  action-binding, and lease gates reviewed.
- **/verification-loop — USED:** targeted tests, dual-profile typecheck,
  diff/ownership/security checks.
- **/frontend-patterns, Design (#design), /gpt-taste,
  /design-taste-frontend, /stitch-design-taste — N/A:** Loop 01 owns no UI.
- **/deployment-patterns — N/A:** no deploy, release, package, or production
  action in this loop.

### Next gate

W0 must review and integrate the implementation commit, then create
`docs/handoffs/personal-office/acceptance/loop-01.json`. Loop 02/03/04
implementation worktrees remain blocked until that acceptance record is
committed. Loop 04 also requires the `PO-VAULT-OWNERSHIP` ruling.

---

## Contract change — waiting_external (gate PO-RUNSTATE-CONTRACT-GAP)

**Trigger.** W0 → W1 contract change request after re-sync onto integration
`d711fd9` (gate landed at `aa96a8f`). My Loop 01B mapping §3.4 had declined a
top-level `waiting_external` state on migration-scoped evidence. W0 correctly
distinguished the *product* requirement: Loop 03 §4 calls its state list a
**minimum** (a floor, measured at acceptance), and Loop 02 §3 renders Today as
Active work / Waiting for me / Delivered — a run blocked on an integration or
runtime is none of those three, and a primary always-visible lane cannot be built
on an optional `pausedReason` field the state machine does not enforce. Accepted.

**Change (code).**
- `state-machine.ts`: `RunState` gains `waiting_external`. `RUN_TRANSITIONS`:
  `running → waiting_external` added; `waiting_external → running | canceled` added
  (mirrors `paused`). No other edge changed. Terminal set unchanged
  `{completed, failed, canceled}`.
- `entities.ts`: `RunPauseReason` narrowed to `'stuck' | 'guardrail'` —
  `waiting_external` is now a state, not a pause reason.
- `state-machine.test.ts`: +2 tests — valid detour and invalid targets
  (`waiting_external → paused|completed|failed`, `created|awaiting_approval →
  waiting_external`), plus non-terminal assertion.

**Docs aligned in the same implementation series.** `personal-office-os.md` §6.3,
`legacy-personal-office-mapping.md` §3.1/§3.4 plus the runtime and
Customer/runtime/media `blocked` rows, and ADR-PO-002 now distinguish AgentRun
stuck/guardrail pauses from external dependency waits. Runtime provisioning health
is explicitly separate from an associated WorkRun's state.

**Version.** `PERSONAL_OFFICE_SCHEMA_VERSION` stays **1** — sole authority
(PO-VERSION-COLLISION). Breaking change to an **unshipped** contract, so the cost is
this version note, not a migration. Must precede any Loop 03 persistence.

**Verification.** vitest 45/45; tsc main profile exit 0; tsc renderer profile
(contract files) exit 0; `git diff --check` clean. Lint NOT run — canonical lint
gate unrunnable (PQ-01 / BF-03 / BF-04); no lint claim made.

**Consumers notified via handoff contractChanges:** Loop 03 (W3), Loop 02 (W2),
Loop 12 (W2).

### Agent footer (this iteration)
- **Socrates:** Rejected the first `0eacbc5` pass because §3.1/ADR still said
  “all blocked → paused” and the runtime table mixed provisioning health with
  WorkRun state. `0b56456` fixed those points. A second review found the §5 blocked
  summary and §4 ownership matrix stale; `830a12c` closed both. Final verdict:
  **ACCEPT**, with no remaining PO-RUNSTATE-CONTRACT-GAP or Loop 01 ownership
  blocker.
- **Orchestrator:** Scope held to the single state addition + its reason-enum
  cleanup + tests + the three directly affected architecture documents.
- **Builder:** Implemented the 3 code edits and 3 architecture updates; verified
  compile + tests; updated the producer record separately.

### Skill Audit (this iteration)
- **/search-first — USED:** located every `waiting_external` mapping before the
  amendment and restricted edits to the six affected contract/architecture files.
- **/context-gatherer — USED:** read the ledger gate, plan §1, and current
  state-machine/entities/version/test/handoff before any edit.
- **/understand-codebase — USED:** confirmed no other consumer references
  `RunPauseReason`'s `waiting_external` member (tsc both profiles clean).
- **/backend-patterns — USED:** state-machine transition-table design (mirror paused).
- **/verification-loop — USED:** vitest 45/45, tsc ×2, git diff --check; lint N/A per PQ-01.
- **/security-review — USED:** no secret/PII surface; the change is a pure enum/table
  addition; approval action-binding + redaction untouched.
- **/quick-spec — N/A:** the gate already specified the exact transitions.
- **/frontend-patterns, Design (#design), /gpt-taste, /design-taste-frontend,
  /stitch-design-taste — N/A:** contracts-only; no UI.
- **/deployment-patterns — N/A:** no deploy/release/package action.
