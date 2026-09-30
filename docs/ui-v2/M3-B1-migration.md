# M3-B1 — Project workspace (migration note)

Status: **written, UNVERIFIED.** None of the changes in this step has been run: no tests,
tsc, build or browser check. M3 is **not** complete. B1 is an intermediate step (see "Pending").

## Scope

- The `uiShellV2` flag stays **OFF** by default. Legacy routes and the M3-A Home/Projects
  surfaces are unchanged, and theme, draft and default-OFF behaviour are kept.
- There is a new V2 surface, `'project'`
  (`apps/desktop/src/renderer/components/v2/ProjectWorkspaceSurface.tsx`). It opens from:
  - Projects cards and list,
  - Home,
  - the navigator's "Dự án" group,
  - the header project switcher.

  Each entry calls `selectProject(id)` and then opens the workspace. In the breadcrumb the
  workspace appears under "Projects". The header no longer shows a V2/Legacy status pill.
- It has seven tabs: Overview, Chat, Runs, Approvals, Files, Tasks and Activity.
  - The active tab is `ProjectMeta.activeSurface`, stored separately for each project.
  - The tabs follow the ARIA tabs pattern: roving `tabIndex`, ArrowLeft and ArrowRight wrap
    around, and Home and End jump to the ends.
- Archived projects never render. Archiving the active project closes the workspace.
- Projects stay per-identity, so an account switch drops the previous account's projects and
  tab memory.

## Data sources (real, project-scoped)

Every tab reads only the gateway sessions whose ids are explicitly in `project.sessionIds`, via
`projectSessions` in `apps/desktop/src/renderer/components/v2/projectWorkspaceData.ts`.
Unassigned sessions and other projects' sessions are never shown.

- **Overview**: session count, running agent turns, items that need attention (turns in
  `error` state or with a step in `error`), and recent context (the newest messages).
- **Runs**: each item is one **agent turn** (an assistant message) with its real steps. No
  durable run store exists yet. The UI says so in user wording ("Chưa có lịch sử chạy lưu lâu
  dài.") and shows no internal type name.
- **Activity**: a feed of the real messages and steps, capped at 50.
- **Chat** (`apps/desktop/src/renderer/components/v2/ProjectChatPanel.tsx`) reuses the
  existing gateway store and the existing `ChatMessageList`/`ChatComposer`. There is no second
  chat engine, and `apps/desktop/src/renderer/pages/Chat.tsx` is unmodified.
  - **Selection** lists only the project's sessions. Choosing one calls `switchSession` and
    then `focusSession`.
  - **Creation** calls `createProjectSession` in
    `apps/desktop/src/renderer/components/v2/composerHandoff.ts`. That runs the existing
    `newGatewaySession` and then explicitly assigns the session to this project. It refuses
    if the project is missing or archived, if the project is full, or while a send is busy.
  - **Send**: right before sending, it re-checks that the gateway's active session still
    belongs to this open project. If not, it refuses with a notice. After the send resolves,
    it clears the composer only if it still holds exactly the draft and images that were sent,
    in the same account, project and session (`composerTicket` / `shouldClearComposer`).
    Later edits, a newer draft in another project, or an account switch are kept.
  - **Stop/Inject** are offered and executed only for the live turn of the viewed session in
    the open, non-archived project that owns it. `interruptTurn` re-reads both stores at click
    time. A turn running elsewhere shows a status notice instead. A refused inject restores
    the typed note to the draft. An izzi-runtime turn is shown as live but is not
    interruptible.

## Known limits

- The composer draft and attached images belong to the global gateway store. The legacy Chat
  page and the project Chat tab therefore share them. A completed send clears only the sent
  snapshot, never content typed afterwards.
- Only one gateway turn runs at a time. While a turn of another session or project is live,
  this tab can neither send nor interrupt it.
- **Approvals, Files and Tasks** show an explicit "chưa được liên kết với dự án" state
  (`data-link-state="unlinked"`). No global records are attached to a project and no data is
  invented.
- There is no Marketing or Knowlead business mapping.
- GitNexus: the root check of ChatPage was LOW risk (3 impacted, called from
  renderPage/App). `useProjectWorkspaceStore` and the B1 symbols are not in the index, so
  their risk is UNKNOWN. `analyze` was not run.

## Tests added (not yet run)

- `apps/desktop/src/renderer/components/v2/ProjectWorkspaceSurface.test.ts` covers:
  - tab roles and focus,
  - per-project tab memory,
  - A/B isolation in Overview, Runs and Activity,
  - switching between projects,
  - the unlinked tabs,
  - archiving,
  - identity reset and restore,
  - the header breadcrumb, with no status pill.
- `apps/desktop/src/renderer/components/v2/projectWorkspaceData.test.ts`
- `apps/desktop/src/renderer/components/v2/composerHandoff.test.ts`: `createProjectSession`
  creation and refusal cases.
- `apps/desktop/src/renderer/styles/v2/shell.test.ts`: the B1 workspace selectors are scoped
  under `.izzi-v2` and use token colors.

## Audit send-back fixes (verify PENDING)

None of the following has been run yet: no tests, tsc, lint or browser check.

- **Interrupt gating**: `interruptState` and `interruptTurn` in `ProjectChatPanel.tsx`. From
  project B, Stop and Inject no longer reach project A's `currentTurnId`, and no note is
  inserted into B.
- **Clear ticket**: after a send, only the exact sent draft and images are cleared, and only
  in the same account, project and session.
- **CSS**: a reset scoped to `.izzi-v2 .v2-project-chat`, for both themes, using existing V2
  tokens. It covers:
  - the message list and bubbles;
  - the composer and its controls;
  - the select and textarea;
  - placeholder and focus styles.

  `.v2-navigator__empty` (muted) and `.v2-inspector__note` (secondary) now win over the
  global `p !important` color. Legacy and flag-OFF styles are untouched. There is no AA,
  avatar or new-token decision.
- **Runs copy**: now in user wording, with no internal type name.
- **Tests**:
  - `apps/desktop/src/renderer/components/v2/ProjectChatPanel.test.ts` executes
    `interruptTurn` against the real stores with a stubbed `window.electronAPI`, and runs the
    handleSubmit clear guard, including the stale-callback case;
  - a Project Chat reset describe in `shell.test.ts`;
  - the Runs copy assertion in `ProjectWorkspaceSurface.test.ts`.
- **Repros to rerun**:
  - `m3-project-audit/1790552980822` (cross-project turn);
  - `m3-project-visual-audit/1790553033067` (light chat at 1280);
  - `m3-shell-copy-audit/1790552239573`.

## Audit follow-up: chat detail controls (verify PENDING)

Status: UNVERIFIED. No tests, tsc or browser run has been done for this follow-up. Root owns
verification.

- **Problem**: in the light theme, audit `m3-chat-details-audit/1790555452591` showed legacy
  cream text and dark/glass surfaces from `agent-gateway.css` and `agent-workspace.css` on the
  Project Chat steps, the copy button, the composer buttons, the attachment menu and the
  footer controls.
- **Fix**: one block at the end of `apps/desktop/src/renderer/styles/v2/shell.css`, scoped to
  `.izzi-v2 .v2-project-chat`, using existing V2 tokens only. It covers:
  - `.chat-step__label`, `__detail` and `__glyph`, with running/done/error glyphs on
    `--v2-info`, `--v2-success` and `--v2-danger`;
  - `.chat-message__copy`, which is no longer faded;
  - the composer `__add`, `__submit`, `__stop` and `__inject` buttons. Submit is
    `--v2-brand-primary` with `--v2-brand-soft` text, and stop uses a `--v2-danger` outline;
  - the attachment `__menu`, which is now a solid panel with `--v2-shadow` and no
    backdrop-filter, plus its labels, hints, items, descriptions and icons;
  - the `__footer`, `__perm`, `__perm-warn`, `__wd`, `__wd-btn` and `__wd-clear` controls.
- **States**: every control gets hover, a `:focus-visible` brand outline, and `:disabled` at
  opacity 0.5. Light unsets `--v2-bg-panel-hover`, so hover uses
  `var(--v2-bg-panel-hover, var(--v2-bg-subtle))`.
- **Out of scope**: legacy and flag-OFF styles are unchanged. There are no new tokens, and no
  AA, avatar or contract change.
- **Tests (not yet run)**: `shell.test.ts` has a new describe, "v2 Project Chat detail controls
  (M3-B1 audit follow-up)". It checks:
  - scope and that the block uses tokens only;
  - role-token colors;
  - that the fade, gradient, glass and shadow are removed;
  - hover, focus-visible and disabled states.
- **Repro to rerun**: `m3-chat-details-audit/1790555452591` (`light-controls.png`,
  `light-menu.png`).

## Capability routing: Home → Agent Marketing prefill (GitNexus PENDING)

Status: **partially verified** (tests, lint, build and browser audit PASS; GitNexus not run).

- PASS 35/35: Codex ran `marketingPrefill.flow.test.ts`, `marketingPrefill.test.ts`,
  `surfaces.test.ts` and `identity.test.ts`.
- Renderer tsc shows only the baseline TS2339.
- Lint found 2 `react-hooks/exhaustive-deps` errors in the flow test's hook shim, not in
  product code. The shim now shares a non-`use*` helper, `memoSlot`. The assertions are
  unchanged and no rule is disabled.
- PASS (Codex, after the `memoSlot` fix): 35/35 again; lint of `marketingPrefill.flow.test.ts`
  and `CustomerMarketingRoom.tsx`; `pnpm build` including main tsc.
- The flow test runs the real components on a **hook shim**. It does not prove real React DOM,
  real StrictMode or browser routing.
- PASS 7/7 browser audit (Codex), no page errors. Harness
  `F:/Ai Tools/Codex/Temp/m3-capability-routing-audit.cjs`, expected results and limits in
  `m3-capability-routing-audit.expected.md` next to it. Artifact:
  `F:/Ai Tools/Codex/Temp/m3-capability-routing-audit/1790573974561/results.json`.
  - Scope: headless Chromium on the Vite dev renderer with real React DOM, `App`/`AppShellV2`
    routing and dev `React.StrictMode` (confirmed). IPC and data are synthetic. This is **not**
    Electron main/preload, a packaged build or a real backend/account.
  - Home → Agent Marketing: the Director receives the exact text once; no `askDirector` or other
    mutation; nothing auto-sent. The Home draft is cleared only after the Director receives it.
    A failed open keeps the draft.
  - Account switch and logout: the old text does not reach the Director.
  - Chat: the draft is kept in the composer and `isSending` stays false.
  - Flag OFF: no V2 rendered.
  - Case g, **observed, policy undecided**: a pending offer survives passing through a non-Home
    page and is then delivered to the Director. This is behavioral evidence only; no cancel-on-leave
    policy is chosen here. It also shows the identity cases are discriminating on that route.
- Baseline, not caused by this slice: renderer TS2339, the budget test and the smoke-glob.
- PENDING: GitNexus impact and detect_changes.

Root owns verification.

- **Home**: a new "Chức năng" select offers Chat (the default) or Agent Marketing, built from
  the existing `v2-field` controls. It has no Knowlead option.
- **Chat**: unchanged. The Agent and Dự án selects and the composerHandoff prefill work as
  before, and nothing is sent.
- **Agent Marketing**: `apps/desktop/src/renderer/components/v2/marketingPrefill.ts` holds
  one RAM-only offer. Home offers its text and opens `customer-marketing`.
  - The existing `DirectorComposer` in
    `apps/desktop/src/renderer/pages/CustomerMarketingRoom.tsx` consumes the offer once on
    mount and only calls `setGoal`, so the user still presses submit.
  - `DirectorComposer` is now exported, only so that the flow test can mount it. Its
    behaviour is unchanged.
  - It does not call askDirector and creates no run or project.
  - No V2 project is mapped to Marketing.
- **Draft**: the Home draft is cleared only by the offer's callback, which runs when the
  Director textarea takes the text. An empty draft offers nothing and shows a message.
- **Cancellation**: an offer is dropped without its callback when:
  - `applyV2Identity` runs (account switch or logout);
  - the user edits on Home or picks a quick chip;
  - the capability changes or a Chat submit happens;
  - Home remounts;
  - a newer offer replaces it.

  A stale callback therefore can never clear a draft, and text cannot cross accounts.
- **Storage**: the offer is never persisted, so a DEV_USER without an id stays RAM-only too.
- **Flag OFF / legacy**: nothing is offered, so the `DirectorComposer` effect is a no-op.
- **Tests, PASS (run by Codex; 35/35 together with the flow test)**:
  - `apps/desktop/src/renderer/components/v2/marketingPrefill.test.ts` covers:
    - consume exactly once;
    - the draft is kept until consume;
    - empty text is refused;
    - a replaced offer's callback never runs;
    - cancellation on account switch and logout;
    - the Chat path is unchanged.
  - Two cases in that file are **source checks, not runtime evidence**:
    - neutral prefill: no `onSubmit(` or `askDirector` in the mount region, and the
      coordinator has no imports;
    - Home route separation.
  - `apps/desktop/src/renderer/components/v2/surfaces.test.ts` checks that Home defaults to
    Chat and offers Agent Marketing.
  - `apps/desktop/src/renderer/components/v2/identity.test.ts`.
- **Runtime flow test (PASS, on a hook shim)**:
  `apps/desktop/src/renderer/components/v2/marketingPrefill.flow.test.ts` mounts the real
  `HomeSurface` and `DirectorComposer`. It uses a hook shim and executes their effects and
  handlers; the store mocks are the same as in `surfaces.test.ts`.
  - The shim stands in for React, so a pass does not prove real React DOM, real StrictMode
    or browser routing. The "StrictMode effect replay" case below is simulated. The `DirectorComposer`
  `onSubmit` spy stands in for `api.askDirector`, which is reachable only through it. The
  cases are:
  - **Delivery**: the text arrives once. The draft is cleared only after Director takes it.
    A second Director opens empty, and `onSubmit` is never called without a manual submit.
    This also holds under a StrictMode effect replay.
  - **Empty or whitespace draft**: a message is shown. There is no navigation and no draft
    change.
  - **Director never opens, or Home remounts first**: the draft is kept and Director stays
    empty.
  - **Actions after the offer**: an edit, a chip or a switch to Chat drops the old text.
  - **A resubmitted replacement draft**: Director receives only the new text.
  - **Account switch or logout** via `applyV2Identity`: Director is empty and nothing is
    cleared.
  - **Flag OFF / legacy**: nothing is offered, and Director is empty.

## Pending

- Full Approvals, Files and Tasks functionality with a real domain link.
- Status/usage and a durable AgentRun. Capability routing covers only the Home → Agent
  Marketing text prefill.
- M4 and everything after it.
- Codex verification of this step: focused tests, build/main tsc, lint, the doc gate, and a
  browser check of the workspace in the light and dark themes.
- Capability routing: GitNexus impact and detect_changes. (Browser audit 7/7 PASS on headless
  Chromium with synthetic IPC; Electron/packaged build not exercised.)
- **Undecided, with no proven bug and no policy chosen**: a pending offer survives while the
  user is on non-Home pages (observed in browser audit case g). It is dropped only by a Director
  mount, a Home remount, an identity change, an edit, a chip, a capability change or a Chat
  submit.
