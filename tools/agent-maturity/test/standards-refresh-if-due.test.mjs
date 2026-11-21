import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  REFRESH_AFTER_MS,
  RETRY_AFTER_MS,
  START_MARKER,
  launchRefresh,
  refreshDue,
  refreshScript,
} from '../standards/refresh-if-due.mjs';
import { realHomeLeaks, realHomeSnapshot } from './real-home-guard.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LAUNCHER = join(ROOT, 'standards', 'refresh-if-due.mjs');
const REAL_BEFORE = realHomeSnapshot();
const scratch = mkdtempSync(join(tmpdir(), 'am-refresh-due-'));
const HOUR = 3_600_000;

after(() => {
  rmSync(scratch, { recursive: true, force: true });
  assert.deepEqual(realHomeLeaks(REAL_BEFORE), [], 'a test wrote into the real ~/.claude/agent-maturity');
});

let counter = 0;
function newHome() {
  counter += 1;
  const home = join(scratch, `home-${counter}`);
  mkdirSync(home, { recursive: true });
  return home;
}

function touch(file, ageMs) {
  writeFileSync(file, '{}\n');
  const t = new Date(Date.now() - ageMs);
  utimesSync(file, t, t);
}

// A stand-in for refresh.mjs that only records that it ran.
function stubScript(home) {
  const stub = join(home, 'stub-refresh.mjs');
  writeFileSync(stub, "import { writeFileSync } from 'node:fs';\nwriteFileSync(new URL('./ran.txt', import.meta.url), 'ran');\n");
  return stub;
}

async function waitFor(file, ms = 10_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (existsSync(file)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

const testEnv = (home, extra = {}) => ({ AGENT_MATURITY_HOME: home, AGENT_MATURITY_TEST: '1', AGENT_MATURITY_REFRESH_SCRIPT: stubScript(home), ...extra });

test('a refresh is due when the export is missing or a day old, not when it is fresh', () => {
  const home = newHome();
  assert.equal(refreshDue(home, Date.now()), true, 'missing export');
  touch(join(home, 'standards.json'), HOUR);
  assert.equal(refreshDue(home, Date.now()), false, 'fresh export');
  touch(join(home, 'standards.json'), REFRESH_AFTER_MS + HOUR);
  assert.equal(refreshDue(home, Date.now()), true, 'old export');
});

test('a recent start marker holds off a second refresh until RETRY_AFTER_MS passes', () => {
  const home = newHome();
  touch(join(home, 'standards.json'), REFRESH_AFTER_MS + HOUR);
  touch(join(home, START_MARKER), HOUR);
  assert.equal(refreshDue(home, Date.now()), false, 'refresh started an hour ago');
  touch(join(home, START_MARKER), RETRY_AFTER_MS + HOUR);
  assert.equal(refreshDue(home, Date.now()), true, 'the earlier refresh did not update the export');
  touch(join(home, START_MARKER), -2 * HOUR);
  assert.equal(refreshDue(home, Date.now()), true, 'a marker from the future does not block forever');
});

test('the launcher starts the refresh once, in the background, and prints nothing', async () => {
  // Arrange
  const home = newHome();
  const env = { ...process.env, ...testEnv(home) };
  delete env.AGENT_MATURITY;

  // Act
  const r = spawnSync(process.execPath, [LAUNCHER], { input: '{"session_id":"x"}', encoding: 'utf8', env, timeout: 15_000 });

  // Assert
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.ok(await waitFor(join(home, 'ran.txt')), 'the refresh ran');
  assert.ok(existsSync(join(home, START_MARKER)));
  assert.equal(launchRefresh(env), 'not_due', 'a second session right after does not start another refresh');
});

test('the launcher logs that it started a refresh, with no session text', async () => {
  const home = newHome();
  assert.equal(launchRefresh(testEnv(home)), 'started');
  assert.ok(await waitFor(join(home, 'ran.txt')));
  const log = readFileSync(join(home, 'log', `events-${new Date().toISOString().slice(0, 7)}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(log.map((e) => e.type), ['refresh_started']);
  assert.deepEqual(Object.keys(log[0]).sort(), ['ts', 'type']);
});

test('AGENT_MATURITY=off and enabled:false start nothing and write nothing', () => {
  const off = newHome();
  assert.equal(launchRefresh(testEnv(off, { AGENT_MATURITY: 'off' })), 'off');
  const disabled = newHome();
  writeFileSync(join(disabled, 'config.json'), '{"enabled": false}');
  assert.equal(launchRefresh(testEnv(disabled)), 'off');
  for (const home of [off, disabled]) {
    assert.equal(existsSync(join(home, START_MARKER)), false);
    assert.equal(existsSync(join(home, 'ran.txt')), false);
  }
});

test('the refresh script can only be swapped for a stub under AGENT_MATURITY_TEST=1', () => {
  const real = join(ROOT, 'standards', 'refresh.mjs');
  assert.equal(refreshScript({ AGENT_MATURITY_REFRESH_SCRIPT: 'C:/x/evil.mjs' }), real);
  assert.equal(refreshScript({ AGENT_MATURITY_TEST: '1', AGENT_MATURITY_REFRESH_SCRIPT: 'C:/x/stub.mjs' }), 'C:/x/stub.mjs');
  assert.equal(refreshScript({}), real);
});

test('an unwritable home exits 0 with no output', () => {
  const file = join(newHome(), 'not-a-dir');
  writeFileSync(file, 'x');
  const env = { ...process.env, AGENT_MATURITY_HOME: file, AGENT_MATURITY_TEST: '1', AGENT_MATURITY_REFRESH_SCRIPT: join(scratch, 'none.mjs') };
  delete env.AGENT_MATURITY;
  const r = spawnSync(process.execPath, [LAUNCHER], { input: '{}', encoding: 'utf8', env, timeout: 15_000 });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});
