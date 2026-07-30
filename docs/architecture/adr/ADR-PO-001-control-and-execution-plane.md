# ADR-PO-001 — Control plane and execution plane

- **Status:** Ready for review — replayed on accepted Loop 00 integration ref `0cbf888`.
- **Date:** 2026-07-28
- **Loop:** Personal Office OS — Loop 01
- **Deciders:** Loop 01 (domain model)
- **Related:** ADR-PO-002, ADR-PO-003, ADR-PO-004; `apps/desktop/src/shared/personal-office/trust.ts`, `classification.ts`

## Context

Starizzi runs partly in the IzziAPI cloud (identity, billing, catalog, the
second-brain graph API) and partly on the user's desktop (Electron main +
renderer, local SQLite, local runtimes, integrations). Sensitive user data —
runs, artifacts, files, credentials — lives on the machine. We need a single,
enforceable rule for **where authority and data may reside** before we build any
new orchestration or UI.

## Decision

Adopt two planes with an asymmetric authority rule:

- **Control plane** (`izziapi_control_plane`, cloud): authoritative **only** for
  `public_metadata` (catalog of blueprints/packages, capability descriptors,
  identity/billing, and a **redacted** audit index). It never holds authoritative
  domain state.
- **Execution plane** (`desktop_execution_plane`, desktop): authoritative for all
  domain state — `personal_graph`, `local_files`, `artifacts`, `secrets`,
  `audit_events`.

Data classes and their residency/egress rules are frozen in
`classification.ts::CLASSIFICATION_MATRIX`. Trust zones and the **default-deny**
set of sanctioned crossings are frozen in `trust.ts`. Model providers, extension
packages, local runtimes and the browser runtime are all **untrusted** zones on
the execution plane with **no** authority to hold domain state.

## Consequences

**Positive**

- One place to reason about egress: `mustStayLocal()` is true for `secrets` and
  `local_files`; only `public_metadata` egresses freely.
- The cloud can be compromised without leaking runs/artifacts/secrets — they were
  never authoritative there.
- New features inherit the boundary for free by classifying their data.

**Negative / trade-offs**

- Cross-plane features (e.g. cloud dashboards over local runs) must sync
  **redacted metadata**, not content — more adapter work.
- The control plane's audit index is intentionally lossy (redacted), so deep
  forensic replay requires the local event log.

## Alternatives considered

- **Cloud-authoritative (SaaS-style):** simplest sync, but puts personal graph,
  files and secrets in the cloud — rejected on privacy + trust grounds.
- **Fully local, no control plane:** loses catalog/billing/identity and
  cross-device catalog; rejected as it drops core product value.

## Compliance / security notes

Aligns with the security-baseline data-classification and trust-boundary gate.
Secrets never cross to control plane (ADR-PO-004). This ADR defines *where* data
lives; ADR-PO-002 defines *what* the work entities are.
