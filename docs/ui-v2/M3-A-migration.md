# M3-A — Home and Projects surfaces (migration note)

Base: `25428f8`, working tree on top of the M0–M2 changes (all uncommitted).
Status: **AUDIT SEND-BACK (identity lifecycle) written, verification PENDING.** Codex's
140/140 focused tests, build, main tsc, changed-file lint and M3 doc gate PASS were measured
**before** these fixes; the send-back found three defects reproduced by
`F:/Ai Tools/Codex/Temp/m3-identity-audit.cjs`: (1) an in-flight gateway send survived an
account switch and could still send A's payload; (2) an old hydrate was accepted after
A → logout → A; (3) a scoped save/delete could hit a row of another type that shared the id.
All three are fixed with regression tests, but **none of the changes in this step has been
executed.** M3 is **not** complete (see "Pending").

## Scope

- The `uiShellV2` flag stays **OFF** by default and the legacy `App` shell is unchanged when it is off.
- When the flag is ON, `AppShellV2` can open two V2 surfaces, Home and Projects, in place of
  the legacy page (`children`). Opening any legacy page closes the surface again, so legacy
  routes still work.
- Projects are renderer-local metadata (`apps/desktop/src/renderer/store/projectWorkspace.ts`).
  - `AgentChatSession` has **no** `projectId`.
  - Recent and unassigned sessions are derived from the gateway sessions.
  - A session joins a project only through an explicit "Gán vào dự án" action.
  - A project holds at most `SESSION_IDS_MAX` (500) sessions. The cap is enforced at assign
    time (`assignSession` returns `false`) and at load time, so a reload never drops a session
    that was accepted before; the UI shows a message instead of dropping silently.
- Active project follows the session: every path that opens a session (Home handoff, Home
  recent, Projects, Navigator "Gần đây") calls `focusSession(id)`, which selects the open project
  that owns the session, or clears the active project when the session is unassigned.
- Home → Chat handoff (`apps/desktop/src/renderer/components/v2/composerHandoff.ts`):
  - It hydrates before binding a session.
  - It respects the selected `agentId`.
  - It re-checks that the project still exists, is not archived and is not full (`project-full`).
  - It never sends project A's draft into session B.
  - On empty/busy/occupied/full/error it keeps the draft; on success it hands off exactly once.
  - The pending handoff lives in a module-level coordinator with a generation counter, so it
    survives a HomeSurface remount. Editing the draft, changing the agent or project selector,
    opening another project/session, unmounting Home, and an account switch or logout
    (`applyV2Identity`) call `cancelPendingHandoff()`; a cancelled or stale result returns
    `cancelled` and never switches session, writes the draft, focuses a project or navigates.
  - Correction to an earlier finding: a "stale header project switch" repro was **not** proven.
    The header switcher opens Projects, which unmounts Home, and unmount already cancels. No
    code was changed for it on assumption.
- No provider call, token or JWT goes to the renderer, and no approval step is bypassed.
- Knowlead stays a disabled placeholder. The Marketplace mapping is unchanged.

## Project metadata storage

- Key: `izziV2ProjectWorkspace:<userId>`, where `<userId>` is the stable `currentUser.id`
  (normalized, length-capped). Only whitelisted metadata is stored; no credential, token or
  session content.
- `App.tsx` calls `applyV2Identity(currentUserId)` when `uiShellV2` is on; it cancels any pending
  Home handoff, then calls `setIdentity(currentUserId | null)`. Changing identity
  rehydrates from that account's key; `setIdentity(null)` (logout) clears projects and the
  active project from memory and stops writing.
- Without an identity nothing is read or written. The bare legacy key `izziV2ProjectWorkspace`
  is **never** read for a signed-in user, so legacy metadata is not adopted by any account.
- Credential authority stays in the main process; the renderer only receives the user id.

## Files

| File | Status | Change |
|---|---|---|
| `apps/desktop/src/renderer/store/projectWorkspace.ts` | new | Store actions `createProject` / `selectProject` / `focusSession` / `togglePin` / `archiveProject` / `assignSession` (returns boolean) / `unassignSession` / `setSurface` / `setIdentity`; `filterProjects`, `projectForSession`, per-account storage key. There is **no** rename action. |
| `apps/desktop/src/renderer/store/projectWorkspace.test.ts` | new | 30 `it(` cases (static count) |
| `apps/desktop/src/renderer/components/v2/composerHandoff.ts` | new | Hydrate, agentId, project revalidation, `project-full`, generation/cancel coordinator, `focusSession` on success |
| `apps/desktop/src/renderer/components/v2/composerHandoff.test.ts` | new | 19 `it(` cases (static count), including focus, remount/cancel, selector-supersede and full-project regressions |
| `apps/desktop/src/renderer/components/v2/identity.ts` | new | `applyV2Identity`: cancel pending handoff, then `setIdentity` |
| `apps/desktop/src/renderer/components/v2/identity.test.ts` | new | 1 `it(` + 1 `it.each` with 2 rows (static count): switch/logout mid-hydrate is `cancelled` with no draft/switch/new session/focus; coordinator is freed |
| `apps/desktop/src/renderer/components/v2/sessionLabel.ts` | new | `sessionPreview` / `sessionLabel`, `SESSION_PREVIEW_MAX` |
| `apps/desktop/src/renderer/components/v2/sessionLabel.test.ts` | new | 4 `it(` cases (static count) |
| `apps/desktop/src/renderer/components/v2/HomeSurface.tsx` | new | Controlled prompt (`draft` / `onDraftChange`), `HANDOFF_MESSAGES` incl. `project-full`, supersede/cancel on edit, agent/project selector change, open and unmount, `focusSession` on open |
| `apps/desktop/src/renderer/components/v2/ProjectsSurface.tsx` | new | Filters Đang làm / Đã ghim / Lưu trữ, unassigned sessions, assign disabled without an active project, full-project message, `focusSession` on open |
| `apps/desktop/src/renderer/components/v2/surfaces.test.ts` | new | 8 `it(` cases (static count). SSR rendering of AppShellV2 (legacy child kept), Home, Projects, ProjectHeader switcher, ContextNavigator groups. Uses `vi.mock` live-state hooks because zustand's SSR snapshot ignores `setState` seeding. |
| `apps/desktop/src/renderer/components/v2/AppShellV2.tsx` | modified (M2 file) | `activeSurface` + `homeDraft` state, surface rendering, `navigate` closes the surface. Corrective slice 05:59: `resolvedTheme` state + `toggleTheme` (flips only `data-theme` and writes the preference through `setUiShellV2Theme`, so no child remounts); `<main>` gets `v2-workspace--surface` only while Home/Projects is open |
| `apps/desktop/src/renderer/components/v2/ContextNavigator.tsx` | modified (M2 file) | Project links (★ pinned), "Phiên chưa gán · N", "Gần đây" (shown only with `onSelectSurface`), `focusSession` on open |
| `apps/desktop/src/renderer/components/v2/ProjectHeader.tsx` | modified (M2 file) | Project switcher (open projects only), V2/Legacy status. Corrective slice 05:59: optional `theme` / `onToggleTheme` props; the switch is a `<button aria-label="Giao diện sáng" aria-pressed>` rendered only when `onToggleTheme` is given |
| `apps/desktop/src/renderer/components/v2/GlobalRail.tsx` | modified (M2 file) | Home/Projects rail entries |
| `apps/desktop/src/renderer/components/v2/navModel.ts` | modified (M2 file) | `V2Surface` |
| `apps/desktop/src/renderer/App.tsx` | modified (M1–M2 file) | M3-A adds `applyV2Identity(currentUserId)` while `uiShellV2` is on, plus (security follow-up) `setGatewayIdentity(currentUserId)` regardless of the flag |
| `apps/desktop/src/main/gateway/gateway-session-ipc.ts` | new (security follow-up) | `registerGatewaySessionIpc`: `gatewaySessions:list/save/delete` resolve the owner from `AuthManager.getCurrentUser().id` in main and reject a missing/mismatched renderer-claimed owner; account-scoped type + row id (see "Gateway session storage"). Audit send-back: save/delete first read the existing row's type via `getUserDataType` and fail closed (`{ ok: false }`, row untouched) unless the row is absent or already has this owner's scope type |
| `apps/desktop/src/main/gateway/gateway-session-ipc.test.ts` | new (security follow-up) | 10 `it(` + 1 `it.each` with 4 rows (static count): same session id across accounts, legacy rows untouched, late save after logout / stale save after switch fail closed, scoped delete, invalid ids, unambiguous separator; audit send-back adds id-collision regressions (legacy row at the scoped id, `budget_entry` row at the scoped id: save + delete fail closed, row unchanged, no write/delete call) and an own-row overwrite/delete check |
| `apps/desktop/src/main/db/database.ts` | modified (audit send-back) | Adds `getUserDataType(id)` (`SELECT type FROM user_data WHERE id = ?`, `null` when absent). No schema change; existing methods untouched |
| `apps/desktop/src/main/index.ts` | modified | The three inline `gatewaySessions:*` handlers are replaced by `registerGatewaySessionIpc({ store: dbManager, currentUserId })` |
| `apps/desktop/src/main/preload.ts` | modified | `gatewaySessions.list(ownerId)`, `save(ownerId, session)`, `delete(ownerId, id)` |
| `apps/desktop/src/renderer/store/agentGateway.ts` | modified (security follow-up) | `persistOwnerId` + `setGatewayIdentity`; hydrate/save/delete pass the owner, no-op while signed out, drop stale hydrate results and pending saves after an owner change; identity change resets in-memory chats (never deletes on disk). Audit send-back: a module-level identity generation is bumped on every owner change; `hydrateFromDisk` (success and error), `sendGatewayMessage` (after every await, before any side effect or state write) and `setReasoningEffort` bail when the generation is stale; an identity change resets `isSending`, `currentTurnId`, `reconfiguringSessionId`, error and `hydrated`, and best-effort aborts the old turn via the existing `customProvider.abort`. Corrective slice 05:59: `applyStreamEvent` returns early unless `isSending` is true, `currentTurnId` is set and `event.turnId === currentTurnId` (previously it matched only the message id) |
| `apps/desktop/src/renderer/store/agentGateway-identity.test.ts` | new (security follow-up) | 14 `it(` + 1 `it.each` with 4 rows (static count). Corrective slice 05:59 adds: stale delta, reasoning and step events for a restored turn after A → logout → A leave the restored history unchanged with `currentTurnId` null; stream events still apply to the live turn of the current identity. Audit send-back adds: old hydrate success and old hydrate error after A → logout → A do not clobber the new login; account change during the `getConfig` read never calls `custom.chat` and resets turn state; a chat reply resolving after the switch leaves B's turn state and sessions untouched. `setReasoningEffort` guards have no dedicated test |
| `apps/desktop/src/renderer/styles/v2/shell.css` | modified (M2 file) | Home/Projects rules, all scoped under `.izzi-v2` (no `:is()` — the test parser splits on commas). Corrective slice 05:59: legacy-leak overrides, existing tokens only (see "Corrective slice after the 05:59 audit"). Fix after the 06:17 audit: `.v2-empty`, `.v2-empty p` and `.v2-surface__status` pin `--v2-text-secondary` over the legacy global `p` rule (see "Empty-state copy fix after the 06:17 audit") |
| `apps/desktop/src/renderer/styles/v2/shell.test.ts` | modified (M2 file) | 14 `it(` cases (static count). Reset-rule regex anchored to the `button` type selector (`/(^|[\s>+~])button$/`) so `.v2-button` no longer matches; the audited `.v2-navigator button` regression assertion is kept. Adds the "Home and Projects surface styles (M3-A)" scoping contract. Corrective slice 05:59 adds 7 cases: "v2 surface legacy-leak overrides (M3-A)". The 06:17 fix adds 1 case in that block: Home/Projects paragraph copy stays on the secondary token over the legacy global `p` rule |
| `apps/desktop/src/renderer/uiShellV2.ts` | modified (M1 file, corrective slice 05:59) | `setUiShellV2Theme(theme, storage?)` writes the existing `uiShellV2Theme` key; returns `false` instead of throwing when storage refuses the write |
| `apps/desktop/src/renderer/uiShellV2.test.ts` | modified (M1 file, corrective slice 05:59) | 9 `it(` cases (static count); adds the write/read round trip and the `QuotaExceededError` → `false` case |
| `apps/desktop/src/renderer/components/v2/AppShellV2.test.ts` | modified (M2 file, corrective slice 05:59) | 16 `it(` cases (static count); legacy page has no `v2-workspace--surface`; labelled theme switch with `aria-pressed` per theme, absent without `onToggleTheme` |

The flag-OFF behaviour is covered by the existing `apps/desktop/src/renderer/uiShellV2.test.ts`.

## Impact analysis (GitNexus, read-only)

| Symbol | Risk | Note |
|---|---|---|
| `useAgentGatewayStore` | **HIGH** (5 impacted, 4 processes) | **Modified** in the security follow-up (owner-scoped persistence); impact **not** re-run after the change |
| `useAgentWorkspaceStore` | **CRITICAL** (9 impacted, 7 processes) | Read-only use; the store was **not** modified |
| `App` | LOW | Modified in M3-A: `applyV2Identity` effect only (SEND-BACK 2: impact not re-run) |

`gitnexus analyze` was **not** run, so the index is stale for the new symbols
(`focusSession`, `setIdentity`, `cancelPendingHandoff`, `projectForSession`, …).

## Verification

### Codex audit, 28/09 (before the send-back fixes)

- V2 + M3 vitest + direct smoke: **99 pass / 4 fail**.
- Renderer `tsc`: new `TS2769` at `apps/desktop/src/renderer/components/v2/surfaces.test.ts:83`,
  outside the M0 baseline.
- Main-process `tsc`: **PASS**.
- `eslint`: **PASS**. `build`: **PASS**.
- socrates-tier1: 18 new path-not-found entries (caused by the `Root:`-relative paths in the
  previous version of this note).

The audit report did not give per-command exit codes or durations, so none are recorded here.

### After the send-back fixes

**Nothing has been run.** The Bash tool in the authoring session is broken (shell-snapshot
EOF); the fixes were made with file edits only. Every row below is UNVERIFIED.

Run from `apps/desktop` (or with `pnpm --filter @openclaw/desktop exec`):

| # | Command | Exit | Time | Expected / baseline |
|---|---|---|---|---|
| 1 | `vitest run src/renderer/components/v2 src/renderer/store/projectWorkspace.test.ts src/renderer/styles/v2 src/renderer/uiShellV2.test.ts` | PENDING | PENDING | All green, including the 4 audit failures |
| 2 | `eslint` on the files in the table above | PENDING | PENDING | No errors |
| 3 | Main-process `tsc --noEmit` | PENDING | PENDING | PASS (no baseline) |
| 4 | Renderer `tsc --noEmit` | PENDING | PENDING | Only the M0 baseline `TS2339` in `apps/desktop/src/renderer/pages/CustomerMarketingChannels.tsx(370,40)`; `TS2769` gone |
| 5 | `build` | PENDING | PENDING | Succeeds |
| 6 | Direct `vitest run` of `agentWorkspace.smoke` | PENDING | PENDING | 1/1 (M0 baseline) |
| 7 | `vitest run src/main/gateway src/renderer/store/agentGateway-identity.test.ts src/renderer/store/agentGateway-local-cockpit.test.ts --maxWorkers=1` | PENDING | PENDING | All green, including the audit send-back regressions |
| 7b | Re-run `F:/Ai Tools/Codex/Temp/m3-identity-audit.cjs` | PENDING | PENDING | All three reproduced defects no longer reproduce |
| 8 | Electron proof: account A chats, logout, account B login | PENDING | PENDING | B sees none of A's chats; A sees them again after re-login; legacy bare `gateway_session` rows are not shown and stay in the DB; a save after logout returns `{ ok: false }` |

### Codex audit, 28/09 05:59 (after the audit send-back)

Reported by Codex; the authoring session did not run these commands.

- 147/147 focused tests PASS, and 8/8 local-cockpit PASS.
- build/main `tsc`, lint and the M3 doc gate PASS. Renderer `tsc` shows only the baseline `TS2339`.
- `m3-identity-audit` no longer reproduces any of the 3 previous defects.
- Real Electron with the production preload and SQLite, using a synthetic identity: 11/11 PASS,
  including the legacy collision.
- Still open at 05:59:
  - `F:/Ai Tools/Codex/Temp/m3-stream-audit.cjs` reproduces a stale stream. An in-flight turn of A
    is saved, then logout, then login A and hydrate. `applyStreamEvent` with a delta for the old
    turn then changes the restored history while `currentTurnId` is `null`. The cause is that
    `applyStreamEvent` matched only the message id.
  - V2 Home/Projects light/dark CSS leak, per `F:/Ai Tools/Codex/Temp/m3-behavior-audit/light-home-1280x800.png`
    and `results.json`. The workspace is transparent, so the dark body shows through.
    Inputs, selects and the textarea inherit the legacy dark background and `-webkit-text-fill-color`.

### Corrective slice after the 05:59 audit

**Nothing has been run. Every change and row in this section is UNVERIFIED.** GitNexus
`impact` / `analyze` was not run for this slice either.

The changes:

- **Stream gate.** `applyStreamEvent` now drops any event unless a turn is live (`isSending`
  is true and `currentTurnId` is set) and `event.turnId === currentTurnId`. Old-generation
  turns are already cleared on every identity change, so this binds events to the live turn of
  the current identity/generation. IPC is unchanged.
- **Surface backdrop.** `.izzi-v2 .v2-workspace--surface` sets `background: var(--v2-bg-canvas) !important`.
  The modifier is on `<main>` only while Home/Projects is open. Legacy pages keep the plain
  `main-content v2-workspace` class, and the flag-OFF shell never renders it.
- **Control overrides.** These apply to `.v2-field__select`, `.v2-field__input` and `.v2-home__prompt`
  under the surface modifier, and to `.izzi-v2 .v2-header__project-select`:
  - token background and `color: var(--v2-text-primary) !important`;
  - `-webkit-text-fill-color: currentColor !important`;
  - a token focus ring.
  The fields use `var(--v2-bg-deep, var(--v2-bg-panel))`, because light leaves `--v2-bg-deep`
  initial. No bare `input` / `textarea` / `select`, `.cmr-` or `.main-content` selector was
  added. No new token or colour was added.
- **Theme switch.** `ProjectHeader` shows a labelled `aria-pressed` button, "Giao diện sáng".
  `AppShellV2.toggleTheme` changes only `data-theme` and saves the choice through
  `setUiShellV2Theme` under the existing `uiShellV2Theme` key. The Home draft, the active
  project and the open surface live in state that the toggle does not touch. The SSR unit tests
  cannot prove this, so it is checked in the browser (row C4).

| # | Command / check | Exit | Time | Expected |
|---|---|---|---|---|
| C1 | `vitest run src/renderer/store/agentGateway-identity.test.ts src/renderer/styles/v2 src/renderer/components/v2 src/renderer/uiShellV2.test.ts --maxWorkers=1` | PENDING | PENDING | All green: identity 14 `it(` + 4 `it.each` rows, `shell.test.ts` 13, `AppShellV2.test.ts` 16, `uiShellV2.test.ts` 9 |
| C2 | Re-run `F:/Ai Tools/Codex/Temp/m3-stream-audit.cjs` | PENDING | PENDING | A stale delta, reasoning or step after A → logout → A/hydrate leaves the restored history unchanged; a live turn of the current identity still streams |
| C3 | Re-run `m3-behavior-audit`, computed style, light and dark at 1280x800 | PENDING | PENDING | Light: `main.v2-workspace--surface` background is `rgb(246, 246, 249)`, not transparent. Dark: `rgb(23, 24, 28)`. The field select/input, the Home prompt textarea and the header project select take their background and `color` from the tokens, and `-webkit-text-fill-color` equals the computed `color`. Legacy pages and `.cmr-*` are unchanged and carry no `v2-workspace--surface`. Flag OFF is unchanged |
| C4 | Browser: toggle the theme with a Home draft typed, a project selected and Projects open, then reload | PENDING | PENDING | The draft, project and surface survive the toggle. After reload, `localStorage.uiShellV2Theme` restores the chosen theme |
| C5 | Rows 2–5 above (lint, main/renderer `tsc`, build) | PENDING | PENDING | As above |
| C6 | Re-run 147 focused, 8 local-cockpit, `m3-identity-audit` and the Electron 11/11 | PENDING | PENDING | No regression of the fixes confirmed at 05:59 |

Rows C1–C6 are superseded by the Codex audit at 06:17 below. The C1 count for `shell.test.ts` is
now 14 (see D1).

### Codex audit, 28/09 06:17

Codex reported these results; the exit codes and durations are not recorded in this note.

- 167/167 focused tests pass. Build, main `tsc`, lint and the doc gate pass. Renderer `tsc` shows
  only the baseline TS2339.
- The browser pass over 12 combinations passes for canvas and control colors, backgrounds and
  overflow.
- Switching the theme from the keyboard at runtime preserves the draft, the project and the
  surface. Reloading restores the saved preference, and flag OFF falls back to the legacy shell.
  Both pass.
- The stale-stream repro (`m3-stream-audit.cjs`) now returns false.
- **One CSS defect remained:** in light mode, the empty-state paragraphs on Home and Projects
  are nearly white. The computed `color` and `-webkit-text-fill-color` of `.v2-empty` and
  `.v2-empty p` are `rgba(243, 241, 234, 0.62)`. Evidence:
  - `F:/Ai Tools/Codex/Temp/m3-theme-audit/1790550930268/results.json`;
  - `light-home-1280x800.png`.
- The external `m3-theme-audit.cjs` now checks `emptyText` against the secondary token and fails
  on this defect.

### Empty-state copy fix after the 06:17 audit (UNVERIFIED)

**Root cause.** Legacy `apps/desktop/src/renderer/styles/izzi-optimized.css` (around line 113) has a rule for
`p, .chat-page__subtitle, …` that sets `color: var(--izzo-muted) !important`. It beats both the
color that `.v2-empty` passes down by inheritance and the non-`!important` color set on the V2
`<p>` elements.

**The fix.** It uses the existing `--v2-text-secondary` token, adds no new token and makes no AA
decision. In `shell.css`, three selectors now set
`color: var(--v2-text-secondary) !important; -webkit-text-fill-color: currentColor !important`:
- `.izzi-v2 .v2-empty`, which covers `p.v2-empty` in both Home and Projects;
- `.izzi-v2 .v2-empty p`, which covers the nested `<p>` in Home's `div.v2-empty`;
- `.izzi-v2 .v2-surface__status`, the other Home/Projects `<p>` role, which hits the same override.

`.izzi-v2 .v2-empty p` has specificity (0,2,1), which beats legacy `p` (0,0,1) when both are
`!important`.

**Deliberately unchanged.** Two shell `<p>` roles outside Home/Projects are probably hit by the
same legacy rule, but they are out of scope for this fix:
- `.v2-navigator__empty`, which uses `--v2-text-muted`;
- `.v2-inspector__note`, which uses `--v2-text-secondary` without `!important`.

**Regression test.** A new case in `shell.test.ts` asserts the three declarations and the
specificity. None of this has been run.

| # | Command / check | Exit | Time | Expected |
|---|---|---|---|---|
| D1 | `vitest run src/renderer/styles/v2/shell.test.ts --maxWorkers=1` | PENDING | PENDING | 14/14 green, including the new paragraph-copy case |
| D2 | Re-run `m3-theme-audit.cjs`, light and dark, Home and Projects, 1280x800 | PENDING | PENDING | The computed `color` and fill of `.v2-empty`, `.v2-empty p` and `.v2-surface__status` equal the computed `--v2-text-secondary` for that theme, and the `emptyText` check passes |
| D3 | Re-run the 167 focused tests, lint, main/renderer `tsc`, build, and the 12-combination browser pass | PENDING | PENDING | No regression of what passed at 06:17 |

### Known M0 baseline failures (not caused by M3-A)

- The renderer `TS2339` error in `CustomerMarketingChannels.tsx(370,40)` (the only renderer baseline).
- The `budget-service` test expects `{removed: 1}` but receives 2.
- `test:smoke` reports "No test files found", while the direct smoke run passes 1/1.
- The docs gate fails.

See `docs/ui-v2/M0-baseline.md`.

## Gateway session storage (security follow-up)

No schema migration: the existing `user_data` primitives (`getUserData(type)`,
`cacheUserData(id, type, data)`, `deleteUserData(id)`) are reused with an owner-scoped type.

- Type: `gateway_session:v1:<encodeURIComponent(ownerId)>`.
- Row id: `<type>:<sessionId>`, so the same session id under two accounts is two rows.
- The owner is always `AuthManager.getCurrentUser().id` read in main per call. The renderer
  sends the owner it believes is signed in; main rejects it when it is missing, not a bounded
  string, or different from the main-side user (`list` → `[]`, `save`/`delete` → `{ ok: false }`).
- Legacy rows with the bare `gateway_session` type are never listed, overwritten, deleted or
  adopted; they stay in the DB because their owner is unknown.
- Id-collision invariant: `user_data` is keyed by `id` alone and `cacheUserData` upserts on
  `id` (rewriting `type`), while `deleteUserData` deletes by `id`. Save/delete therefore read the
  existing row's type first and proceed only when the row is absent or its type equals this
  owner's scope; any other type (legacy or unrelated) fails closed with `{ ok: false }` and the
  row is left intact. Check and write run synchronously in the main process, so nothing can
  interleave. Covered by the collision regressions in `gateway-session-ipc.test.ts`.
- No token, JWT or credential crosses to the renderer; only the user id already exposed by auth.

## Known limitations

- The dev fallback user (`DEV_USER`) has no `id`, so in dev builds project metadata and
  gateway chats are RAM-only and are lost on reload.
- Legacy metadata under the bare `izziV2ProjectWorkspace` key is left in storage and ignored;
  there is no migration path because it has no known owner. The same applies to bare
  `gateway_session` rows.
- A session whose scoped row id collides with an existing row of another type cannot be saved
  (fail closed, see the id-collision invariant); the other row is preserved rather than adopted.
- A debounced gateway save (700 ms) still pending at logout/account switch is dropped
  (fail closed), so the last edits within that window are not persisted.
- `agentGateway-identity.test.ts` re-imports the store per test with a stubbed `window`; it
  assumes no other module touches `window` at import time.

## Pending (M3 not complete)

- **SEND-BACK 2 P1 security:** implemented (see "Gateway session storage"), verification
  **PENDING** (rows 7–8 above, plus tsc/eslint/build for the main and preload changes).
- **Audit send-back (identity lifecycle):** in-flight send/turn guard, hydrate generation guard
  and id-collision fail-closed implemented with regression tests; verification **PENDING**
  (rows 7, 7b, plus main/renderer tsc, eslint on `database.ts`, `gateway-session-ipc*.ts`,
  `agentGateway*.ts`, and build). GitNexus impact analysis was not run for this step (tool
  restrictions); `database.ts` only gains one new method. The Codex audit at 05:59 reported
  these fixes as passing (see "Codex audit, 28/09 05:59"). The exit codes and durations are not
  recorded in this note.
- **Corrective slice after 05:59:** the stream gate, the surface backdrop and control overrides,
  and the runtime theme switch. All are implemented and all verification is **PENDING**
  (rows C1–C6). None of it has been run. The Codex audit at 06:17 reported these as passing
  (see "Codex audit, 28/09 06:17").
- **Empty-state copy fix after 06:17:** the light Home/Projects paragraph copy is pinned to
  `--v2-text-secondary`. Implemented with a regression test; verification **PENDING** (rows
  D1–D3). GitNexus impact/analyze was not run for this fix. `.v2-navigator__empty` and
  `.v2-inspector__note` were not changed.
- Re-run the verification table above for the SEND-BACK 2 renderer checkpoint
  (`identity.test.ts`, the new `composerHandoff.test.ts` case, `HomeSurface.tsx`, `App.tsx`).
- All verification commands above, with exit codes and durations recorded; browser/Electron checks.
- Capability routing.
- Project workspace tabs (`activeSurface` is stored but tabs are not rendered).
- Status / usage in the header and inspector.
- Light-theme chrome and runtime theme switching for the new surfaces: implemented in the
  corrective slice after 05:59. The 06:17 audit reported them as passing, except for the empty-state
  copy, which is fixed but **UNVERIFIED** (rows D1–D3).
- AA contrast audit, avatar and token options: undecided, left for the product owner.
- Knowlead: still a disabled placeholder.
- M3-B and M4–M8: not started.
