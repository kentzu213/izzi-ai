import { describe, it, expect } from 'vitest';
import {
  WORKSPACE_TRANSITIONS,
  PROVISIONING_TRANSITIONS,
  RUN_TRANSITIONS,
  APPROVAL_TRANSITIONS,
  InvalidTransitionError,
  assertTransition,
  canTransition,
  isTerminal,
  canTransitionRun,
  canTransitionApproval,
  canTransitionWorkspace,
  canTransitionProvisioning,
  type RunState,
  type WorkspaceState,
  type ProvisioningState,
  type ApprovalState,
  type TransitionTable,
} from './state-machine';

describe('workspace lifecycle', () => {
  it('allows the pinned transitions', () => {
    expect(canTransitionWorkspace('draft', 'active')).toBe(true);
    expect(canTransitionWorkspace('active', 'suspended')).toBe(true);
    expect(canTransitionWorkspace('suspended', 'active')).toBe(true);
    expect(canTransitionWorkspace('active', 'archived')).toBe(true);
  });

  it('rejects invalid transitions', () => {
    expect(canTransitionWorkspace('archived', 'active')).toBe(false);
    expect(canTransitionWorkspace('draft', 'suspended')).toBe(false);
  });

  it('treats archived as terminal', () => {
    expect(isTerminal(WORKSPACE_TRANSITIONS, 'archived')).toBe(true);
    expect(isTerminal(WORKSPACE_TRANSITIONS, 'active')).toBe(false);
  });
});

describe('provisioning lifecycle', () => {
  it('walks pending → provisioning → ready → deprovisioning → released', () => {
    expect(canTransitionProvisioning('pending', 'provisioning')).toBe(true);
    expect(canTransitionProvisioning('provisioning', 'ready')).toBe(true);
    expect(canTransitionProvisioning('ready', 'deprovisioning')).toBe(true);
    expect(canTransitionProvisioning('deprovisioning', 'released')).toBe(true);
  });

  it('allows retry from failed and rejects illegal jumps', () => {
    expect(canTransitionProvisioning('failed', 'provisioning')).toBe(true);
    expect(canTransitionProvisioning('pending', 'ready')).toBe(false);
    expect(canTransitionProvisioning('released', 'provisioning')).toBe(false);
  });
});

describe('run lifecycle', () => {
  it('supports the approval detour running → awaiting_approval → running', () => {
    expect(canTransitionRun('running', 'awaiting_approval')).toBe(true);
    expect(canTransitionRun('awaiting_approval', 'running')).toBe(true);
    expect(canTransitionRun('awaiting_approval', 'canceled')).toBe(true);
  });

  it('supports pause/resume and keeps failed terminal', () => {
    expect(canTransitionRun('running', 'paused')).toBe(true);
    expect(canTransitionRun('paused', 'running')).toBe(true);
    expect(canTransitionRun('failed', 'queued')).toBe(false);
  });

  it('rejects invalid transitions', () => {
    expect(canTransitionRun('created', 'running')).toBe(false); // must queue first
    expect(canTransitionRun('completed', 'running')).toBe(false); // terminal
    expect(canTransitionRun('canceled', 'queued')).toBe(false); // terminal
    expect(canTransitionRun('awaiting_approval', 'completed')).toBe(false);
  });

  it('has exactly completed + failed + canceled as terminal', () => {
    const terminal = (Object.keys(RUN_TRANSITIONS) as RunState[]).filter((s) =>
      isTerminal(RUN_TRANSITIONS, s),
    );
    expect(terminal.sort()).toEqual(['canceled', 'completed', 'failed']);
  });
});

describe('approval lifecycle', () => {
  it('allows every decision from requested', () => {
    for (const to of ['approved', 'rejected', 'expired', 'withdrawn'] as ApprovalState[]) {
      expect(canTransitionApproval('requested', to)).toBe(true);
    }
  });

  it('makes every decision terminal', () => {
    for (const s of ['approved', 'rejected', 'expired', 'withdrawn'] as ApprovalState[]) {
      expect(isTerminal(APPROVAL_TRANSITIONS, s)).toBe(true);
    }
    expect(canTransitionApproval('approved', 'rejected')).toBe(false);
  });
});

describe('assertTransition', () => {
  it('throws InvalidTransitionError with machine/from/to on an illegal move', () => {
    const act = () =>
      assertTransition<WorkspaceState>('workspace', WORKSPACE_TRANSITIONS, 'archived', 'active');
    expect(act).toThrow(InvalidTransitionError);
    expect(act).toThrow('Invalid workspace transition: archived → active');
  });

  it('does not throw on a legal move', () => {
    expect(() =>
      assertTransition<ProvisioningState>(
        'provisioning',
        PROVISIONING_TRANSITIONS,
        'provisioning',
        'ready',
      ),
    ).not.toThrow();
  });
});

describe('canTransition generic guard', () => {
  it('returns false for an unknown from-state', () => {
    const table = { a: ['b'] } as unknown as TransitionTable<'a' | 'b'>;
    expect(canTransition(table, 'b', 'a')).toBe(false);
  });
});
