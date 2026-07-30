import { describe, expect, it } from 'vitest';
import { ensureSqliteSchema } from '../db/sqlite-schema';
import { WorkDb, tableExists } from './work-sqlite';
import {
  readWorkModelVersion,
  runWorkModelMigration,
  UnsupportedWorkModelVersionError,
  WORK_MODEL_TARGET_VERSION,
} from './work-migration';
import { createNodeSqliteDatabase } from './test-support';

/** A better-sqlite3-shaped adapter is what ensureSqliteSchema expects (db.exec/prepare). */
function legacyDb(db: ReturnType<typeof createNodeSqliteDatabase>['db']) {
  return db as unknown as import('better-sqlite3').Database;
}

describe('work-model migration', () => {
  it('installs the unified tables on a fresh database', () => {
    const { db, close } = createNodeSqliteDatabase();
    try {
      const result = runWorkModelMigration(db);
      expect(result.fromVersion).toBe(0);
      expect(result.toVersion).toBe(WORK_MODEL_TARGET_VERSION);
      expect(result.applied).toEqual([1]);

      const work = new WorkDb(db);
      for (const table of [
        'workspaces',
        'work_runs',
        'work_steps',
        'work_artifacts',
        'work_approvals',
        'work_events',
        'work_checkpoints',
        'context_snapshots',
      ]) {
        expect(tableExists(work, table)).toBe(true);
      }
    } finally {
      close();
    }
  });

  it('migrates an existing legacy DB without touching legacy tables', () => {
    const { db, close } = createNodeSqliteDatabase();
    try {
      // Stand up the legacy schema and put a row in a legacy table.
      ensureSqliteSchema(legacyDb(db));
      const work = new WorkDb(db);
      work.run(
        `INSERT INTO agent_tasks (id, title, status, created_at, updated_at)
         VALUES ('t1', 'legacy task', 'todo', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')`,
      );

      runWorkModelMigration(db);

      // Legacy row survives untouched.
      const row = work.get<{ id: string; title: string }>(
        "SELECT id, title FROM agent_tasks WHERE id = 't1'",
      );
      expect(row).toEqual({ id: 't1', title: 'legacy task' });
      // Unified tables now exist alongside.
      expect(tableExists(work, 'work_runs')).toBe(true);
    } finally {
      close();
    }
  });

  it('is idempotent — running twice applies nothing the second time', () => {
    const { db, close } = createNodeSqliteDatabase();
    try {
      const first = runWorkModelMigration(db);
      const second = runWorkModelMigration(db);
      expect(first.applied).toEqual([1]);
      expect(second.applied).toEqual([]);
      expect(second.fromVersion).toBe(WORK_MODEL_TARGET_VERSION);
      expect(second.toVersion).toBe(WORK_MODEL_TARGET_VERSION);

      const work = new WorkDb(db);
      expect(readWorkModelVersion(work)).toBe(WORK_MODEL_TARGET_VERSION);
      // The seeded local workspace is present exactly once.
      const count = work.get<{ n: number }>("SELECT COUNT(*) AS n FROM workspaces WHERE id = 'personal'");
      expect(count?.n).toBe(1);
    } finally {
      close();
    }
  });

  it('runs the backup hook once, only when there is pending work', () => {
    const { db, close } = createNodeSqliteDatabase();
    try {
      let calls = 0;
      const first = runWorkModelMigration(db, { backup: () => (calls += 1) });
      expect(first.backedUp).toBe(true);
      expect(calls).toBe(1);

      const second = runWorkModelMigration(db, { backup: () => (calls += 1) });
      expect(second.backedUp).toBe(false);
      expect(calls).toBe(1);
    } finally {
      close();
    }
  });

  it('takes the backup before creating the migration ledger or unified tables', () => {
    const { db, close } = createNodeSqliteDatabase();
    try {
      const work = new WorkDb(db);
      let observedBeforeDdl = false;
      runWorkModelMigration(db, {
        backup: () => {
          observedBeforeDdl =
            !tableExists(work, 'work_migrations') && !tableExists(work, 'work_runs');
        },
      });
      expect(observedBeforeDdl).toBe(true);
      expect(tableExists(work, 'work_migrations')).toBe(true);
      expect(tableExists(work, 'work_runs')).toBe(true);
    } finally {
      close();
    }
  });

  it('fails closed when the database was written by a newer work-model version', () => {
    const { db, close } = createNodeSqliteDatabase();
    try {
      runWorkModelMigration(db);
      const work = new WorkDb(db);
      work.run(
        'INSERT INTO work_migrations (version, name, applied_at) VALUES (?, ?, ?)',
        WORK_MODEL_TARGET_VERSION + 1,
        'future-shape',
        new Date().toISOString(),
      );

      let backupCalls = 0;
      expect(() =>
        runWorkModelMigration(db, { backup: () => (backupCalls += 1) }),
      ).toThrow(UnsupportedWorkModelVersionError);
      expect(backupCalls).toBe(0);
    } finally {
      close();
    }
  });

  it('enforces append-only on work_events at the database level', () => {
    const { db, close } = createNodeSqliteDatabase();
    try {
      runWorkModelMigration(db);
      const work = new WorkDb(db);
      const now = new Date().toISOString();
      work.run(
        `INSERT INTO work_runs (id, workspace_id, title, brief, state, origin, plan_version, plan_hash, root_run_id, lineage_kind, attempt, schema_version, created_at, updated_at)
         VALUES ('r1','personal','t','b','created','manual',1,'h','r1','original',1,1,?,?)`,
        now,
        now,
      );
      work.run(
        `INSERT INTO work_events (id, run_id, workspace_id, run_seq, type, payload_version, payload, idempotency_key, schema_version, created_at)
         VALUES ('e1','r1','personal',1,'run.created',1,'{}','k1',1,?)`,
        now,
      );

      expect(() => work.run("UPDATE work_events SET payload = '{}' WHERE id = 'e1'")).toThrow(
        /append-only/,
      );
      expect(() => work.run("DELETE FROM work_events WHERE id = 'e1'")).toThrow(/append-only/);
    } finally {
      close();
    }
  });
});
