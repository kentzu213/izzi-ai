# M4 — Agent Marketing V2 (migration note)

Status: **written, partially verified, runtime UNVERIFIED.** Treat every claim below as
source-level only until the remaining checks pass.

| Check | Result |
|---|---|
| Renderer tsc (Codex, read-only) | Pass apart from the TS2339 baseline (`CustomerMarketingChannels.tsx:370`). |
| eslint on touched files (Codex) | 1 error: `react-hooks/exhaustive-deps` at `CustomerMarketingRoom.tsx:3213`, in the M3 capability-sync effect. Fixed by hoisting `workspacePlan` / `workspaceRole` (same trigger conditions). **Re-run UNVERIFIED**: the second Codex run hung for 1800 s with no output. |
| vitest | **UNVERIFIED.** Codex read-only sandbox fails with `spawn EPERM`; the writer's and every agent's Bash fail with `ENAMETOOLONG` (`uv_spawn`). |
| build / browser / Electron | **UNVERIFIED.** Same tooling block. |
| GitNexus impact on `CustomerRoom` | LOW. |
| typescript-reviewer | Approved. MEDIUM notes only: the wiring tests match source strings, the hook-order heuristic did not see `useLayoutEffect` / `useContext` (now covered), and there is no behavioural test that a hidden panel keeps its state. |

## Scope

- The `uiShellV2` flag stays **OFF** by default.
  - `App.tsx` passes the flag as `<CustomerMarketingRoomPage v2={isShellV2} />`.
  - `CustomerMarketingRoomPage` and `CustomerRoom` both default to `v2 = false`.
- The `if (v2) {` branch in `CustomerRoom` comes after every hook, so React hook order is the
  same in both modes.
- The legacy return (`WorkspaceNav` and every legacy view) is unchanged.
- With the flag ON, the room renders `AgentMarketingWorkspaceV2`
  (`apps/desktop/src/renderer/components/v2/AgentMarketingWorkspaceV2.tsx`). It has five tabs
  plus a permanent inspector.
  - The tabs follow the ARIA tabs pattern: roving `tabIndex`, Arrow keys wrap around, and
    Home/End jump to the ends.
  - Panels mount lazily: a panel mounts the first time its tab opens, then stays mounted with
    `hidden` (`withMountedTab`). A hidden panel keeps its React state.
  - The default tab is Conversation, and a successful Director request returns to it.

## Tabs → existing surfaces (reused, not rewritten)

| Tab | Surface | Data source |
|---|---|---|
| Conversation | `DirectorView` | `snapshot` + existing `askDirector` mutation |
| Plan | `GoalsView` | `snapshot` |
| Content | `CustomerMarketingResources kind="content"` | existing resource IPC, role-gated as before |
| Analytics | `CustomerMarketingCapabilityWorkbench id="analytics-copilot"`, or a state-only empty panel | `getMarketingAnalytics` (read) |
| Files | `AgentMarketingFilesList` | `snapshot.media.artifacts` only |
| Inspector | `ApprovalsView` + the external-action guard | existing `reviewApproval` mutation, `snapshot.externalActionsAllowed` |

### Analytics gate

The Analytics gate is `resolveAnalyticsTabGate`. It reuses `resolveCustomerCapabilitySurface`
from M3, so the plan, role-permission and core-source rules are identical to the legacy
capability view.

- The workbench mounts only for `surface_setup` and `surface_ready`.
- Every other state shows fixed copy with no numbers: `missing`, `surface_catalog_only`,
  `surface_plan_required`, `surface_permission_required`.
- The report itself is shown only when the backend returns `synced`. No metric is invented.

## Guards kept

- The V2 component has no IPC, no mutation and no `window.*` API access. It only arranges slots.
- The external-action guard displays `externalActionsAllowed` as-is and never changes it.
- Approval, capability, permission and role rules are the existing ones. Nothing is bypassed.
- No publish/execute path, no citation, no persistent thread and no Files API were added.

## Contract gaps (not faked)

- **Files API**: there is none. The Files tab lists only media-job artifacts. When there are
  none, it says so: "Chưa có tệp nào. Tệp xuất hiện khi một media job tạo artifact."
- **Persistent thread**: there is none. Conversation shows only the latest Director reply that
  is already in the snapshot.
- **Approval consequence**: `reviewApproval` changes workflow state only. The UI claims no
  external effect.
- The V2 branch deliberately omits Campaigns, Channels, Assets, Knowledge, Brand, Video, Team
  and Apps because they are outside the M4 spec. They remain reachable only with the flag OFF.

## Audit fixes (source-level, UNVERIFIED at runtime)

| Issue | Fix |
|---|---|
| Unsent Director draft lost on tab switch | Lazy mount + keep mounted with `hidden`. |
| Analytics refetched on every visit | Same fix: the workbench mounts once and its effect does not rerun. |
| `.v2-project-panel { display:flex }` would defeat `[hidden]` | New rule `.izzi-v2 .v2-agent-marketing .v2-project-panel[hidden] { display:none }`, which has higher specificity. |
| Director success also called `selectView('director')` | Now `if (v2) setV2Tab('conversation'); else selectView('director');`. |
| Analytics `onOpen` always went to Conversation | `onOpen={openFromWorkbench}` → `resolveAgentMarketingOpenTab`: `director`→Conversation, `content`→Content, every other view is ignored (no V2 tab). |
| Frame took the legacy `cmr-page` background/text | Root is now `cmr-page v2-agent-marketing-room`; `.izzi-v2 .v2-agent-marketing-room` (it does not name `.cmr-page`; its specificity still beats the legacy rule) uses `--v2-bg-canvas` / `--v2-text-primary`, and tabs get a `--v2-brand-primary` focus ring. |

## Known issues (remaining)

- `.cmr-page` stays on the room root on purpose: it hosts the `--cmr-*` tokens that the reused
  legacy views (DirectorView, GoalsView, ApprovalsView, WorkspaceHeader, alerts, Settings
  drawer) still read. Removing it needs those views restyled first, which is M8 scope.
- Hidden panels keep their effects alive. Any polling inside a hidden panel keeps running; no
  such polling was found in the four reused slots, but this is not runtime-verified.
- The policy for Home offers when the user leaves Home is still undecided (M3 case g). It is
  not decided here.

## Tests added (not yet run)

- `apps/desktop/src/renderer/components/v2/AgentMarketingWorkspaceV2.test.ts` covers:
  - tab order and default tab; one tabpanel per tab, with correct ids and `aria-*`; only the
    active slot mounts on first render and the other four panels carry `hidden`;
  - `withMountedTab`: same reference when already mounted, no mutation, and a round trip keeps
    Conversation and Analytics mounted;
  - `resolveAgentMarketingOpenTab`: director→conversation, content→content, the rest → null;
  - wiring: the Director handler guards `selectView` behind the flag, the V2 branch uses
    `onOpen={openFromWorkbench}`, and the root carries `v2-agent-marketing-room`;
  - the inspector is always present;
  - the guard shows Bật/Tắt;
  - all six gate states, including extension source, low plan, and viewer/reviewer roles;
  - gate copy contains no digits;
  - Files: empty state, short hash, size, `dateTime`, invalid date;
  - source wiring: the flag comes only from `App`, the default is OFF, the branch comes after
    every hook, legacy `WorkspaceNav` is kept, and the component has no IPC.
  - ledger #6, "never remounts the Director draft or Analytics fetch on a tab switch": the page
    passes no tab-keyed `key` and picks slots from `snapshot`, not `v2Tab`; the draft is local
    `useState('')` in `DirectorComposer`; `AnalyticsCopilotView` fetches in an effect with deps
    `[initialRange, load]`, both memoized with `[]`, so it runs once per mount.
    Source-level only, UNVERIFIED until vitest and the browser check below run.
    typescript-reviewer (MEDIUM, not fixed): the test matches source text, so it can break on a
    harmless refactor, and it cannot catch a remount that comes from somewhere else. Follow-up: an
    RTL behaviour test that types a draft, switches tabs, switches back and checks that the draft
    is still there and that the Analytics loader ran once.
    **Re-checked 2026-09-28 (static, UNVERIFIED):** the source-string test is **not** behaviour
    evidence for #6. The desktop package has no `@testing-library/*`, `jsdom` or `happy-dom`, so an
    RTL test cannot run without new dev dependencies. Adding them is an owner/dev-dependency
    decision and was not done. Until then, #6 is verified only by the browser step below (step 3:
    draft kept, `getMarketingAnalytics` called once), which Codex must run. No remount was
    reproduced, so no M4 code was changed.
- `apps/desktop/src/renderer/styles/v2/shell.test.ts` adds the block "v2 Agent Marketing
  workspace (M4)". It checks that every new selector is scoped under `.izzi-v2`, and that the
  guard and file rows use the `!important` token colors with `-webkit-text-fill-color`. It also
  checks the room frame tokens, the tab focus ring, and that the `[hidden]` panel rule outranks
  the flex panel rule.

## Required before M4 counts as verified

1. Run vitest on the two test files above, plus the existing M3 suites (marketingPrefill*,
   surfaces, identity).
2. Run renderer tsc (the TS2339 baseline only), lint on the touched files, and `pnpm build`.
3. Run the browser harness with the flag ON and OFF:
   - The Home → Director handoff still lands in the single Director composer, because the
     default tab is Conversation.
   - Flag OFF renders no V2 markup.
   - Type a Director draft, switch to Analytics and back: the draft is still there, and
     `getMarketingAnalytics` is called once, not once per visit.
   - Hidden panels are not visible (computed `display: none`).
