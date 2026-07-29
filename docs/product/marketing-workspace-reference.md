# Marketing Workspace reference

Status: implementation contract for Loop 12.

## Product boundary

Customer Marketing remains the authoritative writer for profile, runs, approvals,
resources, media artifacts, role checks, quota checks and external-action gates.
Personal Office presents that authority through a smaller operator workflow.
Unified Work receives an append-only, deterministic projection; it never writes
back into Customer Marketing in this loop.

Rollback changes presentation only. It does not delete, move or rewrite source
records. The legacy Customer Marketing route remains available behind
`izzi.marketing.workspaceReference`.

## Route map

| Route | Default | Rollback |
| --- | --- | --- |
| Personal Office → Marketing workspace | Reference workspace | Legacy Customer Marketing room |
| Personal Office → Market → installed Marketing package | Main validates evidence, provisions/reuses exact workspace, returns open intent | Deny when evidence or scope is not authoritative |
| Legacy sidebar → AI Marketing | Reference workspace | Query/local flag opens legacy room |

## Primary surfaces

Exactly four top-level surfaces are allowed:

1. **Brief** — business context, current objective, Director composer and readiness.
2. **Work** — runs, steps, owners and progress; specialists are timeline metadata.
3. **Deliverables** — current resources and media artifacts. Version/export controls
   appear only when the source API supports them.
4. **Approvals** — Customer Marketing approvals decided through its role-aware,
   evidence-bound main-process service.

Campaigns, content, channels, assets, knowledge, Director, goals, video, team,
apps and brand are not primary navigation items.

## Component map

| Concern | Reused source | Reference composition |
| --- | --- | --- |
| Snapshot and mutations | `ElectronCustomerMarketingApi` | One page-level controller |
| Brief | onboarding profile + `DirectorComposer` | Context summary, readiness, goal |
| Work | `CustomerRun` and steps | Scan-friendly run timeline |
| Deliverables | Customer Marketing resources + media artifacts | Kind filters and honest capability labels |
| Approvals | `ApprovalsView` / `reviewApproval` | Existing role and evidence gate |
| Setup | onboarding, capabilities, channels, runtime health | Three progressive groups |
| Rollback | existing `CustomerRoom` | Separate persisted feature flag |

## Interaction-state checklist

Every surface must represent:

- loading;
- empty;
- ready;
- recoverable error with retry;
- offline/degraded without claiming current external state;
- busy mutation with controls disabled;
- role-restricted read-only state;
- unavailable capability without a fake action.

Tabs use roving focus with ArrowLeft/ArrowRight/Home/End. Setup is a modal drawer
with Escape, focus trap and focus restoration. No horizontal page overflow is
allowed at 390 px.

## Progressive disclosure contract

Setup has exactly three top-level groups:

- **Context** — business, audience, brand, objectives and knowledge references.
- **Connections** — installed capabilities, channels and integration health.
- **Automation** — automation mode, approval policy and runtime readiness.

Required-now fields are shown before the first goal. Capability-specific
requirements appear only when that capability is selected. Deferred settings
stay labeled and do not block unrelated work.

## Setup matrix

| Group | Required before first run | Capability-specific | Deferred | Health/error owner | Mobile |
| --- | --- | --- | --- | --- | --- |
| Context | business name, industry, offer, one objective | brand/media constraints | extra audience detail, optional resources | Customer Marketing profile service | stacked editor |
| Connections | none for context-only strategy | selected channel/integration | unused channels | host extension + integration status | compact rows |
| Automation | mode and approval boundary | runtime needed by chosen action | schedules and specialist tuning | Customer Marketing/runtime gate | segmented control |

## Migration and rollback model

The migration is a shadow projection:

1. Read the untouched Customer Marketing record and durable workflow store.
2. Derive deterministic unified workspace/run/approval ids.
3. Upsert through `WorkService`; reruns are idempotent.
4. Never copy credential values. Only public status/reference metadata may be
   presented.
5. Preserve malformed source bytes by failing closed; never delete a source
   record because parsing failed.
6. On restart, repeat the projection from source. On rollback, render the source
   route. No reverse migration is required because source remains authoritative.

## Approval sequence

1. User creates a goal through Customer Marketing.
2. Customer Marketing persists workflow, artifacts and pending approval.
3. The projection mirrors the run/approval into Unified Work for observation.
4. User decides through Customer Marketing.
5. Customer Marketing validates current role, digest and durable workflow.
6. Only after the source decision succeeds is the projection refreshed.

Unified Work approval mutation is not used for Marketing in this loop.

## Marketplace bridge boundary

Renderer plan/demo metadata is never provisioning authority.

Main must derive:

- authenticated user id;
- current authorized Customer Marketing workspace id and role;
- installed/running Customer Marketing extension identity and version;
- an evidence digest over that host-owned material.

Provision accepts the exact evidence and scope, revalidates all host state,
ensures/imports the deterministic unified workspace, and returns only a safe
`open_customer_marketing_workspace` intent. Mismatch, stale evidence, missing
installation, forbidden role or unavailable workspace returns a denial.

No publish, spend, send, delete, package install or runtime start is performed by
this bridge.

## Capability truth table

| Source | Preview | Current revision | History | Export |
| --- | --- | --- | --- | --- |
| Campaign/content resource | Source-supported view | yes | not exposed | not exposed |
| Asset/knowledge resource | Source-supported view | yes | not exposed | not exposed |
| Media artifact | receipt/metadata | immutable artifact metadata | artifact list only | only through existing safe source affordance |
| Workflow evidence | approval summary/digest | current evidence | durable store, not renderer-listed | not exposed |

Unsupported affordances are labeled rather than synthesized.
