import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkTranscripts } from '../metrics/check-repeats.mjs';
import { checkCorrection, contentTerms, DEFAULT_THRESHOLD, normalizeStandards, scorePair } from '../metrics/checker.mjs';
import { evaluatePairs, GATE, gateOf } from '../metrics/eval-checker.mjs';
import { readOwnerPrompts } from '../metrics/transcript-prompts.mjs';
import { realHomeLeaks, realHomeSnapshot } from './real-home-guard.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = join(ROOT, 'test', 'fixtures');
const PAIRS = join(FIXTURES, 'metrics-checker-pairs.json');
const TRANSCRIPT = join(FIXTURES, 'metrics-checker-transcript.jsonl');
const scratch = mkdtempSync(join(tmpdir(), 'am-checker-'));

// After D2 the real home exists and live sessions write it; these tests must leave no trace there (real-home-guard.mjs).
const REAL_BEFORE = realHomeSnapshot();

after(() => {
  rmSync(scratch, { recursive: true, force: true });
  assert.deepEqual(realHomeLeaks(REAL_BEFORE), [], 'a test wrote into the real ~/.claude/agent-maturity');
});

const pairsDoc = () => JSON.parse(readFileSync(PAIRS, 'utf8'));
const standards = () => normalizeStandards(pairsDoc().standards).standards;
const at = '2026-11-12T08:00:00Z';
// Words that appear only in synthetic prompt text; none may reach any output.
const PROMPT_WORDS = ['đăng nhập', 'mã thoát', 'gradient', 'giải thích', 'chưa được', 'màn hình'];

function run(file, args) {
  const r = spawnSync(process.execPath, [join(ROOT, 'metrics', file), ...args], { encoding: 'utf8', timeout: 15_000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('content terms: lower case, accents stripped, stop words and one-letter tokens dropped', () => {
  assert.deepEqual([...contentTerms('Sai rồi, CHẠY test đã!')].sort(), ['chay', 'test']);
  assert.deepEqual([...contentTerms('chay test')], [...contentTerms('chạy test')]);
  assert.equal(contentTerms('và là của a b').size, 0);
});

test('standards: malformed records are skipped; only active and candidate records are usable', () => {
  const { standards: kept, skipped } = normalizeStandards([
    ...pairsDoc().standards,
    { id: 'no-scope', state: 'active', title: 'x y' },
    { id: 'project-without-root', scope: 'project', state: 'active', title: 'x y' },
    { scope: 'user', state: 'active', title: 'no id' },
    'not an object',
  ]);
  assert.deepEqual(kept.map((s) => s.id), ['std-real-tests', 'std-live-sha', 'std-no-purple', 'std-ask-merge-old', 'std-commit-later']);
  assert.deepEqual(kept.filter((s) => s.usable).map((s) => s.id), ['std-real-tests', 'std-live-sha', 'std-no-purple', 'std-commit-later']);
  assert.equal(skipped, 4);
  assert.deepEqual(normalizeStandards({ standards: pairsDoc().standards }).standards.map((s) => s.id), kept.map((s) => s.id));
  assert.equal(normalizeStandards({ status: 'x' }).standards.length, 0);
  // An export of active standards may omit the state: it is usable; an unknown state is not.
  const [noState, odd] = normalizeStandards([
    { id: 'no-state', scope: 'user', title: 'chạy build sạch' },
    { id: 'odd-state', scope: 'user', state: 'draft', title: 'chạy build sạch' },
  ]).standards;
  assert.equal(noState.usable, true);
  assert.equal(odd.usable, false);
});

test('a correction that repeats a user-scope standard is found in any project, with its confidence', () => {
  const result = checkCorrection({ text: 'sai rồi, chưa chạy test mà đã báo xong', project_root: 'F:/other', at }, standards());
  assert.equal(result.repeat, true);
  assert.equal(result.standardId, 'std-real-tests');
  assert.equal(result.confidence, 1);
  assert.ok(result.sharedTerms >= 4);
  assert.equal(result.keywordHits, 1);
});

test('a project-scope standard matches only its own project or a folder inside it', () => {
  const text = 'vẫn chưa kiểm sha trước khi deploy';
  assert.equal(checkCorrection({ text, project_root: 'F:/proj-a', at }, standards()).standardId, 'std-live-sha');
  assert.equal(checkCorrection({ text, project_root: 'f:\\proj-a\\apps', at }, standards()).standardId, 'std-live-sha');
  const elsewhere = checkCorrection({ text, project_root: 'F:/proj-a-copy', at }, standards());
  assert.equal(elsewhere.repeat, false);
  assert.equal(checkCorrection({ text, at }, standards()).repeat, false, 'no project: a project standard cannot match');
});

test('a standard created after the correction, or a superseded one, is never a match', () => {
  const later = checkCorrection({ text: 'commit message phải theo conventional commits', project_root: 'F:/proj-a', at }, standards());
  assert.equal(later.repeat, false);
  const merge = standards().find((s) => s.id === 'std-ask-merge-old');
  const text = 'sao lại merge mà không hỏi';
  assert.equal(scorePair({ text, at }, merge).eligible, false);
  assert.equal(checkCorrection({ text, at }, standards()).repeat, false);
  const active = normalizeStandards([{ ...pairsDoc().standards[3], state: 'active' }]).standards[0];
  assert.equal(scorePair({ text, at }, active).eligible, true, 'eligible once active');
});

test('an unrelated correction is not a repeat; one shared word is not enough', () => {
  const result = checkCorrection({ text: 'không phải, nút đăng nhập sai màu rồi', project_root: 'F:/proj-a', at }, standards());
  assert.equal(result.repeat, false);
  assert.ok(result.confidence < DEFAULT_THRESHOLD);
});

test('a keyword phrase alone reaches the threshold; the threshold option is honoured', () => {
  const text = 'thiếu mã thoát';
  const kw = checkCorrection({ text, at }, standards());
  assert.equal(kw.standardId, 'std-real-tests');
  assert.equal(kw.keywordHits, 1);
  assert.equal(kw.sharedTerms, 1);
  assert.equal(kw.confidence, 0.5);
  assert.equal(kw.repeat, true);
  assert.equal(checkCorrection({ text, at }, standards(), { threshold: 0.75 }).repeat, false);
});

test('checker results carry ids and numbers only, never the correction text', () => {
  const result = checkCorrection({ text: 'sai rồi, chưa chạy test mà đã báo xong', at }, standards());
  assert.deepEqual(Object.keys(result).sort(), ['confidence', 'keywordHits', 'repeat', 'sharedTerms', 'standardId']);
  assert.equal(JSON.stringify(result).includes('chạy'), false);
});

test('transcript reader returns owner prompts only, in memory', async () => {
  const prompts = await readOwnerPrompts(TRANSCRIPT);
  // u-wrap starts with '<': not a typed prompt (D0 rule).
  assert.deepEqual(prompts.map((p) => p.uuid), ['u-start', 'u-corr-1', 'u-corr-2', 'u-clar', 'u-praise']);
  assert.equal(prompts[1].cwd, 'F:/proj-a');
  assert.equal(prompts[1].at, '2026-11-12T09:00:00.000Z');
});

test('checkTranscripts classifies prompts in place and checks corrections and clarifications', async () => {
  const result = await checkTranscripts({ standards: standards(), files: [TRANSCRIPT] });
  assert.equal(result.prompts, 5);
  assert.equal(result.corrections, 3);
  assert.equal(result.repeats, 2);
  assert.deepEqual(result.matches.map((m) => [m.uuid, m.label, m.repeat, m.standardId]), [
    ['u-corr-1', 'correction', true, 'std-real-tests'],
    ['u-corr-2', 'correction', false, null],
    ['u-clar', 'clarify', true, 'std-no-purple'],
  ]);
  for (const word of PROMPT_WORDS) assert.equal(JSON.stringify(result).includes(word), false, word);
});

test('check-repeats CLI prints ids and scores only and writes no file', () => {
  const dir = mkdtempSync(join(scratch, 'cli-'));
  const transcript = join(dir, 'sess-x.jsonl');
  const standardsFile = join(dir, 'standards.json');
  copyFileSync(TRANSCRIPT, transcript);
  writeFileSync(standardsFile, JSON.stringify({ standards: pairsDoc().standards }));
  const before = readdirSync(dir).sort();
  for (const args of [['--json'], []]) {
    const r = run('check-repeats.mjs', ['--standards', standardsFile, '--transcript', transcript, ...args]);
    assert.equal(r.code, 0, r.stderr);
    for (const word of PROMPT_WORDS) assert.equal(r.stdout.includes(word), false, `${word} leaked`);
    assert.ok(r.stdout.includes('u-corr-1'));
    assert.ok(r.stdout.includes('std-real-tests'));
  }
  const json = JSON.parse(run('check-repeats.mjs', ['--standards', standardsFile, '--transcript', transcript, '--json']).stdout);
  assert.equal(json.repeats, 2);
  assert.deepEqual(json.standards, { usable: 4, unusable: 1, skipped: 0, unmatchable: 0 });
  assert.deepEqual(readdirSync(dir).sort(), before);
});

test('check-repeats CLI rejects missing or bad inputs with exit 1', () => {
  const bad = join(scratch, 'bad-standards.json');
  writeFileSync(bad, '{not json');
  for (const args of [[], ['--standards', bad, '--transcript', TRANSCRIPT], ['--standards', PAIRS], ['--standards', PAIRS, '--transcript', TRANSCRIPT, '--threshold', '2']]) {
    const r = run('check-repeats.mjs', args);
    assert.equal(r.code, 1, args.join(' '));
    assert.equal(r.stdout, '');
  }
});

test('harness: precision and recall on the synthetic labelled pairs, transcript pairs read in place', async () => {
  const result = await evaluatePairs(pairsDoc(), { baseDir: FIXTURES });
  assert.equal(result.threshold, DEFAULT_THRESHOLD);
  assert.equal(result.pairs, 12);
  assert.deepEqual(result.unresolved, ['p13']);
  assert.deepEqual({ tp: result.tp, fp: result.fp, fn: result.fn, tn: result.tn }, { tp: 6, fp: 1, fn: 1, tn: 4 });
  assert.equal(result.precision, 6 / 7);
  assert.equal(result.recall, 6 / 7);
  assert.equal(result.accuracy, 10 / 12);
  const byId = Object.fromEntries(result.results.map((r) => [r.id, r]));
  assert.equal(byId.p08.predicted, true, 'deliberate false positive: shared generic UI words');
  assert.equal(byId.p09.predicted, false, 'deliberate false negative: paraphrase without shared words');
  assert.equal(byId.p05.scopeMatched, false);
  assert.equal(byId.p12.predicted, true);
  for (const word of PROMPT_WORDS) assert.equal(JSON.stringify(result).includes(word), false, word);
});

test('harness: a higher threshold trades recall for precision', async () => {
  const result = await evaluatePairs(pairsDoc(), { baseDir: FIXTURES, threshold: 0.75 });
  assert.equal(result.fn, 2, 'p07 (two shared words, confidence 0.5) is now missed');
  assert.equal(result.tp, 5);
});

test('harness: invalid pair files are rejected', async () => {
  const doc = pairsDoc();
  const bad = [
    { ...doc, version: 2 },
    { ...doc, pairs: 'x' },
    { ...doc, pairs: [{ id: 'q', standard: 'std-real-tests', correction: { text: 'x' } }] },
    { ...doc, pairs: [{ id: 'q', standard: 'std-real-tests', repeat: true, correction: {} }] },
    { ...doc, pairs: [{ standard: 'std-real-tests', repeat: true, correction: { text: 'x' } }] },
  ];
  for (const value of bad) await assert.rejects(() => evaluatePairs(value, { baseDir: FIXTURES }), /pair/i);
});

test('harness: a pair naming an unknown standard is unresolved, not scored', async () => {
  const doc = pairsDoc();
  const result = await evaluatePairs({ ...doc, pairs: [{ id: 'q1', standard: 'nope', repeat: true, correction: { text: 'x y', at } }] }, { baseDir: FIXTURES });
  assert.equal(result.pairs, 0);
  assert.deepEqual(result.unresolved, ['q1']);
  assert.equal(result.precision, null);
});

test('eval-checker CLI prints precision, recall and pair ids without prompt text', () => {
  for (const args of [['--json'], []]) {
    const r = run('eval-checker.mjs', ['--pairs', PAIRS, ...args]);
    assert.equal(r.code, 0, r.stderr);
    for (const word of PROMPT_WORDS) assert.equal(r.stdout.includes(word), false, `${word} leaked`);
    assert.ok(r.stdout.includes('p08'));
  }
  const json = JSON.parse(run('eval-checker.mjs', ['--pairs', PAIRS, '--json']).stdout);
  assert.equal(json.precision, 6 / 7);
  assert.equal(run('eval-checker.mjs', []).code, 1);
  assert.equal(run('eval-checker.mjs', ['--pairs', join(scratch, 'missing.json')]).code, 1);
});

// ---- part-2 gate (PLAN D5): >=30 pairs, >=10 predicted repeats, >=10 distinct corrections, CP 95% lower bound >= 0.8

const failed = (gate) => gate.checks.filter((c) => !c.passed).map((c) => c.name);

test('gate passes at 17/17 predicted repeats (lower bound 0.805) and fails at 16/16 (0.794)', () => {
  const pass = gateOf({ pairs: 30, tp: 17, fp: 0, distinctCorrections: 10 });
  assert.equal(pass.passed, true);
  assert.ok(pass.ci.lower >= 0.8 && pass.ci.lower < 0.81, String(pass.ci.lower));
  const fail = gateOf({ pairs: 30, tp: 16, fp: 0, distinctCorrections: 10 });
  assert.equal(fail.passed, false);
  assert.deepEqual(failed(fail), ['precisionLowerBound']);
  assert.ok(fail.ci.lower > 0.79 && fail.ci.lower < 0.8, String(fail.ci.lower));
});

test('gate with false positives: 29/30 passes (0.828), 28/30 fails (0.779) although precision is 0.93', () => {
  assert.equal(gateOf({ pairs: 40, tp: 29, fp: 1, distinctCorrections: 30 }).passed, true);
  const fail = gateOf({ pairs: 40, tp: 28, fp: 2, distinctCorrections: 30 });
  assert.deepEqual(failed(fail), ['precisionLowerBound']);
});

test('gate needs >=30 labelled pairs, >=10 predicted repeats and >=10 distinct corrections', () => {
  assert.deepEqual(failed(gateOf({ pairs: 29, tp: 17, fp: 0, distinctCorrections: 10 })), ['pairs']);
  assert.deepEqual(failed(gateOf({ pairs: 30, tp: 17, fp: 0, distinctCorrections: 9 })), ['distinctCorrections']);
  const few = gateOf({ pairs: 30, tp: 9, fp: 0, distinctCorrections: 10 });
  assert.ok(failed(few).includes('predictedRepeats'));
  assert.deepEqual(few.checks.find((c) => c.name === 'predictedRepeats'), { name: 'predictedRepeats', value: 9, min: 10, passed: false });
  const none = gateOf({ pairs: 30, tp: 0, fp: 0, distinctCorrections: 10 });
  assert.equal(none.ci, null);
  assert.ok(failed(none).includes('precisionLowerBound'));
  assert.deepEqual(GATE, { minPairs: 30, minPredictedRepeats: 10, minDistinctCorrections: 10, minPrecisionLowerBound: 0.8, confidence: 0.95 });
});

test('harness gate on the synthetic pairs: too few pairs and predicted repeats; distinct corrections counted', async () => {
  const result = await evaluatePairs(pairsDoc(), { baseDir: FIXTURES });
  assert.equal(result.distinctCorrections, 12);
  assert.equal(result.gate.passed, false);
  assert.deepEqual(failed(result.gate), ['pairs', 'predictedRepeats', 'precisionLowerBound']);
  // The same correction scored against two standards is one distinct correction.
  const doc = pairsDoc();
  const twice = { ...doc, pairs: [doc.pairs[0], { ...doc.pairs[2], correction: doc.pairs[0].correction }, doc.pairs[11], { ...doc.pairs[11], id: 'p12b', standard: 'std-no-purple', repeat: false }] };
  assert.equal((await evaluatePairs(twice, { baseDir: FIXTURES })).distinctCorrections, 2);
});

// ---- project scope (PLAN §2.5): worktrees count as the root project

const STARIZZI = '2a906db6-a103-5375-b672-ad090f686c7e';
const scopeStandards = () => normalizeStandards([
  { id: 'std-by-id', scope: 'project', project_id: STARIZZI, state: 'active', created_at: '2026-11-01T00:00:00Z', keywords: ['kiểm sha'] },
  { id: 'std-by-wt-root', scope: 'project', project_root: 'F:/Ai Tools/_wt-izzi-v2-d3', state: 'active', created_at: '2026-11-01T00:00:00Z', keywords: ['bản live'] },
  { id: 'std-unknown-id', scope: 'project', project_id: 'not-a-known-project', state: 'active', created_at: '2026-11-01T00:00:00Z', keywords: ['mã thoát'] },
]);

test('a project_id-only standard matches corrections in the root project and in its _wt- worktrees', () => {
  const { standards: list } = scopeStandards();
  const text = 'vẫn chưa kiểm sha';
  for (const cwd of ['F:/Ai Tools/Tool Starizzi - B2C - Openclaw', 'f:\\ai tools\\tool starizzi - b2c - openclaw\\apps', 'F:\\Ai Tools\\_wt-izzi-v2-d5', 'F:/Ai Tools/_wt-izzi-v2-d5/tools/x']) {
    assert.equal(checkCorrection({ text, cwd, at }, list).standardId, 'std-by-id', cwd);
  }
  for (const cwd of ['F:/Ai Tools/other-project', 'F:/Ai Tools/Tool Starizzi - B2C - Openclaw-copy', 'F:/Ai Tools']) {
    assert.equal(checkCorrection({ text, cwd, at }, list).repeat, false, cwd);
  }
});

test('a standard saved with a worktree root counts for the root project and every worktree', () => {
  const { standards: list } = scopeStandards();
  const text = 'deploy đè bản live';
  assert.equal(checkCorrection({ text, cwd: 'F:/Ai Tools/Tool Starizzi - B2C - Openclaw/apps', at }, list).standardId, 'std-by-wt-root');
  assert.equal(checkCorrection({ text, cwd: 'F:/Ai Tools/_wt-izzi-v2-d0', at }, list).standardId, 'std-by-wt-root');
  assert.equal(checkCorrection({ text, cwd: 'F:/proj-a', at }, list).repeat, false);
});

test('standards whose project cannot be matched from a folder are counted', () => {
  const { standards: list, unmatchable, skipped } = scopeStandards();
  assert.equal(list.length, 3);
  assert.equal(skipped, 0);
  assert.equal(unmatchable, 1);
  assert.equal(checkCorrection({ text: 'thiếu mã thoát', cwd: 'F:/Ai Tools/_wt-izzi-v2-d5', at }, list).repeat, false);
  assert.equal(checkCorrection({ text: 'thiếu mã thoát', project_id: 'not-a-known-project', at }, list).standardId, 'std-unknown-id');
  assert.equal(normalizeStandards(pairsDoc().standards).unmatchable, 0);
});

// ---- transcript reading: D0 prompt rules, checkpoint answers, warnings

const ASK = '[Checkpoint nâng cấp] Anh có muốn em nâng cấp cách làm không?\n- Đề xuất: chuẩn tổng hợp.\nTrả lời: Nâng cấp / Chỉnh / Bỏ qua';
const userLine = (uuid, content) => JSON.stringify({ type: 'user', uuid, timestamp: '2026-11-12T10:00:00.000Z', cwd: 'F:/proj-a', message: { role: 'user', content } });
const assistantLine = (text) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });

test('transcript reader applies the D0 prompt rules and flags checkpoint answers', async () => {
  const file = join(scratch, 'd0-rules.jsonl');
  writeFileSync(file, [
    userLine('u-ok', 'sửa lại màu nút'),
    userLine('u-long', 'x'.repeat(4001)),
    userLine('u-4000', `   ${'y'.repeat(4000)}   `),
    userLine('u-int', '[Request interrupted by user]'),
    userLine('u-empty', '   '),
    assistantLine(`Đã xong.\n\n${ASK}`),
    userLine('u-answer', 'Bỏ qua'),
    assistantLine(`Đã xong.\n\n${ASK}`),
    userLine('u-other', 'làm tiếp phần đăng nhập'),
    assistantLine('Đã xong.'),
    userLine('u-not-asked', 'bỏ qua'),
  ].join('\n'));
  const prompts = await readOwnerPrompts(file);
  assert.deepEqual(prompts.map((p) => [p.uuid, p.checkpointAnswer]), [
    ['u-ok', false], ['u-4000', false], ['u-answer', true], ['u-other', false], ['u-not-asked', false],
  ]);
  const result = await checkTranscripts({ standards: standards(), files: [file] });
  assert.equal(result.prompts, 4, 'the checkpoint answer is not counted');
  assert.equal(result.checkpointAnswers, 1);
});

test('transcript reader warns instead of silently skipping a missing or too large transcript', async () => {
  const warnings = [];
  const warn = (message) => warnings.push(message);
  assert.deepEqual(await readOwnerPrompts(join(scratch, 'missing.jsonl'), { warn }), []);
  assert.deepEqual(await readOwnerPrompts(TRANSCRIPT, { warn, maxBytes: 10 }), []);
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /missing\.jsonl.*ENOENT/);
  assert.match(warnings[1], /metrics-checker-transcript\.jsonl.*too large/);
  for (const word of PROMPT_WORDS) assert.equal(warnings.join('\n').includes(word), false, word);
});
