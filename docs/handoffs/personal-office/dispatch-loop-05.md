# Loop 05 runnable handoff - Context compiler and agent kernel

Status: READY_TO_START
Base: current `feature/personal-office-baseline-20260728`
Lease: `LEASE-L05-CONTEXT-KERNEL-20260729`

## Goal

Compile the accepted workspace context into a deterministic, bounded and
auditable model-input package, then expose the smallest agent-kernel seam needed
to consume it. The compiler must preserve the accepted Live Profile precedence
and Work Engine snapshot contract without introducing model/provider routing,
database migrations or a second domain model.

## Exclusive write scope

- `apps/desktop/src/shared/context/**`
- `apps/desktop/src/main/context/**`
- `apps/desktop/src/main/agent/host-agent.ts`
- `apps/desktop/src/main/agent/host-agent.context.test.ts`
- `apps/desktop/src/main/agent/agent-service.ts`
- `apps/desktop/src/main/agent/agent-service.context.test.ts`
- `docs/product/personal-office-context-kernel.md`

Read-only:

- `apps/desktop/src/shared/live-profile.ts`
- `apps/desktop/src/shared/personal-office/**`
- `apps/desktop/src/main/live/**`
- `apps/desktop/src/main/work/**`
- `apps/desktop/src/main/agent/agent-tools.ts`
- `apps/desktop/src/main/agent/provider-*.ts`
- `apps/desktop/src/main/agent/*provider*.ts`
- `apps/desktop/src/main/db/**`

Prohibited: DB/schema/index/preload/renderer, provider selection or model
routing, tool permission semantics, package manifests, lockfiles, dependency
installation, deployment and quarantine.

## Required behavior

1. Compile context with the accepted order: safety/system, current user request,
   workspace policy, global Live.md, learned preference, model default.
2. Use `effectiveLiveDirectives` and `LIVE_CONTEXT_PRECEDENCE` read-only. Do not
   reparse Live.md or bypass proposal, consent, supersession or expiry rules.
3. Require explicit workspace and owner scope. A missing or mismatched scope
   fails closed; never default a tenant request to the personal workspace.
4. Produce deterministic canonical output with stable content hash, source
   provenance, classification, compile timestamp, expiry decisions and explicit
   byte/item budgets. The same inputs and compile time must produce the same
   output.
5. Raw credentials never enter compiled text, logs, snapshots or model
   messages. `SecretRef` remains opaque and unresolved. Reuse accepted
   redaction behavior and test credential-shaped inputs.
6. Keep the current user request in the user role. Kernel context may only add
   a bounded, clearly delimited system segment and cannot replace the base
   safety/system prompt.
7. The Work Engine remains the snapshot authority. Loop 05 may create an
   adapter that calls existing snapshot APIs, but may not edit `main/work/**`,
   persist duplicate context bodies or migrate the database.
8. Do not change provider selection, model fallback, request headers, tool
   permissions, approval policy or host tool definitions. Those belong to
   Loop 06/11.
9. Add focused tests for precedence, scope isolation, expiry, deterministic
   hashing, budget truncation, secret handling, prompt-role placement and
   fail-closed invalid input.
10. Use two-phase commits: implementation/artifact first, then handoff/worklog
    `READY_FOR_REVIEW`.

## Security gate

Fail closed on tenant/workspace ambiguity, owner mismatch, untrusted context
shape, prompt-role injection, system-prompt replacement, stale or expired
directives, secret material, unbounded context, nondeterministic ordering,
provider-routing edits, DB/schema changes and any unleased path.

## Verification

- Targeted context/compiler/kernel tests with cache disabled.
- Isolated TypeScript checks for main and shared profiles.
- Targeted lint when available.
- Full desktop tests and build if the isolated toolchain supports them without
  install or junction writeback.
- Ownership diff, prohibited-path audit, secret scan and `git diff --check`.
- Independent Socrates review before W0 integration.

## Mandatory process

Use Socrates to challenge scope, precedence and prompt-injection claims,
orchestrator for the bounded execution plan, and builder for implementation.
Apply:

`/search-first`, `/context-gatherer`, `/quick-spec`, `/backend-patterns`,
`/frontend-patterns`, `/deployment-patterns`, `/security-review`,
`/verification-loop`, `/understand-codebase`, `Design`, `/gpt-taste`,
`/design-taste-frontend`, `/stitch-design-taste`.

For this backend-only loop, frontend/design/deployment skills are boundary
checks only: they must prevent renderer, design-system, install and deploy scope
creep rather than create UI work.

Report gate, files, tests/typecheck/lint/build, ownership/security audit,
blockers and next handoff. No push, main merge, deploy, install or quarantine
write.
