# CMR-108 Backend Master Evidence

Date: 2026-08-11 ICT

Scope: verify the existing tenant-safe Customer Marketing backend feature, publish it to the
canonical `izzi-backend/master`, and keep remote database/VPS state unchanged.

## Public Source

- Repository: `https://github.com/kentzu213/izzi-backend`
- Master commit: `e901d43832c6b66748e064ce28b3c4cdd1ecf26b`
- Merge shape: fast-forward to the reviewed final tree from `3211308`; no auto-deploy workflow ran.
- Included contract: authenticated workspaces, members, invitations, quota reservations, profile
  revisions, capability catalog, campaigns, content, assets, knowledge, calendar, and analytics.

## Verification

| Gate | Result |
|---|---|
| Frozen install | PASS, 0 vulnerabilities |
| TypeScript build | PASS |
| Focused Customer Marketing route suites | PASS, 2/2 files and 59/59 tests |
| Full backend suite | PASS, 296 passed and 35 environment-dependent skipped |
| PostgreSQL 16 isolation | PASS, 19/19 checks |
| Pinned PostgREST JWT boundary | PASS, 10/10 checks |
| Staging verifier | PASS, 16 self-tests and offline release/digest contract |
| Packaged Izzi AI beta31 flow | PASS, runtime errors 0 and external actions false |
| Packaged beta31 two-device profile sync | PASS, revisions 1 -> 2 -> 4, one 409 conflict, retry 200 |
| Capability registry and plan/role filter | PASS, revision 3 and 20/20 focused tests |
| Full and production dependency audits | PASS, 0 known vulnerabilities |
| Docker build and local image smoke | PASS |

The final packaged beta31 flow synchronized onboarding at profile revision 1, saved Product Marketing
Context, approved one campaign and one scheduled content item, verified calendar and analytics,
produced a workflow receipt, and denied publish with `policy_denied`. The local receipt SHA-256 is
`5f0b6fc2bfd268de08cca00ad9b6e218f426ecb9fce6c873405cf879a0752e67`.

The two-device harness launched two packaged beta31 Electron sessions with independent Windows app,
local-app, temp, user-data, process, and CDP state against one ephemeral backend. Device B pulled
device A revision 1, wrote revision 2, and device A pulled that update. Two direct authenticated
updates then raced on revision 2: exactly one returned 200 and one returned
`409 profile_conflict`; the losing profile reloaded revision 3 and retried successfully to revision
4. The 87-request run had zero runtime errors and no publish, spend, bulk, or send endpoint. Its
receipt SHA-256 is `c9fbf3d18828840ada4a246238c114c0e8c6a9bebd6d1d234dac5f22163a32be`.

The existing single-device packaged regression also passed after the harness change: 205 requests,
profile revision 1, one approved campaign, one approved content item, workflow receipt, publish gate
`policy_denied`, zero runtime errors, and no external action. Its receipt SHA-256 is
`b5a0a207d46e5e1f61d2d4f35b7ebd14c6cbd45f32d9e3f6e94c04452113e377`.

The capability registry is server-owned at revision 3. Its public response contains only bounded
metadata, maps internal actions to public permissions, filters by the actor-scoped workspace plan
and role, keeps dry-run channel outputs, and fails closed for unknown plans or roles. The focused
registry suite covers all five plans, owner/manager/editor/reviewer/viewer roles, the local Voice
Studio preview contract, immutable snapshot behavior, and forbidden internal-key scans: `20/20`.

The release image reported the exact full Git SHA. Local probes returned liveness 200, readiness
503 against an intentionally invalid Supabase target, and unauthenticated Marketing Workspace 401
with `Cache-Control: no-store`.

## Security Gate

- Actor identity comes from validated JWTs, never from request JSON.
- Customer RPC calls use a public Supabase key plus the validated bearer token; there is no
  service-role fallback.
- Marketing tables force RLS, direct authenticated table grants are revoked, and authenticated
  RPC facades bind to `auth.uid()` with explicit `public, pg_temp` search paths.
- Profile and resource writes use optimistic revisions; cross-tenant reads/writes and invalid or
  expired JWTs were denied in the real PostgREST boundary.
- Inputs, arrays, URLs, bodies, tokens, and response fields are bounded or allowlisted. No secret
  pattern or sensitive-token logging was found in the feature diff.
- Every authenticated workspace/resource route now shares a 300 request/minute actor limit. Redis
  provides the distributed window when available; a bounded local window remains active when Redis
  fails open. Invalid JWTs never create an actor rate-limit key, and denied requests do not dispatch
  to Customer Marketing services.

## Remaining Gate

No migration was applied remotely, no staging/VPS container was restarted, and no customer data
changed. Remote proof still requires a dedicated staging Supabase project, reviewed host allowlist,
immutable image/backup IDs, distributed rate-limit observability, and two-device authenticated smoke.
