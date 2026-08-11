# CMR-108 Backend Master Evidence

Date: 2026-08-11 ICT

Scope: verify the existing tenant-safe Customer Marketing backend feature, publish it to the
canonical `izzi-backend/master`, and keep remote database/VPS state unchanged.

## Public Source

- Repository: `https://github.com/kentzu213/izzi-backend`
- Master commit: `187e458be40cc96ee9310f726d700bcf831d7289`
- Merge shape: fast-forward by three reviewed commits from `3211308`; no auto-deploy workflow ran.
- Included contract: authenticated workspaces, members, invitations, quota reservations, profile
  revisions, capability catalog, campaigns, content, assets, knowledge, calendar, and analytics.

## Verification

| Gate | Result |
|---|---|
| Frozen install | PASS, 0 vulnerabilities |
| TypeScript build | PASS |
| Focused Customer Marketing suites | PASS, 8/8 files and 161/161 tests |
| Full backend suite | PASS, 292 passed and 35 environment-dependent skipped |
| PostgreSQL 16 isolation | PASS, 19/19 checks |
| Pinned PostgREST JWT boundary | PASS, 10/10 checks |
| Staging verifier | PASS, 16 self-tests and offline release/digest contract |
| Packaged Izzi AI beta31 flow | PASS, runtime errors 0 and external actions false |
| Full and production dependency audits | PASS, 0 known vulnerabilities |
| Docker build and local image smoke | PASS |

The packaged beta31 flow synchronized onboarding at profile revision 1, saved Product Marketing
Context, approved one campaign and one scheduled content item, verified calendar and analytics,
produced a workflow receipt, and denied publish with `policy_denied`. The local receipt SHA-256 is
`570bdde502210ccdd43b2389ce6ce10ba14b5eba6a24a9fe21599debc91f8735`.

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

## Remaining Gate

No migration was applied remotely, no staging/VPS container was restarted, and no customer data
changed. Remote proof still requires a dedicated staging Supabase project, reviewed host allowlist,
immutable image/backup IDs, dashboard-route rate-limit review, and two-device authenticated smoke.
