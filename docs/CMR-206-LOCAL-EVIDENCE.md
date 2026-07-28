# CMR-206 Local Evidence

Date: 2026-07-28 ICT
Status: done_local

## Acceptance

Creative Studio, Analytics Copilot, Brand Guardian, and Automation Builder are no longer catalog-only cards. Each capability routes through `CustomerMarketingCapabilityWorkbench` to a distinct operational surface.

## Real Actions

- Creative Studio reads registered assets and persists a user-authored content brief through `createMarketingResource`; it does not schedule or publish.
- Analytics Copilot reads the persisted workspace analytics report and derives insights only from verified report fields; unavailable provider metrics remain explicit.
- Brand Guardian scans persisted content against Brand Center rules and may submit an eligible revision to the human review queue; the scan never approves or publishes.
- Automation Builder lists persisted workflow sources, prepares a bounded local dry-run, and records a human review decision; publish, send, bulk, spend, contact, and integration writes remain unavailable.

## Verification

- CodeGraph initialized on the release worktree: 327 files, 4,519 nodes, 12,756 edges, zero pending changes before the test update.
- GitNexus indexed `izzi-ai` at commit `824e2e5`: 6,990 nodes, 15,671 edges, 300 flows.
- Focused routing/helper/render regression: 30/30 tests passed.
- Full Desktop suite: 70 files, 900/900 tests passed.
- TypeScript and Vite production build: PASS, 1,136 modules transformed.
- Installed Electron smoke: Creative Studio, Analytics Copilot, and Brand Guardian opened from Apps on the current Pro workspace.
- Automation Builder was denied on Pro with `Can goi Max`; its Max route and full surface were covered by deterministic routing and server-render regression tests.
- Electron smoke recorded zero console errors and zero page errors.
- Marketing workspace API disabled state remained fail-closed and displayed no simulated local data.

## Risk Review

GitNexus reports HIGH upstream impact for editing `CustomerMarketingCapabilityWorkbench` because it feeds `CustomerRoom`, `CustomerMarketingRoomPage`, and the main app render path. No production symbol was changed in this closure pass; only regression coverage and evidence were added.

## Residual

- A future smoke using a real Max workspace can exercise Automation Builder through Electron end to end.
- External publishing, spend, bulk email, destructive actions, and integration writes remain blocked by the existing gates.
