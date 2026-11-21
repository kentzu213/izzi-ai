// Test fixture: a dev standard shaped like one standards/promote-standard.mjs stores (topic dev-standard/<12 hex>,
// basis user_instruction, a user source in the door's format) with the door's standard_promoted event in a temp
// critic store, so store and export tests can exercise the store without running the whole door. rawCli is the raw
// KnowledgeMemory CLI as anyone could run it, outside the wrapper.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { createJsonAdapter } from '../../critic/json-adapter.mjs';
import { DEFAULT_CLI, DEFAULT_PYTHON, capture, promoteApproved, userSource } from '../../standards/store-cli.mjs';

// The 12 hex topic a test name stands for.
export const doorTopic = (name) => createHash('sha256').update(name).digest('hex').slice(0, 12);
export const doorCandidateId = (name) => `cand-${doorTopic(name)}`;

export function doorSource(session, candidateId, at = '2026-11-21T01:00:00Z') {
  const base = userSource(session, at);
  return { ...base, uri: `${base.uri}?candidate=${candidateId}&verdict=c1.${'0'.repeat(12)}` };
}

// The capture payload of a door-made standard; `extra` overrides fields (scope, projectPath, ...).
export const doorEntry = (name, summary, session, extra = {}) => ({
  topic: `dev-standard/${doorTopic(name)}`,
  title: `Chuẩn ${name}`,
  summary,
  source: doorSource(session, doorCandidateId(name)),
  ...extra,
});

// Captures, promotes and logs standard_promoted like the door. opts: store-cli opts with criticStore. Returns the
// active record.
export function doorStandard(name, summary, session, opts, extra = {}) {
  const rec = capture(doorEntry(name, summary, session, extra), opts);
  const active = promoteApproved(rec.id, opts);
  createJsonAdapter(opts.criticStore).logEvent({ type: 'standard_promoted', candidateId: doorCandidateId(name), recordId: rec.id });
  return active;
}

// One project-memory.py call on a temp store and vault, without the wrapper; returns its parsed JSON.
export function rawCli(args, { store, vault }) {
  const r = spawnSync(DEFAULT_PYTHON, [DEFAULT_CLI, '--store', store, '--vault', vault, ...args], {
    cwd: path.dirname(DEFAULT_CLI),
    encoding: 'utf8',
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    timeout: 60_000,
    windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`raw KnowledgeMemory CLI failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}
