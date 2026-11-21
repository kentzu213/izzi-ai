// The promote gate loads the current candidate, its last verdict and the hard-REJECT index from the store itself.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { briefCandidate } from '../critic/brief.mjs';
import { validateCandidate } from '../critic/candidate.mjs';
import { createJsonAdapter } from '../critic/json-adapter.mjs';
import { inputFingerprint, verdictDigest } from '../critic/loop-guard.mjs';
import { PromotionRefused, assertPromotable } from '../critic/promote-gate.mjs';
import { recordVerdict } from '../critic/record-verdict.mjs';
import { selectResearchTier } from '../critic/research-tier.mjs';
import { validateVerdict } from '../critic/verdict.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'am-critic-gate-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const freshAdapter = () => {
  const dir = join(scratch, `store-${(n += 1)}`);
  return { dir, adapter: createJsonAdapter(dir) };
};
const NOW = new Date('2026-11-21T10:00:00.000Z');

const RAW = {
  id: 'gate-case',
  statement: 'Tóm tắt tiến độ tối đa 5 gạch đầu dòng.',
  kind: 'preference',
  scope: { agent: 'orchestrator', taskType: 'tóm tắt tiến độ', projects: 'all' },
  check: 'Mỗi bản tóm tắt có ≤5 gạch đầu dòng.',
  evidence: [
    { id: 'ev-1', type: 'correction', at: '2026-11-20', source: 's1 turn 4' },
    { id: 'ev-2', type: 'approve_after_reject', at: '2026-11-20', source: 's1 turn 6' },
  ],
};
const NARROWED = 'Tóm tắt tiến độ trong phiên dev tối đa 5 gạch đầu dòng.';
const SCOPED = { id: 'scoped-case', statement: 'Không bỏ qua test khi merge lên main.', check: 'Mỗi lần merge lên main có test xanh.' };
const LOOSE = { id: 'loose-case', statement: 'Push thẳng lên main không hỏi.' };
const ACCEPT_CHECKS = { evidenceSupports: true, scopeTooWide: false, contradictsExisting: false, tierCorrect: true };
// The owner's checkpoint answer (Nâng cấp) to a question that showed the floor label and topics next to the exact text.
const MSG = { sessionId: '0b7c3f52-6a1e-4f0e-9d2a-3c5b8e1f7a90', uuid: '5f2e9c1a-8b7d-4e3f-a6c5-1d0e2f3a4b5c' };
const SCOPED_ACK = { floorClass: 'owner_review_required', topics: ['verification', 'release', 'loosening'], ownerMessage: MSG };
const OWNER = { ownerMessage: MSG };

const parsed = (overrides = {}) => {
  const r = validateCandidate({ ...RAW, ...overrides });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.value;
};
const reply = (candidate, extra = {}) =>
  JSON.stringify({
    candidateId: candidate.id,
    candidateRevision: 1,
    inputFingerprint: inputFingerprint({ ...candidate, revision: 1 }),
    verdict: 'ACCEPT',
    reasons: ['Cặp đối chứng ev-1 → ev-2 đỡ đúng câu chuẩn.'],
    evidence: [{ ref: 'ev-1', kind: 'event', finding: 'supports' }],
    checks: ACCEPT_CHECKS,
    hardReject: null,
    research: { tier: 'R0', refs: [], deepRuns: 0 },
    reviewer: { agent: 'socrates' },
    ...extra,
  });
const NARROW = { verdict: 'NARROW', checks: { ...ACCEPT_CHECKS, scopeTooWide: true }, narrowed: { statement: NARROWED } };

// The real flow: brief, then record. Returns the adapter and store dir.
function recorded(overrides = {}, verdictExtra = {}, store = freshAdapter()) {
  const candidate = parsed(overrides);
  briefCandidate({ candidate, adapter: store.adapter, now: NOW });
  recordVerdict({ candidate, verdictText: reply(candidate, verdictExtra), adapter: store.adapter, now: NOW });
  return { ...store, candidate };
}

const promote = (adapter, candidateId, ownerApproval) => assertPromotable({ adapter, candidateId, ownerApproval });
const approval = (statement, extra = {}) => ({ approved: true, statement, ...extra });
const refusedWith = (code, fn) => assert.throws(fn, (e) => e instanceof PromotionRefused && e.code === code, code);

function editRecord(dir, id, edit) {
  const file = join(dir, 'candidates', `${id}.json`);
  writeFileSync(file, JSON.stringify(edit(JSON.parse(readFileSync(file, 'utf8')))));
}

test('an ACCEPT with the owner approval of that exact sentence is promotable', () => {
  const { adapter, candidate } = recorded();
  assert.deepEqual(promote(adapter, 'gate-case', approval(candidate.statement, OWNER)), {
    candidateId: 'gate-case',
    revision: 1,
    inputFingerprint: inputFingerprint({ ...candidate, revision: 1 }),
    verdict: 'ACCEPT',
    floor: 'pass',
    statement: candidate.statement,
  });
});

test('a NARROW promotes only the stored narrowed statement', () => {
  const { adapter, candidate } = recorded({}, NARROW);
  assert.equal(promote(adapter, 'gate-case', approval(NARROWED, OWNER)).statement, NARROWED);
  refusedWith('approval_statement_mismatch', () => promote(adapter, 'gate-case', approval(candidate.statement, OWNER)));
});

test('the owner approval must be explicit, exact and carry no unknown fields', () => {
  const { adapter, candidate } = recorded();
  refusedWith('owner_approval_missing', () => promote(adapter, 'gate-case', undefined));
  refusedWith('owner_approval_missing', () => promote(adapter, 'gate-case', { approved: 'yes', statement: candidate.statement }));
  refusedWith('owner_approval_invalid', () => promote(adapter, 'gate-case', approval(candidate.statement, { forced: true })));
  refusedWith('owner_approval_invalid', () => promote(adapter, 'gate-case', approval(candidate.statement, { overrideReject: 'true' })));
  refusedWith('approval_statement_mismatch', () => promote(adapter, 'gate-case', approval(`${candidate.statement} `.repeat(2), OWNER)));
});

test('every promotion needs the owner message, pass included: no standard is stored without Nâng cấp on its exact text', () => {
  // Arrange
  const { adapter, candidate } = recorded();
  const ask = (extra) => () => promote(adapter, 'gate-case', approval(candidate.statement, extra));

  // Act + Assert
  refusedWith('owner_message_missing', ask({}));
  refusedWith('owner_message_missing', ask({ floorClass: 'pass', topics: [] }));
  refusedWith('owner_approval_invalid', ask({ ownerMessage: { sessionId: MSG.sessionId } }));
  refusedWith('owner_approval_invalid', ask({ ownerMessage: { ...MSG, text: 'Nâng cấp' } }));
  refusedWith('approval_statement_mismatch', () => promote(adapter, 'gate-case', approval(candidate.statement.slice(0, -1), OWNER)));
  assert.equal(promote(adapter, 'gate-case', approval(candidate.statement, OWNER)).floor, 'pass');
  assert.equal(promote(adapter, 'gate-case', approval(candidate.statement, { ownerMessage: { sessionId: MSG.sessionId, ts: '2026-11-21T09:58:00Z' } })).floor, 'pass');
});

test('owner_review_required text needs the checkpoint acknowledgement: exact text, floor label, topics, owner message', () => {
  const { adapter, candidate } = recorded(SCOPED);
  const ask = (extra) => () => promote(adapter, 'scoped-case', approval(candidate.statement, extra));
  refusedWith('floor_ack_missing', ask({}));
  refusedWith('floor_ack_missing', ask({ floorClass: SCOPED_ACK.floorClass, topics: SCOPED_ACK.topics }));
  refusedWith('floor_ack_mismatch', ask({ ...SCOPED_ACK, topics: ['verification'] }));
  refusedWith('floor_ack_mismatch', ask({ ...SCOPED_ACK, floorClass: 'pass' }));
  refusedWith('owner_approval_invalid', ask({ ...SCOPED_ACK, ownerMessage: { sessionId: MSG.sessionId } }));
  refusedWith('owner_approval_invalid', ask({ ...SCOPED_ACK, ownerMessage: { ...MSG, text: 'ok' } }));
  refusedWith('owner_approval_invalid', ask({ ...SCOPED_ACK, topics: 'verification' }));
  refusedWith('owner_approval_invalid', ask({ ownerAcknowledgedProtectedTopic: true }));
  const ok = promote(adapter, 'scoped-case', approval(candidate.statement, { ...SCOPED_ACK, topics: [...SCOPED_ACK.topics].reverse() }));
  assert.deepEqual([ok.verdict, ok.floor], ['ACCEPT', 'owner_review_required']);
  const byTime = { ...SCOPED_ACK, ownerMessage: { sessionId: MSG.sessionId, ts: '2026-11-21T09:58:00.000Z' } };
  assert.equal(promote(adapter, 'scoped-case', approval(candidate.statement, byTime)).statement, candidate.statement);
});

test('a pass approval may carry its label; a label that does not match the text is refused', () => {
  const { adapter, candidate } = recorded();
  assert.equal(promote(adapter, 'gate-case', approval(candidate.statement, { floorClass: 'pass', topics: [], ownerMessage: MSG })).floor, 'pass');
  refusedWith('floor_ack_mismatch', () => promote(adapter, 'gate-case', approval(candidate.statement, SCOPED_ACK)));
});

test('reviewer e2e: a procedure is never promoted on an ACCEPT and a bare approval', () => {
  const cases = [
    ['leak-underscore', '_Push_ without _asking_.', 'Mỗi lần xong việc, code được đẩy lên ngay.'],
    ['leak-checks', 'Skip the checks.', 'Agent goes straight to the next step.'],
    ['leak-duyet', 'Bỏ bước duyệt, đẩy code lên luôn.', 'Code được đẩy lên ngay khi xong.'],
  ];
  let recordedCount = 0;
  for (const [id, statement, check] of cases) {
    const store = freshAdapter();
    const candidate = parsed({ id, statement, check, kind: 'procedure', scope: { agent: 'builder', taskType: 'code', projects: 'all' } });
    const tier = selectResearchTier({ ...candidate, revision: 1 });
    const research = { tier: tier.tier, refs: tier.tier === 'R0' ? [] : ['docs/x.md'], deepRuns: tier.tier === 'R2' ? 1 : 0 };
    briefCandidate({ candidate, adapter: store.adapter, now: NOW });
    let summary = null;
    try {
      summary = recordVerdict({ candidate, verdictText: reply(candidate, { research }), adapter: store.adapter, now: NOW });
    } catch (error) {
      assert.match(error.message, /hard_reject_floor/, id);
      continue;
    }
    recordedCount += 1;
    assert.equal(summary.floor, 'owner_review_required', id);
    refusedWith('floor_ack_missing', () => promote(store.adapter, id, approval(statement)));
  }
  assert.ok(recordedCount >= 2, 'the gate itself is exercised');
});

test('a stored floor label that no longer matches the floor today is refused', () => {
  const { dir, adapter, candidate } = recorded(SCOPED);
  editRecord(dir, 'scoped-case', (r) => ({ ...r, verdicts: [{ ...r.verdicts[0], floorTopics: ['verification'] }] }));
  const edited = JSON.parse(readFileSync(join(dir, 'candidates', 'scoped-case.json'), 'utf8')).verdicts[0];
  adapter.logEvent({ type: 'verdict_recorded', candidateId: 'scoped-case', critiqueNumber: 1, verdictSha256: verdictDigest(edited) });
  refusedWith('floor_changed', () => promote(adapter, 'scoped-case', approval(candidate.statement, { ...SCOPED_ACK, topics: ['verification'] })));
});

test('a plain REJECT is promotable only by an explicit owner override; NEED-MORE-EVIDENCE never', () => {
  const { adapter, candidate } = recorded({}, { verdict: 'REJECT' });
  refusedWith('verdict_not_promotable', () => promote(adapter, 'gate-case', approval(candidate.statement, OWNER)));
  assert.equal(promote(adapter, 'gate-case', approval(candidate.statement, { overrideReject: true, ...OWNER })).verdict, 'REJECT');
  const scoped = recorded(SCOPED, { verdict: 'REJECT' });
  refusedWith('floor_ack_missing', () =>
    promote(scoped.adapter, 'scoped-case', approval(scoped.candidate.statement, { overrideReject: true })),
  );
  assert.equal(
    promote(scoped.adapter, 'scoped-case', approval(scoped.candidate.statement, { overrideReject: true, ...SCOPED_ACK })).verdict,
    'REJECT',
  );
  const hold = recorded({}, { verdict: 'NEED-MORE-EVIDENCE', reviewAfter: '2026-12-01' });
  refusedWith('verdict_not_promotable', () =>
    promote(hold.adapter, 'gate-case', approval(hold.candidate.statement, { overrideReject: true, ...SCOPED_ACK })),
  );
});

test('a hard_reject is never promotable, not even with every owner flag', () => {
  const { dir, adapter, candidate } = recorded(LOOSE, { verdict: 'REJECT' });
  const all = approval(candidate.statement, { overrideReject: true, ...SCOPED_ACK });
  refusedWith('hard_reject', () => promote(adapter, 'loose-case', all));
  editRecord(dir, 'loose-case', (r) => ({ ...r, verdicts: [{ ...r.verdicts[0], hardReject: null }] }));
  refusedWith('hard_reject', () => promote(adapter, 'loose-case', all));
});

test('a statement in the hard-REJECT index is refused under any candidate id', () => {
  const store = freshAdapter();
  recorded(SCOPED, { verdict: 'REJECT', hardReject: { class: 'loosens_verification', detail: 'x' } }, store);
  // A record written straight into the store, bypassing brief (which would refuse the indexed statement).
  const copy = { ...parsed({ ...SCOPED, id: 'copy-case' }), revision: 1 };
  const v = validateVerdict(JSON.parse(reply(copy)), { candidate: copy, tier: selectResearchTier(copy) }).value;
  const stored = { ...v, critiqueNumber: 1, tier: 'R0', tierRule: 'R0:preference', recordedAt: NOW.toISOString() };
  store.adapter.saveCandidate(copy);
  store.adapter.saveVerdict('copy-case', stored);
  store.adapter.logEvent({ type: 'verdict_recorded', candidateId: 'copy-case', critiqueNumber: 1, verdictSha256: verdictDigest(stored) });
  refusedWith('hard_reject_statement', () =>
    promote(store.adapter, 'copy-case', approval(copy.statement, SCOPED_ACK)),
  );
});

test('stored records edited after recording are refused', () => {
  const narrow = recorded({}, NARROW);
  editRecord(narrow.dir, 'gate-case', (r) => ({
    ...r,
    verdicts: [{ ...r.verdicts[0], narrowed: { ...r.verdicts[0].narrowed, statement: 'Tóm tắt tiến độ thật dài.' } }],
  }));
  refusedWith('verdict_tampered', () => promote(narrow.adapter, 'gate-case', approval('Tóm tắt tiến độ thật dài.')));

  const checks = recorded();
  editRecord(checks.dir, 'gate-case', (r) => ({ ...r, verdicts: [{ ...r.verdicts[0], checks: { ...ACCEPT_CHECKS, scopeTooWide: true } }] }));
  refusedWith('verdict_invalid', () => promote(checks.adapter, 'gate-case', approval(checks.candidate.statement)));

  const text = recorded();
  editRecord(text.dir, 'gate-case', (r) => ({ ...r, candidate: { ...r.candidate, statement: 'Tóm tắt tiến độ tối đa 3 gạch đầu dòng.' } }));
  refusedWith('fingerprint_mismatch', () => promote(text.adapter, 'gate-case', approval('Tóm tắt tiến độ tối đa 3 gạch đầu dòng.')));

  const old = recorded();
  editRecord(old.dir, 'gate-case', (r) => ({ ...r, verdicts: [{ ...r.verdicts[0], schema: 'agent-maturity/verdict@1' }] }));
  refusedWith('pre_v2_verdict', () => promote(old.adapter, 'gate-case', approval(old.candidate.statement)));
});

test('the gate needs a store adapter and a stored candidate; caller-built records are not accepted', () => {
  const { adapter, candidate } = recorded();
  refusedWith('candidate_missing', () => promote(adapter, 'no-such-case', approval(candidate.statement)));
  refusedWith('candidate_invalid', () => promote(adapter, '../escape', approval(candidate.statement)));
  assert.throws(() => assertPromotable({ ...candidate, revision: 1 }, { verdict: 'ACCEPT' }), /adapter is missing/);
  assert.throws(() => assertPromotable(), /adapter is missing/);
});
