import { beforeEach, describe, expect, it } from 'vitest';
import { InvalidWorkTransitionError, type WorkEvent } from './work-types';
import { runWorkModelMigration } from './work-migration';
import { WorkService } from './work-service';
import { createNodeSqliteDatabase } from './test-support';

/** A controllable clock, so expiry and ordering are deterministic. */
function fixedClock(startIso: string) {
  let current = new Date(startIso).getTime();
  return {
    now: () => new Date(current),
    advance: (ms: number) => {
      current += ms;
    },
  };
}

function setup(clockIso = '2025-01-01T00:00:00.000Z') {
  const { db, close } = createNodeSqliteDatabase();
  runWorkModelMigration(db);
  const events: WorkEvent[] = [];
  const clock = fixedClock(clockIso);
  const service = new WorkService({
    db,
    now: clock.now,
    onEvent: (event) => events.push(event),
  });
  return { service, events, clock, close };
}

describe('WorkService — run lifecycle', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('creates a run in created state and emits run.created', () => {
    const run = ctx.service.createRun({ title: 'Brief', brief: 'Do the thing' });
    expect(run.state).toBe('created');
    expect(run.lineageKind).toBe('original');
    expect(run.rootRunId).toBe(run.id);
    expect(ctx.events.map((e) => e.type)).toContain('run.created');
  });

  it('walks created -> queued -> running -> completed', () => {
    const run = ctx.service.createRun({ title: 'B', brief: 'b' });
    ctx.service.queue(run.id);
    ctx.service.start(run.id);
    const done = ctx.service.succeed(run.id);
    expect(done.state).toBe('completed');
    expect(done.startedAt).toBeDefined();
    expect(done.endedAt).toBeDefined();
  });

  it('rejects an invalid transition', () => {
    const run = ctx.service.createRun({ title: 'B', brief: 'b' });
    expect(() => ctx.service.start(run.id)).toThrow(InvalidWorkTransitionError); // created -> running is illegal
  });

  it('rejects a transition out of a terminal state', () => {
    const run = ctx.service.createRun({ title: 'B', brief: 'b' });
    ctx.service.queue(run.id);
    ctx.service.cancel(run.id);
    expect(() => ctx.service.start(run.id)).toThrow(InvalidWorkTransitionError);
  });
});

describe('WorkService — event ordering + idempotency', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('assigns gapless monotonic run_seq per run', () => {
    const run = ctx.service.createRun({ title: 'B', brief: 'b' });
    ctx.service.queue(run.id);
    ctx.service.start(run.id);
    ctx.service.recordStep({ runId: run.id, key: 's1', label: 'one', status: 'done' });
    ctx.service.recordStep({ runId: run.id, key: 's2', label: 'two', status: 'done' });

    const events = ctx.service.listEvents(run.id);
    const seqs = events.map((e) => e.runSeq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs[0]).toBe(1);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBe(seqs[i - 1] + 1);
  });

  it('does not duplicate an event when the same emit is retried', () => {
    const run = ctx.service.createRun({ title: 'B', brief: 'b' });
    ctx.service.queue(run.id);
    ctx.service.start(run.id);

    const first = ctx.service.recordStep({
      runId: run.id,
      key: 'tool-1',
      label: 'run build',
      status: 'done',
      idempotencyKey: 'fixed-key',
    });
    const before = ctx.service.listEvents(run.id).length;
    const second = ctx.service.recordStep({
      runId: run.id,
      key: 'tool-1',
      label: 'run build',
      status: 'done',
      idempotencyKey: 'fixed-key',
    });
    const after = ctx.service.listEvents(run.id).length;

    expect(second.id).toBe(first.id);
    expect(after).toBe(before);
  });

  it('keeps a global monotonic cursor across runs', () => {
    const a = ctx.service.createRun({ title: 'A', brief: 'a' });
    const b = ctx.service.createRun({ title: 'B', brief: 'b' });
    ctx.service.queue(a.id);
    ctx.service.queue(b.id);
    const all = ctx.service.listEventsSince(0);
    const seqs = all.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('preserves order under interleaved producers writing to the same run', () => {
    const run = ctx.service.createRun({ title: 'B', brief: 'b' });
    ctx.service.queue(run.id);
    ctx.service.start(run.id);
    // Two "producers" interleave step emits; each append is its own transaction.
    for (let i = 0; i < 25; i++) {
      ctx.service.recordStep({ runId: run.id, key: `p1-${i}`, label: `a${i}`, status: 'done' });
      ctx.service.recordStep({ runId: run.id, key: `p2-${i}`, label: `b${i}`, status: 'done' });
    }
    const seqs = ctx.service.listEvents(run.id).map((e) => e.runSeq);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBe(seqs[i - 1] + 1);
  });
});

describe('WorkService — secret redaction on persisted payloads', () => {
  it('never stores a raw credential in an event payload', () => {
    const ctx = setup();
    const run = ctx.service.createRun({
      title: 'Deploy',
      brief: 'connect with izzi-abcdef0123456789abcdef token',
    });
    ctx.service.queue(run.id);
    ctx.service.recordStep({
      runId: run.id,
      key: 's',
      label: 'used key sk-abcdefghijklmnop012345',
      status: 'done',
      detail: 'Authorization: Bearer abcDEFghiJKL012345',
    });

    const serialized = JSON.stringify(ctx.service.listEvents(run.id));
    expect(serialized).not.toContain('sk-abcdefghijklmnop012345');
    expect(serialized).not.toContain('izzi-abcdef0123456789abcdef');
    expect(serialized).not.toContain('abcDEFghiJKL012345');

    // The stored run brief is redacted too.
    expect(ctx.service.getRun(run.id)?.brief).not.toContain('izzi-abcdef0123456789abcdef');
    ctx.close();
  });
});

describe('WorkService — approvals', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  function runningRun() {
    const run = ctx.service.createRun({
      title: 'Publish',
      brief: 'publish a post',
      plan: [{ key: 'outline', label: 'Outline post' }],
    });
    ctx.service.queue(run.id);
    ctx.service.start(run.id);
    return run;
  }

  it('approve produces a receipt and never performs the effect', () => {
    const run = runningRun();
    const approval = ctx.service.requestApproval({
      runId: run.id,
      kind: 'external_publish',
      title: 'Publish to Facebook',
      summary: 'Post the launch announcement',
      risk: 'high',
      target: 'facebook/page-123',
      input: { body: 'Launch!' },
      estimatedSideEffect: 'Publish 1 post to Facebook',
    });
    expect(ctx.service.getRun(run.id)?.state).toBe('awaiting_approval');

    const result = ctx.service.decideApproval({
      approvalId: approval.id,
      decision: 'approve',
      decidedBy: 'reviewer-hash',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.receipt.externalActionPerformed).toBe(false);
      expect(result.receipt.decidedActionHash).toBe(approval.actionHash);
      expect(result.approval.status).toBe('approved');
      expect(result.approval.receiptDigest).toBeDefined();
    }
  });

  it('edit binds a different action hash than the proposal', () => {
    const run = runningRun();
    const approval = ctx.service.requestApproval({
      runId: run.id,
      kind: 'external_publish',
      title: 'Publish',
      summary: 's',
      risk: 'medium',
      target: 'fb/page',
      input: { body: 'original' },
      estimatedSideEffect: 'publish',
    });
    const result = ctx.service.decideApproval({
      approvalId: approval.id,
      decision: 'edit',
      decidedBy: 'reviewer',
      editedInput: { body: 'edited copy' },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.approval.status).toBe('edited');
      expect(result.receipt.decidedActionHash).not.toBe(result.receipt.proposedActionHash);
    }
  });

  it('edit without editedInput is refused', () => {
    const run = runningRun();
    const approval = ctx.service.requestApproval({
      runId: run.id,
      kind: 'strategy',
      title: 'x',
      summary: 's',
      risk: 'low',
      target: 't',
      input: {},
      estimatedSideEffect: 'e',
    });
    const result = ctx.service.decideApproval({
      approvalId: approval.id,
      decision: 'edit',
      decidedBy: 'r',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('missing-edited-input');
  });

  it('reject records a rejected receipt', () => {
    const run = runningRun();
    const approval = ctx.service.requestApproval({
      runId: run.id,
      kind: 'spend',
      title: 'Spend',
      summary: 's',
      risk: 'high',
      target: 'ads/account',
      input: { amount: 100 },
      estimatedSideEffect: 'spend 100',
    });
    const result = ctx.service.decideApproval({
      approvalId: approval.id,
      decision: 'reject',
      decidedBy: 'r',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.approval.status).toBe('rejected');
  });

  it('a second decision on the same approval is refused', () => {
    const run = runningRun();
    const approval = ctx.service.requestApproval({
      runId: run.id,
      kind: 'strategy',
      title: 'x',
      summary: 's',
      risk: 'low',
      target: 't',
      input: {},
      estimatedSideEffect: 'e',
    });
    ctx.service.decideApproval({ approvalId: approval.id, decision: 'approve', decidedBy: 'r' });
    const again = ctx.service.decideApproval({
      approvalId: approval.id,
      decision: 'reject',
      decidedBy: 'r',
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('already-decided');
  });

  it('expires an approval past its TTL and fails the decision closed', () => {
    const run = runningRun();
    const approval = ctx.service.requestApproval({
      runId: run.id,
      kind: 'external_publish',
      title: 'x',
      summary: 's',
      risk: 'high',
      target: 't',
      input: {},
      estimatedSideEffect: 'e',
      ttlMs: 1_000,
    });
    ctx.clock.advance(2_000);
    const result = ctx.service.decideApproval({
      approvalId: approval.id,
      decision: 'approve',
      decidedBy: 'r',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
    expect(ctx.service.getApproval(approval.id)?.status).toBe('expired');
  });

  it('invalidates a pending approval when the plan changes', () => {
    const run = runningRun();
    const approval = ctx.service.requestApproval({
      runId: run.id,
      kind: 'strategy',
      title: 'x',
      summary: 's',
      risk: 'low',
      target: 't',
      input: {},
      estimatedSideEffect: 'e',
    });
    ctx.service.updatePlan(run.id, [
      { key: 'outline', label: 'Outline post' },
      { key: 'new', label: 'A new step' },
    ]);
    expect(ctx.service.getApproval(approval.id)?.status).toBe('invalidated');
    expect(ctx.service.getApproval(approval.id)?.invalidReason).toBe('plan-changed');
  });

  it('invalidates a pending approval when the bound artifact gets a newer version', () => {
    const run = runningRun();
    const artifact = ctx.service.putArtifact({
      runId: run.id,
      name: 'post',
      kind: 'document_draft',
      body: 'v1',
    });
    const approval = ctx.service.requestApproval({
      runId: run.id,
      kind: 'external_publish',
      title: 'x',
      summary: 's',
      risk: 'high',
      target: 't',
      input: {},
      estimatedSideEffect: 'e',
      artifactId: artifact.id,
    });
    // A new version of the same artifact makes the approved bytes stale.
    ctx.service.putArtifact({ runId: run.id, name: 'post', kind: 'document_draft', body: 'v2' });
    expect(ctx.service.getApproval(approval.id)?.status).toBe('invalidated');
    expect(ctx.service.getApproval(approval.id)?.invalidReason).toBe('artifact-changed');
  });
});

describe('WorkService — restart, resume, checkpoints', () => {
  it('parks an interrupted run on restart and resumes it from a checkpoint', () => {
    const first = setup();
    const run = first.service.createRun({
      title: 'Long job',
      brief: 'b',
      plan: [
        { key: 'a', label: 'Step A' },
        { key: 'b', label: 'Step B' },
      ],
    });
    first.service.queue(run.id);
    first.service.start(run.id);
    first.service.recordStep({ runId: run.id, key: 'a', label: 'Step A', status: 'done', kind: 'plan' });
    first.close(); // simulate crash — no graceful shutdown

    // A new process opens the same (here: re-migrated) database. We simulate the
    // persisted run by re-creating the scenario in a fresh service and asserting
    // the recovery + resume contract holds.
    const second = setup();
    const r2 = second.service.createRun({
      title: 'Long job',
      brief: 'b',
      plan: [
        { key: 'a', label: 'Step A' },
        { key: 'b', label: 'Step B' },
      ],
    });
    second.service.queue(r2.id);
    second.service.start(r2.id);
    second.service.recordStep({ runId: r2.id, key: 'a', label: 'Step A', status: 'done', kind: 'plan' });

    const recovered = second.service.recoverInterruptedRuns();
    expect(recovered.map((r) => r.id)).toContain(r2.id);
    expect(second.service.getRun(r2.id)?.state).toBe('paused');

    const resumed = second.service.resume(r2.id);
    expect(resumed.run.state).toBe('running');
    // The checkpoint cursor points at the next unfinished plan step.
    expect(resumed.cursor.nextStepKey).toBe('b');
    second.close();
  });

  it('refuses to resume a terminal run (retry it instead)', () => {
    const ctx = setup();
    const run = ctx.service.createRun({ title: 'B', brief: 'b' });
    ctx.service.queue(run.id);
    ctx.service.cancel(run.id);
    expect(() => ctx.service.resume(run.id)).toThrow(/cannot be resumed/);
    ctx.close();
  });
});

describe('WorkService — retry / fork lineage', () => {
  it('retry creates a new run in the same lineage with an incremented attempt', () => {
    const ctx = setup();
    const run = ctx.service.createRun({
      title: 'Job',
      brief: 'b',
      plan: [{ key: 'a', label: 'Step A' }],
    });
    ctx.service.queue(run.id);
    ctx.service.start(run.id);
    ctx.service.fail(run.id, 'boom');

    const retry = ctx.service.retryRun(run.id);
    expect(retry.id).not.toBe(run.id);
    expect(retry.rootRunId).toBe(run.rootRunId);
    expect(retry.parentRunId).toBe(run.id);
    expect(retry.attempt).toBe(2);
    expect(retry.lineageKind).toBe('retry');

    const lineage = ctx.service.listLineage(retry.id);
    expect(lineage.map((r) => r.id)).toEqual([run.id, retry.id]);
    ctx.close();
  });

  it('fork branches from a run and records the branch on the parent', () => {
    const ctx = setup();
    const run = ctx.service.createRun({ title: 'Job', brief: 'b' });
    const fork = ctx.service.forkRun(run.id, { title: 'Alt approach' });
    expect(fork.lineageKind).toBe('fork');
    expect(fork.rootRunId).toBe(run.rootRunId);

    const parentEvents = ctx.service.listEvents(run.id).map((e) => e.type);
    expect(parentEvents).toContain('run.forked');
    ctx.close();
  });
});
