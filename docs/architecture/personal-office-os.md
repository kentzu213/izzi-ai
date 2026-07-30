# Starizzi Personal Office OS — Domain Model & Contracts (Loop 01)

> **Status: READY FOR REVIEW** — replayed on accepted Loop 00 integration ref
> `0cbf888`; PQ-08 two-layer contract ruling applied.
> **Scope:** this loop chốt (freezes) the domain model, data classification, trust
> boundaries, high-level state machines, and the minimal versioned TypeScript
> contracts. It does **not** change navigation, UI, orchestration, or migrate any
> real database. No existing type or store is deleted.

This document is the human-readable source of truth. Its machine-readable twin is
the contract package at `apps/desktop/src/shared/personal-office/` (barrel:
`index.ts`). Where the two disagree, the code wins for shapes and this doc wins for
rationale.

---

## 1. Why this model

Today the desktop app carries several overlapping "work" concepts:

- `agent_runs` / `agent_run_entries` (SQLite) + `AgentRun` / `AgentRunEntry`
  (`main/agent/types.ts`) — a durable "blackboard" Run.
- `CustomerRun` / `CustomerRunStep` / `CustomerApproval`
  (`shared/customer-marketing-types.ts`) — the marketing room's Run + approval.
- `scheduled_sessions` / `scheduled_session_runs` (SQLite) — scheduled Run records.
- Chat sessions/messages (`chat_sessions`, `chat_messages`) — the conversational surface.

These evolved independently. The Personal Office OS gives them **one** unified work
vocabulary so a Run means the same thing everywhere, while keeping every legacy
type alive behind an adapter path (see §7).

Four design invariants govern the whole model:

1. **Chat is not the source of truth of a Run.** A Run's truth is its ordered
   `WorkEvent` stream; chat is an origin reference at most.
2. **Model/provider does not own domain state.** A provider is a capability, an
   actor — never an authoritative store.
3. **Secrets exist only as references.** Contracts carry `SecretRef`, never values.
4. **Everything is versioned and adaptable.** Every aggregate carries
   `schemaVersion`; migration is an ordered registry, not a rewrite.

---

## 2. Two planes

| Plane | Zone | Owns | Never owns |
|---|---|---|---|
| **Control plane** | IzziAPI cloud (`izziapi_control_plane`) | Identity, billing, package/blueprint **catalog** metadata, redacted **audit index** | Any domain state (runs, artifacts, secrets, files) |
| **Execution plane** | Desktop (`desktop_execution_plane`) | All Runs, Steps, Artifacts, Secrets, local files, LiveProfile, the authoritative event log | — |

The control plane is authoritative **only** for `public_metadata`. Domain state is
authoritative **only** on the execution plane. This asymmetry is encoded in
`trust.ts::TRUST_ZONES[*].mayHoldAuthoritative` and tested.

---

## 3. Domain glossary

Each entity has exactly one meaning; no two overlap (acceptance criterion). Code:
`entities.ts`, `events.ts`.

| Entity | One-line meaning | Kind | Key discriminators vs. neighbours |
|---|---|---|---|
| **WorkspaceBlueprint** | Reusable **template** of an office (agents + skills + tools + required integrations). | Aggregate root | "What an office *can* be." Publishable metadata. Not provisioned. |
| **WorkspaceInstance** | A **provisioned** office created from a blueprint, owned by a user. | Aggregate root | "*This* office." Has lifecycle + provisioning sub-state. |
| **WorkRun** | One **execution of work** toward a goal, inside a workspace. | Aggregate root | Rebuilt from its `WorkEvent` stream; chat is not its truth. |
| **WorkStep** | One **unit of work** inside a run. **Step and Task are the same concept.** | Child of Run | Ordered by `ordinal`; may be approval-gated. |
| **Artifact** | A durable **output** of a run (bytes stay local, addressed by sha256). | Child of Run | It is produced *by* a step; it is not the step. |
| **Approval** | A **human decision gate** on a run/step. | Child of Run | A decision, not a step; carries evidence digest. |
| **WorkEvent** | An append-only **fact** in a run's ordered stream. | Log record | The Run's source of truth. Has idempotency + ordering. |
| **Checkpoint** | A **resumable saved position** in a run (event sequence + snapshot). | Child of Run | A resume point; not the immutable context itself. |
| **ContextSnapshot** | An **immutable** captured bundle of input context for a run/step. | Child of Run | Immutable + content-addressed; the opposite of LiveProfile. |
| **LiveProfile / Live.md** | The **evolving working state** (latest-wins, mutable) of a workspace. | Aggregate root | Mutable + revisioned; distinct from immutable ContextSnapshot. |
| **AgentDefinition** | A **declared** agent (persona + skills + tools). | Catalog entity | A declaration, **not** a running thing (that's RuntimeInstance). |
| **SkillPackage** | A **distributable bundle** of skills (.oab-shaped). | Catalog entity | A shippable package; a ToolDefinition is a single capability. |
| **ToolDefinition** | A **single invocable capability** with one permission need. | Catalog entity | Atomic; a SkillPackage groups many. |
| **IntegrationGrant** | A **scoped, revocable authorization** to act on an integration. | Aggregate root | Carries a `SecretRef`, scopes, expiry — the trust contract. |
| **RuntimeInstance** | A **running execution environment** (container/process/browser/inproc). | Aggregate root | The live thing; AgentDefinition is its declaration. |

**Disambiguation notes**

- *Step vs Task*: unified into `WorkStep`. Legacy `agent_tasks` and
  `CustomerRunStep` both adapt onto it (§7).
- *ContextSnapshot vs LiveProfile*: snapshot is immutable input; LiveProfile is
  mutable working state. They never collapse into one type.
- *AgentDefinition vs RuntimeInstance*: definition is static catalog; instance is
  a live runtime. Provider preference on a definition is a hint, not ownership.
- *SkillPackage vs ToolDefinition*: package = bundle; tool = one capability.

---

## 4. Data classification matrix

Code: `classification.ts::CLASSIFICATION_MATRIX` (frozen, tested).

| Class | Residency | Egress | Encrypted at rest | Examples |
|---|---|---|---|---|
| `public_metadata` | either | **allowed** | no | Blueprint/package catalog, capability descriptors |
| `personal_graph` | either | metadata only | yes | MyGraph nodes/links content |
| `local_files` | execution | **forbidden** | yes | Files a run reads/writes on the machine |
| `artifacts` | execution | metadata only | yes | Run outputs (bytes local; digest may sync) |
| `secrets` | execution | **forbidden** | yes | Tokens/credentials — only as `SecretRef` |
| `audit_events` | execution/either | metadata only | yes | `WorkEvent` log (payload local; redacted meta may sync) |

Only `public_metadata` may egress freely. `secrets` and `local_files` must never
leave the execution plane (`mustStayLocal(...) === true`).

---

## 5. Trust boundaries

Code: `trust.ts` (`TRUST_ZONES`, `TRUST_BOUNDARY_CROSSINGS`, `isSanctionedCrossing`).
Six zones; default-deny — only the listed crossings are sanctioned.

```
                         ┌───────────────────────────────────────────────┐
                         │  CONTROL PLANE                                  │
                         │  izziapi_control_plane  (TRUSTED)               │
                         │  identity · billing · catalog · audit index     │
                         │  authoritative ONLY for: public_metadata         │
                         └───────────────▲───────────────┬─────────────────┘
   redacted audit meta +                 │               │ signed blueprint/pkg
   public catalog sync                   │               │ descriptors + identity
   (egress rules apply)                  │               │ tokens (SecretRef)
 ════════════════════ TRUST BOUNDARY (machine edge) ═════▼═════════════════════
                         ┌───────────────┴───────────────────────────────┐
                         │  EXECUTION PLANE                                │
                         │  desktop_execution_plane  (TRUSTED)             │
                         │  authoritative for: personal_graph, local_files,│
                         │  artifacts, secrets, audit_events               │
                         │                                                 │
                         │   prompt/context   IntegrationGrant +           │
                         │   (no secrets)     ToolDefinition (least priv.) │
                         │        │                  │                     │
                         │        ▼                  ▼                     │
                         │  ┌───────────┐     ┌───────────────┐            │
                         │  │model_     │     │extension_     │            │
                         │  │provider   │     │package        │            │
                         │  │UNTRUSTED  │     │UNTRUSTED      │            │
                         │  │no authority│    │sandboxed      │            │
                         │  └───────────┘     └───────┬───────┘            │
                         │                            │ izzi-svc- spec     │
                         │                 ┌──────────▼──────┐  approval-   │
                         │                 │ local_runtime   │  gated       │
                         │                 │ UNTRUSTED       │  ┌─────────┐ │
                         │                 │ loopback only   │  │browser_ │ │
                         │                 └─────────────────┘  │runtime  │ │
                         │                                      │UNTRUSTED│ │
                         │                                      │(not impl│ │
                         │                                      │ loop 01)│ │
                         │                                      └─────────┘ │
                         └─────────────────────────────────────────────────┘
```

Sanctioned crossings (anything else is denied):

1. execution → control: redacted audit metadata + public catalog sync.
2. control → execution: signed blueprint/package descriptors + identity/billing tokens (SecretRef).
3. execution → model_provider: classification-filtered prompt/context, **no secrets**.
4. execution → extension_package: `IntegrationGrant` + `ToolDefinition` invocation (least privilege).
5. extension_package → local_runtime: managed service spec (`izzi-svc-` namespace, loopback bind).
6. extension_package → browser_runtime: approval-gated browser action (**not implemented this loop**).

---

## 6. State machines

Code: `state-machine.ts` (transition tables + `assertTransition` + tests, incl.
invalid-transition tests).

### 6.1 Workspace lifecycle (`WorkspaceInstance.state`)
```
draft ──▶ active ──▶ suspended ──▶ active
  │         │            │
  └────────▶└───────────▶└────────▶ archived (terminal)
```

### 6.2 Provisioning lifecycle (`RuntimeInstance` / workspace bring-up)
```
pending ─▶ provisioning ─▶ ready ─▶ deprovisioning ─▶ released (terminal)
                │
                ▼
              failed ─▶ provisioning (retry)
              failed ─▶ released (give up)
```

### 6.3 Run lifecycle (`WorkRun.state`)
```
created ─▶ queued ─▶ running ─▶ completed (terminal)
                       │  ▲├────▶ failed (terminal)
                       │  │├────▶ paused ─▶ running
                       │  │├────▶ waiting_external ─▶ running
                       │  │└────▶ awaiting_approval ─▶ running   (approved)
                       │  │                           └─▶ canceled (rejected/abort)
   (created|queued|running|awaiting_approval|waiting_external|paused)
                       └────────────────────────────▶ canceled (terminal)
```
Terminal set is exactly `{ completed, failed, canceled }`. Retry/fork creates a
new `WorkRun` with `parentRunId`, stable `rootRunId`, lineage kind, and incremented
attempt; a terminal row never reopens.

### 6.4 Approval lifecycle (`Approval.state`)
```
requested ─▶ approved | rejected | expired | withdrawn   (all terminal)
```

---

## 7. Compatibility & migration strategy (adapter path, no big-bang)

> **Value-level detail (Loop 01B):** the exhaustive per-status inventory, mapping
> tables, ambiguity decision records, and the migration ownership matrix live in
> [`legacy-personal-office-mapping.md`](./legacy-personal-office-mapping.md). The
> table below is the aggregate-level summary.

The Personal Office contracts are **additive**. Nothing legacy is edited or
removed this loop. Each legacy surface gets an adapter mapping onto the unified
model; adapters land in later loops.

| Legacy surface | Location | Maps onto | Adapter direction | Notes |
|---|---|---|---|---|
| `AgentRun` / `AgentRunEntry` | `main/agent/types.ts`, `agent_runs`/`agent_run_entries` | `WorkRun` + `WorkEvent` | legacy → PO (read adapter) | `stage` (free-form) becomes run metadata; entries → events. `blocked` is recoverable `paused`. `archived` derives a terminal from entries; inconclusive rows become `canceled` with archival metadata and exactly one audit migration event. |
| `agentWorkspace` store | `renderer/store/agentWorkspace.ts` | `WorkRun`, `WorkStep`, `AgentDefinition` view models | PO → renderer (selector adapter) | Store stays as-is; a selector projects PO aggregates into its existing shapes. |
| `agentGateway` store | `renderer/store/agentGateway.ts` | chat origin reference on `WorkRun.originChatSessionId` | one-way | Gateway remains chat/runtime UI; it never becomes the Run's truth. |
| `agent_tasks` | `sqlite-schema.ts` | `WorkStep` | legacy → PO | status `todo/in_progress/blocked/done` == `WorkStepStatus` exactly. |
| Customer Marketing runs/approvals | `shared/customer-marketing-types.ts` | `WorkRun` / `Approval` | legacy → PO | `CustomerRunStatus` → `RunState` mapping (`awaiting_approval`→`awaiting_approval`, `blocked`→`waiting_external`, `ready`→`running`, `completed`→`completed`). `CustomerApprovalStatus pending/approved/rejected` ⊂ `ApprovalState`. |
| Extensions (`.ocx`) / agent bundles (`.oab`) | `main/extensions/ocx-manifest.ts`, `packages/agent-bundle/src/manifest.ts` | `SkillPackage` + `ToolDefinition` + `IntegrationGrant` + `RuntimeInstance` | manifest → PO | `OcxServiceSpec` (`izzi-svc-` + loopback) becomes a `RuntimeInstance` with `serviceProject`; `SecretDef`/`OcxServiceSecret` become `SecretRef` (never inlined). |

Migration mechanics: `serialization.ts::MIGRATIONS` (empty at v1). A future
breaking change appends `{ from: 1, to: 2, migrate }`; `decode()` chains forward
automatically. Readers never need a rewrite.

---

## 8. What Loop 01 deliberately did NOT do

- No navigation change (`App.tsx` Page union, `Sidebar.tsx` untouched).
- No new Marketplace flow.
- No browser automation implementation.
- No deletion of legacy types/stores.
- No real DB migration; `sqlite-schema.ts` untouched.

See the ADRs in `docs/architecture/adr/` for the decisions behind each choice, and
`worklogs/personal-office-loop-01-provisional.md` for the revalidation checklist.
