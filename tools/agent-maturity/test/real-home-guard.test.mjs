import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { realHomeLeaks, realHomeSnapshot } from './real-home-guard.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'am-guard-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const REAL_SESSION = '0b7c3f52-6a1e-4f0e-9d2a-3c5b8e1f7a90';
let counter = 0;
function liveHome() {
  counter += 1;
  const home = join(scratch, `home-${counter}`);
  mkdirSync(join(home, 'state'), { recursive: true });
  mkdirSync(join(home, 'log'), { recursive: true });
  mkdirSync(join(home, 'bin'), { recursive: true });
  writeFileSync(join(home, 'bin', 'hook.mjs'), 'x');
  writeFileSync(join(home, 'state', `${REAL_SESSION}.json`), '{}');
  writeFileSync(join(home, 'log', 'events-2026-11.jsonl'), `${JSON.stringify({ ts: 't', session: REAL_SESSION, type: 'milestone' })}\n`);
  return home;
}

test('what live sessions write is not a leak', () => {
  // Arrange
  const home = liveHome();
  writeFileSync(join(home, '.refresh-started-1'), 'old');
  mkdirSync(join(home, 'critic'));
  writeFileSync(join(home, 'critic', 'verdicts.json'), '[]');
  const before = realHomeSnapshot(home);

  // Act: a live session adds state, a log line and a new export, rewrites the global counters, claims the next
  // refresh slot, and a live checkpoint records a verdict.
  writeFileSync(join(home, 'state', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.json'), '{}');
  writeFileSync(join(home, 'log', 'events-2026-11.jsonl'), `${JSON.stringify({ ts: 't', session: null, type: 'refresh_started' })}\n`, { flag: 'a' });
  writeFileSync(join(home, 'standards.json'), '{}');
  writeFileSync(join(home, 'global.json'), '{}');
  writeFileSync(join(home, '.refresh-started-2'), '2026-11-21T00:00:00.000Z');
  rmSync(join(home, '.refresh-started-1'));
  writeFileSync(join(home, 'critic', 'verdicts.json'), '[{"v":1}]');

  // Assert
  assert.deepEqual(realHomeLeaks(before, home), []);
});

test('test traces in the live paths are found', () => {
  const home = liveHome();
  const before = realHomeSnapshot(home);
  writeFileSync(join(home, 'state', 'sess-1.json'), '{}');
  writeFileSync(join(home, 'log', 'events-2026-11.jsonl'), `${JSON.stringify({ ts: 't', session: 's1', type: 'milestone' })}\n`, { flag: 'a' });
  writeFileSync(join(home, 'log', 'events-2026-12.jsonl'), 'prompt with sk-test-abc\n');
  assert.deepEqual(realHomeLeaks(before, home).sort(), [
    'log/events-2026-11.jsonl: event for a non-session id',
    'log/events-2026-12.jsonl: sk-test-',
    'state for a non-session id: state/sess-1.json',
  ]);
});

test('a changed or new file outside the live paths is found', () => {
  const home = liveHome();
  const before = realHomeSnapshot(home);
  writeFileSync(join(home, 'bin', 'hook.mjs'), 'changed');
  writeFileSync(join(home, 'install-manifest.json'), '{}');
  assert.deepEqual(realHomeLeaks(before, home), ['changed bin/hook.mjs', 'created install-manifest.json']);
});

test('a home that appears during the run is a leak; one that never existed is not', () => {
  const missing = join(scratch, 'never');
  assert.deepEqual(realHomeLeaks(realHomeSnapshot(missing), missing), []);
  const before = realHomeSnapshot(missing);
  mkdirSync(missing);
  writeFileSync(join(missing, 'config.json'), '{}');
  assert.deepEqual(realHomeLeaks(before, missing), ['created config.json']);
});
