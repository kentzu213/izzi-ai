# Loop 07 - Capability registry and package adapters

**Status:** `READY_FOR_REVIEW`
**Branch:** `feature/personal-office-loop-07-20260729`
**Worktree:** `F:\Ai Tools\_wt-starizzi-personal-office-loop07`
**Canonical base:** `4fa9e1d`
**Dispatch commit:** `b0601e0`
**Lease:** `LEASE-L07-CAPABILITY-ADAPTERS-20260729`

| Phase | Commit | Scope |
| --- | --- | --- |
| Initial implementation | `767fb57` | Shared contract, strict parser, trusted policy catalog, audited registry, invocation/approval gates, `.ocx` and `.oab` adapters, tests and product documentation |
| Initial handoff | `99cf376` | Worklog, machine-readable handoff and one precise unleased-seam change request |
| Correction implementation | `cf3b25a` | Resolve four blocking security findings with trusted-policy audit reconstruction, accepted-grant binding, approval action-hash identity and managed-service allowlists |
| Correction handoff | this commit | Update the handoff and worklog to `READY_FOR_REVIEW`; the existing change request remains unchanged |

## Outcome

Loop 07 now provides a deterministic, versioned and auditable capability
registry for installed extension and agent-bundle declarations. The corrected
serialized registry version is `1.1.0`; older `1.0.0` snapshots fail closed.

The registry wraps the accepted `SkillPackage` and `ToolDefinition` entities.
It does not redefine `IntegrationGrant`, `RuntimeInstance` or any other Personal
Office domain entity. Manifest-controlled envelopes contain identity and
declaration keys only. Exact permission, trust-zone, classification,
side-effect, risk and allow/block decisions come from the host-owned policy
catalog.

The Loop 03 bridge is a pure adapter that builds `RequestApprovalInput` for
side-effecting capabilities. It does not execute an effect or replace
`WorkService` hashing, redaction, persistence or decision authority. Capability,
policy and registry identity now lives inside Loop 03's hashed input and
estimated-side-effect fields rather than only in human-readable copy.

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
- Caller-owned permission strings are never authorization. Invocation requires
  a trusted resolver result backed by an accepted `IntegrationGrant` with exact
  tenant, user, workspace, package, capability and permission bindings.
- The registry digest and every per-capability fingerprint are rechecked before
  authorization, and authority-bearing fields are re-derived from the trusted
  policy catalog. Recomputing public hashes after changing permissions or
  versions remains `AUDIT_INVALID`.
- Managed `.ocx` services produce an explicit
  `runtime.local_service` permission request only after the existing
  namespace/path/loopback validator passes. Invocation still requires an
  exact grant and a Loop 03 approval. Only the host-controlled Docker Compose
  launch form is admitted; Node/binary commands, hidden commands and arbitrary
  fallback environment names fail closed.

## Independent review correction

W0's independent Socrates/security probe returned `CHANGES_REQUIRED` after the
initial handoff. Commit `cf3b25a` resolves every blocking finding:

1. **Self-authenticating registry audit:** verification now enforces supported
   schema/registry/adapter versions, exact object shapes and package/capability
   relationships, then reconstructs permission, trust, classification, side
   effects, risk, policy version and `policyFingerprint` from the trusted host
   catalog. Permission and version mutations stay rejected after every public
   hash is recomputed.
2. **Caller-owned authorization:** `grantedPermissions` is removed from the
   invocation request. A trusted main-process resolver must return an accepted
   `IntegrationGrant` bound exactly to tenant, user, workspace, package,
   capability and permission. Cross-workspace, cross-tenant, wildcard,
   malformed and forged grants are regression-tested.
3. **Approval identity omission:** the audited snapshot is now an approval
   adapter input. Capability id/fingerprint, required permission, policy
   version/fingerprint and registry version/digest are included in hashed
   fields. Changing any of them changes the action hash and invalidates the old
   binding.
4. **Broad managed-service execution:** `.ocx` Node/binary service commands and
   hidden Docker Compose commands are rejected. Fallback variables must be the
   exact package-bound `BACKEND_URL` or `BASE_URL`; `NODE_AUTH_TOKEN` is rejected.

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
5. Can a serialized registry be trusted by type or recomputed hashes alone? No.
   Verification reconstructs authority from the trusted catalog, and invocation
   separately requires an accepted exact-scope grant.
6. Can a local service silently inherit process authority? No. It receives a
   separate derived runtime permission and approval requirement.
7. Can current time enter adapter output implicitly? No. `observedAt` is an
   explicit audited input.

Decision after correction: **PASS_FOR_W0_REVIEW**. W0 remains the only
acceptance authority.

## Verification

| Check | Result |
| --- | --- |
| Targeted capability tests | **PASS**, 4 files / 25 tests |
| Full desktop tests | **PASS**, 85 files / 1077 tests |
| Desktop production build | **PASS**, 1167 modules transformed |
| Main/shared TypeScript | **PASS**, `tsc -p tsconfig.main.json --noEmit` |
| Agent-bundle TypeScript | **PASS**, package `tsc --noEmit` |
| Agent-bundle dual build | **PASS**, CommonJS and ESM |
| Targeted lint | **PASS**, zero findings |
| `git diff --check` | **PASS** |
| Ownership/prohibited audit | **PASS**, 16/16 original files and 10/10 correction files inside the lease |
| Production secret scan | **PASS**, no matches |
| Test-fixture secret scan | **PASS with fixture**, one deliberate fake `sk-...` validation tripwire |
| GitNexus staged change detection | **PASS**, correction low risk, 10 files, zero indexed symbols/processes |

The worktree initially had no installed toolchain. Verification used temporary
directory junctions to the baseline's existing `node_modules` directories, so
no dependency installation or manifest change occurred. All three junctions
were verified as junctions and removed before the scope audit and commit.

The first cleanup command was rejected by the shell safety layer before
execution. Each exact junction was then removed without recursive traversal.

Correction verification recreated the same three exact junctions and reran the
full test/build/type/lint gates. Combined and native `Remove-Item` cleanup
attempts were rejected before execution by the shell safety layer; each verified
junction was then removed non-recursively with
`System.IO.Directory.Delete(path, false)`. All baseline targets remained intact.

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
- trusted-policy fingerprints plus registry/capability hashes;
- supported-version and exact-shape reconstruction before audit acceptance;
- accepted `IntegrationGrant` resolution with exact
  tenant/user/workspace/package/capability/permission scope;
- capability/policy/registry identity inside Loop 03's action hash;
- Docker Compose-only managed services with package-bound backend URL variables;
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

The initial handoff added only:

- `worklogs/personal-office-loop-07.md`
- `docs/handoffs/personal-office/loop-07.json`
- `docs/handoffs/personal-office/change-request-loop-07-agent-bundle-export.md`

The correction implementation changed ten files, all within the same exclusive
write paths above. This correction handoff changes only:

- `worklogs/personal-office-loop-07.md`
- `docs/handoffs/personal-office/loop-07.json`

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
  side-effect gates, then reused to resolve the four independent-review
  authorization and command-execution findings.
- `/verification-loop`: used for targeted/full tests, builds, typechecks,
  lint, scope, secret and diff checks before both correction commits.
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
- Runtime install/load wiring and the trusted `IntegrationGrant` resolver
  implementation remain outside this loop's lease. Consumers must read accepted
  grants from the authoritative store and use registry version `1.1.0`.
- W0 should review `767fb57` plus correction `cf3b25a`, rerun the 25 targeted
  tests/full suite/build gates on integration, verify hashes and exact paths,
  decide the barrel change request, and then create `acceptance/loop-07.json` or
  return concrete findings.

`READY_FOR_REVIEW` is a producer status only. It is not `ACCEPTED`.
