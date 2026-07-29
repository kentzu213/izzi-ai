# Loop 11 Dispatch — Runtime Manager and Isolated Browser

Issued by W0 Control Tower on 2026-07-29.

## Intent

Deliver a fail-closed, per-workspace execution foundation for managed local
services, verified native processes and isolated browser work. The safe proof
of concept may interact only with an allowlisted test endpoint and must stop at
a persisted Work approval before any side effect.

## Scope

In:

- versioned shared runtime/browser contracts and validators;
- a main-process `RuntimeManager` with injected adapters for Docker Compose,
  verified Node/binary execution and a future remote adapter;
- an adapter around the existing `LocalServiceManager` without changing it;
- isolated browser orchestration behind an injected driver interface;
- encrypted storage-state abstraction, domain/final-redirect validation,
  scoped upload/download paths, redacted logs and persisted idempotency;
- Unified Work artifact, approval, trace and receipt integration;
- runtime health exposed through IPC/preload and shown in Workspace Setup;
- architecture document, tests, worklog and two-phase handoff.

Out:

- package or lockfile changes;
- database/schema migrations;
- production account automation or real purchases/publication;
- CAPTCHA, ToS or security-control bypass;
- host browser profile attachment;
- password, MFA, recovery code or key autofill;
- cookies or storage state in Graph/Live.md;
- destructive host commands.

## Security invariants

1. Runtime identity is bound to workspace, package and tenant/user authority.
2. Host environment inheritance is denied; only allowlisted values resolved
   from `SecretRef` may be injected.
3. Native execution uses a validated absolute executable plus argument array;
   shell strings and unverified executables are rejected.
4. Paths must remain inside owned work/temp/upload/download roots after
   canonical resolution. Cleanup never removes user artifacts by default.
5. Ports must bind to loopback. Network egress and browser navigation default
   deny; every redirect and final URL is revalidated.
6. Browser storage state is encrypted at rest behind an injected secure-store
   interface and never emitted in logs, events, artifacts or receipts.
7. Send/publish/spend/delete/permission/legal/financial effects require a
   live, action-hash-bound Work approval. Reject, cancel, timeout or crash has
   no side effect.
8. Approval replay and crash retry reuse a persisted idempotency key and can
   produce at most one external effect.
9. Untrusted packages and native runtimes fail closed.

## Implementation order

1. Shared contracts, parsers and validation tests.
2. Runtime manager plus Docker/native/remote adapter boundaries.
3. Browser session/state/domain/approval orchestration with a fake driver.
4. Unified Work adapter and safe test-endpoint POC.
5. Runtime IPC/preload and Workspace Setup health panel.
6. Security tests, documentation, worklog and two-phase producer commits.

## Exact lease

Lease `LEASE-L11-RUNTIME-BROWSER-20260729` grants Loop 11 write ownership only
for:

- `apps/desktop/src/shared/runtime/**`
- `apps/desktop/src/main/runtime/**`
- `apps/desktop/src/main/index.ts` — imports, runtime construction and IPC
  registration only;
- `apps/desktop/src/main/preload.ts` — additive `runtime` preload namespace
  only;
- `apps/desktop/src/renderer/types/global.d.ts` — additive runtime API types
  only;
- `apps/desktop/src/renderer/shell/RuntimeHealthPanel.tsx`
- `apps/desktop/src/renderer/shell/RuntimeHealthPanel.test.tsx`
- `apps/desktop/src/renderer/shell/ShellSettingsPanel.tsx` — mount the health
  panel only;
- `docs/architecture/local-and-browser-runtime.md`
- `worklogs/personal-office-loop-11.md`
- `docs/handoffs/personal-office/loop-11.json`

All other paths are read-only. In particular, `LocalServiceManager`,
`WorkService`, extension manifests/runners, capability/grant contracts,
customer-marketing source, DB/schema and every package manifest are protected.

## Required verification

- traversal and scoped-directory escape;
- command/shell injection and unverified native executable;
- non-loopback port bind and egress/domain/final-redirect escape;
- encrypted storage-state round trip and plaintext non-disclosure;
- password/MFA/key-field refusal;
- approval bypass, stale binding and replay;
- retry after crash/timeout uses the same idempotency key;
- reject/cancel/crash has zero external effects;
- timeout/cancel/crash recovery and lifecycle health;
- log/trace/event/receipt redaction;
- untrusted package denial;
- focused tests, main/renderer typecheck, full desktop tests, production build,
  lint ceiling, secret scan, ownership/prohibited-path audit and
  `gitnexus detect-changes`.

## Skill and agent audit

- Socrates: USED for preflight and final challenge.
- orchestrator: USED for scope/lease/verification routing.
- builder: REQUIRED as the only producer writer.
- `/search-first`: USED through GitNexus/targeted repository search.
- `/context-gatherer`: USED.
- `/understand-codebase`: USED.
- `/quick-spec`: USED by this dispatch.
- `/backend-patterns`: USED for adapter/service boundaries.
- `/frontend-patterns`: USED only for the health component.
- `/deployment-patterns`: USED for local runtime lifecycle and rollback.
- `/security-review`: REQUIRED.
- `/verification-loop`: REQUIRED.
- `Design`, `/gpt-taste`, `/design-taste-frontend`,
  `/stitch-design-taste`: BOUNDARY_ONLY for a compact, accessible,
  design-system-consistent health panel; no redesign or new dependency.

No push, main merge, deploy, publish or install is authorized.
