# Izzi AI Marketing Room - Master Task List

Status date: 2026-08-27 (Asia/Ho_Chi_Minh)

This file is the execution task list for the customer-facing Izzi AI Marketing Room. The older `CUSTOMER-AI-MARKETING-ROOM-PLAN.md` remains the historical product rubric; current delivery state, owners, dependencies, and evidence are maintained here.

## North Star

Give an IzziAPI customer one low-cost, approval-gated marketing workspace that can prepare, review, and safely distribute content across connected channels. Credentials remain behind main-process/backend boundaries, external actions stay fail-closed, and every completed milestone is tested, published, installed, and recorded.

## Operating Rules

- Codex owns orchestration, state, integration, verification, release, and user reporting.
- Claude Code is required only for deep T2/T3 technical work unless the user explicitly authorizes `relaxed_mode`; Codex remains the sole orchestrator, integrator, verifier, and reporter.
- No ChatGPT web lane unless the user explicitly requests it in that task.
- Fable is the default Claude lane; only the configured Claude-lane Fable to Opus 5 fallback is allowed for quota/rate-limit/overload.
- Never run a real post, upload, spend, bulk send, or destructive external action in smoke tests without a separately bounded approval.
- Finish each milestone as a small public release: focused tests, full relevant checks, build, installer smoke, GitHub update, and evidence.
- Video/F5-TTS commercial production remains deferred. Local preview/runtime evidence is retained, but it is not a marketing launch dependency.

## Verified Baseline

### MKT-00 - Customer Marketing foundation [done]

- Tenant-safe Customer Marketing Room, typed IPC, onboarding, goals, approvals, AI Director boundary, capability registry, Brand Center, workflow API/bridge, quota and billing provenance, hard entitlement, retry recovery, local cross-device harness, renderer performance and ESLint gates are implemented and locally verified.
- The backend schema/migrations and remote routes are public, but remote staging/production deployment is not claimed.

### MKT-01 - Channel connection center [done]

- Public baseline: `v1.14.0-beta.52`, commit `5735952`.
- Marketing Channels now has the Auto Post master control, Facebook Test Page, YouTube Private, Telegram Sandbox, role guards, clear retry states, and redacted OAuth boundaries.
- Beta.53 UX correction: the first-run bridge state no longer calls `listAccounts()` before Auto Post is connected; the Home view links directly to the connection center; OAuth feedback and the reload action are visible above the fold; the provider vault heading is distinct.
- Current evidence: Claude technical audit/gate `izzi-ai-marketing-channel-ux-20260821`, connection contract `15/15`, room contract `16/16`, renderer typecheck, lint, and build pass. GitHub CI and Release Desktop passed; public release `v1.14.0-beta.53`, commit `ba57eac`, installer SHA-256 `4bf2b11d88d5913c1791ed5c884389a7f6858ac44c85c5ed0a56f777ece27d1c`, installed FileVersion `1.14.0-beta.53` at `F:\IzziAI\Izzi\Izzi AI.exe`, and packaged smoke opened `AI Marketing → Kênh → Trung tâm kết nối`. Full local suite `1576/1577` is blocked only by the local `better-sqlite3` Node ABI mismatch (`140` binary vs `137` runtime), unrelated to this renderer change; GitHub Desktop CI passed its full test job.

## Ordered Backlog

### MKT-02 - Integration authority and provider routes [in_progress]

Goal: make every provider connection usable by the future marketing workflow without creating a second token authority.

Scope:

- Audit and close the gap between existing local credential vault/Telegram sandbox/Auto Post OAuth and the backend integration contract.
- Define provider-scoped grants, expiry, revoke, health receipts, audit records, and renderer-safe summaries.
- Add only bounded real route contracts for campaign/content/assets/knowledge integration; no publish executor is enabled by this task.

Progress checkpoint:

- Public baseline `v1.14.0-beta.58` includes the bounded native Auto Post import and its renderer error-narrowing patch.
- NM-011 candidate `1.14.0-beta.59` adds encrypted credential envelope v2 with workspace/provider binding, explicit `validate` and `sandbox_execute` permissions, a maximum 90-day grant, exact-expiry fail-closed behavior, and a renderer-safe grant digest/summary.
- Legacy credential envelopes without a scoped grant are reported invalid and require an explicit reconnect; no credential is silently upgraded into a new authority.
- Health, revoke, and Telegram canary readiness now inherit the grant state. Credential bytes remain inside main, and publish/spend/bulk execution is unchanged.
- Implementation and local evidence are recorded in `worklogs/2026-08-27-nm-011-provider-grant-v2.md`.

Acceptance evidence:

- Focused vault, grant, revoke, health, audit, RLS/PostgREST boundary tests pass.
- Renderer receives no token, OAuth URL, backend secret, or filesystem path.
- Packaged local staging proves configure -> health -> revoke -> audit with token bytes absent from renderer responses and logs.
- Publish, spend, bulk send, and commercial render remain denied.

Dependencies: none for local implementation. Remote deployment is a later task.

### MKT-03 - Live model execution for the seven-day workflow [pending]

Replace deterministic template-only drafts with approved, budgeted model execution behind the existing local feature flag. Preserve reviewer approval, per-run credit ceiling, tenant scope, retry idempotency, and fail-closed behavior.

Acceptance: local staging creates a model-backed draft, records cost/provenance, survives retry, and never performs an external action.

Dependencies: MKT-02 integration authority and existing Cockpit/Izzi API health.

### MKT-04 - End-to-end safety gate suite [pending]

Build the packaged-staging suite for publish/spend/bulk gates, integrations, billing reconciliation, recovery, console/network health, and Internal Marketing Room regression.

Acceptance: deterministic pass/fail receipt, zero secret leakage, zero unapproved external actions, and release CI coverage.

Dependencies: MKT-02 and MKT-03.

### MKT-05 - Staging deployment, security review, and reviewer approval [pending_external]

Deploy the reviewed backend migration and feature gate to a disposable staging environment using the lowest-cost approved host. Record host allowlist, secrets ownership, rollback, migration digest, security review, and reviewer sign-off.

Dependencies: MKT-04. Requires staging credentials, hosting choice, and reviewer approval; no production cutover is implied.

### MKT-06 - Remote cross-device proof and remote workflow enablement [pending_external]

Run the existing two-device proof against the deployed staging target, then enable the reviewed remote migration for authenticated workflow/model execution and verify revision conflicts, roles, quota, and approval persistence.

Dependencies: MKT-05.

### MKT-07 - First bounded sandbox external smoke [pending_user_approval]

Only after MKT-06, run one explicitly approved sandbox action: Facebook Test Page, YouTube Private, or Telegram Sandbox. Record exact scope, idempotency key, receipt, rollback, and spend `0 VND`.

Dependencies: MKT-02 through MKT-06. This task never becomes an unattended autopost loop by default.

### MKT-08 - Persistent GitNexus/CodeGraph operations [opportunistic]

Restore persistent MCP/index health for the active worktree, retain CLI/shell fallback, and add a small health receipt. This improves developer throughput but does not block customer marketing milestones.

## Release Gate Per Task

1. Read current repo state and task-specific instructions.
2. For Claude-routed T2/T3 work, obtain the current Claude Code receipt and pass the completion gate; for Codex-local or authorized `relaxed_mode`, record the route and verify independently.
3. Implement only the bounded task scope.
4. Run focused tests, full relevant tests, lint/build, security/diff checks, and packaged smoke when the task touches the desktop.
5. Update this task list and an evidence note.
6. Commit, push, tag a prerelease, wait for the GitHub release workflow, verify asset digests, install/open the release, and report the exact version.

## Current Next Action

Package and exercise NM-011 candidate `1.14.0-beta.59`, then continue MKT-02 with the smallest authenticated backend provider-route contract. Do not enable external publishing as a shortcut.
