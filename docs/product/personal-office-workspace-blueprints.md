# Personal Office workspace blueprints

Status: Loop 08 implementation artifact
Blueprint schema: `1`
Descriptor version: `1.0.0`
Provisioning-plan schema: `1`
Provisioning-plan version: `1.0.0`

## Purpose

A workspace blueprint describes what a single-operator office would contain.
It is reviewable input for creating a provisioning plan. Neither a descriptor
nor a plan proves that an app, package, account, grant, runtime or workspace was
created.

`SECURITY GATE: workspace blueprint and provisioning intent - risk: forged
scope, secret leakage, authority widening, arbitrary execution and fabricated
provisioning success; checked: strict exact-key parsing, trusted provenance,
deterministic derivation, exact tenant/user/workspace binding, opaque grant
references and plan-only output; decision: fail closed.`

## Descriptor trust

The parser accepts one explicit provenance boundary:

- `host_validated` requires `availability: host_verified` and a matching
  `sha256:<64 lowercase hex>` evidence digest.
- `demo`, `offline` and `unavailable` must declare the same availability and
  cannot carry a trusted evidence digest.

Untrusted metadata cannot self-promote to host-verified. Unknown fields are
rejected, including authority-bearing fields such as commands, environment,
download locations, permission grants, install state, activation state or
provisioning success.

Identifiers are exact, NFC-normalized, non-wildcard strings. Credential-shaped
identifiers and display text are rejected. Blueprint and package versions use
semantic version text. Every package id binds its exact package version.

## Deterministic plan

A plan binds:

- exact tenant id;
- exact user id;
- target `WorkspaceInstanceId`;
- exact `WorkspaceBlueprintId`;
- exact blueprint version;
- immutable deterministic plan id.

The plan id is derived only from plan version, blueprint identity/version and
the three scope identifiers. `plannedAt` records review time but does not alter
identity.

Plan contents are re-derived from the reviewed blueprint:

- requested app ids;
- exact package ids;
- required `IntegrationGrant` references;
- data classifications;
- trust zones;
- expected future side effects;
- approval requirement.

Arrays are sorted and deduplicated. A serialized plan is accepted only when
every derived field and the plan id still match the reviewed descriptor.

## Plan-only boundary

Every output has:

```text
effect: plan_only
```

The schema has no command, environment, download, execution, permission grant,
activation, account mutation, persisted-state, installed, provisioned or
success field. Adding one is an unknown-field validation failure.

The main-process module is a pure planning seam. It makes no network call,
opens no process, resolves no secret, writes no database and registers no IPC.
Operational provisioning requires a new exact W0 lease and a separate security
review.

## Workspace health

`WorkspaceInstance.health` is optional:

```text
ok | attention | blocked | unknown
```

Health is a non-authoritative signal. It is independent from `WorkspaceState`
and `ProvisioningState`. An active workspace remains active for every health
value, and no health value triggers or implies a lifecycle transition.

`PERSONAL_OFFICE_SCHEMA_VERSION` remains the only Personal Office schema
authority and stays at `1`.

## Explicit unavailable states

Demo, offline and unavailable descriptors remain inspectable as such but cannot
create a provisioning plan. The product must never label them remote-verified,
installed or provisioned without trusted host evidence.
