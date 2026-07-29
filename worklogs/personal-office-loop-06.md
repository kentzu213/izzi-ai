# Loop 06 — Deterministic model gateway

Status: `READY_FOR_REVIEW`
Branch: `feature/personal-office-loop-06-20260729`
Worktree: `F:\Ai Tools\_wt-starizzi-personal-office-loop06`
Branch base: `208ccbd11e5cac88977f2770684cb8a1f5d438b5`
Lease: `LEASE-L06-MODEL-GATEWAY-20260729`

## Outcome

Loop 06 replaces the implicit managed/custom provider switch with one versioned,
deterministic and request-scoped route decision. Custom disabled selects an explicit
managed route. Explicitly enabled custom routing fails closed on missing or invalid
configuration or a missing key and never crosses the credential, billing or trust
boundary by silently falling back to managed.

The selected provider, endpoint, model, credential source and retry policy are frozen
once per request. `AgentService` records a secret-free `agent.model-route` decision
before streaming. The decision contains only normalized origin, provider/model and
capability/credit/retry evidence plus a canonical SHA-256 hash.

Custom URLs are normalized and validated in main. Remote routes require HTTPS; plain
HTTP is limited to the exact textual loopback hosts `localhost`, `127.0.0.1` and
`[::1]`. Userinfo, query, fragment, controls, backslashes, encoded or ambiguous paths,
dot segments, duplicate separators and unsupported suffixes fail closed. Managed
routing is stricter and accepts only official Izzi HTTPS.

The only retry is the exact known JSON HTTP 400 streaming incompatibility. It occurs
once on the same endpoint/provider/model/messages/idempotency key and changes only
`stream: true` to `stream: false`.

## Commits

- Phase 1: `e36bb4a740a6626c8c58f55888419e0723a99e79` —
  `feat(agent): add deterministic model gateway`
- Phase 2: this commit —
  `docs(personal-office): hand off Loop 06 model gateway`

Phase 1 contains 18 implementation, test and product-contract paths with 1675
insertions and 299 deletions. Phase 2 contains only this worklog and
`docs/handoffs/personal-office/loop-06.json`.

## Security gate

`SECURITY GATE: provider/billing boundary / endpoint validation / secrets / retry`

Decision: **PASS_FOR_W0_REVIEW**.

- Enabled-invalid custom state returns stable typed failure reasons and never invokes
  managed fallback.
- Managed routing rejects non-Izzi origins before network access, reads configuration
  once and ignores gateway-auth fields.
- Official Izzi source/idempotency headers require canonical HTTPS and an exact
  official host.
- Provider HTTP errors, transport errors, diagnostics and decisions do not reflect
  raw remote bodies, transport messages, credentials, queries or fragments.
- Persisted invalid configuration no longer escapes: `getConfig()` returns only
  normalized valid configuration or `null`; `getConfigValidation()` preserves typed
  missing versus invalid state without returning raw stored bytes.
- Retry matching is exact JSON text and preserves request identity.
- The added-line secret-pattern scan found 0 hits.

## Review correction

The initial independent security review returned **BLOCK** for two reasons:

1. The protected `customProvider:chat`/`runHostAgentTurn()` path does not emit the new
   `ProviderResolver` decision diagnostic.
2. Raw persisted invalid custom URLs could be returned by `getConfig()`.

The actionable storage exposure was corrected. Stored configuration is now validated
and normalized on read, raw invalid bytes remain private, and the shared chat/models
URL helpers fail closed. Regression tests cover a persisted query-secret URL and an
invalid host URL-helper call.

Read-only inspection confirmed the other seam is custom-only: it requires the custom
toggle, consumes `getConfig()`, and has no managed-provider branch or fallback. The
product contract now documents that it does not emit the v1 route decision and retains
the protected Loop 05 retry behavior. Changing that seam requires a future exact lease
for `main/index.ts` and `host-agent.ts`.

The follow-up independent security review returned **PASS** with no actionable blocker
inside the authorized Loop 06 files.

The dispatch-required final Socrates challenge also returned **PASS** for Phase 1. It
confirmed the committed selector and classified the protected host seam's bounded
response-body reflection, broader legacy streaming matcher and missing v1 diagnostic
as future exact-lease risks rather than a managed/custom routing bypass. The reviewer
performed read-only commit/diff/scope checks and did not independently assert the
producer's test counts.

## Verification

| Check | Result |
|---|---|
| Focused gateway/provider tests | **PASS — 6 files, 80/80 tests** |
| Protected Loop 05 host regressions | **PASS — 2 files, 10/10 tests** |
| Targeted production TypeScript | **PASS — 0 diagnostics** |
| Targeted test TypeScript | **PASS — 0 diagnostics** |
| Targeted ESLint | **PASS — all 17 changed TypeScript files** |
| Ownership/prohibited paths | **PASS — 18/18 authorized, 0 unauthorized, 0 prohibited** |
| `git diff --check` | **PASS** |
| Secret-pattern scan | **PASS — 0 hits** |
| Protected Loop 05 Git blobs | **PASS — all three expected SHA-1 values preserved** |
| Independent security follow-up | **PASS** |
| Fresh GitNexus staged detection | **REVIEWED — 18 files, HIGH expected routing surface** |

The host regressions used a temporary test-only Axios alias to the read-only baseline
toolchain because this isolated worktree has no complete dependency installation. The
alias file was removed before Phase 1. No install, dependency junction, manifest or
lockfile write occurred.

Full desktop tests and the production build remain W0 integration checks on a complete
dependency tree, as required by the dispatch.

## Canonical artifacts

The handoff records SHA-256 and byte length for all 18 exact Phase 1 Git blobs. Values
were computed from `git show e36bb4a:<path>` bytes and are independent of checkout line
endings.

Protected Loop 05 Git blob SHA-1 values remain:

- `host-agent.ts`: `b1130560b15a27b22b709e845b4b2069cd123cb9`
- `host-agent.context.test.ts`: `775f1980675babdd706dc5ab8fabd094ec63b548`
- `host-agent.streaming-fallback.test.ts`:
  `f5ab0bc46fdd60d106bae429279f96c3bf14d408`

## Process audit

Codex remained the sole Loop 06 writer. W0 retained orchestration, lease and acceptance
authority. The builder used the verification loop for the final build/type/test/lint,
security, smoke and diff gates. An independent security reviewer produced the initial
block and final pass. Backend, UI, design and deployment concerns were treated as
scope boundaries: no renderer, package, DB/schema, IPC registration, deployment,
integration ledger, lease registry or quarantine change was made.

## Residual risks

- The protected custom-only host seam lacks the version-1 route diagnostic, may reflect
  a bounded portion of a remote response body in legacy errors, and retains its older
  broader retry. It cannot select managed; changing it is future leased work.
- The decision hash is deterministic integrity evidence, not authentication.
- Full desktop build/suite and integration graph checks remain W0 duties.
- A user-configured custom route to an official Izzi host remains `provider-native`
  for credit classification even though strict official headers and retry apply.

## Handoff

W0 should verify Phase 1 commit `e36bb4a`, all 18 canonical blob hashes, the two-file
Phase 2 scope and the clean tree. W0 should then replay onto the current integration
tip, run the full desktop suite/build and either return concrete findings or create the
Loop 06 acceptance artifact.

`READY_FOR_REVIEW` is not `ACCEPTED`.
