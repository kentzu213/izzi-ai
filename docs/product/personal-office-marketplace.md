# Personal Office marketplace and install planning

Status: Loop 15 host-operation boundary
Catalog schema: `1`
Catalog version: `1.0.0`
Install-plan schema: `1`
Install-plan version: `1.0.0`
Capability registry dependency: Loop 07, schema `1`, registry `1.1.0`

## Purpose

The Personal Office marketplace is a trust review surface backed by a
main-process operation boundary. It lets an operator inspect a package's stable
identity, compatibility, permissions, trust zone, data classifications and side
effects before requesting a host-controlled operation.

Loop 15 defines and tests the ordered verification, approval, grant,
provisioning and installation ports. Its production catalog and effect ports
remain deliberately unavailable, so the accepted implementation does not
download package bytes, execute commands, grant permission, activate a runtime,
mutate an account or provision a workspace.

## Security gate

`SECURITY GATE: untrusted catalog and install intent - risk: forged package
identity, permission widening, leaked credentials, arbitrary execution and
fabricated install success; checked: strict versioned parsing, audited registry
projection, exact scope, signature and compatibility gates, plan-only output;
decision: fail closed.`

Authority-bearing fields never come from Marketplace API metadata. Remote or
cached metadata may supply only:

- package source kind, name and version;
- display name, summary, publisher and category;
- minimum and optional maximum desktop version;
- catalog generation time and source kind.

Permissions, trust zone, data classifications, side effects, risk, package id,
registry identity and capability fingerprints are copied only from a Loop 07
registry snapshot after `verifyCapabilityRegistryAudit` succeeds.

Unknown fields are rejected. A remote record cannot smuggle commands,
environment variables, download locations, permissions, grants, activation
state, provisioning state or install success through a newer or wider shape.

## Stable package identity

Every package key has one canonical form:

```text
<source-kind>:<package-name>@<semantic-version>
```

Examples:

```text
ocx_extension:social-auto-poster@0.3.0
agent_bundle:research-agent@1.2.3
```

The parser reconstructs this key from the three identity fields and rejects a
different supplied key. Duplicate package keys and duplicate capability ids are
invalid.

## Catalog trust flow

```text
remote or cached public metadata
        |
        v
strict metadata parser
  - exact keys
  - supported versions
  - public text only
        |
        +------------------------------+
        |                              |
        v                              v
audited Loop 07 registry        desktop compatibility
  - package record                    evaluation
  - exact capabilities
  - publisher digest
        |
        v
host-validated renderer catalog
        |
        v
permission and side-effect review
        |
        v
exact tenant/user/workspace scope
        |
        v
deterministic plan-only receipt
```

The projection is atomic. If the registry audit fails, a package is absent,
unsigned, has no reviewed capability, or remote metadata is presented as
offline, the adapter returns no catalog.

## Explicit state model

The UI keeps independent state dimensions visible instead of collapsing them
into one "available" flag.

| Dimension | Values | Meaning |
| --- | --- | --- |
| Catalog source | `remote`, `cached`, `demo` | Where display metadata came from |
| Connection | `online`, `offline` | Network context when the catalog was presented |
| Verification | `host_verified`, `demo_unverified` | Whether the desktop host projected an audited registry |
| Compatibility | `compatible`, `incompatible` | Desktop version gate |
| Installation | `not_installed`, `installed` | Read-only installed-state context |
| Load phase | `idle`, `loading`, `ready`, `error` | Renderer fetch/validation lifecycle |
| Review | `closed`, `reviewing`, `canceled`, `planned` | Install-intent lifecycle |

Rules:

- remote catalogs require an online connection;
- cached catalogs may remain reviewable while offline if they were
  host-validated;
- demo records are always labelled unverified;
- demo, incompatible, installed and unsigned packages cannot create a plan;
- canceling review creates no plan or side effect;
- a planned receipt says exactly what did not happen.

## Superseded Loop 09 demo behavior

Loop 09 used a visibly labelled, non-confirmable demo catalog because no leased
Electron bridge existed. Loop 15 removes that fallback from the production
Marketplace route. Demo helpers remain only for isolated contract and component
tests.

The superseded behavior presented:

- `Demo catalog online` when Marketplace API health responds;
- `Demo catalog offline` when it does not;
- installed OCX records contribute only exact
  `ocx_extension:name@version` keys after strict name and version validation;
- incomplete records and the separate extension `id` field are ignored, so an
  id/name collision or version mismatch cannot label another demo package as
  installed;
- exact installed-state matches are read only to label demo records, never to
  make them trusted;
- no API response is treated as capability authority.

The security rationale remains: a reachable server cannot self-assert that its
metadata was audited by the desktop host. Production now fails closed when the
host catalog authority is unavailable.

## Install-plan contract

The main process creates a plan from:

- one host-verified compatible package that is not already installed;
- exact `tenantId` derived from the authenticated reviewer authority;
- exact opaque `userId` derived in main;
- the canonical personal `workspaceInstanceId`;
- an explicit UTC plan timestamp.

Wildcards, empty scope, unsafe ids and credential-shaped scope values are
rejected.

The plan contains:

- package identity and accepted `SkillPackage` id;
- registry version and audit digest;
- exact scope;
- sorted, deduplicated requested permissions;
- sorted, deduplicated data classifications and side effects;
- a capability-by-capability review;
- whether later execution requires approval;
- `effect: "plan_only"`.

The deterministic `planId` binds plan version, package key, exact scope and
registry digest. The same reviewed package, scope and registry produce the same
id. `plannedAt` records when the operator created the proposal but does not
change its authority identity.

The strict plan parser accepts no optional execution surface. Fields such as
`command`, `environment`, `downloadUrl`, `installed`, permission grants,
activation or provisioning success are unknown and therefore rejected.
It also re-derives the plan id, package id, permission/classification/effect
aggregates and approval flag from the exact reviewed capabilities. A serialized
plan with internally inconsistent authority or identity is rejected even when
every individual field has a valid shape.

## Approval meaning

`requiresApproval` is true when any reviewed capability declares:

- external action;
- local write;
- network egress;
- process execution;
- secret access.

This flag is a description of future work. It does not create or accept a Loop
03 approval, and it does not grant an `IntegrationGrant`.

## Renderer behavior

The Marketplace route remains mounted through the existing `App.tsx`
navigation. Loop 09 does not edit the router or Electron seams.

The renderer provides:

- loading, empty and validation-error states;
- explicit online/offline source notice;
- search by package, publisher and permission;
- category filtering;
- stable selected-package detail;
- incompatible, installed and verification badges;
- capability-level permission review;
- a modal permission review with focus restoration, keyboard containment and
  Escape cancellation;
- canceled, plan-only and staged operation receipts;
- responsive two-pane desktop layout and single-column/mobile sheet layout;
- reduced-motion and visible-focus support.

## Fail-closed cases

No catalog or plan is returned for:

- unsupported schema, catalog, registry or package versions;
- unknown object fields;
- invalid or duplicate package identity;
- invalid or duplicate capability identity;
- credential-shaped public metadata;
- wildcard or malformed permission;
- trust-zone widening;
- invalid or missing publisher digest on trusted data;
- registry digest mismatch;
- unaudited or tampered Loop 07 snapshot;
- a package absent from the audited snapshot;
- a package with no audited capabilities;
- remote metadata paired with an offline connection;
- demo or otherwise unverified records;
- incompatible or already installed packages;
- ambiguous tenant, user or workspace scope;
- attempted command, environment, download, grant, activation, provisioning or
  success fields.

## Next seam request

A later owner must request an exact W0 lease before registering production
catalog, package-verification, approval, exact-grant, provisioning or installer
adapters.

Those adapters must:

1. fetch or read public remote/cached metadata;
2. build or load the complete Loop 07 capability registry in the main process;
3. verify the registry audit against trusted host policy;
4. project the catalog with
   `buildMarketplaceCatalogFromCapabilityRegistry`;
5. expose only the validated catalog to the renderer;
6. consume an unchanged main-created plan;
7. bind package bytes and publisher signature evidence to Work approval;
8. resolve every exact grant and workspace scope before any later effect;
9. report every completed, pending, blocked or failed stage truthfully.

A plan, approval or provisioned workspace is never evidence that installation
happened.

## Loop 15 operation boundary

Marketplace data is now requested from the desktop host through an authenticated
Personal Office bridge. The renderer does not create identity scope, load demo
records, or call the legacy extension installer.

The host re-derives every plan from the audited catalog and reports the operation
as stage receipts:

`plan revalidation → package/signature evidence → Work approval → exact grants → workspace provisioning → package installation`

An approval, plan, provisioned workspace or receipt by itself is not installation
evidence. If a later authority is unavailable, earlier stages remain visible and
the receipt is `blocked` or `failed`; no success is fabricated. In the current
build the production catalog/effect ports remain unavailable until their
subsequent authority loops are accepted, so Marketplace may show a truthful
catalog-unavailable state instead of demo packages.
