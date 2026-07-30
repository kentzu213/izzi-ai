# Personal Office Deterministic Model Gateway

Status: implementation artifact for Loop 06
Contract version: `MODEL_ROUTE_CONTRACT_VERSION = 1`
Runtime boundary: desktop main process

## Product contract

The model gateway turns the existing managed/custom switch into one explicit,
request-scoped route. `ProviderResolver.resolveRoute()` is the sole route authority
for `AgentService`. It returns:

- one `ChatProvider` bound to the resolved endpoint and model; and
- one immutable, secret-free `ModelRouteDecision`.

The provider and decision are resolved once before provider access. A runtime failure
surfaces to the caller. The gateway never resolves again, changes provider, changes
model or crosses a billing/trust boundary during the request.

## Routing behavior

| Stored state | Result |
|---|---|
| Custom disabled | Explicit managed route |
| Custom enabled, config missing | Typed `custom-config-missing` rejection |
| Custom enabled, config invalid | Typed `custom-config-invalid` rejection |
| Custom enabled, key missing | Typed `custom-key-missing` rejection |
| Custom enabled, valid normalized config and key | Custom route |
| Managed config unreadable or malformed | Typed `managed-config-invalid` rejection |
| Managed endpoint not an official Izzi HTTPS endpoint | Typed `managed-endpoint-invalid` rejection |
| Managed model contains control characters or exceeds the bound | Typed `managed-model-invalid` rejection |

Enabled-invalid custom state never falls back to managed. This is intentional: managed
and custom routes can use different credentials, billing and trust boundaries.

## Decision evidence

Each version-1 decision contains only:

- route kind;
- provider kind;
- endpoint origin and endpoint class;
- normalized model ID;
- streaming/tool capability decision;
- credit-policy class;
- retry policy;
- reason code;
- deterministic SHA-256 decision hash.

The hash is computed over canonical JSON evidence with stable field ordering. It is
deterministic evidence for the route inputs, not a signature or proof of authority.

`endpointOrigin` is an origin only. Decisions and diagnostics never contain an endpoint
path, query, fragment, userinfo, API key, authorization header or raw provider body.

Managed Izzi routes use the existing model credit policy. Custom routes are classified
as `provider-native`, including a custom configuration that happens to target an
official Izzi host, because the credential and billing relationship remain
user-configured.

## Endpoint validation

Custom OpenAI-compatible base URLs are normalized in the main process. Supported input
shapes are:

- an origin root;
- an optional path prefix ending in `/v1`;
- the exact corresponding `/v1/chat/completions` path.

Remote endpoints require HTTPS. Plain HTTP is accepted only for the exact textual
loopback hosts `localhost`, `127.0.0.1` and `[::1]`. New routes do not accept DNS
aliases such as `host.docker.internal`; the one-time legacy migration still recognizes
that retired spelling so it can disable an old automatic route without deleting its
stored settings.

Validation rejects:

- URL userinfo or credentials;
- query strings and fragments;
- unsupported schemes;
- remote plain HTTP;
- non-exact textual loopback aliases;
- control characters and backslashes;
- encoded or ambiguous paths;
- dot segments and duplicate path separators;
- unsupported endpoint suffixes;
- empty, control-bearing or oversized model IDs.

Official Izzi classification requires HTTPS, the default HTTPS port, no credentials,
query or fragment, and the exact host `api.izziapi.com` or `izziapi.com`. Izzi source
and idempotency headers are not added to any other URL.

Managed routing is stricter than custom routing: its normalized endpoint must classify
as `official-izzi-https`. A configured custom origin in the local managed-provider file
is rejected before network access even when it includes a local API key.

## Frozen request routes

Custom provider construction validates and freezes the normalized configuration,
endpoint and retry policy.

Non-secret custom configuration is normalized before it is saved. On read,
`ProviderSettingsStore.getConfigValidation()` preserves the typed distinction between
missing and invalid storage without returning raw stored values. `getConfig()` returns
only a validated, normalized configuration or `null`; malformed JSON and rejected URL
bytes therefore cannot cross `customProvider:getConfig`, provider construction or the
host-agent caller. The one-time legacy migration may inspect raw stored configuration
privately only to disable the retired local Codex-LB route.

Managed routing reads the local provider configuration once. The resulting endpoint,
model and local credential source are captured in a request-only closure before the
stream starts. Later changes to the configuration file cannot alter that request.
Gateway-auth fields from the local file are ignored; only the provider credential or
the current authenticated access token can authorize the official managed request.

The request-scoped route is recorded as a secret-free `agent.model-route` diagnostic
before provider streaming. Errors remain on the selected route and are recorded
without raw response data.

## Existing custom-only host boundary

The pre-existing `customProvider:chat` IPC and `runHostAgentTurn()` path is a
custom-only host-agent surface, not a second managed/custom route selector. It requires
the custom-provider toggle to be enabled, consumes only normalized configuration from
`ProviderSettingsStore.getConfig()`, and fails as not configured when stored
configuration or the custom credential is unavailable. Its shared chat URL helper
also revalidates the normalized endpoint and fails closed with
`ModelRouteResolutionError` if called with invalid input.

This host-agent surface does not select, invoke or fall back to the managed provider.
It also does not emit the version-1 `agent.model-route` decision diagnostic. Bringing
that legacy custom-only execution surface under the route-decision record would
require a future IPC/host-agent change; those protected Loop 05 files remain outside
Loop 06.

## Retry contract

The only retry policy is:

`same-route-exact-streaming-limitation-once`

It is available only for `official-izzi-https` endpoints. A retry occurs only when the
first response is HTTP 400 with valid JSON whose `error.message` exactly matches one
of the two known streaming-compatibility messages in the version-1 gateway contract.
Broad regular expressions, plain text and near matches do not retry.

The retry:

- occurs at most once;
- uses the same provider and endpoint;
- uses the same model;
- retains the same message and payload field identities;
- retains the same idempotency key;
- changes only `stream: true` to `stream: false`.

Custom HTTPS and loopback routes never use this compatibility retry. Any retry failure
surfaces immediately; there is no second retry or provider/model fallback.

## Error and secret boundary

`ModelRouteResolutionError` carries a stable error code and typed reason without
copying configuration values. Provider HTTP errors expose only the HTTP status and a
generic category. Transport errors expose only a timeout or generic connection
failure. Raw remote bodies, transport messages, URLs and credentials are not reflected
into thrown errors, returned connection-test messages, diagnostics or logs.

API keys remain inside `SecretStore` and transient provider construction. The route
decision is safe to serialize and persist as diagnostic metadata.

## Scope exclusions

Loop 06 does not add a provider SDK, package, database/schema change, IPC or preload
registration, renderer surface, account mutation, billing mutation, network-backed
test, deployment or host-context change. The accepted Loop 05 `host-agent.ts` and
context tests remain byte-identical.

`AgentService` consumes only the route decision and existing chat history. It does not
add a second context compiler or modify prompt roles.
