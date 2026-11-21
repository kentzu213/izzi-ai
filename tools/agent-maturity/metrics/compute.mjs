// Metrics over the D1 hook event log (docs/izzi-v2/PLAN.md §2.6, D5 part 1). Pure: no I/O, inputs are not changed.
// Only interactive sessions (the entrypoints D1 nudges) with a session id are counted: they carry the owner's
// typed prompts, like the D0 baseline. Definitions: metrics/README.md.

import { NUDGE_ENTRYPOINTS, STRICT_MAX_AGE_MS } from '../lib/decide.mjs';

// Definitions shared with D0 (eval/eval-gold.mjs): corrections per 100 = (correction + clarify) per 100 owner prompts;
// first-pass and reopened as in milestonesOf(). A baseline is compared only when it carries the same version.
export const METRICS_VERSION = 'metrics@1';
// Same evidence labels as D1 decide(): a clarification counts like a correction.
export const CORRECTION_LABELS = new Set(['correction', 'clarify']);
// Reopen estimate: a correction within this many owner prompts after a milestone, before the next milestone.
export const REOPEN_WINDOW_PROMPTS = 3;
// Fatigue alarm: this many skipped or unanswered among the last FATIGUE_WINDOW checkpoint questions.
export const FATIGUE_WINDOW = 10;
export const FATIGUE_TRIGGER = 6;
const ANSWERS = ['accept', 'edit', 'skip', 'ignored'];
// A prompt that answers a checkpoint question is not an owner prompt: D0's history has no such prompts, and counting
// them would grow the denominator. An ignored ask means the owner typed something else, so that prompt stays.
const ANSWERED = new Set(['accept', 'edit', 'skip']);

const ratio = (n, d) => (d === 0 ? null : n / d);
const iso = (ms) => new Date(ms).toISOString();
const isOwnerPrompt = (e) => e.type === 'prompt' && !e.wrapper && !e.checkpointAnswer;
const isAnswer = (e) => e.type === 'checkpoint_outcome' && ANSWERS.includes(e.outcome);

// Stable sort by time: events of one hook run share a ts and keep their log order.
function byTime(events) {
  return events
    .map((e, i) => ({ e, i, ms: Date.parse(e.ts) }))
    .sort((a, b) => a.ms - b.ms || a.i - b.i)
    .map(({ e, ms }) => ({ ...e, ms }));
}

// The prompt and the checkpoint_outcome of one hook run share session, ts and turn.
const runKey = (e) => JSON.stringify([e.session, e.ts, e.turn]);
function markAnswers(events) {
  const answered = new Set(events.filter((e) => e.type === 'checkpoint_outcome' && ANSWERED.has(e.outcome)).map(runKey));
  return events.map((e) => (e.type === 'prompt' && !e.wrapper && answered.has(runKey(e)) ? { ...e, checkpointAnswer: true } : e));
}

function split(events, sinceMs) {
  const kept = [];
  const excluded = { wrapperPrompts: 0, nonInteractivePrompts: 0, noSession: 0, checkpointAnswers: 0 };
  for (const e of events) {
    const countable = e.type === 'prompt' && e.ms >= sinceMs;
    if (!NUDGE_ENTRYPOINTS.has(e.ep)) {
      if (countable) excluded.nonInteractivePrompts += 1;
    } else if (typeof e.session !== 'string' || e.session === '') {
      if (countable) excluded.noSession += 1;
    } else {
      if (countable && e.wrapper) excluded.wrapperPrompts += 1;
      else if (countable && e.checkpointAnswer) excluded.checkpointAnswers += 1;
      kept.push(e);
    }
  }
  return { kept, excluded };
}

// One entry per milestone: passed = no correction since the previous milestone (or the session's first event);
// reopened = a correction among the next REOPEN_WINDOW_PROMPTS owner prompts, before the next milestone.
function milestonesOf(events) {
  const sessions = new Map();
  for (const e of events) {
    if (!sessions.has(e.session)) sessions.set(e.session, []);
    sessions.get(e.session).push(e);
  }
  const result = [];
  for (const list of sessions.values()) {
    let corrections = 0;
    let watch = null;
    for (const e of list) {
      if (isOwnerPrompt(e)) {
        const isCorrection = CORRECTION_LABELS.has(e.label);
        if (watch) {
          watch.after += 1;
          if (isCorrection) watch.milestone.reopened = true;
          if (isCorrection || watch.after >= REOPEN_WINDOW_PROMPTS) watch = null;
        }
        if (isCorrection) corrections += 1;
      } else if (e.type === 'milestone') {
        const milestone = { ms: e.ms, passed: corrections === 0, reopened: false };
        result.push(milestone);
        watch = { milestone, after: 0 };
        corrections = 0;
      }
    }
  }
  return result;
}

function checkpointsOf(events) {
  const nudges = events.filter((e) => e.type === 'nudge');
  const asked = events.filter(isAnswer);
  const outcomes = Object.fromEntries(ANSWERS.map((a) => [a, asked.filter((e) => e.outcome === a).length]));
  return {
    nudged: {
      total: nudges.length,
      strong: nudges.filter((e) => e.kind === 'strong').length,
      weak: nudges.filter((e) => e.kind === 'weak').length,
    },
    asked: {
      total: asked.length,
      afterNudge: asked.filter((e) => e.initiated === 'nudge').length,
      agentInitiated: asked.filter((e) => e.initiated === 'agent').length,
    },
    abstained: events.filter((e) => e.type === 'checkpoint_outcome' && e.outcome === 'abstained').length,
    outcomes,
    rates: Object.fromEntries(ANSWERS.map((a) => [a, ratio(outcomes[a], asked.length)])),
  };
}

// D1 turns strict mode off STRICT_MAX_AGE_MS after strict_on, logging strict_off only at the next prompt.
function strictOf(events, nowMs) {
  const last = events.filter((e) => e.type === 'strict_on' || e.type === 'strict_off').at(-1);
  if (!last || last.type === 'strict_off') return { on: false, since: null, expiresAt: null };
  const expiresMs = last.ms + STRICT_MAX_AGE_MS;
  return { on: nowMs < expiresMs, since: iso(last.ms), expiresAt: iso(expiresMs) };
}

function fatigueOf(events) {
  const recent = events.filter(isAnswer).slice(-FATIGUE_WINDOW);
  const skippedOrIgnored = recent.filter((e) => e.outcome === 'skip' || e.outcome === 'ignored').length;
  return { size: FATIGUE_WINDOW, trigger: FATIGUE_TRIGGER, window: recent.length, skippedOrIgnored, alarm: skippedOrIgnored >= FATIGUE_TRIGGER };
}

// Counts use events from sinceMs on; tasks, strict mode and the fatigue window read the whole log.
export function computeMetrics(events, { sinceMs, nowMs }) {
  const { kept, excluded } = split(markAnswers(byTime(events)), sinceMs);
  const windowed = kept.filter((e) => e.ms >= sinceMs);
  const prompts = windowed.filter(isOwnerPrompt);
  const correction = prompts.filter((e) => e.label === 'correction').length;
  const clarify = prompts.filter((e) => e.label === 'clarify').length;
  const total = correction + clarify;
  const milestones = milestonesOf(kept).filter((m) => m.ms >= sinceMs);
  const passed = milestones.filter((m) => m.passed).length;
  const reopened = milestones.filter((m) => m.reopened).length;
  return {
    window: { since: iso(sinceMs), now: iso(nowMs) },
    prompts: prompts.length,
    excluded,
    corrections: { correction, clarify, total, per100Prompts: prompts.length === 0 ? null : (total * 100) / prompts.length },
    milestones: milestones.length,
    firstPass: { milestones: milestones.length, passed, rate: ratio(passed, milestones.length) },
    reopened: { estimate: true, windowPrompts: REOPEN_WINDOW_PROMPTS, milestones: milestones.length, reopened, rate: ratio(reopened, milestones.length) },
    checkpoints: checkpointsOf(windowed),
    strict: strictOf(kept, nowMs),
    fatigue: fatigueOf(kept),
  };
}
