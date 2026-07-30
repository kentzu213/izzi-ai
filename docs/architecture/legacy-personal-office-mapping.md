# Legacy → Personal Office OS — Compatibility Mapping (Loop 01B)

> **Status: READY FOR REVIEW** — replayed on accepted Loop 00 integration ref
> `0cbf888`; W0 PQ-08 and MAP-ARCHIVED rulings applied.
> **Type:** research/design extension of Loop 01. **No adapter is implemented here**
> and **no production source is modified.** This document resolves the unresolved
> compatibility decisions from `worklogs/personal-office-loop-01-provisional.md` §5.

All legacy values below were read from the canonical worktree at `84a57b3`. Line
numbers are evidence anchors, not links. PO entities/states refer to
`apps/desktop/src/shared/personal-office/` (see `personal-office-os.md`).

Confidence legend: **High** = 1:1 or evidence-decisive · **Med** = defensible with a
documented assumption · **Blocked** = cannot finalize without an owner decision
(recorded in §3).

Migration behavior legend: **map** = deterministic value swap · **map+field** =
swap plus a *proposed additive* PO field (owned by the implementing loop; NOT added
in Loop 01) · **derive** = requires reading related rows (entries/steps) · **drop**
= not a domain-state source, ignored by the Run/entity adapter.

---

## 1. Legacy status/type inventory

31 distinct legacy status/type enums were found across the canonical source. Grouped
by the concern each one actually expresses.

### Group A — Run-lifecycle sources → `WorkRun.state`

| # | Legacy type | Values | Source |
|---|---|---|---|
| A1 | `AgentRunStatus` | `active` `done` `blocked` `archived` | `main/agent/types.ts` |
| A2 | `CustomerRunStatus` | `queued` `in_progress` `awaiting_approval` `ready` `completed` `blocked` | `shared/customer-marketing-types.ts:42` |
| A3 | `RunStatus` (scheduler) | `running` `success` `failed` `refused` | `main/scheduler/playbook-types.ts:98` |
| A4 | `scheduled_session_runs.status` | free TEXT holding A3 values | `main/db/sqlite-schema.ts:168` |
| A5 | `agent_runs.status` | free TEXT, default `active`, holds A1 values | `main/db/sqlite-schema.ts:134` |

### Group B — Task/Step sources → `WorkStep.status`

| # | Legacy type | Values | Source |
|---|---|---|---|
| B1 | `AgentTaskStatus` | `todo` `in_progress` `blocked` `done` | `main/agent/types.ts` |
| B2 | host-agent task tool schema | `pending` `in_progress` `completed` `blocked` | `main/agent/host-agent.ts:56,78` |
| B3 | `CustomerRunStep.status` | `todo` `in_progress` `done` `blocked` | `shared/customer-marketing-types.ts:191` |

### Group C — Approval sources → `Approval.state`

| # | Legacy type | Values | Source |
|---|---|---|---|
| C1 | `CustomerApprovalStatus` | `pending` `approved` `rejected` | `shared/customer-marketing-types.ts:44` |
| C2 | `CustomerMarketingWorkflowReviewStatus` | `pending` `approved` `rejected` | `shared/customer-marketing-types.ts:611` |
| C3 | `CustomerMarketingWorkflowDecision` | `approved` `rejected` | `shared/customer-marketing-types.ts:610` |
| C4 | `CustomerApprovalKind` | `strategy` `media_preview` `media_render` `media_publish` | `shared/customer-marketing-types.ts:46` |

### Group D — Event / work-stream sources → `WorkEvent` (+ `WorkStep`)

| # | Legacy type | Values | Source |
|---|---|---|---|
| D1 | `AgentTurnEvent.kind` | `delta` `reasoning` `step` `done` | `shared/agent-turn-events.ts` |
| D2 | `AgentStep.kind` | `tool` `progress` | `shared/agent-turn-events.ts` |
| D3 | `AgentStepStatus` | `running` `done` `error` | `shared/agent-turn-events.ts:17` |
| D4 | `AgentRunEntryKind` | `artifact` `note` `handoff` `event` | `main/agent/types.ts` |
| D5 | `ChatMessageState` | `queued` `streaming` `done` `error` | `main/agent/types.ts` |

### Group E — Runtime / provisioning / health → `RuntimeInstance` + `ProvisioningState`

| # | Legacy type | Values | Source |
|---|---|---|---|
| E1 | `ExtensionHostState` | `idle` `starting` `running` `stopping` `stopped` `crashed` `disabled` | `main/extensions/extension-host.ts:39` |
| E2 | extension loader `state` | `installed` `running` `stopped` `crashed` `disabled` | `main/extensions/extension-loader.ts:29` |
| E3 | `AgentRuntimeStatus` | `idle` `connecting` `running` `error` | `main/agent/types.ts` |
| E4 | `CustomerMediaRuntimeState` | `ready` `blocked` `needs_setup` | `shared/customer-marketing-types.ts:57` |
| E5 | `MarketingHealth` | `ready` `attention` `blocked` `unknown` | `shared/marketing-types.ts:1` |
| E6 | `SessionIssueKind` | `logged_out` `two_factor_required` `billing_blocked` `authorization_refused` `unknown` | `main/scheduler/playbook-types.ts` |

### Group F — Integration / credential sources → `IntegrationGrant`

| # | Legacy type | Values | Source |
|---|---|---|---|
| F1 | `IntegrationConnectionStatus` | `connected` `disconnected` `pending` `error` | `main/agent/types.ts` |
| F2 | `CustomerMarketingCredentialConnectionState` | `connected` `disconnected` `locked` `invalid` | `shared/customer-marketing-credential-types.ts:18` |
| F3 | `CustomerMarketingCredentialVaultState` | `ready` `locked` | `shared/customer-marketing-credential-types.ts:24` |
| F4 | `CustomerWorkspaceMemberStatus` | `active` `suspended` | `shared/customer-marketing-types.ts:114` |

### Group G — Sync / bridge / offline → NOT domain state (drop from Run/entity adapter)

| # | Legacy type | Values | Source |
|---|---|---|---|
| G1 | `CustomerWorkspaceSyncStatus` | `local` `synced` `unavailable` | `shared/customer-marketing-types.ts:4` |
| G2 | `CustomerProfileSyncStatus` | G1 + `conflict` | `shared/customer-marketing-types.ts:5` |
| G3 | `CustomerCapabilityCatalogStatus` | G1 + `forbidden` | `shared/customer-marketing-types.ts:6` |
| G4 | `CustomerMarketingBridgeStatus` | `synced` `local` `forbidden` `not_found` `conflict` `quota_exceeded` `unavailable` | `shared/customer-marketing-types.ts:358` |
| G5 | `offline_queue` op (`QueueOp.opType`) | `create` `update` `delete` (+ implicit queue lifecycle: queued → coalesced → applied → conflict) | `shared/offline-queue.ts:27`, `sqlite-schema.ts:177` |
| G6 | `sync_log.status` | free TEXT, default `pending` | `main/db/sqlite-schema.ts:64` |

### Group H — Media pipeline (Customer Marketing) → `WorkRun`/`WorkStep`/`Artifact`

| # | Legacy type | Values | Source |
|---|---|---|---|
| H1 | `CustomerMediaJobStatus` | `awaiting_preview_approval` `checking` `preview_ready` `blocked` `failed` | `shared/customer-marketing-types.ts:48` |
| H2 | `CustomerMediaArtifactKind` | `project_manifest` `check_receipt` `snapshot` | `shared/customer-marketing-types.ts:55` |
| H3 | `CustomerMarketingResourceLifecycleStatus` | `draft` `in_review` `approved` `rejected` `archived` | `shared/customer-marketing-types.ts:367` |

---

## 2. Mapping tables

### 2.A — Run states → `WorkRun.state`

| Legacy | Value | → PO state | Conf. | Lossy | Migration | Unknown fallback | Owner |
|---|---|---|---|---|---|---|---|
| `AgentRunStatus` | `active` | `running` | High | no | map | — | Loop 03 |
| `AgentRunStatus` | `done` | `completed` | High | no | map | — | Loop 03 |
| `AgentRunStatus` | `blocked` | `paused` | Med | yes (reason) | map+field `pausedReason='stuck'` | — | Loop 03 (§3.1) |
| `AgentRunStatus` | `archived` | terminal derived from entries; else `canceled` | Med | yes | always set `archivedAt` + `legacyStatusRaw='archived'`; inconclusive → `canceledReason='legacy_archived_outcome_unknown'`; emit exactly one audit migration event | — | Loop 03 (§3.6) |
| `CustomerRunStatus` | `queued` | `queued` | High | no | map | — | Loop 12 |
| `CustomerRunStatus` | `in_progress` | `running` | High | no | map | — | Loop 12 |
| `CustomerRunStatus` | `awaiting_approval` | `awaiting_approval` | High | no | map | — | Loop 12 |
| `CustomerRunStatus` | `ready` | `running` | Med | yes | map (or `awaiting_approval` if an open publish Approval) | — | Loop 12 (§3.3) |
| `CustomerRunStatus` | `completed` | `completed` | High | no | map | — | Loop 12 |
| `CustomerRunStatus` | `blocked` | `waiting_external` | Med | no | map | — | Loop 12 (§3.4) |
| `RunStatus` (sched.) | `running` | `running` | High | no | map | — | Loop 03 |
| `RunStatus` (sched.) | `success` | `completed` | High | no | map | — | Loop 03 |
| `RunStatus` (sched.) | `failed` | `failed` | High | no | map | — | Loop 03 |
| `RunStatus` (sched.) | `refused` | `canceled` (+`canceledReason='system_refused'`) | Med | yes (reason) | map+field | — | Loop 03 (§3.2) |
| *any A1–A5* | *unrecognized* | `paused` (+`legacyStatusRaw`) | High (rule) | no (raw kept) | map+field + emit migration `WorkEvent` | **this row** | Loop 03 (§3.8) |

### 2.B — Task/Step states → `WorkStep.status`

`WorkStepStatus = todo | in_progress | blocked | done`.

| Legacy | Value | → PO `WorkStep.status` | Conf. | Lossy | Migration | Owner |
|---|---|---|---|---|---|---|
| `AgentTaskStatus` | `todo` / `in_progress` / `blocked` / `done` | identical | High | no | map (1:1) | Loop 03 |
| host-agent task | `pending` | `todo` | High | no | map | Loop 03 |
| host-agent task | `in_progress` | `in_progress` | High | no | map | Loop 03 |
| host-agent task | `completed` | `done` | High | no | map | Loop 03 |
| host-agent task | `blocked` | `blocked` | High | no | map | Loop 03 |
| `CustomerRunStep.status` | `todo` / `in_progress` / `done` / `blocked` | identical | High | no | map (1:1) | Loop 12 |

> Note: `WorkStep.status` already carries `blocked` as a first-class value, so step-level
> "stuck" is **non-lossy**. The ambiguity in §3.1 is strictly about **run-level** blocked.

### 2.C — Approval states → `Approval.state`

`ApprovalState = requested | approved | rejected | expired | withdrawn`.

| Legacy | Value | → PO `Approval.state` | Conf. | Lossy | Migration | Owner |
|---|---|---|---|---|---|---|
| `CustomerApprovalStatus` | `pending` | `requested` | High | no | map | Loop 12 |
| `CustomerApprovalStatus` | `approved` | `approved` | High | no | map | Loop 12 |
| `CustomerApprovalStatus` | `rejected` | `rejected` | High | no | map | Loop 12 |
| `WorkflowReviewStatus`/`Decision` | `pending`/`approved`/`rejected` | same as above | High | no | map | Loop 12 |
| `CustomerApprovalKind` | (4 kinds) | `Approval` metadata (kind), not a state | High | no | map to a `kind` field | Loop 12 |
| — | (`expired`,`withdrawn`) | **no legacy source** | High | no | never produced by migration | Loop 12 |

### 2.D — Event / work-stream → `WorkEvent` (+ `WorkStep`)

The legacy turn-event stream and run-entry log are the natural source of the PO
`WorkEvent` log (ADR-PO-002: the Run's source of truth). Adapters synthesize events;
`idempotencyKey` must be derived deterministically from the legacy row id.

| Legacy | Value/shape | → PO | Conf. | Lossy | Migration | Owner |
|---|---|---|---|---|---|---|
| `AgentRunEntry` (`kind` `artifact`) | entry | `WorkEvent type='artifact.recorded'` + `Artifact` | Med | no | derive | Loop 03 |
| `AgentRunEntry` (`note`/`handoff`/`event`) | entry | `WorkEvent type='note'|'handoff'|'event'` | High | no | map kind | Loop 03 |
| `AgentTurnEvent` | `delta`/`reasoning` | transient stream — **drop** (not durable truth) | High | no | drop | Loop 03 |
| `AgentTurnEvent` | `step` | `WorkStep` upsert + `WorkEvent type='step.updated'` | Med | no | derive | Loop 03 |
| `AgentTurnEvent` | `done` (`error?`) | `WorkEvent type='turn.done'` (+ `run.failed` if `error`) | High | no | map | Loop 03 |
| `AgentStepStatus` | `running`/`done`/`error` | step-event status (`running`→in-flight, `done`→ok, `error`→step failed) | High | no | map | Loop 03 |
| `ChatMessageState` | (4) | **drop** — chat surface, not Run truth (ADR-PO-002) | High | no | drop; keep `originChatSessionId` only | Loop 03 |

### 2.E — Runtime / provisioning / health → `RuntimeInstance.provisioning` (+ proposed health)

`ProvisioningState = pending | provisioning | ready | failed | deprovisioning | released`.

| Legacy | Value | → PO | Conf. | Lossy | Migration | Owner |
|---|---|---|---|---|---|---|
| `ExtensionHostState`/loader | `idle`/`installed` | `pending` | Med | no | map | Loop 11 |
| " | `starting` | `provisioning` | High | no | map | Loop 11 |
| " | `running` | `ready` | High | no | map | Loop 11 |
| " | `stopping` | `deprovisioning` | Med | no | map | Loop 11 |
| " | `stopped` | `released` | Med | yes | map (stopped-clean) | Loop 11 |
| " | `crashed` | `failed` | High | no | map | Loop 11 |
| " | `disabled` | `released` (+`disabled` flag) | Med | yes | map+field | Loop 11 |
| `AgentRuntimeStatus` | `idle`/`connecting`/`running`/`error` | `pending`/`provisioning`/`ready`/`failed` | Med | no | map | Loop 11 |
| `CustomerMediaRuntimeState` | `ready`/`needs_setup`/`blocked` | runtime provisioning health: `ready`/`pending`/`failed`; an associated active WorkRun blocked by that runtime maps separately to `waiting_external` | Med | yes | split runtime health from run state (see §3.4) | Loop 12 |
| `MarketingHealth` | `ready`/`attention`/`blocked`/`unknown` | workspace **health signal**, not provisioning | Blocked | yes | map+field (proposed `WorkspaceInstance.health`) | Loop 08 (§3.5) |
| `SessionIssueKind` | (5) | diagnosis metadata on a `failed`/`paused` run event | High | no | map to event payload | Loop 03 |

### 2.F — Integration / credential → `IntegrationGrant`

| Legacy | Value | → PO | Conf. | Lossy | Migration | Owner |
|---|---|---|---|---|---|---|
| `IntegrationConnectionStatus` | `connected` | grant present & active | High | no | derive | Loop 10 |
| " | `disconnected` | no grant / `revokedAt` set | Med | yes | derive | Loop 10 |
| " | `pending` | grant requested, not active | Med | no | derive | Loop 10 |
| " | `error` | grant present + last-error event | Med | no | map+field | Loop 10 |
| `CredentialConnectionState` | `connected`/`disconnected`/`locked`/`invalid` | grant active / revoked / vault-locked / `invalid` (needs re-auth) | Med | yes | map+field | Loop 10 |
| `CredentialVaultState` | `ready`/`locked` | secret-store availability (`SecretRef` resolvable?) | High | no | runtime signal, not stored on grant | Loop 10 |
| `CustomerWorkspaceMemberStatus` | `active`/`suspended` | out of PO scope (multi-tenant membership) | High | n/a | drop | Loop 12 |

> Credentials themselves are **never** migrated as values — only the fact that a
> `SecretRef` exists (ADR-PO-004). Vault `locked`/`ready` is a resolve-time signal.

### 2.G — Sync / bridge / offline → dropped from the entity adapter

G1–G6 describe **cloud-sync/egress state**, not domain state. They map to the
control↔execution sync layer (ADR-PO-001), not to any `WorkRun`/entity `state`. The
Run/Task/Event adapters **ignore** them. Two design carry-overs, no migration rows:

- `offline_queue` (G5) validates the PO `WorkEvent` design: it is an ordered,
  coalesced, id-remapped op log with explicit `resolveConflict` — the same
  idempotency+ordering discipline `events.ts` encodes. The sync loop reuses this;
  it does not become a Run state.
- `CustomerMarketingBridgeStatus.conflict`/`quota_exceeded` (G4) are egress outcomes
  surfaced as sync events, never as `WorkRun.state`.

### 2.H — Media pipeline → Customer Marketing adapter (Loop 12)

| Legacy | Value | → PO | Conf. | Lossy | Migration | Owner |
|---|---|---|---|---|---|---|
| `CustomerMediaJobStatus` | `checking` | `WorkStep in_progress` | Med | no | map | Loop 12 |
| " | `preview_ready` | `WorkStep done` + `Artifact` | Med | no | derive | Loop 12 |
| " | `awaiting_preview_approval` | run `awaiting_approval` + `Approval(kind=media_preview)` | High | no | derive | Loop 12 |
| " | `blocked` | `waiting_external` | Med | no | map | Loop 12 (§3.4) |
| " | `failed` | `failed` | High | no | map | Loop 12 |
| `CustomerMediaArtifactKind` | (3) | `Artifact` metadata | High | no | map | Loop 12 |
| `ResourceLifecycleStatus` | `draft`/`in_review`/`approved`/`rejected`/`archived` | resource metadata, not Run state | High | no | drop from Run adapter | Loop 04 |

---

## 3. Decision records for the eight ambiguities

Each records: **evidence**, **decision**, **missing info** (if Blocked), **safe
fallback**, **required test before migration**.

### 3.1 AgentRun stuck/guardrail `blocked` → `paused` or `failed`?
- **Evidence.** `host-agent.ts:67` instructs the model to mark a task `"blocked" if
  stuck` — i.e. temporarily cannot proceed, not a hard error. The action-gate sets
  `blocked` when guardrail words/unsafe instructions are present
  (`customer-marketing-service.ts:769`) — a recoverable "needs revision" outcome.
- **Decision (evidence-backed).** AgentRun/task “stuck” and guardrail `blocked` →
  **`paused`**, never `failed`. `paused` is recoverable and re-enterable
  (`paused → running`), matching those causes.
- **Reason detail.** Set `pausedReason='stuck'|'guardrail'` as applicable. External
  integration/runtime/media dependency blocks are intentionally excluded and map
  to first-class `waiting_external` under §3.4.
- **Safe fallback.** When the AgentRun cause cannot be distinguished, use `paused`
  without fabricating a reason; never fabricate `failed`.
- **Required test.** AgentRun stuck/guardrail blocks produce a re-enterable `paused`;
  customer/runtime/media dependency blocks produce `waiting_external`; neither
  produces `failed`.

### 3.2 `refused` → `canceled` or `failed`?
- **Evidence.** The scheduler models `refused` **distinctly from** `failed`
  (`playbook-types.ts:98`). `failed` is set only when a step failed
  (`schedule-service.ts:223`: `failedStepId ? 'failed' : 'success'`). `refused` comes
  from the OS scheduler declining to start (`isRefusedByMachineState`, e.g. on battery
  / policy) — **no work executed, nothing failed**.
- **Decision.** `refused` → **`canceled`** (system-canceled), not `failed`.
- **Safe fallback.** `canceled` + proposed `canceledReason='system_refused'`.
- **Required test.** Scheduler `refused` maps to `canceled`, and `failed` maps to
  `failed`; the two never collapse.

### 3.3 `awaiting_approval` → keep, or rename to `waiting_user`?
- **Evidence.** `CustomerRunStatus` already uses the literal `awaiting_approval`
  (:42), paired with a `CustomerApproval` object. PO `RunState` already defines
  `awaiting_approval` (Loop 01 contract).
- **Decision.** **Keep `awaiting_approval`** (1:1). It semantically *is* "waiting on
  the user to decide". Renaming to `waiting_user` would be a churny, evidence-free
  contract change — rejected under "no big-bang, additive".
- **Safe fallback.** n/a (High confidence, non-lossy).
- **Required test.** `CustomerRunStatus.awaiting_approval` ↔ PO `awaiting_approval`,
  and a matching `Approval` is present.

### 3.4 waiting-on-integration/runtime → `waiting_external`
- **Evidence.** `CustomerMediaRuntimeState` has `needs_setup`/`blocked` (:57),
  `MarketingHealth` has `attention`/`blocked`, `CustomerMediaJobStatus` has `blocked`
  — all "waiting on an external dependency (integration/runtime/setup)", distinct from
  a human decision.
- **Decision (W0 PO-RUNSTATE-CONTRACT-GAP ruling).** `waiting_external` is a
  first-class `RunState`, because an integration/runtime dependency is neither
  “waiting for me” nor a generic operator pause. Legal edges are
  `running → waiting_external → running|canceled`.
- **Reason detail.** `pausedReason` remains additive for the genuinely
  reason-shaped cases `stuck|guardrail`; it no longer carries
  `waiting_external`.
- **Required tests.** Customer/runtime/media blocked maps to
  `waiting_external`; AgentRun “stuck” blocked remains `paused`; neither maps to
  `failed`.

### 3.5 partial success / degraded workspace
- **Evidence.** **No** legacy run-level "partial"/"degraded" value exists (grep: no
  `partial`/`degraded` in desktop source). The only "degraded" signals are
  workspace-health: `MarketingHealth='attention'` and `CustomerMediaRuntimeState=
  'needs_setup'`.
- **Decision (Blocked).** "Degraded workspace" is **not** a `WorkRun` outcome and not a
  `WorkspaceState`. Recommend a *proposed additive* `WorkspaceInstance.health:
  'ok'|'attention'|'blocked'|'unknown'` (mirrors `MarketingHealth`) — separate from
  the lifecycle state machine. Not added in Loop 01.
- **Missing info.** Whether health belongs on `WorkspaceInstance` or `RuntimeInstance`.
  Owner: **Loop 08**.
- **Safe fallback.** Keep workspace `active`; surface health as a non-blocking signal.
  Never map `attention`/`needs_setup` to `suspended` (deliberate pause) or `failed`.
- **Required test.** No health value forces a lifecycle transition; `active` workspace
  stays `active` regardless of health.

### 3.6 `archived` (legacy run) after upgrade
- **Evidence.** `AgentRunStatus` has `archived` (:57 region) with no PO `RunState`
  equivalent (PO run terminals are `completed`/`canceled`; archival is a
  `WorkspaceState`). Legacy `archived` = soft-hidden run; the *pre-archive* outcome is
  not stored on the run row.
- **Decision (W0 MAP-ARCHIVED ruling).** Read `agent_run_entries` and derive the
  terminal only when the evidence is conclusive. If it is inconclusive, map to
  **`canceled`** with
  `canceledReason='legacy_archived_outcome_unknown'` — never default to
  `completed` or `failed`.
- **Required metadata.** Always set `archivedAt`, preserve
  `legacyStatusRaw='archived'`, and emit exactly one
  `migration.archived_status` `WorkEvent` classified as `audit_events`.
- **Why this is fail-safe.** A false `completed` silently claims that work and
  artifacts exist. A conservative `canceled` invites review without fabricating
  success. `failed` is valid only when entries conclusively prove failure.
- **Required tests.** Conclusive completion → `completed`; conclusive failure →
  `failed`; inconclusive → `canceled` with the reason above. Every result is
  terminal, preserves archival metadata, and emits exactly one audit event.

### 3.7 `queued` vs `draft`
- **Evidence.** `CustomerRunStatus.queued` = a run created and waiting to start. PO
  `RunState` has `created`→`queued`; PO `WorkspaceState` has `draft`. Legacy has **no**
  "draft run" and no per-run pre-creation state; there is a single implicit workspace
  (no legacy workspace provisioning).
- **Decision.** `queued` → **run `queued`** (High, 1:1). `draft` is a
  **workspace-level** state with **no legacy source** — migration never emits a
  `draft` run. Legacy runs are imported directly as `queued`/`running`/terminal.
- **Safe fallback.** n/a.
- **Required test.** No migrated run is ever `draft`; `draft` only originates from new
  PO workspace creation.

### 3.8 unknown legacy value after upgrade
- **Evidence.** `agent_runs.status` and `scheduled_session_runs.status` are free TEXT
  (`sqlite-schema.ts:134,168`) with no DB `CHECK`, so a value outside the known set is
  physically possible (newer build, manual edit, corruption). `serialization.ts`
  currently rejects unknown *schema versions* but the *status-value* adapter is a Loop
  03 concern.
- **Decision (evidence-backed rule).** An unrecognized run status must **not** throw
  and must **not** guess a terminal: map → **`paused`**, preserve the original in a
  *proposed additive* `legacyStatusRaw`, and append a migration `WorkEvent`
  (`type='migration.unknown_status'`, classification `audit_events`) recording the raw
  value + source row.
- **Safe fallback.** `paused` + `legacyStatusRaw` (human-triageable, recoverable).
- **Required test.** Unknown status ⇒ no throw; PO state = `paused`; raw value
  preserved; exactly one migration event emitted.

### 3.9 retry / fork lineage (bonus — listed in the brief)
- **Evidence.** **No** lineage fields exist in legacy (grep: no `parentRunId`,
  `retryOf`, `retriedFrom`, `fork`, `lineage` anywhere). Legacy retries (e.g. scheduler
  re-runs) create independent `scheduled_session_runs` rows with no parent pointer.
- **Decision (W0 PQ-08 ruling).** Lineage still **cannot be reconstructed** from
  legacy data, so every migrated run is a root. Future runs use
  `lineageKind='original'|'retry'|'fork'`, `parentRunId`, `rootRunId`, and
  monotonic `attempt`.
- **Retry rule.** `failed` is terminal. A retry creates a **new** `WorkRun`
  (`lineageKind='retry'`) rather than transitioning the failed row back to queued.
  A fork likewise creates a new run and retains the same root.
- **Safe fallback.** Never heuristically link legacy rows. Imported roots use
  `lineageKind='original'`, no parent, `rootRunId=id`, and `attempt=1`.
- **Required tests.** Migrated rows fabricate no parent/fork edge; retry/fork ids
  differ from the source id while preserving root lineage and increasing attempt.

---

## 4. Migration ownership matrix

Which loop **implements** each adapter. Canonical entity fields are owned by the
W1 shared contract; downstream loops consume them and own adapter/storage behavior,
not parallel contract definitions.

| Loop | Scope | Legacy sources it adapts | Canonical fields consumed / adapter additions |
|---|---|---|---|
| **Loop 03** | Run / Task / Event adapters | A1,A3,A4,A5 (runs) · B1,B2 (tasks) · D1–D5 (events) · E6 (diagnosis) | Consumes W1 `pausedReason`, `canceledReason`, `archivedAt`, `legacyStatusRaw`, and lineage fields; introduces no parallel contract. Owns evidence derivation, persistence adapter, and exactly-one migration audit event. |
| **Loop 04** | Live.md / Graph mappings | H3 (resource lifecycle) · graph nodes/links → `ContextSnapshot`/`LiveProfile` | — |
| **Loop 08** | Workspace lifecycle | workspace draft/active/suspended/archived semantics | `WorkspaceInstance.health` (§3.5) |
| **Loop 09** | Provisioning | provisioning bring-up wiring | — |
| **Loop 10** | Integration grants | F1,F2,F3 | `IntegrationGrant.lastErrorAt`, `invalid` re-auth flag |
| **Loop 11** | Runtime / browser | E1,E2,E3 (extension host/loader/runtime) | `RuntimeInstance.disabled` flag |
| **Loop 12** | Customer Marketing | A2 (runs) · B3 (steps) · C1–C4 (approvals) · E4 (media runtime) · H1,H2 (media jobs/artifacts) | Reuses canonical W1 fields and Loop 03 adapter conventions |

Groups **G1–G6** (sync/bridge/offline) are owned by the cloud-sync layer (ADR-PO-001),
not by any Run/entity adapter loop.

---

## 5. Summary

- **Legacy statuses inventoried:** 31 enums across 6 concern groups (A–H).
- **Mappings finalized (High/Med, actionable):** 41 value-level rows.
- **Blocked decisions (need an owner call):** 1 — §3.5 (placement of degraded/health
  on `WorkspaceInstance` versus `RuntimeInstance`).
- **Evidence-decisive resolutions:** §3.1 (`blocked`→`paused`), §3.2
  (`refused`→`canceled`), §3.3 (keep `awaiting_approval`), §3.7 (`queued`≠`draft`),
  §3.8 (unknown→`paused`+raw).
- **W0 rulings applied:** §3.4 external dependency blocks → `waiting_external`;
  §3.6 archived derives terminal outcome from evidence with conservative canceled
  fallback; §3.9 legacy rows remain roots while future retry/fork lineage is explicit.
- **Key structural facts from source:** legacy has **no** cancel, no pause, no
  fork/lineage, and no partial/degraded run outcome; `blocked` is overloaded between
  AgentRun stuck/guardrail pauses and external dependency waits; the scheduler
  cleanly separates `failed` (work failed) from `refused` (never started).

No adapter implemented. No production source changed. See ADR-PO-002 for the
evidence-backed decisions folded into the unified work model.
