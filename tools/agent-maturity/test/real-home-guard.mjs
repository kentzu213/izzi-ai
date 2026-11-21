// Checks that a test run left no trace in the real ~/.claude/agent-maturity. Since D2 the real home exists and live
// Claude Code sessions write it while the tests run (hook state, the event log, the daily refresh), so "the folder
// does not exist" and "its bytes did not change" no longer hold. What still holds: live sessions only write the paths
// in LIVE_PATHS, and only with real session ids (UUIDs); the tests never use a UUID-shaped session id there.
//
// Blind spots (kept small by the code, not by this guard):
// - A test that rewrites standards.json, global.json, .last-cleanup, a refresh marker or a critic/ file is not seen.
//   store-cli refuses to write the real export under AGENT_MATURITY_TEST=1; the critic CLI has no default store
//   (--store is required) and the door refuses the real critic store under AGENT_MATURITY_TEST=1.
// - The log scan covers whole files, not just this run: one old leak fails every run until that log line is removed.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const REAL_MATURITY_HOME = join(homedir(), '.claude', 'agent-maturity');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Written by the live hooks (state, log, global counters, cleanup marker, atomic-write temp files), by the daily
// refresh (standards.json, the .refresh-started-<slot> markers) and by live checkpoints (critic/).
const LIVE_PATHS = [
  /^state\//,
  /^log\//,
  /^global\.json$/,
  /^\.last-cleanup$/,
  /^standards\.json$/,
  /^\.refresh-started/,
  /^critic\//,
  /\.tmp$/,
];
const TEST_SECRET = 'sk-test-';

function readIfPresent(file) {
  try {
    return statSync(file).isFile() ? readFileSync(file) : null;
  } catch {
    return null; // removed or replaced by a live session between listing and reading
  }
}

function relFiles(home) {
  if (!existsSync(home)) return [];
  return readdirSync(home, { recursive: true }).map((p) => String(p).replace(/\\/g, '/')).sort();
}

// sha256 of every file outside LIVE_PATHS, or null when the real home does not exist.
export function realHomeSnapshot(home = REAL_MATURITY_HOME) {
  if (!existsSync(home)) return null;
  const files = {};
  for (const rel of relFiles(home)) {
    if (LIVE_PATHS.some((re) => re.test(rel))) continue;
    const bytes = readIfPresent(join(home, rel));
    if (bytes) files[rel] = createHash('sha256').update(bytes).digest('hex');
  }
  return files;
}

function changedFiles(before, now) {
  if (before === null && now === null) return [];
  if (before === null) return Object.keys(now).map((rel) => `created ${rel}`);
  if (now === null) return ['removed the real home'];
  const hits = [];
  for (const rel of new Set([...Object.keys(before), ...Object.keys(now)])) {
    if (before[rel] === now[rel]) continue;
    hits.push(`${!(rel in before) ? 'created' : rel in now ? 'changed' : 'removed'} ${rel}`);
  }
  return hits.sort();
}

function liveTraces(home) {
  const hits = [];
  for (const rel of relFiles(home)) {
    const state = rel.match(/^state\/(.+)\.json$/);
    if (state && !UUID.test(state[1])) hits.push(`state for a non-session id: ${rel}`);
    if (!/^log\/.+\.jsonl$/.test(rel)) continue;
    const text = readIfPresent(join(home, rel))?.toString('utf8') ?? '';
    if (text.includes(TEST_SECRET)) hits.push(`${rel}: ${TEST_SECRET}`);
    for (const line of text.split('\n')) {
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue; // blank or half-written last line
      }
      if (event && typeof event.session === 'string' && !UUID.test(event.session)) {
        hits.push(`${rel}: event for a non-session id`);
        break;
      }
    }
  }
  return hits;
}

// Everything a test left behind: files outside LIVE_PATHS that changed since `before` (from realHomeSnapshot() at
// module load), plus state or log entries for an id no real Claude Code session has.
export function realHomeLeaks(before, home = REAL_MATURITY_HOME) {
  return [...changedFiles(before, realHomeSnapshot(home)), ...liveTraces(home)];
}
