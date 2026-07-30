# Loop 04 — Live profile, vault and MyGraph

Status: READY_FOR_REVIEW
Base: `4fa9e1d`
Lease: `LEASE-L04-LIVE-VAULT-GRAPH-20260729`

## Outcome

Implemented a workspace/owner-scoped Live.md payload, typed local persistence,
vault/wikilink plans and a pure MyGraph projection. No IPC, database, preload,
App, shell or work-engine seam was changed.

Durable profile changes require the exact owner and expected revision. Agents
can create pending proposals only. Per-source learning is off by default;
acceptance rechecks current consent, while revocation still permits rejection.
Invalid runtime decisions fail closed. Temporary directives expire and reveal
the prior lower-precedence truth.

The file service exposes typed mutations, uses a per-document exclusive lock
and atomically replaces the fenced payload while preserving surrounding
Markdown. Vault paths reject traversal, absolute/network paths, unsafe Windows
names and characters. Graph projection preserves scope, classification,
revision, timestamps, proposal/source provenance and expiry; `local_files`
content cannot egress.

## Commits

- `dd163762590881d00e834ac0c519121fc7216c9a` — implementation and tests.
- `b2c65260e7778b9859cb80a09b3299813188bdfc` — product-doc formatting.
- `c2551f180dca9eb241f2ba79b5ae0c5d27a30c05` — Socrates corrections.

## Verification

- Targeted Vitest: 6 files, 40/40 passed with `--no-cache`.
- Full producer desktop suite before final correction: 87 files, 1091/1091
  passed; the final correction is covered by the targeted suite.
- Isolated TypeScript source check: passed.
- Targeted ESLint via accepted baseline config/toolchain: passed, zero findings.
- `git diff --check`: passed.
- Ownership: exactly 13 implementation/artifact paths, all inside the amended
  Loop 04 lease; no prohibited/hot/package/DB/schema path.
- Secret/process scan: production files clean; credential-shaped values exist
  only in rejection fixtures.
- GitNexus compare: 14 files observed including dispatch, zero indexed changed
  symbols/processes because the Loop 04 modules are new; risk reported low.

## Socrates review

Initial verdict was CHANGES_REQUIRED:

1. accepting a learned proposal did not recheck current consent;
2. invalid runtime decision values fell through to acceptance.

Both were fixed in `c2551f1`; regression tests passed. Final verdict: PASS.

## Residuals

- Canonical-path/symlink authorization belongs at the future arbitrary-root
  picker boundary.
- A crash can leave a stale lock file; recovery policy belongs to later runtime
  wiring.
- Expired graph facts may remain as historical nodes; consumers must honor
  expiry metadata.
- Full build and integration-wide verification remain W0 acceptance duties.

## Process audit

Socrates challenged security assumptions; orchestrator kept the scope bounded;
builder implementation stayed inside the lease. `/search-first`,
`/context-gatherer`, `/quick-spec`, `/backend-patterns`, `/security-review`,
`/verification-loop` and `/understand-codebase` were used directly.
`/frontend-patterns`, `/deployment-patterns`, `Design`, `/gpt-taste`,
`/design-taste-frontend` and `/stitch-design-taste` were applied as boundary
checks: this loop intentionally added no mounted UI or deployment behavior.
