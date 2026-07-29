/**
 * RunRepository — the only code that talks SQL to the unified work model.
 *
 * Three invariants live here rather than in the callers, because a caller that
 * forgets one produces a corrupt audit trail that looks fine until it matters:
 *
 * 1. **Redaction at the door.** Every free-text and JSON field is scrubbed on the
 *    way in (`shared/work-redaction`). There is no "unredacted write" path, so
 *    "was this payload scrubbed?" has one answer for the whole model.
 * 2. **Append-only, ordered events.** `run_seq` is assigned inside the write
 *    transaction as `MAX+1` for that run, so it is gapless and strictly
 *    increasing per run even under interleaved producers. `seq` is the global
 *    cursor (monotonic, gaps allowed — a cursor only needs to move forward).
 * 3. **Idempotent appends.** `(run_id, idempotency_key)` is unique. A retried
 *    emit returns the row that already exists and reports `duplicate: true`
 *    instead of writing a second event.
 *
 * @module main/work/run-repository
 */
import {
  WORK_EVENT_PAYLOAD_VERSION,
  PERSONAL_OFFICE_SCHEMA_VERSION,
  assertRowSchemaVersion,
  toArtifactIdOrNull,
  toContextSnapshotIdOrNull,
  type RunCanceledReason,
  type RunPauseReason,
  type WorkActionBinding,
  type WorkApproval,
  type WorkApprovalInvalidReason,
  type WorkApprovalKind,
  type WorkApprovalRisk,
  type WorkApprovalStatus,
  type WorkArtifact,
  type WorkArtifactKind,
  type WorkCheckpoint,
  type WorkCheckpointCursor,
  type WorkContextSnapshot,
  type WorkEvent,
  type WorkEventType,
  type WorkRun,
  type WorkRunLineageKind,
  type WorkRunOrigin,
  type WorkRunState,
  type WorkStep,
  type WorkStepKind,
  type WorkStepStatus,
  type Workspace,
  type WorkspaceKind,
} from './work-types';
import { redactDeep, redactJson, redactText, type RedactionKind } from './work-redaction';
import { WorkDb } from './work-sqlite';

/**
 * Reserved key added to a stored payload when redaction fired, so an audit can
 * see that something was removed without the value ever being persisted.
 */
export const REDACTION_MARKER_KEY = '_redacted';

const MAX_TEXT = 4_000;
const MAX_LABEL = 300;
const MAX_BODY = 200_000;

function clampText(value: string | undefined | null, max: number): string {
  if (typeof value !== 'string') return '';
  const { value: scrubbed } = redactText(value);
  return scrubbed.length > max ? `${scrubbed.slice(0, max)}…` : scrubbed;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Serialise a payload with redaction, tagging which redaction kinds fired. */
function encodePayload(payload: unknown): string {
  const { value, kinds } = redactDeep(payload);
  if (kinds.length === 0) return safeStringify(value);
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return safeStringify({ ...(value as Record<string, unknown>), [REDACTION_MARKER_KEY]: kinds });
  }
  return safeStringify({ value, [REDACTION_MARKER_KEY]: kinds });
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? null) ?? 'null';
  } catch {
    return JSON.stringify({ error: 'unserializable-payload' });
  }
}

function decodeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ── Row shapes (snake_case, as stored) ─────────────────────────────────────

interface WorkspaceRow {
  id: string;
  name: string;
  kind: WorkspaceKind;
  external_ref: string | null;
  schema_version: number;
  created_at: string;
  updated_at: string;
}

interface RunRow {
  id: string;
  workspace_id: string;
  title: string;
  brief: string;
  state: WorkRunState;
  origin: WorkRunOrigin;
  origin_ref: string | null;
  plan_version: number;
  plan_hash: string;
  context_snapshot_id: string | null;
  parent_run_id: string | null;
  root_run_id: string;
  lineage_kind: WorkRunLineageKind;
  attempt: number;
  last_error: string | null;
  paused_reason: RunPauseReason | null;
  canceled_reason: RunCanceledReason | null;
  archived_at: string | null;
  legacy_status_raw: string | null;
  schema_version: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
}

interface StepRow {
  id: string;
  run_id: string;
  workspace_id: string;
  seq: number;
  key: string;
  kind: WorkStepKind;
  label: string;
  detail: string | null;
  status: WorkStepStatus;
  schema_version: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  ended_at: string | null;
}

interface ArtifactRow {
  id: string;
  run_id: string;
  workspace_id: string;
  step_id: string | null;
  name: string;
  kind: WorkArtifactKind;
  media_type: string;
  version: number;
  sha256: string;
  size_bytes: number;
  body: string | null;
  external_path: string | null;
  schema_version: number;
  created_at: string;
  updated_at: string;
}

interface ApprovalRow {
  id: string;
  run_id: string;
  workspace_id: string;
  step_id: string | null;
  kind: WorkApprovalKind;
  title: string;
  summary: string;
  risk: WorkApprovalRisk;
  status: WorkApprovalStatus;
  action_hash: string;
  action_target: string;
  action_input: string;
  artifact_id: string | null;
  artifact_version: number | null;
  estimated_side_effect: string;
  idempotency_key: string;
  plan_hash: string;
  context_snapshot_id: string | null;
  preview: string | null;
  expires_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  edited_input: string | null;
  receipt_digest: string | null;
  receipt: string | null;
  invalid_reason: WorkApprovalInvalidReason | null;
  schema_version: number;
  created_at: string;
  updated_at: string;
}

interface EventRow {
  seq: number;
  id: string;
  run_id: string;
  workspace_id: string;
  run_seq: number;
  type: WorkEventType;
  payload_version: number;
  payload: string;
  idempotency_key: string;
  step_id: string | null;
  artifact_id: string | null;
  approval_id: string | null;
  schema_version: number;
  created_at: string;
}

interface CheckpointRow {
  id: string;
  run_id: string;
  workspace_id: string;
  label: string;
  event_seq: number;
  run_state: WorkRunState;
  cursor: string;
  is_latest: number;
  schema_version: number;
  created_at: string;
  updated_at: string;
}

interface ContextSnapshotRow {
  id: string;
  workspace_id: string;
  run_id: string | null;
  content_hash: string;
  source: string;
  summary: string | null;
  ref: string | null;
  schema_version: number;
  created_at: string;
  updated_at: string;
}

// ── Insert inputs ──────────────────────────────────────────────────────────

export interface UpsertWorkspaceInput {
  id: string;
  name: string;
  kind: WorkspaceKind;
  externalRef?: string | null;
}

export interface InsertRunInput {
  id: string;
  workspaceId: string;
  title: string;
  brief: string;
  state: WorkRunState;
  origin: WorkRunOrigin;
  originRef?: string | null;
  planVersion: number;
  planHash: string;
  contextSnapshotId?: string | null;
  parentRunId?: string | null;
  rootRunId: string;
  lineageKind: WorkRunLineageKind;
  attempt: number;
  createdAt?: string;
}

export interface UpdateRunPatch {
  title?: string;
  state?: WorkRunState;
  planVersion?: number;
  planHash?: string;
  contextSnapshotId?: string | null;
  lastError?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  /**
   * Additive fields authorised for Loop 03 by W0 (optional, never required, no
   * schema bump). They exist so a legacy mapping never has to fabricate a state:
   * the honest reason travels alongside the state instead of being guessed.
   */
  pausedReason?: RunPauseReason | null;
  canceledReason?: RunCanceledReason | null;
  archivedAt?: string | null;
  legacyStatusRaw?: string | null;
}

export interface UpsertStepInput {
  runId: string;
  key: string;
  kind: WorkStepKind;
  label: string;
  status: WorkStepStatus;
  detail?: string | null;
  id?: string;
}

export interface InsertArtifactInput {
  id: string;
  runId: string;
  stepId?: string | null;
  name: string;
  kind: WorkArtifactKind;
  mediaType: string;
  /** Inline body; redacted and hashed before storage. */
  body?: string | null;
  /** Pointer used instead of an inline copy (least persistence). */
  externalPath?: string | null;
  /** Digest of the stored body, supplied by the service. */
  sha256: string;
  sizeBytes: number;
}

export interface InsertApprovalInput {
  id: string;
  runId: string;
  stepId?: string | null;
  kind: WorkApprovalKind;
  title: string;
  summary: string;
  risk: WorkApprovalRisk;
  actionHash: string;
  binding: WorkActionBinding;
  preview?: string | null;
}

export interface UpdateApprovalPatch {
  status?: WorkApprovalStatus;
  decidedAt?: string | null;
  decidedBy?: string | null;
  decisionNote?: string | null;
  editedInput?: unknown;
  receiptDigest?: string | null;
  receipt?: unknown;
  invalidReason?: WorkApprovalInvalidReason | null;
}

export interface AppendEventInput {
  id: string;
  runId: string;
  type: WorkEventType;
  payload: unknown;
  idempotencyKey: string;
  payloadVersion?: number;
  stepId?: string | null;
  artifactId?: string | null;
  approvalId?: string | null;
}

export interface AppendEventResult {
  event: WorkEvent;
  /** True when this idempotency key had already been recorded for the run. */
  duplicate: boolean;
}

export interface SaveCheckpointInput {
  id: string;
  runId: string;
  label: string;
  runState: WorkRunState;
  cursor: WorkCheckpointCursor;
}

export interface UpsertContextSnapshotInput {
  id: string;
  workspaceId: string;
  runId?: string | null;
  contentHash: string;
  source: string;
  summary?: string | null;
  ref?: string | null;
}

export class UnknownRunError extends Error {
  constructor(runId: string) {
    super(`Unknown run: ${runId}`);
    this.name = 'UnknownRunError';
  }
}

/**
 * Thrown when one idempotency key is reused for a DIFFERENT fact. An honest
 * retry re-sends the same event and is answered with the stored row; two
 * distinct events colliding on one key are not a retry, and returning the first
 * silently would drop the second while reporting success.
 */
export class WorkEventIdempotencyConflictError extends Error {
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly storedType: string;
  readonly incomingType: string;

  constructor(runId: string, idempotencyKey: string, storedType: string, incomingType: string) {
    super(
      `Idempotency conflict on run ${runId}: key "${idempotencyKey}" already ` +
        `records a "${storedType}" event, but a different "${incomingType}" ` +
        'event was submitted under the same key.',
    );
    this.name = 'WorkEventIdempotencyConflictError';
    this.runId = runId;
    this.idempotencyKey = idempotencyKey;
    this.storedType = storedType;
    this.incomingType = incomingType;
  }
}

// ── Repository ─────────────────────────────────────────────────────────────

export class RunRepository {
  constructor(private readonly db: WorkDb) {}

  /** Exposed so the service can wrap several repository writes in one unit of work. */
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }

  // ── Workspaces ──

  upsertWorkspace(input: UpsertWorkspaceInput): Workspace {
    const now = nowIso();
    this.db.run(
      `INSERT INTO workspaces (id, name, kind, external_ref, schema_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         kind = excluded.kind,
         external_ref = excluded.external_ref,
         schema_version = excluded.schema_version,
         updated_at = excluded.updated_at`,
      input.id,
      clampText(input.name, MAX_LABEL) || input.id,
      input.kind,
      input.externalRef ?? null,
      PERSONAL_OFFICE_SCHEMA_VERSION,
      now,
      now,
    );
    const workspace = this.getWorkspace(input.id);
    if (!workspace) throw new Error(`Failed to upsert workspace ${input.id}`);
    return workspace;
  }

  getWorkspace(id: string): Workspace | null {
    const row = this.db.get<WorkspaceRow>('SELECT * FROM workspaces WHERE id = ?', id);
    return row ? mapWorkspace(row) : null;
  }

  listWorkspaces(): Workspace[] {
    return this.db
      .all<WorkspaceRow>('SELECT * FROM workspaces ORDER BY created_at ASC')
      .map(mapWorkspace);
  }

  // ── Context snapshots ──

  upsertContextSnapshot(input: UpsertContextSnapshotInput): WorkContextSnapshot {
    const now = nowIso();
    this.db.run(
      `INSERT INTO context_snapshots
         (id, workspace_id, run_id, content_hash, source, summary, ref, schema_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         content_hash = excluded.content_hash,
         summary = excluded.summary,
         ref = excluded.ref,
         updated_at = excluded.updated_at`,
      input.id,
      input.workspaceId,
      input.runId ?? null,
      input.contentHash,
      clampText(input.source, MAX_LABEL),
      input.summary ? clampText(input.summary, MAX_TEXT) : null,
      input.ref ?? null,
      PERSONAL_OFFICE_SCHEMA_VERSION,
      now,
      now,
    );
    const snapshot = this.getContextSnapshot(input.id);
    if (!snapshot) throw new Error(`Failed to upsert context snapshot ${input.id}`);
    return snapshot;
  }

  getContextSnapshot(id: string): WorkContextSnapshot | null {
    const row = this.db.get<ContextSnapshotRow>('SELECT * FROM context_snapshots WHERE id = ?', id);
    return row ? mapContextSnapshot(row) : null;
  }

  // ── Runs ──

  insertRun(input: InsertRunInput): WorkRun {
    const now = input.createdAt ?? nowIso();
    this.db.run(
      `INSERT INTO work_runs (
         id, workspace_id, title, brief, state, origin, origin_ref,
         plan_version, plan_hash, context_snapshot_id, parent_run_id, root_run_id,
         lineage_kind, attempt, last_error, schema_version, created_at, updated_at,
         started_at, ended_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL)`,
      input.id,
      input.workspaceId,
      clampText(input.title, MAX_LABEL) || 'Untitled run',
      clampText(input.brief, MAX_TEXT),
      input.state,
      input.origin,
      input.originRef ?? null,
      input.planVersion,
      input.planHash,
      input.contextSnapshotId ?? null,
      input.parentRunId ?? null,
      input.rootRunId,
      input.lineageKind,
      input.attempt,
      PERSONAL_OFFICE_SCHEMA_VERSION,
      now,
      now,
    );
    return this.requireRun(input.id);
  }

  getRun(id: string): WorkRun | null {
    const row = this.db.get<RunRow>('SELECT * FROM work_runs WHERE id = ?', id);
    return row ? mapRun(row) : null;
  }

  requireRun(id: string): WorkRun {
    const run = this.getRun(id);
    if (!run) throw new UnknownRunError(id);
    return run;
  }

  findRunByOrigin(origin: WorkRunOrigin, originRef: string): WorkRun | null {
    const row = this.db.get<RunRow>(
      'SELECT * FROM work_runs WHERE origin = ? AND origin_ref = ? ORDER BY created_at ASC LIMIT 1',
      origin,
      originRef,
    );
    return row ? mapRun(row) : null;
  }

  listRuns(options: { workspaceId?: string; limit?: number } = {}): WorkRun[] {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    const rows = options.workspaceId
      ? this.db.all<RunRow>(
          'SELECT * FROM work_runs WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?',
          options.workspaceId,
          limit,
        )
      : this.db.all<RunRow>('SELECT * FROM work_runs ORDER BY updated_at DESC LIMIT ?', limit);
    return rows.map(mapRun);
  }

  /** Every run in a retry/fork family, oldest attempt first. */
  listLineage(rootRunId: string): WorkRun[] {
    return this.db
      .all<RunRow>(
        'SELECT * FROM work_runs WHERE root_run_id = ? ORDER BY attempt ASC, created_at ASC',
        rootRunId,
      )
      .map(mapRun);
  }

  updateRun(id: string, patch: UpdateRunPatch): WorkRun {
    const assignments: string[] = [];
    const params: unknown[] = [];

    if (patch.title !== undefined) {
      assignments.push('title = ?');
      params.push(clampText(patch.title, MAX_LABEL) || 'Untitled run');
    }
    if (patch.state !== undefined) {
      assignments.push('state = ?');
      params.push(patch.state);
    }
    if (patch.planVersion !== undefined) {
      assignments.push('plan_version = ?');
      params.push(patch.planVersion);
    }
    if (patch.planHash !== undefined) {
      assignments.push('plan_hash = ?');
      params.push(patch.planHash);
    }
    if (patch.contextSnapshotId !== undefined) {
      assignments.push('context_snapshot_id = ?');
      params.push(patch.contextSnapshotId);
    }
    if (patch.lastError !== undefined) {
      assignments.push('last_error = ?');
      params.push(patch.lastError === null ? null : clampText(patch.lastError, MAX_TEXT));
    }
    if (patch.startedAt !== undefined) {
      assignments.push('started_at = ?');
      params.push(patch.startedAt);
    }
    if (patch.endedAt !== undefined) {
      assignments.push('ended_at = ?');
      params.push(patch.endedAt);
    }
    if (patch.pausedReason !== undefined) {
      assignments.push('paused_reason = ?');
      params.push(patch.pausedReason);
    }
    if (patch.canceledReason !== undefined) {
      assignments.push('canceled_reason = ?');
      params.push(patch.canceledReason);
    }
    if (patch.archivedAt !== undefined) {
      assignments.push('archived_at = ?');
      params.push(patch.archivedAt);
    }
    if (patch.legacyStatusRaw !== undefined) {
      assignments.push('legacy_status_raw = ?');
      params.push(patch.legacyStatusRaw === null ? null : clampText(patch.legacyStatusRaw, MAX_LABEL));
    }

    if (assignments.length === 0) return this.requireRun(id);

    assignments.push('updated_at = ?');
    params.push(nowIso(), id);

    this.db.run(`UPDATE work_runs SET ${assignments.join(', ')} WHERE id = ?`, ...params);
    return this.requireRun(id);
  }

  // ── Steps ──

  /**
   * Insert or update the step identified by `(runId, key)`. The caller owns the
   * key, so a re-emitted tool step updates in place instead of duplicating —
   * which is what makes a resumed run converge rather than grow.
   */
  upsertStep(input: UpsertStepInput): WorkStep {
    return this.db.transaction(() => {
      const run = this.requireRun(input.runId);
      const existing = this.getStepByKey(input.runId, input.key);
      const now = nowIso();

      if (existing) {
        const startedAt =
          existing.startedAt ?? (input.status === 'running' || input.status === 'done' ? now : null);
        const endedAt = isFinishedStepStatus(input.status) ? (existing.endedAt ?? now) : null;
        this.db.run(
          `UPDATE work_steps
             SET kind = ?, label = ?, detail = ?, status = ?, updated_at = ?, started_at = ?, ended_at = ?
           WHERE id = ?`,
          input.kind,
          clampText(input.label, MAX_LABEL),
          input.detail === undefined || input.detail === null
            ? existing.detail ?? null
            : clampText(input.detail, MAX_TEXT),
          input.status,
          now,
          startedAt,
          endedAt,
          existing.id,
        );
        return this.requireStep(existing.id);
      }

      const nextSeq = this.nextStepSeq(input.runId);
      const id = input.id ?? `step-${input.runId}-${nextSeq}`;
      this.db.run(
        `INSERT INTO work_steps (
           id, run_id, workspace_id, seq, key, kind, label, detail, status,
           schema_version, created_at, updated_at, started_at, ended_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.runId,
        run.workspaceId,
        nextSeq,
        input.key,
        input.kind,
        clampText(input.label, MAX_LABEL),
        input.detail ? clampText(input.detail, MAX_TEXT) : null,
        input.status,
        PERSONAL_OFFICE_SCHEMA_VERSION,
        now,
        now,
        input.status === 'running' || input.status === 'done' ? now : null,
        isFinishedStepStatus(input.status) ? now : null,
      );
      return this.requireStep(id);
    });
  }

  getStep(id: string): WorkStep | null {
    const row = this.db.get<StepRow>('SELECT * FROM work_steps WHERE id = ?', id);
    return row ? mapStep(row) : null;
  }

  requireStep(id: string): WorkStep {
    const step = this.getStep(id);
    if (!step) throw new Error(`Unknown step: ${id}`);
    return step;
  }

  getStepByKey(runId: string, key: string): WorkStep | null {
    const row = this.db.get<StepRow>(
      'SELECT * FROM work_steps WHERE run_id = ? AND key = ?',
      runId,
      key,
    );
    return row ? mapStep(row) : null;
  }

  listSteps(runId: string): WorkStep[] {
    return this.db
      .all<StepRow>('SELECT * FROM work_steps WHERE run_id = ? ORDER BY seq ASC', runId)
      .map(mapStep);
  }

  private nextStepSeq(runId: string): number {
    const row = this.db.get<{ next: number }>(
      'SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM work_steps WHERE run_id = ?',
      runId,
    );
    return row?.next ?? 1;
  }

  // ── Artifacts ──

  /** Next version for `(runId, name)`; 1 when the name is new. */
  nextArtifactVersion(runId: string, name: string): number {
    const row = this.db.get<{ next: number }>(
      'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM work_artifacts WHERE run_id = ? AND name = ?',
      runId,
      name,
    );
    return row?.next ?? 1;
  }

  insertArtifact(input: InsertArtifactInput): WorkArtifact {
    return this.db.transaction(() => {
      const run = this.requireRun(input.runId);
      const version = this.nextArtifactVersion(input.runId, input.name);
      const now = nowIso();
      this.db.run(
        `INSERT INTO work_artifacts (
           id, run_id, workspace_id, step_id, name, kind, media_type, version,
           sha256, size_bytes, body, external_path, schema_version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        input.id,
        input.runId,
        run.workspaceId,
        input.stepId ?? null,
        clampText(input.name, MAX_LABEL),
        input.kind,
        input.mediaType,
        version,
        input.sha256,
        input.sizeBytes,
        input.body ?? null,
        input.externalPath ?? null,
        PERSONAL_OFFICE_SCHEMA_VERSION,
        now,
        now,
      );
      return this.requireArtifact(input.id);
    });
  }

  getArtifact(id: string): WorkArtifact | null {
    const row = this.db.get<ArtifactRow>('SELECT * FROM work_artifacts WHERE id = ?', id);
    return row ? mapArtifact(row) : null;
  }

  requireArtifact(id: string): WorkArtifact {
    const artifact = this.getArtifact(id);
    if (!artifact) throw new Error(`Unknown artifact: ${id}`);
    return artifact;
  }

  listArtifacts(runId: string): WorkArtifact[] {
    return this.db
      .all<ArtifactRow>(
        'SELECT * FROM work_artifacts WHERE run_id = ? ORDER BY created_at ASC, version ASC',
        runId,
      )
      .map(mapArtifact);
  }

  latestArtifact(runId: string, name: string): WorkArtifact | null {
    const row = this.db.get<ArtifactRow>(
      'SELECT * FROM work_artifacts WHERE run_id = ? AND name = ? ORDER BY version DESC LIMIT 1',
      runId,
      name,
    );
    return row ? mapArtifact(row) : null;
  }

  // ── Approvals ──

  insertApproval(input: InsertApprovalInput): WorkApproval {
    return this.db.transaction(() => {
      const run = this.requireRun(input.runId);
      const now = nowIso();
      this.db.run(
        `INSERT INTO work_approvals (
           id, run_id, workspace_id, step_id, kind, title, summary, risk, status,
           action_hash, action_target, action_input, artifact_id, artifact_version,
           estimated_side_effect, idempotency_key, plan_hash, context_snapshot_id,
           preview, expires_at, decided_at, decided_by, decision_note, edited_input,
           receipt_digest, receipt, invalid_reason, schema_version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
        input.id,
        input.runId,
        run.workspaceId,
        input.stepId ?? null,
        input.kind,
        clampText(input.title, MAX_LABEL),
        clampText(input.summary, MAX_TEXT),
        input.risk,
        input.actionHash,
        clampText(input.binding.target, MAX_LABEL),
        encodePayload(input.binding.input),
        input.binding.artifactId,
        input.binding.artifactVersion,
        clampText(input.binding.estimatedSideEffect, MAX_TEXT),
        input.binding.idempotencyKey,
        input.binding.planHash,
        input.binding.contextSnapshotId,
        input.preview ? clampText(input.preview, MAX_TEXT) : null,
        input.binding.expiresAt,
        PERSONAL_OFFICE_SCHEMA_VERSION,
        now,
        now,
      );
      return this.requireApproval(input.id);
    });
  }

  getApproval(id: string): WorkApproval | null {
    const row = this.db.get<ApprovalRow>('SELECT * FROM work_approvals WHERE id = ?', id);
    return row ? mapApproval(row) : null;
  }

  requireApproval(id: string): WorkApproval {
    const approval = this.getApproval(id);
    if (!approval) throw new Error(`Unknown approval: ${id}`);
    return approval;
  }

  listApprovals(runId: string): WorkApproval[] {
    return this.db
      .all<ApprovalRow>(
        'SELECT * FROM work_approvals WHERE run_id = ? ORDER BY created_at ASC',
        runId,
      )
      .map(mapApproval);
  }

  listPendingApprovals(runId?: string): WorkApproval[] {
    const rows = runId
      ? this.db.all<ApprovalRow>(
          "SELECT * FROM work_approvals WHERE status = 'pending' AND run_id = ? ORDER BY created_at ASC",
          runId,
        )
      : this.db.all<ApprovalRow>(
          "SELECT * FROM work_approvals WHERE status = 'pending' ORDER BY created_at ASC",
        );
    return rows.map(mapApproval);
  }

  updateApproval(id: string, patch: UpdateApprovalPatch): WorkApproval {
    const assignments: string[] = [];
    const params: unknown[] = [];

    if (patch.status !== undefined) {
      assignments.push('status = ?');
      params.push(patch.status);
    }
    if (patch.decidedAt !== undefined) {
      assignments.push('decided_at = ?');
      params.push(patch.decidedAt);
    }
    if (patch.decidedBy !== undefined) {
      assignments.push('decided_by = ?');
      params.push(patch.decidedBy === null ? null : clampText(patch.decidedBy, MAX_LABEL));
    }
    if (patch.decisionNote !== undefined) {
      assignments.push('decision_note = ?');
      params.push(patch.decisionNote === null ? null : clampText(patch.decisionNote, MAX_TEXT));
    }
    if (patch.editedInput !== undefined) {
      assignments.push('edited_input = ?');
      params.push(patch.editedInput === null ? null : encodePayload(patch.editedInput));
    }
    if (patch.receiptDigest !== undefined) {
      assignments.push('receipt_digest = ?');
      params.push(patch.receiptDigest);
    }
    if (patch.receipt !== undefined) {
      assignments.push('receipt = ?');
      params.push(patch.receipt === null ? null : encodePayload(patch.receipt));
    }
    if (patch.invalidReason !== undefined) {
      assignments.push('invalid_reason = ?');
      params.push(patch.invalidReason);
    }

    if (assignments.length === 0) return this.requireApproval(id);

    assignments.push('updated_at = ?');
    params.push(nowIso(), id);

    this.db.run(`UPDATE work_approvals SET ${assignments.join(', ')} WHERE id = ?`, ...params);
    return this.requireApproval(id);
  }

  // ── Events (append-only) ──

  /**
   * Append one event. Ordering and idempotency are both settled inside a single
   * write transaction: `run_seq` is read as `MAX+1` under the write lock, and a
   * repeated `(run_id, idempotency_key)` returns the stored row untouched.
   */
  appendEvent(input: AppendEventInput): AppendEventResult {
    return this.db.transaction(() => {
      const existing = this.db.get<EventRow>(
        'SELECT * FROM work_events WHERE run_id = ? AND idempotency_key = ?',
        input.runId,
        input.idempotencyKey,
      );
      if (existing) return { event: this.reuseOrConflict(existing, input), duplicate: true };

      const run = this.requireRun(input.runId);
      const runSeq = this.nextRunSeq(input.runId);
      const result = this.db.run(
        `INSERT INTO work_events (
           id, run_id, workspace_id, run_seq, type, payload_version, payload,
           idempotency_key, step_id, artifact_id, approval_id, schema_version, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id, idempotency_key) DO NOTHING`,
        input.id,
        input.runId,
        run.workspaceId,
        runSeq,
        input.type,
        input.payloadVersion ?? WORK_EVENT_PAYLOAD_VERSION,
        encodePayload(input.payload),
        input.idempotencyKey,
        input.stepId ?? null,
        input.artifactId ?? null,
        input.approvalId ?? null,
        PERSONAL_OFFICE_SCHEMA_VERSION,
        nowIso(),
      );

      if (result.changes === 0) {
        // Lost a race to an identical key: the stored row is the one that counts.
        const stored = this.db.get<EventRow>(
          'SELECT * FROM work_events WHERE run_id = ? AND idempotency_key = ?',
          input.runId,
          input.idempotencyKey,
        );
        if (!stored) throw new Error('Event insert reported no change but no row exists');
        return { event: this.reuseOrConflict(stored, input), duplicate: true };
      }

      const stored = this.db.get<EventRow>('SELECT * FROM work_events WHERE id = ?', input.id);
      if (!stored) throw new Error(`Failed to append event ${input.id}`);
      return { event: mapEvent(stored), duplicate: false };
    });
  }

  /**
   * Decide what a repeated idempotency key means. An honest retry re-sends the
   * SAME fact, so returning the stored row is correct. A key reused for a
   * DIFFERENT fact is not a retry — it is two distinct events colliding on one
   * key, and silently returning the first would make the second disappear while
   * telling the caller it succeeded. That is the failure mode idempotency is
   * supposed to prevent, so it fails closed instead.
   */
  private reuseOrConflict(stored: EventRow, input: AppendEventInput): WorkEvent {
    const event = mapEvent(stored);
    const incomingPayload = encodePayload(input.payload);
    const incomingVersion = input.payloadVersion ?? WORK_EVENT_PAYLOAD_VERSION;
    if (
      stored.type !== input.type ||
      stored.payload !== incomingPayload ||
      stored.payload_version !== incomingVersion
    ) {
      throw new WorkEventIdempotencyConflictError(input.runId, input.idempotencyKey, stored.type, input.type);
    }
    return event;
  }

  private nextRunSeq(runId: string): number {
    const row = this.db.get<{ next: number }>(
      'SELECT COALESCE(MAX(run_seq), 0) + 1 AS next FROM work_events WHERE run_id = ?',
      runId,
    );
    return row?.next ?? 1;
  }

  lastRunSeq(runId: string): number {
    const row = this.db.get<{ last: number | null }>(
      'SELECT MAX(run_seq) AS last FROM work_events WHERE run_id = ?',
      runId,
    );
    return row?.last ?? 0;
  }

  listEvents(runId: string, afterRunSeq = 0, limit = 1_000): WorkEvent[] {
    return this.db
      .all<EventRow>(
        'SELECT * FROM work_events WHERE run_id = ? AND run_seq > ? ORDER BY run_seq ASC LIMIT ?',
        runId,
        afterRunSeq,
        Math.min(Math.max(limit, 1), 5_000),
      )
      .map(mapEvent);
  }

  /**
   * Workspace-scoped stream read — the cursor a live subscriber resumes from.
   *
   * Scope is applied in SQL, before rows are materialized, so main never loads
   * another workspace's payload merely to filter it afterwards.
   */
  listEventsSince(workspaceId: string, afterSeq = 0, limit = 500): WorkEvent[] {
    return this.db
      .all<EventRow>(
        `SELECT * FROM work_events
         WHERE workspace_id = ? AND seq > ?
         ORDER BY seq ASC
         LIMIT ?`,
        workspaceId,
        afterSeq,
        Math.min(Math.max(limit, 1), 2_000),
      )
      .map(mapEvent);
  }

  latestEventSeq(workspaceId: string): number {
    const row = this.db.get<{ last: number | null }>(
      'SELECT MAX(seq) AS last FROM work_events WHERE workspace_id = ?',
      workspaceId,
    );
    return row?.last ?? 0;
  }

  /**
   * How many events of `type` a run already has. Used to derive a deterministic
   * idempotency key for a repeatable event: a second transition into the same
   * state later is a real event, whereas calling the same transition twice is not.
   */
  countEvents(runId: string, type: WorkEventType): number {
    const row = this.db.get<{ total: number }>(
      'SELECT COUNT(*) AS total FROM work_events WHERE run_id = ? AND type = ?',
      runId,
      type,
    );
    return row?.total ?? 0;
  }

  // ── Checkpoints ──

  /**
   * Write a checkpoint and demote the previous one. Only the newest checkpoint of
   * a run is `is_latest`, so resume never has to guess which of several to trust.
   */
  saveCheckpoint(input: SaveCheckpointInput): WorkCheckpoint {
    return this.db.transaction(() => {
      const run = this.requireRun(input.runId);
      const now = nowIso();
      this.db.run(
        'UPDATE work_checkpoints SET is_latest = 0, updated_at = ? WHERE run_id = ? AND is_latest = 1',
        now,
        input.runId,
      );
      this.db.run(
        `INSERT INTO work_checkpoints (
           id, run_id, workspace_id, label, event_seq, run_state, cursor, is_latest,
           schema_version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           label = excluded.label,
           event_seq = excluded.event_seq,
           run_state = excluded.run_state,
           cursor = excluded.cursor,
           is_latest = 1,
           updated_at = excluded.updated_at`,
        input.id,
        input.runId,
        run.workspaceId,
        clampText(input.label, MAX_LABEL),
        this.lastRunSeq(input.runId),
        input.runState,
        encodePayload(input.cursor),
        PERSONAL_OFFICE_SCHEMA_VERSION,
        now,
        now,
      );
      const checkpoint = this.getCheckpoint(input.id);
      if (!checkpoint) throw new Error(`Failed to save checkpoint ${input.id}`);
      return checkpoint;
    });
  }

  getCheckpoint(id: string): WorkCheckpoint | null {
    const row = this.db.get<CheckpointRow>('SELECT * FROM work_checkpoints WHERE id = ?', id);
    return row ? mapCheckpoint(row) : null;
  }

  latestCheckpoint(runId: string): WorkCheckpoint | null {
    const row = this.db.get<CheckpointRow>(
      `SELECT * FROM work_checkpoints
        WHERE run_id = ?
        ORDER BY is_latest DESC, event_seq DESC, created_at DESC
        LIMIT 1`,
      runId,
    );
    return row ? mapCheckpoint(row) : null;
  }

  listCheckpoints(runId: string): WorkCheckpoint[] {
    return this.db
      .all<CheckpointRow>(
        'SELECT * FROM work_checkpoints WHERE run_id = ? ORDER BY created_at ASC',
        runId,
      )
      .map(mapCheckpoint);
  }
}

function isFinishedStepStatus(status: WorkStepStatus): boolean {
  return status === 'done' || status === 'error' || status === 'skipped';
}

// ── Row mappers ────────────────────────────────────────────────────────────

function mapWorkspace(row: WorkspaceRow): Workspace {
  assertRowSchemaVersion('workspaces', row.id, row.schema_version);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    ...(row.external_ref ? { externalRef: row.external_ref } : {}),
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapContextSnapshot(row: ContextSnapshotRow): WorkContextSnapshot {
  assertRowSchemaVersion('context_snapshots', row.id, row.schema_version);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ...(row.run_id ? { runId: row.run_id } : {}),
    contentHash: row.content_hash,
    source: row.source,
    ...(row.summary ? { summary: row.summary } : {}),
    ...(row.ref ? { ref: row.ref } : {}),
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRun(row: RunRow): WorkRun {
  assertRowSchemaVersion('work_runs', row.id, row.schema_version);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    title: row.title,
    brief: row.brief,
    state: row.state,
    origin: row.origin,
    ...(row.origin_ref ? { originRef: row.origin_ref } : {}),
    planVersion: row.plan_version,
    planHash: row.plan_hash,
    ...(row.context_snapshot_id ? { contextSnapshotId: row.context_snapshot_id } : {}),
    ...(row.parent_run_id ? { parentRunId: row.parent_run_id } : {}),
    rootRunId: row.root_run_id,
    lineageKind: row.lineage_kind,
    attempt: row.attempt,
    ...(row.last_error ? { lastError: row.last_error } : {}),
    // Additive fields (W0-authorised, optional). Absent stays absent: an unset
    // reason is a truthful "not known", never a fabricated one.
    ...(row.paused_reason ? { pausedReason: row.paused_reason } : {}),
    ...(row.canceled_reason ? { canceledReason: row.canceled_reason } : {}),
    ...(row.archived_at ? { archivedAt: row.archived_at } : {}),
    ...(row.legacy_status_raw ? { legacyStatusRaw: row.legacy_status_raw } : {}),
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.ended_at ? { endedAt: row.ended_at } : {}),
  };
}

function mapStep(row: StepRow): WorkStep {
  assertRowSchemaVersion('work_steps', row.id, row.schema_version);
  return {
    id: row.id,
    runId: row.run_id,
    workspaceId: row.workspace_id,
    seq: row.seq,
    key: row.key,
    kind: row.kind,
    label: row.label,
    ...(row.detail ? { detail: row.detail } : {}),
    status: row.status,
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.ended_at ? { endedAt: row.ended_at } : {}),
  };
}

function mapArtifact(row: ArtifactRow): WorkArtifact {
  assertRowSchemaVersion('work_artifacts', row.id, row.schema_version);
  return {
    id: row.id,
    runId: row.run_id,
    workspaceId: row.workspace_id,
    ...(row.step_id ? { stepId: row.step_id } : {}),
    name: row.name,
    kind: row.kind,
    mediaType: row.media_type,
    version: row.version,
    sha256: row.sha256,
    sizeBytes: row.size_bytes,
    ...(row.body === null ? {} : { body: row.body }),
    ...(row.external_path ? { externalPath: row.external_path } : {}),
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapApproval(row: ApprovalRow): WorkApproval {
  assertRowSchemaVersion('work_approvals', row.id, row.schema_version);
  const binding: WorkActionBinding = {
    target: row.action_target,
    input: decodeJson<unknown>(row.action_input, null),
    artifactId: toArtifactIdOrNull(row.artifact_id),
    artifactVersion: row.artifact_version,
    estimatedSideEffect: row.estimated_side_effect,
    idempotencyKey: row.idempotency_key,
    expiresAt: row.expires_at,
    planHash: row.plan_hash,
    contextSnapshotId: toContextSnapshotIdOrNull(row.context_snapshot_id),
  };
  return {
    id: row.id,
    runId: row.run_id,
    workspaceId: row.workspace_id,
    ...(row.step_id ? { stepId: row.step_id } : {}),
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    risk: row.risk,
    status: row.status,
    actionHash: row.action_hash,
    binding,
    ...(row.preview ? { preview: row.preview } : {}),
    expiresAt: row.expires_at,
    ...(row.decided_at ? { decidedAt: row.decided_at } : {}),
    ...(row.decided_by ? { decidedBy: row.decided_by } : {}),
    ...(row.decision_note ? { decisionNote: row.decision_note } : {}),
    ...(row.edited_input ? { editedInput: decodeJson<unknown>(row.edited_input, null) } : {}),
    ...(row.receipt_digest ? { receiptDigest: row.receipt_digest } : {}),
    ...(row.invalid_reason ? { invalidReason: row.invalid_reason } : {}),
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: EventRow): WorkEvent {
  assertRowSchemaVersion('work_events', row.id, row.schema_version);
  return {
    seq: row.seq,
    id: row.id,
    runId: row.run_id,
    workspaceId: row.workspace_id,
    runSeq: row.run_seq,
    type: row.type,
    payloadVersion: row.payload_version,
    payload: decodeJson<unknown>(row.payload, null),
    idempotencyKey: row.idempotency_key,
    ...(row.step_id ? { stepId: row.step_id } : {}),
    ...(row.artifact_id ? { artifactId: row.artifact_id } : {}),
    ...(row.approval_id ? { approvalId: row.approval_id } : {}),
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
  };
}

function mapCheckpoint(row: CheckpointRow): WorkCheckpoint {
  assertRowSchemaVersion('work_checkpoints', row.id, row.schema_version);
  return {
    id: row.id,
    runId: row.run_id,
    workspaceId: row.workspace_id,
    label: row.label,
    eventSeq: row.event_seq,
    runState: row.run_state,
    cursor: decodeJson<WorkCheckpointCursor>(row.cursor, { consumedEventSeq: 0 }),
    isLatest: row.is_latest === 1,
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export { MAX_BODY as WORK_ARTIFACT_INLINE_LIMIT };
export type { RedactionKind };
export { redactJson };
