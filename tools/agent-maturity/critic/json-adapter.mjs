// Local JSON implementation of the critic store adapter, for tests and dry runs until slice D3 plugs in the
// Codex KnowledgeMemory store. The interface every adapter implements (ADAPTER_METHODS; all required):
//   saveCandidate(candidate)            store the current revision; keeps earlier revisions as history
//   loadCandidate(id) -> record | null  { candidate, previous: [...], verdicts: [...] }
//   saveVerdict(candidateId, verdict)   append one verdict record; the candidate must already be stored
//   logEvent(event)                     append a guard/audit event (critique_blocked, verdict_refused, ...)
//   listEvents(candidateId) -> [...]    the events of one candidate, oldest first (the loop guard reads them)
//   saveBrief(snapshot)                 store what brief.mjs printed, keyed by candidate id + inputFingerprint
//   loadBrief(candidateId, fp) -> snapshot | null
//   addHardReject(entry)                index a hard-REJECTed statement { statementKey, candidateId, ... }
//   findHardReject(statementKey) -> entry | null
//   withLock(fn)                        run fn holding the store's exclusive lock (re-entrant)
// Layout: <dir>/candidates/<id>.json, <dir>/briefs/<id>/<fp>.json, <dir>/hard-rejects.json, <dir>/log.jsonl,
// <dir>/.lock. Writes are atomic (temp file + rename) and every read-modify-write holds the lock.

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

function createLock(root, { lockWaitMs, lockStaleMs }) {
  const file = path.join(root, '.lock');
  let depth = 0;
  const isStale = () => {
    try {
      return Date.now() - fs.statSync(file).mtimeMs > lockStaleMs;
    } catch {
      return false;
    }
  };
  const acquire = () => {
    fs.mkdirSync(root, { recursive: true });
    const deadline = Date.now() + lockWaitMs;
    for (;;) {
      try {
        fs.writeFileSync(file, `${process.pid} ${new Date().toISOString()}\n`, { flag: 'wx' });
        return;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      if (isStale()) {
        fs.rmSync(file, { force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`critic store is locked (${file}); another write is running`);
      sleep(LOCK_POLL_MS);
    }
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
      fs.rmSync(file, { force: true });
    }
  };
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
      withLock(() => fs.appendFileSync(logFile, `${JSON.stringify(event)}\n`));
    },
    listEvents(candidateId) {
      let content;
      try {
        content = fs.readFileSync(logFile, 'utf8');
      } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
      }
      return content
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((e) => e && e.candidateId === candidateId);
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
