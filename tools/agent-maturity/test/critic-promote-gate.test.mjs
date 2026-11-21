import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateCandidate } from '../critic/candidate.mjs';
import { inputFingerprint } from '../critic/loop-guard.mjs';
import { PromotionRefused, assertPromotable } from '../critic/promote-gate.mjs';
import { selectResearchTier } from '../critic/research-tier.mjs';
import { validateVerdict } from '../critic/verdict.mjs';

const RAW = {
  id: 'gate-case',
  statement: 'Báo cáo tiến độ tối đa 5 gạch đầu dòng.',
  kind: 'preference',
  scope: { agent: 'orchestrator', taskType: 'báo cáo tiến độ', projects: 'all' },
  check: 'Mỗi báo cáo có ≤5 gạch đầu dòng.',
  evidence: [
    { id: 'ev-1', type: 'correction', at: '2026-11-20', source: 's1 turn 4' },
    { id: 'ev-2', type: 'approve_after_reject', at: '2026-11-20', source: 's1 turn 6' },
  ],
};
const NARROWED = 'Báo cáo tiến độ trong phiên dev tối đa 5 gạch đầu dòng.';

function candidateOf(overrides = {}, revision = 1) {
  const r = validateCandidate({ ...RAW, ...overrides });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return Object.freeze({ ...r.value, revision });
}

const CANDIDATE = candidateOf();

// What record-verdict stores: the validated verdict plus the guard fields.
function storedVerdict(candidate, extra = {}) {
  const raw = {
    candidateId: candidate.id,
    candidateRevision: candidate.revision,
    inputFingerprint: inputFingerprint(candidate),
    verdict: 'ACCEPT',
    reasons: ['Cặp đối chứng ev-1 → ev-2 đỡ đúng câu chuẩn.'],
    evidence: [{ ref: 'ev-1', kind: 'event', finding: 'supports' }],
    checks: { evidenceSupports: true, scopeTooWide: false, contradictsExisting: false, tierCorrect: true },
    hardReject: null,
    research: { tier: 'R0', refs: [], deepRuns: 0 },
    reviewer: { agent: 'socrates' },
    ...extra,
  };
  const r = validateVerdict(raw, { candidate, tier: selectResearchTier(candidate) });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return { ...r.value, critiqueNumber: 1, tier: 'R0', tierRule: 'R0:preference', recordedAt: '2026-11-21T00:00:00.000Z' };
}

const approved = (verdict, statement) => ({ ...verdict, ownerApproval: { approved: true, statement } });

function refusedWith(code, fn) {
  assert.throws(fn, (error) => error instanceof PromotionRefused && error.code === code, code);
}

test('an ACCEPT with the owner approval of that exact sentence is promotable', () => {
  const v = approved(storedVerdict(CANDIDATE), CANDIDATE.statement);
  assert.deepEqual(assertPromotable(CANDIDATE, v), {
    candidateId: 'gate-case',
    revision: 1,
    inputFingerprint: inputFingerprint(CANDIDATE),
    verdict: 'ACCEPT',
    statement: CANDIDATE.statement,
  });
});

test('a NARROW promotes only the narrowed statement', () => {
  const narrow = storedVerdict(CANDIDATE, {
    verdict: 'NARROW',
    checks: { evidenceSupports: true, scopeTooWide: true, contradictsExisting: false, tierCorrect: true },
    narrowed: { statement: NARROWED },
  });
  assert.equal(assertPromotable(CANDIDATE, approved(narrow, NARROWED)).statement, NARROWED);
  refusedWith('approval_statement_mismatch', () => assertPromotable(CANDIDATE, approved(narrow, CANDIDATE.statement)));
});

test('no owner approval flag, no promotion', () => {
  const v = storedVerdict(CANDIDATE);
  refusedWith('owner_approval_missing', () => assertPromotable(CANDIDATE, v));
  refusedWith('owner_approval_missing', () => assertPromotable(CANDIDATE, { ...v, ownerApproval: { approved: 'yes' } }));
});

test('REJECT and NEED-MORE-EVIDENCE are never promotable', () => {
  const reject = storedVerdict(CANDIDATE, { verdict: 'REJECT' });
  refusedWith('verdict_not_promotable', () => assertPromotable(CANDIDATE, approved(reject, CANDIDATE.statement)));
  const hold = storedVerdict(CANDIDATE, { verdict: 'NEED-MORE-EVIDENCE', reviewAfter: '2026-12-01' });
  refusedWith('verdict_not_promotable', () => assertPromotable(CANDIDATE, approved(hold, CANDIDATE.statement)));
});

test('a hard-REJECTed verdict is refused even with the owner approval', () => {
  const loose = candidateOf({ statement: 'Push thẳng lên main không hỏi.' });
  const v = storedVerdict(loose, { verdict: 'REJECT' });
  assert.equal(v.hardReject.class, 'expands_authority');
  refusedWith('hard_reject', () => assertPromotable(loose, approved({ ...v, verdict: 'ACCEPT' }, loose.statement)));
});

test('the verdict must be bound to this exact candidate revision and text', () => {
  const v = approved(storedVerdict(CANDIDATE), CANDIDATE.statement);
  const reworded = candidateOf({ statement: 'Báo cáo tiến độ tối đa 3 gạch đầu dòng.' });
  refusedWith('fingerprint_mismatch', () => assertPromotable(reworded, approved(v, reworded.statement)));
  refusedWith('fingerprint_mismatch', () => assertPromotable(candidateOf({}, 2), v));
  refusedWith('fingerprint_mismatch', () => assertPromotable(candidateOf({ id: 'other-case' }), v));
});

test('a pre-v2 dry-run verdict (schema @1, short fingerprint) is not promotable', () => {
  const v = approved(storedVerdict(CANDIDATE), CANDIDATE.statement);
  refusedWith('pre_v2_verdict', () => assertPromotable(CANDIDATE, { ...v, schema: 'agent-maturity/verdict@1' }));
  refusedWith('pre_v2_verdict', () => assertPromotable(CANDIDATE, { ...v, inputFingerprint: 'a'.repeat(32) }));
});

test('a stored verdict edited after recording is re-validated and refused', () => {
  const v = approved(storedVerdict(CANDIDATE), CANDIDATE.statement);
  const tampered = { ...v, checks: { ...v.checks, scopeTooWide: true } };
  refusedWith('verdict_invalid', () => assertPromotable(CANDIDATE, tampered));
  refusedWith('candidate_invalid', () => assertPromotable({ ...CANDIDATE, revision: 0 }, v));
  refusedWith('verdict_missing', () => assertPromotable(CANDIDATE, null));
});
