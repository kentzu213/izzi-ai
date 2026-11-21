// Local JSON implementation of the critic store adapter, for tests and dry runs until slice D3 plugs in the
// Codex KnowledgeMemory store. The interface every adapter implements (ADAPTER_METHODS; all required):
//   saveCandidate(candidate)            store the current revision; keeps earlier revisions as history
//   loadCandidate(id) -> record | null  { candidate, previous: [...], verdicts: [...] }
//   saveVerdict(candidateId, verdict)   append one verdict record; the candidate must already be stored
//   logEvent(event)                     append a guard/audit event (critique_blocked, verdict_refused, ...)
//   listEvents(candidateId) -> [...]    the events of one candidate, oldest first (the loop guard reads them);
//                                       one torn trailing log line (an interrupted append) is skipped
//   listBriefsForStatement(key) -> [...] the brief_generated events with this statementKey under ANY candidate id
//   listPromotionApprovals() -> [...]   the promotion_approved events of the whole store, oldest first (the promote
//                                       gate refuses one owner answer for two texts)
//   saveBrief(snapshot)                 store what brief.mjs printed, keyed by candidate id + inputFingerprint
//   loadBrief(candidateId, fp) -> snapshot | null
//   addHardReject(entry)                index a hard-REJECTed statement { statementKey, candidateId, ... }
//   findHardReject(statementKey) -> entry | null
//   withLock(fn)                        run fn holding the store's exclusive lock (re-entrant)
// Layout: <dir>/candidates/<id>.json, <dir>/briefs/<id>/<fp>.json, <dir>/hard-rejects.json, <dir>/log.jsonl,
// <dir>/.lock. Writes are atomic (temp file + rename) and every read-modify-write holds the lock; the lock file
// carries the writer's pid and a nonce, read back after creating it and checked before removing it. A stale lock is
// first renamed to a unique tombstone (atomic: one writer wins), then deleted only if it is still the stale lock.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { readJson, writeJsonAtomic } from '../lib/store.mjs';
import { ID_RE } from './candidate.mjs';
import { FINGERPRINT_RE } from './loop-guard.mjs';

const RECORD_SCHEMA = 'agent-maturity/critic-record@1';
const INDEX_SCHEMA = 'agent-maturity/critic-hard-rejects@1';
export const LOCK_WAIT_MS = 5_000;
export const LOCK_STALE_MS = 30_000;
const LOCK_POLL_MS = 25;

export const ADAPTER_METHODS = Object.freeze([
  'loadCandidate',
  'saveCandidate',
  'saveVerdict',
  'logEvent',
  'listEvents',
  'listBriefsForStatement',
  'listPromotionApprovals',
  'saveBrief',
  'loadBrief',
  'addHardReject',
  'findHardReject',
  'withLock',
]);

// The critic refuses to run on a store that cannot bind verdicts, index hard-REJECTs or lock.
export function assertAdapter(adapter) {
  const missing = ADAPTER_METHODS.filter((m) => typeof adapter?.[m] !== 'function');
  if (missing.length > 0) throw new Error(`critic store adapter is missing ${missing.join(', ')}`);
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const readOrEmpty = (file) => {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
};

const isStale = (file, staleMs) => {
  try {
    return Date.now() - fs.statSync(file).mtimeMs > staleMs;
  } catch {
    return false;
  }
};

// Removes a stale lock without a check-then-delete race: the lock file is renamed to a unique tombstone (atomic, so
// only one writer takes it), and the tombstone is deleted only if it still is the stale lock that was judged (same
// content, still stale). If another writer replaced the lock in between, its fresh lock is put back (exclusive
// copy: never over a newer lock). Returns true when the stale lock was removed.
export function clearStaleLock(file, seen, staleMs) {
  if (!isStale(file, staleMs)) return false;
  const tomb = `${file}.stale-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  try {
    fs.renameSync(file, tomb);
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
  const stillStale = readOrEmpty(tomb) === seen && isStale(tomb, staleMs);
  if (!stillStale) {
    try {
      fs.copyFileSync(tomb, file, fs.constants.COPYFILE_EXCL);
    } catch {
      // a third writer created a lock in between; theirs stands
    }
  }
  fs.rmSync(tomb, { force: true });
  return stillStale;
}

// The lock file holds "<pid> <nonce> <time>". After creating it, the writer reads it back and owns the lock only if
// its nonce is there; a stale lock goes through clearStaleLock; release removes the file only while it still holds
// this writer's nonce.
function createLock(root, { lockWaitMs, lockStaleMs }) {
  const file = path.join(root, '.lock');
  const tag = `${process.pid} ${crypto.randomBytes(8).toString('hex')} `;
  let depth = 0;
  const owns = () => readOrEmpty(file).startsWith(tag);
  const acquire = () => {
    fs.mkdirSync(root, { recursive: true });
    const deadline = Date.now() + lockWaitMs;
    for (;;) {
      try {
        fs.writeFileSync(file, `${tag}${new Date().toISOString()}\n`, { flag: 'wx' });
        if (owns()) return;
        continue;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      const seen = readOrEmpty(file);
      if (isStale(file, lockStaleMs)) {
        clearStaleLock(file, seen, lockStaleMs);
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`critic store is locked (${file}); another write is running`);
      sleep(LOCK_POLL_MS);
    }
  };
  const release = () => {
    if (owns()) fs.rmSync(file, { force: true });
  };
  return function withLock(fn) {
    if (depth > 0) {
      depth += 1;
      try {
        return fn();
      } finally {
        depth -= 1;
      }
    }
    acquire();
    depth = 1;
    try {
      return fn();
    } finally {
      depth = 0;
      release();
    }
  };
}

// A crash mid-append can leave one torn last line (no trailing newline). Readers skip it; the next append first
// cuts it off (a complete last line that only lacks its newline gets the newline instead), so a torn line never
// ends up in the middle of the log and no event is glued onto it.
function dropTornTail(logFile) {
  let buf;
  try {
    buf = fs.readFileSync(logFile);
  } catch (error) {
    if (error.code === 'ENOENT') return 0;
    throw error;
  }
  if (buf.length === 0 || buf[buf.length - 1] === 0x0a) return 0;
  const keep = buf.lastIndexOf(0x0a) + 1;
  try {
    JSON.parse(buf.subarray(keep).toString('utf8'));
    fs.appendFileSync(logFile, '\n');
    return 0;
  } catch {
    fs.truncateSync(logFile, keep);
    return buf.length - keep;
  }
}

function parseLog(content) {
  const lines = content.split('\n');
  const torn = content.endsWith('\n') ? null : lines.pop();
  const events = lines.filter(Boolean).map((line) => JSON.parse(line));
  if (torn) {
    try {
      events.push(JSON.parse(torn));
    } catch {
      // a torn trailing line from an interrupted append: skipped
    }
  }
  return events;
}

export function createJsonAdapter(dir, { lockWaitMs = LOCK_WAIT_MS, lockStaleMs = LOCK_STALE_MS } = {}) {
  if (typeof dir !== 'string' || dir === '') throw new Error('json adapter needs a store directory');
  const root = path.resolve(dir);
  const withLock = createLock(root, { lockWaitMs, lockStaleMs });
  const safeId = (id) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error(`invalid candidate id: ${JSON.stringify(id)}`);
    return id;
  };
  const fileFor = (id) => path.join(root, 'candidates', `${safeId(id)}.json`);
  const briefFile = (id, fp) => {
    if (typeof fp !== 'string' || !FINGERPRINT_RE.test(fp)) throw new Error(`invalid fingerprint: ${JSON.stringify(fp)}`);
    return path.join(root, 'briefs', safeId(id), `${fp}.json`);
  };
  const indexFile = path.join(root, 'hard-rejects.json');
  const logFile = path.join(root, 'log.jsonl');
  const readOrNull = (file, label) => {
    const r = readJson(file);
    if (r.status === 'missing') return null;
    if (r.status !== 'ok') throw new Error(`critic ${label} is ${r.status}; not overwriting it`);
    return r.value;
  };
  const read = (id) => readOrNull(fileFor(id), `record for ${id}`);
  const readIndex = () => readOrNull(indexFile, 'hard-REJECT index')?.entries ?? [];
  const readLog = () => {
    let content;
    try {
      content = fs.readFileSync(logFile, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    return parseLog(content);
  };

  return {
    withLock,
    loadCandidate(id) {
      const record = read(id);
      return record ? { candidate: record.candidate, previous: record.previous ?? [], verdicts: record.verdicts ?? [] } : null;
    },
    saveCandidate(candidate) {
      withLock(() => {
        const id = candidate?.id;
        const record = read(id);
        const previous = record ? [...(record.previous ?? [])] : [];
        if (record && JSON.stringify(record.candidate) !== JSON.stringify(candidate)) previous.push(record.candidate);
        writeJsonAtomic(fileFor(id), { schema: RECORD_SCHEMA, candidate, previous, verdicts: record ? record.verdicts ?? [] : [] });
      });
    },
    saveVerdict(candidateId, verdict) {
      withLock(() => {
        const record = read(candidateId);
        if (!record) throw new Error(`no stored candidate ${candidateId}; save the candidate first`);
        writeJsonAtomic(fileFor(candidateId), { ...record, verdicts: [...(record.verdicts ?? []), verdict] });
      });
    },
    logEvent(event) {
      withLock(() => {
        const dropped = dropTornTail(logFile);
        const repair = dropped > 0 ? `${JSON.stringify({ type: 'log_repaired', droppedBytes: dropped, at: new Date().toISOString() })}\n` : '';
        fs.appendFileSync(logFile, `${repair}${JSON.stringify(event)}\n`);
      });
    },
    listEvents(candidateId) {
      return readLog().filter((e) => e && e.candidateId === candidateId);
    },
    listBriefsForStatement(statementKey) {
      return readLog().filter((e) => e && e.type === 'brief_generated' && e.statementKey === statementKey);
    },
    listPromotionApprovals() {
      return readLog().filter((e) => e && e.type === 'promotion_approved');
    },
    saveBrief(snapshot) {
      withLock(() => writeJsonAtomic(briefFile(snapshot.candidateId, snapshot.inputFingerprint), snapshot));
    },
    loadBrief(candidateId, fp) {
      return readOrNull(briefFile(candidateId, fp), `brief snapshot for ${candidateId}`);
    },
    addHardReject(entry) {
      withLock(() => {
        const entries = readIndex();
        if (entries.some((e) => e.statementKey === entry.statementKey && e.candidateId === entry.candidateId)) return;
        writeJsonAtomic(indexFile, { schema: INDEX_SCHEMA, entries: [...entries, entry] });
      });
    },
    findHardReject(statementKey) {
      return readIndex().find((e) => e.statementKey === statementKey) ?? null;
    },
  };
}
