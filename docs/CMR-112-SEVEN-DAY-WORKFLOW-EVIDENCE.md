# CMR-112 Seven-Day Workflow Evidence

Date: 2026-08-11 ICT

Scope: add a backend-owned, resumable seven-day Marketing workflow that creates tenant-scoped draft
artifacts, enforces plan quota, runs through Brand Guardian review, and stops for one customer
approval without any external action.

## Public Source

- Backend repository: `https://github.com/kentzu213/izzi-backend`
- Backend master commit: [public CMR-112 commit](https://github.com/kentzu213/izzi-backend/commit/e6178bed6144553abcbbb6e90986c78f59907943)
- Migration: [reviewed SQL](https://github.com/kentzu213/izzi-backend/blob/e6178bed6144553abcbbb6e90986c78f59907943/migrations/20260811_marketing_seven_day_workflow.sql)
- Public API root: `/api/marketing/workspaces/:workspaceId/workflows`
- Remote database/VPS state changed: no

## Contract

- A valid start creates one run with five ordered steps and requires an idempotency key.
- Four resumptions complete brief, strategy, one campaign plus seven content drafts, and Brand
  Guardian review before the run waits for customer approval.
- Starter quota records one automation run and seven content items. The free plan is denied because
  its automation quota is zero.
- Only active owner/manager members can start or resume. Active owner/manager/reviewer members can
  approve or reject.
- The backend uses registry capability identities, while this slice creates deterministic draft
  content. Live model/agent execution remains a separate desktop integration task.
- Approval changes only internal resource state. No publish, send, spend, bulk, or integration
  mutation function exists in this migration.

## Verification

| Gate | Result |
|---|---|
| Workflow migration, service, and route tests | PASS, 15/15 |
| Marketing workspace/resource/workflow API neighborhood | PASS, 69/69 |
| Full backend suite with loopback placeholders | PASS, 324 passed and 40 skipped |
| TypeScript build | PASS |
| PostgreSQL 16 isolation and state-machine proof | PASS, 24/24 |
| Pinned PostgREST signed-JWT boundary | PASS, 12 checks |
| Staging contract self-test | PASS, 16 checks |
| Six-migration offline digest verifier | PASS at the linked public backend commit |
| Dependency audit | PASS, 0 vulnerabilities |
| Installed Izzi AI `1.14.0-beta.31` packaged smoke | PASS, 209 requests |

The packaged smoke suspended the running installed app, used an isolated local profile and
disposable PostgreSQL/PostgREST boundary, and relaunched Izzi AI afterward. Runtime errors were
zero, quota/billing reconciliation was consistent, the publish gate returned `policy_denied`, and
the request log contained no publish, spend, send, or bulk endpoint.

## Security Gate

- Every public RPC derives actor identity from `auth.uid()` and pins `search_path`.
- Workflow tables force RLS and revoke direct access from `anon` and `authenticated`.
- Public RPC execution is granted only to `authenticated`; direct raw workflow-table reads failed.
- HTTP routes run inside the validated JWT and actor rate-limit boundary and use bounded strict input
  schemas. Browser CORS explicitly allows the required `Idempotency-Key` header.
- The public response allowlists fields and excludes billing identity, actor identity, idempotency
  keys, metadata, system prompts, internal tool IDs, and service credentials.
- Cross-tenant get, resume, review, and raw-table requests were denied through signed PostgREST JWTs.

## Remaining Gate

No remote migration or deployment occurred. The installed Izzi AI workflow UI and live model/agent
execution are not yet connected to this API. Remote staging, two-device workflow proof, production
hard entitlement, and reviewed deployment allowlists remain open.
