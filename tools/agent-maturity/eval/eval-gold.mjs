// D0: score D1 predictions against the gold labels (docs/izzi-v2/PLAN.md §2.6, §3.2 D0/D2, §4.9 items 3, 6, 7).
// Aggregate output only: counts, rates, label names, rule ids and prompt ids. Never prompt text, context or notes.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { classifyPrompt, MILESTONE_LABELS, normalize } from '../lib/classify.mjs';
import { assertOutsideRepo, invokedDirectly, readJsonl, runMain } from './io.mjs';

export const GOLD_LABELS = ['approve_decision', 'praise', 'confirm', 'flow', 'resignation', 'correction', 'clarify', 'none'];
export const PREDICTED_LABELS = [...GOLD_LABELS, 'abstain'];
export const TAGS = ['question', 'negation', 'deferral', 'completion_context', 'multi_intent'];
// Shared with D5 (metrics/README.md). metrics@1: corrections per 100 = (correction + clarify) per 100 owner prompts;
// first-pass = milestones with no correction/clarify since the previous milestone of the session; reopened = a
// milestone followed by a correction/clarify within the next REOPEN_WINDOW owner prompts of the same session, before
// the next milestone (an estimate). Change the version whenever one of these definitions changes.
export const METRICS_VERSION = 'metrics@1';
export const BASELINE_SCHEMA = 'agent-maturity/baseline@1';
const CLASSIFY_FILE = fileURLToPath(new URL('../lib/classify.mjs', import.meta.url));
const CRITICAL_TAGS = ['question', 'negation', 'deferral'];
// decide() counts both as a correction signal (PLAN §4.3 step 2), so the first-pass walks do too.
const CORRECTION_SIGNALS = ['correction', 'clarify'];
const GATE = { minPrecision: 0.9, minClassCases: 20, confidence: 0.95 };
const REOPEN_WINDOW = 3; // owner prompts after a milestone that can reopen it (§4.9 item 6, an estimate)
const SHORT_MISS = 20; // characters
const BISECT_STEPS = 60;
const SECTIONS = { all: ['dev', 'test', 'overall'], dev: ['dev'], test: ['test'] };
const SPLIT_TAG = { dev: 'dev', test: 'test', overall: 'dev+test' };

const ratio = (a, b) => (b === 0 ? null : a / b);
const isMilestone = (label) => MILESTONE_LABELS.has(label);
const hasTag = (row, tags) => row.tags.some((t) => tags.includes(t));

// Version of the D1 classifier that labelled a baseline: first 12 hex of sha256 over classify.mjs with LF line
// endings, so a CRLF checkout (core.autocrlf) and the git blob give the same value. D5 computes it the same way.
export function classifierVersion(file = CLASSIFY_FILE) {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function readLabels(labels) {
  const byId = new Map();
  let duplicates = 0;
  labels.forEach((l, i) => {
    const where = `labels row ${i + 1}${typeof l?.id === 'string' ? ` (id ${l.id})` : ''}`;
    if (typeof l?.id !== 'string') throw new Error(`${where}: missing id`);
    if (!GOLD_LABELS.includes(l.gold)) throw new Error(`${where}: invalid gold label`);
    const tags = l.tags ?? [];
    if (!Array.isArray(tags) || !tags.every((t) => TAGS.includes(t))) throw new Error(`${where}: invalid tag`);
    if (byId.has(l.id)) duplicates += 1;
    byId.set(l.id, { gold: l.gold, tags, unsure: l.unsure === true });
  });
  return { byId, duplicates };
}

function readPredictions(predictions) {
  const byId = new Map();
  for (const p of predictions) {
    if (!PREDICTED_LABELS.includes(p?.label)) throw new Error(`predictions: invalid predicted label for id ${String(p?.id)}`);
    byId.set(p.id, { label: p.label, ruleId: p.ruleId });
  }
  return byId;
}

// One row per labeled prompt; label/ruleId are null when the prediction is missing.
export function joinRows(prompts, labels, predictions) {
  const gold = readLabels(labels);
  const predicted = readPredictions(predictions);
  const promptIds = new Set(prompts.map((p) => p.id));
  const rows = [];
  prompts.forEach((p, order) => {
    const g = gold.byId.get(p.id);
    if (!g) return;
    const pr = predicted.get(p.id);
    const len = p.len ?? String(p.text ?? '').length;
    rows.push({ id: p.id, split: p.split, sessionId: p.sessionId, ts: p.ts, order, len, ...g, label: pr?.label ?? null, ruleId: pr?.ruleId ?? null });
  });
  const coverage = {
    prompts: prompts.length,
    labeled: rows.length,
    unlabeled: prompts.length - rows.length,
    unknownLabelIds: [...gold.byId.keys()].filter((id) => !promptIds.has(id)).length,
    duplicateLabels: gold.duplicates,
    missingPredictions: rows.filter((r) => r.label === null).length,
  };
  return { rows, coverage };
}

// Reasons a prediction is a critical error (PLAN D2): approval or praise on resignation, question, negation, deferral.
export function criticalReasons(row) {
  if (!isMilestone(row.label)) return [];
  const reasons = row.gold === 'resignation' ? ['resignation'] : [];
  return reasons.concat(CRITICAL_TAGS.filter((t) => row.tags.includes(t)));
}

// P(X <= k) for X ~ Binomial(n, p), summed in log space so a large n does not underflow the first term.
function binomCdf(k, n, p) {
  if (k < 0) return 0;
  if (k >= n || p <= 0) return 1;
  if (p >= 1) return 0;
  const step = Math.log(p) - Math.log1p(-p);
  let logTerm = n * Math.log1p(-p);
  let sum = Math.exp(logTerm);
  for (let i = 1; i <= k; i += 1) {
    logTerm += Math.log((n - i + 1) / i) + step;
    sum += Math.exp(logTerm);
  }
  return Math.min(1, sum);
}

// Smallest p in [0, 1] where holds(p) is true; holds must switch once from false to true as p grows.
function bisect(holds) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < BISECT_STEPS; i += 1) {
    const mid = (lo + hi) / 2;
    if (holds(mid)) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

// Exact (Clopper-Pearson) two-sided interval for x successes in n trials; null when n is 0.
export function clopperPearson(x, n, confidence = GATE.confidence) {
  if (n === 0) return null;
  const tail = (1 - confidence) / 2;
  const lower = x === 0 ? 0 : bisect((p) => 1 - binomCdf(x - 1, n, p) >= tail);
  const upper = x === n ? 1 : bisect((p) => binomCdf(x, n, p) <= tail);
  return { lower, upper };
}

// Sessions span both splits, so the walks below run over every labeled row before rows are split.
function sessionsOf(rows) {
  const sessions = new Map();
  for (const r of rows) sessions.set(r.sessionId, [...(sessions.get(r.sessionId) ?? []), r]);
  return [...sessions.values()].map((s) => [...s].sort((a, b) => String(a.ts).localeCompare(String(b.ts)) || a.order - b.order));
}

// Milestone id -> true when no correction or clarify came since the previous milestone (or session start).
// field 'gold' walks the gold labels, 'label' the classifier's predictions.
export function firstPassById(rows, field = 'gold') {
  const result = new Map();
  for (const session of sessionsOf(rows)) {
    let corrections = 0;
    for (const r of session) {
      if (CORRECTION_SIGNALS.includes(r[field])) corrections += 1;
      else if (isMilestone(r[field])) {
        result.set(r.id, corrections === 0);
        corrections = 0;
      }
    }
  }
  return result;
}

// Reverse metric estimate (§4.9 item 6, metrics@1): milestone id -> true when one of the next REOPEN_WINDOW
// labeled prompts of the same session is a correction or clarify, counting only prompts before the next milestone.
export function reopenedById(rows, field = 'gold') {
  const result = new Map();
  for (const session of sessionsOf(rows)) {
    session.forEach((r, i) => {
      if (!isMilestone(r[field])) return;
      const window = session.slice(i + 1, i + 1 + REOPEN_WINDOW);
      const nextMilestone = window.findIndex((n) => isMilestone(n[field]));
      const before = nextMilestone === -1 ? window : window.slice(0, nextMilestone);
      result.set(r.id, before.some((n) => CORRECTION_SIGNALS.includes(n[field])));
    });
  }
  return result;
}

const walksOf = (rows) => Object.fromEntries(['gold', 'label'].map((f) => [f, { firstPass: firstPassById(rows, f), reopened: reopenedById(rows, f) }]));

function confusionOf(scored) {
  const confusion = Object.fromEntries(GOLD_LABELS.map((g) => [g, Object.fromEntries(PREDICTED_LABELS.map((p) => [p, 0]))]));
  for (const r of scored) confusion[r.gold][r.label] += 1;
  return confusion;
}

function perLabelOf(confusion) {
  return Object.fromEntries(GOLD_LABELS.map((l) => {
    const gold = Object.values(confusion[l]).reduce((a, b) => a + b, 0);
    const predicted = GOLD_LABELS.reduce((sum, g) => sum + confusion[g][l], 0);
    const tp = confusion[l][l];
    return [l, { gold, predicted, precision: ratio(tp, predicted), recall: ratio(tp, gold) }];
  }));
}

function milestoneOf(scored) {
  const tp = scored.filter((r) => isMilestone(r.label) && isMilestone(r.gold)).length;
  const fp = scored.filter((r) => isMilestone(r.label) && !isMilestone(r.gold)).length;
  const fn = scored.filter((r) => !isMilestone(r.label) && isMilestone(r.gold)).length;
  return { tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn), ci: clopperPearson(tp, tp + fp) };
}

// One class made of the given labels, on both the gold and the predicted side.
function axisOf(scored, labels) {
  const tp = scored.filter((r) => labels.includes(r.label) && labels.includes(r.gold)).length;
  const predicted = scored.filter((r) => labels.includes(r.label)).length;
  const gold = scored.filter((r) => labels.includes(r.gold)).length;
  return { tp, predicted, gold, precision: ratio(tp, predicted), recall: ratio(tp, gold) };
}

function criticalOf(scored) {
  const byReason = Object.fromEntries(['resignation', ...CRITICAL_TAGS].map((k) => [k, 0]));
  const ids = [];
  for (const r of scored) {
    const reasons = criticalReasons(r);
    if (reasons.length === 0) continue;
    ids.push(r.id);
    for (const k of reasons) byReason[k] += 1;
  }
  return { count: ids.length, byReason, ids: ids.sort() };
}

function milestoneRulesOf(scored) {
  const rules = new Map();
  for (const r of scored.filter((x) => isMilestone(x.label))) {
    const s = rules.get(r.ruleId) ?? { predicted: 0, correct: 0 };
    rules.set(r.ruleId, { predicted: s.predicted + 1, correct: s.correct + (isMilestone(r.gold) ? 1 : 0) });
  }
  return [...rules.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([ruleId, s]) => ({ ruleId, ...s, precision: ratio(s.correct, s.predicted) }));
}

// Gold milestones the classifier did not call a milestone, profiled without text.
function missesOf(scored) {
  const misses = scored.filter((r) => isMilestone(r.gold) && !isMilestone(r.label));
  return {
    count: misses.length,
    short: misses.filter((r) => r.len <= SHORT_MISS).length,
    multiIntent: misses.filter((r) => r.tags.includes('multi_intent')).length,
    unsure: misses.filter((r) => r.unsure).length,
  };
}

// field 'gold' = baseline by gold labels; 'label' = the same numbers measured by the classifier (D6 compares like with like).
// corrections = correction + clarify (metrics@1); correctionOnly is the narrower count, shown apart.
function baselineOf(rows, walk, field) {
  const seen = rows.filter((r) => r[field] !== null);
  const per100 = (n) => (seen.length === 0 ? null : (n * 100) / seen.length);
  const correctionOnly = seen.filter((r) => r[field] === 'correction').length;
  const clarify = seen.filter((r) => r[field] === 'clarify').length;
  const milestones = seen.filter((r) => isMilestone(r[field]));
  const passed = milestones.filter((r) => walk.firstPass.get(r.id) === true).length;
  const reopened = milestones.filter((r) => walk.reopened.get(r.id) === true).length;
  return {
    prompts: seen.length,
    corrections: correctionOnly + clarify,
    correctionsPer100: per100(correctionOnly + clarify),
    correctionOnly,
    correctionOnlyPer100: per100(correctionOnly),
    clarify,
    milestones: milestones.length,
    firstPass: passed,
    firstPassRate: ratio(passed, milestones.length),
    reopened,
    reopenedRate: ratio(reopened, milestones.length),
  };
}

export function splitMetrics(rows, walks) {
  const scored = rows.filter((r) => r.label !== null);
  const confusion = confusionOf(scored);
  return {
    counts: {
      labeled: rows.length,
      scored: scored.length,
      resignation: rows.filter((r) => r.gold === 'resignation').length,
      questionNegation: rows.filter((r) => hasTag(r, ['question', 'negation'])).length,
    },
    confusion,
    perLabel: perLabelOf(confusion),
    milestone: milestoneOf(scored),
    correction: { label: axisOf(scored, ['correction']), axis: axisOf(scored, CORRECTION_SIGNALS) },
    critical: criticalOf(scored),
    milestoneRules: milestoneRulesOf(scored),
    misses: missesOf(scored),
    unsure: rows.filter((r) => r.unsure).length,
    baseline: { gold: baselineOf(rows, walks.gold, 'gold'), classifier: baselineOf(rows, walks.label, 'label') },
  };
}

// Holdout leakage: sessions with prompts in both splits, and test prompts whose normalised text also occurs in dev.
function leakageOf(prompts) {
  const splitsBySession = new Map();
  for (const p of prompts) splitsBySession.set(p.sessionId, new Set([...(splitsBySession.get(p.sessionId) ?? []), p.split]));
  const shared = new Set([...splitsBySession].filter(([, s]) => s.has('dev') && s.has('test')).map(([id]) => id));
  const textKey = (p) => normalize(String(p.text ?? ''));
  const devTexts = new Set(prompts.filter((p) => p.split === 'dev').map(textKey));
  const test = prompts.filter((p) => p.split === 'test');
  const duplicatedIds = new Set(test.filter((p) => devTexts.has(textKey(p))).map((p) => p.id));
  const summary = {
    sessions: splitsBySession.size,
    sharedSessions: shared.size,
    testPrompts: test.length,
    testInSharedSessions: test.filter((p) => shared.has(p.sessionId)).length,
    testDuplicatedInDev: duplicatedIds.size,
  };
  return { summary, duplicatedIds };
}

// Real data has few resignation and question/negation cases, so the D1 synthetic fixtures are scored too.
export function syntheticCoverage() {
  const fixture = (name) => JSON.parse(readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8'));
  const classOf = (group) => (group.startsWith('resignation') ? 'resignation' : /^(negation|question)/.test(group) ? 'questionNegation' : 'other');
  const probes = [
    ...fixture('classify-cases.json').cases.filter((c) => ['resignation', 'negation', 'question'].includes(c.group)),
    ...fixture('classify-holdout.json').mustNot,
  ].map((c) => ({ cls: classOf(c.group), critical: isMilestone(classifyPrompt(c.text).label) }));
  const count = (cls) => probes.filter((p) => p.cls === cls).length;
  return {
    probes: probes.length,
    resignation: count('resignation'),
    questionNegation: count('questionNegation'),
    other: count('other'),
    critical: probes.filter((p) => p.critical).length,
  };
}

const fmt = (x) => (x === null ? 'n/a' : x.toFixed(3));
const fmtCi = (ci) => (ci === null ? 'n/a' : `${fmt(ci.lower)}-${fmt(ci.upper)}`);

// PLAN D2 gate on the test split. FAIL: precision < 0.9 or any critical error. PROVISIONAL: the numbers pass but
// cannot be trusted yet (sparse critical classes, a CI lower bound under 0.9, gold labels not owner-reviewed).
export function gateVerdict(test, synthetic, { ownerReviewed = false } = {}) {
  const { milestone, critical, counts } = test;
  const ci = clopperPearson(milestone.tp, milestone.tp + milestone.fp);
  const reasons = [];
  if (milestone.precision === null) reasons.push('no predicted milestones on test: precision undefined');
  else if (milestone.precision < GATE.minPrecision) {
    reasons.push(`test milestone precision ${fmt(milestone.precision)} < ${GATE.minPrecision} (${milestone.tp}/${milestone.tp + milestone.fp})`);
  }
  if (critical.count > 0) reasons.push(`critical errors on test: ${critical.count} (${critical.ids.join(', ')})`);
  if (synthetic.critical > 0) reasons.push(`synthetic held-out critical errors: ${synthetic.critical}`);
  const missing = counts.labeled - counts.scored;
  if (missing > 0) reasons.push(`labeled test items without a prediction: ${missing}`);
  const provisional = [];
  if (counts.resignation < GATE.minClassCases) {
    provisional.push(`test resignation cases: ${counts.resignation} (< ${GATE.minClassCases}); synthetic fixtures cover ${synthetic.resignation} (critical ${synthetic.critical}), a stand-in only if the owner accepts it`);
  }
  if (counts.questionNegation < GATE.minClassCases) {
    provisional.push(`test question/negation cases: ${counts.questionNegation} (< ${GATE.minClassCases}); synthetic fixtures cover ${synthetic.questionNegation} (critical ${synthetic.critical})`);
  }
  if (ci !== null && ci.lower < GATE.minPrecision) {
    provisional.push(`test milestone precision 95% Clopper-Pearson lower bound ${fmt(ci.lower)} < ${GATE.minPrecision} (${milestone.tp}/${milestone.tp + milestone.fp})`);
  }
  if (!ownerReviewed) provisional.push("gold labels not owner-reviewed (rerun with --owner-reviewed after the owner's review)");
  const verdict = reasons.length > 0 ? 'FAIL' : provisional.length > 0 ? 'PROVISIONAL' : 'PASS';
  return { verdict, precision: milestone.precision, ci, recall: milestone.recall, critical: critical.count, reasons, provisional };
}

export function evaluate({ prompts, labels, predictions, split = 'all', synthetic = syntheticCoverage(), ownerReviewed = false }) {
  const sections = SECTIONS[split];
  if (!sections) throw new Error('--split must be dev, test or all');
  const { rows, coverage } = joinRows(prompts, labels, predictions);
  const walks = walksOf(rows);
  const rowsOf = (name) => (name === 'overall' ? rows : rows.filter((r) => r.split === name));
  const splits = Object.fromEntries(sections.map((name) => [name, splitMetrics(rowsOf(name), walks)]));
  const { summary, duplicatedIds } = leakageOf(prompts);
  const report = { definitions: METRICS_VERSION, classifierVersion: classifierVersion(), coverage, splits, synthetic, leakage: summary };
  if (!splits.test) return report;
  const testUnique = splitMetrics(rows.filter((r) => r.split === 'test' && !duplicatedIds.has(r.id)), walks);
  return { ...report, testUnique, gate: gateVerdict(splits.test, synthetic, { ownerReviewed }) };
}

// The baseline D5 reads (metrics/README.md): aggregate numbers of one split, for both instruments.
export function baselineExport(report, split, { ownerReviewed = false } = {}) {
  const section = report.splits[split === 'all' ? 'overall' : split];
  const { classifier, gold } = section.baseline;
  const rates = (b) => ({ correctionsPer100: b.correctionsPer100, firstPassRate: b.firstPassRate, reopenedRate: b.reopenedRate });
  return {
    schema: BASELINE_SCHEMA,
    definitions: report.definitions,
    classifierVersion: report.classifierVersion,
    split,
    n: { prompts: { classifier: classifier.prompts, gold: gold.prompts }, milestones: { classifier: classifier.milestones, gold: gold.milestones } },
    instruments: { classifier: rates(classifier), gold: rates(gold) },
    ownerReviewed,
  };
}

const SHORT = { approve_decision: 'appr', praise: 'prai', confirm: 'conf', flow: 'flow', resignation: 'resi', correction: 'corr', clarify: 'clar', none: 'none', abstain: 'abst' };
const pad = (s, n) => String(s).padStart(n);
const per100 = (x) => (x === null ? 'n/a' : x.toFixed(1));
const formatAxis = (name, a) => `${name} precision ${fmt(a.precision)} (${a.tp}/${a.predicted}), recall ${fmt(a.recall)} (${a.tp}/${a.gold})`;
const formatCorrection = (c) => `${formatAxis('label', c.label)}; ${formatAxis('correction|clarify axis', c.axis)}`;
const formatMilestone = (ms) => `precision ${fmt(ms.precision)} (${ms.tp}/${ms.tp + ms.fp}, 95% CI ${fmtCi(ms.ci)}), recall ${fmt(ms.recall)} (${ms.tp}/${ms.tp + ms.fn})`;

function formatBaseline(title, b, unit) {
  return `baseline (${title}): corrections (correction+clarify) ${per100(b.correctionsPer100)} per 100 prompts (${b.corrections}/${b.prompts}), `
    + `correction only ${per100(b.correctionOnlyPer100)} (${b.correctionOnly}/${b.prompts}); `
    + `first-pass approval ${fmt(b.firstPassRate)} (${b.firstPass}/${b.milestones} ${unit}); `
    + `reopened within ${REOPEN_WINDOW} prompts before the next milestone ${fmt(b.reopenedRate)} (${b.reopened}/${b.milestones}, estimate)`;
}

function formatSplit(name, m) {
  const lines = [`== ${name} (labeled ${m.counts.labeled}, scored ${m.counts.scored}) ==`, 'confusion (rows = gold, columns = predicted)'];
  lines.push(`${''.padEnd(17)}${PREDICTED_LABELS.map((p) => pad(SHORT[p], 5)).join('')}`);
  for (const g of GOLD_LABELS) lines.push(`${g.padEnd(17)}${PREDICTED_LABELS.map((p) => pad(m.confusion[g][p], 5)).join('')}`);
  lines.push(`${'label'.padEnd(17)} gold  pred   prec    rec`);
  for (const [l, s] of Object.entries(m.perLabel)) lines.push(`${l.padEnd(17)}${pad(s.gold, 5)}${pad(s.predicted, 6)}${pad(fmt(s.precision), 7)}${pad(fmt(s.recall), 7)}`);
  lines.push(`milestone (approve_decision|praise): ${formatMilestone(m.milestone)}`);
  lines.push(`correction: ${formatCorrection(m.correction)}`);
  const why = Object.entries(m.critical.byReason).map(([k, v]) => `${k} ${v}`).join(', ');
  lines.push(`critical errors: ${m.critical.count} (${why})${m.critical.count ? ` ids: ${m.critical.ids.join(', ')}` : ''}`);
  const mi = m.misses;
  lines.push(`milestone misses: ${mi.count} (<=${SHORT_MISS} chars ${mi.short}, multi_intent ${mi.multiIntent}, unsure ${mi.unsure})`);
  lines.push(`milestone rules [${SPLIT_TAG[name]}]: ${m.milestoneRules.map((r) => `${r.ruleId} ${r.correct}/${r.predicted}`).join('; ') || 'none'}`);
  lines.push(formatBaseline('gold labels', m.baseline.gold, 'gold milestones'));
  lines.push(formatBaseline('classifier, same split', m.baseline.classifier, 'predicted milestones'));
  lines.push(`unsure: ${m.unsure}; critical classes: resignation ${m.counts.resignation}, question/negation ${m.counts.questionNegation}`);
  return lines.join('\n');
}

function formatLeakage(report) {
  const l = report.leakage;
  const out = [
    `holdout leakage: sessions ${l.sessions}, in both splits ${l.sharedSessions} (test prompts in shared sessions ${l.testInSharedSessions}/${l.testPrompts}); `
      + `test prompts whose normalised text also occurs in dev: ${l.testDuplicatedInDev}/${l.testPrompts}`,
  ];
  const u = report.testUnique;
  if (u) {
    out.push(`test-unique (labeled ${u.counts.labeled}): milestone ${formatMilestone(u.milestone)}; critical ${u.critical.count}; correction ${formatAxis('label', u.correction.label)}`);
  }
  return out;
}

export function formatReport(report) {
  const c = report.coverage;
  const s = report.synthetic;
  const out = [
    `D0 gold-set eval (aggregate only; no prompt text); definitions ${report.definitions}, classifier ${report.classifierVersion}`,
    `coverage: prompts ${c.prompts}, labeled ${c.labeled}, unlabeled ${c.unlabeled}, label ids not in prompts ${c.unknownLabelIds}, duplicate labels ${c.duplicateLabels}, labeled without prediction ${c.missingPredictions}`,
    ...Object.entries(report.splits).map(([name, m]) => formatSplit(name, m)),
    ...formatLeakage(report),
    `synthetic D1 fixtures: ${s.probes} probes (resignation ${s.resignation}, question/negation ${s.questionNegation}, other ${s.other}), critical ${s.critical}`,
    'note: D6 compares like with like: the classifier baseline against classifier-measured pilot numbers, the gold baseline only against a gold-labelled pilot sample',
  ];
  if (report.gate) {
    const g = report.gate;
    out.push(
      '== gate (PLAN D2, test split) ==',
      `verdict: ${g.verdict} (precision ${fmt(g.precision)}, 95% CI ${fmtCi(g.ci)}, recall ${fmt(g.recall)}, critical ${g.critical})`,
      `correction (PLAN 4.9 item 3): ${formatCorrection(report.splits.test.correction)}`,
      ...g.reasons.map((r) => `fail: ${r}`),
      ...g.provisional.map((p) => `provisional: ${p}`),
    );
  }
  return `${out.join('\n')}\n`;
}

function writeBaseline(file, baseline) {
  assertOutsideRepo(file);
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`);
  process.stderr.write(`baseline written: ${file}\n`);
}

function main(argv) {
  const options = {
    split: { type: 'string', default: 'all' },
    json: { type: 'boolean', default: false },
    'owner-reviewed': { type: 'boolean', default: false },
    'export-baseline': { type: 'string' },
  };
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options });
  if (positionals.length !== 3) {
    throw new Error('usage: eval-gold.mjs <prompts.jsonl> <labels.jsonl> <predictions.jsonl> [--split dev|test|all] [--json] [--owner-reviewed] [--export-baseline <file>]');
  }
  const exportFile = values['export-baseline'];
  if (exportFile !== undefined) assertOutsideRepo(exportFile);
  const [prompts, labels, predictions] = positionals.map(readJsonl);
  const ownerReviewed = values['owner-reviewed'];
  const report = evaluate({ prompts, labels, predictions, split: values.split, ownerReviewed });
  process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
  if (exportFile !== undefined) writeBaseline(exportFile, baselineExport(report, values.split, { ownerReviewed }));
}

if (invokedDirectly(import.meta.filename)) runMain(main);
