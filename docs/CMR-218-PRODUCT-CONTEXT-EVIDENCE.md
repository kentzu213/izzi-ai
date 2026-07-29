# CMR-218 Product Marketing Context Evidence

Date: 2026-07-29
Release candidate: Izzi AI Desktop `1.14.0-beta.5`
Repository: `kentzu213/izzi-ai`
Reviewer authority: authenticated workspace identity, derived in Electron main

## Scope closed

- Product Marketing Context schema v1 uses the fixed context ID
  `product-marketing-context` and locales `vi` plus `en`.
- The context records product positioning, target audience, value proposition,
  brand voice, call to action, proof claims, prohibited claims, and HTTPS
  evidence sources.
- Source and context SHA-256 digests are computed in Electron main from
  canonical JSON. The renderer cannot provide reviewer, digest, tenant,
  filesystem, secret, or executor authority.
- Save uses optimistic revision checks. Identical saves are idempotent; stale
  writers receive a conflict and their draft remains available in Brand Center.
- Workflow, job, artifact, approval, and AI Director evidence bind to the same
  structural context reference.
- A missing or tampered context blocks strategy workflow creation before
  durable artifacts are created.
- Updating context keeps an older strategy approval pending and blocks review
  until a new workflow is created against the current revision.
- Legacy workflow-store records without a context reference normalize to
  `null`; mismatched references quarantine fail-closed.

## Product surface

- Brand Center includes explicit Vietnamese and English fields.
- Evidence sources, proof claims, source bindings, and prohibited claims are
  editable without exposing internal IDs beyond customer-owned evidence IDs.
- The editor shows revision, reviewer, digest prefix, dirty state, validation,
  saved state, and two explicit conflict recovery choices. Its draft remains
  mounted while the user navigates to another Marketing Room view.
- Layout is responsive for desktop and mobile and uses the existing Izzi AI
  customer marketing design tokens.
- AI Director product claims must cite an approved proof-claim ID. Unsupported
  product claims leave the existing approval evidence unchanged and block the run.

## Verification

- Focused Product Context, service, workflow store, IPC, and renderer contract:
  `197/197` tests passed.
- Full desktop regression: `931/931` tests passed.
- `tsc -p apps/desktop/tsconfig.main.json --noEmit`: passed.
- `pnpm --dir apps/desktop build`: passed.
- `git diff --check`: passed after line-ending normalization.
- Verified commit `2e245150c6a724124df1946d1da1dd7826c128df` was pushed to
  `origin/main` and published as `v1.14.0-beta.5`.
- GitHub Actions release run `30456270222` completed successfully for Windows
  and macOS. The public release includes Windows x64 plus macOS x64 and arm64
  artifacts.
- The packaged Windows runtime reports product title `Izzi AI`, version
  `1.14.0-beta.5`, and launches to the production login boundary without an
  authentication bypass.
- Production-renderer smoke passed in the network-free Customer Marketing
  harness. A dirty Product Context draft survived Brand Center to Overview and
  back to Brand Center.
- Responsive smoke passed at desktop `1440x900` and mobile `390x844` with no
  horizontal overflow or button-label overflow.
- At the mobile form end, `Lưu Product Context` remained fully visible and
  enabled. Its bottom edge was `119.75px` above the fixed navigation top after
  scrolling to the maximum page offset, so no CSS patch was required.
- CodeGraph was re-indexed against the release worktree and reports 317 files,
  4,639 nodes, 13,159 edges, and an up-to-date index.

## Safety status

- External publish: blocked.
- Advertising spend: blocked; confirmed spend is `0 VND`.
- Bulk email: blocked.
- Integration mutation: blocked.
- No secret values are stored in this evidence file.

## Known repository gates

- ESLint 9 has no repository flat config, so `pnpm --dir apps/desktop lint`
  cannot run until that baseline task is completed.
- Current `brace-expansion` advisories are reached through build/dev tooling
  such as Electron Builder and ESLint; this slice adds no dependencies.
