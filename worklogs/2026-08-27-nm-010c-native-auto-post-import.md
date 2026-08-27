# NM-010c native Auto Post import

Date: 2026-08-27 (Asia/Ho_Chi_Minh)

## Scope

Complete the confirmed mutation that follows the existing read-only Auto Post migration preview. The desktop must derive the active IzziAPI workspace in main, allow only Owner/Manager, consume a preview once, send the exact verified manifest bytes at most once, reconcile an uncertain POST with one read-only GET, and return only a safe receipt summary to the renderer.

The user authorized `relaxed_mode` for this task with the exact phrase `cho phép nới rule`. Claude Code was unavailable due usage exhaustion, so Codex implemented, reviewed, and verified the slice directly. ChatGPT web was not used.

## Security decisions

- The renderer sends only `{ selectionId, confirmed: true }`; it never supplies a workspace, digest, file path, token, idempotency key, or receipt identity.
- Main re-derives workspace and role before consuming the selection or dispatching a request.
- The registry rejects symlinks, non-files, oversized manifests, metadata changes, changed bytes, invalid schemas, expired selections, and non-ready previews. Consumption is one-shot even on failure.
- The client verifies the request SHA-256, posts exact bytes once, validates an exact tenant-bound receipt and receipt digest, and never retries POST.
- Receipt bodies are streamed with a hard 32 KiB cap and canceled immediately when the cap is exceeded.
- Returned renderer receipts omit workspace ID, manifest digest, receipt ID, and receipt digest.
- No real credential, customer manifest, backend mutation, publish, deploy, migration, spend, or external post was used during local verification.

## Verification evidence

| Gate | Command or method | Result |
| --- | --- | --- |
| Focused Marketing regression | `pnpm --dir apps/desktop exec vitest run src/main/customer-marketing/customer-marketing-legacy-import.test.ts src/main/customer-marketing/customer-marketing-legacy-import-mutation.test.ts src/main/customer-marketing/customer-marketing-workspace-client.test.ts src/main/customer-marketing/customer-marketing-ipc.test.ts src/main/customer-marketing/customer-marketing-service.test.ts src/renderer/pages/CustomerMarketingResources.contract.test.ts` | PASS, 458/458 |
| Full desktop suite with isolated Node ABI 137 native module | `pnpm exec vitest run --config F:/Ai Tools/Codex/Temp/izzi-ai-node137-native/vitest.node137.config.mjs` from `apps/desktop` | PASS, 1689/1689 in 122 files |
| Main TypeScript | `pnpm exec tsc -p tsconfig.main.json --noEmit` from `apps/desktop` | PASS |
| Desktop lint | `pnpm lint` from `apps/desktop` | PASS |
| Production build | `pnpm build` from `apps/desktop` | PASS |
| Renderer bundle budget | `pnpm test:renderer-budget` | PASS, 2/2 |
| Document contract | `node tools/socrates-tier1.mjs --changed` | Run again after this note is added |
| Diff whitespace | `git diff --check` | PASS before the documentation update; run again before commit |

The local browser smoke used only an in-memory Electron API mock. It exercised preview, confirmation, progress, success, and uncertain-result states on desktop and mobile layouts. Focus was trapped inside the modal, Tab and Shift+Tab wrapped, Escape closed when idle and restored focus to the launcher, background content was inert, no horizontal overflow was observed, and the console produced no warnings or errors.

## Known baseline patch

`pnpm exec tsc -p tsconfig.json --noEmit` reports the pre-existing optional-error narrowing issue at `apps/desktop/src/renderer/pages/CustomerMarketingChannels.tsx:611`. `git diff --quiet -- apps/desktop/src/renderer/pages/CustomerMarketingChannels.tsx` returned exit code 0, confirming NM-010c did not modify that file. Per the small-release rule, this unrelated one-line type correction is deferred to the patch immediately after the NM-010c release.

## Release sequence

1. Commit and push the bounded NM-010c slice.
2. Open a PR, wait for required CI, and merge to `main`.
3. Tag the package version from the public merge commit and wait for the complete GitHub prerelease inventory.
4. Download or update the Windows install, launch the public build, and smoke the migration entry point without calling a real backend import.
5. Apply the isolated CustomerMarketingChannels type-only patch and repeat the small release loop if product bytes change.
