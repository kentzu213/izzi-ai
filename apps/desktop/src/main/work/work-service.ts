/**
 * WorkService — the main-process API for the unified work model (Loop 03).
 *
 * The repository knows how to store a run; this service knows what a run is
 * *allowed* to do. Everything that could otherwise be re-decided per caller is
 * decided once here:
 *
 * - a run only moves along edges declared in `WORK_RUN_TRANSITIONS`;
 * - every mutation appends an event with a deterministic idempotency key, so a
 *   retried call produces no second event;
 * - an approval is bound to an immutable action hash at request time and
 *   re-validated at decision time, and deciding one never performs the effect;
 * - a checkpoint holds provider-independent work position, so a run survives an
 *   app restart and can resume without the provider that started it.
 *
 * @module main/work/work-service
 */
import {
  DEFAULT_WORKSPACE_ID,
  assertTransition,
  isTerminalWorkRunState,
  WORK_EVENT_PAYLOAD_VERSION,
  toArtifactIdOrNull,
  toContextSnapshotIdOrNull,
  type WorkActionBinding,
  type WorkApproval,
  type WorkApprovalDecision,
  type WorkApprovalInvalidReason,
  type WorkApprovalKind,
  type WorkApprovalReceipt,
  type WorkApprovalRisk,
  type WorkArtifact,
  type WorkArtifactKind,
  type WorkCheckpoint,
  type WorkCheckpointCursor,
  type WorkEvent,
  type WorkEventType,
  type RunCanceledReason,
  type RunPauseReason,
  type WorkRun,
  type WorkRunOrigin,
  type WorkRunState,
  type WorkStep,
  type WorkStepKind,
  type WorkStepStatus,
  type Workspace,
  type WorkspaceKind,
} from './work-types';
import { redactText } from './work-redaction';
import { RunRepository, type AppendEventResult } from './run-repository';
import { WorkDb, type WorkSqliteDatabase } from './work-sqlite';
import {
  buildReceipt,
  evaluateApprovalValidity,
  statusForDecision,
  statusForInvalidReason,
  type ApprovalValidityContext,
} from './work-approvals';
import {
  computeActionHash,
  computeArtifactDigest,
  computePlanHash,
  computeReceiptDigest,
  newWorkId,
} from './work-hash';

/** Default approval window. Short enough that a stale gate closes on its own. */
export const DEFAULT_APPROVAL_TTL_MS = 15 * 60 * 1000;

export interface WorkServiceOptions {
  db: WorkSqliteDatabase | WorkDb;
  /** Fan-out hook for live subscribers (the renderer bridge). Never throws through. */
  onEvent?: (event: WorkEvent) => void;
  /** Injected clock, so expiry and ordering are testable. */
  now?: () => Date;
  approvalTtlMs?: number;
}

export interface PlanStepInput {
  key: string;
  label: string;
  status?: WorkStepStatus;
  kind?: WorkStepKind;
}

/**
 * Options carried alongside a state transition.
 *
 * The four `*Reason` / legacy fields exist so a mapping never has to invent a
 * cause. W0 authorised them as additive and optional: when the source genuinely
 * does not say why a run stopped, the field stays unset and the state alone is
 * the claim — an unset reason is honest, a guessed one is not.
 */
export interface TransitionOptions {
  reason?: string;
  error?: string;
  /** Why the run is paused, when the source actually says so. */
  pausedReason?: RunPauseReason;
  /** Why the run was canceled, e.g. an inconclusive legacy archive. */
  canceledReason?: RunCanceledReason;
  /** Tombstone for a legacy row that was archived upstream. */
  archivedAt?: string;
  /** The raw upstream status, preserved verbatim for later forensics. */
  legacyStatusRaw?: string;
}

export interface CreateRunInput {
  title: string;
  brief: string;
  workspaceId?: string;
  origin?: WorkRunOrigin;
  originRef?: string;
  plan?: PlanStepInput[];
  contextSnapshotId?: string;
  /** Force a run id (adapters use a deterministic one so re-import is a no-op). */
  id?: string;
  /** Initial state; defaults to `created`. */
  state?: WorkRunState;
  createdAt?: string;
}

export interface WorkRunBundle {
  run: WorkRun;
  steps: WorkStep[];
  artifacts: WorkArtifact[];
  approvals: WorkApproval[];
  checkpoint: WorkCheckpoint | null;
}

export interface RecordStepInput {
  runId: string;
  key: string;
  label: string;
  status: WorkStepStatus;
  kind?: WorkStepKind;
  detail?: string;
  idempotencyKey?: string;
}

export interface PutArtifactInput {
  runId: string;
  name: string;
  kind: WorkArtifactKind;
  mediaType?: string;
  /** Inline content. Redacted before hashing, so the digest matches what is stored. */
  body?: string;
  /** Pointer for content that should not be copied into the DB. */
  externalPath?: string;
  stepId?: string;
  idempotencyKey?: string;
}

export interface RequestApprovalInput {
  runId: string;
  kind: WorkApprovalKind;
  title: string;
  summary: string;
  risk: WorkApprovalRisk;
  /** Account / resource the effect lands on. */
  target: string;
  /** Action input; redacted on the way in. */
  input: unknown;
  estimatedSideEffect: string;
  /** Carried into the eventual external call so a replay cannot double-apply. */
  idempotencyKey?: string;
  artifactId?: string;
  stepId?: string;
  preview?: string;
  ttlMs?: number;
  /** Move the run to `awaiting_approval` as part of requesting. Default true. */
  blockRun?: boolean;
}

export interface DecideApprovalInput {
  approvalId: string;
  decision: WorkApprovalDecision;
  /** Opaque reviewer reference. Never an email or raw user id. */
  decidedBy: string;
  /** Required for `edit`: the reviewer's replacement input. */
  editedInput?: unknown;
  note?: string;
}

export type DecideApprovalResult =
  | { ok: true; approval: WorkApproval; receipt: WorkApprovalReceipt; duplicate: boolean }
  | { ok: false; approval: WorkApproval; reason: DecideApprovalFailure };

export type DecideApprovalFailure =
  | 'already-decided'
  | 'missing-edited-input'
  | WorkApprovalInvalidReason;

export interface ResumeResult {
  run: WorkRun;
  checkpoint: WorkCheckpoint | null;
  cursor: WorkCheckpointCursor;
}

export class WorkService {
  private readonly db: WorkDb;
  readonly repo: RunRepository;
  private readonly onEvent?: (event: WorkEvent) => void;
  private readonly clock: () => Date;
  private readonly approvalTtlMs: number;

  constructor(options: WorkServiceOptions) {
    this.db = options.db instanceof WorkDb ? options.db : new WorkDb(options.db);
    this.repo = new RunRepository(this.db);
    this.onEvent = options.onEvent;
    this.clock = options.now ?? (() => new Date());
    this.approvalTtlMs = options.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS;
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  // ── Workspaces ──

  ensureWorkspace(
    input: { id: string; name: string; kind: WorkspaceKind; externalRef?: string } = {
      id: DEFAULT_WORKSPACE_ID,
      name: 'Local workspace',
      kind: 'personal',
    },
  ): Workspace {
    return this.repo.upsertWorkspace(input);
  }

  listWorkspaces(): Workspace[] {
    return this.repo.listWorkspaces();
  }

  // ── Runs ──

  /**
   * Create a run from a brief. Starts in `created`: nothing is queued until a
   * caller says so, which keeps "a run exists" separate from "work is pending".
   */
  createRun(input: CreateRunInput): WorkRun {
    return this.db.transaction(() => {
      const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
      if (!this.repo.getWorkspace(workspaceId)) {
        this.repo.upsertWorkspace({
          id: workspaceId,
          name: workspaceId === DEFAULT_WORKSPACE_ID ? 'Local workspace' : workspaceId,
          kind: workspaceId === DEFAULT_WORKSPACE_ID ? 'personal' : 'customer',
        });
      }

      const id = input.id ?? newWorkId('run');
      const existing = this.repo.getRun(id);
      // Deterministic ids make adapter re-import idempotent: the run is already here.
      if (existing) return existing;

      const plan = input.plan ?? [];
      const run = this.repo.insertRun({
        id,
        workspaceId,
        title: input.title,
        brief: input.brief,
        state: input.state ?? 'created',
        origin: input.origin ?? 'manual',
        originRef: input.originRef ?? null,
        planVersion: 1,
        planHash: computePlanHash(plan),
        contextSnapshotId: input.contextSnapshotId ?? null,
        parentRunId: null,
        rootRunId: id,
        lineageKind: 'original',
        attempt: 1,
        createdAt: input.createdAt,
      });

      for (const step of plan) {
        this.repo.upsertStep({
          runId: id,
          key: step.key,
          kind: step.kind ?? 'plan',
          label: step.label,
          status: step.status ?? 'pending',
        });
      }

      this.append({
        runId: id,
        type: 'run.created',
        idempotencyKey: 'run.created',
        payload: {
          title: run.title,
          brief: run.brief,
          origin: run.origin,
          planVersion: run.planVersion,
          planHash: run.planHash,
          stepCount: plan.length,
        },
      });

      return this.repo.requireRun(id);
    });
  }

  getRun(runId: string): WorkRun | null {
    return this.repo.getRun(runId);
  }

  listRuns(options: { workspaceId?: string; limit?: number } = {}): WorkRun[] {
    return this.repo.listRuns(options);
  }

  getRunBundle(runId: string): WorkRunBundle | null {
    const run = this.repo.getRun(runId);
    if (!run) return null;
    return {
      run,
      steps: this.repo.listSteps(runId),
      artifacts: this.repo.listArtifacts(runId),
      approvals: this.repo.listApprovals(runId),
      checkpoint: this.repo.latestCheckpoint(runId),
    };
  }

  listEvents(runId: string, afterRunSeq = 0, limit = 1_000): WorkEvent[] {
    return this.repo.listEvents(runId, afterRunSeq, limit);
  }

  listEventsSince(afterSeq = 0, limit = 500): WorkEvent[] {
    return this.repo.listEventsSince(afterSeq, limit);
  }

  latestEventSeq(): number {
    return this.repo.latestEventSeq();
  }

  listLineage(runId: string): WorkRun[] {
    const run = this.repo.getRun(runId);
    if (!run) return [];
    return this.repo.listLineage(run.rootRunId);
  }

  /**
   * Move a run along a declared edge. Throws `InvalidWorkTransitionError` for
   * anything else — an executor that believes a finished run is running has lost
   * track of reality, and coercing that is how a side effect happens twice.
   */
  transition(runId: string, to: WorkRunState, options: TransitionOptions = {}): WorkRun {
    return this.db.transaction(() => {
      const run = this.repo.requireRun(runId);
      assertTransition(run.state, to);

      const now = this.nowIso();
      const patch: Parameters<RunRepository['updateRun']>[1] = { state: to };
      if (to === 'running' && !run.startedAt) patch.startedAt = now;
      if (isTerminalWorkRunState(to)) patch.endedAt = now;
      if (options.error !== undefined) patch.lastError = options.error;
      // Additive discriminators (W0-authorised, optional). They are only written
      // when the caller actually knows the reason — an unset reason is an honest
      // "unknown", which is why nothing here defaults them to a plausible value.
      if (options.pausedReason !== undefined) patch.pausedReason = options.pausedReason;
      if (options.canceledReason !== undefined) patch.canceledReason = options.canceledReason;
      if (options.archivedAt !== undefined) patch.archivedAt = options.archivedAt;
      if (options.legacyStatusRaw !== undefined) patch.legacyStatusRaw = options.legacyStatusRaw;

      const updated = this.repo.updateRun(runId, patch);

      // A second transition into the same state later is a real event; calling the
      // same transition twice in a row is not. Counting prior events gives both.
      const occurrence = this.repo.countEvents(runId, 'run.state_changed');
      this.append({
        runId,
        type: 'run.state_changed',
        idempotencyKey: `state:${run.state}->${to}:${occurrence}`,
        payload: {
          from: run.state,
          to,
          ...(options.reason ? { reason: redactText(options.reason).value } : {}),
          ...(options.error ? { error: redactText(options.error).value } : {}),
        },
      });

      return updated;
    });
  }

  queue(runId: string, reason?: string): WorkRun {
    return this.transition(runId, 'queued', { reason });
  }

  start(runId: string, reason?: string): WorkRun {
    return this.transition(runId, 'running', { reason });
  }

  pause(runId: string, reason?: string): WorkRun {
    return this.transition(runId, 'paused', { reason });
  }

  cancel(runId: string, reason?: string): WorkRun {
    return this.transition(runId, 'canceled', { reason });
  }

  succeed(runId: string, reason?: string): WorkRun {
    return this.transition(runId, 'completed', { reason });
  }

  fail(runId: string, error: string): WorkRun {
    return this.transition(runId, 'failed', { error });
  }

  waitForUser(runId: string, reason?: string): WorkRun {
    return this.transition(runId, 'awaiting_approval', { reason });
  }

  waitForExternal(runId: string, reason?: string): WorkRun {
    return this.transition(runId, 'waiting_external', { reason });
  }

  /**
   * Replace the run's plan. Bumps `planVersion`/`planHash`, which invalidates any
   * pending approval that was granted against the previous plan — the human
   * agreed to a plan, not to whatever replaced it.
   */
  updatePlan(
    runId: string,
    steps: PlanStepInput[],
  ): { run: WorkRun; invalidated: WorkApproval[] } {
    return this.db.transaction(() => {
      const run = this.repo.requireRun(runId);
      const planHash = computePlanHash(steps);

      for (const step of steps) {
        this.repo.upsertStep({
          runId,
          key: step.key,
          kind: step.kind ?? 'plan',
          label: step.label,
          status: step.status ?? 'pending',
        });
      }

      const updated =
        planHash === run.planHash
          ? run
          : this.repo.updateRun(runId, { planHash, planVersion: run.planVersion + 1 });

      if (planHash !== run.planHash) {
        this.append({
          runId,
          type: 'run.plan_updated',
          idempotencyKey: `plan:${updated.planVersion}`,
          payload: { planVersion: updated.planVersion, planHash, stepCount: steps.length },
        });
      }

      const invalidated = this.invalidateStaleApprovals(runId);
      return { run: updated, invalidated };
    });
  }

  // ── Steps ──

  /** Record a step. The `(runId, key)` pair is the identity, so re-emits converge. */
  recordStep(input: RecordStepInput): WorkStep {
    return this.db.transaction(() => {
      const step = this.repo.upsertStep({
        runId: input.runId,
        key: input.key,
        kind: input.kind ?? 'tool',
        label: input.label,
        status: input.status,
        detail: input.detail ?? null,
      });

      this.append({
        runId: input.runId,
        type: 'step.upserted',
        // Same step at the same status is the same fact, however many times a
        // flaky stream re-delivers it.
        idempotencyKey: input.idempotencyKey ?? `step:${input.key}:${input.status}`,
        stepId: step.id,
        payload: {
          key: step.key,
          kind: step.kind,
          label: step.label,
          status: step.status,
          seq: step.seq,
          ...(step.detail ? { detail: step.detail } : {}),
        },
      });

      return step;
    });
  }

  listSteps(runId: string): WorkStep[] {
    return this.repo.listSteps(runId);
  }

  /**
   * Record streamed assistant output. The caller owns the idempotency key
   * (usually `turn:index`), because only it knows which chunk this is.
   */
  recordOutputDelta(runId: string, text: string, idempotencyKey: string): AppendEventResult {
    return this.append({
      runId,
      type: 'output.delta',
      idempotencyKey,
      payload: { text },
    });
  }

  // ── Artifacts ──

  /**
   * Store an artifact as a new version of `name`. The digest is taken over the
   * redacted body actually persisted, so the hash describes what is there.
   */
  putArtifact(input: PutArtifactInput): WorkArtifact {
    return this.db.transaction(() => {
      const redacted = typeof input.body === 'string' ? redactText(input.body).value : null;
      const sha256 = computeArtifactDigest(redacted ?? input.externalPath ?? '');
      const artifact = this.repo.insertArtifact({
        id: newWorkId('artifact'),
        runId: input.runId,
        stepId: input.stepId ?? null,
        name: input.name,
        kind: input.kind,
        mediaType: input.mediaType ?? 'text/plain',
        body: redacted,
        externalPath: input.externalPath ?? null,
        sha256,
        sizeBytes: redacted ? Buffer.byteLength(redacted, 'utf8') : 0,
      });

      this.append({
        runId: input.runId,
        type: 'artifact.created',
        idempotencyKey: input.idempotencyKey ?? `artifact:${artifact.name}:${artifact.version}`,
        artifactId: artifact.id,
        ...(input.stepId ? { stepId: input.stepId } : {}),
        payload: {
          name: artifact.name,
          kind: artifact.kind,
          version: artifact.version,
          sha256: artifact.sha256,
          sizeBytes: artifact.sizeBytes,
          mediaType: artifact.mediaType,
        },
      });

      // A newer version of the same artifact makes any approval bound to an older
      // version stale — the reviewer approved the old bytes.
      this.invalidateStaleApprovals(input.runId);

      return this.repo.requireArtifact(artifact.id);
    });
  }

  listArtifacts(runId: string): WorkArtifact[] {
    return this.repo.listArtifacts(runId);
  }

  // ── Approvals ──

  /**
   * Open an approval gate. The binding hashed here is the whole promise: target,
   * redacted input, artifact version, estimated side effect, idempotency key,
   * expiry, plan hash and context snapshot.
   */
  requestApproval(input: RequestApprovalInput): WorkApproval {
    return this.db.transaction(() => {
      const run = this.repo.requireRun(input.runId);
      const artifact = input.artifactId ? this.repo.getArtifact(input.artifactId) : null;
      const expiresAt = new Date(
        this.clock().getTime() + (input.ttlMs ?? this.approvalTtlMs),
      ).toISOString();

      const id = newWorkId('approval');
      const idempotencyKey = input.idempotencyKey ?? id;
      const binding: WorkActionBinding = {
        target: redactText(input.target).value,
        input: input.input,
        artifactId: toArtifactIdOrNull(artifact?.id ?? null),
        artifactVersion: artifact?.version ?? null,
        estimatedSideEffect: redactText(input.estimatedSideEffect).value,
        idempotencyKey,
        expiresAt,
        planHash: run.planHash,
        contextSnapshotId: toContextSnapshotIdOrNull(run.contextSnapshotId ?? null),
      };

      const approval = this.repo.insertApproval({
        id,
        runId: input.runId,
        stepId: input.stepId ?? null,
        kind: input.kind,
        title: input.title,
        summary: input.summary,
        risk: input.risk,
        actionHash: computeActionHash(binding),
        binding,
        preview: input.preview ?? null,
      });

      this.append({
        runId: input.runId,
        type: 'approval.requested',
        idempotencyKey: `approval.requested:${approval.id}`,
        approvalId: approval.id,
        ...(input.stepId ? { stepId: input.stepId } : {}),
        payload: {
          kind: approval.kind,
          title: approval.title,
          risk: approval.risk,
          actionHash: approval.actionHash,
          target: approval.binding.target,
          estimatedSideEffect: approval.binding.estimatedSideEffect,
          expiresAt: approval.expiresAt,
          ...(approval.binding.artifactId
            ? {
                artifactId: approval.binding.artifactId,
                artifactVersion: approval.binding.artifactVersion,
              }
            : {}),
        },
      });

      if (input.blockRun !== false && run.state !== 'awaiting_approval') {
        // Only if the edge exists — a created run holding a gate stays created.
        try {
          this.transition(input.runId, 'awaiting_approval', { reason: 'approval requested' });
        } catch {
          // Not a legal edge from the current state; the gate still stands.
        }
      }

      return this.repo.requireApproval(approval.id);
    });
  }

  getApproval(approvalId: string): WorkApproval | null {
    return this.repo.getApproval(approvalId);
  }

  listApprovals(runId: string): WorkApproval[] {
    return this.repo.listApprovals(runId);
  }

  listPendingApprovals(runId?: string): WorkApproval[] {
    return this.repo.listPendingApprovals(runId);
  }

  /**
   * Record a human decision. Fails closed: an approval that is no longer valid is
   * marked expired/invalidated and the decision is refused, rather than applied
   * to an action the reviewer did not actually see.
   *
   * Never performs the external effect — see `buildReceipt`.
   */
  decideApproval(input: DecideApprovalInput): DecideApprovalResult {
    return this.db.transaction(() => {
      const approval = this.repo.requireApproval(input.approvalId);

      if (approval.status !== 'pending') {
        return { ok: false as const, approval, reason: 'already-decided' as const };
      }

      if (input.decision === 'edit' && input.editedInput === undefined) {
        return { ok: false as const, approval, reason: 'missing-edited-input' as const };
      }

      const validity = evaluateApprovalValidity(approval, this.validityContext(approval));
      if (!validity.valid) {
        const invalidated = this.markApprovalInvalid(approval, validity.reason);
        return { ok: false as const, approval: invalidated, reason: validity.reason };
      }

      const status = statusForDecision(input.decision);
      const decidedAt = this.nowIso();

      // An edit changes the action, so it gets its own hash. The receipt keeps
      // both, so an audit can see what was proposed and what was consented to.
      const decidedBinding: WorkActionBinding =
        input.decision === 'edit'
          ? { ...approval.binding, input: input.editedInput }
          : approval.binding;
      const decidedActionHash =
        input.decision === 'edit' ? computeActionHash(decidedBinding) : approval.actionHash;

      const receipt = buildReceipt({
        approval,
        decision: input.decision,
        status,
        decidedActionHash,
        decidedBy: input.decidedBy,
        decidedAt,
      });
      const receiptDigest = computeReceiptDigest(receipt);

      const updated = this.repo.updateApproval(approval.id, {
        status,
        decidedAt,
        decidedBy: input.decidedBy,
        decisionNote: input.note ?? null,
        ...(input.decision === 'edit' ? { editedInput: input.editedInput } : {}),
        receiptDigest,
        receipt,
      });

      const appended = this.append({
        runId: approval.runId,
        type: 'approval.decided',
        idempotencyKey: `approval.decided:${approval.id}`,
        approvalId: approval.id,
        payload: {
          decision: input.decision,
          status,
          decidedActionHash,
          proposedActionHash: approval.actionHash,
          receiptDigest,
          externalActionPerformed: false,
        },
      });

      if (updated.stepId) {
        this.repo.upsertStep({
          runId: approval.runId,
          key: `approval:${approval.id}`,
          kind: 'approval',
          label: approval.title,
          status: input.decision === 'reject' ? 'blocked' : 'done',
        });
      }

      return {
        ok: true as const,
        approval: updated,
        receipt,
        duplicate: appended.duplicate,
      };
    });
  }

  /**
   * Close out approvals that reality has moved past. Called after a plan or
   * artifact change and on demand (e.g. a periodic sweep for expiry).
   */
  invalidateStaleApprovals(runId?: string): WorkApproval[] {
    return this.db.transaction(() => {
      const pending = this.repo.listPendingApprovals(runId);
      const invalidated: WorkApproval[] = [];
      for (const approval of pending) {
        const validity = evaluateApprovalValidity(approval, this.validityContext(approval));
        if (!validity.valid) invalidated.push(this.markApprovalInvalid(approval, validity.reason));
      }
      return invalidated;
    });
  }

  private validityContext(approval: WorkApproval): ApprovalValidityContext {
    const run = this.repo.requireRun(approval.runId);
    const boundArtifact = approval.binding.artifactId
      ? this.repo.getArtifact(approval.binding.artifactId)
      : null;
    const latest = boundArtifact
      ? this.repo.latestArtifact(approval.runId, boundArtifact.name)
      : null;
    return {
      now: this.nowIso(),
      planHash: run.planHash,
      currentArtifactVersion: latest?.version ?? null,
      contextSnapshotId: run.contextSnapshotId ?? null,
    };
  }

  private markApprovalInvalid(
    approval: WorkApproval,
    reason: WorkApprovalInvalidReason,
  ): WorkApproval {
    const updated = this.repo.updateApproval(approval.id, {
      status: statusForInvalidReason(reason),
      invalidReason: reason,
    });

    this.append({
      runId: approval.runId,
      type: 'approval.invalidated',
      idempotencyKey: `approval.invalidated:${approval.id}:${reason}`,
      approvalId: approval.id,
      payload: { reason, status: updated.status, actionHash: approval.actionHash },
    });

    return updated;
  }

  // ── Checkpoints, restart and resume ──

  /**
   * Capture a resume point. The cursor names work (`nextStepKey`, pending
   * approval, consumed event seq) and deliberately holds no provider handle, so
   * a resumed run does not depend on the model or session that started it.
   */
  saveCheckpoint(
    runId: string,
    cursor: Partial<WorkCheckpointCursor> = {},
    label = 'auto',
  ): WorkCheckpoint {
    return this.db.transaction(() => {
      const run = this.repo.requireRun(runId);
      const pending = this.repo.listPendingApprovals(runId)[0];
      const nextStep = this.repo.listSteps(runId).find((step) => step.status === 'pending');

      const resolved: WorkCheckpointCursor = {
        consumedEventSeq: cursor.consumedEventSeq ?? this.repo.lastRunSeq(runId),
        ...(cursor.nextStepKey ?? nextStep?.key ? { nextStepKey: cursor.nextStepKey ?? nextStep?.key } : {}),
        ...(cursor.pendingApprovalId ?? pending?.id
          ? { pendingApprovalId: cursor.pendingApprovalId ?? pending?.id }
          : {}),
        ...(cursor.scratch ? { scratch: cursor.scratch } : {}),
      };

      const checkpoint = this.repo.saveCheckpoint({
        id: newWorkId('checkpoint'),
        runId,
        label,
        runState: run.state,
        cursor: resolved,
      });

      this.append({
        runId,
        type: 'checkpoint.saved',
        idempotencyKey: `checkpoint:${checkpoint.id}`,
        payload: {
          label: checkpoint.label,
          runState: checkpoint.runState,
          eventSeq: checkpoint.eventSeq,
          cursor: checkpoint.cursor,
        },
      });

      return checkpoint;
    });
  }

  latestCheckpoint(runId: string): WorkCheckpoint | null {
    return this.repo.latestCheckpoint(runId);
  }

  /**
   * Restart recovery. A run left in `running` (or mid-approval) when the process
   * died has no executor any more, so it is checkpointed and parked in `paused`
   * — visible, resumable, and not silently "in progress" forever.
   *
   * Call once during main-process startup.
   */
  recoverInterruptedRuns(): WorkRun[] {
    return this.db.transaction(() => {
      const recovered: WorkRun[] = [];
      for (const run of this.repo.listRuns({ limit: 500 })) {
        if (run.state !== 'running' && run.state !== 'queued') continue;
        this.saveCheckpoint(run.id, {}, 'restart-recovery');
        recovered.push(
          this.transition(run.id, 'paused', { reason: 'process restarted while run was active' }),
        );
      }
      return recovered;
    });
  }

  /**
   * Resume a paused/waiting run from its latest checkpoint. Returns the cursor so
   * the executor knows where to pick up; a run with no checkpoint resumes from
   * the head of its event log.
   */
  resume(runId: string): ResumeResult {
    return this.db.transaction(() => {
      const run = this.repo.requireRun(runId);
      if (isTerminalWorkRunState(run.state)) {
        throw new Error(`Run ${runId} is ${run.state} and cannot be resumed; retry it instead`);
      }

      const checkpoint = this.repo.latestCheckpoint(runId);
      const cursor: WorkCheckpointCursor =
        checkpoint?.cursor ?? { consumedEventSeq: this.repo.lastRunSeq(runId) };

      const started = run.state === 'running' ? run : this.transition(runId, 'running', { reason: 'resume' });

      const occurrence = this.repo.countEvents(runId, 'run.resumed');
      this.append({
        runId,
        type: 'run.resumed',
        idempotencyKey: `run.resumed:${occurrence}`,
        payload: {
          from: run.state,
          ...(checkpoint ? { checkpointId: checkpoint.id, eventSeq: checkpoint.eventSeq } : {}),
          cursor,
        },
      });

      return { run: started, checkpoint, cursor };
    });
  }

  // ── Lineage ──

  /** A retry is a new run in the same lineage, never a resurrected terminal run. */
  retryRun(runId: string, options: { title?: string } = {}): WorkRun {
    return this.forkInternal(runId, 'retry', options.title);
  }

  /** A fork explores an alternative from the same point, keeping both branches. */
  forkRun(runId: string, options: { title?: string } = {}): WorkRun {
    return this.forkInternal(runId, 'fork', options.title);
  }

  private forkInternal(runId: string, kind: 'retry' | 'fork', title?: string): WorkRun {
    return this.db.transaction(() => {
      const source = this.repo.requireRun(runId);
      const id = newWorkId('run');
      const plan = this.repo
        .listSteps(runId)
        .filter((step) => step.kind === 'plan')
        .map((step) => ({ key: step.key, label: step.label }));

      const created = this.repo.insertRun({
        id,
        workspaceId: source.workspaceId,
        title: title ?? `${source.title} (${kind} ${source.attempt + 1})`,
        brief: source.brief,
        state: 'created',
        origin: source.origin,
        originRef: source.originRef ?? null,
        planVersion: 1,
        planHash: computePlanHash(plan),
        contextSnapshotId: source.contextSnapshotId ?? null,
        parentRunId: source.id,
        rootRunId: source.rootRunId,
        lineageKind: kind,
        attempt: source.attempt + 1,
      });

      for (const step of plan) {
        this.repo.upsertStep({
          runId: id,
          key: step.key,
          kind: 'plan',
          label: step.label,
          status: 'pending',
        });
      }

      this.append({
        runId: id,
        type: 'run.created',
        idempotencyKey: 'run.created',
        payload: {
          title: created.title,
          brief: created.brief,
          origin: created.origin,
          planVersion: created.planVersion,
          planHash: created.planHash,
          stepCount: plan.length,
        },
      });

      // Recorded on the PARENT too, so the source run's own log shows the branch.
      this.append({
        runId: source.id,
        type: 'run.forked',
        idempotencyKey: `run.forked:${id}`,
        payload: {
          childRunId: id,
          lineageKind: kind,
          attempt: created.attempt,
          rootRunId: created.rootRunId,
        },
      });

      return created;
    });
  }

  // ── Event append + fan-out ──

  /**
   * Record the one audit event that says "this unified run came from a legacy
   * row, and here is what the adapter concluded". Classified `audit_events`.
   *
   * The idempotency key is derived from the legacy identity alone — NOT from the
   * conclusion — so re-importing the same record cannot append a second audit
   * event even if the evidence is re-read. That is what makes a repeated import
   * converge instead of accumulating history (MAP-ARCHIVED ruling).
   */
  recordMigrationAudit(input: {
    runId: string;
    legacySource: string;
    legacyId: string;
    legacyStatusRaw: string;
    /** What the adapter concluded, and on what basis, so it can be re-examined. */
    derivedState: WorkRunState;
    evidence: 'conclusive' | 'inconclusive' | 'not_applicable';
    evidenceNote?: string;
  }): AppendEventResult {
    return this.append({
      runId: input.runId,
      type: 'run.migrated',
      idempotencyKey: `legacy-migrated:${input.legacySource}:${input.legacyId}`,
      payload: {
        legacySource: input.legacySource,
        legacyStatusRaw: input.legacyStatusRaw,
        derivedState: input.derivedState,
        evidence: input.evidence,
        ...(input.evidenceNote ? { evidenceNote: redactText(input.evidenceNote).value } : {}),
      },
    });
  }

  /**
   * The single append path. Fan-out to live subscribers happens after the row is
   * committed-or-deduped, and a duplicate is not re-broadcast.
   */
  private append(input: {
    runId: string;
    type: WorkEventType;
    payload: unknown;
    idempotencyKey: string;
    stepId?: string;
    artifactId?: string;
    approvalId?: string;
  }): AppendEventResult {
    const result = this.repo.appendEvent({
      id: newWorkId('event'),
      runId: input.runId,
      type: input.type,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
      payloadVersion: WORK_EVENT_PAYLOAD_VERSION,
      stepId: input.stepId ?? null,
      artifactId: input.artifactId ?? null,
      approvalId: input.approvalId ?? null,
    });

    if (!result.duplicate && this.onEvent) {
      try {
        this.onEvent(result.event);
      } catch {
        // A subscriber failure must never roll back recorded work.
      }
    }

    return result;
  }
}
