# Loop 10 — integration grants and grant-vault boundary

**Status:** `READY_FOR_REVIEW`
**Branch:** `feature/personal-office-loop-10-20260729`
**Base:** `93cc3b11149b99854237fd2890a4cec993de29c1`
**Implementation:** `0528fbb1c30998a08292ada990d66f72fd3fdd21`
**Lease:** `LEASE-L10-INTEGRATION-GRANTS-20260729`

## Outcome

Loop 10 adds a strict, secret-free integration-grant read model, deterministic
legacy-state mapping, an injected no-value grant-vault facade and plan-only
revocation contracts.

`IntegrationGrant` remains schema version 1 and gains only optional
`lastErrorAt` and `invalid` evidence. Active state requires an exact live grant,
an integration-vault `SecretRef`, exact least-privilege scopes and resolver
evidence. No raw credential or legacy error string is retained.

## Security correction

The first independent Socrates/security review returned `SEND_BACK`: tenant and
user were syntactically valid but could be relabeled because they are not stored
on the canonical grant.

The correction requires a trusted `expectedScope` for mapping, deserialization
and revocation, covering tenant, user, workspace, grant, integration and exact
sorted scopes. `GrantVault` also asks an injected `GrantScopeAuthority` and
compares claimed versus authoritative scope before the resolver can run.

Independent re-review returned `PASS`.

## Verification

- Targeted Vitest: **PASS**, 3 files / 26 tests, `--no-cache`.
- Main TypeScript: **PASS**.
- Renderer-compatible shared TypeScript: **PASS** under strict ESNext/bundler,
  isolatedModules and DOM profile.
- Targeted ESLint: **PASS**, zero findings.
- Ownership/prohibited/schema audit: **PASS**, exactly 12 implementation paths
  inside the lease; `personal-office/version.ts` unchanged.
- Secret and side-effect scans: **PASS**.
- GitNexus pre-change impact: MEDIUM for the additive shared interface; staged
  detect: LOW, no affected execution process. New files are outside the stale
  baseline symbol index.
- `git diff --check`: **PASS**.

Verification used two temporary, read-only NTFS junctions to the accepted
baseline toolchain. Vitest cache was disabled. Both junctions were verified
before use and removed afterward. No install, manifest, lockfile or tracked
integration change occurred.

## Two-phase provenance

Phase 1 commit `0528fbb` contains exactly the 12 implementation/test/product
paths. The blob manifest in `loop-10.json` was calculated from exact Git blob
bytes at that commit. Phase 2 contains only this worklog and the handoff JSON,
so source bytes remain immutable.

## Roles and skills

Socrates, orchestrator and builder roles were used. The work applied
`/search-first`, `/context-gatherer`, `/quick-spec`, `/backend-patterns`,
`/security-review`, `/verification-loop` and `/understand-codebase` directly.
`/deployment-patterns` enforced no install/deploy/network/runtime mutation.
`/frontend-patterns`, `Design`, `/gpt-taste`, `/design-taste-frontend` and
`/stitch-design-taste` were applied as naming/product-copy or no-renderer
boundary checks because this loop produces no UI.

## Residual boundary

There is no operational OAuth, persistence, IPC, production
`IntegrationsService` adapter, credential deletion or remote disconnect here.
Future wiring must obtain a new exact lease, source scope from authenticated
host/workspace authority and consume these validated contracts unchanged.

`READY_FOR_REVIEW` is not `ACCEPTED`; W0 remains the only acceptance authority.
