# CMR-114 Seven-Day Workflow Desktop Evidence

Date: 2026-08-11 ICT

Scope: connect the installed Izzi AI Customer Marketing goal and approval flow to the public
backend-owned seven-day workflow API, while keeping the production remote flag disabled until the
reviewed migration is deployed.

## Public Source

- Desktop repository: `https://github.com/kentzu213/izzi-ai`
- Desktop commit: [public CMR-114 commit](https://github.com/kentzu213/izzi-ai/commit/58076df)
- Backend repository: `https://github.com/kentzu213/izzi-backend`
- Backend route-order fix and staging harness: [public commit](https://github.com/kentzu213/izzi-backend/commit/5d35362)
- Desktop release candidate: `1.14.0-beta.32`
- Remote database/VPS state changed: no

## Contract

- The existing AI Marketing goal IPC calls backend `start`, then resumes up to four optimistic
  revisions until Brand Guardian and customer approval are pending.
- The backend UUID becomes the local durable workflow ID; no renderer-supplied actor, workspace,
  plan, billing, or workflow state is trusted.
- Approval performs a fresh backend GET, reviews the backend revision, then completes local durable
  state. A revision race is re-read and accepted only when the requested final status is confirmed.
- Quota, permission, malformed response, route, and network errors fail closed before local workflow
  creation or local approval mutation.
- The production remote flag remains disabled because no remote migration or deployment has occurred.

## Verification

| Gate | Result |
|---|---|
| Workflow client + service focused tests | PASS, 225/225 |
| IPC and Customer Marketing contract tests | PASS, 74/74 |
| Full Customer Marketing suite | PASS, 565/565 |
| Full desktop regression | PASS, 1,272/1,272 across 88 files |
| Main typecheck and production Vite build | PASS |
| Renderer bundle budget | PASS, 2/2; entry 355.26 kB |
| Desktop production dependency audit | PASS, 0 vulnerabilities |
| Backend full suite with loopback placeholders | PASS, 325 passed and 40 skipped |
| Backend route regression tests | PASS, 22/22 focused route/resource tests |
| Installed beta32 packaged local staging | PASS, 271 requests |

The beta32 executable was built from the public desktop commit, exercised against disposable local
PostgreSQL/PostgREST staging, and installed over the existing Windows installation with installer
exit code `0`. The smoke created one backend workflow, resumed four steps, reached one pending
approval, approved it, and mirrored the final state into the desktop snapshot. The database ended
with two approved campaigns and eight approved content items. Nine quota/ledger events reconciled
with no discrepancy. Runtime errors were zero and no publish, send, spend, bulk, or external action
ran; the publish gate remained `policy_denied`.

## Security Gate

- The main process alone owns the bearer token and backend workspace ID.
- API responses are exact-key parsed and allowlisted; internal prompts, credentials, billing data,
  actor IDs, and metadata are rejected before renderer exposure.
- The backend workflow route is mounted before the generic resource route so a workflow GET cannot be
  misclassified as a resource request.
- Local approval never completes unless the backend confirms the matching final decision.

## Remaining Gate

No remote migration, staging deployment, production flag enablement, or external marketing action
occurred. Live model execution remains separately quota-guarded; this slice verifies the workflow
bridge and deterministic backend drafts. Approved social, SEO, email/CRM, analytics integrations,
and production staging approval remain open.
