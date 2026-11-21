// D0: score D1 predictions against the gold labels (docs/izzi-v2/PLAN.md §2.6, §3.2 D0/D2, §4.9 item 7).
// Aggregate output only: counts, rates, label names, rule ids and prompt ids. Never prompt text, context or notes.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { classifyPrompt, MILESTONE_LABELS } from '../lib/classify.mjs';
import { invokedDirectly, readJsonl, runMain } from './io.mjs';

export const GOLD_LABELS = ['approve_decision', 'praise', 'confirm', 'flow', 'resignation', 'correction', 'clarify', 'none'];
export const PREDICTED_LABELS = [...GOLD_LABELS, 'abstain'];
export const TAGS = ['question', 'negation', 'deferral', 'completion_context', 'multi_intent'];
const CRITICAL_TAGS = ['question', 'negation', 'deferral'];
const GATE = { minPrecision: 0.9, minClassCases: 20 };
const SECTIONS = { all: ['dev', 'test', 'overall'], dev: ['dev'], test: ['test'] };

const ratio = (a, b) => (b === 0 ? null : a / b);
const isMilestone = (label) => MILESTONE_LABELS.has(label);
const hasTag = (row, tags) => row.tags.some((t) => tags.includes(t));

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
    rows.push({ id: p.id, split: p.split, sessionId: p.sessionId, ts: p.ts, order, ...g, label: pr?.label ?? null, ruleId: pr?.ruleId ?? null });
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

// Gold milestone id -> true when no gold correction came since the previous gold milestone (or session start).
// Sessions span both splits, so this runs over every labeled row before rows are split.
export function firstPassById(rows) {
  const sessions = new Map();
  for (const r of rows) sessions.set(r.sessionId, [...(sessions.get(r.sessionId) ?? []), r]);
  const result = new Map();
  for (const session of sessions.values()) {
    session.sort((a, b) => String(a.ts).localeCompare(String(b.ts)) || a.order - b.order);
    let corrections = 0;
    for (const r of session) {
      if (r.gold === 'correction') corrections += 1;
      else if (isMilestone(r.gold)) {
        result.set(r.id, corrections === 0);
        corrections = 0;
      }
    }
  }
  return result;
}

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
  return { tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) };
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

function baselineOf(rows, firstPass) {
  const corrections = rows.filter((r) => r.gold === 'correction').length;
  const milestones = rows.filter((r) => isMilestone(r.gold));
  const passed = milestones.filter((r) => firstPass.get(r.id) === true).length;
  return {
    prompts: rows.length,
    corrections,
    correctionsPer100: rows.length === 0 ? null : (corrections * 100) / rows.length,
    milestones: milestones.length,
    firstPass: passed,
    firstPassRate: ratio(passed, milestones.length),
  };
}

export function splitMetrics(rows, firstPass) {
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
    critical: criticalOf(scored),
    milestoneRules: milestoneRulesOf(scored),
    unsure: rows.filter((r) => r.unsure).length,
    baseline: baselineOf(rows, firstPass),
  };
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

// PLAN D2 gate on the test split: milestone precision >= 0.9, zero critical errors.
export function gateVerdict(test, synthetic) {
  const { milestone, critical, counts } = test;
  const reasons = [];
  if (milestone.precision === null) reasons.push('no predicted milestones on test: precision undefined');
  else if (milestone.precision < GATE.minPrecision) {
    reasons.push(`test milestone precision ${fmt(milestone.precision)} < ${GATE.minPrecision} (${milestone.tp}/${milestone.tp + milestone.fp})`);
  }
  if (critical.count > 0) reasons.push(`critical errors on test: ${critical.count} (${critical.ids.join(', ')})`);
  if (synthetic.critical > 0) reasons.push(`synthetic held-out critical errors: ${synthetic.critical}`);
  const missing = counts.labeled - counts.scored;
  if (missing > 0) reasons.push(`labeled test items without a prediction: ${missing}`);
  const warnings = [];
  if (counts.resignation < GATE.minClassCases) {
    warnings.push(`test resignation cases: ${counts.resignation} (< ${GATE.minClassCases}); synthetic fixtures cover ${synthetic.resignation} (critical ${synthetic.critical})`);
  }
  if (counts.questionNegation < GATE.minClassCases) {
    warnings.push(`test question/negation cases: ${counts.questionNegation} (< ${GATE.minClassCases}); synthetic fixtures cover ${synthetic.questionNegation} (critical ${synthetic.critical})`);
  }
  return { pass: reasons.length === 0, precision: milestone.precision, recall: milestone.recall, critical: critical.count, reasons, warnings };
}

export function evaluate({ prompts, labels, predictions, split = 'all', synthetic = syntheticCoverage() }) {
  const sections = SECTIONS[split];
  if (!sections) throw new Error('--split must be dev, test or all');
  const { rows, coverage } = joinRows(prompts, labels, predictions);
  const firstPass = firstPassById(rows);
  const rowsOf = (name) => (name === 'overall' ? rows : rows.filter((r) => r.split === name));
  const splits = Object.fromEntries(sections.map((name) => [name, splitMetrics(rowsOf(name), firstPass)]));
  const report = { coverage, splits, synthetic };
  if (splits.test) report.gate = gateVerdict(splits.test, synthetic);
  return report;
}

const SHORT = { approve_decision: 'appr', praise: 'prai', confirm: 'conf', flow: 'flow', resignation: 'resi', correction: 'corr', clarify: 'clar', none: 'none', abstain: 'abst' };
const pad = (s, n) => String(s).padStart(n);

function formatSplit(name, m) {
  const lines = [`== ${name} (labeled ${m.counts.labeled}, scored ${m.counts.scored}) ==`, 'confusion (rows = gold, columns = predicted)'];
  lines.push(`${''.padEnd(17)}${PREDICTED_LABELS.map((p) => pad(SHORT[p], 5)).join('')}`);
  for (const g of GOLD_LABELS) lines.push(`${g.padEnd(17)}${PREDICTED_LABELS.map((p) => pad(m.confusion[g][p], 5)).join('')}`);
  lines.push(`${'label'.padEnd(17)} gold  pred   prec    rec`);
  for (const [l, s] of Object.entries(m.perLabel)) lines.push(`${l.padEnd(17)}${pad(s.gold, 5)}${pad(s.predicted, 6)}${pad(fmt(s.precision), 7)}${pad(fmt(s.recall), 7)}`);
  const ms = m.milestone;
  lines.push(`milestone (approve_decision|praise): precision ${fmt(ms.precision)} (${ms.tp}/${ms.tp + ms.fp}), recall ${fmt(ms.recall)} (${ms.tp}/${ms.tp + ms.fn})`);
  const why = Object.entries(m.critical.byReason).map(([k, v]) => `${k} ${v}`).join(', ');
  lines.push(`critical errors: ${m.critical.count} (${why})${m.critical.count ? ` ids: ${m.critical.ids.join(', ')}` : ''}`);
  lines.push(`milestone rules: ${m.milestoneRules.map((r) => `${r.ruleId} ${r.correct}/${r.predicted}`).join('; ') || 'none'}`);
  const b = m.baseline;
  lines.push(`baseline: corrections ${b.correctionsPer100 === null ? 'n/a' : b.correctionsPer100.toFixed(1)} per 100 prompts (${b.corrections}/${b.prompts}); first-pass approval ${fmt(b.firstPassRate)} (${b.firstPass}/${b.milestones} gold milestones)`);
  lines.push(`unsure: ${m.unsure}; critical classes: resignation ${m.counts.resignation}, question/negation ${m.counts.questionNegation}`);
  return lines.join('\n');
}

export function formatReport(report) {
  const c = report.coverage;
  const s = report.synthetic;
  const out = [
    'D0 gold-set eval (aggregate only; no prompt text)',
    `coverage: prompts ${c.prompts}, labeled ${c.labeled}, unlabeled ${c.unlabeled}, label ids not in prompts ${c.unknownLabelIds}, duplicate labels ${c.duplicateLabels}, labeled without prediction ${c.missingPredictions}`,
    ...Object.entries(report.splits).map(([name, m]) => formatSplit(name, m)),
    `synthetic D1 fixtures: ${s.probes} probes (resignation ${s.resignation}, question/negation ${s.questionNegation}, other ${s.other}), critical ${s.critical}`,
  ];
  if (report.gate) {
    const g = report.gate;
    out.push('== gate (PLAN D2, test split) ==', `verdict: ${g.pass ? 'PASS' : 'FAIL'} (precision ${fmt(g.precision)}, recall ${fmt(g.recall)}, critical ${g.critical})`);
    out.push(...g.reasons.map((r) => `- ${r}`), ...g.warnings.map((w) => `warning: ${w}`));
  }
  return `${out.join('\n')}\n`;
}

function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { split: { type: 'string', default: 'all' }, json: { type: 'boolean', default: false } } });
  if (positionals.length !== 3) throw new Error('usage: eval-gold.mjs <prompts.jsonl> <labels.jsonl> <predictions.jsonl> [--split dev|test|all] [--json]');
  const [prompts, labels, predictions] = positionals.map(readJsonl);
  const report = evaluate({ prompts, labels, predictions, split: values.split });
  process.stdout.write(values.json ? `${JSON.stringify(report, null, 2)}\n` : formatReport(report));
}

if (invokedDirectly(import.meta.filename)) runMain(main);
