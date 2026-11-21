import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { parseBaseline, compareToBaseline } from '../metrics/baseline.mjs';
import { computeMetrics, FATIGUE_TRIGGER, FATIGUE_WINDOW, REOPEN_WINDOW_PROMPTS } from '../metrics/compute.mjs';
import { parseEventLines } from '../metrics/events.mjs';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const SINCE = Date.parse('2026-11-10T00:00:00Z');
const NOW = Date.parse('2026-11-20T00:00:00Z');
const DAY = 86_400_000;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

function fixtureMetrics(options = {}) {
  const { events } = parseEventLines(fixture('metrics-events.jsonl'));
  return computeMetrics(events, { sinceMs: SINCE, nowMs: NOW, ...options });
}

// Builds interactive events one hook run at a time: ev(ts offset in minutes, session, type, fields).
function ev(minute, type, fields = {}, session = 's1', ep = 'cli') {
  return { ts: new Date(SINCE + minute * 60_000).toISOString(), session, ep, type, ...fields };
}
const prompt = (minute, label, session, ep) => ev(minute, 'prompt', { label }, session, ep);
const outcome = (minute, value, initiated = 'nudge') => ev(minute, 'checkpoint_outcome', { outcome: value, initiated });

test('event lines: malformed lines and lines without a valid ts or type are skipped', () => {
  const text = [
    '{"ts":"2026-11-12T08:00:00.000Z","type":"prompt","label":"none","session":"a","ep":"cli"}',
    '{not json',
    '{"type":"prompt"}',
    '{"ts":"yesterday","type":"prompt"}',
    '[1,2]',
    '',
  ].join('\n');
  const { events, skipped } = parseEventLines(text);
  assert.equal(events.length, 1);
  assert.equal(skipped, 4);
});

test('fixture log: prompt and correction counts, clarify counted as a correction', () => {
  const m = fixtureMetrics();
  assert.equal(m.prompts, 23);
  assert.deepEqual(m.excluded, { wrapperPrompts: 1, nonInteractivePrompts: 2, noSession: 0 });
  assert.equal(m.corrections.correction, 4);
  assert.equal(m.corrections.clarify, 1);
  assert.equal(m.corrections.total, 5);
  close(m.corrections.per100Prompts, (5 * 100) / 23);
});

test('fixture log: milestones and first-pass approval use corrections since the previous milestone', () => {
  const m = fixtureMetrics();
  assert.equal(m.milestones, 7);
  assert.equal(m.firstPass.milestones, 7);
  // The s-old milestone inside the window fails: its correction came before the window started.
  assert.equal(m.firstPass.passed, 3);
  close(m.firstPass.rate, 3 / 7);
});

test('fixture log: reopened-after-approval estimate looks at the next prompts before the next milestone', () => {
  const m = fixtureMetrics();
  assert.equal(REOPEN_WINDOW_PROMPTS, 3);
  assert.equal(m.reopened.estimate, true);
  assert.equal(m.reopened.windowPrompts, REOPEN_WINDOW_PROMPTS);
  assert.equal(m.reopened.milestones, 7);
  assert.equal(m.reopened.reopened, 2);
  close(m.reopened.rate, 2 / 7);
});

test('fixture log: checkpoint nudges, asks, agent abstentions and answer rates', () => {
  const c = fixtureMetrics().checkpoints;
  assert.deepEqual(c.nudged, { total: 3, strong: 2, weak: 1 });
  assert.deepEqual(c.asked, { total: 3, afterNudge: 1, agentInitiated: 2 });
  assert.equal(c.abstained, 1);
  assert.deepEqual(c.outcomes, { accept: 1, edit: 0, skip: 1, ignored: 1 });
  close(c.rates.accept, 1 / 3);
  assert.equal(c.rates.edit, 0);
  close(c.rates.skip, 1 / 3);
  close(c.rates.ignored, 1 / 3);
});

test('fixture log: strict mode off, fatigue window reads every asked outcome including those before --since', () => {
  const m = fixtureMetrics();
  assert.deepEqual(m.strict, { on: false, since: null, expiresAt: null });
  assert.deepEqual(m.fatigue, { size: FATIGUE_WINDOW, trigger: FATIGUE_TRIGGER, window: 4, skippedOrIgnored: 3, alarm: false });
});

test('a later --since drops earlier prompts and milestones but keeps the open task corrections', () => {
  const m = fixtureMetrics({ sinceMs: Date.parse('2026-11-13T00:00:00Z') });
  assert.equal(m.prompts, 10);
  assert.equal(m.milestones, 3);
  assert.equal(m.firstPass.passed, 3);
  assert.equal(m.checkpoints.nudged.total, 1);
});

test('empty log gives zero counts and null rates', () => {
  const m = computeMetrics([], { sinceMs: SINCE, nowMs: NOW });
  assert.equal(m.prompts, 0);
  assert.equal(m.corrections.per100Prompts, null);
  assert.equal(m.firstPass.rate, null);
  assert.equal(m.reopened.rate, null);
  assert.equal(m.checkpoints.rates.accept, null);
  assert.equal(m.fatigue.alarm, false);
});

test('fatigue alarm: 6 skipped or unanswered in the last 10 asks', () => {
  const six = ['skip', 'ignored', 'skip', 'accept', 'skip', 'edit', 'ignored', 'accept', 'skip', 'accept'];
  const m = computeMetrics(six.map((o, i) => outcome(i, o)), { sinceMs: SINCE, nowMs: NOW });
  assert.equal(m.fatigue.window, 10);
  assert.equal(m.fatigue.skippedOrIgnored, 6);
  assert.equal(m.fatigue.alarm, true);
});

test('fatigue alarm stays off at 5 of 10', () => {
  const five = ['skip', 'ignored', 'skip', 'accept', 'skip', 'edit', 'ignored', 'accept', 'accept', 'accept'];
  const m = computeMetrics(five.map((o, i) => outcome(i, o)), { sinceMs: SINCE, nowMs: NOW });
  assert.equal(m.fatigue.skippedOrIgnored, 5);
  assert.equal(m.fatigue.alarm, false);
});

test('fatigue alarm only reads the 10 most recent asks', () => {
  const twelve = ['skip', 'skip', 'skip', 'ignored', 'skip', 'accept', 'accept', 'edit', 'accept', 'accept', 'accept', 'skip'];
  const m = computeMetrics(twelve.map((o, i) => outcome(i, o)), { sinceMs: SINCE, nowMs: NOW });
  assert.equal(m.fatigue.window, 10);
  assert.equal(m.fatigue.skippedOrIgnored, 4);
  assert.equal(m.fatigue.alarm, false);
});

test('fatigue alarm ignores agent abstentions and non-interactive sessions', () => {
  const events = [
    ...['skip', 'skip', 'ignored', 'skip', 'skip'].map((o, i) => outcome(i, o)),
    ...[10, 11, 12, 13].map((i) => outcome(i, 'abstained')),
    ev(20, 'checkpoint_outcome', { outcome: 'skip', initiated: 'agent' }, 's2', 'sdk-cli'),
  ];
  const five = computeMetrics(events, { sinceMs: SINCE, nowMs: NOW });
  assert.equal(five.fatigue.window, 5);
  assert.equal(five.fatigue.alarm, false);
  const six = computeMetrics([...events, outcome(30, 'ignored')], { sinceMs: SINCE, nowMs: NOW });
  assert.equal(six.fatigue.skippedOrIgnored, 6);
  assert.equal(six.fatigue.alarm, true, 'six of the last (fewer than 10) asks already raise the alarm');
});

test('strict mode: on after strict_on, off after strict_off, expired after 7 days', () => {
  const on = [ev(0, 'strict_on', { turn: 4 })];
  const since = new Date(SINCE).toISOString();
  const expires = new Date(SINCE + 7 * DAY).toISOString();
  assert.deepEqual(computeMetrics(on, { sinceMs: SINCE, nowMs: SINCE + DAY }).strict, { on: true, since, expiresAt: expires });
  assert.deepEqual(computeMetrics(on, { sinceMs: SINCE, nowMs: SINCE + 8 * DAY }).strict, { on: false, since, expiresAt: expires });
  const off = [...on, ev(60, 'strict_off', { turn: 9 })];
  assert.deepEqual(computeMetrics(off, { sinceMs: SINCE, nowMs: SINCE + DAY }).strict, { on: false, since: null, expiresAt: null });
});

test('strict mode state is read from the whole log, not only the --since window', () => {
  const m = computeMetrics([ev(-60, 'strict_on', { turn: 4 })], { sinceMs: SINCE, nowMs: SINCE + DAY });
  assert.equal(m.strict.on, true);
});

test('events without a session are excluded and counted', () => {
  const m = computeMetrics([prompt(0, 'correction', null), prompt(1, 'none')], { sinceMs: SINCE, nowMs: NOW });
  assert.equal(m.prompts, 1);
  assert.equal(m.excluded.noSession, 1);
  assert.equal(m.corrections.total, 0);
});

test('first pass counts clarify like correction and resets at every milestone', () => {
  const events = [
    prompt(0, 'clarify'),
    prompt(1, 'praise'), ev(1, 'milestone', { corrections: 1, nudged: false }),
    prompt(2, 'none'),
    prompt(3, 'none'),
    prompt(4, 'none'),
    prompt(5, 'approve_decision'), ev(5, 'milestone', { corrections: 0, nudged: false }),
  ];
  const m = computeMetrics(events, { sinceMs: SINCE, nowMs: NOW });
  assert.equal(m.firstPass.milestones, 2);
  assert.equal(m.firstPass.passed, 1);
  assert.equal(m.reopened.reopened, 0);
});

test('reopen: a correction as the third prompt after a milestone counts, the fourth does not', () => {
  const base = [prompt(0, 'approve_decision'), ev(0, 'milestone', { corrections: 0, nudged: false }), prompt(1, 'none'), prompt(2, 'flow')];
  const third = computeMetrics([...base, prompt(3, 'correction')], { sinceMs: SINCE, nowMs: NOW });
  assert.equal(third.reopened.reopened, 1);
  const fourth = computeMetrics([...base, prompt(3, 'none'), prompt(4, 'correction')], { sinceMs: SINCE, nowMs: NOW });
  assert.equal(fourth.reopened.reopened, 0);
});

test('reopen: wrapper prompts do not use up the window and sessions do not mix', () => {
  const events = [
    prompt(0, 'approve_decision'), ev(0, 'milestone', { corrections: 0, nudged: false }),
    ev(1, 'prompt', { label: 'abstain', wrapper: true }),
    ev(2, 'prompt', { label: 'abstain', wrapper: true }),
    ev(3, 'prompt', { label: 'abstain', wrapper: true }),
    prompt(4, 'correction', 'other-session'),
    prompt(5, 'none'),
    prompt(6, 'none'),
    prompt(7, 'correction'),
  ];
  const m = computeMetrics(events, { sinceMs: SINCE, nowMs: NOW });
  assert.equal(m.reopened.reopened, 1);
  assert.equal(m.excluded.wrapperPrompts, 3);
});

test('baseline: both instruments parsed, classifier is like for like, gold is reference only', () => {
  const baseline = parseBaseline(JSON.parse(fixture('metrics-baseline.json')));
  const comparisons = compareToBaseline(fixtureMetrics(), baseline);
  assert.deepEqual(comparisons.map((c) => [c.instrument, c.likeForLike]), [['classifier', true], ['gold', false]]);
  const [classifier, gold] = comparisons;
  close(classifier.firstPassRate.current, 3 / 7);
  assert.equal(classifier.firstPassRate.baseline, 0.5);
  close(classifier.firstPassRate.delta, 3 / 7 - 0.5);
  assert.equal(classifier.correctionsPer100.baseline, 2.5);
  close(classifier.correctionsPer100.delta, (5 * 100) / 23 - 2.5);
  assert.equal(gold.firstPassRate.baseline, 0.817);
  assert.equal(gold.correctionsPer100.baseline, 14.3);
});

test('baseline: one instrument is enough and a missing value compares as null', () => {
  const baseline = parseBaseline({ instruments: { classifier: { firstPassRate: 0.9 } } });
  const [c] = compareToBaseline(fixtureMetrics(), baseline);
  assert.equal(c.instrument, 'classifier');
  assert.equal(c.correctionsPer100.baseline, null);
  assert.equal(c.correctionsPer100.delta, null);
  const empty = compareToBaseline(computeMetrics([], { sinceMs: SINCE, nowMs: NOW }), baseline);
  assert.equal(empty[0].firstPassRate.delta, null);
});

test('baseline: invalid files are rejected with a message', () => {
  const bad = [
    null,
    [],
    {},
    { instruments: {} },
    { instruments: { human: { firstPassRate: 0.8 } } },
    { instruments: { gold: { firstPassRate: 1.2 } } },
    { instruments: { gold: { firstPassRate: '0.8' } } },
    { instruments: { gold: { correctionsPer100: -1 } } },
    { instruments: { gold: {} } },
    { instruments: { gold: { firstPassRate: 0.8, extra: 1 } } },
  ];
  for (const value of bad) assert.throws(() => parseBaseline(value), /baseline/i, JSON.stringify(value));
});
