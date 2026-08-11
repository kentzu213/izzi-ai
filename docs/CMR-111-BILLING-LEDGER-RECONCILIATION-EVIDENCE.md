# CMR-111 Billing-Ledger Reconciliation Evidence

Date: 2026-08-11 ICT

Scope: extend the existing owner/manager quota-reconciliation receipt with an aggregate view of the
workspace billing owner's real `profiles.balance`, contributing `transactions`, and current-cycle
`usage_logs`. Marketing quota units remain separate from monetary/API credit values.

## Public Source

- Backend repository: `https://github.com/kentzu213/izzi-backend`
- Backend master commit: [public CMR-111 commit](https://github.com/kentzu213/izzi-backend/commit/2a3b18ec96a4af2316490c7a8cda1fea16e2a825)
- Migration: [reviewed SQL](https://github.com/kentzu213/izzi-backend/blob/2a3b18ec96a4af2316490c7a8cda1fea16e2a825/migrations/20260811_marketing_billing_ledger_reconciliation.sql)
- Public API: `GET /api/marketing/workspaces/:workspaceId/quota/reconciliation`
- Remote database/VPS state changed: no

## Contract

- Expected balance uses completed deposits plus bonuses, affiliate credit conversions, and negative
  usage transactions, matching the existing backend reconciliation formula.
- A delta is consistent when its absolute value is at most `0.01`.
- Current-cycle usage-log event count, cost, grace-period count, and last event time are aggregate only.
- The API exposes no billing user ID, transaction ID, user ID, description, reference ID, endpoint,
  source platform, idempotency key, or metadata.
- `quotaBillingLinkage` is `unavailable`; quota units are not equated with billing currency or API cost.

## Verification

| Gate | Result |
|---|---|
| Red/green focused migration, service, and route tests | PASS, 85/85 |
| Full backend suite with loopback placeholders | PASS, 309 passed and 38 skipped |
| TypeScript build | PASS |
| PostgreSQL 16 isolation and drift proof | PASS, 22/22 |
| Pinned PostgREST signed-JWT boundary | PASS, 11 checks |
| Staging contract self-test | PASS, 16 checks |
| Five-migration offline digest verifier | PASS at the linked public backend commit |
| Full and production dependency audits | PASS, 0 vulnerabilities |
| Installed Izzi AI `1.14.0-beta.31` packaged smoke | PASS, 209 requests |

The packaged smoke used an isolated local profile and disposable PostgreSQL/PostgREST boundary. It
created one tenant workspace, approved one campaign and one content item, produced one workflow
receipt, and denied publish with `policy_denied`. Billing balance and Marketing quota reconciliation
were both consistent, runtime errors were zero, and the request log contained no publish, spend,
send, or bulk endpoint. The installed Izzi AI application was relaunched after the isolated run.

## Security Gate

- SQL actor identity comes from `auth.uid()`; only active owner/manager members can execute the RPC.
- The billing account comes from the server-owned workspace `billing_user_id`, never request input.
- The definer function pins `search_path` and grants execution only to `authenticated`.
- The route and service independently validate and allowlist every public aggregate field.
- Cross-tenant reconciliation failed at the signed-JWT PostgREST boundary.
- No secret value was read, printed, written, or committed.

## Remaining Gate

No remote migration or deployment occurred. A trustworthy per-run link requires a server-derived
Marketing run identifier in the billing usage path. Hard plan entitlement enforcement, staging
allowlist approval, immutable backup/image IDs, and remote two-device proof remain open.
