/**
 * Execution-core types (Loop 03) — the persistence shapes beneath W1's contract.
 *
 * PQ-08 two-layer ruling: `shared/personal-office/**` (W1) is the contract of
 * record; this module is the execution core BENEATH it. The dependency direction
 * is one-way and enforced here — this file imports from W1 and never the reverse,
 * and it deliberately re-declares nothing W1 already owns:
 *
 *   from W1 (authority)          | here (engine plane)
 *   -----------------------------|------------------------------------------
 *   schema version              | per-event payload version
 *   run state + legal transitions| SQL row shapes (columns, seq, digests)
 *   canonical JSON + action hash | event log / checkpoint / snapshot rows
 *   origin + lineage vocabulary  | step + approval execution status
 *
 * The superseded quarantine model is NOT landed as a second contract. Its four
 * reconcile-upward items (canonicalJson, action-hash binding, lineage kind,
 * run origin) already exist in W1's contract and are imported from there.
 *
 * Gate PO-VERSION-COLLISION: there is exactly ONE version authority for anything
 * persisted — W1's `PERSONAL_OFFICE_SCHEMA_VERSION`. The quarantine draft's
 * engine-local schema constant is RETIRED, not renumbered, so no persisted row
 * can ever be ambiguous about which shape wrote it.
 *
 * @module main/work/work-types
 */

import {
  PERSONAL_OFFICE_SCHEMA_VERSION,
  RUN_TRANSITIONS,
  asId,
  assertSchemaVersion,
  canonicalActionPayload as poCanonicalActionPayload,
  canonicalJson as poCanonicalJson,
  canonicalPlanPayload as poCanonicalPlanPayload,
  canTransitionRun,
  isTerminal,
  type ApprovalActionBinding,
  type ArtifactId,
  type ContextSnapshotId,
  type DataClassification,
  type RunCanceledReason,
  type RunPauseReason,
  type RunState,
  type WorkRunLineageKind as PoWorkRunLineageKind,
  type WorkRunOrigin as PoWorkRunOrigin,
} from '../../shared/personal-office';

// ── Version authority (gate PO-VERSION-COLLISION) ──────────────────────────

/**
 * The ONE version stamped on every persisted row is W1's
 * `PERSONAL_OFFICE_SCHEMA_VERSION`, imported above and re-exported below. The
 * engine deliberately declares no version constant of its own — that is what
 * gate PO-VERSION-COLLISION forbids.
 */

/**
 * Per-event payload version. Distinct from the contract's `schemaVersion` on
 * purpose: an event payload's shape can change without the contract changing.
 * Engine-plane only — W1's `WorkEvent` does not model it.
 */
export const WORK_EVENT_PAYLOAD_VERSION = 1;

/** The workspace every locally-originated run belongs to. Matches Loop 02's id. */
export const DEFAULT_WORKSPACE_ID = 'personal';

// ── Re-exports from the contract of record ─────────────────────────────────
// Engine code imports these THROUGH this seam so the one-way dependency stays
// visible in one place instead of being spread across the execution core.

export {
  PERSONAL_OFFICE_SCHEMA_VERSION,
  poCanonicalJson as canonicalJson,
  poCanonicalPlanPayload as canonicalPlanPayload,
};
export type { DataClassification, RunCanceledReason, RunPauseReason };

/** Run lifecycle. W1 owns the vocabulary AND the legal transitions. */
export type WorkRunState = RunState;
export type WorkRunOrigin = PoWorkRunOrigin;
export type WorkRunLineageKind = PoWorkRunLineageKind;

/** The immutable binding an approval covers — W1's shape, hashed by W1's helper. */
export type WorkActionBinding = ApprovalActionBinding;

/** The exact byte string an action hash is computed over (W1 authority). */
export function canonicalActionPayload(binding: WorkActionBinding): string {
  return poCanonicalActionPayload(binding);
}

/**
 * W1 brands its identifiers (compile-time only, plain strings at runtime), while
 * a SQLite row hands back a bare `string | null`. These two helpers are the ONLY
 * sanctioned place the engine re-attaches a brand when reading a row back, so the
 * cast is auditable in one spot instead of scattered through the repository.
 */
/**
 * Guard every row read back out of SQLite through W1's version choke point.
 *
 * A stored row is untrusted input: the file on disk may have been written by a
 * different build, hand-edited, or restored from an older backup. Mapping such a
 * row into a typed object without checking its stamp is how a foreign shape gets
 * laundered into the engine — the exact failure gate PO-VERSION-COLLISION exists
 * to prevent. `assertSchemaVersion` throws rather than coercing, so a mismatch
 * fails closed at the read boundary instead of surfacing later as corrupt state.
 *
 * @param table  table name, included in the thrown message for diagnosis
 * @param rowId  primary key of the offending row, so it can be found
 * @param schemaVersion  the `schema_version` column value as stored
 */
export function assertRowSchemaVersion(
  table: string,
  rowId: string,
  schemaVersion: number,
): void {
  try {
    assertSchemaVersion({ schemaVersion });
  } catch {
    throw new WorkRowSchemaVersionError(table, rowId, schemaVersion);
  }
}

/** Thrown when a persisted row carries a schema version this build cannot read. */
export class WorkRowSchemaVersionError extends Error {
  readonly table: string;
  readonly rowId: string;
  readonly found: unknown;

  constructor(table: string, rowId: string, found: unknown) {
    super(
      `Refusing to read ${table} row ${rowId}: schema_version ${String(found)} is not ` +
        `${PERSONAL_OFFICE_SCHEMA_VERSION}. The row was written by a different ` +
        'contract version; migrate it forward instead of reading it as-is.',
    );
    this.name = 'WorkRowSchemaVersionError';
    this.table = table;
    this.rowId = rowId;
    this.found = found;
  }
}

export function toArtifactIdOrNull(raw: string | null): ArtifactId | null {
  return raw === null ? null : asId<'ArtifactId'>(raw);
}

export function toContextSnapshotIdOrNull(raw: string | null): ContextSnapshotId | null {
  return raw === null ? null : asId<'ContextSnapshotId'>(raw);
}

export const WORK_RUN_STATES: readonly WorkRunState[] = Object.freeze([
  'created',
  'queued',
  'running',
  'awaiting_approval',
  'waiting_external',
  'paused',
  'completed',
  'failed',
  'canceled',
]);

export const TERMINAL_WORK_RUN_STATES: readonly WorkRunState[] = Object.freeze([
  'completed',
  'failed',
  'canceled',
]);

export function isWorkRunState(value: unknown): value is WorkRunState {
  return typeof value === 'string' && (WORK_RUN_STATES as readonly string[]).includes(value);
}

/** Terminal per W1's table (a state with no outgoing edge), not a local list. */
export function isTerminalWorkRunState(state: WorkRunState): boolean {
  return isTerminal(RUN_TRANSITIONS, state);
}

/** Legality is decided by W1's transition table — the engine never forks it. */
export function canTransition(from: WorkRunState, to: WorkRunState): boolean {
  return canTransitionRun(from, to);
}

/**
 * Engine-plane error type. Carries `from`/`to` for the repository's error path;
 * legality itself is still W1's decision (see `canTransition`).
 */
export class InvalidWorkTransitionError extends Error {
  readonly from: WorkRunState;
  readonly to: WorkRunState;

  constructor(from: WorkRunState, to: WorkRunState) {
    super(`Invalid run transition: ${from} -> ${to}`);
    this.name = 'InvalidWorkTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function assertTransition(from: WorkRunState, to: WorkRunState): void {
  if (!canTransition(from, to)) throw new InvalidWorkTransitionError(from, to);
}

// ── Workspace row ──────────────────────────────────────────────────────────

export type WorkspaceKind = 'personal' | 'customer' | 'system';

export interface Workspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  /** Opaque pointer to the owning tenant (e.g. a Customer Marketing workspace id). */
  externalRef?: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

// ── Run row ────────────────────────────────────────────────────────────────

export interface WorkRun {
  id: string;
  workspaceId: string;
  title: string;
  /** The redacted brief the run was created from. */
  brief: string;
  state: WorkRunState;
  origin: WorkRunOrigin;
  /** Identifier of the legacy record this run mirrors, when adapted. */
  originRef?: string;
  /** Incremented whenever the plan changes; invalidates approvals bound to an older plan. */
  planVersion: number;
  /** Hash of the current plan. An approval carrying a different hash is stale. */
  planHash: string;
  contextSnapshotId?: string;
  parentRunId?: string;
  /** The first run in this lineage — stable across any depth of retry/fork. */
  rootRunId: string;
  lineageKind: WorkRunLineageKind;
  attempt: number;
  lastError?: string;
  /**
   * Additive fields authorised for Loop 03 by W0 (optional, never required, no
   * schema bump). They exist so a legacy mapping never has to fabricate a state.
   */
  pausedReason?: RunPauseReason;
  canceledReason?: RunCanceledReason;
  archivedAt?: string;
  legacyStatusRaw?: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
}

// ── Step row ───────────────────────────────────────────────────────────────

export type WorkStepKind = 'plan' | 'tool' | 'progress' | 'approval' | 'artifact';

/**
 * Execution status of a step as the engine records it. Richer than the
 * contract's four-value `WorkStepStatus` because the engine must distinguish a
 * failure from a block and a skip from a completion; the IPC layer projects it
 * down to the contract vocabulary at the boundary (see work-dto.ts).
 */
export type WorkStepStatus = 'pending' | 'running' | 'done' | 'error' | 'blocked' | 'skipped';

export interface WorkStep {
  id: string;
  runId: string;
  workspaceId: string;
  /** Order within the run. Assigned by the repository, never by the caller. */
  seq: number;
  /**
   * Caller-stable key (a tool call id, a plan index). Unique per run, so a
   * retried emit updates the same step instead of duplicating it.
   */
  key: string;
  kind: WorkStepKind;
  label: string;
  detail?: string;
  status: WorkStepStatus;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  endedAt?: string;
}

// ── Artifact row ───────────────────────────────────────────────────────────

export type WorkArtifactKind =
  | 'text'
  | 'json'
  | 'plan'
  | 'document_draft'
  | 'media'
  | 'receipt'
  | 'report'
  | 'manifest';

export interface WorkArtifact {
  id: string;
  runId: string;
  workspaceId: string;
  stepId?: string;
  /** Logical name; `(runId, name, version)` is unique. */
  name: string;
  kind: WorkArtifactKind;
  mediaType: string;
  /**
   * 1-based, auto-incremented per `(runId, name)`. This is the source for
   * `WorkActionBinding.artifactVersion`, which W1's contract references but does
   * not itself define a source for.
   */
  version: number;
  /** sha256 of the stored (already redacted) body. Content provenance. */
  sha256: string;
  sizeBytes: number;
  /** Inline body when small; absent when the payload lives outside the DB. */
  body?: string;
  /** Least persistence: a pointer instead of a copy, for large/binary output. */
  externalPath?: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

// ── Approval row ───────────────────────────────────────────────────────────

export type WorkApprovalKind =
  | 'host_action'
  | 'external_publish'
  | 'spend'
  | 'strategy'
  | 'media_render'
  | 'data_write';

export type WorkApprovalRisk = 'low' | 'medium' | 'high';

/**
 * Execution status of an approval. `edited` and `invalidated` are engine-plane
 * outcomes the contract's `ApprovalState` does not model; the IPC layer projects
 * them onto contract states (`edited` → approved + a re-minted replacement,
 * `invalidated` → withdrawn + `invalidReason`) so no contract state is invented.
 */
export type WorkApprovalStatus =
  | 'pending'
  | 'approved'
  | 'edited'
  | 'rejected'
  | 'expired'
  | 'invalidated';

export type WorkApprovalDecision = 'approve' | 'edit' | 'reject';

export type WorkApprovalInvalidReason =
  | 'expired'
  | 'plan-changed'
  | 'artifact-changed'
  | 'context-changed'
  | 'binding-tampered';

export interface WorkApproval {
  id: string;
  runId: string;
  workspaceId: string;
  stepId?: string;
  kind: WorkApprovalKind;
  title: string;
  summary: string;
  risk: WorkApprovalRisk;
  status: WorkApprovalStatus;
  /** sha256 over the canonical `WorkActionBinding`. */
  actionHash: string;
  binding: WorkActionBinding;
  /** Redacted preview of the effect (e.g. the post body that would go out). */
  preview?: string;
  expiresAt: string;
  decidedAt?: string;
  /** Opaque reviewer reference — never an email or a raw user id. */
  decidedBy?: string;
  decisionNote?: string;
  /** Present for `edited`: the reviewer's replacement input, redacted. */
  editedInput?: unknown;
  /** sha256 of the decision receipt; the audit anchor. */
  receiptDigest?: string;
  invalidReason?: WorkApprovalInvalidReason;
  /** Set when an `edit` re-minted this approval as a new one. */
  supersededByApprovalId?: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

/** Receipt written on every decided approval — the thing an audit reads. */
export interface WorkApprovalReceipt {
  approvalId: string;
  runId: string;
  decision: WorkApprovalDecision;
  status: WorkApprovalStatus;
  /** The hash that was actually decided (differs from the proposal on `edit`). */
  decidedActionHash: string;
  proposedActionHash: string;
  decidedBy: string;
  decidedAt: string;
  /** Loop 03 never performs the effect during a decision. */
  externalActionPerformed: false;
  payloadVersion: number;
}

// ── Event log row ──────────────────────────────────────────────────────────

export type WorkEventType =
  | 'run.created'
  | 'run.state_changed'
  | 'run.plan_updated'
  | 'run.error'
  | 'run.forked'
  | 'run.resumed'
  | 'run.migrated'
  | 'step.upserted'
  | 'output.delta'
  | 'artifact.created'
  | 'approval.requested'
  | 'approval.decided'
  | 'approval.invalidated'
  | 'checkpoint.saved';

export const WORK_EVENT_TYPES: readonly WorkEventType[] = Object.freeze([
  'run.created',
  'run.state_changed',
  'run.plan_updated',
  'run.error',
  'run.forked',
  'run.resumed',
  'run.migrated',
  'step.upserted',
  'output.delta',
  'artifact.created',
  'approval.requested',
  'approval.decided',
  'approval.invalidated',
  'checkpoint.saved',
]);

export function isWorkEventType(value: unknown): value is WorkEventType {
  return typeof value === 'string' && (WORK_EVENT_TYPES as readonly string[]).includes(value);
}

export interface WorkEvent {
  /**
   * Global monotonic cursor across all runs — the live stream position. Reuses
   * the `offline_queue` precedent (AUTOINCREMENT), so it may gap on rollback.
   */
  seq: number;
  id: string;
  runId: string;
  workspaceId: string;
  /**
   * Monotonic within the run and GAPLESS — the per-run ordering guarantee the
   * contract's `isWellOrdered` asserts. Computed as MAX+1 inside the write
   * transaction so a rolled-back append never consumes a position.
   */
  runSeq: number;
  type: WorkEventType;
  payloadVersion: number;
  /** Already redacted when written. */
  payload: unknown;
  idempotencyKey: string;
  stepId?: string;
  artifactId?: string;
  approvalId?: string;
  schemaVersion: number;
  createdAt: string;
}

// ── Checkpoint row ─────────────────────────────────────────────────────────

/**
 * A resume cursor that names *work*, not a provider session. It deliberately
 * holds no model id, no conversation handle and no API cursor: after an app
 * restart the run must be resumable even if the provider is gone or swapped.
 */
export interface WorkCheckpointCursor {
  /** `key` of the next step to execute; absent when the plan is exhausted. */
  nextStepKey?: string;
  /** Approval the run is blocked on, if any. */
  pendingApprovalId?: string;
  /** Event cursor the executor had consumed. */
  consumedEventSeq: number;
  /** Free-form, redacted executor bookkeeping (never credentials). */
  scratch?: Record<string, unknown>;
}

export interface WorkCheckpoint {
  id: string;
  runId: string;
  workspaceId: string;
  label: string;
  /** Global event seq at capture time. */
  eventSeq: number;
  /** State to restore the run to on resume. */
  runState: WorkRunState;
  cursor: WorkCheckpointCursor;
  isLatest: boolean;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

// ── Context snapshot row ───────────────────────────────────────────────────

/**
 * A reference to the context a run was compiled against. Loop 03 stores the
 * *reference and hash only* — building context is explicitly out of scope, and
 * copying it here would duplicate customer data for no benefit.
 */
export interface WorkContextSnapshot {
  id: string;
  workspaceId: string;
  runId?: string;
  /** Hash of the upstream context. A different hash invalidates open approvals. */
  contentHash: string;
  source: string;
  /** Redacted one-line description. */
  summary?: string;
  /** Pointer to where the real context lives. */
  ref?: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}
