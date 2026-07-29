# Loop 06 dispatch — Deterministic model gateway and provider routing

## Control-plane authority

- Integration ref: `feature/personal-office-baseline-20260728`
- Dispatch base: integration ref containing Loop 05 acceptance (`9736e30c2cc23fe8d30676ef655dbc2a0f85cc46`)
- Producer branch: `feature/personal-office-loop-06-20260729`
- Producer worktree: `F:\Ai Tools\_wt-starizzi-personal-office-loop06`
- Lease: `LEASE-L06-MODEL-GATEWAY-20260729`
- Dependency: Loop 05 is ACCEPTED.
- Status authority: only W0 may set `ACCEPTED`.

Kiro/provider writers remain disabled. Codex is the only authorised producer for this lease until W0 records a different writer.

## Objective

Turn the existing managed/custom provider switch into one deterministic, auditable and fail-closed model gateway. Routing must be explicit, secret-free and stable for the lifetime of a request. It must never silently move an in-flight request to a different provider or model.

This loop hardens the current gateway; it does not add a new provider SDK, package, renderer page, billing system or model-training behavior.

## Existing seams to reuse

- `ProviderResolver` is the single managed/custom decision point.
- `ProviderSettingsStore` owns non-secret custom-provider settings.
- `SecretStore` remains the only raw-key authority and is read-only for this loop.
- `ManagedAgentProvider` and `CustomOpenAIProvider` implement `ChatProvider`.
- Loop 05 owns the accepted context kernel and `host-agent.ts`; Loop 06 must not reopen it.
- `model-credit-policy.ts` is the existing pure credit-copy policy and remains read-only unless W0 grants a later exact amendment.

## Exclusive write paths

- `apps/desktop/src/shared/model-gateway/**`
- `apps/desktop/src/main/agent/chat-provider.ts`
- `apps/desktop/src/main/agent/provider-resolver.ts`
- `apps/desktop/src/main/agent/provider-settings-store.ts`
- `apps/desktop/src/main/agent/custom-openai-provider.ts`
- `apps/desktop/src/main/agent/managed-agent-provider.ts`
- `apps/desktop/src/main/agent/izzi-request-headers.ts`
- `apps/desktop/src/main/agent/agent-service.ts`
- `apps/desktop/src/main/agent/custom-provider.test.ts`
- `apps/desktop/src/main/agent/managed-agent-provider.test.ts`
- `apps/desktop/src/main/agent/managed-agent-provider.production.test.ts`
- `apps/desktop/src/main/agent/izzi-request-headers.test.ts`
- `apps/desktop/src/main/agent/agent-service.routing.test.ts`
- `docs/product/personal-office-model-gateway.md`
- `docs/handoffs/personal-office/loop-06.json`
- `worklogs/personal-office-loop-06.md`

No other path is writable without a new exact W0 change request and lease amendment.

## Read-only inputs

- `apps/desktop/src/main/agent/secret-store.ts`
- `apps/desktop/src/main/agent/host-agent.ts`
- `apps/desktop/src/main/agent/host-agent.context.test.ts`
- `apps/desktop/src/main/agent/host-agent.streaming-fallback.test.ts`
- `apps/desktop/src/main/agent/agent-permissions.ts`
- `apps/desktop/src/main/agent/agent-tools.ts`
- `apps/desktop/src/shared/context/**`
- `apps/desktop/src/shared/model-credit-policy.ts`
- `apps/desktop/src/main/db/**`
- accepted Loop 05 and Loop 07 contracts

## Hard prohibitions

- No package manifest, dependency, install or lockfile.
- No DB/schema/migration, `main/index.ts`, preload or IPC registration.
- No renderer, App, Sidebar or shell change.
- No edit to Loop 05 `host-agent.ts` or context contracts.
- No raw secret persistence, logging, event payload, route record or error text.
- No account mutation, provider registration, billing mutation, remote configuration write or deployment.
- No cross-provider or cross-model fallback after a request starts.
- No broad retry. Only the already-known streaming-unsupported case may retry once, non-streamed, against the same endpoint/provider/model and same idempotency key.
- No quarantine write, merge, blind cherry-pick, push, main, deploy or publish.

## Required behavior

1. Define a strict versioned `ModelRouteDecision`/`ModelRouteRequirements` contract under `shared/model-gateway`.
2. Every decision must record only non-secret evidence: route kind, provider kind, endpoint origin/class, model id, capability decision, credit-policy class, retry policy, reason code and deterministic decision hash.
3. Custom disabled means explicit managed routing. Custom explicitly enabled with missing/invalid config or missing key must fail closed with a typed reason; it must not silently fall back to managed and change billing/trust boundary.
4. Provider/model selection is frozen for the request lifetime. A runtime failure surfaces to the caller; no route recomputation or provider/model substitution occurs.
5. Streaming-to-nonstream retry is same-route only, at most once, for the narrow recognised compatibility error. Preserve model, endpoint, payload identity and idempotency key.
6. Validate custom base URLs in main: HTTPS, or HTTP only for exact loopback hosts. Reject URL credentials, fragments, unsupported protocols and ambiguous endpoint shapes. Never include query/userinfo in logs or route records.
7. Keep API keys inside `SecretStore`/provider construction. Decisions, diagnostics, returned status and thrown errors must be redacted.
8. Preserve Loop 05 context bytes and prompt roles unchanged. `agent-service.ts` may consume a route decision, but may not add a second context path.
9. Reuse existing provider implementations and headers. Official Izzi headers apply only to exact official HTTPS hosts; untrusted custom origins get none.
10. Tests must use fakes only: no real provider, network, account, billing or secret side effect.
11. Use two-phase commits:
    - Phase 1: leased implementation, tests and product contract.
    - Phase 2: only `loop-06.json` and the worklog.

## Acceptance checks

- Deterministic decision/hash tests.
- Explicit custom-disabled managed route.
- Invalid/missing custom config/key fails closed without managed fallback.
- Exact endpoint classification and URL-smuggling tests.
- Same-route single retry and no cross-provider/model fallback tests.
- Secret redaction and no-secret decision serialization tests.
- Existing managed/custom provider tests remain green.
- Targeted TypeScript/lint/tests; full desktop tests/build at W0 integration.
- Exact ownership, prohibited-path, Git-blob hash and secret scans.
- Independent security review is mandatory.

## Required roles and skills

Use Socrates to challenge routing, billing and secret assumptions; orchestrator to sequence; builder to implement. Apply:

`/search-first /context-gatherer /quick-spec /backend-patterns /frontend-patterns /deployment-patterns /security-review /verification-loop /understand-codebase Design /gpt-taste /design-taste-frontend /stitch-design-taste`

Mark UI/design skills as boundary checks when no renderer output exists.
