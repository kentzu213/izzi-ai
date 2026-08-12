# CMR-116 Per-Run Billing Linkage Evidence

Date: 2026-08-12 ICT
Reviewer: Nguyen Nghia

## Public Source

- Backend repository: `https://github.com/kentzu213/izzi-backend`
- Backend master commit: [public CMR-116 commit](https://github.com/kentzu213/izzi-backend/commit/ee81b5376e2d860a485e44ed3bbff69d8d96d336)
- Migration: [reviewed SQL](https://github.com/kentzu213/izzi-backend/blob/ee81b5376e2d860a485e44ed3bbff69d8d96d336/migrations/20260811_marketing_per_run_billing_linkage.sql)
- Remote database/VPS state changed: no
- Desktop product bytes changed: no; beta33 remains the installed public build

## Result

Every Marketing quota usage event now receives a billing owner and deterministic reference inside
PostgreSQL. Existing rows are backfilled before both fields become required. The authenticated
reconciliation receipt exposes only linkage status and counts; it does not expose billing identity,
raw references, actor identity, idempotency keys, transaction details, or metadata.

The replacement RPC remains bound to `auth.uid()`, active owner/manager membership, a pinned
`search_path`, and an `authenticated`-only execute grant. Authenticated users retain no direct table
privilege. This slice adds no balance deduction, billing transaction, usage-log charge, publish,
spend, send, bulk action, secret, or production feature flag.

## Verification

| Gate | Result |
|---|---|
| Focused migration/service/route tests | PASS, 84/84 |
| Full backend suite with synthetic placeholders | PASS, 328 passed and 40 DB-backed skips |
| TypeScript build | PASS |
| PostgreSQL 16 isolation | PASS, 24/24 |
| Pinned PostgREST signed-JWT boundary | PASS, 12 checks |
| Seven-migration staging contract | PASS, 16 checks |
| Production dependency audit | PASS, 0 vulnerabilities |
| Independent security review | PASS, no confirmed finding |
| Installed beta33 packaged local staging | PASS, 273 requests and 0 runtime errors |

The packaged smoke produced nine usage events with nine server-derived links and zero unlinked
events. Quota and billing reconciliation were consistent. Publish remained `policy_denied`, the
request log contained no publish, spend, send, or bulk endpoint, and `externalActionPerformed`
remained `false`.

## Remaining Gates

No remote migration or deployment occurred. Hard plan entitlement across all Marketing
capabilities, dedicated remote staging, live model execution, token vaulting, connectors, scheduler
recovery, publish/spend end-to-end gates, and production canary approval remain open.
