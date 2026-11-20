import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HOOK = join(ROOT, 'hooks', 'prompt-signal.mjs');
const REAL_MATURITY_HOME = join(homedir(), '.claude', 'agent-maturity');
const scratch = mkdtempSync(join(tmpdir(), 'am-hook-'));
const fakeUserHome = join(scratch, 'user-home');
mkdirSync(fakeUserHome);

after(() => {
  rmSync(scratch, { recursive: true, force: true });
  assert.equal(existsSync(REAL_MATURITY_HOME), false, 'real ~/.claude/agent-maturity must not exist');
});

let homeCounter = 0;
function newHome() {
  homeCounter += 1;
  return join(scratch, `home-${homeCounter}`);
}

function runHook(input, { home, env = {} } = {}) {
  const baseEnv = { ...process.env };
  delete baseEnv.AGENT_MATURITY;
  delete baseEnv.CLAUDE_CODE_ENTRYPOINT;
  const result = spawnSync(process.execPath, [HOOK], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    timeout: 15_000,
    env: {
      ...baseEnv,
      HOME: fakeUserHome,
      USERPROFILE: fakeUserHome,
      AGENT_MATURITY_TEST: '1',
      AGENT_MATURITY_HOME: home,
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      ...env,
    },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const prompt = (text, session, extra = {}) => ({ prompt: text, session_id: session, cwd: scratch, hook_event_name: 'UserPromptSubmit', ...extra });

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true }).map((p) => join(dir, String(p))).filter((p) => statSync(p).isFile());
}

function readEvents(home) {
  const logDir = join(home, 'log');
  return listFiles(logDir).flatMap((f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
}

function assertQuiet(r) {
  assert.equal(r.code, 0);
  assert.equal(r.stderr, '');
}

test('a completion signal after a correction prints the UserPromptSubmit context shape', () => {
  const home = newHome();
  const first = runHook(prompt('làm lại phần header', 'sess-shape'), { home });
  assertQuiet(first);
  assert.equal(first.stdout, '');
  const second = runHook(prompt('merge', 'sess-shape'), { home });
  assertQuiet(second);
  const out = JSON.parse(second.stdout);
  assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.equal(typeof out.hookSpecificOutput.additionalContext, 'string');
  assert.ok(out.hookSpecificOutput.additionalContext.length <= 700);
  assert.ok(!out.hookSpecificOutput.additionalContext.includes('làm lại'));
});

test('broken stdin exits 0 with empty stdout', () => {
  const r = runHook('{not json', { home: newHome() });
  assertQuiet(r);
  assert.equal(r.stdout, '');
});

test('an unwritable home (a file) exits 0 with empty stdout', () => {
  const home = join(scratch, 'home-is-a-file');
  writeFileSync(home, 'x');
  for (const text of ['làm lại', 'merge']) {
    const r = runHook(prompt(text, 'sess-file'), { home });
    assertQuiet(r);
    assert.equal(r.stdout, '');
  }
});

test('a 1 MB prompt exits 0', () => {
  const r = runHook(prompt('a'.repeat(1024 * 1024), 'sess-big'), { home: newHome() });
  assertQuiet(r);
  assert.equal(r.stdout, '');
});

test('no prompt text, key or phone number is stored anywhere', () => {
  const home = newHome();
  const transcript = join(scratch, 'secret-transcript.jsonl');
  writeFileSync(transcript, `${JSON.stringify({ type: 'assistant', uuid: 'z', message: { content: [{ type: 'text', text: '[Checkpoint nâng cấp] sk-test-abc123XYZ' }] } })}\n`);
  const texts = ['sai rồi sk-test-abc123XYZ', 'làm lại, gọi 0912345678', 'merge sk-test-abc123XYZ', 'ok 0912345678', 'Nâng cấp 0912345678'];
  for (const text of texts) {
    assertQuiet(runHook(prompt(text, 'sess-secret', { transcript_path: transcript }), { home }));
  }
  const files = listFiles(home);
  assert.ok(files.length > 0, 'hook should have written state and log');
  for (const f of files) {
    const body = readFileSync(f, 'utf8');
    for (const needle of ['sk-test', '0912345678', 'làm lại', 'Nâng cấp']) assert.ok(!body.includes(needle), `${needle} found in ${f}`);
  }
});

test('log events carry only allowed fields', () => {
  const home = newHome();
  for (const text of ['làm lại', 'merge', '/verify', 'tiếp tục']) runHook(prompt(text, 'sess-fields'), { home });
  const allowed = new Set(['ts', 'session', 'ep', 'type', 'turn', 'label', 'ruleId', 'len', 'ms', 'wrapper', 'corrections', 'nudged', 'kind', 'outcome', 'initiated', 'reason', 'name']);
  const events = readEvents(home);
  assert.ok(events.length >= 6);
  for (const e of events) for (const k of Object.keys(e)) assert.ok(allowed.has(k), `unexpected field ${k}`);
  assert.ok(events.some((e) => e.type === 'prompt' && typeof e.ms === 'number'));
});

test('runtime source has no network or process-spawning code and imports only allowed modules', () => {
  const files = [
    ...readdirSync(join(ROOT, 'lib')).map((f) => join(ROOT, 'lib', f)),
    ...readdirSync(join(ROOT, 'hooks')).map((f) => join(ROOT, 'hooks', f)),
    join(ROOT, 'install.mjs'),
    join(ROOT, 'uninstall.mjs'),
  ].filter((f) => f.endsWith('.mjs'));
  assert.ok(files.length >= 7);
  const forbidden = [/\bhttps?\b/i, /['"](node:)?net['"]/, /\bfetch\s*\(/, /child_process/, /\bnode:(dgram|tls|http2|worker_threads)\b/];
  const allowedSpecifier = /^(node:(fs|path|os|crypto)|\.\.?\/.+\.mjs)$/;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const re of forbidden) assert.ok(!re.test(src), `${re} in ${f}`);
    const specifiers = [...src.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const s of specifiers) assert.match(s, allowedSpecifier, `${s} in ${f}`);
  }
});

test('AGENT_MATURITY=off exits 0 and writes nothing', () => {
  const home = newHome();
  const r = runHook(prompt('merge', 'sess-off'), { home, env: { AGENT_MATURITY: 'off' } });
  assertQuiet(r);
  assert.equal(r.stdout, '');
  assert.equal(existsSync(home), false);
});

test('config enabled=false exits 0 and writes nothing else', () => {
  const home = newHome();
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, 'config.json'), JSON.stringify({ enabled: false }));
  runHook(prompt('làm lại', 'sess-cfg'), { home });
  const r = runHook(prompt('merge', 'sess-cfg'), { home });
  assertQuiet(r);
  assert.equal(r.stdout, '');
  assert.deepEqual(listFiles(home), [join(home, 'config.json')]);
});

test('a corrupt state file is reset instead of killing the hook', () => {
  const home = newHome();
  mkdirSync(join(home, 'state'), { recursive: true });
  writeFileSync(join(home, 'state', 'sess-corrupt.json'), '{broken');
  const r = runHook(prompt('làm lại', 'sess-corrupt'), { home });
  assertQuiet(r);
  const state = JSON.parse(readFileSync(join(home, 'state', 'sess-corrupt.json'), 'utf8'));
  assert.equal(state.turn, 1);
  assert.equal(state.correctionsSinceCheckpoint, 1);
  assert.ok(readEvents(home).some((e) => e.type === 'error' && e.name === 'CorruptState'));
});

test('a checkpoint in the transcript tail is detected and the reply recorded', () => {
  const home = newHome();
  const transcript = join(scratch, 'checkpoint.jsonl');
  writeFileSync(transcript, '');
  runHook(prompt('làm lại', 'sess-ckpt', { transcript_path: transcript }), { home });
  const nudge = runHook(prompt('merge', 'sess-ckpt', { transcript_path: transcript }), { home });
  assert.ok(nudge.stdout.length > 0);
  writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { content: 'merge' } }),
    JSON.stringify({ type: 'assistant', uuid: 'a9', message: { content: [{ type: 'text', text: 'Đã merge.\n\n[Checkpoint nâng cấp] Anh có muốn em nâng cấp cách làm không?' }] } }),
  ].join('\n'));
  assertQuiet(runHook(prompt('Nâng cấp', 'sess-ckpt', { transcript_path: transcript }), { home }));
  const outcome = readEvents(home).find((e) => e.type === 'checkpoint_outcome');
  assert.equal(outcome.outcome, 'accept');
  assert.equal(outcome.initiated, 'nudge');
  const state = JSON.parse(readFileSync(join(home, 'state', 'sess-ckpt.json'), 'utf8'));
  assert.equal(state.asks, 1);
  assert.equal(state.pending, null);
});

test('an unreadable transcript path fails open', () => {
  const home = newHome();
  const r = runHook(prompt('làm lại', 'sess-badtx', { transcript_path: scratch }), { home });
  assertQuiet(r);
  const state = JSON.parse(readFileSync(join(home, 'state', 'sess-badtx.json'), 'utf8'));
  assert.equal(state.turn, 1);
});

test('wrapper and slash-command turns do not advance the turn', () => {
  const home = newHome();
  runHook(prompt('làm lại', 'sess-wrap'), { home });
  runHook(prompt('<task-notification>agent finished</task-notification>', 'sess-wrap'), { home });
  runHook(prompt('/loop 5m kiểm tra CI', 'sess-wrap'), { home });
  const state = JSON.parse(readFileSync(join(home, 'state', 'sess-wrap.json'), 'utf8'));
  assert.equal(state.turn, 1);
});

test('non-interactive entrypoints are logged but never nudged', () => {
  for (const env of [{ CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }, { CLAUDE_CODE_ENTRYPOINT: '' }]) {
    const home = newHome();
    runHook(prompt('làm lại', 'sess-ep'), { home, env });
    const r = runHook(prompt('merge', 'sess-ep'), { home, env });
    assertQuiet(r);
    assert.equal(r.stdout, '');
    assert.ok(readEvents(home).some((e) => e.type === 'milestone'));
  }
  const desktopHome = newHome();
  runHook(prompt('làm lại', 'sess-desk'), { home: desktopHome, env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' } });
  const desk = runHook(prompt('merge', 'sess-desk'), { home: desktopHome, env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop' } });
  assert.ok(desk.stdout.length > 0);
});

test('an unsafe session id is hashed for the file name and the log', () => {
  const home = newHome();
  runHook(prompt('làm lại', '../../evil id'), { home });
  const names = readdirSync(join(home, 'state'));
  assert.equal(names.length, 1);
  assert.match(names[0], /^[a-f0-9]{40}\.json$/);
  assert.ok(readEvents(home).every((e) => !String(e.session).includes('evil')));
});
