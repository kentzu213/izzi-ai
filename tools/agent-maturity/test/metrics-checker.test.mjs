import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { checkTranscripts } from '../metrics/check-repeats.mjs';
import { checkCorrection, contentTerms, DEFAULT_THRESHOLD, normalizeStandards, scorePair } from '../metrics/checker.mjs';
import { evaluatePairs } from '../metrics/eval-checker.mjs';
import { readOwnerPrompts } from '../metrics/transcript-prompts.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FIXTURES = join(ROOT, 'test', 'fixtures');
const PAIRS = join(FIXTURES, 'metrics-checker-pairs.json');
const TRANSCRIPT = join(FIXTURES, 'metrics-checker-transcript.jsonl');
const REAL_MATURITY_HOME = join(homedir(), '.claude', 'agent-maturity');
const scratch = mkdtempSync(join(tmpdir(), 'am-checker-'));

after(() => {
  rmSync(scratch, { recursive: true, force: true });
  assert.equal(existsSync(REAL_MATURITY_HOME), false, 'real ~/.claude/agent-maturity must not exist');
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
  assert.deepEqual(prompts.map((p) => p.uuid), ['u-start', 'u-corr-1', 'u-corr-2', 'u-clar', 'u-praise', 'u-wrap']);
  assert.equal(prompts[1].cwd, 'F:/proj-a');
  assert.equal(prompts[1].at, '2026-11-12T09:00:00.000Z');
  assert.deepEqual(await readOwnerPrompts(join(scratch, 'missing.jsonl')), []);
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
