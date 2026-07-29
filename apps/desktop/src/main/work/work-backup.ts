/**
 * Pre-migration backup for the SQLite file.
 *
 * A migration that alters the shared `openclaw.db` is the one moment worth a
 * safety copy: if a future schema step is wrong, the user's runs, chat history
 * and settings are all in this one file. The backup is taken BEFORE the first
 * schema change, so recovery means "restore the copy", not "undo half a step".
 *
 * `VACUUM INTO` is used rather than a file copy because the database runs in WAL
 * mode: a plain copy of the `.db` can miss committed pages still in the `-wal`
 * sidecar and capture a torn state. `VACUUM INTO` writes a consistent, single
 * self-contained snapshot.
 *
 * Best-effort by contract of the caller: the migration decides whether a failed
 * backup should abort. Recovery steps are documented in
 * docs/architecture/unified-work-model-implementation.md.
 *
 * @module main/work/work-backup
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface BackupTarget {
  exec(sql: string): unknown;
}

export interface BackupResult {
  path: string;
  bytes: number;
}

/** Keep the most recent N pre-migration backups; prune older ones. */
const MAX_BACKUPS = 5;

/**
 * Write a consistent snapshot of `dbPath` next to it under `backups/`, named by
 * the version the database is migrating FROM, and prune old snapshots.
 */
export function backupSqliteFile(
  db: BackupTarget,
  dbPath: string,
  fromVersion: number,
): BackupResult {
  const dir = path.join(path.dirname(dbPath), 'backups');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.basename(dbPath, path.extname(dbPath));
  const target = path.join(dir, `${base}.pre-work-v${fromVersion}.${stamp}.db`);

  // A path with a quote cannot reach here (it is app userData), but escape defensively.
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);

  pruneOldBackups(dir, `${base}.pre-work-`);

  const bytes = fs.existsSync(target) ? fs.statSync(target).size : 0;
  return { path: target, bytes };
}

function pruneOldBackups(dir: string, prefix: string): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(dir).filter((name) => name.startsWith(prefix));
  } catch {
    return;
  }
  if (entries.length <= MAX_BACKUPS) return;

  const byAge = entries
    .map((name) => {
      const full = path.join(dir, name);
      return { full, mtime: safeMtime(full) };
    })
    .sort((a, b) => b.mtime - a.mtime);

  for (const stale of byAge.slice(MAX_BACKUPS)) {
    try {
      fs.rmSync(stale.full, { force: true });
    } catch {
      // Best-effort pruning; a leftover backup is harmless.
    }
  }
}

function safeMtime(file: string): number {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}
