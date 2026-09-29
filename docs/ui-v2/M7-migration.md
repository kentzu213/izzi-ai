# M7 — MyGraph V2 migration

## Status

**PARTIALLY VERIFIED (Codex run, 2026-09-28).** Vitest (329/329, not yet checked against the full-suite scope), main `tsc` and the build pass. Renderer `tsc` fails only on the pre-existing TS2339. Lint is blocked. The browser dev-mode check is partial (NO BRIDGE only), Electron is blocked by the shell, and GitNexus is still unverified (see "Required before verified"). Source-only wiring tests pass, but they are still not runtime evidence.

| Check | Result |
|---|---|
| GitNexus `impact(MyGraphPage, upstream)` | LOW (earlier run). Only direct caller: `App.tsx` |
| vitest | **329/329 PASS** (Codex). Scope not yet checked against the full desktop suite, so this is not a full-suite claim |
| main `tsc -p tsconfig.main.json --noEmit` | **PASS** (Codex) |
| renderer `tsc -p tsconfig.json --noEmit` | **FAIL, baseline only.** The only error is the existing TS2339 at `CustomerMarketingChannels.tsx:370` (Codex). No new error |
| desktop build | **PASS** (Codex) |
| lint | **BLOCKED** by stale ESLint suppressions in `eslint-suppressions.json`. No lint result for the changed files. Pruning them is an owner call. |
| Browser, flag ON/OFF (dev `localhost:5199`, no Electron bridge) | **PARTIAL.** Flag OFF: legacy MyGraph renders (113 nodes / 188 links), no "Mở trên web" button, as expected. Flag ON: `MyGraphWorkspaceV2` renders; "Mở trên web" shows the `role="alert"` copy and logs only `[MyGraph] graph.openMyGraphWeb bridge is unavailable` (NO BRIDGE, not a real open). The #19 tag-filter clipping check at 720 px height was **not** run. Screenshots: `.playwright-mcp/izzi-demo/05-off-mygraph-legacy.png`, `07-on-mygraph-openweb-alert.png` in the Starizzi workspace |
| Isolated Electron run (no real profile) | **BLOCKED.** The only local shell attempt failed with `ENAMETOOLONG: uv_spawn` and was not retried, so Electron was never built or launched. Codex has to run it (see step 5) |
| GitNexus `impact` / `detect_changes` for the #23 and GraphWorkspace follow-ups | UNVERIFIED |

## Scope

- A V2 frame around the MyGraph page, gated behind `uiShellV2`. The flag stays **OFF** by default.
- Unchanged: `GraphApi`, `MyGraphViewProps`, the `@kentzu213/graph-view` package and its version, the auto-generated `styles/graph-view-scoped.css`, the `.graphview-scope` token island, the `aibase-api` bridge, and the `navigate` helper.
- The legacy JSX is unchanged. With the flag OFF, the render output is the same as before.
- No new IPC channel. The V2 "Mở trên web" button calls the existing `graph:openMyGraphWeb` handler (`main/index.ts`), so the web URL stays in the main process.

## Mapping

| File | Change |
|---|---|
| `apps/desktop/src/renderer/components/v2/MyGraphWorkspaceV2.tsx` | New presentational frame: header (kicker, title, lead, web button) and a stage. The stage holds `div.graphview-scope.v2-mygraph__canvas` with the graph, then the optional `aside` outside the scope. No IPC, no `window`, no package import. |
| `apps/desktop/src/renderer/pages/KnowledgeUniverse.tsx` | Adds `{ v2 = false }` and `openMyGraphWeb()`. `if (v2)` returns the frame with the same `<MyGraphView api navigate detached={false} />` and `<LiveProfilePanel />`. The page has no hooks, so there is no hook-order concern. |
| `apps/desktop/src/renderer/App.tsx` | Changed to `<KnowledgeUniversePage v2={isShellV2} />`. |
| `apps/desktop/src/renderer/styles/v2/shell.css` | New M7 block. Every selector is `.izzi-v2 .v2-mygraph*`, only existing `--v2-*` tokens are used, and no selector names `.graphview-scope`. The stage is `position: relative; min-height: 0; overflow: hidden`, which gives the package's absolute toolbars and the Live.md panel a bounded box, as the legacy inline styles did. |

## Guards kept

- **Token island.** The package CSS redefines token names under `.graphview-scope`. V2 CSS never targets that class; it styles `.v2-mygraph__canvas` (same element) only for position, size and overflow.
- **Live.md panel outside the scope.** As in legacy, `LiveProfilePanel` renders outside `.graphview-scope`, so its look does not depend on the package tokens. It still anchors to a `position: relative` box (the stage).
- **Auth.** The JWT stays in main through the unchanged `aibase-api` bridge.

## Known risk (not fixed, package CSS not edited)

- **`100vh` in the package CSS.** `styles/graph-view-scoped.css:118` has `max-height: calc(100vh - 188px)`. The 188px offset assumes the web page chrome. Inside the V2 stage (shell header plus the V2 page header), that panel can be taller than the stage and get clipped by `overflow: hidden`. Legacy has the same exposure with a smaller offset. The fix belongs in the package (izzi-web), not here. Tracked as ledger #19.
  - **#19 static check (UNVERIFIED, not reproduced at runtime; Bash fails with `ENAMETOOLONG`, so no browser run).**
    - The graph canvas is not sized by `100vh`: `.v2-mygraph__canvas` is `height: 100%` of the stage.
    - The only `100vh`-sized box (`graph-view-scoped.css:276`, `min-height: 100vh`) belongs to `.graph-detached-section` / `.graph-canvas-shell--detached`. V2 passes `detached={false}`. The package JS is not installed in this worktree, so it was not confirmed that these classes are absent when `detached` is false.
    - The filter panel (`:112-118`, `top: 158px`, `max-height: calc(100vh - 188px)`) ends at `stage top + 100vh - 30px`. The V2 stage always sits more than 30px below the viewport top and ends above the viewport bottom, so a long tag list gets its tail clipped by the stage's `overflow: hidden`. Short lists are not affected.
    - **Not fixed.** A wrapper-only fix would have to override the package's internal `.graph-filter-panel`, which breaks the "V2 CSS styles the canvas only for position, size and overflow" guard. The package CSS and `.graphview-scope` are unchanged. Needs either a browser repro and then a package fix, or an owner OK to override a package class.
- **`.v2-surface` sizing.** `.v2-mygraph` overrides `max-width` to `none` and sets `height: 100%`. The stage only fills the height if `.v2-workspace` gives its child a definite height. This has not been checked in a browser.

## Tests added (not yet run)

- `components/v2/MyGraphWorkspaceV2.test.ts`:
  - **Render tests:** the graph sits inside `graphview-scope v2-mygraph__canvas`; the aside sits after the canvas and inside the stage; no aside renders nothing; `aria-labelledby` matches the title id; the web control is a `type="button"`, with no `<form>`, `type="submit"` or `<a>`.
  - **Wiring tests (source only):** the App flag is passed through; the page defaults to legacy; the `GraphApi` adapter, the legacy `className="graphview-scope"` and `detached={false}` on both paths are kept; the web button goes through `openMyGraphWebSafely` (ledger #23); the component contains no `window.` / `electronAPI` / `ipcRenderer` / `invoke(` / `@kentzu213/graph-view` / `aibase-api`.
- `styles/v2/shell.test.ts`, block "v2 MyGraph frame (M7)": `.izzi-v2` scoping, `--v2-*` tokens only, text colours with `!important` and `-webkit-text-fill-color`, no `graphview-scope` in `shell.css`, and the bounded, positioned stage.

## Reviews

- **typescript-reviewer (static, Read/Grep only): no CRITICAL, HIGH or MEDIUM found. UNVERIFIED: no test, tsc or lint was run.** It checked scoping, tokens, IPC placement (the URL is built in main), component purity, and that every test assertion matches the `renderToStaticMarkup` output.
  - LOW: `v2-mygraph__head` had no CSS rule; the header layout comes from `.v2-surface__header`. **Fixed** by removing the unused class.
- **Self-review of the IPC:** `graph:openMyGraphWeb` is an existing channel and takes no argument from the renderer. Ledger #23 is fixed statically but UNVERIFIED, because no tests have been run. The old calls used `void`, so a rejected `shell.openExternal` was never handled. Both call sites now go through `renderer/lib/open-my-graph-web.ts` (`openMyGraphWebSafely`):
  - A missing bridge or a result where `ok` is not true logs a warning and resolves `false`.
  - A rejection is logged with `console.error` and resolves `false`, so it is not swallowed silently.
  - In V2, `KnowledgeUniverse.tsx` passes `openWebError` to `MyGraphWorkspaceV2`, which shows a Vietnamese `role="alert"` above the stage.
  - Legacy `GraphWorkspace.tsx` originally only logged. It now shows its own `role="alert"` (see the GraphWorkspace follow-up at the end of this section).

  Tests: `open-my-graph-web.test.ts` covers ok, non-ok, rejection, a missing bridge and the source guard on both pages; `MyGraphWorkspaceV2.test.ts` covers the alert render and wiring. `IZZI_WEB_BASE` comes from `OPENCLAW_WEB_URL` and is not checked before `openExternal`.

- **security-reviewer (static, review only): no CRITICAL or HIGH.**
  - MEDIUM, pre-existing and not fixed (ledger #24): `navigate()` in `KnowledgeUniverse.tsx` passes any string that starts with `http` straight to `shell.openExternal`, so it is not limited to izziapi.com. The main `shell:openExternal` handler has no scheme or domain allow-list either. Whether `@kentzu213/graph-view` ever passes a URL it does not control has not been checked. M7 did not change this function. Limiting it would change which links the package can open, so this needs an owner decision.
    - **Status: PENDING, owner decision.**
      - The main handler (`main/index.ts:999`) is `shell.openExternal(url)` with no check.
      - The renderer calls `openExternal(` 13 times across 9 files (AgentSetupPanel, Chat, NodeWorkspacePanel, CustomerMarketingRoom, Dashboard, Knowledge, Login, Settings, SetupWizard).
      - The only existing allow-lists are feature-specific (`isAllowedAutopostConnectUrl`, the SEO `isAllowedCanonicalUrl`). No contract defines the allowed targets for the generic channel, so nothing was restricted.
      - Owner to decide: the allowed schemes (https only?) and hosts (izziapi.com plus which third parties?), and whether to restrict at the handler or only in `navigate()`.
      - **Second security review (static): HIGH, pre-existing, not introduced by this diff.** `preload.ts:225-226` exposes the channel to every renderer page, so the handler is the real trust boundary, not `navigate()`. A non-http(s) string can reach OS protocol handlers (`file:`, custom schemes). Options for the owner (not implemented):
        - **A.** In the handler: `new URL()`, `https:` only, no username/password, hostname on a fixed allow-list. This follows `isAllowedAutopostConnectUrl` (`main/autopost/autopost-client.ts:105-124`).
        - **B.** In the handler: `https:` only, with no host list. This closes the scheme vector but still allows any host.
  - Confirmed: `graph:openMyGraphWeb` takes no argument and builds the URL in main. No `dangerouslySetInnerHTML` or `innerHTML` in the M7 files.
- **typescript-reviewer, second pass on ledger #23 (static): no HIGH in #23; two MEDIUMs, left as they are.**
  - MEDIUM: `KnowledgeUniverse.tsx:56-59` can call `setOpenWebError` after the page unmounts, if the IPC settles after the user has navigated away. React 18 ignores that update and no longer warns, so nothing is visible.
    - **Fixed statically, UNVERIFIED (Bash fails with `ENAMETOOLONG`, no test was run).** `open-my-graph-web.ts` adds `createOpenWebGuard()`. Each click calls `begin()`, and `setOpenWebError` runs only if the page is still mounted and that click is still the latest. This also fixes a real race: a slow earlier click can no longer overwrite the result of a newer click. The page keeps one guard per mount (`useState(createOpenWebGuard)`). The effect sets `mounted` back to true on mount, so the StrictMode mount → cleanup → mount cycle still works. The asserted call string `openMyGraphWebSafely(window.electronAPI?.graph?.openMyGraphWeb)` is unchanged.
    - Tests in `open-my-graph-web.test.ts` run the page flow against the real guard: success clears the error; a rejection and a missing bridge show it; a result after unmount is dropped; only the latest click applies; results apply again after a StrictMode remount. The page wiring check is source-only. There is no RTL or jsdom, so a real component unmount is not rendered.
  - MEDIUM: legacy `GraphWorkspace.tsx` only logs a failure and shows nothing in the UI. It was left at first because the legacy page is not routed. **Superseded:** fixed in the GraphWorkspace follow-up at the end of this section.
- **Third pass, 2026-09-28 (static, UNVERIFIED): no CRITICAL or HIGH.**
  - The typescript-reviewer traced the #23 guard tests by hand. They are deterministic: no timers, and "latest click wins" and "drop after unmount" both hold. The hooks come before `if (v2)`.
  - The typescript-reviewer repeated its LOW on `GraphWorkspace.tsx:202`: there is no guard and no UI error. It was unchanged at that point and was fixed later (see the GraphWorkspace follow-up below).
  - security-reviewer, LOW, pre-existing, not fixed: `openMyGraphWebSafely` logs the raw rejection (`console.error('[MyGraph] openMyGraphWeb failed:', err)`). This reaches only the renderer console, never the UI. The test at `open-my-graph-web.test.ts:31` asserts this call. To align with #25, log only `err.name` and update that test.
- **Follow-up, 2026-09-28 (static, UNVERIFIED: no test was run because Bash fails with `ENAMETOOLONG`; GitNexus impact was not run).**
  - Raw-error log: **fixed.** The catch now logs `[MyGraph] openMyGraphWeb failed: <name>`, using `err.name` capped at 50 characters, or `error` for a non-Error value. The message, stack and Error object are never logged. Tests in `open-my-graph-web.test.ts`: an Error whose message holds a path, URL and token logs only `…failed: Error`; a string rejection logs `…failed: error`.
  - Unmount/race guard: **no change needed.** `createOpenWebGuard` already exists, `KnowledgeUniverse.tsx` uses it, and its tests cover "latest click wins" and "drop after unmount". The `GraphWorkspace.tsx:202` LOW (no guard, no UI error) was still open at that point.
- **GraphWorkspace legacy follow-up, 2026-09-28 (static, UNVERIFIED: no test was run because Bash fails with `ENAMETOOLONG`; GitNexus impact was not run).**
  - `GraphWorkspace.tsx` now uses the same guard as `KnowledgeUniverse.tsx`: `useState(createOpenWebGuard)`, an effect that sets `mounted` and returns `() => openWebGuard.setMounted(false);`, and `if (isCurrent()) setOpenWebError(...)`. A result that lands after unmount or after a newer click is dropped. The hooks sit before the component's `return`.
  - On failure the toolbar shows fixed Vietnamese copy in a `role="alert"` (`Không mở được trình duyệt…`). The copy is a constant and never includes the error text. It reuses the existing `gw-toolbar__hint--error` class, so there is no CSS change.
  - No routing or nav change: the page is still not routed from `App.tsx`.
  - Tests: the guard source check in `open-my-graph-web.test.ts` now runs on both `KnowledgeUniverse.tsx` and `GraphWorkspace.tsx`. It is source-only, not runtime evidence. The guard's behaviour is covered by the existing `createOpenWebGuard` tests.

## Required before verified (Codex)

1. ~~`vitest run` on `MyGraphWorkspaceV2.test.ts`, `lib/open-my-graph-web.test.ts`, `styles/v2/shell.test.ts` and `uiShellV2.test.ts`.~~ Done: vitest 329/329 PASS (Codex). Whether that run covered the full desktop suite has not been checked.
2. ~~Renderer `tsc --noEmit`. The only allowed failure is the existing TS2339 baseline.~~ Done: renderer FAIL on the TS2339 baseline only; main `tsc` PASS.
3. Lint on the changed files: **blocked** by stale suppressions (see the checklist). ~~Desktop build.~~ Done: PASS.
4. Browser check with the flag OFF: MyGraph looks the same as before. With the flag ON, at 1440 / 960 / 720: the graph fills the stage, the toolbars and the Live.md launcher stay inside it, and the panel from `graph-view-scoped.css:118` is or is not clipped (record which). For ledger #19, open the tag filter with a long tag list at 720px height, and confirm in DevTools that no element carries `graph-canvas-shell--detached` / `graph-detached-section`.
   **Partial (2026-09-28, dev browser, no bridge):** flag OFF shows the legacy graph; flag ON shows the V2 alert on "Mở trên web". Still open: the stage/toolbar/panel check at 1440 / 960 / 720 and the #19 tag filter.
5. Isolated Electron run with a temporary `userData` and **no real profile or credentials**: the page loads (signed-out state is fine), and "Mở trên web" opens `/aibase/my-graph` in the default browser.
   **Blocked:** the local shell fails with `ENAMETOOLONG`. Codex has to run the build and the isolated launch.
