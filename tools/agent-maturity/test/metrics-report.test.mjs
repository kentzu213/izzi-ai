import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifierVersion } from '../metrics/baseline.mjs';
import { realHomeLeaks, realHomeSnapshot } from './real-home-guard.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPORT = join(ROOT, 'report.mjs');
const HOOK = join(ROOT, 'hooks', 'prompt-signal.mjs');
const FIXTURES = join(ROOT, 'test', 'fixtures');
const EVENTS = join(FIXTURES, 'metrics-events.jsonl');
const BASELINE = join(FIXTURES, 'metrics-baseline.json');
function listFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true }).map((p) => join(dir, String(p))).filter((p) => statSync(p).isFile()).sort();
}
const scratch = mkdtempSync(join(tmpdir(), 'am-report-'));
const fakeUserHome = join(scratch, 'user-home');
mkdirSync(fakeUserHome);

// After D2 the real home exists and live sessions write it; these tests must leave no trace there (real-home-guard.mjs).
const REAL_BEFORE = realHomeSnapshot();

after(() => {
  rmSync(scratch, { recursive: true, force: true });
  assert.deepEqual(realHomeLeaks(REAL_BEFORE), [], 'a test wrote into the real ~/.claude/agent-maturity');
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

// The stale fixture with this checkout's classifier version: a like-for-like baseline.
const currentBaseline = join(scratch, 'baseline-current.json');
writeFileSync(currentBaseline, JSON.stringify({ ...JSON.parse(readFileSync(BASELINE, 'utf8')), classifierVersion: classifierVersion() }));

test('--events --json prints every metric for the fixture log', () => {
  const r = report(['--since', '2026-11-10', '--events', EVENTS, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const m = JSON.parse(r.stdout);
  assert.equal(m.window.since, '2026-11-10T00:00:00.000Z');
  assert.deepEqual(m.log, { files: 1, events: 49, skippedLines: 1 });
  assert.equal(m.prompts, 21);
  assert.equal(m.excluded.checkpointAnswers, 2);
  assert.equal(m.definitions, 'metrics@1');
  assert.equal(m.classifierVersion, classifierVersion());
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
  const r = report(['--since', '2026-11-10', '--events', EVENTS, '--baseline', currentBaseline]);
  assert.equal(r.code, 0, r.stderr);
  for (const part of [
    'Câu lệnh: 21',
    '2 câu trả lời checkpoint',
    'Checkpoint: nhắc 3 (mạnh 2, yếu 1)',
    'Nâng cấp 33,3%',
    'Chế độ chặt: tắt',
    'Báo động mỏi: không',
    'Mốc hoàn tất: 7',
    'Lần sửa: 5',
    '23,8 trên 100 câu',
    'Duyệt ngay lần đầu: 3/7 = 0,429',
    'ước lượng',
    'classifier (cùng thước đo): duyệt ngay lần đầu 0,429 so với 0,500 (−0,071); sửa trên 100 câu 23,8 so với 2,5 (+21,3); mở lại (ước lượng) 0,286 so với 0,125 (+0,161)',
    'gold (khác thước đo, không tính chênh lệch): duyệt ngay lần đầu 0,429 so với 0,817;',
    'Cảnh báo: nhãn vàng',
    'nhãn vàng chưa được anh xem lại',
  ]) {
    assert.ok(r.stdout.includes(part), `missing "${part}" in:\n${r.stdout}`);
  }
});

test('--baseline: classifier deltas for all three rates, gold values with no delta and a warning (JSON)', () => {
  const r = report(['--since', '2026-11-10', '--events', EVENTS, '--baseline', currentBaseline, '--json']);
  assert.equal(r.code, 0, r.stderr);
  const b = JSON.parse(r.stdout).baseline;
  assert.equal(b.comparable, true);
  assert.deepEqual(b.reasons, []);
  assert.deepEqual([b.split, b.ownerReviewed, b.definitions.baseline, b.classifierVersion.baseline], ['test', false, 'metrics@1', classifierVersion()]);
  assert.deepEqual(b.comparisons.map((c) => [c.instrument, c.likeForLike]), [['classifier', true], ['gold', false]]);
  const [classifier, gold] = b.comparisons;
  for (const key of ['firstPassRate', 'correctionsPer100', 'reopenedRate']) {
    assert.equal(typeof classifier[key].delta, 'number', key);
    assert.equal(gold[key].delta, null, key);
  }
  assert.match(gold.warning, /gold/i);
});

test('--baseline from another classifier version or definition: values shown, no delta, reason printed', () => {
  const text = report(['--since', '2026-11-10', '--events', EVENTS, '--baseline', BASELINE]);
  assert.equal(text.code, 0, text.stderr);
  assert.match(text.stdout, /KHÔNG tính chênh lệch vì khác thước đo: classifierVersion: baseline 000000000000, current [0-9a-f]{12}/);
  assert.match(text.stdout, /classifier \(cùng thước đo\): duyệt ngay lần đầu 0,429 so với 0,500; /);
  const json = JSON.parse(report(['--since', '2026-11-10', '--events', EVENTS, '--baseline', BASELINE, '--json']).stdout).baseline;
  assert.equal(json.comparable, false);
  for (const c of json.comparisons) for (const key of ['firstPassRate', 'correctionsPer100', 'reopenedRate']) assert.equal(c[key].delta, null);
  const oldDefinitions = join(scratch, 'baseline-metrics0.json');
  writeFileSync(oldDefinitions, JSON.stringify({ ...JSON.parse(readFileSync(currentBaseline, 'utf8')), definitions: 'metrics@0' }));
  const old = report(['--since', '2026-11-10', '--events', EVENTS, '--baseline', oldDefinitions]);
  assert.match(old.stdout, /KHÔNG tính chênh lệch vì khác thước đo: definitions: baseline metrics@0, current metrics@1/);
});

test('bad arguments and unreadable inputs exit 1 with a message on stderr', () => {
  const badBaseline = join(scratch, 'bad-baseline.json');
  writeFileSync(badBaseline, JSON.stringify({ ...JSON.parse(readFileSync(BASELINE, 'utf8')), instruments: { gold: { firstPassRate: 2, correctionsPer100: 1, reopenedRate: 0 } } }));
  const unversioned = join(scratch, 'unversioned-baseline.json');
  writeFileSync(unversioned, JSON.stringify({ instruments: { classifier: { firstPassRate: 0.5, correctionsPer100: 2.5 } } }));
  const cases = [
    [],
    ['--since', 'not-a-date'],
    ['--since', '2026-02-30'],
    ['--since', '2026-13-01'],
    ['--since', '2026-04-31T10:00:00+07:00'],
    ['--since', '2026-11-21T10:00:60Z'],
    ['--since', '2026-11-10', '--events', join(scratch, 'missing.jsonl')],
    ['--since', '2026-11-10', '--events', EVENTS, '--baseline', badBaseline],
    ['--since', '2026-11-10', '--events', EVENTS, '--baseline', unversioned],
    ['--since', '2026-11-10', '--events', EVENTS, '--baseline', join(scratch, 'missing.json')],
    ['--since', '2026-11-10', '--unknown'],
  ];
  for (const args of cases) {
    const r = report(args);
    assert.equal(r.code, 1, `${args.join(' ')} -> ${r.code}`);
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.length > 0);
  }
  assert.equal(report(['--since', '2024-02-29', '--events', EVENTS, '--json']).code, 0, 'a real leap day is accepted');
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
  assert.equal(m.prompts, 21);
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
  assert.equal(m.prompts, 6, 'the checkpoint answer is not an owner prompt');
  assert.equal(m.excluded.wrapperPrompts, 1);
  assert.equal(m.excluded.checkpointAnswers, 1);
  assert.deepEqual(m.corrections, { correction: 2, clarify: 1, total: 3, per100Prompts: 50 });
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
