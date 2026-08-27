# Beta 58 native Marketing error narrowing

Date: 2026-08-27 (Asia/Ho_Chi_Minh)

## Scope

Fix the renderer type error in `CustomerMarketingChannels.tsx` when the native
Marketing connect result is unsuccessful but omits its optional error code. The
UI now maps that malformed failure to the existing `request-rejected` label.
No OAuth, IPC, workspace, account, or external-action behavior changes.

The user authorized `relaxed_mode` for this task with the exact phrase
`cho phép nới rule`. Claude Code was unavailable due usage exhaustion, so
Codex implemented and independently verified the patch. ChatGPT web was not
used.

## Verification

| Gate | Command | Result |
| --- | --- | --- |
| Root renderer TypeScript | `pnpm exec tsc -p tsconfig.json --noEmit` from `apps/desktop` | PASS |
| Channel contract | `pnpm exec vitest run src/renderer/pages/CustomerMarketingChannels.contract.test.ts` from `apps/desktop` | PASS, 17/17 |
| Desktop lint | `pnpm lint` from `apps/desktop` | PASS |
| Production build | `pnpm build` from `apps/desktop` | PASS |
| Renderer bundle budget | `pnpm test:renderer-budget` from the repository root | PASS, 2/2 |
| Full desktop suite | `pnpm --dir apps/desktop exec vitest run --config F:/Ai Tools/Codex/Temp/izzi-ai-node137-native/vitest.node137.config.mjs` | PASS, 1689/1689 in 122 files |

The beta 57 installed-package smoke was also completed before this patch: the
app retained the existing profile, opened Customer Marketing > Campaigns,
opened the Auto Post migration file picker, and canceled without selecting a
manifest or issuing an import request.
