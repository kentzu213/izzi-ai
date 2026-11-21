import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CAP_PER_SESSION,
  PENDING_TTL_TURNS,
  decide,
  freshGlobal,
  freshState,
  normalizeGlobal,
  normalizeState,
} from '../lib/decide.mjs';

const L = {
  approve: { label: 'approve_decision', ruleId: 'approve_decision:merge' },
  praise: { label: 'praise', ruleId: 'praise:duoc-roi' },
  correction: { label: 'correction', ruleId: 'correction:lam-lai' },
  clarify: { label: 'clarify', ruleId: 'clarify:chua-hieu' },
  flow: { label: 'flow', ruleId: 'flow:tiep-tuc' },
  none: { label: 'none', ruleId: 'none' },
  wrapper: { label: 'abstain', ruleId: 'abstain:wrapper' },
  slash: { label: 'abstain', ruleId: 'abstain:slash-command' },
};

const BASE_INFO = { sessionId: 's-1', entrypoint: 'cli', ask: null, choice: null, lengthBucket: '<=40' };

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

// Feeds a list of steps; each step is a label key or { cls, ask, choice, info }.
function run(steps, start = {}) {
  let state = start.state ?? freshState();
  let global = start.global ?? freshGlobal();
  const results = [];
  for (const step of steps) {
    const s = typeof step === 'string' ? { cls: L[step] } : step;
    const info = { ...BASE_INFO, ...(s.info ?? {}), ask: s.ask ?? null, choice: s.choice ?? null };
    const r = decide(deepFreeze(state), deepFreeze(global), s.cls ?? L[s.key], info);
    results.push(r);
    state = r.state;
    global = r.global;
  }
  return { results, state, global };
}

const nudgeOf = (r) => r.events.find((e) => e.type === 'nudge') ?? null;
const outcomeOf = (r) => r.events.find((e) => e.type === 'checkpoint_outcome') ?? null;
const ask = (id) => ({ asked: true, id });

test('approval after one correction gives a strong nudge and resets the correction count', () => {
  const { results, state } = run(['correction', 'approve']);
  assert.equal(results[0].context, null);
  assert.equal(nudgeOf(results[1]).kind, 'strong');
  assert.match(results[1].context, /1 correction\/rejection signal/);
  assert.match(results[1].context, /\[Checkpoint nâng cấp\]/);
  assert.ok(results[1].context.length <= 700);
  assert.equal(state.correctionsSinceCheckpoint, 0);
  assert.deepEqual(state.pending, { turn: 2, kind: 'strong' });
});

test('clarify counts as a correction signal', () => {
  const { results } = run(['clarify', 'praise']);
  assert.equal(nudgeOf(results[1]).kind, 'strong');
});

test('approval without corrections gives a weak nudge only once per session', () => {
  const { results } = run(['approve', 'none', 'none', 'none', 'praise', 'none', 'none', 'none', 'approve']);
  assert.equal(nudgeOf(results[0]).kind, 'weak');
  assert.ok(results[0].context.length <= 700);
  assert.match(results[0].context, /verified in this task/);
  assert.equal(nudgeOf(results[4]), null);
  assert.equal(nudgeOf(results[8]), null);
});

test('flow after a correction never nudges', () => {
  const { results, state } = run(['correction', 'flow', 'flow']);
  assert.ok(results.every((r) => r.context === null && nudgeOf(r) === null));
  assert.equal(state.correctionsSinceCheckpoint, 1);
});

test('two approvals in a row only nudge on the first', () => {
  const { results } = run(['correction', 'approve', 'correction', 'approve']);
  assert.ok(nudgeOf(results[1]));
  assert.equal(nudgeOf(results[3]), null);
});

test('a new correction at least 3 turns after the last nudge allows another nudge', () => {
  const { results } = run(['correction', 'approve', 'none', 'correction', 'approve']);
  assert.equal(nudgeOf(results[1]).kind, 'strong');
  assert.equal(nudgeOf(results[4]).kind, 'strong');
});

test('corrections reset at every milestone, even when no nudge is allowed', () => {
  // t2 nudges; t4 is too close (no nudge) but must still reset; t6 then has no evidence -> weak, not strong.
  const { results } = run(['correction', 'approve', 'correction', 'approve', 'flow', 'approve']);
  const milestone4 = results[3].events.find((e) => e.type === 'milestone');
  assert.deepEqual(milestone4, { type: 'milestone', turn: 4, corrections: 1, nudged: false });
  assert.equal(nudgeOf(results[3]), null);
  assert.equal(nudgeOf(results[5]).kind, 'weak');
});

test('every milestone logs one event with its correction count', () => {
  const { results } = run(['correction', 'correction', 'praise']);
  const milestones = results.flatMap((r) => r.events.filter((e) => e.type === 'milestone'));
  assert.deepEqual(milestones, [{ type: 'milestone', turn: 3, corrections: 2, nudged: true }]);
});

test('at most 3 nudges per session', () => {
  const steps = [];
  for (let i = 0; i < 5; i += 1) steps.push('correction', 'approve', 'none', 'none');
  const { results, state } = run(steps);
  const nudges = results.filter((r) => nudgeOf(r));
  assert.equal(CAP_PER_SESSION, 3);
  assert.equal(nudges.length, 3);
  assert.equal(state.nudges, 3);
});

test('agent-initiated asks count toward the 3-per-session cap', () => {
  const steps = [
    { cls: L.none, ask: ask('a1'), choice: 'skip' },
    'none', 'none',
    { cls: L.none, ask: ask('a2'), choice: 'skip' },
    'none', 'none',
    { cls: L.none, ask: ask('a3'), choice: 'skip' },
    'none', 'none', 'correction', 'approve',
  ];
  const { results, state } = run(steps);
  assert.equal(state.asks, 3);
  assert.equal(outcomeOf(results[0]).initiated, 'agent');
  assert.equal(nudgeOf(results[10]), null);
});

test('the same ask seen on two turns is counted once', () => {
  const { state, results } = run([
    { cls: L.none, ask: ask('same'), choice: 'ignored' },
    { cls: L.none, ask: ask('same'), choice: 'ignored' },
  ]);
  assert.equal(state.asks, 1);
  assert.equal(outcomeOf(results[1]), null);
});

test('all five checkpoint outcomes are recorded', () => {
  const outcomes = [];
  for (const choice of ['accept', 'edit', 'skip', 'ignored']) {
    const { results } = run(['correction', 'approve', { cls: L.none, ask: ask(`x-${choice}`), choice }]);
    outcomes.push(outcomeOf(results[2]));
  }
  const expired = run(['correction', 'approve', 'none', 'none', 'none', 'none', 'none']);
  outcomes.push(outcomeOf(expired.results[6]));
  assert.deepEqual(outcomes.map((o) => o.outcome), ['accept', 'edit', 'skip', 'ignored', 'abstained']);
  assert.ok(outcomes.slice(0, 4).every((o) => o.initiated === 'nudge'));
});

test('pending lives 5 owner turns, then expires as abstained', () => {
  const { results, state } = run(['correction', 'approve', 'none', 'none', 'none', 'none', 'none']);
  assert.equal(PENDING_TTL_TURNS, 5);
  for (let i = 2; i <= 5; i += 1) assert.equal(outcomeOf(results[i]), null, `turn ${i + 1}`);
  assert.deepEqual(outcomeOf(results[6]), { type: 'checkpoint_outcome', turn: 7, outcome: 'abstained', initiated: 'nudge' });
  assert.equal(state.pending, null);
});

test('an ask in a later turn while pending is still attributed to the nudge', () => {
  const { results } = run(['correction', 'approve', 'none', { cls: L.none, ask: ask('late'), choice: 'accept' }]);
  assert.deepEqual(outcomeOf(results[3]), { type: 'checkpoint_outcome', turn: 4, outcome: 'accept', initiated: 'nudge' });
});

test('the reply to a checkpoint is never a completion milestone', () => {
  const { results } = run(['correction', 'approve', { cls: L.approve, ask: ask('k1'), choice: 'accept' }]);
  assert.equal(results[2].events.some((e) => e.type === 'milestone'), false);
  assert.equal(results[2].context, null);
});

test('a correction typed in reply to a checkpoint still counts as evidence', () => {
  const { state } = run(['correction', 'approve', { cls: L.correction, ask: ask('k2'), choice: 'ignored' }]);
  assert.equal(state.correctionsSinceCheckpoint, 1);
});

test('strict mode turns on after 6 skip/ignored in the last 10 outcomes', () => {
  const recentOutcomes = ['skip', 'skip', 'ignored', 'skip', 'ignored', 'accept', 'accept', 'edit', 'accept'];
  const start = { global: { ...freshGlobal(), recentOutcomes } };
  const { results, global } = run([{ cls: L.none, ask: ask('q'), choice: 'skip' }], start);
  assert.equal(global.strict, true);
  assert.ok(results[0].events.some((e) => e.type === 'strict_on'));
  assert.equal(global.recentOutcomes.length, 10);
});

test('strict mode allows no weak nudges and at most 1 strong nudge per session', () => {
  const start = { global: { ...freshGlobal(), strict: true } };
  const { results } = run(['approve', 'none', 'none', 'correction', 'approve', 'none', 'none', 'correction', 'approve'], start);
  assert.equal(nudgeOf(results[0]), null);
  assert.equal(nudgeOf(results[4]).kind, 'strong');
  assert.equal(nudgeOf(results[8]), null);
});

test('no session id: events are logged but never a nudge', () => {
  const { results } = run([
    { cls: L.correction, info: { sessionId: null } },
    { cls: L.approve, info: { sessionId: null } },
  ]);
  assert.equal(results[1].context, null);
  assert.ok(results[1].events.some((e) => e.type === 'prompt'));
  assert.ok(results[1].events.some((e) => e.type === 'milestone'));
});

test('only cli and claude-desktop entrypoints are nudged', () => {
  for (const entrypoint of ['cli', 'claude-desktop']) {
    const { results } = run([
      { cls: L.correction, info: { entrypoint } },
      { cls: L.approve, info: { entrypoint } },
    ]);
    assert.ok(results[1].context, entrypoint);
  }
  for (const entrypoint of ['sdk-cli', 'sdk-ts', 'sdk-py', undefined, '']) {
    const { results } = run([
      { cls: L.correction, info: { entrypoint } },
      { cls: L.approve, info: { entrypoint } },
    ]);
    assert.equal(results[1].context, null, String(entrypoint));
    assert.ok(results[1].events.some((e) => e.type === 'milestone'), String(entrypoint));
  }
});

test('wrapper and slash-command turns do not advance the turn or touch pending', () => {
  const { state: afterNudge } = run(['correction', 'approve']);
  const { results, state } = run(
    [
      { cls: L.wrapper, ask: ask('w1'), choice: 'accept' },
      { cls: L.slash },
      { cls: L.wrapper },
      { cls: L.slash },
      { cls: L.wrapper },
      { cls: L.wrapper },
    ],
    { state: afterNudge },
  );
  assert.equal(state.turn, afterNudge.turn);
  assert.deepEqual(state.pending, afterNudge.pending);
  assert.equal(state.asks, 0);
  assert.ok(results.every((r) => r.events.length === 1 && r.events[0].wrapper === true));
});

test('decide never mutates its inputs', () => {
  const state = deepFreeze({ ...freshState(), correctionsSinceCheckpoint: 2 });
  const global = deepFreeze(freshGlobal());
  assert.doesNotThrow(() => decide(state, global, L.approve, BASE_INFO));
});

test('normalizeState and normalizeGlobal reset unknown or broken shapes', () => {
  assert.deepEqual(normalizeState(null), freshState());
  assert.deepEqual(normalizeState({ v: 99, turn: 4 }), freshState());
  assert.deepEqual(normalizeState({ ...freshState(), turn: 'x' }), freshState());
  assert.deepEqual(normalizeGlobal('nope'), freshGlobal());
  assert.deepEqual(normalizeGlobal({ v: 1, recentOutcomes: 'x', strict: true }), freshGlobal());
  const ok = { ...freshState(), turn: 3, pending: { turn: 2, kind: 'weak' } };
  assert.deepEqual(normalizeState(ok), ok);
});

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12);

test('a nudge in strict mode tells the agent strict mode is on', () => {
  const start = { global: { ...freshGlobal(), strict: true } };
  const { results } = run(['correction', 'approve'], start);
  assert.match(results[1].context, /strict mode is on/i);
  assert.ok(results[1].context.length <= 700, `length ${results[1].context.length}`);
  const normal = run(['correction', 'approve']);
  assert.doesNotMatch(normal.results[1].context, /strict mode/i);
});

test('strict mode records when it turned on and clears 7 days later with an empty outcome window', () => {
  const recentOutcomes = ['skip', 'skip', 'ignored', 'skip', 'ignored', 'accept', 'accept', 'edit', 'accept'];
  const on = run([{ cls: L.none, ask: ask('q'), choice: 'skip', info: { nowMs: NOW } }], { global: { ...freshGlobal(), recentOutcomes } });
  assert.equal(on.global.strict, true);
  assert.equal(on.global.strictSince, NOW);

  const stillOn = run([{ cls: L.none, info: { nowMs: NOW + 6 * DAY } }], { global: on.global });
  assert.equal(stillOn.global.strict, true);

  const off = run([{ cls: L.correction, info: { nowMs: NOW + 7 * DAY } }, { cls: L.approve, info: { nowMs: NOW + 7 * DAY } }], { global: on.global });
  assert.equal(off.global.strict, false);
  assert.equal(off.global.strictSince, null);
  assert.deepEqual(off.global.recentOutcomes, []);
  assert.ok(off.results[0].events.some((e) => e.type === 'strict_off'));
  assert.doesNotMatch(off.results[1].context, /strict mode/i);
});

test('a strict global saved without strictSince starts its 7-day clock on the next interactive turn', () => {
  const legacy = { v: 1, recentOutcomes: [], strict: true };
  const first = run([{ cls: L.none, info: { nowMs: NOW } }], { global: legacy });
  assert.equal(first.global.strict, true);
  assert.equal(first.global.strictSince, NOW);
  const later = run([{ cls: L.none, info: { nowMs: NOW + 8 * DAY } }], { global: first.global });
  assert.equal(later.global.strict, false);
});

test('non-interactive entrypoints log checkpoint outcomes but never change the shared outcome list', () => {
  const recentOutcomes = ['skip', 'skip', 'ignored', 'skip', 'ignored', 'accept', 'accept', 'edit', 'accept'];
  for (const entrypoint of ['sdk-cli', 'sdk-ts', '', undefined]) {
    const start = { global: { ...freshGlobal(), recentOutcomes } };
    const { results, global } = run([{ cls: L.none, ask: ask('n1'), choice: 'skip', info: { entrypoint, nowMs: NOW } }], start);
    assert.equal(outcomeOf(results[0]).outcome, 'skip', String(entrypoint));
    assert.deepEqual(global, normalizeGlobal(start.global), String(entrypoint));
    assert.equal(results[0].events.some((e) => e.type === 'strict_on'), false, String(entrypoint));
  }
});
