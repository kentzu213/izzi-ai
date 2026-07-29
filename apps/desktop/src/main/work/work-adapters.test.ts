import { describe, expect, it } from 'vitest';
import type { AgentRun as LegacyAgentRun, AgentTask as LegacyAgentTask } from '../agent/types';
import type { AgentTurnEvent } from '../../shared/agent-turn-events';
import type { CustomerApproval, CustomerRun } from '../../shared/customer-marketing-types';
import { runWorkModelMigration } from './work-migration';
import { WorkService } from './work-service';
import {
  createTurnIngestState,
  importCustomerRun,
  importLegacyAgentRun,
  importLegacyAgentTask,
  ingestAgentTurnEvent,
  toLegacyRun,
  toLegacyTask,
} from './work-adapters';
import { createNodeSqliteDatabase } from './test-support';

function setup() {
  const { db, close } = createNodeSqliteDatabase();
  runWorkModelMigration(db);
  const service = new WorkService({ db, now: () => new Date('2025-01-01T00:00:00.000Z') });
  return { service, close };
}

describe('legacy AgentTask adapter', () => {
  it('imports a task as a single-step run and is idempotent', () => {
    const { service, close } = setup();
    const task: LegacyAgentTask = {
      id: 'task-1',
      title: 'Write the docs',
      status: 'in_progress',
      summary: 'Write the README',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    const run1 = importLegacyAgentTask(service, task);
    const run2 = importLegacyAgentTask(service, task);
    expect(run1.id).toBe(run2.id); // deterministic id → re-import is a no-op
    expect(run1.origin).toBe('agent_task');
    expect(run1.state).toBe('running');
    expect(service.listRuns().filter((r) => r.originRef === 'task-1')).toHaveLength(1);

    // Read shim round-trips the legacy id.
    expect(toLegacyTask(run1).id).toBe('task-1');
    close();
  });
});

describe('legacy AgentRun adapter', () => {
  it('imports a blackboard run and reflects it back through the read shim', () => {
    const { service, close } = setup();
    const legacy: LegacyAgentRun = {
      id: 'ar-1',
      goal: 'Ship the MVP',
      stage: 'build',
      status: 'active',
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    const run = importLegacyAgentRun(service, legacy);
    expect(run.origin).toBe('agent_run');
    expect(run.state).toBe('running');

    const back = toLegacyRun(run);
    expect(back.id).toBe('ar-1');
    expect(back.status).toBe('active');
    close();
  });
});

describe('host-agent turn event adapter', () => {
  it('maps deltas and steps onto unified events without duplicates on re-delivery', () => {
    const { service, close } = setup();
    const run = service.createRun({ title: 'Turn', brief: 'b' });
    service.queue(run.id);
    service.start(run.id);

    const state = createTurnIngestState();
    const turnId = 'turn-abc';
    const events: AgentTurnEvent[] = [
      { turnId, kind: 'delta', text: 'Hello ' },
      { turnId, kind: 'step', step: { id: 'call_1', kind: 'tool', label: 'run build', status: 'running' } },
      { turnId, kind: 'step', step: { id: 'call_1', kind: 'tool', label: 'run build', status: 'done' } },
      { turnId, kind: 'delta', text: 'world' },
    ];
    for (const event of events) ingestAgentTurnEvent(service, run.id, event, state);

    // Re-deliver the whole stream (flaky channel). A fresh ingest state means the
    // delta counter restarts, so delta idempotency keys collide → no duplicates.
    const replayState = createTurnIngestState();
    for (const event of events) ingestAgentTurnEvent(service, run.id, event, replayState);

    const deltas = service.listEvents(run.id).filter((e) => e.type === 'output.delta');
    expect(deltas).toHaveLength(2); // "Hello " + "world", not four

    const steps = service.listSteps(run.id);
    const toolStep = steps.find((s) => s.key === 'call_1');
    expect(toolStep?.status).toBe('done'); // updated in place, single row
    expect(steps.filter((s) => s.key === 'call_1')).toHaveLength(1);
    close();
  });
});

describe('Customer Marketing adapter', () => {
  it('imports a run with a pending approval bound to an action hash', () => {
    const { service, close } = setup();
    const cmrRun: CustomerRun = {
      id: 'run-cmr-1',
      goal: 'Launch spring campaign',
      status: 'awaiting_approval',
      stage: 'awaiting_strategy_approval',
      progress: 80,
      steps: [
        { id: 'brief', label: 'Clarify goal', owner: 'Director', status: 'done', requiresApproval: false },
        { id: 'approve', label: 'Approve strategy', owner: 'Reviewer', status: 'in_progress', requiresApproval: true },
      ],
      createdAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
    };
    const approval: CustomerApproval = {
      id: 'approval-cmr-1',
      runId: 'run-cmr-1',
      kind: 'strategy',
      evidenceDigest: 'digest-abc',
      title: 'Approve marketing strategy',
      summary: 'Review before proceeding',
      risk: 'medium',
      status: 'pending',
      requestedAt: '2025-01-01T00:00:00.000Z',
    };

    const run = importCustomerRun(service, {
      run: cmrRun,
      approvals: [approval],
      workspaceId: 'ws-tenant-42',
      workspaceExternalRef: 'tenant-42',
    });
    expect(run.origin).toBe('customer_marketing');
    expect(run.workspaceId).toBe('ws-tenant-42');

    const approvals = service.listApprovals(run.id);
    expect(approvals).toHaveLength(1);
    expect(approvals[0].kind).toBe('strategy');
    expect(approvals[0].status).toBe('pending');

    // Re-import is idempotent: same run id, still one approval.
    importCustomerRun(service, { run: cmrRun, approvals: [approval], workspaceId: 'ws-tenant-42' });
    expect(service.listApprovals(run.id)).toHaveLength(1);

    // The approval can be decided through the unified service and yields a receipt.
    const decided = service.decideApproval({
      approvalId: approvals[0].id,
      decision: 'approve',
      decidedBy: 'reviewer-hash',
    });
    expect(decided.ok).toBe(true);
    if (decided.ok) expect(decided.receipt.externalActionPerformed).toBe(false);
    close();
  });
});
