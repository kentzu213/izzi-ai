# Decision — Loop 17 WebSocket authority

Status: `WEBSOCKET_AUTHORITY_NOT_REQUIRED_FOR_V1`

Decision authority: W0 Control Tower / Codex

Scope: Personal Office managed browser runtime only.

## Decision

Personal Office v1 does not grant WebSocket authority to the managed browser
runtime. The existing deny-all `routeWebSocket('**/*')` boundary remains
mandatory. No runtime-contract field, capability mapping, schema-version bump
or production registration is required for WebSockets in Loop 17.

This closes the optional WebSocket gate for v1; it does not enable a socket.

## Consumer inventory

The accepted v1 browser path is bounded to:

- Marketplace completed-install evidence;
- exact connected IntegrationGrant evidence;
- an exact `BrowserRuntimeSpec`;
- allowlisted HTTP(S) read/navigation;
- reviewed Work approval;
- one endpoint-specific, idempotent HTTP(S) submit;
- durable receipt and encrypted browser-state cleanup.

No Marketplace operation, IntegrationGrant operation, Work contract, workspace
blueprint, runtime authority, product workflow or production composition
declares a `ws:`/`wss:` endpoint or requires a persistent socket.

`BrowserRuntimeSpec` and `RuntimeNetworkPolicy` contain no socket authority,
subprotocol, message direction, lifetime or data-classification field.
Production also registers no managed browser driver.

The existing `.ocx` `net.websocket` permission is a separate host-mediated
extension capability. It is not transitive authority for the Personal Office
managed browser runtime and cannot be used to bypass this decision.

## Enforced behavior

- Every browser-context WebSocket route is closed, including a socket whose
  mapped HTTPS origin appears in the HTTP allowlist.
- HTTP origin approval does not imply WebSocket approval.
- Missing socket authority fails closed; there is no compatibility fallback.
- The decision changes governance documents only. It authorizes no dependency
  install, package/lockfile write, driver registration, browser launch, network
  request, secret retrieval or external effect.

## Reopening requirements

A future workflow that genuinely requires WebSockets must submit a new contract
change request before implementation. At minimum it must identify:

1. the concrete product consumer and why bounded HTTP(S) is insufficient;
2. exact `ws:`/`wss:` origins, ports and subprotocols;
3. message directions, schemas, size/rate/time budgets and data classification;
4. authentication and secret-reference handling;
5. approval, revocation, reconnect, cancellation and cleanup semantics;
6. idempotency or reconciliation behavior for socket-triggered effects;
7. audit evidence that excludes raw credentials and session material;
8. targeted abuse tests plus independent security review.

Until that contract is accepted and a separate exact-path lease is granted,
the deny-all driver behavior is permanent.

## Evidence

- `apps/desktop/src/shared/runtime/types.ts`
- `apps/desktop/src/main/runtime/managed-playwright-driver.ts`
- `apps/desktop/src/main/runtime/managed-playwright-driver.test.ts`
- `apps/desktop/src/main/runtime/operational-browser-service.ts`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/main/capabilities/policy-catalog.ts`
- `docs/product/personal-office-capabilities.md`

The repository code index was unavailable/degraded for this worktree, so the
inventory used exact-path source search and direct contract/registration
inspection. No source symbol was changed.
