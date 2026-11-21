import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  BASELINE_SCHEMA,
  baselineExport,
  classifierVersion,
  clopperPearson,
  evaluate,
  firstPassById,
  formatReport,
  gateVerdict,
  joinRows,
  METRICS_VERSION,
  reopenedById,
  syntheticCoverage,
} from '../eval/eval-gold.mjs';

const SCRIPT = fileURLToPath(new URL('../eval/eval-gold.mjs', import.meta.url));
const CLASSIFY = fileURLToPath(new URL('../lib/classify.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'am-eval-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

// Synthetic gold set. Texts and notes are markers that must never reach the report.
const prompt = (id, split, sessionId, ts, len = 9) => ({ id, split, sessionId, project: 'p', ts, len, text: `SECRET-TEXT-${id}`, context: 'SECRET-CTX' });
const PROMPTS = [
  prompt('d1', 'dev', 'S1', 't01'),
  prompt('t1', 'test', 'S1', 't02'),
  prompt('t2', 'test', 'S1', 't03'),
  prompt('t3', 'test', 'S1', 't04'),
  prompt('d2', 'dev', 'S1', 't05'),
  prompt('t4', 'test', 'S2', 't01', 30),
  prompt('t5', 'test', 'S2', 't02'),
  prompt('t6', 'test', 'S2', 't03'),
  prompt('t8', 'test', 'S2', 't04'),
  prompt('u1', 'test', 'S2', 't05'),
];
const label = (id, gold, extra = {}) => ({ id, gold, tags: [], unsure: false, note: `SECRET-NOTE-${id}`, ...extra });
const LABELS = [
  label('d1', 'correction'),
  label('t1', 'approve_decision'),
  label('t2', 'praise'),
  label('t3', 'resignation'),
  label('d2', 'none', { tags: ['question'] }),
  label('t4', 'approve_decision', { unsure: true, tags: ['multi_intent'] }),
  label('t5', 'flow', { tags: ['negation'] }),
  label('t6', 'correction', { tags: ['deferral'] }),
  label('t8', 'none'),
  label('zz', 'none'),
];
const pred = (id, lbl, ruleId = lbl) => ({ id, label: lbl, ruleId });
const PREDICTIONS = [
  pred('d1', 'correction', 'correction:sai-roi'),
  pred('t1', 'approve_decision', 'approve_decision:merge'),
  pred('t2', 'praise', 'praise:duoc-roi'),
  pred('t3', 'approve_decision', 'approve_decision:chot'),
  pred('d2', 'praise', 'praise:ok-roi'),
  pred('t4', 'abstain', 'abstain:question'),
  pred('t5', 'flow', 'flow:ok'),
  pred('t6', 'approve_decision', 'approve_decision:merge'),
  pred('u1', 'none', 'none'),
];
const CLEAN_SYNTHETIC = { probes: 76, resignation: 27, questionNegation: 45, other: 4, critical: 0 };
const run = (split, extra = {}) => evaluate({ prompts: PROMPTS, labels: LABELS, predictions: PREDICTIONS, split, synthetic: CLEAN_SYNTHETIC, ...extra });
const near = (actual, expected, tol = 1e-4) => assert.ok(Math.abs(actual - expected) < tol, `${actual} != ${expected}`);

test('joinRows reports coverage: unlabeled, unknown label ids, missing predictions', () => {
  const { rows, coverage } = joinRows(PROMPTS, LABELS, PREDICTIONS);
  assert.equal(rows.length, 9);
  assert.deepEqual(coverage, { prompts: 10, labeled: 9, unlabeled: 1, unknownLabelIds: 1, duplicateLabels: 0, missingPredictions: 1 });
});

test('joinRows rejects an unknown gold label or tag without echoing the value', () => {
  assert.throws(() => joinRows(PROMPTS, [label('t1', 'SECRET-BAD')], []), (err) => /invalid gold label/.test(err.message) && !err.message.includes('SECRET'));
  assert.throws(() => joinRows(PROMPTS, [label('t1', 'none', { tags: ['SECRET-TAG'] })], []), /invalid tag/);
  assert.throws(() => joinRows(PROMPTS, [], [pred('t1', 'maybe')]), /invalid predicted label/);
});

test('duplicate labels keep the last line and are counted', () => {
  const { rows, coverage } = joinRows(PROMPTS, [label('t1', 'none'), label('t1', 'praise')], []);
  assert.equal(coverage.duplicateLabels, 1);
  assert.equal(rows.find((r) => r.id === 't1').gold, 'praise');
});

test('confusion matrix counts gold x predicted, with abstain as a predicted column', () => {
  const m = run('test').splits.test;
  assert.equal(m.counts.labeled, 7);
  assert.equal(m.counts.scored, 6);
  assert.equal(m.confusion.approve_decision.approve_decision, 1);
  assert.equal(m.confusion.approve_decision.abstain, 1);
  assert.equal(m.confusion.resignation.approve_decision, 1);
  assert.equal(m.confusion.correction.approve_decision, 1);
  assert.equal(m.confusion.none.abstain, 0);
  assert.equal(Object.keys(m.confusion).includes('abstain'), false);
});

test('milestone axis precision and recall treat approve_decision and praise as one class, with a 95% CI', () => {
  const m = run('test').splits.test;
  assert.deepEqual({ tp: m.milestone.tp, fp: m.milestone.fp, fn: m.milestone.fn }, { tp: 2, fp: 2, fn: 1 });
  assert.equal(m.milestone.precision, 0.5);
  assert.equal(m.milestone.recall, 2 / 3);
  assert.deepEqual(m.milestone.ci, clopperPearson(2, 4));
  assert.equal(m.perLabel.correction.recall, 0);
  assert.equal(m.perLabel.flow.precision, 1);
});

test('Clopper-Pearson 95% interval matches reference values', () => {
  const all = clopperPearson(13, 13);
  near(all.lower, 0.025 ** (1 / 13));
  assert.equal(all.upper, 1);
  const half = clopperPearson(5, 10);
  near(half.lower, 0.187086);
  near(half.upper, 0.812914);
  const none = clopperPearson(0, 10);
  assert.equal(none.lower, 0);
  near(none.upper, 1 - 0.025 ** (1 / 10));
  assert.equal(clopperPearson(0, 0), null);
});

test('correction precision and recall: the label alone and the correction|clarify axis decide() counts', () => {
  const overall = run('all').splits.overall.correction;
  assert.deepEqual(overall.label, { tp: 1, predicted: 1, gold: 2, precision: 1, recall: 0.5 });
  assert.deepEqual(overall.axis, { tp: 1, predicted: 1, gold: 2, precision: 1, recall: 0.5 });
  const test_ = run('test').splits.test.correction;
  assert.deepEqual(test_.label, { tp: 0, predicted: 0, gold: 1, precision: null, recall: 0 });
});

test('critical errors: predicted milestone on resignation, question, negation or deferral; ids only', () => {
  const test_ = run('test').splits.test;
  assert.deepEqual(test_.critical, { count: 2, byReason: { resignation: 1, question: 0, negation: 0, deferral: 1 }, ids: ['t3', 't6'] });
  const dev = run('dev').splits.dev;
  assert.deepEqual(dev.critical.ids, ['d2']);
  assert.equal(dev.critical.byReason.question, 1);
});

test('per-rule precision covers milestone rules only', () => {
  const m = run('test').splits.test;
  assert.deepEqual(m.milestoneRules, [
    { ruleId: 'approve_decision:chot', predicted: 1, correct: 0, precision: 0 },
    { ruleId: 'approve_decision:merge', predicted: 2, correct: 1, precision: 0.5 },
    { ruleId: 'praise:duoc-roi', predicted: 1, correct: 1, precision: 1 },
  ]);
});

test('milestone misses are profiled by length, multi_intent and unsure', () => {
  assert.deepEqual(run('test').splits.test.misses, { count: 1, short: 0, multiIntent: 1, unsure: 1 });
  const shortPrompts = PROMPTS.map((p) => (p.id === 't4' ? { ...p, len: 20 } : p));
  const m = evaluate({ prompts: shortPrompts, labels: LABELS, predictions: PREDICTIONS, split: 'test', synthetic: CLEAN_SYNTHETIC });
  assert.equal(m.splits.test.misses.short, 1);
});

test('first-pass approval walks each session in ts order across both splits', () => {
  const { rows } = joinRows(PROMPTS, LABELS, PREDICTIONS);
  const shuffled = [...rows].reverse();
  assert.deepEqual(Object.fromEntries(firstPassById(shuffled)), { t1: false, t2: true, t4: true });
  assert.deepEqual(Object.fromEntries(firstPassById(shuffled, 'label')), { t1: false, t2: true, t3: true, d2: true, t6: true });
});

test('first-pass and reopened count clarify like correction, as decide() does, for gold and predicted labels', () => {
  const r = (id, ts, gold, lbl) => ({ id, sessionId: 'S', ts, order: 0, gold, label: lbl, tags: [], split: 'test' });
  const rows = [
    r('a', 't1', 'clarify', 'none'),
    r('b', 't2', 'approve_decision', 'approve_decision'),
    r('c', 't3', 'none', 'clarify'),
    r('d', 't4', 'praise', 'praise'),
    r('e', 't5', 'none', 'none'),
    r('f', 't6', 'none', 'none'),
    r('g', 't7', 'none', 'none'),
    r('h', 't8', 'clarify', 'correction'),
  ];
  assert.deepEqual(Object.fromEntries(firstPassById(rows)), { b: false, d: true });
  assert.deepEqual(Object.fromEntries(firstPassById(rows, 'label')), { b: true, d: false });
  assert.deepEqual(Object.fromEntries(reopenedById(rows)), { b: false, d: false });
  assert.deepEqual(Object.fromEntries(reopenedById(rows, 'label')), { b: true, d: false });
});

test('reopened (metrics@1): a correction within the next 3 prompts counts only before the next milestone', () => {
  const r = (id, ts, gold) => ({ id, sessionId: 'S', ts, order: 0, gold, label: null, tags: [], split: 'test' });
  const rows = [
    r('m1', 't01', 'approve_decision'),
    r('m2', 't02', 'praise'),
    r('x', 't03', 'correction'),
    r('m3', 't04', 'approve_decision'),
    r('n1', 't05', 'none'),
    r('n2', 't06', 'none'),
    r('n3', 't07', 'clarify'),
    r('m4', 't08', 'approve_decision'),
    r('n4', 't09', 'none'),
    r('n5', 't10', 'none'),
    r('n6', 't11', 'none'),
    r('late', 't12', 'correction'),
  ];
  // m1: m2 comes first, so x reopens m2 only. m3: the clarify is its 3rd prompt. m4: the correction is the 4th.
  assert.deepEqual(Object.fromEntries(reopenedById(rows)), { m1: false, m2: true, m3: true, m4: false });
  const other = [r('a', 't01', 'approve_decision'), { ...r('b', 't02', 'correction'), sessionId: 'T' }];
  assert.deepEqual(Object.fromEntries(reopenedById(other)), { a: false });
});

test('baselines: gold and classifier on the same split, each with first-pass and the reopened estimate', () => {
  const m = run('test').splits.test;
  assert.deepEqual(m.baseline.gold, {
    prompts: 7,
    corrections: 1,
    correctionsPer100: 100 / 7,
    correctionOnly: 1,
    correctionOnlyPer100: 100 / 7,
    clarify: 0,
    milestones: 3,
    firstPass: 2,
    firstPassRate: 2 / 3,
    reopened: 1,
    reopenedRate: 1 / 3,
  });
  assert.deepEqual(m.baseline.classifier, {
    prompts: 6,
    corrections: 0,
    correctionsPer100: 0,
    correctionOnly: 0,
    correctionOnlyPer100: 0,
    clarify: 0,
    milestones: 4,
    firstPass: 3,
    firstPassRate: 0.75,
    reopened: 0,
    reopenedRate: 0,
  });
  assert.equal(m.unsure, 1);
  assert.deepEqual({ r: m.counts.resignation, q: m.counts.questionNegation }, { r: 1, q: 1 });
});

test('corrections per 100 (metrics@1) count correction + clarify; correction-only is kept apart', () => {
  const prompts = ['a', 'b', 'c', 'd'].map((id, i) => prompt(id, 'test', 'S', `t${i}`));
  const labels = [label('a', 'correction'), label('b', 'clarify'), label('c', 'none'), label('d', 'none')];
  const predictions = [pred('a', 'clarify'), pred('b', 'none'), pred('c', 'correction'), pred('d', 'clarify')];
  const m = evaluate({ prompts, labels, predictions, split: 'test', synthetic: CLEAN_SYNTHETIC }).splits.test.baseline;
  assert.deepEqual([m.gold.corrections, m.gold.correctionOnly, m.gold.clarify, m.gold.correctionsPer100, m.gold.correctionOnlyPer100], [2, 1, 1, 50, 25]);
  assert.deepEqual([m.classifier.corrections, m.classifier.correctionOnly, m.classifier.clarify, m.classifier.correctionsPer100], [3, 1, 2, 75]);
});

test('classifierVersion: first 12 hex of sha256 over classify.mjs with LF line endings', () => {
  const lf = readFileSync(CLASSIFY, 'utf8').replace(/\r\n/g, '\n');
  const expected = createHash('sha256').update(lf).digest('hex').slice(0, 12);
  assert.equal(classifierVersion(), expected);
  assert.match(classifierVersion(), /^[0-9a-f]{12}$/);
  const crlf = join(scratch, 'crlf.mjs');
  const unix = join(scratch, 'lf.mjs');
  writeFileSync(crlf, 'a\r\nb\r\n');
  writeFileSync(unix, 'a\nb\n');
  assert.equal(classifierVersion(crlf), classifierVersion(unix));
});

test('baseline export: agent-maturity/baseline@1 with metrics@1, classifier version, counts and three rates per instrument', () => {
  const report = run('test');
  const b = baselineExport(report, 'test', { ownerReviewed: false });
  assert.equal(BASELINE_SCHEMA, 'agent-maturity/baseline@1');
  assert.equal(METRICS_VERSION, 'metrics@1');
  assert.deepEqual(b, {
    schema: 'agent-maturity/baseline@1',
    definitions: 'metrics@1',
    classifierVersion: classifierVersion(),
    split: 'test',
    n: { prompts: { classifier: 6, gold: 7 }, milestones: { classifier: 4, gold: 3 } },
    instruments: {
      classifier: { correctionsPer100: 0, firstPassRate: 0.75, reopenedRate: 0 },
      gold: { correctionsPer100: 100 / 7, firstPassRate: 2 / 3, reopenedRate: 1 / 3 },
    },
    ownerReviewed: false,
  });
  assert.equal(baselineExport(run('all'), 'all', { ownerReviewed: true }).n.prompts.gold, 9);
  assert.equal(baselineExport(run('all'), 'all', { ownerReviewed: true }).ownerReviewed, true);
  assert.equal(report.definitions, 'metrics@1');
  assert.equal(report.classifierVersion, classifierVersion());
});

test('gate FAIL lists fail reasons and every provisional reason, with the CI', () => {
  const { gate } = run('all');
  assert.equal(gate.verdict, 'FAIL');
  assert.equal(gate.reasons.length, 3);
  assert.match(gate.reasons.join('\n'), /precision 0\.500 < 0\.9/);
  assert.match(gate.reasons.join('\n'), /critical errors on test: 2/);
  assert.match(gate.reasons.join('\n'), /without a prediction: 1/);
  assert.equal(gate.provisional.length, 4);
  assert.match(gate.provisional[0], /resignation.*1 .*synthetic.*27/);
  assert.match(gate.provisional[1], /question\/negation.*1 .*synthetic.*45/);
  assert.match(gate.provisional[2], /lower bound .* < 0\.9 \(2\/4\)/);
  assert.match(gate.provisional[3], /owner-reviewed/);
  assert.deepEqual(gate.ci, clopperPearson(2, 4));
});

const metricsOf = (tp, fp, extra = {}) => ({
  counts: { labeled: 80, scored: 80, resignation: 20, questionNegation: 20 },
  milestone: { tp, fp, fn: 3, precision: tp + fp === 0 ? null : tp / (tp + fp), recall: 0.75 },
  critical: { count: 0, byReason: {}, ids: [] },
  ...extra,
});

test('gate PASS needs precision and its CI lower bound >= 0.9, >= 20 cases per class and owner review', () => {
  const pass = gateVerdict(metricsOf(40, 0), CLEAN_SYNTHETIC, { ownerReviewed: true });
  assert.equal(pass.verdict, 'PASS');
  assert.deepEqual({ reasons: pass.reasons, provisional: pass.provisional }, { reasons: [], provisional: [] });
  assert.ok(pass.ci.lower >= 0.9);
  const unreviewed = gateVerdict(metricsOf(40, 0), CLEAN_SYNTHETIC);
  assert.equal(unreviewed.verdict, 'PROVISIONAL');
  assert.equal(unreviewed.provisional.length, 1);
  const narrow = gateVerdict(metricsOf(9, 1), CLEAN_SYNTHETIC, { ownerReviewed: true });
  assert.equal(narrow.verdict, 'PROVISIONAL');
  assert.match(narrow.provisional[0], /lower bound 0\.555 < 0\.9 \(9\/10\)/);
  const sparse = gateVerdict(metricsOf(40, 0, { counts: { labeled: 80, scored: 80, resignation: 19, questionNegation: 20 } }), CLEAN_SYNTHETIC, { ownerReviewed: true });
  assert.equal(sparse.verdict, 'PROVISIONAL');
});

test('gate FAIL on precision < 0.9, synthetic critical errors or no predicted milestone', () => {
  assert.equal(gateVerdict(metricsOf(17, 3), CLEAN_SYNTHETIC, { ownerReviewed: true }).verdict, 'FAIL');
  const bad = gateVerdict(metricsOf(40, 0), { ...CLEAN_SYNTHETIC, critical: 1 }, { ownerReviewed: true });
  assert.equal(bad.verdict, 'FAIL');
  assert.match(bad.reasons[0], /synthetic held-out critical errors: 1/);
  const none = gateVerdict(metricsOf(0, 0), CLEAN_SYNTHETIC, { ownerReviewed: true });
  assert.equal(none.verdict, 'FAIL');
  assert.match(none.reasons[0], /no predicted milestones/);
  assert.equal(none.ci, null);
});

test('holdout leakage: shared sessions, test text that also occurs in dev, and test-unique metrics', () => {
  const plain = run('test');
  assert.deepEqual(plain.leakage, { sessions: 2, sharedSessions: 1, testPrompts: 8, testInSharedSessions: 3, testDuplicatedInDev: 0 });
  assert.equal(plain.testUnique.counts.labeled, 7);
  const prompts = PROMPTS.map((p) => (p.id === 't2' ? { ...p, text: '  secret-text-D1 ' } : p));
  const leaky = evaluate({ prompts, labels: LABELS, predictions: PREDICTIONS, split: 'test', synthetic: CLEAN_SYNTHETIC });
  assert.equal(leaky.leakage.testDuplicatedInDev, 1);
  const u = leaky.testUnique;
  assert.equal(u.counts.labeled, 6);
  assert.deepEqual({ tp: u.milestone.tp, fp: u.milestone.fp, fn: u.milestone.fn }, { tp: 1, fp: 2, fn: 1 });
  assert.equal(u.critical.count, 2);
  assert.equal(run('dev').testUnique, undefined);
});

test('--split selects sections; the gate only appears when the test split is shown', () => {
  assert.deepEqual(Object.keys(run('all').splits), ['dev', 'test', 'overall']);
  assert.deepEqual(Object.keys(run('dev').splits), ['dev']);
  assert.equal(run('dev').gate, undefined);
  assert.ok(run('test').gate);
  assert.throws(() => run('train'), /--split/);
});

test('synthetic coverage from the D1 fixtures has >= 20 cases per critical class and no critical error', () => {
  const s = syntheticCoverage();
  assert.ok(s.resignation >= 20, `resignation ${s.resignation}`);
  assert.ok(s.questionNegation >= 20, `question/negation ${s.questionNegation}`);
  assert.equal(s.critical, 0);
});

test('text report shows every new section and labels per-rule lines with their split', () => {
  const out = formatReport(run('all'));
  for (const marker of [
    /verdict: FAIL \(precision 0\.500, 95% CI 0\.\d{3}-0\.\d{3}/,
    /^fail: /m,
    /^provisional: .*owner-reviewed/m,
    /^D0 gold-set eval .*definitions metrics@1, classifier [0-9a-f]{12}/m,
    /baseline \(gold labels\): corrections \(correction\+clarify\) 14\.3 per 100 prompts \(1\/7\), correction only 14\.3 \(1\/7\)/,
    /baseline \(classifier, same split\): corrections \(correction\+clarify\) 0\.0 per 100/,
    /reopened within 3 prompts before the next milestone 0\.333 \(1\/3, estimate\)/,
    /correction: label precision n\/a \(0\/0\), recall 0\.000 \(0\/1\); correction\|clarify axis/,
    /milestone misses: 1 \(<=20 chars 0, multi_intent 1, unsure 1\)/,
    /milestone rules \[test\]: /,
    /milestone rules \[dev\+test\]: /,
    /holdout leakage: sessions 2, in both splits 1/,
    /test-unique \(labeled 7\): milestone precision 0\.500/,
  ]) assert.match(out, marker);
});

test('text and JSON reports never contain prompt text, context or notes', () => {
  const report = run('all');
  for (const out of [formatReport(report), JSON.stringify(report)]) assert.doesNotMatch(out, /SECRET/);
});

test('CLI prints the text report, or JSON with --json; --owner-reviewed drops that reason', () => {
  const files = { prompts: PROMPTS, labels: LABELS, predictions: PREDICTIONS };
  for (const [name, rows] of Object.entries(files)) writeFileSync(join(scratch, `${name}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const args = ['prompts', 'labels', 'predictions'].map((n) => join(scratch, `${n}.jsonl`));
  const text = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /confusion/);
  assert.doesNotMatch(text.stdout, /SECRET/);
  const json = spawnSync(process.execPath, [SCRIPT, ...args, '--split', 'test', '--json'], { encoding: 'utf8' });
  assert.equal(json.status, 0, json.stderr);
  const gate = JSON.parse(json.stdout).gate;
  assert.equal(gate.verdict, 'FAIL');
  assert.ok(gate.provisional.some((p) => /owner-reviewed/.test(p)));
  const reviewed = spawnSync(process.execPath, [SCRIPT, ...args, '--split', 'test', '--json', '--owner-reviewed'], { encoding: 'utf8' });
  assert.equal(reviewed.status, 0, reviewed.stderr);
  assert.ok(!JSON.parse(reviewed.stdout).gate.provisional.some((p) => /owner-reviewed/.test(p)));
  const usage = spawnSync(process.execPath, [SCRIPT, args[0]], { encoding: 'utf8' });
  assert.notEqual(usage.status, 0);
  assert.match(usage.stderr, /usage: eval-gold\.mjs/);
});

test('CLI --export-baseline writes the baseline JSON outside git and refuses a path inside the repo', () => {
  const files = { prompts: PROMPTS, labels: LABELS, predictions: PREDICTIONS };
  for (const [name, rows] of Object.entries(files)) writeFileSync(join(scratch, `${name}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const args = Object.keys(files).map((n) => join(scratch, `${n}.jsonl`));
  const out = join(scratch, 'export', 'baseline-test.json');
  const r = spawnSync(process.execPath, [SCRIPT, ...args, '--split', 'test', '--export-baseline', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /confusion/);
  assert.match(r.stderr, /baseline written/);
  const written = readFileSync(out, 'utf8');
  assert.doesNotMatch(written, /SECRET/);
  const b = JSON.parse(written);
  assert.deepEqual([b.schema, b.definitions, b.split, b.ownerReviewed], ['agent-maturity/baseline@1', 'metrics@1', 'test', false]);
  assert.equal(b.classifierVersion, classifierVersion());
  const inside = join(REPO, 'tmp-d0-baseline.json');
  const refused = spawnSync(process.execPath, [SCRIPT, ...args, '--split', 'test', '--export-baseline', inside], { encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /inside the repo/);
  assert.equal(existsSync(inside), false);
});
