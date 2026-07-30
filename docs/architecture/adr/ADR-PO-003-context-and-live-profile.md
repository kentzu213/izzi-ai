# ADR-PO-003 — Context snapshots and the Live Profile (Live.md)

- **Status:** Ready for review — replayed on accepted Loop 00 integration ref `0cbf888`.
- **Date:** 2026-07-28
- **Loop:** Personal Office OS — Loop 01
- **Deciders:** Loop 01 (domain model)
- **Related:** ADR-PO-001, ADR-PO-002; `apps/desktop/src/shared/personal-office/entities.ts`

## Context

Agents need two very different kinds of "context":

1. The **exact inputs** a run/step operated on, so a result can be reproduced and
   audited (immutable).
2. The **current working state** of the office — the evolving Live.md the user and
   agents read/update as work proceeds (mutable, latest-wins).

Conflating these is a common modeling error: it makes "context" both reproducible
and mutable at once, which is contradictory. It also risks pulling personal graph
content into places it should not egress.

## Decision

Separate the two concepts as distinct entities:

- **ContextSnapshot** — immutable, content-addressed (`digest`), with ordered
  `sourceRefs`. Bound to a run/step and to `Checkpoint`s. Reproducible input.
- **LiveProfile / Live.md** — mutable, `revision`-counted (latest-wins), pointing
  at a local `documentRef`. Classified `personal_graph | local_files`.
- **Checkpoint** — a resume point that references an `atEventSequence` **and** a
  `ContextSnapshot`, so resuming restores both position and the exact context.

LiveProfile and ContextSnapshot never collapse into one type. Snapshots are the
audit/reproduce path; LiveProfile is the working-memory path.

## Consequences

**Positive**

- Deterministic reproduction: a run replays from its events against the frozen
  snapshot at a checkpoint.
- Clear egress story: snapshots/LiveProfile inherit `personal_graph`/`local_files`
  classification, so content stays local by default.
- Resuming is well-defined: `Checkpoint = (event sequence, snapshot)`.

**Negative / trade-offs**

- Two entities where teams might expect one; requires discipline to route data to
  the right one. Mitigated by the glossary + tests.
- Snapshot content-addressing implies dedupe/storage bookkeeping in a later loop.

## Alternatives considered

- **Single mutable "context" blob:** simplest, but non-reproducible and unsafe to
  sync. Rejected.
- **Snapshot only (no LiveProfile):** loses the human-facing evolving Live.md that
  the product needs. Rejected.

## Compliance / security notes

Both entities carry a `classification` from ADR-PO-001's matrix; neither may
egress content freely. Snapshots are immutable, giving tamper-evident audit input
that pairs with the `WorkEvent` log (ADR-PO-002).
