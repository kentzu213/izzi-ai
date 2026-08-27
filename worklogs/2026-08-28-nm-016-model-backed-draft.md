# NM-016 Model-backed Marketing Director draft

Date: 2026-08-28 (Asia/Ho_Chi_Minh)

## Scope

Complete MKT-03 with the smallest model-backed draft path behind the existing
Customer Marketing staging profile. The feature creates one internal content
draft and stops at the existing reviewer approval. It does not enable publish,
schedule, send, bulk, spend, customer import, provider execution, integration
mutation, or any other external marketing action.

This continuation used `relaxed_mode` under the user's direct instruction to
work without Claude because Claude usage was exhausted. Claude Code and ChatGPT
web were not used. Codex implemented, integrated, verified, released, installed,
and reported the slice.

## Security gate

SECURITY GATE: authentication, temporary API credential, model billing,
idempotency, approval evidence, renderer IPC, and desktop release - risk: a
replayed model request could double-charge, malformed or fallback output could
be accepted as evidence, internal execution metadata could cross IPC, or a
draft path could accidentally expose an external executor; checked: fixed model
and reasoning route, one-credit reservation, same-key retry, strict JSON and
usage validation, served-model match, Brand Guardian, renderer redaction,
credential scan, dependency audit, release inventory, installer digest, retained
profile, installed UI smoke, and packaged live canary; decision: release only
the staging draft path and fail closed on every contradiction.

- Model tools are disabled and the model cannot invoke extension commands.
- The idempotency key is created in Electron main and stored only as a SHA-256
  digest in approval evidence.
- The renderer receives only the existing public reply/error shape; requested
  model, served model, usage, cost, and idempotency metadata stay in main-owned
  evidence.
- Each live canary created a bounded temporary IzziAPI key and revoked it in a
  `finally` path. No raw key appears in a receipt, log, source file, or commit.

## Implementation

- `apps/desktop/src/main/agents/izzi-agent.ts` accepts a validated main-owned
  idempotency key for non-tool requests, sends `reasoning_effort=high` for
  `gpt-5.6-sol`, validates bounded usage provenance, and strips execution data
  before renderer IPC returns.
- `apps/desktop/src/main/customer-marketing/customer-marketing-service.ts`
  enables the path only for the staging runtime profile, reserves one workspace
  credit, reuses the exact payload/key for one ambiguous network retry, parses
  an exact JSON draft schema, requires Sol requested/served identity, and binds
  cost/provenance/hashes to the pending approval artifact.
- Normal non-staging agent chat remains on `izzi/auto` normalized to
  `izzi-smart`. No production provider executor was introduced.
- Product PR [#16](https://github.com/kentzu213/izzi-ai/pull/16) merged at
  `78f133a24ffbe587faa46e4b230a9ca34627e6d0` after Windows and macOS CI passed in
  workflow
  [33116402078](https://github.com/kentzu213/izzi-ai/actions/runs/33116402078).

## Verification

- `pnpm --filter @openclaw/desktop test` passed all 1,730 tests across 126 files.
- `pnpm --filter @openclaw/desktop build` and
  `pnpm --filter @openclaw/desktop lint` passed.
- `pnpm --filter @openclaw/desktop test:marketing-staging-launcher` returned
  12 successful checks.
- `pnpm test:actions`, `pnpm test:renderer-budget`,
  `pnpm test:lint-config`, and `pnpm test:socrates` all passed.
- `pnpm audit --prod --audit-level high` reported no known vulnerabilities.
- The added-line credential-pattern scan returned zero matches;
  `git diff --check` and `node tools/socrates-tier1.mjs --changed` passed.
- GitNexus classified the aggregate cross-module chat/approval diff as critical.
  Direct impact was low for `IzziAgent.chat`, IPC, and constructor, while the
  shared approval-evidence revision had high impact. The full suite, both CI
  platforms, live canary, packaged canary, and installed smoke were therefore
  retained as mandatory gates.

## Live model evidence

The instrumented canary records only transport shape, route, usage, hashes,
run/approval state, and guardrail results. It never records model content or a
credential.

- A valid Brand Guardian rejection was observed and remained fail-closed at
  `brand_review_blocked`; the approval was not revised and no external action
  occurred. A later valid response passed the same guardrail, proving both the
  blocked and success paths without weakening policy.
- The final development canary receipt is
  `F:\Ai Tools\Codex\Temp\mkt03-live-canary-guardian-20260828-035701.json`.
- The final packaged-app canary receipt is
  `F:\Ai Tools\Codex\Temp\mkt03-installed-canary-beta63-20260828-042806.json`.
  It records `gpt-5.6-sol` requested and served with high reasoning, 645 prompt
  tokens plus 579 completion tokens, one quota reservation, one model call,
  tools disabled, a one-credit ceiling, valid evidence hashes, an
  `awaiting_approval` run, pending strategy approval, zero external marketing
  actions, and successful temporary-key revocation.

## Release and installation

- Release PR [#17](https://github.com/kentzu213/izzi-ai/pull/17) merged at
  `2930169bf77a425d5e630e5aebbd25302dc999c6` after workflow
  [33116750848](https://github.com/kentzu213/izzi-ai/actions/runs/33116750848)
  passed on Windows and macOS.
- Release workflow
  [33117009878](https://github.com/kentzu213/izzi-ai/actions/runs/33117009878)
  passed Windows packaging, macOS x64/arm64 packaging, and the exact 12-asset
  inventory gate before publishing
  [v1.14.0-beta.63](https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.63).
- The downloaded Windows installer SHA-256 was
  `b6c9ef3968f25b1b473dcd82708da012487c1cc3c84ff69af0f005e4ea49e0db`;
  `Get-FileHash` matched the GitHub asset digest before installation.
- Silent in-place installation completed with exit code 0 at
  `F:\IzziAI\Izzi\Izzi AI.exe`. FileVersion, the Windows uninstall registry,
  and the in-app updater all report `1.14.0-beta.63`; the retained profile and
  authenticated session survived.

## Installed smoke

The read-only installed smoke receipt is
`F:\Ai Tools\Codex\Temp\izzi-ai-beta63-installed-smoke.json`.

- Authentication was retained and updater state was `idle` with no newer
  version or updater error.
- Native Marketing remained bound to `backend_oauth`; all seven provider routes
  were workflow-ready, no provider was connected, and external execution stayed
  blocked.
- No IzziAPI request failure, console error, page error, or horizontal overflow
  was captured at 1280x900 or 390x844. The smoke invoked no OAuth flow and no
  provider action.
- Screenshots are stored at
  `F:\Ai Tools\Codex\Temp\izzi-ai-beta63-mkt03-desktop.png` and
  `F:\Ai Tools\Codex\Temp\izzi-ai-beta63-mkt03-compact.png`.

## Result

MKT-03 is complete. Izzi AI now has one released, installed, model-backed draft
path that is fixed to Sol high, budget-bounded, retry-idempotent, provenance
checked, Brand Guardian reviewed, approval gated, and unable to perform an
external marketing action. MKT-04 is the next milestone and will consolidate
the existing safety checks into one deterministic packaged-staging suite.
