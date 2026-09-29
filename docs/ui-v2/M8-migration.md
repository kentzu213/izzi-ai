# M8 — V2 CSS cleanup

## Status

**VERIFIED in a browser preview (Vite dev renderer + Playwright). NOT verified in the Electron runtime.** This is a static audit of `apps/desktop/src/renderer/styles/v2/shell.css` plus one CSS deletion.

Compared against the M0 baseline (`M0-baseline.md`), not against "all green":

| Check | Result |
|---|---|
| vitest `styles/v2/shell.test.ts` | PASS (37/37) |
| Full vitest | 2171 passed, 1 failed. The failure is the budget-service date time-bomb, already recorded in M0. |
| main `tsc` | PASS |
| renderer `tsc` | Only the M0 baseline error, TS2339 at `CustomerMarketingChannels.tsx(370,40)`. |
| lint | exit 0, same as M0 (after `--prune-suppressions`, see "Side effects of the verification run"). |
| build | exit 0 |
| Browser, flag OFF at 1440 / 960 / 720 | PASS. Legacy UI, no `.izzi-v2` root, no `v2-` nodes. The only console error is a favicon 404. |
| Browser, flag ON at 1440 (Home) | PASS. Root, rail, navigator and header present. No status pill, no horizontal overflow. |
| Browser, flag ON at 1440 (Chat page) | PASS. Breadcrumb `Izzi AI / Workspace / Chat agent` and project select present, no status pill, no overflow. |
| Browser, flag ON at 960 and 720 | PASS. No horizontal overflow. Rail 60px, header 52px. The navigator is hidden: at ≤1023px it is a drawer, closed by default (`COMPACT_QUERY`, spec/04). At 720 the select sits at x 503–624 inside the 720px header. |
| Focus ring on the header project select (after the dead rule was deleted) | PASS. With `:focus-visible` matching: `outline: solid 2px rgb(124,77,255)` and border `rgb(124,77,255)`. Before focus: no outline, border `rgba(255,255,255,0.08)`. |
| Console, flag ON | 0 errors, 0 warnings. |
| Electron runtime | NOT RUN |

Screenshots: `.playwright-mcp/m8/` (`off-1440`, `off-960`, `off-720`, `on-1440`, `on-1440-chat-focus`, `on-960`, `on-720`). The folder is untracked. They come from the browser preview at the same viewports as M0, so they are not Electron-runtime evidence.

## Scope

- Only `shell.css` and `shell.test.ts` were changed. No token, AA, avatar, package CSS or legacy stylesheet was changed.
- The `uiShellV2` flag stays **OFF** by default. Every V2 rule is still scoped under `.izzi-v2`, so the legacy (flag OFF) render is not affected.

## Audit results

| Item | Finding | Action |
|---|---|---|
| Unscoped selectors | None. Every top-level selector starts with `.izzi-v2`. | None |
| Non-`--v2-*` variables | None found. | None |
| `.cmr-page` in `CustomerMarketingRoom.tsx` | Intentional. M4 keeps it as the `--cmr-*` token host for the reused legacy views, and `.izzi-v2 .v2-agent-marketing-room` repaints it with V2 tokens (see the comment near `shell.css:1060`). | The selector used to be `.izzi-v2 .cmr-page.v2-agent-marketing-room`, which broke the M3-A "no `.cmr-`" guard (`shell.test.ts:236`). The `.cmr-page` part was not needed, because (0,2,0) already outranks the legacy `.cmr-page` (0,1,0). It was removed, and the guard is unchanged. |
| `color: #ffffff` in `.v2-rail__avatar` | Hardcoded. The avatar look is an owner decision. | None. Owner decision (ledger #22). |
| `color: #fff` in `.v2-button--primary` | Hardcoded. `tokens.css` has no on-brand text token, and adding one is a token change. | None. Token gap, owner decision (ledger #21). |
| Repeated selectors: `.v2-rail__footer`, `.v2-project-row`, `.v2-project-row__select`, `.v2-inspector`, `.v2-project-steps`, `.chat-message__state`, `.chat-composer__inject`, `.v2-header__project-select` (base vs `!important` legacy-leak override) | Intentional. Each is a grouped shared base followed by a specific override, or a base rule followed by the M3-A legacy-leak override. Merging would change the cascade order or mix the two concerns. | None |
| `.izzi-v2 .v2-header__project-select:focus-visible` (old block right after the base select rule) | **Dead.** The later rule in the M3-A focus group has the same selector, `outline: 2px solid var(--v2-brand-primary) !important` and the same `outline-offset: 2px`. The earlier rule could never apply. | **Deleted.** Computed style is unchanged. |

## Tests

- `styles/v2/shell.test.ts`, block "v2 surface legacy-leak overrides (M3-A)": a new test asserts that exactly one `.izzi-v2 .v2-header__project-select:focus-visible` rule remains. The existing test "keeps a visible token focus ring on every surface control" still checks that the resulting outline is `2px solid var(--v2-brand-primary) !important`.

## Reviews

- **Self-review:** the audit table above.
- **security-reviewer (static, review only):** a grep of all of `shell.css` finds no `url(...)`, no `@import`, and no `http` or `://`. No findings.

## Side effects of the verification run

These are outside the M8 CSS scope and were found while running the checks. They are unreviewed.

- `ProjectHeader` no longer renders a V2/Legacy status pill. Three test fixtures still passed old props or asserted the pill, so they were aligned: `HomeSurface` fixtures in `surfaces.test.ts` and `marketingPrefill.flow.test.ts` now pass `isNavigatorOpen` and `onToggleNavigator`, and `ProjectWorkspaceSurface.test.ts` now asserts the pill is absent. Two lines in `M3-B1-migration.md` were aligned.
- `eslint-suppressions.json`: `eslint --prune-suppressions` removed one stale entry (`CustomerMarketingRoom.tsx`, `react-hooks/exhaustive-deps`, count 1). Without it `eslint` exits 2.
- `shell.css` still has a `.izzi-v2 .v2-header__status` rule that no component renders. It was left in place.

## Still open

1. Run the same checks in the Electron runtime (the M0 screenshots are browser-preview only too).
2. Owner decisions: ledger #21 (no on-brand text token, `#fff` in `.v2-button--primary`) and #22 (rail avatar `#ffffff`).
3. Review the side effects above, then decide about deleting the dead `.v2-header__status` rule.
