# Personal Office OS — information architecture (Loop 02)

Status: implemented behind a flag, pending Loop 02 review.
Source commits: `663de47` (shell layer), `5512884` (mount + styles).
Contract dependency: `apps/desktop/src/shared/personal-office/**` — W1 Loop 01, ACCEPTED and FROZEN.

## 0. Basis

An earlier draft of this document was written before Loop 01 existed and assumed
"no domain contract yet". **That assumption is void.** Loop 01 is ACCEPTED, so the
shell projects the real contract instead of inventing shapes:

- `RunState`, `Approval`, `Artifact`, `WorkStep`, `WorkspaceInstance` are imported
  from `shared/personal-office/`, never redefined here.
- The Loop-02-local `ApprovalRequest` from the quarantined draft is **deleted**.
  The shell renders W1's `Approval` directly.
- `waiting_external` is a first-class `RunState` (accepted contract change
  `PO-RUNSTATE-CONTRACT-GAP`), so the "Waiting for me" lane rests on a modelled
  state rather than an optional field.
- The draft's `sessionId === runId` progress heuristic is **gone**. `WorkStep.runId`
  is a real foreign key, so progress is derived honestly from steps.

What does **not** exist yet: the execution engine. `main/work/**` and its preload
surface are Loop 03 (W3). Loop 02 must not touch `preload.ts`, so the shell talks
to a `WorkDataSource` interface and ships an in-memory implementation. One
function — `resolveDataSource()` in `shell/workAdapter.ts` — is the entire seam.

## 1. Top-level routes (exactly 5)

| Route | Label | Purpose |
|---|---|---|
| `today` | Today | **Default landing.** Delegate work, clear what needs you |
| `workspaces` | Workspaces | Open, switch, favourite a workspace |
| `mygraph` | MyGraph | Knowledge graph — route shell only |
| `market` | Market | Add capabilities |
| `settings` | Settings | Setup, runtime, legacy index, rollback |

Two further shell destinations exist but are **not** nav entries: `workspace`
(a specific office) and `legacy` (adapter host). Both live in `ShellView`.

Rules this IA enforces:

- Landing is always `today`. The last workspace is remembered for the Workspaces
  entry point, never used to restore a deep route — otherwise an urgent approval
  could be skipped on launch.
- Task, agent and model are **not** primary navigation.
- "AI Marketing" (`customer-marketing`) and "Phòng Marketing" (`marketing`) are
  **not peers** and not top-level. Both sit in one Marketing group in the legacy
  catalogue, which is what removes the duplicate-product confusion.

## 2. Workspace home — exactly 4 surfaces

`Brief` · `Work` · `Deliverables` · `Approvals` (`WORKSPACE_SURFACES`).

Rendered as a tablist with roving tabindex, `aria-selected` and `aria-controls`.

Everything else is **setup, in a drawer, never a tab**: Context · Apps · Brand ·
Knowledge · Agents & skills · Policies · Runtime (`SETUP_GROUPS`). Promoting any
of these to a tab is a regression against this IA.

Known contract gap: `WorkspaceInstance` has no instance-level brief field, so the
Brief surface renders an honest "not set" affordance rather than borrowing
`WorkspaceBlueprint.description`, which would show identical text for every office
from one blueprint. Raised as **CR-UX-02**; not worked around in the UI.

## 3. Today — three lanes off `RunState`

`RUN_STATE_LANE` in `shell/types.ts` is a total `Record<RunState, TodayLane>`.
Exhaustive by construction: if W1 adds a `RunState`, this file stops compiling
instead of silently dropping runs out of every lane.

| Lane | RunState |
|---|---|
| Active work | `created`, `queued`, `running` |
| Waiting for me | `awaiting_approval`, `waiting_external`, `paused` |
| Delivered | `completed` |
| Attention (band, not a 4th lane) | `failed` |
| Not shown | `canceled` |

`failed` gets a visible band because a failed run is neither active, nor awaiting
me, nor delivered — with three lanes only, it would vanish, which breaks the
"health/error state must be legible" requirement. The lane count stays at three.

The delegate composer sits above the lanes and is **never** replaced by a state
screen, which is what preserves "launch → delegate in ≤2 actions" even while
loading, empty or errored.

## 4. Legacy catalogue — nothing deleted

`shell/legacySurfaces.ts` catalogues all 18 pre-existing pages by their `App.tsx`
`Page` id, grouped as Marketing / Legacy work tools / System. They are reached
through Settings or the command palette, not the primary nav.

The catalogue holds **no component references**. `App.tsx` owns rendering and
passes `renderLegacy` down, so the shell never imports 18 page modules and no
import cycle exists.

## 5. Flag and rollback

Flag key: `izzi.shell.personalOffice`. Resolution order:

1. `window.__IZZI_SHELL__` — test injection
2. `?shell=` query parameter
3. `localStorage` — the user's own choice
4. default `v2`

Rollback: Settings → "Switch to the classic shell" calls `onDisableShell`, which
clears the flag and flips React state in `App.tsx`. The legacy layout is still
mounted in the same component, so it returns **intact, with no reload and no lost
session**. `components/Sidebar.tsx` is unmodified by this loop — the rollback path
is the original code, which is why it can be trusted.

Capture seams, both off by default: `?demo=1` (fabricated data, always badged) and
`?state=<loading|empty|error|offline|degraded>` (pins one surface state).

## 6. Command palette

`Ctrl/Cmd+K`, or `/` when not typing in a field. `combobox` + `listbox` with
`aria-activedescendant`; Arrow/Home/End/Enter/Escape. Focus is **trapped** while
open and **restored** to the invoking element on close. Commands: routes,
workspaces, the current workspace's four surfaces, and every legacy surface.

## 7. Interaction-state matrix

Ten surfaces × six states. `resolveStatus()` is the single resolver, precedence:

```
loading > error > offline > degraded > empty > ready
```

| State | Contract |
|---|---|
| Loading | skeleton matching final layout; no spinner-only; no layout shift |
| Empty | one line of purpose + the single action that fills it |
| Error | plain-language cause + Retry; no stack, path or payload |
| Offline | banner; last data readable and marked stale; writes disabled with a reason |
| Degraded | surface renders; the broken part named inline |
| Demo | `DemoBadge` whenever `isDemo`; never presented as real work |

`SurfaceState` replaces content (loading/empty/error). `SurfaceNotice` sits above
content (offline/degraded) so stale data stays readable.

## 8. Responsive

| Width | Navigation |
|---|---|
| ≥1280px | full sidebar, labels visible |
| 900–1279px | icon rail; accessible names and tooltips preserved |
| <900px | full-screen **sheet**, focus-trapped — never a squeezed mini-sidebar |

Target viewports: 1440×900, 1024×768, 390×844.

## 9. Accessibility floor

- Landmarks `banner` / `navigation` / `main` / `complementary`; one `h1` per
  surface; ordered headings.
- `:focus-visible` on every interactive element; no bare `outline: none`.
- Icon-only controls carry both `aria-label` and a tooltip.
- Live regions: health `polite`; approvals `assertive`.
- `--po-hit: 44px` floor for interactive targets at narrow widths.
- `prefers-reduced-motion: reduce` disables transitions and skeleton shimmer.
- `forced-colors: active` supported.
- `env(safe-area-inset-*)` respected top/bottom/left/right; the composer stays
  reachable above the on-screen keyboard.
- Text zoom 200% loses no content or action — no fixed-height text containers.

## 10. Security posture

Never rendered at any level: secret material (`SecretRef` only), raw provider or
tool payloads, `Approval.binding.input` (typed `unknown`, so no safe render path —
**CR-UX-03**), absolute paths.

`Artifact.localRef` is an absolute local pointer and is reduced to a basename by
`toFileLabel()` before display. `toSafeMessage()` strips secret-shaped tokens and
paths from any engine string, collapses to one line and caps length — producers are
expected to redact, but the shell cannot verify that, and a leaked token in a toast
is unrecoverable.

`WorkRun.goal` is operator-authored free text and may contain anything they typed,
including customer names. It must be rendered, so **screenshot hygiene is a
process control**: all captures use demo data only.

## 11. Open contract change requests

| ID | Need | Blocks |
|---|---|---|
| CR-UX-02 | instance-level `brief`, `favorite`, `lastOpenedAt` on `WorkspaceInstance` | Brief surface content; "recent" ordering |
| CR-UX-03 | producer-redacted, renderable approval preview instead of `input: unknown` | full approval preview |
| CR-UX-05 | approval outcome / receipt after an approved effect executes | post-approval confirmation |
| CR-UX-06 | explicit create-run intent shape (`{goal, workspaceInstanceId}`) | delegate without the renderer forging lineage fields |

Also unresolved upstream: no `WorkspaceInstance` bootstrap exists, and
`blueprintId` is required, so a first-run user has no workspace to delegate into.
The shell does **not** fabricate one; it shows an honest empty state. Tracked as
CR-UX-04 for W1/W3.
