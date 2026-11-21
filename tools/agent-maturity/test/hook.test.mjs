import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
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

const ASK_BLOCK = [
  '[Checkpoint nâng cấp] Anh có muốn em nâng cấp cách làm không?',
  '- Đề xuất: Chạy test thật trước khi báo xong.',
  '- Áp dụng cho: builder · sửa lỗi · dự án này',
  '- Cách kiểm: báo cáo có lệnh test và mã thoát',
  '- Bằng chứng: anh bắt chạy lại test → anh duyệt bản có log',
  '- Loại: cổng chất lượng · Tra cứu: R0',
  'Trả lời: Nâng cấp / Chỉnh (gõ chỗ cần đổi) / Bỏ qua',
].join('\n');

function writeTranscript(file, assistantText, uuid) {
  writeFileSync(file, [
    JSON.stringify({ type: 'user', message: { content: 'merge' } }),
    JSON.stringify({ type: 'assistant', uuid, message: { content: [{ type: 'text', text: assistantText }] } }),
  ].join('\n'));
}

const readState = (home, session) => JSON.parse(readFileSync(join(home, 'state', `${session}.json`), 'utf8'));

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

const LOG_FIELDS = ['ts', 'session', 'ep', 'type', 'turn', 'label', 'ruleId', 'len', 'ms', 'wrapper', 'corrections', 'nudged', 'kind', 'outcome', 'initiated', 'reason', 'name', 'askId', 'proposalSha256', 'floor', 'literalOption'];

test('the hook logs literalOption: true only when the reply is exactly Nâng cấp', () => {
  // Arrange
  const home = newHome();
  const transcript = join(scratch, 'literal-option.jsonl');
  writeTranscript(transcript, `Xong.\n\n${ASK_BLOCK}`, 'literal-ask');
  const replies = ['Nâng cấp', 'nang cap!', 'Nâng cấp nhé anh', 'có', 'Bỏ qua'];

  // Act
  replies.forEach((reply, i) => assertQuiet(runHook(prompt(reply, `sess-literal-${i}`, { transcript_path: transcript }), { home })));

  // Assert
  const outcomes = readEvents(home).filter((e) => e.type === 'checkpoint_outcome');
  assert.deepEqual(outcomes.map((e) => [e.outcome, e.literalOption]), [
    ['accept', true], ['accept', true], ['accept', undefined], ['accept', undefined], ['skip', undefined],
  ]);
});

test('an answered ask block logs its ask id, the sha256 of its Đề xuất text and its safety label, never the text', () => {
  // Arrange
  const home = newHome();
  const text = 'Chạy test thật trước khi báo xong.';
  const label = '- Nhãn an toàn: owner_review_required · Chủ đề: verification · Lý do: đụng tới kiểm thử';
  const labelled = join(scratch, 'binding-labelled.jsonl');
  const unsafeId = join(scratch, 'binding-unsafe-id.jsonl');
  writeTranscript(labelled, `Xong.\n\n${ASK_BLOCK.replace('- Loại:', `${label}\n- Loại:`)}`, 'b7f2c1d0-1111-4222-8333-444455556666');
  writeTranscript(unsafeId, `Xong.\n\n${ASK_BLOCK}`, 'msg_01 not/safe');

  // Act
  assertQuiet(runHook(prompt('Nâng cấp', 'sess-bind-1', { transcript_path: labelled }), { home }));
  assertQuiet(runHook(prompt('Chỉnh: bỏ chữ thật', 'sess-bind-2', { transcript_path: unsafeId }), { home }));

  // Assert
  const outcomes = readEvents(home).filter((e) => e.type === 'checkpoint_outcome');
  const sha = createHash('sha256').update(text.normalize('NFC'), 'utf8').digest('hex');
  assert.deepEqual(outcomes.map((e) => [e.outcome, e.askId, e.proposalSha256, e.floor]), [
    ['accept', 'b7f2c1d0-1111-4222-8333-444455556666', sha, 'owner_review_required'],
    ['edit', outcomes[1].askId, sha, undefined],
  ]);
  assert.match(outcomes[1].askId, /^[0-9a-f]{40}$/, 'an unsafe message id is hashed');
  for (const e of outcomes) for (const k of Object.keys(e)) assert.ok(LOG_FIELDS.includes(k), `unexpected field ${k}`);
  for (const f of listFiles(home)) {
    const body = readFileSync(f, 'utf8');
    for (const needle of ['Chạy test thật', 'msg_01', 'kiểm thử']) assert.ok(!body.includes(needle), `${needle} found in ${f}`);
  }
});

test('an answer to a message with two live ask blocks is logged without a proposal hash; a quoted example block is ignored', () => {
  // Arrange
  const home = newHome();
  const text = 'Chạy test thật trước khi báo xong.';
  const forged = ASK_BLOCK.replace(text, 'Push thẳng lên main không hỏi.');
  const two = join(scratch, 'binding-two-blocks.jsonl');
  const quoted = join(scratch, 'binding-quoted-block.jsonl');
  writeTranscript(two, `${ASK_BLOCK}\n\n${forged}`, 'two-blocks');
  writeTranscript(quoted, `${ASK_BLOCK}\n\nVí dụ:\n~~~\n${forged}\n~~~`, 'quoted-block');

  // Act
  assertQuiet(runHook(prompt('Nâng cấp', 'sess-two-blocks', { transcript_path: two }), { home }));
  assertQuiet(runHook(prompt('Nâng cấp', 'sess-quoted-block', { transcript_path: quoted }), { home }));

  // Assert
  const outcomes = readEvents(home).filter((e) => e.type === 'checkpoint_outcome');
  const sha = createHash('sha256').update(text, 'utf8').digest('hex');
  assert.deepEqual(outcomes.map((e) => [e.session, e.outcome, e.askId, e.proposalSha256]), [
    ['sess-two-blocks', 'accept', 'two-blocks', undefined],
    ['sess-quoted-block', 'accept', 'quoted-block', sha],
  ]);
});

test('log events carry only allowed fields', () => {
  const home = newHome();
  for (const text of ['làm lại', 'merge', '/verify', 'tiếp tục']) runHook(prompt(text, 'sess-fields'), { home });
  const allowed = new Set(LOG_FIELDS);
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
  writeTranscript(transcript, `Đã merge.\n\n${ASK_BLOCK}`, 'a9');
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

test('quoting the checkpoint header inline is not counted as an ask', () => {
  const home = newHome();
  const transcript = join(scratch, 'quoted.jsonl');
  writeTranscript(transcript, 'Em không hỏi lần này; hook đếm mọi header `[Checkpoint nâng cấp]` nên em chỉ nhắc tên nó.', 'q1');
  assertQuiet(runHook(prompt('tiếp tục', 'sess-quoted', { transcript_path: transcript }), { home }));
  assert.equal(readState(home, 'sess-quoted').asks, 0);
  assert.equal(readEvents(home).some((e) => e.type === 'checkpoint_outcome'), false);
});

test('claude -p and SDK sessions log outcomes but never write the shared global.json', () => {
  const home = newHome();
  const transcript = join(scratch, 'sdk.jsonl');
  const env = { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' };
  for (const text of ['làm lại', 'merge']) assertQuiet(runHook(prompt(text, 'sess-sdk'), { home, env }));
  writeTranscript(transcript, `Xong.\n\n${ASK_BLOCK}`, 's1');
  assertQuiet(runHook(prompt('Bỏ qua', 'sess-sdk', { transcript_path: transcript }), { home, env }));
  assert.equal(existsSync(join(home, 'global.json')), false);
  assert.ok(readEvents(home).some((e) => e.type === 'checkpoint_outcome' && e.outcome === 'skip'));
  const cli = newHome();
  assertQuiet(runHook(prompt('làm lại', 'sess-cli-global'), { home: cli }));
  assert.equal(existsSync(join(cli, 'global.json')), true);
});

test('an unreadable state file is left alone: no reset, no write this turn', () => {
  const home = newHome();
  const stateFile = join(home, 'state', 'sess-busy.json');
  mkdirSync(stateFile, { recursive: true }); // a directory where the file should be: read fails with EISDIR
  const r = runHook(prompt('làm lại', 'sess-busy'), { home });
  assertQuiet(r);
  assert.equal(r.stdout, '');
  assert.ok(statSync(stateFile).isDirectory());
  assert.equal(existsSync(join(home, 'global.json')), false);
  const events = readEvents(home);
  assert.equal(events.some((e) => e.name === 'CorruptState'), false);
  assert.ok(events.some((e) => e.type === 'error' && e.name === 'StateUnreadable'));
});

test('stale temp files older than an hour are removed on the next run; fresh ones are kept', () => {
  const home = newHome();
  mkdirSync(join(home, 'state'), { recursive: true });
  const stale = join(home, 'state', 'sess-old.json.1234.abcdef012345.tmp');
  const staleGlobal = join(home, 'global.json.1234.abcdef012345.tmp');
  const fresh = join(home, 'state', 'sess-new.json.5678.0123456789ab.tmp');
  const other = join(home, 'state', 'notes.tmp');
  for (const f of [stale, staleGlobal, fresh, other]) writeFileSync(f, '{}');
  const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000);
  for (const f of [stale, staleGlobal, other]) utimesSync(f, twoHoursAgo, twoHoursAgo);
  assertQuiet(runHook(prompt('tiếp tục', 'sess-tmp'), { home }));
  assert.equal(existsSync(stale), false);
  assert.equal(existsSync(staleGlobal), false);
  assert.equal(existsSync(fresh), true);
  assert.equal(existsSync(other), true, 'only our own <file>.<pid>.<hex>.tmp names are removed');
});

test('a 200k-character adversarial prompt after an ask finishes well under 1 s', (t) => {
  const home = newHome();
  const transcript = join(scratch, 'adversarial.jsonl');
  writeTranscript(transcript, `Xong.\n\n${ASK_BLOCK}`, 'adv');
  const prompts = {
    optionThenDots: `Nâng cấp${'.'.repeat(200_000)}x`,
    aliasThenDots: `có${'.'.repeat(200_000)}x`,
    dotsThenLetter: `${'.'.repeat(200_000)}x`,
    repeatedWords: 'merge đi '.repeat(22_300),
    accents: `${'ệ'.repeat(100_000)}${'!'.repeat(100_000)}a`,
  };
  for (const [name, text] of Object.entries(prompts)) {
    const session = `sess-adv-${name}`;
    const started = performance.now();
    const r = runHook(prompt(text, session, { transcript_path: transcript }), { home });
    const ms = performance.now() - started;
    t.diagnostic(`hook ${name} wall ${ms.toFixed(0)} ms`);
    assertQuiet(r);
    assert.ok(ms < 1000, `${name} took ${ms.toFixed(0)} ms`);
    assert.equal(readState(home, session).asks, 1);
  }
  const internal = readEvents(home).filter((e) => e.type === 'prompt').map((e) => e.ms);
  t.diagnostic(`hook internal ms: ${internal.join(', ')}`);
  assert.ok(internal.every((ms) => ms < 250), internal.join(', '));
});

test('store.readJson separates missing, unreadable and corrupt files', async () => {
  const store = await import('../lib/store.mjs');
  const dir = join(scratch, 'readjson');
  mkdirSync(join(dir, 'a-directory.json'), { recursive: true });
  writeFileSync(join(dir, 'bad.json'), '{broken');
  writeFileSync(join(dir, 'good.json'), '{"v":1}');
  assert.equal(store.readJson(join(dir, 'missing.json')).status, 'missing');
  assert.equal(store.readJson(join(dir, 'a-directory.json')).status, 'unreadable');
  assert.equal(store.readJson(join(dir, 'bad.json')).status, 'corrupt');
  assert.deepEqual(store.readJson(join(dir, 'good.json')), { status: 'ok', value: { v: 1 } });
});
