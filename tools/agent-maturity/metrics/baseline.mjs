// D0 baseline input for the report: the agent-maturity/baseline@1 file written by D0
// (eval/eval-gold.mjs --export-baseline). Values are never built in. Format: metrics/README.md.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { METRICS_VERSION } from './compute.mjs';

export const BASELINE_SCHEMA = 'agent-maturity/baseline@1';
export const INSTRUMENTS = ['classifier', 'gold'];
// The hook log is labelled by the D1 classifier, so only a classifier baseline measures the same thing.
export const LIKE_FOR_LIKE = 'classifier';
export const GOLD_WARNING = 'gold labels are another instrument: the hook log is labelled by the classifier, so no delta '
  + 'is computed; comparing with gold needs a gold-labelled sample of the pilot';
const RATES = ['firstPassRate', 'correctionsPer100', 'reopenedRate'];
const SHARES = new Set(['firstPassRate', 'reopenedRate']);
const CLASSIFY_FILE = fileURLToPath(new URL('../lib/classify.mjs', import.meta.url));

// Same rule as D0 classifierVersion(): first 12 hex of sha256 over classify.mjs with LF line endings.
export function classifierVersion(file = CLASSIFY_FILE) {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function fail(message) {
  throw new Error(`baseline: ${message}`);
}

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;

function parseRate(name, key, value) {
  if (value === null) return null;
  const ok = typeof value === 'number' && Number.isFinite(value) && value >= 0 && (!SHARES.has(key) || value <= 1);
  if (!ok) fail(`${name}.${key} must be ${SHARES.has(key) ? 'a number from 0 to 1' : 'a number of 0 or more'}, or null`);
  return value;
}

function parseInstrument(name, value) {
  if (!isObject(value)) fail(`${name} must be an object`);
  for (const key of Object.keys(value)) if (!RATES.includes(key)) fail(`${name}.${key} is not a known field`);
  for (const key of RATES) if (!(key in value)) fail(`${name}.${key} is missing`);
  return Object.fromEntries(RATES.map((key) => [key, parseRate(name, key, value[key])]));
}

// n: { prompts: { classifier, gold }, milestones: { classifier, gold } }, shown with the baseline.
function parseCounts(n) {
  if (n === undefined) return null;
  if (!isObject(n)) fail('"n" must be an object');
  for (const [group, counts] of Object.entries(n)) {
    if (!isObject(counts) || !Object.values(counts).every(isCount)) fail(`n.${group} must hold counts per instrument`);
  }
  return n;
}

export function parseBaseline(value) {
  if (!isObject(value)) fail('the file must hold a JSON object');
  if (value.schema !== BASELINE_SCHEMA) fail(`"schema" must be "${BASELINE_SCHEMA}" (export it with D0 eval-gold.mjs --export-baseline)`);
  if (typeof value.definitions !== 'string' || value.definitions === '') fail('"definitions" must be text, such as metrics@1');
  if (typeof value.classifierVersion !== 'string' || !/^[0-9a-f]{12}$/.test(value.classifierVersion)) {
    fail('"classifierVersion" must be 12 lower-case hex characters');
  }
  if (typeof value.split !== 'string' || value.split === '') fail('"split" must be text');
  if (typeof value.ownerReviewed !== 'boolean') fail('"ownerReviewed" must be true or false');
  const { instruments } = value;
  if (!isObject(instruments)) fail('an "instruments" object is required');
  const names = Object.keys(instruments);
  if (names.length === 0) fail('"instruments" is empty');
  for (const name of names) if (!INSTRUMENTS.includes(name)) fail(`unknown instrument "${name}" (use classifier or gold)`);
  return {
    definitions: value.definitions,
    classifierVersion: value.classifierVersion,
    split: value.split,
    ownerReviewed: value.ownerReviewed,
    n: parseCounts(value.n),
    instruments: Object.fromEntries(INSTRUMENTS.filter((n) => n in instruments).map((n) => [n, parseInstrument(n, instruments[n])])),
  };
}

const delta = (current, base) => (current === null || base === null ? null : current - base);

// Deltas only for the classifier instrument, and only when the baseline uses the same metric definitions and the same
// classifier as this report; otherwise every delta is null and `reasons` says why.
export function compareToBaseline(metrics, baseline, { classifierVersion: current = classifierVersion() } = {}) {
  const reasons = [];
  if (baseline.definitions !== METRICS_VERSION) reasons.push(`definitions: baseline ${baseline.definitions}, current ${METRICS_VERSION}`);
  if (baseline.classifierVersion !== current) reasons.push(`classifierVersion: baseline ${baseline.classifierVersion}, current ${current}`);
  const comparable = reasons.length === 0;
  const now = { firstPassRate: metrics.firstPass.rate, correctionsPer100: metrics.corrections.per100Prompts, reopenedRate: metrics.reopened.rate };
  const comparisons = Object.entries(baseline.instruments).map(([instrument, b]) => {
    const likeForLike = instrument === LIKE_FOR_LIKE;
    const withDelta = likeForLike && comparable;
    const values = Object.fromEntries(RATES.map((k) => [k, { current: now[k], baseline: b[k], delta: withDelta ? delta(now[k], b[k]) : null }]));
    return { instrument, likeForLike, ...values, ...(likeForLike ? {} : { warning: GOLD_WARNING }) };
  });
  return {
    split: baseline.split,
    ownerReviewed: baseline.ownerReviewed,
    n: baseline.n,
    definitions: { baseline: baseline.definitions, current: METRICS_VERSION },
    classifierVersion: { baseline: baseline.classifierVersion, current },
    comparable,
    reasons,
    comparisons,
  };
}
