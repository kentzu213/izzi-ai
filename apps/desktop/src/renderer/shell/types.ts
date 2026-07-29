/**
 * Personal Office shell — view models.
 *
 * These are *read models*: shapes the shell renders. The domain lives in
 * `shared/personal-office/` (W1 contract of record, FROZEN — read-only here).
 * Nothing in this module redefines a domain entity; it projects one.
 *
 * The Loop-02-local `ApprovalRequest` from the quarantine draft is gone: the
 * shell now renders W1's `Approval` directly.
 *
 * @module renderer/shell/types
 */

import type {
  Approval,
  ArtifactId,
  RunState,
  WorkRunId,
  WorkspaceInstanceId,
} from '../../shared/personal-office';

/** Top-level routes. Exactly five — the IA cap. */
export type ShellRoute = 'today' | 'workspaces' | 'mygraph' | 'market' | 'settings';

/** Routes that are not top-level nav entries but are still shell destinations. */
export type ShellView = ShellRoute | 'workspace' | 'legacy';

export interface RouteDescriptor {
  readonly id: ShellRoute;
  readonly label: string;
  /** Used as the accessible description in nav + palette. */
  readonly description: string;
}

export const TOP_LEVEL_ROUTES: readonly RouteDescriptor[] = Object.freeze([
  Object.freeze({ id: 'today', label: 'Today', description: 'Delegate work and clear what needs you' }),
  Object.freeze({ id: 'workspaces', label: 'Workspaces', description: 'Open or create a workspace' }),
  Object.freeze({ id: 'mygraph', label: 'MyGraph', description: 'Your knowledge graph' }),
  Object.freeze({ id: 'market', label: 'Market', description: 'Add capabilities' }),
  Object.freeze({ id: 'settings', label: 'Settings', description: 'Setup, runtime and preferences' }),
]);

export const DEFAULT_ROUTE: ShellRoute = 'today';

/** The four workspace surfaces. Exactly four — everything else is the drawer. */
export type WorkspaceSurface = 'brief' | 'work' | 'deliverables' | 'approvals';

export const WORKSPACE_SURFACES: readonly { id: WorkspaceSurface; label: string }[] = Object.freeze([
  Object.freeze({ id: 'brief' as WorkspaceSurface, label: 'Brief' }),
  Object.freeze({ id: 'work' as WorkspaceSurface, label: 'Work' }),
  Object.freeze({ id: 'deliverables' as WorkspaceSurface, label: 'Deliverables' }),
  Object.freeze({ id: 'approvals' as WorkspaceSurface, label: 'Approvals' }),
]);

/** The surface a workspace opens on. Named so callers never index the array. */
export const FIRST_WORKSPACE_SURFACE: WorkspaceSurface = 'brief';

/**
 * Today's lanes.
 *
 * `attention` is deliberately NOT a fourth nav lane: the IA caps Today at three
 * lanes. It is a separate always-visible band, because a `failed` run is neither
 * active, nor awaiting me, nor delivered — and silently dropping it would break
 * the "health/error state must be legible" requirement.
 */
export type TodayLane = 'active' | 'needs_me' | 'delivered' | 'attention' | 'hidden';

/**
 * Total `RunState → TodayLane` mapping.
 *
 * Exhaustive by construction: this is a `Record` over the contract's union, so
 * if W1 adds a RunState this file stops compiling instead of quietly dropping
 * runs out of every lane. That property is the whole point — a primary lane must
 * never depend on a state the shell forgot to place.
 *
 * `waiting_external` sits in `needs_me` per the accepted contract change
 * PO-RUNSTATE-CONTRACT-GAP: it is a first-class state, so the lane no longer
 * rests on an optional field.
 */
export const RUN_STATE_LANE: Readonly<Record<RunState, TodayLane>> = Object.freeze({
  created: 'active',
  queued: 'active',
  running: 'active',
  awaiting_approval: 'needs_me',
  waiting_external: 'needs_me',
  paused: 'needs_me',
  completed: 'delivered',
  failed: 'attention',
  canceled: 'hidden',
});

export function laneForRunState(state: RunState): TodayLane {
  return RUN_STATE_LANE[state];
}

/** Why a `needs_me` run needs me — drives the sub-label, not the lane itself. */
export type NeedsMeKind = 'approval' | 'external' | 'paused';

export function needsMeKind(state: RunState): NeedsMeKind | null {
  if (state === 'awaiting_approval') return 'approval';
  if (state === 'waiting_external') return 'external';
  if (state === 'paused') return 'paused';
  return null;
}

/** Resolved presentation state for a surface. */
export type SurfaceStatus = 'loading' | 'ready' | 'empty' | 'error' | 'offline' | 'degraded';

/** A run, reduced to what a card renders. */
export interface WorkItemView {
  readonly id: WorkRunId;
  readonly workspaceId: WorkspaceInstanceId;
  readonly workspaceName: string;
  /** The operator's own words. May contain anything they typed. */
  readonly goal: string;
  readonly state: RunState;
  readonly lane: TodayLane;
  readonly updatedAt: string;
  /** Derived from steps; absent when steps were not loaded. */
  readonly progress?: { readonly done: number; readonly total: number };
  /** Already-redacted, single-line. Never a raw error object. */
  readonly detail?: string;
  /** Present only for `attention` (failed) runs. */
  readonly failureSummary?: string;
}

/** An artifact, reduced to what a card renders. Never exposes `localRef`. */
export interface DeliverableView {
  readonly id: ArtifactId;
  readonly runId: WorkRunId;
  readonly name: string;
  /** Basename only — never an absolute path. */
  readonly fileLabel: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
}

/** A workspace, reduced to what the list + Brief render. */
export interface WorkspaceView {
  readonly id: WorkspaceInstanceId;
  readonly name: string;
  /**
   * One-line brief. The contract has no instance-level brief field yet
   * (raised as CR-UX-02), so this is optional and the Brief surface renders an
   * honest "not set" affordance rather than borrowing the blueprint's text.
   */
  readonly brief?: string;
  readonly isReady: boolean;
  /** Local UI preference, not domain truth. */
  readonly isFavorite: boolean;
  readonly lastOpenedAt?: string;
  readonly activeCount: number;
  readonly needsMeCount: number;
  readonly deliveredCount: number;
}

/** Everything one render pass of the shell needs. */
export interface WorkSnapshot {
  readonly status: SurfaceStatus;
  /** True when the data is fabricated for demo/screenshots. Always badged. */
  readonly isDemo: boolean;
  readonly isOffline: boolean;
  /** Redacted, human-readable. Never a stack trace or a path. */
  readonly errorMessage?: string;
  /** What is degraded, named so the operator knows what is missing. */
  readonly degradedReason?: string;
  readonly workspaces: readonly WorkspaceView[];
  readonly active: readonly WorkItemView[];
  readonly needsMe: readonly WorkItemView[];
  readonly delivered: readonly WorkItemView[];
  readonly attention: readonly WorkItemView[];
  readonly approvals: readonly Approval[];
  readonly deliverables: readonly DeliverableView[];
}
