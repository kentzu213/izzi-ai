import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateCandidate } from '../critic/candidate.mjs';
import { MAX_CRITIQUES, MAX_REWRITES, inputFingerprint, planCritique, statementFingerprint } from '../critic/loop-guard.mjs';

const NOW = new Date('2026-11-21T10:00:00.000Z');

const BASE = {
  id: 'guard-case',
  statement: 'Báo cáo tiến độ tối đa 5 gạch đầu dòng.',
  kind: 'preference',
  scope: { agent: 'orchestrator', taskType: 'báo cáo tiến độ', projects: 'all' },
  check: 'Mỗi báo cáo có ≤5 gạch đầu dòng.',
  evidence: [
    { id: 'ev-1', type: 'correction', at: '2026-11-20', source: 's1' },
    { id: 'ev-2', type: 'approve_after_reject', at: '2026-11-20', source: 's1' },
  ],
};

function cand(overrides = {}, revision = 1) {
  const r = validateCandidate({ ...BASE, ...overrides });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return Object.freeze({ ...r.value, revision });
}

const verdictFor = (candidate, extra = {}) => ({
  verdict: 'NARROW',
  hardReject: null,
  inputFingerprint: inputFingerprint(candidate),
  critiqueNumber: 1,
  ...extra,
});

test('limits are 2 critiques (initial + one re-check) and 1 rewrite', () => {
  assert.equal(MAX_CRITIQUES, 2);
  assert.equal(MAX_REWRITES, 1);
});

test('the first critique is allowed with or without a stored candidate', () => {
  const c = cand();
  for (const record of [null, { candidate: c, verdicts: [] }]) {
    const p = planCritique(record, c, NOW);
    assert.deepEqual(
      { allowed: p.allowed, critiqueNumber: p.critiqueNumber, revision: p.revision, isRewrite: p.isRewrite },
      { allowed: true, critiqueNumber: 1, revision: 1, isRewrite: false },
    );
    assert.equal(p.fingerprint, inputFingerprint(c));
  }
});

test('a second critique of the same input is blocked as same_input', () => {
  const c = cand();
  const p = planCritique({ candidate: c, verdicts: [verdictFor(c)] }, c, NOW);
  assert.equal(p.allowed, false);
  assert.equal(p.reason, 'same_input');
  assert.equal(p.critiqueNumber, 2);
  assert.deepEqual(p.event, {
    type: 'critique_blocked',
    candidateId: 'guard-case',
    critiqueNumber: 2,
    reason: 'same_input',
    at: NOW.toISOString(),
  });
});

test('a rewrite after the first critique gets one re-check as revision 2', () => {
  const c = cand();
  const rewritten = cand({ statement: 'Báo cáo tiến độ trong phiên dev tối đa 5 gạch đầu dòng.' });
  const p = planCritique({ candidate: c, verdicts: [verdictFor(c)] }, rewritten, NOW);
  assert.equal(p.allowed, true);
  assert.equal(p.critiqueNumber, 2);
  assert.equal(p.isRewrite, true);
  assert.equal(p.revision, 2);
});

test('new research or evidence without a rewrite also allows the re-check, keeping the revision', () => {
  const c = cand();
  const researched = cand({ research: { refs: ['https://example.com/paper'] } });
  const p = planCritique({ candidate: c, verdicts: [verdictFor(c)] }, researched, NOW);
  assert.equal(p.allowed, true);
  assert.equal(p.isRewrite, false);
  assert.equal(p.revision, 1);
});

test('the third critique is always blocked and logged', () => {
  const c = cand();
  const r2 = cand({ statement: 'Báo cáo tiến độ trong phiên dev tối đa 5 gạch đầu dòng.' }, 2);
  const r3 = cand({ statement: 'Báo cáo tiến độ ngắn.' });
  const record = { candidate: r2, verdicts: [verdictFor(c), verdictFor(r2, { critiqueNumber: 2 })] };
  for (const next of [r2, r3]) {
    const p = planCritique(record, next, NOW);
    assert.equal(p.allowed, false);
    assert.equal(p.reason, 'max_critiques');
    assert.equal(p.critiqueNumber, 3);
    assert.equal(p.event.type, 'critique_blocked');
  }
});

test('a hard-REJECT is final: no rewrite and no re-check', () => {
  const c = cand();
  const record = { candidate: c, verdicts: [verdictFor(c, { verdict: 'REJECT', hardReject: { class: 'expands_authority' } })] };
  const p = planCritique(record, cand({ statement: 'Một câu khác hẳn.' }), NOW);
  assert.equal(p.allowed, false);
  assert.equal(p.reason, 'hard_reject_final');
});

test('a candidate edited before its first critique stays revision 1', () => {
  const c = cand();
  const edited = cand({ statement: 'Báo cáo tiến độ ngắn.' });
  const p = planCritique({ candidate: c, verdicts: [] }, edited, NOW);
  assert.equal(p.allowed, true);
  assert.equal(p.revision, 1);
  assert.equal(p.isRewrite, false);
});

test('fingerprints ignore key order and follow the statement', () => {
  const a = cand();
  const b = cand({ scope: { projects: 'all', taskType: 'báo cáo tiến độ', agent: 'orchestrator' } });
  assert.equal(statementFingerprint(a), statementFingerprint(b));
  assert.equal(inputFingerprint(a), inputFingerprint(b));
  const c = cand({ statement: 'Khác.' });
  assert.notEqual(statementFingerprint(a), statementFingerprint(c));
  const d = cand({ evidence: [...BASE.evidence, { id: 'ev-3', type: 'outcome', at: '2026-11-21', source: 's2' }] });
  assert.equal(statementFingerprint(a), statementFingerprint(d));
  assert.notEqual(inputFingerprint(a), inputFingerprint(d));
});

test('inputFingerprint is a full sha256 over everything the brief shows, including the revision', () => {
  const a = cand();
  assert.match(inputFingerprint(a), /^[0-9a-f]{64}$/);
  const ev = BASE.evidence;
  const changed = [
    cand({}, 2),
    cand({ statement: 'Báo cáo tiến độ tối đa 3 gạch đầu dòng.' }),
    cand({ kind: 'procedure' }),
    cand({ scope: { ...BASE.scope, projects: 'this' } }),
    cand({ scope: { ...BASE.scope, agent: 'builder' } }),
    cand({ check: 'Mỗi báo cáo có ≤3 gạch đầu dòng.' }),
    cand({ evidence: [{ ...ev[0], note: 'anh sửa lại' }, ev[1]] }),
    cand({ evidence: [{ ...ev[0], source: 's9' }, ev[1]] }),
    cand({ evidence: [...ev].reverse() }),
    cand({ existingStandards: [{ id: 'std-1', statement: 'Một chuẩn cũ.' }] }),
    cand({ research: { refs: ['https://example.com/a'] } }),
    cand({ flags: { ownerPrivate: true } }),
  ];
  for (const other of changed) assert.notEqual(inputFingerprint(other), inputFingerprint(a), JSON.stringify(other));
  assert.throws(() => inputFingerprint({ ...a, revision: undefined }), /revision/);
});

test('a record from before fingerprint binding (pre-v2) cannot be continued', () => {
  const c = cand();
  const legacy = { ...verdictFor(c), inputFingerprint: 'a'.repeat(32) };
  for (const next of [c, cand({ statement: 'Báo cáo tiến độ ngắn.' })]) {
    const p = planCritique({ candidate: c, verdicts: [legacy] }, next, NOW);
    assert.equal(p.allowed, false);
    assert.equal(p.reason, 'pre_v2_record');
  }
});

const refusal = (candidate, extra = {}) => ({
  type: 'verdict_refused',
  candidateId: candidate.id,
  critiqueNumber: 1,
  inputFingerprint: inputFingerprint(candidate),
  retryable: true,
  verdict: 'NARROW',
  ...extra,
});

test('after a format refusal, record-verdict gets exactly one retry for the same input and brief is blocked', () => {
  const c = cand();
  const refusals = [refusal(c)];
  const retry = planCritique(null, c, NOW, { refusals, step: 'record' });
  assert.equal(retry.allowed, true);
  assert.equal(retry.attempt, 2);
  assert.equal(retry.retryOf, 'NARROW');
  const brief = planCritique(null, c, NOW, { refusals, step: 'brief' });
  assert.deepEqual([brief.allowed, brief.reason], [false, 'json_retry_pending']);
  const otherInput = planCritique(null, cand({ statement: 'Báo cáo tiến độ ngắn.' }), NOW, { refusals, step: 'record' });
  assert.deepEqual([otherInput.allowed, otherInput.reason], [false, 'json_retry_pending']);
  const twice = planCritique(null, c, NOW, { refusals: [refusal(c), refusal(c)], step: 'record' });
  assert.deepEqual([twice.allowed, twice.reason], [false, 'json_retry_used']);
  assert.equal(planCritique(null, c, NOW).attempt, 1);
});

test('a semantic refusal has no retry and ends the critique', () => {
  const c = cand();
  for (const step of ['record', 'brief']) {
    const p = planCritique(null, c, NOW, { refusals: [refusal(c, { retryable: false })], step });
    assert.deepEqual([p.allowed, p.reason], [false, 'reply_refused_final']);
    assert.equal(p.event.type, 'critique_blocked');
  }
  const later = planCritique(null, c, NOW, { refusals: [refusal(c, { critiqueNumber: 2, retryable: false })] });
  assert.equal(later.allowed, true, 'refusals for another critique number do not count');
});

test('planCritique does not mutate the record', () => {
  const c = cand();
  const record = Object.freeze({ candidate: c, verdicts: Object.freeze([Object.freeze(verdictFor(c))]) });
  assert.doesNotThrow(() => planCritique(record, c, NOW));
});
