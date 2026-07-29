# Loop 07 - Capability registry and package adapters

**Status:** `READY_FOR_REVIEW`
**Branch:** `feature/personal-office-loop-07-20260729`
**Worktree:** `F:\Ai Tools\_wt-starizzi-personal-office-loop07`
**Canonical base:** `4fa9e1d`
**Dispatch commit:** `b0601e0`
**Lease:** `LEASE-L07-CAPABILITY-ADAPTERS-20260729`

| Phase | Commit | Scope |
| --- | --- | --- |
| Implementation | `767fb57` | Shared contract, strict parser, trusted policy catalog, audited registry, invocation/approval gates, `.ocx` and `.oab` adapters, tests and product documentation |
| Handoff | this commit | Worklog, machine-readable handoff and one precise unleased-seam change request |

## Outcome

Loop 07 now provides a deterministic, versioned and auditable capability
registry for installed extension and agent-bundle declarations.

The registry wraps the accepted `SkillPackage` and `ToolDefinition` entities.
It does not redefine `IntegrationGrant`, `RuntimeInstance` or any other Personal
Office domain entity. Manifest-controlled envelopes contain identity and
declaration keys only. Exact permission, trust-zone, classification,
side-effect, risk and allow/block decisions come from the host-owned policy
catalog.

The Loop 03 bridge is a pure adapter that builds `RequestApprovalInput` for
side-effecting capabilities. It does not execute an effect or replace
`WorkService` hashing, redaction, persistence or decision authority.

## Fail-closed decisions

- Unknown manifest fields, schema versions and adapter versions are rejected.
- Duplicate packages, declarations, tools and permissions are rejected.
- Wildcard manifest permissions and wildcard trusted policies are rejected.
- Unknown declarations are rejected.
- Known ambient-authority declarations remain visible but blocked with an
  audit reason.
- `.oab` schedules, automatic workflows, triggers, platform grants, required
  APIs and incoming webhooks remain unsupported declarations and reject the
  package until an explicit scoped policy exists.
- Network capability data is limited to freely egressable
  `public_metadata`.
- Exact permissions are required at invocation. A wildcard grant does not
  satisfy an exact capability permission.
- The registry digest and every per-capability fingerprint are rechecked
  before authorization. A tampered snapshot is denied with `AUDIT_INVALID`.
- Managed `.ocx` services produce an explicit
  `runtime.local_service` permission request only after the existing
  namespace/path/loopback validator passes. Invocation still requires an
  exact grant and a Loop 03 approval.

## Socrates challenge

The required Socrates and orchestrator role spawns were attempted before
implementation. Both returned the exact tool error `agent thread limit
reached`. W0 directed this producer to continue with equivalent in-process
checks and stated that an independent Socrates/reviewer pass would run after
the implementation commit when capacity became available.

The in-process challenge asked:

1. Can a manifest define its own authority? No. It may name declarations only.
2. Can package-wide permissions be copied onto every command? No. The registry
   admits primitive host capabilities through exact policy mappings.
3. Can unknown automation or integration declarations be ignored? No. They are
   retained and reject admission.
4. Can a broad terminal or filesystem permission be treated as scoped? No.
   Those declarations are blocked until command/path/environment scope exists.
5. Can a serialized registry be trusted by type alone? No. Invocation verifies
   canonical fingerprints and the snapshot digest.
6. Can a local service silently inherit process authority? No. It receives a
   separate derived runtime permission and approval requirement.
7. Can current time enter adapter output implicitly? No. `observedAt` is an
   explicit audited input.

Decision: **PASS_FOR_W0_REVIEW**. The independent W0 review remains the
acceptance authority.

## Verification

| Check | Result |
| --- | --- |
| Targeted capability tests | **PASS**, 4 files / 17 tests |
| Full desktop tests | **PASS**, 85 files / 1069 tests |
| Desktop production build | **PASS**, 1167 modules transformed |
| Main/shared TypeScript | **PASS**, `tsc -p tsconfig.main.json --noEmit` |
| Agent-bundle TypeScript | **PASS**, package `tsc --noEmit` |
| Agent-bundle dual build | **PASS**, CommonJS and ESM |
| Targeted lint | **PASS**, zero findings |
| `git diff --check` | **PASS** |
| Ownership/prohibited audit | **PASS**, 16/16 implementation files inside the lease |
| Production secret scan | **PASS**, no matches |
| Test-fixture secret scan | **PASS with fixture**, one deliberate fake `sk-...` validation tripwire |
| GitNexus staged change detection | **PASS**, low risk, 16 files, zero indexed symbols/processes |

The worktree initially had no installed toolchain. Verification used temporary
directory junctions to the baseline's existing `node_modules` directories, so
no dependency installation or manifest change occurred. All three junctions
were verified as junctions and removed before the scope audit and commit.

The first cleanup command was rejected by the shell safety layer before
execution. Each exact junction was then removed without recursive traversal.

The local `.npmrc` emitted an unset `${NODE_AUTH_TOKEN}` placeholder warning.
No token value was available, printed or required, and no install ran.

CodeGraph was unavailable because this linked worktree is not initialized.
GitNexus is registered for the accepted baseline, not the Loop 07 worktree.
Baseline impact showed `ToolDefinition` as MEDIUM (3 direct, 34 total) and
`AgentBundleManifest` as LOW (4 direct), so both stayed read-only. Staged
change detection used the baseline index plus the explicit Loop 07 worktree and
reported low risk with no affected process.

## Security gate

`SECURITY GATE: untrusted package manifests / permissions / classifications /
side effects / secrets / external actions`

Decision: **PASS_FOR_W0_REVIEW**.

Controls:

- strict plain-object and exact-key parsing;
- explicit schema and adapter versions;
- credential-shaped public metadata rejection;
- exact non-wildcard permissions;
- fixed `extension_package` trust zone;
- allow/block policy with required block reason;
- classification and egress enforcement;
- immutable canonical fingerprints and registry digest;
- atomic admission with no partial registry;
- side effects translated to Loop 03 approvals without execution;
- publisher digest carried as metadata only; signature verification remains a
  later execution-plane responsibility.

## Ownership

Implementation changed only:

- `apps/desktop/src/shared/capabilities/**`
- `apps/desktop/src/main/capabilities/**`
- `packages/agent-bundle/src/adapters/**`
- `docs/product/personal-office-capabilities.md`

This handoff phase adds only:

- `worklogs/personal-office-loop-07.md`
- `docs/handoffs/personal-office/loop-07.json`
- `docs/handoffs/personal-office/change-request-loop-07-agent-bundle-export.md`

No renderer, database, Electron index/preload, accepted contract, manifest,
package, lockfile, GitNexus-managed file or quarantine path changed.

## Skill audit

- `/search-first`: used to locate accepted domain, permission, validator and
  approval patterns before building.
- `/context-gatherer`: used for lease, ADR, manifest, test and toolchain
  evidence.
- `/quick-spec`: used to freeze scope, non-goals, scenarios and checks.
- `/backend-patterns`: used for strict boundary validation, policy/service
  separation, immutable output and explicit errors.
- `/security-review`: used for ambient-authority, egress, secret, tamper and
  side-effect gates.
- `/verification-loop`: used for targeted/full tests, builds, typechecks,
  lint, scope, secret and diff checks.
- `/understand-codebase`: used to map contract, package, extension and Loop 03
  dependency direction.
- `/frontend-patterns`: applied as a boundary check. No renderer or UI state
  was introduced.
- `/deployment-patterns`: applied as a release guard. No deploy, install or
  production mutation ran.
- `Design`, `/gpt-taste`, `/design-taste-frontend`,
  `/stitch-design-taste`: read and applied as scope guards. The design read was
  "non-visual security registry"; no visual surface was authorized, and the
  product document uses a single clear information hierarchy.

## Residuals and handoff

- `packages/agent-bundle/src/index.ts` is outside the lease, so the adapter is
  not yet exported from the package root. The precise change request in this
  handoff asks W0 for that one barrel seam and names its proof.
- Runtime install/load wiring remains outside this loop's lease. Consumers
  should call the adapter after manifest validation and call the invocation
  gate before grant/use.
- W0 should independently review `767fb57`, rerun the capability test/build
  gates on integration, verify hashes and exact paths, decide the barrel change
  request, and then create `acceptance/loop-07.json` or return concrete
  findings.

`READY_FOR_REVIEW` is a producer status only. It is not `ACCEPTED`.
