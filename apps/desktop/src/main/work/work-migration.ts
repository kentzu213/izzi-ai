/**
 * Unified work model — versioned SQLite migration (Loop 03).
 *
 * Properties this file is responsible for:
 *
 * - **Versioned.** `work_migrations` is the ledger. Each step runs once, in
 *   order, and records when it ran. Re-running the migration is a no-op.
 * - **Idempotent.** Every DDL statement is `IF NOT EXISTS`, and the ledger check
 *   short-circuits before any of them. Running it twice on the same file must
 *   not error — that is a test, not a hope.
 * - **Rollback-safe.** Each version applies inside one transaction, so a failure
 *   mid-version leaves the file exactly as it was, with the ledger unchanged.
 * - **Additive.** No legacy table is dropped, renamed or rewritten. The legacy
 *   agent/chat/schedule tables keep working untouched; unified rows are built
 *   from them by the adapters, on purpose and separately.
 *
 * Backup/recovery: `runWorkModelMigration` calls the `backup` hook once, before
 * the first pending version is applied, and never when there is nothing to do.
 * Production wires that hook to `VACUUM INTO` (see `backupSqliteFile`), which is
 * WAL-safe and synchronous — a plain file copy of a WAL database can capture a
 * torn state.
 *
 * @module main/work/work-migration
 */
import { PERSONAL_OFFICE_SCHEMA_VERSION, DEFAULT_WORKSPACE_ID } from './work-types';
import { WorkDb, tableExists, type WorkSqliteDatabase } from './work-sqlite';

/** The version this build expects. Bump when adding a migration step below. */
export const WORK_MODEL_TARGET_VERSION = 1;

export interface WorkMigrationStep {
  version: number;
  name: string;
  up: (db: WorkDb) => void;
}

export interface WorkMigrationOptions {
  /**
   * Called once, before the first pending version is applied, with the version
   * the database is currently at. Throwing aborts the migration — a backup we
   * could not take is a reason to stop, not to continue.
   */
  backup?: (fromVersion: number, pendingVersions: number[]) => void;
}

export interface WorkMigrationResult {
  fromVersion: number;
  toVersion: number;
  applied: number[];
  backedUp: boolean;
}

/** A newer database must be opened by a build that understands its schema. */
export class UnsupportedWorkModelVersionError extends Error {
  readonly found: number;
  readonly supported: number;

  constructor(found: number, supported: number) {
    super(
      `Refusing to open work model version ${found}; this build supports up to ${supported}.`,
    );
    this.name = 'UnsupportedWorkModelVersionError';
    this.found = found;
    this.supported = supported;
  }
}

const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS work_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`;

/**
 * v1 — the whole unified model in one step.
 *
 * Shared column conventions on every table:
 *   `schema_version`  the PERSONAL_OFFICE_SCHEMA_VERSION that wrote the row
 *   `created_at` / `updated_at`  ISO-8601 UTC
 *   `workspace_id`  ownership, always present
 *   `run_id`  run ownership on everything below a run
 */
const V1_DDL = `
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('personal', 'customer', 'system')),
    external_ref TEXT,
    schema_version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS context_snapshots (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    run_id TEXT,
    content_hash TEXT NOT NULL,
    source TEXT NOT NULL,
    summary TEXT,
    ref TEXT,
    schema_version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS work_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    title TEXT NOT NULL,
    brief TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN (
      'created', 'queued', 'running', 'awaiting_approval', 'waiting_external',
      'paused', 'completed', 'failed', 'canceled'
    )),
    origin TEXT NOT NULL,
    origin_ref TEXT,
    plan_version INTEGER NOT NULL DEFAULT 1,
    plan_hash TEXT NOT NULL,
    context_snapshot_id TEXT REFERENCES context_snapshots(id),
    parent_run_id TEXT REFERENCES work_runs(id),
    root_run_id TEXT NOT NULL,
    lineage_kind TEXT NOT NULL CHECK (lineage_kind IN ('original', 'retry', 'fork')),
    attempt INTEGER NOT NULL DEFAULT 1,
    last_error TEXT,
    -- Additive fields authorised for Loop 03 by W0 (optional, never required, no
    -- schema bump). They exist so a legacy mapping never has to fabricate a
    -- state: an unknown pause cause stays NULL instead of being guessed, and an
    -- archived run keeps its original status verbatim alongside the derived one.
    paused_reason TEXT CHECK (paused_reason IS NULL OR paused_reason IN ('stuck', 'guardrail')),
    canceled_reason TEXT CHECK (
      canceled_reason IS NULL
      OR canceled_reason IN ('system_refused', 'legacy_archived_outcome_unknown')
    ),
    archived_at TEXT,
    legacy_status_raw TEXT,
    schema_version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT
  );

  CREATE TABLE IF NOT EXISTS work_steps (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES work_runs(id),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    seq INTEGER NOT NULL,
    key TEXT NOT NULL,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    detail TEXT,
    status TEXT NOT NULL CHECK (status IN (
      'pending', 'running', 'done', 'error', 'blocked', 'skipped'
    )),
    schema_version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    UNIQUE (run_id, key),
    UNIQUE (run_id, seq)
  );

  CREATE TABLE IF NOT EXISTS work_artifacts (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES work_runs(id),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    step_id TEXT REFERENCES work_steps(id),
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    media_type TEXT NOT NULL,
    version INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    body TEXT,
    external_path TEXT,
    schema_version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (run_id, name, version)
  );

  CREATE TABLE IF NOT EXISTS work_approvals (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES work_runs(id),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    step_id TEXT REFERENCES work_steps(id),
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    risk TEXT NOT NULL CHECK (risk IN ('low', 'medium', 'high')),
    status TEXT NOT NULL CHECK (status IN (
      'pending', 'approved', 'edited', 'rejected', 'expired', 'invalidated'
    )),
    action_hash TEXT NOT NULL,
    action_target TEXT NOT NULL,
    action_input TEXT NOT NULL,
    artifact_id TEXT REFERENCES work_artifacts(id),
    artifact_version INTEGER,
    estimated_side_effect TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    plan_hash TEXT NOT NULL,
    context_snapshot_id TEXT REFERENCES context_snapshots(id),
    preview TEXT,
    expires_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by TEXT,
    decision_note TEXT,
    edited_input TEXT,
    receipt_digest TEXT,
    receipt TEXT,
    invalid_reason TEXT,
    schema_version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (run_id, idempotency_key)
  );

  CREATE TABLE IF NOT EXISTS work_events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    run_id TEXT NOT NULL REFERENCES work_runs(id),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    run_seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload_version INTEGER NOT NULL,
    payload TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    step_id TEXT,
    artifact_id TEXT,
    approval_id TEXT,
    schema_version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (run_id, idempotency_key),
    UNIQUE (run_id, run_seq)
  );

  CREATE TABLE IF NOT EXISTS work_checkpoints (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES work_runs(id),
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    label TEXT NOT NULL,
    event_seq INTEGER NOT NULL,
    run_state TEXT NOT NULL,
    cursor TEXT NOT NULL,
    is_latest INTEGER NOT NULL DEFAULT 1,
    schema_version INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_work_runs_workspace_updated
    ON work_runs(workspace_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_work_runs_state ON work_runs(state);
  CREATE INDEX IF NOT EXISTS idx_work_runs_origin_ref ON work_runs(origin, origin_ref);
  CREATE INDEX IF NOT EXISTS idx_work_runs_root ON work_runs(root_run_id, attempt ASC);
  CREATE INDEX IF NOT EXISTS idx_work_steps_run_seq ON work_steps(run_id, seq ASC);
  CREATE INDEX IF NOT EXISTS idx_work_artifacts_run ON work_artifacts(run_id, name, version DESC);
  CREATE INDEX IF NOT EXISTS idx_work_approvals_run_status
    ON work_approvals(run_id, status);
  CREATE INDEX IF NOT EXISTS idx_work_approvals_pending_expiry
    ON work_approvals(status, expires_at ASC);
  CREATE INDEX IF NOT EXISTS idx_work_events_run_seq ON work_events(run_id, run_seq ASC);
  CREATE INDEX IF NOT EXISTS idx_work_events_seq ON work_events(seq ASC);
  CREATE INDEX IF NOT EXISTS idx_work_checkpoints_latest
    ON work_checkpoints(run_id, is_latest, event_seq DESC);
  CREATE INDEX IF NOT EXISTS idx_context_snapshots_hash
    ON context_snapshots(workspace_id, content_hash);
`;

/**
 * Append-only is enforced by the database, not by convention.
 *
 * A run's event log is the audit trail behind every approval receipt. If an
 * UPDATE were merely "not done anywhere in the code", the guarantee would last
 * exactly until the next contributor. `RAISE(ABORT)` makes it structural.
 *
 * Consequence, accepted deliberately: runs are never hard-deleted. There is no
 * `ON DELETE CASCADE` into `work_events`, so a `DELETE FROM work_runs` would
 * fail its foreign key. Ending a run means `canceled`, not erasure.
 */
const V1_APPEND_ONLY_TRIGGERS = `
  CREATE TRIGGER IF NOT EXISTS trg_work_events_no_update
  BEFORE UPDATE ON work_events
  BEGIN
    SELECT RAISE(ABORT, 'work_events is append-only');
  END;

  CREATE TRIGGER IF NOT EXISTS trg_work_events_no_delete
  BEFORE DELETE ON work_events
  BEGIN
    SELECT RAISE(ABORT, 'work_events is append-only');
  END;
`;

export const WORK_MIGRATION_STEPS: readonly WorkMigrationStep[] = [
  {
    version: 1,
    name: 'unified-work-model',
    up: (db) => {
      db.exec(V1_DDL);
      db.exec(V1_APPEND_ONLY_TRIGGERS);

      // Seed the local workspace so a run can always be created without first
      // resolving a tenant. Customer workspaces are added later, by adapters.
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO workspaces (id, name, kind, external_ref, schema_version, created_at, updated_at)
         VALUES (?, ?, 'personal', NULL, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        DEFAULT_WORKSPACE_ID,
        'Local workspace',
        PERSONAL_OFFICE_SCHEMA_VERSION,
        now,
        now,
      );
    },
  },
];

/** Current applied version, or 0 when the model has never been installed. */
export function readWorkModelVersion(db: WorkDb): number {
  if (!tableExists(db, 'work_migrations')) return 0;
  const row = db.get<{ version: number | null }>(
    'SELECT MAX(version) AS version FROM work_migrations',
  );
  return row?.version ?? 0;
}

/**
 * Bring the unified work model up to `WORK_MODEL_TARGET_VERSION`.
 *
 * Safe to call on every app start. When there is nothing to apply it does not
 * open a transaction and does not invoke the backup hook.
 */
export function runWorkModelMigration(
  driver: WorkSqliteDatabase,
  options: WorkMigrationOptions = {},
): WorkMigrationResult {
  const db = driver instanceof WorkDb ? driver : new WorkDb(driver);

  const fromVersion = readWorkModelVersion(db);
  if (fromVersion > WORK_MODEL_TARGET_VERSION) {
    throw new UnsupportedWorkModelVersionError(fromVersion, WORK_MODEL_TARGET_VERSION);
  }

  const pending = WORK_MIGRATION_STEPS.filter((step) => step.version > fromVersion).sort(
    (left, right) => left.version - right.version,
  );

  if (pending.length === 0) {
    return { fromVersion, toVersion: fromVersion, applied: [], backedUp: false };
  }

  let backedUp = false;
  if (options.backup) {
    // Before the first schema change, never after: a backup taken afterwards
    // documents the new shape, which is not what a recovery needs.
    options.backup(
      fromVersion,
      pending.map((step) => step.version),
    );
    backedUp = true;
  }

  const applied: number[] = [];
  for (const step of pending) {
    db.transaction(() => {
      // Create the ledger inside the same transaction as the first actual
      // schema step. This keeps the backup hook strictly before the first DDL
      // and prevents a failed migration from leaving a misleading empty ledger.
      db.exec(LEDGER_DDL);
      step.up(db);
      db.run('INSERT INTO work_migrations (version, name, applied_at) VALUES (?, ?, ?)', step.version, step.name, new Date().toISOString());
    });
    applied.push(step.version);
  }

  return {
    fromVersion,
    toVersion: readWorkModelVersion(db),
    applied,
    backedUp,
  };
}
