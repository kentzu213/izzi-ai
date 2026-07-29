# Loop 05 — Context compiler and host-agent kernel

Status: `READY_FOR_REVIEW`
Branch: `feature/personal-office-loop-05-20260729`
Worktree: `F:\Ai Tools\_wt-starizzi-personal-office-loop05`
Base: `aa58848`
Lease: `LEASE-L05-CONTEXT-KERNEL-20260729`

## Outcome

Loop 05 now provides a deterministic, canonical and bounded context package for one
explicit Personal Office workspace, owner and model turn. It consumes the accepted
Live Profile precedence and `effectiveLiveDirectives` behavior read-only, records
expiry/truncation decisions, rejects forbidden classifications and credential-shaped
material, and appends only one delimited system segment.

The safety prompt and current text request are mandatory hash-bound items but are not
copied into that segment. The optional host seam binds the package to the exact host
system prompt and untouched raw text request before network access. The compiler does
not trim or Unicode-normalize that protected request; its canonical JSON string literal
is hashed and compared with the exact string placed in the provider payload. This
binding is text-only: context plus any image fails closed before provider or network
access. There is no production caller yet because the current tree has no authorized
source for both authenticated owner and explicit workspace.

Managed `AgentService` injection is intentionally absent. Its stored history has no
authoritative system prompt, and chat sessions have no accepted workspace identity.
That path requires a future contract and lease.

## Implementation commit

- `f69ff7d3b0415480a7ef217ce142d0f71f727e6b` —
  `feat(context): add deterministic Personal Office kernel`
- 14 implementation/product paths, 2831 insertions and 3 deletions.
- `apps/desktop/src/main/agent/agent-service.ts` has zero content diff.
- This phase-2 commit contains only this worklog and
  `docs/handoffs/personal-office/loop-05.json`.

The six recorded output hashes and sizes are the SHA-256 digests and byte lengths of
the exact Phase 1 Git blob bytes obtained through raw `git cat-file` output. They are
independent of checkout line endings.

## Security gate

`SECURITY GATE: scope / prompt roles / secrets / forged packages / budgets / snapshots`

Decision: **PASS_FOR_W0_REVIEW**.

- Exact workspace and owner scope is mandatory and never inferred.
- Unknown shape, protected-role changes, provenance/layer mismatch and forbidden
  classifications fail closed.
- System text is reconstructed from validated items and compared byte-for-byte.
- The protected current request is preserved exactly. Trailing whitespace, line-ending
  changes and canonically equivalent NFC/NFD strings produce different bindings and
  fail before provider access.
- Caller budgets cannot exceed the compiler ceilings: 256 sources, 128 rendered
  items, 130 package items, 1024 decisions and 128 KiB.
- IDs, provenance and scope headers reject credential-shaped values and reserved
  delimiters. `SecretRef` remains opaque and unrendered.
- Canonical ordering is locale-independent.
- Snapshot IDs bind workspace, owner, content hash and optional run ID. Returned Work
  Engine metadata must match exactly.
- `contentHash` is integrity/content-addressing only. It is not authenticity.

## Review corrections

The first pre-review blocker showed that an unkeyed hash alone was insufficient: a
caller could append system text and recompute the public hash. Verification now
reconstructs the segment from validated items, checks item hashes and exact bytes, and
enforces compiler-owned ceilings. Regression tests cover self-rehashed text, forged
budgets and arrays, credential-bearing metadata and locale-sensitive ordering.

Independent Socrates then blocked the managed service seam. Normal DB history contains
no trusted safety-system row, while `ChatSession` has no workspace binding. The
production edit and its test were removed completely. W0 re-reviewed the corrected
tree and returned **PASS**. The review history is therefore:
managed `AgentService` seam **BLOCK** → removed → re-review **PASS**.

A final Work Engine review found that repository conflict updates do not replace
`run_id`. Snapshot IDs now include optional `runId`, preventing the same context hash
from aliasing two runs, and the adapter rejects mismatched returned metadata.

A subsequent multimodal binding review returned **BLOCK** because images affect the
provider payload but were not included in the text-request hash. The host seam now
fails closed when context and any image are supplied, and a regression proves the
failure happens before `fetch`. That history is: multimodal binding **BLOCK** →
fail-closed correction → **CORRECTED_READY_FOR_REVIEW**. Canonical hashing of the full
multimodal user payload remains deferred; future host wiring must reject images until
that contract exists.

The latest security review returned **BLOCK** because `current_request` was trimmed and
NFC-normalized for hashing while the host sent the raw message. The compiler now keeps
the protected request untouched and hashes its canonical JSON string literal; the
kernel applies the same exact rule to the outgoing string. Regressions prove a trailing
space and canonically equivalent NFC/NFD strings cannot reuse another request binding
and fail before `fetch`, while an exactly bound request ending in newline and space is
sent unchanged. That history is: exact request binding **BLOCK** → exact raw-string
correction → **CORRECTED_READY_FOR_REVIEW**.

## Verification

| Check | Result |
|---|---|
| Producer context/compiler/kernel/snapshot tests | **14/14 passed**, 3 files, `--no-cache` |
| Corrected host seam tests | **5/5 passed**, including raw preservation, whitespace/NFC-NFD mismatch, image/no-network |
| Isolated main/shared TypeScript | **PASS**, current correction plus prior producer/W0 |
| Targeted ESLint | **PASS**, current correction plus prior W0 13-file pass |
| `git diff --check` | **PASS** |
| Ownership/prohibited paths | **PASS**, 14/14 authorized, AgentService zero diff |
| Production secret/log scan | **PASS**, only deliberate fixtures/test-key in tests |
| Socrates/security review history | Managed seam **PASS** after removal; exact-request correction **READY_FOR_REVIEW** |

Producer checks used `NODE_DISABLE_COMPILE_CACHE=1`, no install, no dependency junction
and no worktree-local cache. An earlier verification cache and two temporary junctions
were inspected and cleaned by W0; three sampled baseline toolchain files were re-hashed
with no byte or timestamp drift. The permanent quarantine and Loop 09 worktree were not
modified by Loop 05.

Full desktop tests/build remain W0 integration duties. GitNexus reported critical
fan-out through the existing `runHostAgentTurn` symbol on an 11-commit-stale baseline
index; the new context symbols were not indexed. Post-correction `detect_changes` saw
the four expected files but mapped zero symbols. This correction did not change the
host signature or host production source. W0 should run the authoritative graph pass
after integration.

## Process audit

`/search-first`, `/context-gatherer`, `/quick-spec`, `/backend-patterns`,
`/security-review`, `/verification-loop` and `/understand-codebase` were used directly
for contract discovery, bounded design, fail-closed validation and evidence.

`/frontend-patterns`, `/deployment-patterns`, `Design`, `/gpt-taste`,
`/design-taste-frontend` and `/stitch-design-taste` were boundary checks only. They
prevented renderer, design-system, dependency, install and deployment scope creep.

W0 acted as orchestrator and acceptance authority; W3 builder owned only the leased
implementation paths. Socrates rejected the unsafe managed seam and passed that
correction. The latest Socrates-role exact-request challenge ran in-process because
the root agent limit was full and returned **CORRECTED_READY_FOR_REVIEW**.

## Handoff

W0 should verify `f69ff7d`, hashes and exact paths, replay onto the current integration
tip, run full desktop tests/build plus authoritative GitNexus, and then either reject
with concrete findings or create
`docs/handoffs/personal-office/acceptance/loop-05.json`.

`READY_FOR_REVIEW` is not `ACCEPTED`.
