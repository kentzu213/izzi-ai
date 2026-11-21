import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { doneEvent, refresh } from '../standards/refresh.mjs';
import { cliAvailable } from '../standards/store-cli.mjs';
import { doorStandard } from './fixtures/door-standard.mjs';
import { realHomeLeaks, realHomeSnapshot } from './real-home-guard.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REAL_BEFORE = realHomeSnapshot();
const ENV = { ...process.env, AGENT_MATURITY_TEST: '1' };
delete ENV.AGENT_MATURITY_HOME;
const skip = !cliAvailable() && 'KnowledgeMemory CLI or bundled Python not found';
const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'am-refresh-')));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
  assert.deepEqual(realHomeLeaks(REAL_BEFORE), [], 'a test wrote into the real ~/.claude/agent-maturity');
});

const NOTE = '---\nname: run-real-tests\ndescription: Run the real test before saying done\ntype: feedback\n---\n\nPaste the exit code.\n';

let n = 0;
function setup() {
  n += 1;
  const dir = join(scratch, `r${n}`);
  const s = { store: join(dir, 'store'), vault: join(dir, 'vault'), out: join(dir, 'home', 'standards.json'), projectsDir: join(dir, 'projects'), criticStore: join(dir, 'critic'), env: ENV };
  for (const d of [s.store, s.vault, join(s.projectsDir, 'F--repo', 'memory')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(s.projectsDir, 'F--repo', 'memory', 'run-real-tests.md'), NOTE);
  return s;
}

test('refresh re-exports the active standards and imports feedback notes as candidates', { skip }, () => {
  const s = setup();
  const std = doorStandard('verify', 'Kèm lệnh test và mã thoát.', 'sess-r', s);
  const r = refresh(s);
  assert.equal(r.code, 0, JSON.stringify(r));
  assert.equal(r.export.standards, 1);
  assert.equal(r.import.feedback, 1);
  assert.equal(r.import.captured.length, 1);
  assert.equal(r.import.captured[0].state, 'candidate');
  const file = JSON.parse(readFileSync(s.out, 'utf8'));
  assert.deepEqual(file.standards.map((x) => x.id), [std.id], 'the new candidate is not exported');
  assert.ok(Date.now() - Date.parse(file.exported_at) < 60_000, 'exported_at is fresh');
});

test('refresh command line prints both summaries, exits 0 and logs its result under --log-home', { skip }, () => {
  const s = setup();
  const logHome = mkdtempSync(join(tmpdir(), 'am-refresh-log-'));
  const r = spawnSync(process.execPath, [join(ROOT, 'standards', 'refresh.mjs'), '--store', s.store, '--vault', s.vault, '--out', s.out, '--projects-dir', s.projectsDir, '--critic-store', s.criticStore, '--log-home', logHome], {
    encoding: 'utf8', env: ENV, timeout: 120_000,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.export.standards, 0);
  assert.equal(out.import.captured.length, 1);
  assert.ok(existsSync(s.out));
  const log = readFileSync(join(logHome, 'log', `events-${new Date().toISOString().slice(0, 7)}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(log.length, 1);
  const { ts, ...rest } = log[0];
  assert.ok(Date.parse(ts) > 0);
  assert.deepEqual(rest, { type: 'refresh_done', code: 0, standards: 0, export_error: null, captured: 1, failed: 0, import_error: null });
  rmSync(logHome, { recursive: true, force: true });
});

test('the refresh_done event carries counts and error codes, never paths or note text', () => {
  const result = {
    code: 1,
    export: { error: 'cli_unavailable' },
    import: { scanned: 'C:/Users/x/.claude/projects', feedback: 2, captured: [{ file: 'C:/secret/note.md', id: 'a', state: 'candidate' }], failed: [{ file: 'C:/b.md', error: 'x' }], unreadable: [] },
  };
  const e = doneEvent(result, new Date('2026-11-21T00:00:00Z'));
  assert.deepEqual(e, { ts: '2026-11-21T00:00:00.000Z', type: 'refresh_done', code: 1, standards: null, export_error: 'cli_unavailable', captured: 1, failed: 1, import_error: null });
  assert.ok(!JSON.stringify(e).includes('C:/'));
});

test('refresh reports a refused store as an error with exit code 1 and writes nothing', () => {
  const s = setup();
  const r = refresh({ projectsDir: s.projectsDir, env: ENV });
  assert.equal(r.code, 1);
  assert.equal(r.export.error, 'refuse_real_store');
  assert.equal(r.import.error, 'refuse_real_store');
});
