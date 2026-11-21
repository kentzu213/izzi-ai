// Local JSON implementation of the critic store adapter, for tests and dry runs until slice D3 plugs in the
// Codex KnowledgeMemory store. The interface every adapter implements:
//   saveCandidate(candidate)            store the current revision; keeps earlier revisions as history
//   loadCandidate(id) -> record | null  { candidate, previous: [...], verdicts: [...] }
//   saveVerdict(candidateId, verdict)   append one verdict record; the candidate must already be stored
//   logEvent(event)                     optional: append a guard/audit event
// Layout: <dir>/candidates/<id>.json and <dir>/log.jsonl. Writes are atomic (temp file + rename).

import fs from 'node:fs';
import path from 'node:path';

import { readJson, writeJsonAtomic } from '../lib/store.mjs';
import { ID_RE } from './candidate.mjs';

const RECORD_SCHEMA = 'agent-maturity/critic-record@1';

export function createJsonAdapter(dir) {
  if (typeof dir !== 'string' || dir === '') throw new Error('json adapter needs a store directory');
  const root = path.resolve(dir);
  const fileFor = (id) => {
    if (typeof id !== 'string' || !ID_RE.test(id)) throw new Error(`invalid candidate id: ${JSON.stringify(id)}`);
    return path.join(root, 'candidates', `${id}.json`);
  };
  const read = (id) => {
    const r = readJson(fileFor(id));
    if (r.status === 'missing') return null;
    if (r.status !== 'ok') throw new Error(`critic record for ${id} is ${r.status}; not overwriting it`);
    return r.value;
  };

  return {
    loadCandidate(id) {
      const record = read(id);
      return record ? { candidate: record.candidate, previous: record.previous ?? [], verdicts: record.verdicts ?? [] } : null;
    },
    saveCandidate(candidate) {
      const id = candidate?.id;
      const record = read(id);
      const previous = record ? [...(record.previous ?? [])] : [];
      if (record && JSON.stringify(record.candidate) !== JSON.stringify(candidate)) previous.push(record.candidate);
      writeJsonAtomic(fileFor(id), {
        schema: RECORD_SCHEMA,
        candidate,
        previous,
        verdicts: record ? record.verdicts ?? [] : [],
      });
    },
    saveVerdict(candidateId, verdict) {
      const record = read(candidateId);
      if (!record) throw new Error(`no stored candidate ${candidateId}; save the candidate first`);
      writeJsonAtomic(fileFor(candidateId), { ...record, verdicts: [...(record.verdicts ?? []), verdict] });
    },
    logEvent(event) {
      fs.mkdirSync(root, { recursive: true });
      fs.appendFileSync(path.join(root, 'log.jsonl'), `${JSON.stringify(event)}\n`);
    },
  };
}
