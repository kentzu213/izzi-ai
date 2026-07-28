/**
 * Personal Office OS — high-level state machines.
 *
 * Four lifecycles are pinned here as explicit transition tables plus a shared
 * validator. Transitions not present in a table are invalid by construction, so
 * "invalid-transition tests" (acceptance criterion) test the table directly.
 *
 *   - Workspace lifecycle   (WorkspaceInstance)
 *   - Provisioning lifecycle (RuntimeInstance / workspace bring-up)
 *   - Run lifecycle          (WorkRun)
 *   - Approval lifecycle     (Approval)
 *
 * Pure, dependency-free module.
 *
 * @module shared/personal-office/state-machine
 */

// ── Workspace lifecycle ──
export type WorkspaceState = 'draft' | 'active' | 'suspended' | 'archived';

// ── Provisioning lifecycle ──
export type ProvisioningState =
  | 'pending'
  | 'provisioning'
  | 'ready'
  | 'failed'
  | 'deprovisioning'
  | 'released';

// ── Run lifecycle ──
export type RunState =
  | 'created'
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'canceled';

// ── Approval lifecycle ──
export type ApprovalState = 'requested' | 'approved' | 'rejected' | 'expired' | 'withdrawn';

/** A transition table maps each state to the set of states it may move to. */
export type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

export const WORKSPACE_TRANSITIONS: TransitionTable<WorkspaceState> = Object.freeze({
  draft: ['active', 'archived'],
  active: ['suspended', 'archived'],
  suspended: ['active', 'archived'],
  archived: [], // terminal
});

export const PROVISIONING_TRANSITIONS: TransitionTable<ProvisioningState> = Object.freeze({
  pending: ['provisioning'],
  provisioning: ['ready', 'failed'],
  ready: ['deprovisioning'],
  failed: ['provisioning', 'released'], // retry or give up
  deprovisioning: ['released'],
  released: [], // terminal
});

export const RUN_TRANSITIONS: TransitionTable<RunState> = Object.freeze({
  created: ['queued', 'canceled'],
  queued: ['running', 'canceled'],
  running: ['awaiting_approval', 'paused', 'completed', 'failed', 'canceled'],
  awaiting_approval: ['running', 'canceled'], // approved → running, rejected/abort → canceled
  paused: ['running', 'canceled'],
  failed: ['queued'], // retry only; otherwise terminal
  completed: [], // terminal
  canceled: [], // terminal
});

export const APPROVAL_TRANSITIONS: TransitionTable<ApprovalState> = Object.freeze({
  requested: ['approved', 'rejected', 'expired', 'withdrawn'],
  approved: [], // terminal
  rejected: [], // terminal
  expired: [], // terminal
  withdrawn: [], // terminal
});

/** Thrown when an actor attempts a transition the table forbids. */
export class InvalidTransitionError extends Error {
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`Invalid ${machine} transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

/** Generic guard: is `from → to` allowed by `table`? Unknown `from` ⇒ false. */
export function canTransition<S extends string>(
  table: TransitionTable<S>,
  from: S,
  to: S,
): boolean {
  const next = table[from];
  return Array.isArray(next) && next.includes(to);
}

/** Generic assertion: throw `InvalidTransitionError` unless `from → to` is allowed. */
export function assertTransition<S extends string>(
  machine: string,
  table: TransitionTable<S>,
  from: S,
  to: S,
): void {
  if (!canTransition(table, from, to)) {
    throw new InvalidTransitionError(machine, from, to);
  }
}

/** A state with no outgoing transitions is terminal. */
export function isTerminal<S extends string>(table: TransitionTable<S>, state: S): boolean {
  const next = table[state];
  return Array.isArray(next) && next.length === 0;
}

// Named convenience wrappers (keep call sites self-documenting).
export const canTransitionWorkspace = (from: WorkspaceState, to: WorkspaceState): boolean =>
  canTransition(WORKSPACE_TRANSITIONS, from, to);
export const canTransitionProvisioning = (
  from: ProvisioningState,
  to: ProvisioningState,
): boolean => canTransition(PROVISIONING_TRANSITIONS, from, to);
export const canTransitionRun = (from: RunState, to: RunState): boolean =>
  canTransition(RUN_TRANSITIONS, from, to);
export const canTransitionApproval = (from: ApprovalState, to: ApprovalState): boolean =>
  canTransition(APPROVAL_TRANSITIONS, from, to);
