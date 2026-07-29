/**
 * Phase A acceptance — the two legacy mapping rulings and the two read-boundary
 * security gates.
 *
 * These tests exist because each one guards against a *specific* wrong answer
 * that looked reasonable at the time:
 *
 *   MAP-BLOCKED   — mapping legacy `blocked` to `failed` would report recoverable
 *                   work as dead; mapping it to `awaiting_approval` would invent a
 *                   reviewer nobody asked. Both are asserted against directly.
 *   MAP-ARCHIVED  — defaulting `archived` to `completed` fabricates SUCCESS, which
 *                   tells the operator work was delivered when it may never have
 *                   finished. Only conclusive entry evidence may produce a
 *                   non-`canceled` terminal.
 *   row schema    — a row written by a different contract version must be refused,
 *                   not read as though this build understands it.
 *   idempotency   — one key reused for a *different* fact must fail closed; quietly
 *                   returning the first event would make the second vanish while
 *                   reporting success.
 *
 * @module main/work/work-phase-a.test
 */
import { describe, expect, it } from 'vitest';
import type {
  AgentRun as LegacyAgentRun,
  AgentRunEntry as LegacyAgentRunEntry,
  AgentTask as LegacyAgentTask,
} from '../agent/types';
import type { CustomerRun } from '../../shared/customer-marketing-types';
import { runWorkModelMigration } from './work-migration';
import { WorkService } from './work-service';
import {
  deriveArchivedOutcome,
  importCustomerRun,
  importLegacyAgentRun,
  importLegacyAgentTask,
} from './work-adapters';
import { RunRepository, WorkEventIdempotencyConflictError } from './run-repository';
import { WorkRowSchemaVersionError } from './work-types';
import { WorkDb } from './work-sqlite';
import { createNodeSqliteDatabase } from './test-support';

function setup() {
  const { db, close } = createNodeSqliteDatabase();
  runWorkModelMigration(db);
  const service = new WorkService({ db, now: () => new Date('2025-01-01T00:00:00.000Z') });
  return { db, service, close };
}

const AT = '2025-01-01T00:00:00.000Z';

function legacyRun(status: LegacyAgentRun['status'], id = 'legacy-1'): LegacyAgentRun {
  return { id, goal: 'Ship the thing', stage: 'build', status, createdAt: AT, updatedAt: AT };
}

function entry(content: string, id = 'e1'): LegacyAgentRunEntry {
  return { id, runId: 'legacy-1', kind: 'note', content, createdAt: AT };
}

function customerRun(status: CustomerRun['status']): CustomerRun {
  return {
    id: 'cmr-1',
    goal: 'Launch the campaign',
    status,
    stage: 'build',
    progress: 40,
    steps: [{ id: 's1', label: 'Draft copy', owner: 'Content', status: 'todo', requiresApproval: false }],
    createdAt: AT,
    updatedAt: AT,
  };
}

// ── MAP-BLOCKED ────────────────────────────────────────────────────────────

describe('MAP-BLOCKED: legacy blocked is recoverable, never terminal', () => {
  it('maps a blocked AgentTask to paused', () => {
    const { service, close } = setup();
    const task: LegacyAgentTask = {
      id: 'task-blocked',
      title: 'Stuck task',
      status: 'blocked',
      createdAt: AT,
      updatedAt: AT,
    };

    const run = importLegacyAgentTask(service, task);
    expect(run.state).toBe('paused');
    close();
  });

  it('maps a blocked AgentRun to paused and preserves the raw status', () => {
    const { service, close } = setup();
    const run = importLegacyAgentRun(service, legacyRun('blocked'));

    expect(run.state).toBe('paused');
    expect(run.legacyStatusRaw).toBe('blocked');
    // The reason is deliberately absent: a legacy row does not say whether it was
    // 'stuck' or 'guardrail', and guessing would put a fabricated cause on record.
    expect(run.pausedReason).toBeUndefined();
    close();
  });

  it('never produces failed or awaiting_approval from any blocked legacy row', () => {
    const { service, close } = setup();
    const fromRun = importLegacyAgentRun(service, legacyRun('blocked'));
    const fromTask = importLegacyAgentTask(service, {
      id: 'task-b2',
      title: 'Blocked',
      status: 'blocked',
      createdAt: AT,
      updatedAt: AT,
    });

    for (const state of [fromRun.state, fromTask.state]) {
      expect(state).not.toBe('failed');
      expect(state).not.toBe('awaiting_approval');
    }
    close();
  });

  it('leaves a paused run re-enterable (paused -> running is legal)', () => {
    const { service, close } = setup();
    const run = importLegacyAgentRun(service, legacyRun('blocked'));

    // The point of `paused` over `failed`: the run can still be picked back up.
    expect(service.start(run.id).state).toBe('running');
    close();
  });

  it('maps a blocked CustomerRun to waiting_external, not awaiting_approval', () => {
    const { service, close } = setup();
    const run = importCustomerRun(service, { run: customerRun('blocked') });

    // A Customer Marketing block is a dependency outside the app (runtime, media
    // toolchain, quota) — distinct from "a human owes us a decision".
    expect(run.state).toBe('waiting_external');
    expect(run.state).not.toBe('awaiting_approval');
    close();
  });

  it('still maps a genuine CustomerRun approval gate to awaiting_approval', () => {
    const { service, close } = setup();
    const run = importCustomerRun(service, { run: customerRun('awaiting_approval') });

    // The discrimination only means something if the real gate still lands here.
    expect(run.state).toBe('awaiting_approval');
    close();
  });
});

// ── MAP-ARCHIVED ───────────────────────────────────────────────────────────

describe('MAP-ARCHIVED: a terminal state is derived, never assumed', () => {
  it('derives completed only from conclusive completion evidence', () => {
    const outcome = deriveArchivedOutcome([entry('Deliverable shipped and verified')]);
    expect(outcome.state).toBe('completed');
    expect(outcome.conclusive).toBe(true);
    expect(outcome.canceledReason).toBeUndefined();
  });

  it('derives failed only from conclusive failure evidence', () => {
    const outcome = deriveArchivedOutcome([entry('Build failed, unrecoverable')]);
    expect(outcome.state).toBe('failed');
    expect(outcome.conclusive).toBe(true);
  });

  it('falls back to canceled — never completed — with no entries', () => {
    const outcome = deriveArchivedOutcome([]);
    expect(outcome.state).toBe('canceled');
    expect(outcome.state).not.toBe('completed');
    expect(outcome.canceledReason).toBe('legacy_archived_outcome_unknown');
    expect(outcome.conclusive).toBe(false);
  });

  it('treats inconclusive entries as unknown rather than success', () => {
    const outcome = deriveArchivedOutcome([
      entry('Started working on the draft', 'a'),
      entry('Handed off to review', 'b'),
    ]);
    // Plenty of activity, no proof of an outcome. Activity is not completion.
    expect(outcome.state).toBe('canceled');
    expect(outcome.canceledReason).toBe('legacy_archived_outcome_unknown');
  });

  it('prefers the latest entry when earlier ones disagree', () => {
    const outcome = deriveArchivedOutcome([
      { id: 'old', runId: 'legacy-1', kind: 'note', content: 'failed to connect', createdAt: '2025-01-01T00:00:00.000Z' },
      { id: 'new', runId: 'legacy-1', kind: 'note', content: 'retried and completed', createdAt: '2025-01-02T00:00:00.000Z' },
    ]);
    expect(outcome.state).toBe('completed');
  });

  it('always sets the archivedAt tombstone and keeps the raw status', () => {
    const { service, close } = setup();
    const run = importLegacyAgentRun(service, legacyRun('archived'));

    expect(run.state).toBe('canceled');
    expect(run.canceledReason).toBe('legacy_archived_outcome_unknown');
    expect(run.archivedAt).toBe(AT);
    expect(run.legacyStatusRaw).toBe('archived');
    close();
  });

  it('reaches a terminal state for every archived run', () => {
    const { service, close } = setup();
    const conclusive = importLegacyAgentRun(service, legacyRun('archived', 'arch-done'), {
      entries: [entry('work completed')],
    });
    const inconclusive = importLegacyAgentRun(service, legacyRun('archived', 'arch-unknown'));

    for (const run of [conclusive, inconclusive]) {
      expect(['completed', 'failed', 'canceled']).toContain(run.state);
      expect(run.archivedAt).toBe(AT);
    }
    expect(conclusive.state).toBe('completed');
    close();
  });

  it('emits exactly one migration audit event, even on re-import', () => {
    const { service, close } = setup();
    const first = importLegacyAgentRun(service, legacyRun('archived'));
    const second = importLegacyAgentRun(service, legacyRun('archived'));
    expect(first.id).toBe(second.id);

    const audits = service
      .listEvents(first.id)
      .filter((event) => event.type === 'run.migrated');
    expect(audits).toHaveLength(1);
    close();
  });

  it('records what was concluded and on what basis in the audit payload', () => {
    const { service, close } = setup();
    const run = importLegacyAgentRun(service, legacyRun('archived'));
    const audit = service.listEvents(run.id).find((event) => event.type === 'run.migrated');

    // The audit is what makes a derived state re-examinable instead of a guess
    // frozen into the data.
    expect(audit?.payload).toMatchObject({
      legacySource: 'agent_run',
      legacyStatusRaw: 'archived',
      derivedState: 'canceled',
      evidence: 'inconclusive',
    });
    close();
  });

  it('does not emit a migration audit for a non-archived import', () => {
    const { service, close } = setup();
    const run = importLegacyAgentRun(service, legacyRun('active'));
    const audits = service.listEvents(run.id).filter((event) => event.type === 'run.migrated');
    expect(audits).toHaveLength(0);
    close();
  });
});

// ── Read-boundary: row schema version ──────────────────────────────────────

describe('row reads reject an unknown schema_version', () => {
  it('refuses to map a run row written by a different contract version', () => {
    const { db, service, close } = setup();
    const run = service.createRun({ title: 'Ship', brief: 'Ship the thing' });

    // Simulate a row left behind by another contract version.
    db.prepare('UPDATE work_runs SET schema_version = ? WHERE id = ?').run(99, run.id);

    const repo = new RunRepository(new WorkDb(db));
    expect(() => repo.getRun(run.id)).toThrow(WorkRowSchemaVersionError);
    close();
  });

  it('names the table and the offending version so the row can be found', () => {
    const { db, service, close } = setup();
    const run = service.createRun({ title: 'Ship', brief: 'Ship the thing' });
    db.prepare('UPDATE work_runs SET schema_version = ? WHERE id = ?').run(7, run.id);

    const repo = new RunRepository(new WorkDb(db));
    try {
      repo.getRun(run.id);
      expect.unreachable('expected a schema version rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(WorkRowSchemaVersionError);
      expect((error as WorkRowSchemaVersionError).table).toBe('work_runs');
      expect((error as WorkRowSchemaVersionError).found).toBe(7);
    }
    close();
  });

  it('does not silently coerce the version to the current one', () => {
    const { db, service, close } = setup();
    const run = service.createRun({ title: 'Ship', brief: 'Ship the thing' });
    db.prepare('UPDATE work_runs SET schema_version = ? WHERE id = ?').run(99, run.id);

    const repo = new RunRepository(new WorkDb(db));
    expect(() => repo.getRun(run.id)).toThrow();
    // The row is left exactly as found: rejection, not repair.
    const raw = db
      .prepare('SELECT schema_version AS v FROM work_runs WHERE id = ?')
      .get(run.id) as { v: number };
    expect(raw.v).toBe(99);
    close();
  });
});

// ── Read-boundary: idempotency conflict ────────────────────────────────────

describe('idempotency keys are per-fact, not per-slot', () => {
  it('returns the stored event when the same fact is re-sent', () => {
    const { db, service, close } = setup();
    const run = service.createRun({ title: 'Ship', brief: 'Ship the thing' });
    const repo = new RunRepository(new WorkDb(db));

    const input = {
      id: 'evt-a',
      runId: run.id,
      type: 'output.delta' as const,
      payload: { text: 'hello' },
      idempotencyKey: 'turn-1:delta:0',
    };
    const first = repo.appendEvent(input);
    const retry = repo.appendEvent({ ...input, id: 'evt-a-retry' });

    expect(first.duplicate).toBe(false);
    expect(retry.duplicate).toBe(true);
    expect(retry.event.id).toBe(first.event.id);
    close();
  });

  it('throws when one key is reused for a different payload', () => {
    const { db, service, close } = setup();
    const run = service.createRun({ title: 'Ship', brief: 'Ship the thing' });
    const repo = new RunRepository(new WorkDb(db));

    repo.appendEvent({
      id: 'evt-1',
      runId: run.id,
      type: 'output.delta',
      payload: { text: 'first' },
      idempotencyKey: 'turn-1:delta:0',
    });

    expect(() =>
      repo.appendEvent({
        id: 'evt-2',
        runId: run.id,
        type: 'output.delta',
        payload: { text: 'SECOND — a different fact' },
        idempotencyKey: 'turn-1:delta:0',
      }),
    ).toThrow(WorkEventIdempotencyConflictError);
    close();
  });

  it('throws when one key is reused for a different event type', () => {
    const { db, service, close } = setup();
    const run = service.createRun({ title: 'Ship', brief: 'Ship the thing' });
    const repo = new RunRepository(new WorkDb(db));

    repo.appendEvent({
      id: 'evt-1',
      runId: run.id,
      type: 'output.delta',
      payload: { text: 'x' },
      idempotencyKey: 'shared-key',
    });

    expect(() =>
      repo.appendEvent({
        id: 'evt-2',
        runId: run.id,
        type: 'run.error',
        payload: { text: 'x' },
        idempotencyKey: 'shared-key',
      }),
    ).toThrow(WorkEventIdempotencyConflictError);
    close();
  });

  it('does not write the conflicting event', () => {
    const { db, service, close } = setup();
    const run = service.createRun({ title: 'Ship', brief: 'Ship the thing' });
    const repo = new RunRepository(new WorkDb(db));

    repo.appendEvent({
      id: 'evt-1',
      runId: run.id,
      type: 'output.delta',
      payload: { text: 'first' },
      idempotencyKey: 'k',
    });
    const before = repo.listEvents(run.id).length;

    expect(() =>
      repo.appendEvent({
        id: 'evt-2',
        runId: run.id,
        type: 'output.delta',
        payload: { text: 'different' },
        idempotencyKey: 'k',
      }),
    ).toThrow(WorkEventIdempotencyConflictError);

    // Fail closed means nothing landed — not a partial write.
    expect(repo.listEvents(run.id)).toHaveLength(before);
    expect(repo.getEventById?.('evt-2') ?? null).toBeNull();
    close();
  });

  it('scopes keys per run, so two runs may reuse the same key', () => {
    const { db, service, close } = setup();
    const a = service.createRun({ title: 'A', brief: 'run a' });
    const b = service.createRun({ title: 'B', brief: 'run b' });
    const repo = new RunRepository(new WorkDb(db));

    const first = repo.appendEvent({
      id: 'evt-a',
      runId: a.id,
      type: 'output.delta',
      payload: { text: 'x' },
      idempotencyKey: 'turn:0',
    });
    const second = repo.appendEvent({
      id: 'evt-b',
      runId: b.id,
      type: 'output.delta',
      payload: { text: 'y' },
      idempotencyKey: 'turn:0',
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(false);
    close();
  });
});
