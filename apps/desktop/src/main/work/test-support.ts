/**
 * Test-only SQLite harness for the unified work model.
 *
 * Production runs on `better-sqlite3` (compiled for Electron's ABI); the tests
 * run on plain Node, where that native module cannot load. Node's built-in
 * `node:sqlite` satisfies the same `WorkSqliteDatabase` shape, so the tests
 * exercise the real SQL and the real repository — only the driver differs.
 *
 * This file is imported solely from `*.test.ts`; it never ships in the app.
 *
 * @module main/work/test-support
 */
import { DatabaseSync } from 'node:sqlite';
import type { WorkSqliteDatabase, WorkSqliteStatement } from './work-sqlite';

/** Adapt a `node:sqlite` handle to the `WorkSqliteDatabase` interface. */
export function createNodeSqliteDatabase(): { db: WorkSqliteDatabase; close: () => void } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');

  const db: WorkSqliteDatabase = {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string): WorkSqliteStatement => {
      const stmt = raw.prepare(sql);
      return {
        run: (...params: unknown[]) => {
          const result = stmt.run(...(params as never[]));
          return {
            changes: Number(result.changes),
            lastInsertRowid: result.lastInsertRowid as number | bigint,
          };
        },
        get: (...params: unknown[]) => stmt.get(...(params as never[])) as unknown,
        all: (...params: unknown[]) => stmt.all(...(params as never[])) as unknown[],
      };
    },
  };

  return { db, close: () => raw.close() };
}
