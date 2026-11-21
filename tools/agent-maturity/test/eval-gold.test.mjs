import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { evaluate, firstPassById, formatReport, gateVerdict, joinRows, syntheticCoverage } from '../eval/eval-gold.mjs';

const SCRIPT = fileURLToPath(new URL('../eval/eval-gold.mjs', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'am-eval-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

// Synthetic gold set. Texts and notes are markers that must never reach the report.
const prompt = (id, split, sessionId, ts) => ({ id, split, sessionId, project: 'p', ts, len: 9, text: `SECRET-TEXT-${id}`, context: 'SECRET-CTX' });
const PROMPTS = [
  prompt('d1', 'dev', 'S1', 't01'),
  prompt('t1', 'test', 'S1', 't02'),
  prompt('t2', 'test', 'S1', 't03'),
  prompt('t3', 'test', 'S1', 't04'),
  prompt('d2', 'dev', 'S1', 't05'),
  prompt('t4', 'test', 'S2', 't01'),
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
  label('t4', 'approve_decision', { unsure: true }),
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
const run = (split) => evaluate({ prompts: PROMPTS, labels: LABELS, predictions: PREDICTIONS, split, synthetic: CLEAN_SYNTHETIC });

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

test('milestone axis precision and recall treat approve_decision and praise as one class', () => {
  const m = run('test').splits.test;
  assert.deepEqual(m.milestone, { tp: 2, fp: 2, fn: 1, precision: 0.5, recall: 2 / 3 });
  assert.equal(m.perLabel.correction.recall, 0);
  assert.equal(m.perLabel.flow.precision, 1);
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

test('first-pass approval walks each session in ts order across both splits', () => {
  const { rows } = joinRows(PROMPTS, LABELS, PREDICTIONS);
  const shuffled = [...rows].reverse();
  assert.deepEqual(Object.fromEntries(firstPassById(shuffled)), { t1: false, t2: true, t4: true });
});

test('baseline: corrections per 100 labeled prompts and first-pass approval rate from gold', () => {
  const m = run('test').splits.test;
  assert.deepEqual(m.baseline, { prompts: 7, corrections: 1, correctionsPer100: 100 / 7, milestones: 3, firstPass: 2, firstPassRate: 2 / 3 });
  assert.equal(m.unsure, 1);
  assert.deepEqual({ r: m.counts.resignation, q: m.counts.questionNegation }, { r: 1, q: 1 });
});

test('gate fails on low precision, critical errors and missing predictions; warns on sparse classes', () => {
  const { gate } = run('all');
  assert.equal(gate.pass, false);
  assert.equal(gate.reasons.length, 3);
  assert.match(gate.reasons.join('\n'), /precision 0\.500 < 0\.9/);
  assert.match(gate.reasons.join('\n'), /critical errors on test: 2/);
  assert.match(gate.reasons.join('\n'), /without a prediction: 1/);
  assert.equal(gate.warnings.length, 2);
  assert.match(gate.warnings[0], /resignation.*1 .*synthetic.*27/);
  assert.match(gate.warnings[1], /question\/negation.*1 .*synthetic.*45/);
});

test('gate passes at precision >= 0.9 with zero critical errors, and fails on synthetic critical errors', () => {
  const metrics = {
    counts: { labeled: 40, scored: 40, resignation: 20, questionNegation: 20 },
    milestone: { tp: 9, fp: 1, fn: 3, precision: 0.9, recall: 0.75 },
    critical: { count: 0, byReason: {}, ids: [] },
  };
  assert.deepEqual(gateVerdict(metrics, CLEAN_SYNTHETIC), { pass: true, precision: 0.9, recall: 0.75, critical: 0, reasons: [], warnings: [] });
  const bad = gateVerdict(metrics, { ...CLEAN_SYNTHETIC, critical: 1 });
  assert.equal(bad.pass, false);
  assert.match(bad.reasons[0], /synthetic held-out critical errors: 1/);
  const none = gateVerdict({ ...metrics, milestone: { tp: 0, fp: 0, fn: 3, precision: null, recall: 0 } }, CLEAN_SYNTHETIC);
  assert.match(none.reasons[0], /no predicted milestones/);
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

test('text and JSON reports never contain prompt text, context or notes', () => {
  const report = run('all');
  for (const out of [formatReport(report), JSON.stringify(report)]) assert.doesNotMatch(out, /SECRET/);
  assert.match(formatReport(report), /verdict: FAIL/);
});

test('CLI prints the text report, or JSON with --json', () => {
  const files = { prompts: PROMPTS, labels: LABELS, predictions: PREDICTIONS };
  for (const [name, rows] of Object.entries(files)) writeFileSync(join(scratch, `${name}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const args = ['prompts', 'labels', 'predictions'].map((n) => join(scratch, `${n}.jsonl`));
  const text = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /confusion/);
  assert.doesNotMatch(text.stdout, /SECRET/);
  const json = spawnSync(process.execPath, [SCRIPT, ...args, '--split', 'test', '--json'], { encoding: 'utf8' });
  assert.equal(json.status, 0, json.stderr);
  assert.equal(JSON.parse(json.stdout).gate.pass, false);
  const usage = spawnSync(process.execPath, [SCRIPT, args[0]], { encoding: 'utf8' });
  assert.notEqual(usage.status, 0);
  assert.match(usage.stderr, /usage: eval-gold\.mjs/);
});
