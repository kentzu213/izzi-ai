/**
 * The narrow SQLite surface the unified work model needs.
 *
 * Why an interface instead of importing `better-sqlite3` directly: the app ships
 * that native module compiled for Electron's ABI, so it cannot be loaded by the
 * plain Node process that runs the tests. Both `better-sqlite3` and Node's
 * built-in `node:sqlite` satisfy this shape structurally, so production runs on
 * the Electron build while the suite runs on `node:sqlite` — same SQL, same code
 * path, no native rebuild that would break `electron .`.
 *
 * @module main/work/work-sqlite
 */

export interface WorkSqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface WorkSqliteStatement {
  run(...params: unknown[]): WorkSqliteRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

/** Structurally satisfied by both `better-sqlite3` and `node:sqlite`. */
export interface WorkSqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): WorkSqliteStatement;
}

/**
 * A database handle that owns transaction depth.
 *
 * Transactions are issued as explicit SQL rather than through
 * `better-sqlite3`'s `db.transaction()` helper, so the same code runs on
 * `node:sqlite`. `BEGIN IMMEDIATE` takes the write lock up front: two writers
 * must not both read `MAX(run_seq)` and then race to insert the same value,
 * because the per-run event ordering guarantee rests on that read.
 *
 * Nesting uses SAVEPOINTs — a repository method has to be callable standalone
 * and as part of a larger service-level unit of work, and SQLite has no nested
 * `BEGIN`.
 */
export class WorkDb {
  private depth = 0;
  private savepointCounter = 0;
  private readonly cache = new Map<string, WorkSqliteStatement>();

  constructor(private readonly driver: WorkSqliteDatabase) {}

  exec(sql: string): void {
    this.driver.exec(sql);
  }

  /** Prepared statements are cached: the hot path re-runs the same few inserts. */
  prepare(sql: string): WorkSqliteStatement {
    const cached = this.cache.get(sql);
    if (cached) return cached;
    const statement = this.driver.prepare(sql);
    this.cache.set(sql, statement);
    return statement;
  }

  run(sql: string, ...params: unknown[]): WorkSqliteRunResult {
    return this.prepare(sql).run(...params);
  }

  get<T>(sql: string, ...params: unknown[]): T | null {
    const row = this.prepare(sql).get(...params);
    return (row as T | undefined) ?? null;
  }

  all<T>(sql: string, ...params: unknown[]): T[] {
    return this.prepare(sql).all(...params) as T[];
  }

  get inTransaction(): boolean {
    return this.depth > 0;
  }

  transaction<T>(fn: () => T): T {
    if (this.depth === 0) {
      this.driver.exec('BEGIN IMMEDIATE');
      this.depth = 1;
      try {
        const result = fn();
        this.driver.exec('COMMIT');
        this.depth = 0;
        return result;
      } catch (error) {
        this.depth = 0;
        try {
          this.driver.exec('ROLLBACK');
        } catch {
          // Already unwound — surface the original error, which explains why.
        }
        throw error;
      }
    }

    const name = `work_sp_${++this.savepointCounter}`;
    this.driver.exec(`SAVEPOINT ${name}`);
    this.depth += 1;
    try {
      const result = fn();
      this.driver.exec(`RELEASE ${name}`);
      this.depth -= 1;
      return result;
    } catch (error) {
      this.depth -= 1;
      try {
        this.driver.exec(`ROLLBACK TO ${name}`);
        this.driver.exec(`RELEASE ${name}`);
      } catch {
        // Same rationale as above.
      }
      throw error;
    }
  }
}

/** Column names of a table, or an empty set when the table does not exist. */
export function tableColumns(db: WorkDb, table: string): Set<string> {
  const rows = db.all<{ name: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((row) => row.name));
}

export function tableExists(db: WorkDb, table: string): boolean {
  const row = db.get<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    table,
  );
  return row !== null;
}
