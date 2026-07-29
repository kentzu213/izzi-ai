# Personal Office Context Compiler and Agent Kernel

Status: implementation artifact for Loop 05
Schema authority: `PERSONAL_OFFICE_SCHEMA_VERSION`
Runtime boundary: authenticated main-process workspace and owner scope

## Product contract

The context compiler turns accepted Personal Office inputs into one deterministic,
bounded package for a single workspace, owner and model turn. It consumes the Live
Profile and Work Engine contracts read-only; it does not define a second profile,
run or persistence model.

Compilation follows the accepted precedence exactly:

1. safety/system;
2. current user request;
3. workspace policy;
4. global `Live.md`;
5. learned preference;
6. model default.

The compiler calls `effectiveLiveDirectives` at the explicit `compiledAt` timestamp.
It does not reparse `Live.md`, revive expired directives or bypass proposal,
supersession and learning-consent decisions.

## Prompt-role boundary

The base safety prompt and current request are mandatory hash-bound items, but neither
is copied into the appended context segment. The host seam keeps the base prompt as the
first system message and the exact raw current text request as a user message.

The compiler does not trim or Unicode-normalize the protected current request. Its
item hash covers the canonical JSON string literal of the exact JavaScript string that
the host places in the provider payload. The verifier hashes the outgoing string by
the same rule and compares byte-for-byte evidence before provider access. Trailing
whitespace, line-ending changes and canonically equivalent but code-point-distinct
Unicode therefore produce different bindings. The host never rewrites the user's
outgoing message to make a compiled context match.

This binding is text-only. If a context-bearing host turn contains any image reference,
the host throws before provider access. Multimodal context remains deferred until the
complete text-and-image payload has a canonical hash contract; hashing only the text
would not bind the actual user request.

Only workspace policy, effective Live directives, learned preferences and model
defaults can render inside:

```text
<<<START_PERSONAL_OFFICE_CONTEXT>>>
...
<<<END_PERSONAL_OFFICE_CONTEXT>>>
```

The segment carries an explicit instruction that it cannot override safety, system
instructions, tool permissions or the current user request. Runtime verification
reconstructs this segment from validated items and requires byte-for-byte equality;
adding text and recomputing the public hash is not sufficient.

## Determinism and budgets

Metadata and renderable context inputs use NFC-normalized strings, exact ISO UTC
timestamps, allowlisted fields and stable canonical JSON ordering. The protected
current request is the deliberate exception: it is preserved exactly and its raw
string identity participates in the package hash. For the same validated inputs and
compile time, the package, decisions, system segment and content hash are identical.

Compiler-owned hard ceilings are:

- at most 256 explicit sources;
- at most 32 KiB per source;
- at most 128 rendered context items;
- at most 130 package items including the protected safety/request bindings;
- at most 1,024 compile decisions;
- a system-segment budget from 512 bytes through 128 KiB.

Candidates are sorted by accepted precedence and stable item ID. Selection stops at
the first item or byte overflow; lower-precedence candidates are not used to skip
around an oversized higher-precedence item. Every expired, non-effective, included or
truncated item has an auditable decision.

The kernel rechecks these hard ceilings. It does not trust caller-supplied budget
values, array lengths or item hashes.

## Scope, classification and secrets

Every source, compiled item, kernel input and snapshot is bound to an explicit
`workspaceId` and `ownerId`. Missing or mismatched scope fails before model or snapshot
access.

Only `public_metadata` and `personal_graph` data may enter model context.
`local_files`, `artifacts`, `secrets` and `audit_events` classifications fail closed.

Credential-shaped values and reserved delimiters are rejected in content and in every
metadata field rendered into the segment, including item IDs, provenance and scope
headers. `SecretRef` values remain opaque references: they may be carried in the
package for audit, but their store references and scopes are never rendered or
resolved by the compiler.

## Hash semantics and trust

`contentHash` is SHA-256 over the canonical unsigned package. It provides deterministic
content addressing and integrity checking against accidental or unreviewed mutation.
It is **not authenticity**, a signature or proof that a trusted principal produced the
package. Any holder can recompute an unkeyed hash.

For that reason, the kernel does not rely on the hash alone. It validates the complete
package shape, exact scope, protected roles, classifications, provenance shape,
per-item content hashes, hard budgets and canonical segment reconstruction. A future
boundary that accepts context from another process or trust domain must add its own
authorization and, if origin proof is required, an authenticated signature or
equivalent trusted channel.

## Work Engine snapshot boundary

`WorkContextSnapshotAdapter` writes only deterministic metadata through the accepted
`upsertContextSnapshot` API:

- a scope-, content- and optional run-derived snapshot ID;
- workspace and optional run ID;
- package content hash;
- fixed source label;
- item/byte summary;
- content-addressed reference.

It never persists the context body, safety prompt, current request or rendered system
segment, and it verifies the Work Engine response before returning it.

## Integration boundary

Loop 05 adds one optional seam to the existing host path. Calls without context retain
their previous behavior. No production compiler wiring is added because the current
tree has no authorized source that supplies both an authenticated owner and an explicit
workspace for host-agent calls.

Managed `AgentService` injection is deliberately deferred. Persisted chat history has
user and assistant messages but no authoritative safety-system message, and a chat
session has no accepted workspace identity. Allowing caller-supplied context there
would either fail for normal sessions or permit same-owner context from the wrong
workspace. A later contract and exact seam lease must bind both the trusted managed
safety prompt and session workspace before that path can consume compiled context.

This loop does not change provider/model routing, fallback behavior, headers, host
tools, tool permissions, approval policy, database/schema, IPC/preload, renderer,
package manifests, dependencies or deployment. A later leased integration must compile
from authenticated main-process state, pass the exact current safety prompt and raw
text-only user request without normalization, capture snapshot metadata through the
Work Engine, and fail closed before any provider call. Multimodal context requires a
separate canonical full-payload binding before it can be enabled.
