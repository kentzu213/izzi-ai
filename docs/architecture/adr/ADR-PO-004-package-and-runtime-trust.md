# ADR-PO-004 — Package and runtime trust (SkillPackage / Tool / IntegrationGrant / RuntimeInstance)

- **Status:** Accepted (PROVISIONAL — pinned to `v1.14.0-beta.3` / `84a57b3`; requires Loop 00 revalidation).
- **Date:** 2026-07-28
- **Loop:** Personal Office OS — Loop 01
- **Deciders:** Loop 01 (domain model)
- **Related:** ADR-PO-001, ADR-PO-002; `apps/desktop/src/shared/personal-office/{entities,secret-ref,trust}.ts`; `main/extensions/ocx-manifest.ts`; `packages/agent-bundle/src/manifest.ts`

## Context

Third-party capability enters the system via `.ocx` extensions and `.oab` agent
bundles. Some declare managed local services (`OcxServiceSpec`, constrained to the
`izzi-svc-` project namespace with loopback-only binds) and secrets
(`OcxServiceSecret`/`SecretDef`). This is untrusted code that may need to act on
the user's integrations and run local processes — a real attack surface
(permissions, secrets, external actions).

## Decision

Model packaged capability and its runtime as distinct, least-privilege entities:

- **SkillPackage** — a distributable bundle; declares `requestedPermissions` and
  an optional `signatureDigest` verified on the execution plane.
- **ToolDefinition** — a single invocable capability with one
  `requiredPermission` and a `hasExternalEffect` flag (external, side-effecting
  actions are explicitly marked, so they can be approval-gated).
- **IntegrationGrant** — a scoped, revocable authorization (`scopes`, `expiresAt`,
  `revokedAt`) that carries credentials **only** as a `SecretRef`.
- **RuntimeInstance** — the live environment (`container | process | browser |
  inproc`), always on the execution plane, tracking `provisioning` state and, for
  managed services, the `serviceProject` (the `izzi-svc-` name).

Trust rules (from `trust.ts`, tested):

- `extension_package`, `local_runtime`, `browser_runtime`, `model_provider` are
  **untrusted** with **no** authority to hold domain state.
- Extensions act only through a granted `IntegrationGrant` + `ToolDefinition`
  invocation (default-deny for any crossing not in `TRUST_BOUNDARY_CROSSINGS`).
- **Secrets exist only as `SecretRef`.** No entity or event inlines a secret
  value; `looksLikeRawSecret()` is the tripwire tests assert against.
- Managed local services stay loopback-only within the `izzi-svc-` namespace
  (inherited from the existing `ocx-manifest` validation boundary).

## Consequences

**Positive**

- Least privilege by construction: every external action traces to a scoped grant
  and a permissioned tool.
- Credentials never appear in serialized data, logs, or cross-plane sync.
- Browser automation is representable (`RuntimeKind = 'browser'`) but gated and
  **not implemented** this loop — no premature attack surface.

**Negative / trade-offs**

- More entities to wire when adapting `.ocx`/`.oab` manifests (adapter path in a
  later loop, not big-bang).
- Signature verification + grant revocation flows are declared here but
  implemented later.

## Alternatives considered

- **Trust installed extensions implicitly:** simplest, but hands untrusted code
  ambient authority over integrations/secrets. Rejected.
- **Inline secrets in grants for convenience:** violates the core secret-reference
  constraint and the security baseline. Rejected.

## Compliance / security notes

Directly implements the security-baseline surfaces B (authz/least privilege), A/D
(secrets only as reference, no leakage), and E/F (package provenance via
signature digest). External-effect tools are flagged so ADR-PO-002 approvals can
gate them.
