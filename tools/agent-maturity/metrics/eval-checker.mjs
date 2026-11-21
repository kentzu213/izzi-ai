// Scores the repeated-error checker on a labelled pair file (format in metrics/README.md). A pair names one
// standard and one correction: inline text (synthetic tests) or a transcript + uuid pointer, read in place so real
// prompt text never has to be copied into the pair file. Output carries pair ids and numbers only.
//   node tools/agent-maturity/metrics/eval-checker.mjs --pairs <file> [--threshold n] [--json]

import path from 'node:path';
import { parseArgs } from 'node:util';

import { DEFAULT_THRESHOLD, isRepeat, normalizeStandards, scorePair } from './checker.mjs';
import { fail, isMain, parseThreshold, readJson, reason } from './cli.mjs';
import { num } from './format.mjs';
import { readOwnerPrompts } from './transcript-prompts.mjs';

const USAGE = 'usage: node tools/agent-maturity/metrics/eval-checker.mjs --pairs <file> [--threshold n] [--json]';
// Part 2 gate (docs/izzi-v2/PLAN.md, D5 row: precision >= 0.8 on >= 30 labelled pairs), made strict enough that a
// handful of lucky hits cannot pass it: the 95% Clopper-Pearson lower bound of precision must reach 0.8, which needs
// at least 17 predicted repeats with no false positive.
export const GATE = { minPairs: 30, minPredictedRepeats: 10, minDistinctCorrections: 10, minPrecisionLowerBound: 0.8, confidence: 0.95 };
const BISECT_STEPS = 60;

const ratio = (n, d) => (d === 0 ? null : n / d);

// Clopper-Pearson, copied from D0 eval/eval-gold.mjs.
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

// Every check must pass; each carries its value so a failed gate says which minimum it missed.
export function gateOf({ pairs, tp, fp, distinctCorrections }) {
  const ci = clopperPearson(tp, tp + fp);
  const check = (name, value, min) => ({ name, value, min, passed: value !== null && value >= min });
  const checks = [
    check('pairs', pairs, GATE.minPairs),
    check('predictedRepeats', tp + fp, GATE.minPredictedRepeats),
    check('distinctCorrections', distinctCorrections, GATE.minDistinctCorrections),
    check('precisionLowerBound', ci === null ? null : ci.lower, GATE.minPrecisionLowerBound),
  ];
  return { ...GATE, ci, checks, passed: checks.every((c) => c.passed) };
}

// Identity of the correction behind a pair, kept in memory only, so one correction scored against several standards
// counts once.
const correctionKey = (c, baseDir) => (typeof c.text === 'string'
  ? JSON.stringify(['text', c.text, c.project_root ?? null, c.project_id ?? null, c.at ?? null])
  : JSON.stringify(['line', path.resolve(baseDir, c.transcript).toLowerCase(), c.uuid]));

function invalid(message) {
  throw new Error(`pairs file: ${message}`);
}

function validate(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) invalid('must hold a JSON object');
  if (doc.version !== 1) invalid('version must be 1');
  if (!Array.isArray(doc.standards)) invalid('"standards" must be an array');
  if (!Array.isArray(doc.pairs)) invalid('"pairs" must be an array');
  const ids = new Set();
  doc.pairs.forEach((p, i) => {
    if (!p || typeof p !== 'object') invalid(`pair #${i + 1} must be an object`);
    if (typeof p.id !== 'string' || p.id === '') invalid(`pair #${i + 1} needs a text id`);
    if (ids.has(p.id)) invalid(`pair id ${p.id} is used twice`);
    ids.add(p.id);
    if (typeof p.standard !== 'string') invalid(`pair ${p.id} needs a standard id`);
    if (typeof p.repeat !== 'boolean') invalid(`pair ${p.id} needs "repeat": true or false`);
    const c = p.correction;
    const inline = c && typeof c.text === 'string';
    const pointer = c && typeof c.transcript === 'string' && typeof c.uuid === 'string';
    if (!inline && !pointer) invalid(`pair ${p.id} needs correction.text, or correction.transcript and correction.uuid`);
  });
}

async function promptsOf(file, cache) {
  if (!cache.has(file)) cache.set(file, new Map((await readOwnerPrompts(file)).map((p) => [p.uuid, p])));
  return cache.get(file);
}

// Pair fields override what the transcript line says (project_root, project_id, at).
async function resolveCorrection(c, baseDir, cache) {
  if (typeof c.text === 'string') return c;
  const found = (await promptsOf(path.resolve(baseDir, c.transcript), cache)).get(c.uuid);
  if (!found) return null;
  return { text: found.text, project_root: c.project_root ?? found.cwd, project_id: c.project_id, at: c.at ?? found.at };
}

export async function evaluatePairs(doc, { threshold = DEFAULT_THRESHOLD, baseDir = process.cwd() } = {}) {
  validate(doc);
  const standards = new Map(normalizeStandards(doc.standards).standards.map((s) => [s.id, s]));
  const cache = new Map();
  const results = [];
  const unresolved = [];
  const corrections = new Set();
  for (const pair of doc.pairs) {
    const standard = standards.get(pair.standard);
    const correction = standard ? await resolveCorrection(pair.correction, baseDir, cache) : null;
    if (!correction) {
      unresolved.push(pair.id);
      continue;
    }
    corrections.add(correctionKey(pair.correction, baseDir));
    const s = scorePair(correction, standard);
    results.push({
      id: pair.id,
      standard: standard.id,
      label: pair.repeat,
      predicted: isRepeat(s, threshold),
      confidence: s.confidence,
      scopeMatched: s.scopeMatched,
      eligible: s.eligible,
    });
  }
  const count = (label, predicted) => results.filter((r) => r.label === label && r.predicted === predicted).length;
  const [tp, fp, fn, tn] = [count(true, true), count(false, true), count(true, false), count(false, false)];
  const precision = ratio(tp, tp + fp);
  return {
    threshold,
    pairs: results.length,
    tp,
    fp,
    fn,
    tn,
    precision,
    recall: ratio(tp, tp + fn),
    accuracy: ratio(tp + tn, results.length),
    distinctCorrections: corrections.size,
    gate: gateOf({ pairs: results.length, tp, fp, distinctCorrections: corrections.size }),
    unresolved,
    results,
  };
}

const yesNo = (b) => (b ? 'trùng' : 'không');
const whyNot = (x) => {
  if (!x.scopeMatched) return ' (khác phạm vi)';
  return x.eligible ? '' : ' (chuẩn đã hết hiệu lực hoặc có sau lần sửa)';
};
const CHECK_LABELS = {
  pairs: 'cặp có nhãn',
  predictedRepeats: 'cặp máy đoán trùng',
  distinctCorrections: 'lần sửa khác nhau',
  precisionLowerBound: 'cận dưới khoảng tin cậy 95% của precision',
};
const checkLine = (c) => {
  const value = c.name === 'precisionLowerBound' ? num(c.value, 3) : c.value;
  const min = c.name === 'precisionLowerBound' ? num(c.min, 1) : c.min;
  return `  ${c.passed ? 'đạt' : 'CHƯA'}: ${CHECK_LABELS[c.name]} ${value} (cần từ ${min})`;
};

function formatText(r) {
  const lines = [
    `Checker lỗi bị nhắc lại v1, ngưỡng ${num(r.threshold, 2)}: ${r.pairs} cặp có nhãn, ${r.unresolved.length} cặp không đọc được`
      + `${r.unresolved.length ? ` (${r.unresolved.join(', ')})` : ''}`,
    `precision ${num(r.precision, 3)} (${r.tp}/${r.tp + r.fp}) · recall ${num(r.recall, 3)} (${r.tp}/${r.tp + r.fn}) · accuracy ${num(r.accuracy, 3)}`,
    `Cổng phần 2: ${r.gate.passed ? 'ĐẠT' : 'CHƯA ĐẠT'}`,
    ...r.gate.checks.map(checkLine),
    ...r.results.map((x) => `${x.id} ${x.standard} nhãn=${yesNo(x.label)} máy=${yesNo(x.predicted)} ${num(x.confidence, 2)}`
      + `${x.label === x.predicted ? '' : ' SAI'}${whyNot(x)}`),
  ];
  return `${lines.join('\n')}\n`;
}

async function main(argv) {
  let args;
  try {
    args = parseArgs({ args: argv, options: { pairs: { type: 'string' }, threshold: { type: 'string' }, json: { type: 'boolean' } }, strict: true }).values;
  } catch (error) {
    return fail(`${error.message}\n${USAGE}`);
  }
  if (!args.pairs) return fail(USAGE);
  const threshold = parseThreshold(args.threshold, DEFAULT_THRESHOLD);
  if (threshold === null) return fail('--threshold must be a number above 0 and at most 1');
  let result;
  try {
    result = await evaluatePairs(readJson(args.pairs), { threshold, baseDir: path.dirname(path.resolve(args.pairs)) });
  } catch (error) {
    return fail(`cannot evaluate --pairs: ${reason(error)}`);
  }
  process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : formatText(result));
  return 0;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.exitCode = fail(`eval-checker failed: ${reason(error)}`);
    },
  );
}
