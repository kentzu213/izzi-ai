# Loop 11 — runtime manager and isolated browser foundation

**Status:** `READY_FOR_REVIEW`  
**Branch:** `feature/personal-office-loop-11-20260729`  
**Canonical base:** `c562c7f45e72c6de5c2f93b259c04c11d63e7b73`  
**Implementation:** `d1a1d152597bec8a1d172075c18145aea91fea4d`  
**Lease:** `LEASE-L11-RUNTIME-BROWSER-20260729`

## Outcome

Loop 11 adds a fail-closed execution foundation for managed local runtimes and
an isolated browser proof of concept. Production wiring registers no execution
adapter and uses a deny-all runtime authorizer. The browser driver remains an
injected test seam; `browser.automation` is not enabled.

Runtime specifications are versioned and identity-bound to tenant, user,
workspace, package, integration, grant and optional run. Package trust and the
live exact-scope `IntegrationGrant` must come from an injected main-process
resolver. Caller-provided trust booleans or grant read models are not part of
the shared runtime contract.

Native execution requires an absolute verified executable, literal argv,
`shell:false`, an explicit secret-ref environment and no host-environment
inheritance. Paths are checked after realpath resolution, ports are loopback
only, and egress plus every browser redirect/final URL is allowlisted.

Browser storage state is encrypted and keyed by a canonical hash of
tenant/user/workspace/package/integration/grant/storage-state identity. The
safe POC reads an allowlisted endpoint, creates a draft artifact and Work
approval, then submits only the persisted approved binding projection. A
file-backed atomic effect claim prevents duplicate effects and records
uncertain outcomes rather than retrying blindly.

## Security review corrections

Independent Socrates and security reviews repeatedly sent the implementation
back until these issues were closed:

- browser prepare and execute now authorize before opening a driver or claiming
  an effect;
- package trust and live grant evidence come only from a trusted resolver;
- browser state is isolated across tenant, user, grant and storage reference;
- health/trace/screenshot details redact bearer tokens, cookies and named
  credentials using Work redaction;
- approval execution cannot substitute a body after consent;
- the real `WorkServiceRuntimePort` normalization is tested with `node:sqlite`;
- execution submits the persisted approved projection, never caller bytes;
- caller and persisted bindings reject `_redacted`, `constructor`, `prototype`
  and `__proto__` collisions, including array-root/nested tampering;
- runtime health visibility is filtered by exact tenant/user/workspace scope,
  while current production wiring exposes no scopes.

Final independent decisions: **security PASS** and **Socrates PASS** on
`d1a1d15`.

## Verification

- Targeted Vitest via the canonical toolchain: **PASS**, 9 files / 50 tests,
  `--no-cache`.
- Covered traversal/junction escape, command/control-character injection,
  unverified executable, no host env inheritance, non-loopback bind, egress and
  redirect escape, encrypted-state plaintext absence, credential-field refusal,
  exact live grant/package trust/run binding, cross-authority state isolation,
  approval bypass/replay/substitution, persisted-binding tampering,
  WorkService normalization, crash-to-uncertain behavior, redaction and
  tenant/user/workspace health filtering.
- Changed-source TypeScript transpilation during implementation: **PASS**, zero
  syntax diagnostics.
- `git diff --check`: **PASS**.
- Ownership/prohibited-path audit: **PASS**, 33 implementation paths, all inside
  the lease; no package/lockfile, DB/schema or customer-marketing change.
- Production-source secret scan: **PASS**.
- GitNexus compare: **CRITICAL review scope**, 10 changed indexed symbols and 19
  affected flows because additive edits touch `setupIPC`, `initServices`,
  preload and `ShellSettingsPanel`. This requires full canonical verification;
  it is not claimed as low risk.
- Producer main/renderer typecheck, full desktop tests, production build and
  repository lint are intentionally **not claimed**. The producer lacks a local
  dependency tree; a temporary junction gate was rejected before execution.
  W0 must run these checks after exact-path integration on canonical.

## Two-phase provenance

Phase 1 commit `d1a1d15` contains exactly the 33 implementation/test/architecture
paths. The handoff records SHA-256 and byte counts from exact Git blob bytes at
that commit. Phase 2 contains only this worklog and
`docs/handoffs/personal-office/loop-11.json`.

## Roles and skills

- Socrates: used for preflight and repeated final challenge.
- orchestrator: used by the control thread for lease, sequencing and gates.
- builder: Codex was the only writer; Kiro had no writer authority.
- `/search-first`: used to reuse Work redaction, canonical hashing, grant
  validation, LocalServiceManager and Work approval patterns.
- `/context-gatherer`: used read-only before implementation and each correction.
- `/understand-codebase`: used for main/preload, Work, grant, extension and shell
  flows.
- `/quick-spec`: the W0 dispatch froze scope, invariants and non-goals.
- `/backend-patterns`: used for injected adapters/resolvers and lifecycle ports.
- `/frontend-patterns`: used for the read-only accessible health component.
- `/deployment-patterns`: used for lifecycle, cleanup, fail-closed production
  wiring and rollback boundaries.
- `/security-review`: used with independent send-backs and final PASS.
- `/verification-loop`: used for tests, diff, ownership, secrets and impact.
- `Design`, `/gpt-taste`, `/design-taste-frontend`,
  `/stitch-design-taste`: `BOUNDARY_ONLY`; the health panel extends the existing
  shell design and adds no redesign, hero, dependency or new visual system.

## Residual boundary

No production browser driver, runtime adapter, package trust resolver, live
grant store adapter, external account automation or real effect is enabled.
Future enablement requires a new exact lease, authoritative authenticated
scope, independent security review and production-safe sandbox evidence.

`READY_FOR_REVIEW` is not `ACCEPTED`; W0 remains the only acceptance authority.
