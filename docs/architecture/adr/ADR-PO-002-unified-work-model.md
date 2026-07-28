# ADR-PO-002 — Unified work model (Run / Step / Artifact / Approval / Event)

- **Status:** Ready for review — replayed on accepted Loop 00 integration ref `0cbf888`.
- **Date:** 2026-07-28
- **Loop:** Personal Office OS — Loop 01
- **Deciders:** Loop 01 (domain model)
- **Related:** ADR-PO-001, ADR-PO-003; `apps/desktop/src/shared/personal-office/{entities,events,state-machine,serialization}.ts`

## Context

"Work" is modeled three+ different ways today: `AgentRun`/`AgentRunEntry`
(`main/agent/types.ts` + `agent_runs`), `CustomerRun`/`CustomerRunStep`/
`CustomerApproval` (`shared/customer-marketing-types.ts`), and
`scheduled_session_runs`. They diverge in status vocabularies and ownership, and
the chat transcript is often treated as the de-facto record. This blocks a single
"office" experience and makes auditing inconsistent.

## Decision

Define one unified work model:

- **WorkRun** — one execution toward a goal, inside a `WorkspaceInstance`.
- **WorkStep** — one unit inside a run. **Step and Task are unified** into a
  single concept (`WorkStepStatus = todo | in_progress | blocked | done`, which
  matches legacy `agent_tasks` exactly).
- **Artifact** — a durable output; bytes stay local, addressed by `sha256`.
- **Approval** — a human decision gate bound to an immutable action hash.
- **WorkEvent** — the append-only, ordered fact stream that **is** the Run's
  source of truth.

Hard rules encoded in the contracts:

1. **Chat is not the source of truth.** A `WorkRun` is rebuilt from its
   `WorkEvent` stream; `originChatSessionId` is a reference only.
2. **Provider owns no state.** Providers/extensions are `EventActor`s, never
   authoritative stores (`trust.ts` gives them no authority).
3. **Events carry idempotency + ordering.** Every `WorkEvent` has a unique
   `eventId`, a dedupe `idempotencyKey`, a `streamId`, and a monotonic
   `sequence`. `appendEvent()` enforces exactly-once + gap-free ordering.
4. **Everything is versioned.** Each aggregate carries `schemaVersion`;
   `serialization.ts` encodes/decodes via an ordered `MIGRATIONS` registry.
5. **Terminal runs never reopen.** `completed`, `failed`, and `canceled` have no
   outgoing transition. Retry/fork creates a new `WorkRun` with explicit lineage.
6. **Approval binds the exact side effect.** The canonical binding covers target,
   redacted input, artifact/version, estimated effect, idempotency key, expiry,
   plan hash, and context snapshot. Any change invalidates the approval hash.

State machines (`state-machine.ts`) pin the Run and Approval lifecycles with
explicit transition tables and invalid-transition enforcement.

## Consequences

**Positive**

- One vocabulary across agent runs, marketing runs, and scheduled runs.
- Deterministic replay + audit from the event log, independent of chat.
- Retry/fork lineage, pause/resume, and approval are first-class and testable.

**Negative / trade-offs**

- Legacy surfaces need adapters (see the migration table in
  `personal-office-os.md` §7). This is deliberate: adapter path, not big-bang.
- Event-sourced runs cost more storage than a single mutable row; acceptable for
  auditability.

## Alternatives considered

- **Mutable Run row (status column only):** simplest, but loses ordering/replay
  and re-invites "chat as truth". Rejected.
- **Keep three separate models, add a view layer:** lower upfront cost but
  perpetuates divergence and double-maintenance. Rejected.

## Compliance / security notes

Event payloads are `audit_events` (metadata-only egress). Approvals carry an
execution-plane SHA-256 over `canonicalActionPayload(binding)`; the shared layer
defines deterministic bytes but cannot mint the hash. No secret values appear in
events or entities (ADR-PO-004).

## Amendment — Loop 01B (legacy status mapping, evidence-backed)

Loop 01B inventoried every legacy status enum and resolved the run-state
ambiguities left open in Loop 01. Full analysis + per-value tables:
`docs/architecture/legacy-personal-office-mapping.md`. Only **evidence-decisive**
decisions are folded into the model here; genuinely open items stay deferred (they
are recorded as Blocked in that doc's §3 and are **not** asserted as final).

Decided (with source evidence):

- **Run-level `blocked` → `paused`, never `failed`.** `host-agent.ts:67` defines
  `blocked` as "stuck", and the action-gate uses it for recoverable guardrail
  refusals (`customer-marketing-service.ts:769`). It is always re-enterable.
- **Scheduler `refused` → `canceled`, not `failed`.** The scheduler separates
  `refused` (OS declined to start; no work ran) from `failed` (a step failed —
  `schedule-service.ts:223`).
- **Keep `awaiting_approval` (no rename to `waiting_user`).** `CustomerRunStatus`
  already uses the literal and pairs it with a `CustomerApproval`; PO matches 1:1.
- **`queued` ≠ `draft`.** Legacy `queued` → run `queued`; PO `draft` is a
  workspace-level state with no legacy source, so migration never emits a draft run.
- **Unknown legacy status → `paused` + preserve `legacyStatusRaw` + emit a
  `migration.unknown_status` `WorkEvent`.** `agent_runs.status` /
  `scheduled_session_runs.status` are unconstrained TEXT, so decode must fail safe,
  never guess a terminal state.

W0 resolved the remaining run-contract questions:

- Legacy `archived` derives a terminal from entries when conclusive; otherwise it
  becomes `canceled` with `legacy_archived_outcome_unknown`. The adapter always
  preserves `archivedAt`/`legacyStatusRaw` and emits exactly one audit migration event.
- Integration/runtime dependency waits use first-class `waiting_external`;
  `pausedReason` is reserved for `stuck|guardrail`.
- Future retry/fork lineage is explicit. Legacy rows remain roots; no heuristic
  lineage is fabricated.
- `failed` is terminal. Retry creates a new run rather than reopening a failed row.

Contract impact is additive at schema v1: `pausedReason`, `canceledReason`,
`archivedAt`, `legacyStatusRaw`, lineage fields, deterministic canonical payloads,
and immutable approval bindings. `PERSONAL_OFFICE_SCHEMA_VERSION` remains the only
version authority; the superseded draft's `WORK_SCHEMA_VERSION` must not land.
