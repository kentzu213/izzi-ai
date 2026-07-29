# Loops 01–04 — provisional cross-loop research and plan

> **Status: PROVISIONAL.** Produced by W0 under the Constitution's PROVISIONAL RULE, which permits
> research, architecture maps, quick specs, test plans, interface proposals, UX maps and threat
> models while upstream is unaccepted — and forbids touching source, schema, hot files, adapters,
> navigation, preload or integration wiring. **No implementation was performed.**
>
> **Upstream binding.** Valid only while:
> - integration ref `feature/personal-office-baseline-20260728` has Loop 00 = ACCEPTED
> - canonical `84a57b38117ee7544691115be5aca7a141af1abf` (`v1.14.0-beta.3`)
> - W1 Loop 01 draft at the hashes in `../integration-ledger.json → loops[01].inputHashesForW1`
> - quarantine drafts at the hashes in `../quarantine/loop-0{2,3}-dirty-salvage.json`
>
> This document **self-invalidates** when any of those change. It is not a substitute for each
> producer's own loop; it is the map they start from.
>
> **Why W0 wrote it.** The operator asked for Loops 01–04. W0 cannot implement them: lanes are
> fixed (01→W1, 02→W2, 03→W3, 04→W4), Loop 00 ownership forbids feature source, and no Loop 02/03
> worktree may exist before Loop 01 is ACCEPTED. Research is the part W0 *can* do, and it turned up
> one blocker that would have stopped Loop 03 dead.

---

## 1. The blocker: Loop 03's mandated run states contradict Loop 01's frozen contract

This is the highest-value finding in this document. **Loop 03 cannot satisfy its own acceptance
criteria while importing W1's contract as it currently stands.**

Roadmap Loop 03 §4 specifies a **minimum** (`tối thiểu`) run state machine. W1's Loop 01
`state-machine.ts` froze a different one:

| Roadmap Loop 03 requires | W1 `RunState` has | Verdict |
| --- | --- | --- |
| `draft` | `created` | naming only |
| `queued` | `queued` | match |
| `running` | `running` | match |
| `waiting_user` | `awaiting_approval` | naming only |
| **`waiting_external`** | **— absent —** | **REAL GAP** |
| `paused` | `paused` | match |
| `succeeded` | `completed` | naming only |
| `failed` | `failed` | match |
| `cancelled` | `canceled` | spelling only (en-GB vs en-US) |

### 1.1 Four of the five differences are naming, and W1 should win those

The roadmap describes **semantics**; W1 chose **identifiers** with reasons on record. Keep W1's:

- `awaiting_approval` over `waiting_user` — W1's mapping §3.3 rejected this exact rename as "a
  churny, evidence-free contract change", noting `CustomerRunStatus` already uses the literal
  `awaiting_approval` paired with a `CustomerApproval` object. That reasoning holds.
- `completed` / `canceled` — US spelling is consistent with the existing codebase.
- `created` over `draft` — W1's §3.7 establishes `draft` as a **workspace** state with no legacy run
  source, and that migration never emits a draft run. Two entities using `draft` for different
  lifecycles would be worse.

### 1.2 `waiting_external` is a genuine missing capability, and W1 should change

W1's mapping §3.4 declined it explicitly: *"PO has no top-level `waiting_external` state, and
Loop 01 froze `RunState` without one. Do not add a new top-level state on evidence this thin."* It
proposed an optional additive `pausedReason: 'stuck' | 'waiting_external' | 'guardrail'` instead.

That reasoning was sound **for the question W1 asked** — which legacy values force a new state. It
answered a migration question. But the requirement is not a migration one, and W1 missed two
pieces of evidence:

1. **The roadmap calls it a minimum.** `tối thiểu` is a floor, not a menu. Loop 03's acceptance is
   measured against it.
2. **Loop 02 needs it to build a primary surface.** Loop 02 §3 requires the Today page to show
   *Active work*, *Waiting for me*, and *Delivered* as distinct lanes. "Waiting for me" is
   `awaiting_approval`. But a run blocked on an integration or runtime is **none of those three** —
   it is not active, not waiting on the user, not delivered. Under W1's model it would be `paused`
   with an *optional* discriminator. Building a primary, always-visible product lane on an optional
   field is fragile: any writer that omits it silently drops the run into the wrong bucket, and the
   state machine cannot enforce a legal transition on a field it does not model.

**Recommendation — contract change request W0 → W1:** add `waiting_external` as a first-class
`RunState`, with transitions `running → waiting_external` and `waiting_external → running | canceled`
(mirroring `paused`). Keep `pausedReason` as an additive detail for the *remaining* causes
(`stuck`, `guardrail`), which are genuinely reason-shaped rather than state-shaped.

This is a **breaking contract change** to an unshipped contract, so its cost is a version note and
W1 re-running its own tests — not a migration. Deferring it means Loop 03 either violates its
acceptance criteria or forks the state machine, which is the exact failure PQ-08 was raised to
prevent.

### 1.3 Consequence for the ledger

`PO-VERSION-COLLISION` must be resolved *together with* this change, not before it. If
`waiting_external` lands after `PERSONAL_OFFICE_SCHEMA_VERSION` has been used to tag persisted
rows, the version stops being a reliable discriminator. Sequence: land the state change → confirm
the version constant → only then let Loop 03 persist anything.

---

## 2. Two open gates that this research closes

**`PO-VAULT-OWNERSHIP` → resolved as Loop 04 / W4.** I had held `vault-ops.ts`, `vault-types.ts`
and `wikilink.ts` pending a ruling because the shell salvage found them adjacent to Loop 02's work.
Loop 04's PHẢI ĐỌC list settles it — it names `shared/vault-types.ts`, `shared/vault-ops.ts`,
`shared/wikilink.ts` and `renderer/components/vault/*` directly. They are **Loop 04 inputs, not
Loop 02 salvage.** `quarantine/loop-02-dirty-salvage.json` should be amended from
`HOLD_PENDING_OWNERSHIP` to Loop 04 ownership when W0 next writes the registries.

**Loop 04's dependency is understated.** The ledger records Loop 04 as `dependsOn: ["01"]`. Its
PHẢI ĐỌC list includes *"unified work model Loop 03"*, so the true edge is `01 → 03 → 04`. This
matters for scheduling: Loop 04 is **not** a free parallel sibling of Loop 02/03.

---

## 3. Boundary risks between adjacent loops

Three places where two loops could both reasonably claim the same concept. Each needs a line drawn
before implementation, not after.

**Context snapshot — Loop 03 vs Loop 04 vs Loop 05.** Loop 03 §1 creates `context_snapshots`
(or an equivalent reference); Loop 04 builds the Live Profile content model; Loop 05 owns
injection. Proposed line: **Loop 03 owns the snapshot envelope** (identity, versioning, run
ownership, immutability) and stores content opaquely. **Loop 04 owns the content model** (sections,
facts, provenance, scope, expiry). **Loop 05 owns compilation and injection** — Loop 04 states this
itself: *"Không inject Live.md trực tiếp vào model call; việc đó thuộc Loop 05."* Loop 03 must not
parse snapshot content; Loop 04 must not invent its own storage.

**Approval — Loop 03 engine vs Loop 02 surface.** Loop 03 §5 owns the approval engine and the
immutable action hash. Loop 02 renders it. The quarantine shell defined a local `ApprovalRequest`
because no contract existed; that must be dropped in favour of W1's `Approval` plus Loop 03's
`work-approvals.ts`. The action-hash requirement in Loop 03 §5 matches the draft's `work-hash.ts`
field-for-field (target account/resource, redacted input, artifact version, estimated side effect,
idempotency key, expiry) — the salvage is well aligned here.

**Graph surfaces — Loop 04 vs Loop 02's `MyGraphRoute.tsx`.** The shell salvage includes a MyGraph
route wrapper. Graph pages and store are Loop 04 ownership under §8.1. Line: Loop 02 owns the
**route shell**, Loop 04 owns everything **inside** it. Loop 02 must not restyle the graph.

---

## 4. Confirmed sequencing

```
Loop 01 (W1) ── ACCEPTED ──┬── Loop 02 (W2)  shell, mocks against contracts
                           └── Loop 03 (W3) ── Loop 04 (W4)  Live.md needs the work model
```

Loop 02 is genuinely parallel to Loop 03 because Loop 02 is *forbidden* from building a run engine
(§KHÔNG LÀM: *"dùng adapter/mock typed theo contract Loop 01"*). It types against contracts and
mocks the engine, so it does not wait on Loop 03.

**Worktree policy holds:** no Loop 02/03/04 worktree may be created until Loop 01 is ACCEPTED.
None was created for this document.

---

## 5. Per-loop entry conditions

### Loop 01 — W1 · contracts (nearest to done)
1. Apply the **MAP-ARCHIVED** amendment to `legacy-personal-office-mapping.md` §3.6 — inconclusive
   archived runs map to `canceled` + `canceledReason`, never defaulted to `completed`.
2. Apply the **`waiting_external`** state change from §1.2 above, or record a reasoned rejection
   that addresses the Loop 02 "Waiting for me" lane argument specifically.
3. Absorb the promoted `WorkRunLineageKind` / `WorkRunOrigin` / `canonicalJson` / action-hash
   content from the superseded draft, under a contract change request. Loop 03's mandatory test list
   includes *retry/fork lineage*, so this is not optional.
4. Confirm `PERSONAL_OFFICE_SCHEMA_VERSION` is the sole version authority.
5. Commit owned paths (still uncommitted) and submit `loop-01.json` per the §10 schema.

### Loop 02 — W2 · shell
Entry: Loop 01 ACCEPTED. Salvage is substantial — 19 files, ~106 KB, already covering the five
routes, command palette, delegate composer, work lane and a feature flag with rollback.
1. Retarget `workAdapter.ts`, `types.ts`, `useWorkSnapshot.ts` off `main/agent/types.ts` onto
   `shared/personal-office/`.
2. Drop the shell-local `ApprovalRequest`.
3. Request the W0 lease for `App.tsx` and `Sidebar.tsx`. Do not touch anything else hot.
4. Full UI verification set: 1440×900, 1024×768, 390×844; keyboard/focus; text zoom 200%; reduced
   motion; touch targets ≥44×44; empty/loading/error/offline/degraded on every primary surface.
   `CommandPalette.tsx` needs specific focus-trap attention.
5. Rewrite §0 of `personal-office-ia.md`, which currently documents the pre-baseline assumption that
   no contracts existed.

### Loop 03 — W3 · work engine
Entry: Loop 01 ACCEPTED **including** §1.2, or Loop 03 will fail its own state-machine criterion.
1. Retire `WORK_SCHEMA_VERSION`; import `PERSONAL_OFFICE_SCHEMA_VERSION`. Add a serialization test
   proving the engine envelope passes W1's guard and an unknown version is *rejected*, not coerced.
2. Adopt `main/work/**` (13 modules, 5 test files) with imports retargeted to W1's contracts.
3. Implement both mapping rulings in `work-adapters.ts` with the tests W1 specified.
4. Request leases for `database.ts`, `index.ts`, `preload.ts`. **Do not take `App.tsx`** — Loop 02
   is its first owner, even though the draft modified it.
5. Fix the fail-open migration path before it ships: it currently logs and proceeds, justified only
   while v1 is purely additive.
6. Keep `work-sqlite.ts` unit-testable without a live native binding (BF-01 — no MSVC on this host).
7. Migration must be idempotent (run-twice test is mandatory) and carry a backup/recovery note;
   `work-backup.ts` already takes a pre-change snapshot.

### Loop 04 — W4 · Live.md and context graph
Entry: Loop 01 **and** Loop 03 accepted (§2). Inputs now include the vault/wikilink files.
1. Respect the precedence order as a testable rule, not prose:
   `safety/system > current user request > workspace policy > global Live.md > learned preference > model default`.
2. The no-secret validator is a hard gate, not a warning: Live.md must never hold an API key, OAuth
   token or password — only an opaque reference plus connection status. Export must be secret-free.
3. AI produces **Preference Proposals only**; nothing durable is written without accept/edit/reject.
   Persistent learning from email/browser/chat/file is opt-in per source type.
4. Markdown round-trip must be lossless while sections are also projected as graph facts with
   provenance.
5. Do not inject into model calls — that is Loop 05.

---

## 6. Cross-cutting test obligations

Consolidated so no loop assumes another covered it:

| Obligation | Owner | Note |
| --- | --- | --- |
| invalid-transition tests | 01 | plus `waiting_external` once added |
| serialization / version guard | 01 + 03 | unknown version rejected, not coerced |
| migration idempotency (twice, no error) | 03 | mandatory |
| event idempotency + concurrent ordering | 03 | `offline_queue`'s `seq` + `base_updated_at` is the precedent to reuse |
| pause / restart / resume | 03 | must survive process restart |
| approval approve / edit / reject / expiry | 03 | plus invalidation when plan or artifact changes |
| retry / fork lineage | 03 | blocked until lineage lands in the contract |
| secret redaction | 03 + 04 | `work-redaction.ts` is the runtime; W1 owns the taxonomy |
| legacy adapter round-trip | 03 | legacy UI must still read through the adapter |
| accessibility + responsive set | 02 | full list in §5 |
| Markdown round-trip, revision conflict, scope precedence, expiry | 04 | |
| existing wiki/daily notes unbroken | 04 | explicit non-regression |

**No external side effects in tests** (Loop 03) and **no fabricated data presented as real work**
(Loop 02 §9 — demo state must be labelled demo).

---

## 7. What W0 needs from the operator

Implementation of Loops 01–04 needs a decision only the operator can make, because it amends their
own Constitution:

- **Option A — keep the 5-window design.** W0 stays Control Tower. W1 applies §5's Loop 01 items,
  W0 accepts, then W2/W3/W4 run their loops. This document is their input. Highest fidelity to the
  design, and the gates keep catching real defects — §1 above is the third substantive defect the
  gate has caught.
- **Option B — authorise one agent to act as W1→W4 sequentially.** Legitimate if the operator
  grants it explicitly, and it preserves §1.2's *intent* (one writable loop at a time — a single
  agent working sequentially cannot conflict with itself). W0 would still create each worktree and
  run each gate. Slower per loop than it sounds: Loop 02 alone carries the full accessibility and
  responsive verification set.
- **Option C — collapse the loops.** Not recommended. Loops 02/03/04 touch overlapping hot files
  (`App.tsx`, `preload.ts`, `database.ts`, graph store). The lease registry exists because the
  quarantine draft already wired four hot files without coordination, which is what produced PQ-08.

W0's recommendation is **A**, with **B** as an acceptable operator override. Under either, the Loop
01 items in §5 come first, and they are small — an amendment, a state addition, absorbing promoted
content, and a commit.
