# Local and Browser Runtime

Status: Loop 11 implementation candidate
Contract version: `RUNTIME_CONTRACT_VERSION = 1`

## Purpose

The runtime layer lets Personal Office supervise local services, verified native
processes and isolated browser work without turning the desktop app into an
unrestricted shell. It is an execution-plane foundation, not a general remote
control API.

The default posture is deny:

- a package must be trusted;
- an exact active integration grant must match tenant, user, workspace and
  integration;
- the grant must contain the runtime-kind-specific scope;
- all working paths must stay inside owned roots after realpath resolution;
- every published port binds to loopback;
- egress is denied unless an exact origin and port are allowlisted;
- secrets enter only through `SecretRef`;
- native executables require an absolute owned path and verified SHA-256;
- browser storage state requires an available encryption provider;
- external browser effects require a live Work approval and an atomic effect
  claim.

## Module map

### Shared contract

`apps/desktop/src/shared/runtime/**`

- versioned runtime specs and lifecycle/health snapshots;
- tenant/user/workspace/package/integration/run authority;
- budgets, path roots, loopback bind and egress policy;
- active grant evidence and kind-specific required scopes;
- SecretRef-only environment bindings;
- IPC types for read-only health.

This layer is serializable and contains no raw credential values.

### Main execution plane

`apps/desktop/src/main/runtime/**`

- `RuntimeManager`: adapter registry, lifecycle, health, timeout, cancel,
  restart and cross-workspace identity collision prevention;
- `NativeProcessAdapter`: verified executable + argument array, `shell:false`,
  empty environment plus explicitly resolved SecretRefs;
- `DockerComposeRuntimeAdapter`: compatibility wrapper around
  `LocalServiceManager`; the legacy manager is not policy authority and cannot
  start without four isolation attestations plus an exact service resolver;
- `BrowserRuntimeCoordinator`: allowlisted read, draft artifact, Work approval,
  approved test submission, trace/screenshot/receipt artifacts;
- `FileEffectClaimStore`: durable, atomic external-effect claim;
- `EncryptedBrowserStateStore`: ciphertext-only storage-state persistence;
- `runtime-ipc`: authorized, read-only health exposure.

Remote runtimes implement the same injected `RuntimeAdapter` interface. No
remote adapter is registered by default.

## Runtime lifecycle

```text
pending -> provisioning -> ready
                   \----> failed
ready -> deprovisioning -> released
failed/released -> start again through RuntimeManager
```

`RuntimeManager` never deletes a runtime's user artifacts or Docker volumes.
Stopping a native runtime kills only its tracked process. The Docker wrapper
uses the existing `down` path, which intentionally omits `-v`.

The production control plane is created with an empty adapter registry. This is
intentional: Loop 11 publishes the safe contracts and supervisor, while each
real adapter must be registered only when its executable/service/browser
attestation can be proven. The renderer can observe health but cannot start an
arbitrary runtime.

## Native execution boundary

Native execution is not a shell.

1. The spec is validated and scope/grant checked.
2. Executable and working directory are realpath-resolved inside allowed roots.
3. The executable verifier must match the declared `sha256:` digest.
4. Each SecretRef is resolved for the exact runtime authority.
5. The child receives only that explicit environment map.
6. `spawn(executable, args, { shell: false, windowsHide: true })` is used.
7. Output is redacted and bounded before it enters runtime logs.

Control characters in arguments are rejected. Shell metacharacters remain one
literal argument and are never interpreted by a shell.

## Browser boundary

Loop 11 does not attach Chrome Default, import a personal profile, autofill
credentials or globally enable `browser.automation`.

The POC uses an injected fake isolated browser driver and a loopback test
endpoint. A future Playwright adapter must implement the same session contract
and enforce the supplied URL authorizer on every request and redirect before
network dispatch.

The flow is:

1. Validate exact runtime authority, active `runtime.browser_test` grant,
   loopback bind, allowed origins/ports and scoped paths.
2. Refuse password/MFA/recovery/key-shaped fields.
3. Require encrypted storage state; if encryption is unavailable, do not open.
4. Open an isolated session and authorize every navigation/final URL.
5. Read data and create draft, trace and screenshot artifacts.
6. Create a Work approval bound to target, redacted input, artifact version,
   plan/context, expiry and idempotency key.
7. Stop. Approval consent alone performs no external effect.
8. Immediately before submit, re-read the approval/run/artifact and recompute
   the action hash.
9. Atomically claim the effect by approval/action/idempotency plus
   tenant/user/workspace/run scope.
10. Submit only to the allowlisted test endpoint.
11. Persist the effect receipt, encrypted storage state, trace and screenshot.

Reject, cancel before claim, stale/tampered approval and missing scope produce
zero effect.

## Atomic effect claims and crash semantics

`FileEffectClaimStore` uses an exclusive file create for the initial claim and
fsync + atomic rename for state transitions.

States:

- `claimed`: one executor owns the attempt;
- `effected`: immutable receipt exists; retry returns the same receipt;
- `aborted`: effect was known not to start;
- `uncertain`: the process/browser failed after claim and the outcome cannot be
  proven.

The key contains:

`approvalId + actionHash + idempotencyKey + tenantId + userId + workspaceId + runId`

An `effected` replay never calls the driver again. An `uncertain` outcome is
not automatically retried. A future adapter may support recovery only when the
external test/service endpoint itself proves idempotent replay with the same
persisted key.

## Security decisions

- Global capability policy remains unchanged; `browser.automation` stays
  blocked.
- The POC scope is `runtime.browser_test`, not a production browser grant.
- Existing `WorkService` and its database/schema are unchanged.
- Existing `LocalServiceManager` remains unchanged and is treated as a
  compatibility mechanism below the new policy layer.
- Existing Hermes and agent-tools native seams are not reused because they
  inherit host environment or accept broader command/path input.
- No browser cookies or storage state enter Graph, Live.md, Work artifacts,
  logs or receipts.
- No package manifest, lockfile, dependency or database migration is required.

## Workspace Setup health

The Settings setup surface mounts `RuntimeHealthPanel`. The renderer receives a
read-only, main-authorized list of runtime lifecycle and health snapshots.
Missing IPC or an error displays a fail-closed unavailable state and starts
nothing. With no active adapters/runtimes, it explicitly reports that no
managed runtime is active.

## Verification matrix

Covered by focused tests:

- lexical traversal and realpath/junction escape;
- argument control-character injection and no shell-string execution;
- missing executable verification;
- no host environment inheritance;
- non-loopback bind;
- exact domain/origin/port and final redirect;
- encrypted storage state and plaintext absence;
- credential-field refusal;
- inactive/expired/wrong-workspace/wrong-scope grant;
- untrusted package;
- atomic concurrent claim and immutable effected receipt;
- approval bypass/reject, replay, crash-to-uncertain and no automatic retry;
- no effect before approval;
- trace/read redaction;
- runtime identity collision.

Integration verification must additionally run main/renderer typecheck, the full
desktop suite, production build, lint ceiling, ownership audit, secret scan and
GitNexus change detection on the canonical worktree.

## Residual boundaries

- There is no production Playwright adapter in Loop 11.
- No production native executable resolver is registered.
- The legacy Docker service manager cannot be attested as encrypted-secret and
  deny-default-egress today, so the wrapper remains closed unless those facts
  are supplied by a future adapter implementation.
- An uncertain external effect requires operator reconciliation; this is safer
  than silently retrying an action whose outcome is unknown.
