# Izzi AI V2 — M1/M2 Migration Note

- Date: 2026-09-27
- Source: worktree `F:/izzi-desktop-p10-integrate`, based on `25428f8` (see [M0-baseline.md](M0-baseline.md))
- Status: M2 is ready for review. It is **not** committed, **not** pushed and **not** released. M3 has not started.
- `F:\IzziAI` is the installed build. It was not touched.

## 1. Scope

| Milestone | Scope | Out of scope |
|---|---|---|
| M1 | V2 token layer (`--v2-*`, dark by default, light via `data-theme="light"`) plus a standalone token/demo page for screenshots. | Any change to existing pages or styles. |
| M2 | New shell (GlobalRail → ContextNavigator → ProjectHeader → Workspace → Inspector) behind a feature flag. Legacy pages mount unchanged inside `<main class="main-content v2-workspace">`. | New business logic, IPC/preload changes, DB, auth, page redesign (M3+). |

### Feature flag

| Key (renderer `localStorage`) | Value | Effect |
|---|---|---|
| `uiShellV2` | `'1'` | V2 shell ON. |
| `uiShellV2` | any other value, missing, or storage throws | **OFF (default)**: the legacy `app-layout` + `Sidebar` render exactly as before. |
| `uiShellV2Theme` | `'light'` | V2 light theme. |
| `uiShellV2Theme` | anything else, or storage throws | V2 dark theme (default). |

The flag is read once at mount (`useState(() => isUiShellV2Enabled())`), and the V2 shell is lazy-loaded. With the flag OFF, the V2 chunk and CSS are never imported.

## 2. Files

Tracked, modified:

- `apps/desktop/src/renderer/App.tsx` (+39): the lazy `AppShellV2` import, the flag branch, and passing `extensionUpdateCount` through to V2. The flag-OFF branch is unchanged.

Untracked, new:

- M1:
  - `apps/desktop/src/renderer/styles/v2/tokens.css` and `tokens.test.ts`
  - `apps/desktop/src/renderer/izzi-v2-tokens.html`
  - `apps/desktop/src/renderer/izzi-v2-demo/`
- M2:
  - `apps/desktop/src/renderer/uiShellV2.ts` and `uiShellV2.test.ts`
  - `apps/desktop/src/renderer/styles/v2/shell.css` and `shell.test.ts`
  - `apps/desktop/src/renderer/components/v2/` (`AppShellV2`, `GlobalRail`, `ContextNavigator`, `ProjectHeader`, `Inspector`, `navModel`, `shell-responsive.css`, tests)
- Docs: `docs/ui-v2/M0-baseline.md` and this file.

Left as they were, not part of M1/M2: `openclaw-desktop-1.14.0-beta.66.tgz` and `apps/desktop/openclaw-desktop-1.14.0-beta.67.tgz`.

## 3. M2 fixes from the audit

1. **Button reset specificity.**
   - Problem: `.izzi-v2 .v2-navigator button` (0,2,1) beat `.izzi-v2 .v2-navigator__item` (0,2,0), so the items lost their padding and colour.
   - Fix: the reset is now `.izzi-v2 :where(.v2-rail|.v2-navigator|.v2-header|.v2-inspector) button` (0,1,1), so every component rule wins.
   - Test: `shell.test.ts` parses `shell.css` and fails if any reset ties with or outranks a component rule that sets `padding`/`color`, for the rail, navigator, header and inspector.
2. **Extension update indicator.**
   - It reuses the existing `extensionUpdateCount`: the same `extensions:updates:pending` poll that feeds the legacy Sidebar. There are no new IPC calls or business logic.
   - Count > 0: the navigator's Extensions entry gets an `N up` badge and an `aria-label` suffix. When the navigator is hidden, a dot appears on the header toggle, with its label.
   - Count 0: nothing is shown.
   - Navigation to Extensions uses the existing navigator entry.
3. **Navigator drawer at 960–1023 px (spec/04).**
   - At `(max-width: 1023px)` the navigator is a drawer, closed by default. When open it is absolutely positioned at `left: var(--v2-layout-rail)` with a scrim, so the workspace width does not change.
   - Opening it (toggle or Ctrl/Cmd+K) focuses the "Tìm trang" search box.
   - It closes on Escape, the close button, a scrim click, navigating, or crossing the breakpoint. Focus returns to the header toggle.
   - The first Escape clears a non-empty query; the second closes the drawer.
   - The light theme and the Marketplace/Knowlead labels are unchanged.

## 4. Evidence: what each source proves

| Source | What it covers | What it does **not** prove |
|---|---|---|
| Unit/contract tests (Vitest, node env, `renderToStaticMarkup`) | 44 focused tests in 5 files: flag/theme (including a throwing `localStorage` getter → OFF/dark), nav model, shell markup, indicator at count 0 and count > 0, the drawer's closed-by-default markup at compact width, the CSS specificity contract, and the App.tsx wiring. | Real layout, cascade or interaction. The node env has no browser cascade, and state transitions (open → Escape → focus) are not unit tested. |
| Browser (Playwright on the Vite dev page) | M1 token/demo screenshots, dark and light. | Electron, preload or IPC. |
| Electron, isolated mock | A temporary profile outside the repo, with stubbed auth, updater and `extensions:updates:pending`, and `MOCK_INTEGRATIONS` on. Covered flag ON/OFF, dark/light, and screenshots at 1280×800, 1440×900 and 960×640. AI Marketing stayed **fail-closed** because there is no identity. | Real data, a real account or live IPC results. This is **not** real-data verification. |
| Electron harness, computed style + drawer 960 + badge phase | The harness (outside the repo) was extended to check computed padding/colour, the full 960 drawer scenario and the badge 2 → 0 flow. | **Not yet run.** No screenshots or results exist for these checks. |
| Packaged build | — | **Not done.** Nothing was packaged, installed or exercised. |

`~/.openclaw` check: the isolated run compared only the top-level mtime and entry count before and after. That shows the directory was not visibly touched. It does **not** prove that every file's content is unchanged. There was no recursive hash; it was a point-in-time check only.

## 5. M0 baseline failures (unchanged, not fixed)

1. Renderer tsc: `CustomerMarketingChannels.tsx(370,40) TS2339 'error'`.
2. `apps/desktop/src/main/budget/budget-service.test.ts`: expected `{removed:1}`, got `{removed:2}` (wall-clock date time-bomb).
3. `pnpm --filter @openclaw/desktop test:smoke`: "No test files found" (script filter defect). The direct `agentWorkspace.smoke` test passes 1/1.

## 6. Not yet proven, or waiting for a decision

These are **not decided**. They are listed for the owner to choose.

- **Packaged app and live IPC.** No packaged build, and no real `extensions:updates:pending` data.
- **Computed-style and drawer interaction in Electron.** Covered only by the static CSS contract and SSR markup until the extended harness runs.
- **AA contrast for `--v2-text-muted` at 11 px** (fails AA 4.5:1):
  - light `#9993a3`: 2.98:1 on `#fff`, 2.76:1 on `#f6f6f9`;
  - dark `#777480`: 3.64:1 on `#1d1e23`, 3.88:1 on `#17181c`.
  - Minimal option using existing tokens: use `--v2-text-secondary` (dark `#aaa7b2`, light `#6f6a79`) for 11 px text.
- **Avatar.** White text on the pink end of the gradient is about 2.6:1. Options: a solid `#7c4dff`, dark text, or a darker gradient end.
- **Token candidates (proposal only):** light hover, focus ring, dark `bg-subtle`, active fill, and the drawer scrim colour (the scrim is currently transparent).
- **Light chrome around legacy dark content.** Legacy pages are not re-themed in M2.
- **Knowlead mapping.** The rail keeps "Knowlead Market" as a disabled placeholder, and the "Knowleadmarket" naming is left as is. Mapping it to a real page or feature is undecided.
