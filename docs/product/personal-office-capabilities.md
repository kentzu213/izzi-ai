# Personal Office capability registry

Status: Loop 07 implementation artifact
Registry schema: `1`
Registry version: `1.1.0`
Adapter envelope version: `1.0.0`

## Purpose

The capability registry turns installed `.ocx` extension and `.oab` agent-bundle
manifests into deterministic, auditable records without trusting a package to
define its own authority.

The registry composes the accepted Personal Office entities:

- `SkillPackage` represents the installed package and its derived permission
  request.
- `ToolDefinition` represents one invocable capability and its exact required
  permission.
- `IntegrationGrant` remains the workspace-bound authorization model. A
  manifest cannot mint one.
- `RuntimeInstance` remains the execution environment model. A package
  declaration cannot make a runtime trusted.

No parallel package, tool, grant or runtime domain entity is introduced.

## Security gate

`SECURITY GATE: untrusted package capability declarations - risk: ambient
authority, data exfiltration, secret access and unattended side effects;
checked: strict schema, exact policy lookup, data classification, egress,
side-effect and audit binding; decision: fail closed.`

The package controls only these facts:

- manifest kind, name and version;
- a declaration key such as `web`, `net.http` or `ui.panel`;
- the manifest path where the declaration came from;
- public package display metadata;
- an optional publisher `sha256:` digest.

The package does not control:

- the permission granted to the capability;
- its trust zone;
- data classifications;
- side-effect classification;
- risk level;
- whether the declaration is allowed.

Those fields come only from the host-owned policy catalog.

## Flow

```text
.oab or .ocx manifest
        |
        v
versioned adapter envelope (untrusted facts only)
        |
        v
strict parser (unknown fields and versions rejected)
        |
        v
exact trusted policy lookup
        |
        v
accepted SkillPackage + ToolDefinition records
        |
        v
canonical fingerprints + registry audit digest
        |
        v
trusted resolver -> accepted IntegrationGrant with exact
tenant/user/workspace/package/capability/permission scopes
        |
        v
classification + egress invocation gate
        |
        v
Loop 03 RequestApprovalInput for side effects
```

The approval adapter only builds `RequestApprovalInput`. `WorkService` remains
the authority that redacts, hashes, persists and decides approval records. The
adapter never performs the effect. Capability id, package id, required
permission, capability fingerprint, policy version/fingerprint, registry
version and registry digest are copied into the hashed action input and
estimated-side-effect binding. A stale approval therefore cannot authorize the
same human-readable action under different capability or policy authority.

## Deterministic and versioned output

Adapters never read the clock. The caller supplies an exact ISO UTC
`observedAt`, normally the install timestamp. The same manifest, observation
context and policy catalog therefore produce the same records.

Normalization rules:

1. Envelopes, declarations, permissions, classifications and side effects are
   sorted before registry construction.
2. Duplicate package identities and duplicate declarations are rejected.
3. Package and capability identifiers are derived from source kind, package
   name, package version, declaration kind and declaration key.
4. Every `SkillPackage` and `ToolDefinition` timestamp is the supplied
   `observedAt`.
5. Every capability records a `sha256:` fingerprint of the exact trusted policy
   that assigned its permission, classification, trust and side effects.
6. Every capability receives a `sha256:` fingerprint over its canonical record.
7. The snapshot receives a `sha256:` digest over all package and capability
   records.
8. Invocation verifies supported schema/registry/adapter versions, exact object
   shapes, package/capability relationships, trusted policy equality, policy
   fingerprints, capability fingerprints and the registry digest before
   checking authority. Recomputing public hashes after changing a permission or
   version is still denied with `AUDIT_INVALID`.

The canonical byte format uses the accepted
`shared/personal-office/canonicalJson` helper. Cryptographic hashing stays in the
Electron main process.

## Adapter behavior

### Agent bundles (`.oab`)

`packages/agent-bundle/src/adapters/capability-envelope.ts` validates the
existing `AgentBundleManifest` and emits one declaration for each
`agent.tools[]` item.

The adapter preserves unsafe, not-yet-modeled surfaces as
`unsupportedDeclarations`:

- enabled cron jobs;
- non-manual workflows;
- event triggers;
- required platform connections or platform scopes;
- required external APIs;
- incoming webhooks.

The registry rejects an envelope containing any unsupported declaration.
Platform scopes must be converted into a workspace-bound `IntegrationGrant` by
a future explicitly scoped adapter. They are never inferred or silently
ignored.

### Extensions (`.ocx`)

`apps/desktop/src/main/capabilities/ocx-adapter.ts` reuses the existing
`OcxManifest` and permission validators.

It rejects:

- duplicate permissions;
- wildcard permissions;
- unknown permissions;
- contributed panels without `ui.panel`;
- managed local services without `net.http`;
- `node` and `binary` managed-service commands until a host-owned executable and
  argument schema exists;
- hidden `command` fields on Docker Compose services;
- fallback environment variables other than the package-bound
  `<PACKAGE>_BACKEND_URL` or `<PACKAGE>_BASE_URL`;
- invalid managed-service namespace, path or bind declarations through the
  existing service validator.

A validated managed service adds the derived
`runtime:managed_local_service` declaration. Its trusted policy requires the
exact `runtime.local_service` permission and a Loop 03 approval. The existing
validator has already constrained it to the `izzi-svc-` namespace and loopback
binds. Admission currently permits only the host-controlled Docker Compose
launch form; arbitrary shell, Node and binary commands fail closed.

## Built-in policy

| Source declaration | Permission | Data classification | Side effects | Status |
| --- | --- | --- | --- | --- |
| `.oab` `web` | `net.http` | `public_metadata` | network egress, external action | allowed |
| `.oab` `browser` | `browser.automation` | `public_metadata` | network egress, external action | blocked: browser runtime is not implemented |
| `.oab` `terminal` | `system.shell` | `local_files`, `secrets` | read, write, process, secret access | blocked: no command/path/environment scope |
| `.ocx` `net.http` | `net.http` | `public_metadata` | network egress, external action | allowed |
| `.ocx` `net.websocket` | `net.websocket` | `public_metadata` | network egress, external action | allowed |
| `.ocx` `storage.local` | `storage.local` | `local_files` | local write | allowed |
| `.ocx` `ui.panel` | `ui.panel` | `public_metadata` | UI mutation | allowed |
| `.ocx` `ui.notification` | `ui.notification` | `public_metadata` | UI mutation | allowed |
| `.ocx` `ui.dialog` | `ui.dialog` | `public_metadata` | UI mutation | allowed |
| `.ocx` managed local service | `runtime.local_service` | `local_files`, `secrets` | write, process, secret access | allowed with exact grant and approval |
| `.ocx` `fs.read`, `fs.write` | exact permission | `local_files` | local read/write | blocked: no path scope |
| `.ocx` clipboard permissions | exact permission | local/secret data | local read/write | blocked: no enforceable data/user-action scope |
| `.ocx` `storage.secrets` | `storage.secrets` | `secrets` | write, secret access | blocked: must use `IntegrationGrant` + `SecretRef` |
| `.ocx` `system.env`, `system.shell` | exact permission | local/secret data | process/secret/file access | blocked: ambient authority |

Adding a policy is a security change. The policy must use an exact permission,
stay in `extension_package`, name known data classifications and side effects,
and state a reason when blocked. Wildcard policy permissions are invalid.

## Invocation gate

An invocation request names:

- the registered capability id;
- tenant, user and workspace identity;
- an explicit UTC evaluation time;
- every data classification the invocation will touch.

Permission strings in the request are never authorization. The main process
supplies a trusted resolver that reads an accepted `IntegrationGrant`. The
returned grant must:

- use the accepted Personal Office schema and a valid `SecretRef`;
- be active, unrevoked and unexpired at the supplied evaluation time;
- match the workspace and package (`integration`) exactly;
- contain no wildcard or duplicate scopes;
- contain exactly one capability binding for each of tenant, user, workspace,
  package, capability id and required permission.

Authorization is denied when:

- the registry audit is invalid;
- the capability id is absent;
- the request is incomplete or includes the old caller-owned permission shape;
- the trusted resolver returns no accepted grant;
- any tenant/user/workspace/package/capability/permission binding differs;
- the grant is malformed, forged, revoked, expired, duplicated or wildcarded;
- an input classification is outside the policy;
- network egress is attempted with anything other than freely egressable
  `public_metadata`.

For allowed invocations, `requiresApproval` is true for local writes, network
egress, external actions, process execution and secret access. Pure UI mutation
and local reads do not automatically open a Loop 03 approval.

## Fail-closed cases

The registry returns no partial snapshot when any package contains:

- an unsupported schema or adapter version;
- unknown fields;
- duplicate declarations or duplicate package identity;
- credential-shaped public metadata;
- an invalid publisher digest;
- an unknown capability declaration;
- a known blocked declaration;
- an unsupported automation or integration declaration;
- a wildcard or otherwise invalid trusted policy.

The admission operation is stateless and atomic: either every input validates
and the complete immutable snapshot is returned, or the call throws.

Registry hashes are audit evidence, not a trust root. Verification always
re-derives authority-bearing fields from the trusted policy catalog. Invocation
then requires a separately accepted and exactly scoped `IntegrationGrant`, so a
modified snapshot cannot become executable merely by recomputing its public
hashes.

## Integration boundary

This loop intentionally does not modify:

- extension install/load flows;
- Electron main/preload/index wiring;
- database persistence;
- renderer UI;
- package manifests or lockfiles;
- `packages/agent-bundle/src/index.ts`.

The `.oab` adapter is available under `packages/agent-bundle/src/adapters/`.
Exporting it from the package root requires a separately leased one-line barrel
change. Runtime wiring should consume the registry only after a package is
validated and before any capability is granted or invoked.
