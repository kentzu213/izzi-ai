import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORT = join(ROOT, 'report.mjs');
const HOOK = join(ROOT, 'hooks', 'prompt-signal.mjs');
const FIXTURES = join(ROOT, 'test', 'fixtures');
const EVENTS = join(FIXTURES, 'metrics-events.jsonl');
const BASELINE = join(FIXTURES, 'metrics-baseline.json');
const REAL_MATURITY_HOME = join(homedir(), '.claude', 'agent-maturity');
const scratch = mkdtempSync(join(tmpdir(), 'am-report-'));
const fakeUserHome = join(scratch, 'user-home');
mkdirSync(fakeUserHome);

after(() => {
  rmSync(scratch, { recursive: true, force: true });
  assert.equal(existsSync(REAL_MATURITY_HOME), false, 'real ~/.claude/agent-maturity must not exist');
});

function cleanEnv(extra) {
  const env = { ...process.env, HOME: fakeUserHome, USERPROFILE: fakeUserHome, AGENT_MATURITY_TEST: '1', ...extra };
  delete env.AGENT_MATURITY;
  return env;
}

function run(file, args, { input, env = {} } = {}) {
  const r = spawnSync(process.execPath, [file, ...args], { input, encoding: 'utf8', timeout: 15_000, env: cleanEnv(env) });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const report = (args, env) => run(REPORT, args, { env });

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true }).map((p) => join(dir, String(p))).filter((p) => statSync(p).isFile()).sort();
}

test('--events --json prints every metric for the fixture log', () => {
  const r = report(['--since', '2026-11-10', '--events', EVENTS, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  assert.equal(m.window.since, '2026-11-10T00:00:00.000Z');
  assert.deepEqual(m.log, { files: 1, events: 49, skippedLines: 1 });
  assert.equal(m.prompts, 23);
  assert.equal(m.milestones, 7);
  assert.equal(m.corrections.total, 5);
  assert.equal(m.firstPass.passed, 3);
  assert.equal(m.reopened.reopened, 2);
  assert.equal(m.reopened.estimate, true);
  assert.deepEqual(m.checkpoints.outcomes, { accept: 1, edit: 0, skip: 1, ignored: 1 });
  assert.equal(m.strict.on, false);
  assert.equal(m.fatigue.alarm, false);
  assert.deepEqual(m.baseline, null);
});

test('text report names each metric and marks the reopen number as an estimate', () => {
  const r = report(['--since', '2026-11-10', '--events', EVENTS, '--baseline', BASELINE]);
  assert.equal(r.code, 0, r.stderr);
  for (const part of [
    'Câu lệnh: 23',
    'Checkpoint: nhắc 3 (mạnh 2, yếu 1)',
    'Nâng cấp 33,3%',
    'Chế độ chặt: tắt',
    'Báo động mỏi: không',
    'Mốc hoàn tất: 7',
    'Lần sửa: 5',
    '21,7 trên 100 câu',
    'Duyệt ngay lần đầu: 3/7 = 0,429',
    'ước lượng',
    'classifier (cùng thước đo)',
    'gold (khác thước đo',
  ]) {
    assert.ok(r.stdout.includes(part), `missing "${part}" in:\n${r.stdout}`);
  }
});

test('--baseline adds like-for-like comparisons to the JSON output', () => {
  const r = report(['--since', '2026-11-10', '--events', EVENTS, '--baseline', BASELINE, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  assert.match(m.baseline.source, /synthetic/);
  assert.deepEqual(m.baseline.comparisons.map((c) => [c.instrument, c.likeForLike]), [['classifier', true], ['gold', false]]);
});

test('bad arguments and unreadable inputs exit 1 with a message on stderr', () => {
  const badBaseline = join(scratch, 'bad-baseline.json');
  writeFileSync(badBaseline, JSON.stringify({ instruments: { gold: { firstPassRate: 2 } } }));
  const cases = [
    [],
    ['--since', 'not-a-date'],
    ['--since', '2026-11-10', '--events', join(scratch, 'missing.jsonl')],
    ['--since', '2026-11-10', '--events', EVENTS, '--baseline', badBaseline],
    ['--since', '2026-11-10', '--events', EVENTS, '--baseline', join(scratch, 'missing.json')],
    ['--since', '2026-11-10', '--unknown'],
  ];
  for (const args of cases) {
    const r = report(args);
    assert.equal(r.code, 1, `${args.join(' ')} -> ${r.code}`);
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.length > 0);
  }
});

test('default log comes from AGENT_MATURITY_HOME, every monthly file is read, nothing is written', () => {
  const home = join(scratch, 'home-default');
  mkdirSync(join(home, 'log'), { recursive: true });
  const lines = readFileSync(EVENTS, 'utf8').trim().split('\n');
  const cut = lines.findIndex((l) => l.includes('2026-11-11'));
  writeFileSync(join(home, 'log', 'events-2026-10.jsonl'), `${lines.slice(0, cut).join('\n')}\n`);
  writeFileSync(join(home, 'log', 'events-2026-11.jsonl'), `${lines.slice(cut).join('\n')}\n`);
  writeFileSync(join(home, 'log', 'notes.txt'), 'not a log');
  const before = listFiles(home).map((f) => [f, readFileSync(f, 'utf8')]);
  const r = report(['--since', '2026-11-10', '--json'], { AGENT_MATURITY_HOME: home });
  assert.equal(r.code, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  assert.equal(m.log.files, 2);
  assert.equal(m.prompts, 23);
  assert.equal(m.firstPass.passed, 3);
  assert.deepEqual(listFiles(home).map((f) => [f, readFileSync(f, 'utf8')]), before);
});

test('a home with no log reports zeros and creates nothing', () => {
  const home = join(scratch, 'home-empty');
  const r = report(['--since', '2026-11-10', '--json'], { AGENT_MATURITY_HOME: home });
  assert.equal(r.code, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  assert.equal(m.log.files, 0);
  assert.equal(m.prompts, 0);
  assert.equal(existsSync(home), false);
});

const ASK_BLOCK = [
  '[Checkpoint nâng cấp] Anh có muốn em nâng cấp cách làm không?',
  '- Đề xuất: một chuẩn tổng hợp cho test.',
  'Trả lời: Nâng cấp / Chỉnh (gõ chỗ cần đổi) / Bỏ qua',
].join('\n');

function writeTranscript(file, assistantText, uuid) {
  writeFileSync(file, [
    JSON.stringify({ type: 'user', message: { content: 'synthetic' } }),
    JSON.stringify({ type: 'assistant', uuid, message: { content: [{ type: 'text', text: assistantText }] } }),
  ].join('\n'));
}

test('report reads the log written by the real D1 hook', () => {
  const home = join(scratch, 'home-hook');
  const transcript = join(scratch, 'hook-transcript.jsonl');
  writeTranscript(transcript, 'Đã xong.', 'a-0');
  const send = (text) => {
    const r = run(HOOK, [], {
      input: JSON.stringify({ prompt: text, session_id: 'sess-report', transcript_path: transcript, cwd: scratch, hook_event_name: 'UserPromptSubmit' }),
      env: { AGENT_MATURITY_HOME: home, CLAUDE_CODE_ENTRYPOINT: 'cli' },
    });
    assert.equal(r.code, 0);
    return r.stdout;
  };
  send('xem giúp file log');
  send('làm lại');
  send('chưa hiểu');
  assert.match(send('merge'), /additionalContext/, 'strong nudge after two corrections');
  writeTranscript(transcript, `Đã merge.\n\n${ASK_BLOCK}`, 'a-1');
  send('bỏ qua');
  writeTranscript(transcript, 'Đã xong.', 'a-2');
  send('làm lại');
  send('/verify');
  send('ok');

  const r = report(['--since', '2000-01-01', '--json'], { AGENT_MATURITY_HOME: home });
  assert.equal(r.code, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  assert.equal(m.prompts, 7);
  assert.equal(m.excluded.wrapperPrompts, 1);
  assert.deepEqual(m.corrections, { correction: 2, clarify: 1, total: 3, per100Prompts: (3 * 100) / 7 });
  assert.equal(m.milestones, 1);
  assert.equal(m.firstPass.passed, 0);
  assert.equal(m.reopened.reopened, 1);
  assert.deepEqual(m.checkpoints.nudged, { total: 1, strong: 1, weak: 0 });
  assert.deepEqual(m.checkpoints.asked, { total: 1, afterNudge: 1, agentInitiated: 0 });
  assert.equal(m.checkpoints.outcomes.skip, 1);
  assert.equal(m.fatigue.window, 1);
});

test('report and metrics sources have no network calls and no file writes', () => {
  const sources = [REPORT, ...readdirSync(join(ROOT, 'metrics')).filter((n) => n.endsWith('.mjs')).map((n) => join(ROOT, 'metrics', n))];
  const forbidden = [/https?:/, /fetch\(/, /child_process/, /node:net/, /writeFile|appendFile|mkdir|rename|unlink|createWriteStream/];
  for (const file of sources) {
    const text = readFileSync(file, 'utf8');
    for (const pattern of forbidden) assert.equal(pattern.test(text), false, `${file} matches ${pattern}`);
  }
});
