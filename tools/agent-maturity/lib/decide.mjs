// Nudge decision for the upgrade-checkpoint hook (docs/izzi-v2/PLAN.md §4.3 and §4.9).
// Pure: decide(state, global, cls, info) returns new objects and never mutates its inputs.

import { FLOOR_LABELS, MILESTONE_LABELS, isWrapperPrompt } from './classify.mjs';

export const CAP_PER_SESSION = 3;
export const STRICT_CAP_PER_SESSION = 1;
export const MIN_TURN_GAP = 3;
export const PENDING_TTL_TURNS = 5;
export const RECENT_OUTCOMES = 10;
export const STRICT_TRIGGER = 6;
// Strict mode ends 7 days after it turned on; the outcome window then starts empty, so it turns on
// again only after 10 new outcomes with 6 or more skipped or unanswered.
export const STRICT_MAX_AGE_MS = 7 * 86_400_000;
// Only these entrypoints are nudged and update the shared outcome list (global.json); `claude -p` and SDK
// sessions only log.
export const NUDGE_ENTRYPOINTS = new Set(['cli', 'claude-desktop']);
const CORRECTION_LABELS = new Set(['correction', 'clarify']);
const CHOICES = new Set(['accept', 'edit', 'skip', 'ignored']);
const OUTCOMES = new Set([...CHOICES, 'abstained']);

export function freshState() {
  return {
    v: 1,
    turn: 0,
    correctionsSinceCheckpoint: 0,
    nudges: 0,
    weakNudges: 0,
    asks: 0,
    lastNudgeTurn: null,
    lastAskTurn: null,
    lastAskId: null,
    pending: null,
  };
}

export function freshGlobal() {
  return { v: 1, recentOutcomes: [], strict: false, strictSince: null };
}

const isCount = (n) => Number.isInteger(n) && n >= 0;
const isTurnOrNull = (n) => n === null || isCount(n);

export function normalizeState(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!s || s.v !== 1) return freshState();
  const counts = ['turn', 'correctionsSinceCheckpoint', 'nudges', 'weakNudges', 'asks'];
  if (!counts.every((k) => isCount(s[k]))) return freshState();
  if (!isTurnOrNull(s.lastNudgeTurn) || !isTurnOrNull(s.lastAskTurn)) return freshState();
  if (s.lastAskId !== null && typeof s.lastAskId !== 'string') return freshState();
  const p = s.pending;
  const pendingOk = p === null || (p && isCount(p.turn) && (p.kind === 'strong' || p.kind === 'weak'));
  if (!pendingOk) return freshState();
  return {
    ...freshState(),
    ...Object.fromEntries(counts.map((k) => [k, s[k]])),
    lastNudgeTurn: s.lastNudgeTurn,
    lastAskTurn: s.lastAskTurn,
    lastAskId: s.lastAskId,
    pending: p === null ? null : { turn: p.turn, kind: p.kind },
  };
}

export function normalizeGlobal(raw) {
  const g = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  if (!g || g.v !== 1 || !Array.isArray(g.recentOutcomes) || typeof g.strict !== 'boolean') return freshGlobal();
  if (!g.recentOutcomes.every((o) => OUTCOMES.has(o))) return freshGlobal();
  const strictSince = g.strict && Number.isFinite(g.strictSince) ? g.strictSince : null;
  return { v: 1, recentOutcomes: g.recentOutcomes.slice(-RECENT_OUTCOMES), strict: g.strict, strictSince };
}

const LEAD = 'The owner just gave a completion signal.';
const STRICT_NOTE = ' Strict mode is on (the owner skipped or ignored most recent checkpoints): '
  + 'ask only for a correction later approved in this task, at most once this session.';
const CLOSE = 'end your reply with an upgrade checkpoint using the `upgrade-checkpoint` skill (header `[Checkpoint nâng cấp]`). '
  + 'If you cannot, do not ask and do not mention this note. '
  + "If the work continues in a later turn, ask in that work's final report instead.";

export function nudgeText(kind, corrections, strict = false) {
  const lead = strict ? `${LEAD}${STRICT_NOTE}` : LEAD;
  if (kind === 'strong') {
    return `${lead} This task had ${corrections} correction/rejection signal(s) before it. First finish exactly what was asked. `
      + `Then, only if those corrections teach one concrete standard you can state with scope and a check, ${CLOSE}`;
  }
  return `${lead} First finish exactly what was asked. `
    + `Then, only if you used a method not already in the active standards and its result was verified in this task, ${CLOSE}`;
}

function pickNudge(s, g, info) {
  if (!info.sessionId || !NUDGE_ENTRYPOINTS.has(info.entrypoint)) return null;
  const cap = g.strict ? STRICT_CAP_PER_SESSION : CAP_PER_SESSION;
  if (s.nudges >= cap || s.asks >= cap) return null;
  const last = Math.max(s.lastNudgeTurn ?? -Infinity, s.lastAskTurn ?? -Infinity);
  if (s.turn - last < MIN_TURN_GAP) return null;
  if (s.correctionsSinceCheckpoint > 0) return 'strong';
  if (!g.strict && s.weakNudges === 0) return 'weak';
  return null;
}

function withOutcomes(g, outcomes, turn, events, nowMs) {
  if (outcomes.length === 0) return g;
  const recentOutcomes = [...g.recentOutcomes, ...outcomes].slice(-RECENT_OUTCOMES);
  const skipped = recentOutcomes.filter((o) => o === 'skip' || o === 'ignored').length;
  if (g.strict || recentOutcomes.length < RECENT_OUTCOMES || skipped < STRICT_TRIGGER) return { ...g, recentOutcomes };
  events.push({ type: 'strict_on', turn });
  return { ...g, recentOutcomes, strict: true, strictSince: Number.isFinite(nowMs) ? nowMs : null };
}

// Way out of strict mode: it ends STRICT_MAX_AGE_MS after it turned on. A strict state saved without a start
// time (older global.json) starts its clock now.
function expireStrict(g, nowMs, turn, events) {
  if (!g.strict || !Number.isFinite(nowMs)) return g;
  if (g.strictSince === null) return { ...g, strictSince: nowMs };
  if (nowMs - g.strictSince < STRICT_MAX_AGE_MS) return g;
  events.push({ type: 'strict_off', turn });
  return { ...g, recentOutcomes: [], strict: false, strictSince: null };
}

const SAFE_ASK_ID = /^[A-Za-z0-9-]{1,128}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

// What the log keeps of the ask block the owner answered (info.ask.askId, proposalSha256, floor): a safe id, the
// sha256 of its "Đề xuất" text and its safety label. Never text; a malformed value is dropped.
function askBinding(ask) {
  return {
    ...(typeof ask.askId === 'string' && SAFE_ASK_ID.test(ask.askId) ? { askId: ask.askId } : {}),
    ...(typeof ask.proposalSha256 === 'string' && SHA256_HEX.test(ask.proposalSha256) ? { proposalSha256: ask.proposalSha256 } : {}),
    ...(FLOOR_LABELS.includes(ask.floor) ? { floor: ask.floor } : {}),
  };
}

export function decide(state, global, cls, info = {}) {
  let s = normalizeState(state);
  const g0 = normalizeGlobal(global);
  const len = info.lengthBucket ?? null;
  if (isWrapperPrompt(cls)) {
    return { state: s, global: g0, context: null, events: [{ type: 'prompt', turn: s.turn, label: cls.label, ruleId: cls.ruleId, len, wrapper: true }] };
  }

  s = { ...s, turn: s.turn + 1 };
  const turn = s.turn;
  const events = [{ type: 'prompt', turn, label: cls.label, ruleId: cls.ruleId, len }];
  const outcomes = [];
  const interactive = NUDGE_ENTRYPOINTS.has(info.entrypoint);
  const g1 = interactive ? expireStrict(g0, info.nowMs, turn, events) : g0;

  // 1. Did the last assistant turn ask a checkpoint question (nudged or agent-initiated)?
  const askId = info.ask && info.ask.asked ? (info.ask.id ?? `turn-${turn}`) : null;
  const asked = askId !== null && askId !== s.lastAskId;
  if (asked) {
    const outcome = CHOICES.has(info.choice) ? info.choice : 'ignored';
    outcomes.push(outcome);
    events.push({ type: 'checkpoint_outcome', turn, outcome, initiated: s.pending ? 'nudge' : 'agent', ...askBinding(info.ask) });
    s = { ...s, asks: s.asks + 1, lastAskTurn: turn - 1, lastAskId: askId, pending: null, correctionsSinceCheckpoint: 0 };
  } else if (s.pending && turn - s.pending.turn >= PENDING_TTL_TURNS) {
    outcomes.push('abstained');
    events.push({ type: 'checkpoint_outcome', turn, outcome: 'abstained', initiated: 'nudge' });
    s = { ...s, pending: null };
  }

  // 2. Corrections and clarifications are evidence for the next checkpoint.
  if (CORRECTION_LABELS.has(cls.label)) s = { ...s, correctionsSinceCheckpoint: s.correctionsSinceCheckpoint + 1 };

  // 3. Completion milestone: the reply to a checkpoint question never counts.
  let context = null;
  if (!asked && MILESTONE_LABELS.has(cls.label)) {
    const corrections = s.correctionsSinceCheckpoint;
    const kind = pickNudge(s, g1, info);
    events.push({ type: 'milestone', turn, corrections, nudged: kind !== null });
    s = { ...s, correctionsSinceCheckpoint: 0 };
    if (kind) {
      if (s.pending) {
        outcomes.push('abstained');
        events.push({ type: 'checkpoint_outcome', turn, outcome: 'abstained', initiated: 'nudge', reason: 'superseded' });
      }
      s = {
        ...s,
        pending: { turn, kind },
        lastNudgeTurn: turn,
        nudges: s.nudges + 1,
        weakNudges: s.weakNudges + (kind === 'weak' ? 1 : 0),
      };
      context = nudgeText(kind, corrections, g1.strict);
      events.push({ type: 'nudge', turn, kind, corrections });
    }
  }

  // 4. Fatigue guard: only interactive sessions update the shared outcome list.
  const g = interactive ? withOutcomes(g1, outcomes, turn, events, info.nowMs) : g0;
  return { state: s, global: g, context, events };
}
