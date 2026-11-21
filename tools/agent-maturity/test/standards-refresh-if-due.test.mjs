import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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
  slotMarker,
} from '../standards/refresh-if-due.mjs';
import { realHomeLeaks, realHomeSnapshot } from './real-home-guard.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LAUNCHER = join(ROOT, 'standards', 'refresh-if-due.mjs');
const REAL_BEFORE = realHomeSnapshot();
const scratch = mkdtempSync(join(tmpdir(), 'am-refresh-due-'));
const HOUR = 3_600_000;
const NL = String.fromCharCode(10);

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
  writeFileSync(file, '{}');
  const t = new Date(Date.now() - ageMs);
  utimesSync(file, t, t);
}

// A stand-in for refresh.mjs that appends its arguments, one line per run, to ran.txt beside itself.
function stubScript(home) {
  const stub = join(home, 'stub-refresh.mjs');
  writeFileSync(stub, [
    "import { appendFileSync } from 'node:fs';",
    "appendFileSync(new URL('./ran.txt', import.meta.url), process.argv.slice(2).join(' ') + String.fromCharCode(10));",
    '',
  ].join(NL));
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

const runsIn = (home) => readFileSync(join(home, 'ran.txt'), 'utf8').trim().split(NL);
const testEnv = (home, extra = {}) => ({ AGENT_MATURITY_HOME: home, AGENT_MATURITY_TEST: '1', AGENT_MATURITY_REFRESH_SCRIPT: stubScript(home), ...extra });
function processEnv(home) {
  const env = { ...process.env, ...testEnv(home) };
  delete env.AGENT_MATURITY;
  return env;
}

test('a refresh is due when the export is missing or a day old, not when it is fresh', () => {
  const home = newHome();
  assert.equal(refreshDue(home, Date.now()), true, 'missing export');
  touch(join(home, 'standards.json'), HOUR);
  assert.equal(refreshDue(home, Date.now()), false, 'fresh export');
  touch(join(home, 'standards.json'), REFRESH_AFTER_MS + HOUR);
  assert.equal(refreshDue(home, Date.now()), true, 'old export');
});

test('a refresh claimed in this slot holds off another until the next slot', () => {
  const home = newHome();
  const now = Date.now();
  touch(join(home, 'standards.json'), REFRESH_AFTER_MS + RETRY_AFTER_MS + HOUR);
  writeFileSync(slotMarker(home, now), 'x');
  assert.equal(refreshDue(home, now), false, 'already started in this slot');
  assert.equal(refreshDue(home, now + RETRY_AFTER_MS), true, 'the earlier refresh did not update the export');
  assert.equal(refreshDue(home, now - RETRY_AFTER_MS), true, 'a marker for a later slot does not block an earlier one');
});

test('the launcher starts the refresh once, in the background, and prints nothing', async () => {
  // Arrange
  const home = newHome();
  const env = processEnv(home);

  // Act
  const r = spawnSync(process.execPath, [LAUNCHER], { input: '{"session_id":"x"}', encoding: 'utf8', env, timeout: 15_000 });

  // Assert
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  assert.ok(await waitFor(join(home, 'ran.txt')), 'the refresh ran');
  assert.deepEqual(runsIn(home), [`--log-home ${home}`], 'the refresh is told where to log its result');
  assert.ok(existsSync(slotMarker(home, Date.now())));
  assert.equal(await launchRefresh(env), 'not_due', 'a second session right after does not start another refresh');
});

test('sessions that start together launch exactly one refresh', async () => {
  // Arrange
  const home = newHome();
  const env = processEnv(home);

  // Act: six launchers at once, as when several sessions start or resume together.
  await Promise.all(Array.from({ length: 6 }, () => new Promise((resolve) => {
    spawn(process.execPath, [LAUNCHER], { env, stdio: 'ignore' }).on('exit', resolve);
  })));
  assert.ok(await waitFor(join(home, 'ran.txt')));
  await new Promise((r) => setTimeout(r, 500));

  // Assert
  assert.equal(runsIn(home).length, 1);
});

test('claiming a slot removes markers from earlier slots and the old single marker', async () => {
  const home = newHome();
  writeFileSync(join(home, START_MARKER), 'old');
  writeFileSync(join(home, `${START_MARKER}-1`), 'old');
  assert.equal(await launchRefresh(testEnv(home)), 'started');
  assert.equal(existsSync(join(home, START_MARKER)), false);
  assert.equal(existsSync(join(home, `${START_MARKER}-1`)), false);
  assert.ok(existsSync(slotMarker(home, Date.now())));
  assert.ok(await waitFor(join(home, 'ran.txt')));
});

test('the launcher logs that it started a refresh, with no session text', async () => {
  const home = newHome();
  assert.equal(await launchRefresh(testEnv(home)), 'started');
  assert.ok(await waitFor(join(home, 'ran.txt')));
  const log = readFileSync(join(home, 'log', `events-${new Date().toISOString().slice(0, 7)}.jsonl`), 'utf8').trim().split(NL).map((l) => JSON.parse(l));
  assert.deepEqual(log.map((e) => e.type), ['refresh_started']);
  assert.deepEqual(Object.keys(log[0]).sort(), ['ts', 'type']);
});

test('AGENT_MATURITY=off and enabled:false start nothing and write nothing', async () => {
  const off = newHome();
  assert.equal(await launchRefresh(testEnv(off, { AGENT_MATURITY: 'off' })), 'off');
  const disabled = newHome();
  writeFileSync(join(disabled, 'config.json'), '{"enabled": false}');
  assert.equal(await launchRefresh(testEnv(disabled)), 'off');
  for (const home of [off, disabled]) {
    assert.equal(existsSync(slotMarker(home, Date.now())), false);
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

test('a broken install (store module missing) still exits 0 with no output', () => {
  // Arrange: a copy of the launcher with no ../lib/store.mjs beside it, as in a half-finished upgrade.
  const bin = join(newHome(), 'bin');
  mkdirSync(join(bin, 'standards'), { recursive: true });
  writeFileSync(join(bin, 'standards', 'refresh-if-due.mjs'), readFileSync(LAUNCHER));
  const env = { ...process.env, AGENT_MATURITY_HOME: join(bin, '..', 'home') };
  delete env.AGENT_MATURITY;

  // Act
  const r = spawnSync(process.execPath, [join(bin, 'standards', 'refresh-if-due.mjs')], { input: '{}', encoding: 'utf8', env, timeout: 15_000 });

  // Assert
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
});
