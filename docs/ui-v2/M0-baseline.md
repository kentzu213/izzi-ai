# Izzi AI V2 — M0 Executable Baseline

- Date: 2026-09-27
- Source: `kentzu213/izzi-ai`, worktree `F:/izzi-desktop-p10-integrate`
- Pinned commit: `25428f8247b5fcfbf0c54170c6c5a6eb7ab0b61c` (= `origin/main`, "Merge PR #29"), working tree clean
  (only 2 untracked `*.tgz` package artifacts)
- Desktop package: `@openclaw/desktop@1.14.0-beta.69`, Electron 39.8.10, Node v24.13.0, pnpm 10.33.0
- Scope: baseline only. No production code, tests, IPC, DB, auth or design implementation changed.
- `F:\IzziAI` is an installed build and was not touched.

## 0. Source & docs provenance

| Item | Finding |
|---|---|
| Pinned source | `F:/izzi-desktop-p10-integrate` @ `25428f8` — matches M0 research commit exactly. |
| Other checkout | `F:/Ai Tools/Tool Starizzi - B2C - Openclaw` is on `feature/aibase-my-graph-ui-sync` @ `e8269dc`, dirty tree, 27 ahead / 93 behind `25428f8` (25428f8 is an ancestor). **Divergent — not used for this baseline.** |
| `handoff/IMPLEMENTATION_PLAN.md` | **Not found** in any worktree, on `origin`, or on disk. |
| `docs/ui-v2/M0-baseline.md` | Did not exist; this file is its first version. |
| Design reference used instead | Handoff bundle `izzi-ai-redesign-handoff-v1` (Downloads): `spec/05` (GLOBAL_NAV adapter), `spec/06` (milestones), `spec/07` (acceptance). |

## 1. Baseline commands

All run from the repo root of `F:/izzi-desktop-p10-integrate` at commit `25428f8`. Logs:
`F:/Ai Tools/Codex/Temp/m0-baseline/NN-*.log` (outside the repo).

| # | Check | Command | Exit | Result | Failure summary |
|---|---|---|---|---|---|
| 01 | Unit + contract (desktop) | `pnpm --filter @openclaw/desktop test` | 1 | **FAIL (pre-existing)** | 1 failed / 1770 passed (127 files). `src/main/budget/budget-service.test.ts` › "purges only entries older than the requested retention window": expected `{removed:1}`, got `{removed:2}`. Date time-bomb: `purge(keepDays=30)` uses wall-clock now; fixtures dated 2026-07-01 and 2026-08-20 are both > 30 days old on 2026-09-27. |
| 02 | Root contracts | `pnpm test:actions && pnpm test:renderer-budget && pnpm test:lint-config && pnpm test:socrates` | 0 | PASS | — |
| 03 | Smoke | `pnpm --filter @openclaw/desktop test:smoke` | 1 | **FAIL (pre-existing)** | "No test files found". Script passes `src/**/*.smoke.test.ts` as a vitest name filter, which matches nothing. The only smoke file, `src/renderer/store/agentWorkspace.smoke.test.ts`, passes when run directly (`pnpm exec vitest run agentWorkspace.smoke` → 1/1, exit 0). Script defect, not a test defect. |
| 04 | Main tsc | `pnpm --filter @openclaw/desktop exec tsc -p tsconfig.main.json --noEmit` | 0 | PASS | — |
| 05 | Renderer tsc | `pnpm --filter @openclaw/desktop exec tsc -p tsconfig.json --noEmit` | 1 | **FAIL (pre-existing)** | 1 error: `src/renderer/pages/CustomerMarketingChannels.tsx(370,40): TS2339 Property 'error' does not exist on type 'NativeMarketingProviderRouteResult'` — union (`global.d.ts:489`) not narrowed in `health.ok ? providerRoutes.error : health.error`. No npm script runs renderer tsc; `vite build` does not typecheck, so build still passes. |
| 06 | Build | `pnpm build` | 0 | PASS | — (output `dist/`, gitignored; tree still clean afterwards) |
| 07 | Lint (root) | `pnpm lint` | 0 | PASS | — |
| 08 | Lint (desktop) | `pnpm --filter @openclaw/desktop lint` | 0 | PASS | — |
| 09 | Marketing safety | `pnpm --filter @openclaw/desktop test:marketing-safety-core` | 0 | PASS | Harness suite `mkt-04.v1`. |

Pre-existing failures are recorded only; none were fixed in M0.

## 2. Source re-verification (at 25428f8)

| Surface | Location | Verified shape |
|---|---|---|
| gatewaySessions IPC (main) | `src/main/index.ts:519-529` | `gatewaySessions:list`, `gatewaySessions:save` (requires non-empty string `id`, returns `{ok:true}`), `gatewaySessions:delete` |
| gatewaySessions preload | `src/main/preload.ts:631-637` | `electronAPI.gatewaySessions.{ list(), save(session), delete(id) }` |
| agentGateway session store | `src/renderer/store/agentGateway.ts` | Persists via `gatewayPersistApi()` (L146, L273, L1076). State: `sessions`, `activeSessionId`, `hydrated`. Actions incl. `hydrateFromDisk`, `openAgentChat`, `closeAgentChat`, `switchSession`, `newGatewaySession`, `setSessionModel`, `sendGatewayMessage`, `abortGateway`. |
| `system.buyApi()` | `preload.ts:245` → `index.ts:1036` | Invokes `system:buyApi`; main opens `IZZIAPI_PRICING_URL = 'https://izziapi.com/pricing'` (L244), returns `{success:true, target}`. Renderer caller: `App.tsx:316 handleBuyApi`. |
| navigationMap guard | `src/renderer/navigationMap.test.ts` | Regexes: `/type Page\s*=\s*([\s\S]*?);/`, then `/'([a-z]+)'/g` and `/setCurrentPage\(\s*'([a-z]+)'\s*\)/g`. **Gap:** `[a-z]+` excludes hyphens, so `'scheduled-sessions'` and `'customer-marketing'` (Page union, `App.tsx:33-51`) and `setCurrentPage('customer-marketing')` (`App.tsx:456`) are invisible to the guard. |
| Package scripts | root `package.json` | `build`, `lint` (`eslint .`), `test:actions`, `test:renderer-budget`, `test:lint-config`, `test:socrates` |
| Package scripts | `apps/desktop/package.json` | `build` = `tsc -p tsconfig.main.json && vite build`; `lint`; `test` = `vitest run`; `test:smoke`; `test:marketing-safety-core` = `node scripts/customer-marketing-packaged-safety-harness.cjs .`. No renderer-tsc script. |
| tsconfig names | `apps/desktop/` | `tsconfig.json` = renderer (noEmit, `src/renderer/**/*`); `tsconfig.main.json` = main (commonjs, outDir `dist`, `src/main` + `src/shared`). Vite outDir `../../dist/renderer`. |

## 3. graph-view public API (exact, from `.d.ts`)

Package `@kentzu213/graph-view@0.1.1`, installed from `file:vendor/kentzu213-graph-view-0.1.1.tgz`.
Source: `apps/desktop/node_modules/@kentzu213/graph-view/dist/index.d.ts`.

```ts
export function MyGraphView({ api, navigate, detached }: MyGraphViewProps): JSX.Element;

export type MyGraphViewProps = {
  api: GraphApi;
  navigate: (path: string) => void;
  detached?: boolean;
};

export type ApiResult<T> = { data: T | null; error: string | null; status?: number };

export interface GraphApi {
  fetchMe(): Promise<ApiResult<...>>;
  fetchNodes(): Promise<ApiResult<...>>;
  fetchLinks(): Promise<ApiResult<...>>;
  fetchContributions(): Promise<ApiResult<...>>;
  createNode(...): Promise<ApiResult<...>>;
  updateNode(...): Promise<ApiResult<...>>;
  removeNode(...): Promise<ApiResult<...>>;
  createLink(...): Promise<ApiResult<...>>;
  updateLink(...): Promise<ApiResult<...>>;
  removeLink(...): Promise<ApiResult<...>>;
  searchNodes(q: string, limit?: number): Promise<ApiResult<...>>;
  fetchCommunities(): Promise<ApiResult<...>>;
  importUrl(url: string): Promise<ApiResult<...>>;
  extractDocument(input: { url?: string; text?: string }): Promise<ApiResult<...>>;
  synthesizeTopic(input: { topic: string; rootTitle?: string; queries?: ... }): Promise<ApiResult<...>>;
  extractPdf(file: File): Promise<...>;   // NOT wrapped in ApiResult
}
```

- Exported types: `UserNode`, `UserLink`, `Community`, `SearchHit`, `ExtractedPreviewNode`, `PreviewLink`,
  `GraphNodeRender`, `GraphLinkRender`.
- Exported values/helpers: `nodeTypeConfig`, `graphTopics`,
  `graphViewTokens {bg0,bg1,bg2,cyan,teal,violet,amber,graphite}`, `tagPalette`, `canonicalTagOrder`,
  `tokenRgba`, `colorWithAlpha`, `hexToRgb`, `mixTagColors`, `normalizeTag`, `tagColor`, `uniqueTags`,
  `inferTagsFromText`, `tagsFromUserNode`, `linkEndpointId`, `seededUnit`, `stringHash`, `semanticGraphSeed`,
  `drawGraphViewCanvasField`, `demoGraphClusters`, `buildLocalDemoGraph`, `convexHull`, `expandHull`,
  `isLocalGraphPreviewHost`.
- Package `exports`: `"."` and `"./graph.css"`.
- Peers: `react >=18`, `react-dom >=18`, `react-force-graph-2d ^1.29.1`.
- Host adapter: `src/renderer/pages/KnowledgeUniverse.tsx` builds `GraphApi` from `lib/aibase-api`
  (→ `window.electronAPI.graph`) and styles through `styles/graph-view-scoped.css` (`.graphview-scope`).

(`...` above = concrete element types as declared in the `.d.ts`; not re-typed here.)

## 4. Screenshots

- Location: `F:/Ai Tools/Codex/Temp/m0-baseline/screenshots/{WxH}-{surface}.png`. There are 27 files, kept outside the repo.
- Viewports: 1280×800, 1440×900 and 960×640.
- Method: Vite dev renderer (`pnpm exec vite --port 5199`), driven by Playwright.
  - Without `window.electronAPI`, `App.tsx checkAuth()` falls back to `DEV_USER` (Demo User, pro).
  - **This is browser preview, not an Electron runtime.** No real data, IPC or login is involved.
  - Electron was deliberately not launched, because `DESKTOP_RUNTIME_PROFILE` userData could touch the real profile.

| Surface | Sidebar label | Main heading (browser preview) |
|---|---|---|
| Chat | Chat agent | "Turn memory into actions that run again" |
| Tasks | Replay tasks | "Tasks" |
| Customer Marketing | AI Marketing | none — placeholder "Chưa mở được workspace" (needs Electron) |
| Affiliate | Affiliate | "Kiếm 20% hoa hồng trọn đời" |
| MyGraph | MyGraph | none — graph canvas renders local demo graph |
| Marketplace | Knowleadmarket | "🏪 Marketplace" (demo data; API :8788 offline) |
| Models/API | Kết nối Model | none — placeholder "Mở trong app Izzi (Electron)…" |
| Cost | Chi phí | "💰 Quản lý chi phí" |
| Settings | Settings | "Settings" |

**Checks**
- All 27 navigations succeeded.
- No horizontal overflow at any size: `document.scrollWidth − clientWidth = 0`, and the same for `main`.

**Console output**
- `favicon.ico` 404.
- `localhost:8788` `ERR_CONNECTION_REFUSED`. This comes from the Marketplace demo fallback.
- Both are expected in browser-preview mode.

## 5. Notes carried into M1+

- M1 must not rely on:
  - `test:smoke`, which is a no-op until its script is fixed.
  - Renderer tsc being green, because of 1 pre-existing error.
  - The full unit suite being green, because of the date time-bomb in the budget test.
- Compare M1+ runs against **this** table, not against "all green".
- New hyphenated Page IDs are not protected by `navigationMap.test.ts`. spec/05 adapter keys such as `agent-marketing` and `knowlead-market` are examples.
- M2 must keep `.graphview-scope` isolation and the `MyGraphViewProps` contract (`api`, `navigate`, `detached?`).
- Visual parity baselines for Customer Marketing, MyGraph data and Models/API need an Electron-runtime capture later. Browser preview only shows placeholders or demo data for these.
