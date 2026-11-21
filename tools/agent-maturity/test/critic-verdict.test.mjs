import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hasContrastPair, validateCandidate } from '../critic/candidate.mjs';
import { selectResearchTier } from '../critic/research-tier.mjs';
import {
  HARD_REJECT_CLASSES,
  VERDICTS,
  VERDICT_LIMITS,
  detectHardReject,
  extractVerdictJson,
  promotionDecision,
  validateVerdict,
} from '../critic/verdict.mjs';

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

const RAW_CANDIDATE = {
  id: 'short-progress-reports',
  statement: 'Báo cáo tiến độ tối đa 5 gạch đầu dòng.',
  kind: 'preference',
  scope: { agent: 'orchestrator', taskType: 'báo cáo tiến độ', projects: 'all' },
  check: 'Mỗi báo cáo tiến độ có ≤5 gạch đầu dòng.',
  evidence: [
    { id: 'ev-1', type: 'correction', at: '2026-11-20', source: 'session s1 turn 4' },
    { id: 'ev-2', type: 'approve_after_reject', at: '2026-11-20', source: 'session s1 turn 6' },
  ],
};

function candidateOf(overrides = {}, revision = 1) {
  const r = validateCandidate({ ...RAW_CANDIDATE, ...overrides });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return deepFreeze({ ...r.value, revision });
}

const CANDIDATE = candidateOf();
const TIER_R0 = selectResearchTier(CANDIDATE);

const ACCEPT = deepFreeze({
  candidateId: 'short-progress-reports',
  candidateRevision: 1,
  verdict: 'ACCEPT',
  reasons: ['Cặp đối chứng ev-1 → ev-2 đỡ đúng câu chuẩn.'],
  evidence: [
    { ref: 'ev-1', kind: 'event', finding: 'supports' },
    { ref: 'ev-2', kind: 'event', finding: 'supports' },
  ],
  checks: { evidenceSupports: true, scopeTooWide: false, contradictsExisting: false, tierCorrect: true },
  hardReject: null,
  research: { tier: 'R0', refs: [], deepRuns: 0 },
  reviewer: { agent: 'socrates' },
});

const validate = (raw, candidate = CANDIDATE, tier = selectResearchTier(candidate)) =>
  validateVerdict(raw, { candidate, tier });
const codes = (r) => r.errors.map((e) => e.code);

test('exports the four verdicts and four hard-REJECT classes', () => {
  assert.deepEqual(VERDICTS, ['ACCEPT', 'NARROW', 'NEED-MORE-EVIDENCE', 'REJECT']);
  assert.deepEqual(HARD_REJECT_CLASSES, [
    'loosens_verification',
    'loosens_security',
    'loosens_honest_reporting',
    'expands_authority',
  ]);
});

test('a well-formed ACCEPT is valid and normalized', () => {
  const r = validate(ACCEPT);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.verdict, 'ACCEPT');
  assert.equal(r.value.hardReject, null);
  assert.deepEqual(r.value.evidence.map((e) => e.ref), ['ev-1', 'ev-2']);
  assert.equal(TIER_R0.tier, 'R0');
});

test('unknown fields are dropped from the stored value', () => {
  const r = validate({ ...ACCEPT, extra: 'x', reviewer: { agent: 'socrates', model: 'm', other: 1 } });
  assert.equal(r.ok, true);
  assert.equal('extra' in r.value, false);
  assert.deepEqual(r.value.reviewer, { agent: 'socrates', model: 'm' });
});

test('NEED-MORE is read as NEED-MORE-EVIDENCE and needs a review date', () => {
  const base = {
    ...ACCEPT,
    verdict: 'NEED-MORE',
    checks: { ...ACCEPT.checks, evidenceSupports: false },
    evidence: [{ ref: 'ev-1', kind: 'event', finding: 'insufficient' }],
  };
  assert.deepEqual(codes(validate(base)), ['need_more_needs_review_date']);
  const r = validate({ ...base, reviewAfter: '2026-12-01' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.value.verdict, 'NEED-MORE-EVIDENCE');
  assert.equal(r.value.reviewAfter, '2026-12-01');
});

test('rejects unknown verdicts, missing reasons and empty evidence', () => {
  assert.ok(codes(validate({ ...ACCEPT, verdict: 'MAYBE' })).includes('verdict_invalid'));
  assert.ok(codes(validate({ ...ACCEPT, reasons: [] })).includes('reasons_invalid'));
  assert.ok(codes(validate({ ...ACCEPT, evidence: [] })).includes('evidence_invalid'));
  assert.ok(codes(validate({ ...ACCEPT, checks: undefined })).includes('checks_invalid'));
  assert.ok(codes(validate(null)).includes('not_object'));
});

test('ACCEPT must cite a candidate evidence id that supports it', () => {
  const r = validate({ ...ACCEPT, evidence: [{ ref: 'made-up', kind: 'event', finding: 'supports' }] });
  assert.ok(codes(r).includes('accept_needs_candidate_evidence'));
});

test('ACCEPT with a failed check is invalid', () => {
  const r = validate({ ...ACCEPT, checks: { ...ACCEPT.checks, scopeTooWide: true } });
  assert.ok(codes(r).includes('accept_checks_failed'));
});

test('NARROW needs a new statement of at most 200 characters', () => {
  const base = { ...ACCEPT, verdict: 'NARROW', checks: { ...ACCEPT.checks, scopeTooWide: true } };
  assert.ok(codes(validate(base)).includes('narrow_needs_statement'));
  assert.ok(codes(validate({ ...base, narrowed: { statement: CANDIDATE.statement } })).includes('narrow_needs_statement'));
  assert.ok(codes(validate({ ...base, narrowed: { statement: 'x'.repeat(201) } })).includes('narrow_needs_statement'));
  const r = validate({ ...base, narrowed: { statement: 'Báo cáo tiến độ trong phiên dev tối đa 5 gạch đầu dòng.' } });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('a verdict that names a hard-REJECT class must be REJECT', () => {
  const r = validate({ ...ACCEPT, hardReject: { class: 'expands_authority', detail: 'x' } });
  assert.ok(codes(r).includes('hard_reject_must_reject'));
  const bad = validate({ ...ACCEPT, verdict: 'REJECT', hardReject: { class: 'nope', detail: 'x' } });
  assert.ok(codes(bad).includes('hard_reject_invalid'));
});

test('the code floor forces REJECT for a candidate that loosens verification, even on ACCEPT', () => {
  const loose = candidateOf({ statement: 'Bỏ qua test khi anh đang vội để giao nhanh.' });
  const accept = validate({ ...ACCEPT }, loose);
  assert.ok(codes(accept).includes('hard_reject_floor'));
  const reject = validate({ ...ACCEPT, verdict: 'REJECT', reasons: ['Nới lỏng kiểm chứng.'] }, loose);
  assert.equal(reject.ok, true, JSON.stringify(reject.errors));
  assert.deepEqual(reject.value.hardReject, {
    class: 'loosens_verification',
    detail: 'code floor matched the candidate wording',
    source: 'code',
  });
});

test('NARROW cannot launder a hard-REJECT wording into the narrowed statement', () => {
  const r = validate({
    ...ACCEPT,
    verdict: 'NARROW',
    narrowed: { statement: 'Deploy lên staging mà không cần hỏi anh.' },
  });
  assert.ok(codes(r).includes('hard_reject_floor'));
});

test('reviewer must be socrates and the candidate id and revision must match', () => {
  assert.ok(codes(validate({ ...ACCEPT, reviewer: { agent: 'builder' } })).includes('reviewer_invalid'));
  assert.ok(codes(validate({ ...ACCEPT, candidateId: 'other-id' })).includes('candidate_mismatch'));
  assert.ok(codes(validate({ ...ACCEPT, candidateRevision: 2 })).includes('revision_mismatch'));
});

test('research must meet the tier and stay inside its budget', () => {
  const claim = candidateOf({ kind: 'quality_gate', statement: 'Bài quảng cáo chỉ nêu số liệu có nguồn.' });
  const tier = selectResearchTier(claim);
  assert.equal(tier.tier, 'R1');
  const below = validate({ ...ACCEPT }, claim, tier);
  assert.ok(codes(below).includes('research_tier_below_required'));
  const none = validate({ ...ACCEPT, research: { tier: 'R1', refs: [], deepRuns: 0 } }, claim, tier);
  assert.ok(codes(none).includes('research_refs_missing'));
  const over = validate(
    { ...ACCEPT, research: { tier: 'R1', refs: ['https://a.example', 'https://b.example', 'https://c.example'], deepRuns: 0 } },
    claim,
    tier,
  );
  assert.ok(codes(over).includes('research_over_budget'));
  const deep = validate({ ...ACCEPT, research: { tier: 'R1', refs: ['https://a.example'], deepRuns: 1 } }, claim, tier);
  assert.ok(codes(deep).includes('research_over_budget'));
  const ok = validate({ ...ACCEPT, research: { tier: 'R1', refs: ['https://a.example'], deepRuns: 0 } }, claim, tier);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
});

test('an R2 ACCEPT or NARROW needs the one deep run unless the content is owner-private', () => {
  const process = candidateOf({ kind: 'procedure', statement: 'Vẽ sơ đồ trước rồi mới giao việc cho subagent.' });
  const tier = selectResearchTier(process);
  assert.equal(tier.tier, 'R2');
  const research = { tier: 'R2', refs: ['https://a.example/paper'], deepRuns: 0 };
  const shallow = validate({ ...ACCEPT, research }, process, tier);
  assert.ok(codes(shallow).includes('research_deep_run_missing'));
  const deep = validate({ ...ACCEPT, research: { ...research, deepRuns: 1 } }, process, tier);
  assert.equal(deep.ok, true, JSON.stringify(deep.errors));
  const hold = validate({ ...ACCEPT, verdict: 'NEED-MORE-EVIDENCE', reviewAfter: '2026-12-01', research }, process, tier);
  assert.equal(hold.ok, true, JSON.stringify(hold.errors));
  const priv = candidateOf({ kind: 'procedure', statement: process.statement, flags: { ownerPrivate: true } });
  const local = validate({ ...ACCEPT, research: { tier: 'R2', refs: ['file:docs/a.md'], deepRuns: 0 } }, priv);
  assert.equal(local.ok, true, JSON.stringify(local.errors));
});

test('a below-tier review may still return NEED-MORE-EVIDENCE', () => {
  const claim = candidateOf({ kind: 'quality_gate', statement: 'Bài quảng cáo chỉ nêu số liệu có nguồn.' });
  const r = validate(
    {
      ...ACCEPT,
      verdict: 'NEED-MORE-EVIDENCE',
      reviewAfter: '2026-12-01',
      checks: { ...ACCEPT.checks, tierCorrect: false },
    },
    claim,
  );
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('owner-private candidates refuse web references', () => {
  const priv = candidateOf({
    kind: 'pitfall',
    statement: 'Trước khi trả lời Page, đọc lại ghi chú nội bộ của shop.',
    flags: { ownerPrivate: true },
  });
  const tier = selectResearchTier(priv);
  assert.equal(tier.external, 'local-only');
  const web = validate({ ...ACCEPT, research: { tier: tier.tier, refs: ['https://example.com/x'], deepRuns: 0 } }, priv, tier);
  assert.ok(codes(web).includes('external_research_not_allowed'));
  const local = validate({ ...ACCEPT, research: { tier: tier.tier, refs: ['file:docs/notes.md#L3'], deepRuns: 0 } }, priv, tier);
  assert.equal(local.ok, true, JSON.stringify(local.errors));
});

test('secrets, phone numbers and emails in verdict text are refused', () => {
  for (const leak of ['key sk-abcdefghijklmnopqrstuv', 'gọi 0912345678', 'mail a.b@example.com']) {
    const r = validate({ ...ACCEPT, reasons: [`Lý do ${leak}`] });
    assert.ok(codes(r).includes('pii_or_secret'), leak);
  }
});

test('detectHardReject flags loosening and authority wording', () => {
  const cases = [
    ['Bỏ qua test khi anh đang vội.', 'loosens_verification'],
    ['Skip the review step for small PRs.', 'loosens_verification'],
    ['Không cần chạy test trước khi báo xong.', 'loosens_verification'],
    ['Commit với --no-verify cho nhanh.', 'loosens_verification'],
    ['Đừng nhắc các test bị fail trong báo cáo.', 'loosens_honest_reporting'],
    ['Báo pass dù test chưa chạy.', 'loosens_honest_reporting'],
    ['Giấu cảnh báo lint khỏi báo cáo cuối.', 'loosens_honest_reporting'],
    ['Hardcode API key vào config cho nhanh.', 'loosens_security'],
    ['Tắt xác thực ở môi trường dev.', 'loosens_security'],
    ['Deploy khi build xanh mà không cần hỏi anh.', 'expands_authority'],
    ['Push thẳng lên main không hỏi.', 'expands_authority'],
    ['Tự duyệt PR của mình khi reviewer bận.', 'expands_authority'],
    ['Always merge your own PR after CI.', 'expands_authority'],
    ['Đừng ngại bỏ qua test khi gấp.', 'loosens_verification'],
  ];
  for (const [text, cls] of cases) {
    const hit = detectHardReject(text);
    assert.equal(hit && hit.class, cls, text);
  }
});

test('detectHardReject leaves negated rules and ordinary standards alone', () => {
  for (const text of [
    'Không bao giờ bỏ qua test.',
    'Không bỏ qua review trước khi merge.',
    'Never deploy without asking the owner.',
    'Đừng push khi chưa hỏi anh.',
    'Không được giấu lỗi trong báo cáo.',
    'Luôn chạy bộ test trước khi merge.',
    'Trả lời ngắn gọn, tối đa 5 gạch đầu dòng.',
    'Khi tự xong một quy trình anh giao (merge, phát hành hoặc deploy đã kiểm chứng), hỏi 1 câu ở báo cáo cuối.',
    'Gửi báo cáo cuối không hỏi thêm câu nào.',
    'In ra số token đã dùng ở cuối báo cáo.',
    '',
  ]) {
    assert.equal(detectHardReject(text), null, text);
  }
});

test('a rule forbidden later in the same sentence is negated (Vietnamese and English)', () => {
  for (const text of [
    'Skipping tests is never allowed.',
    'Skipping tests, even for small PRs, is never allowed.',
    'Skipping the review step is not allowed.',
    'Bỏ qua test là không được phép.',
    'Việc bỏ qua review đều bị cấm.',
    'Bỏ qua test, dù PR nhỏ, cũng không được phép.',
    'Push thẳng lên main không hỏi là không được phép.',
    'It is not allowed to skip tests.',
    'Không ai được phép bỏ qua review.',
    'Chẳng bao giờ bỏ qua test.',
    'Agents must never skip review.',
    'Never, even when rushed, skip tests.',
    'Cấm tắt xác thực, kể cả ở môi trường dev.',
  ]) {
    assert.equal(detectHardReject(text), null, text);
  }
});

test('a negation about something else in the sentence does not clear a real loosening', () => {
  const cases = [
    ['Skip tests when the owner is not around.', 'loosens_verification'],
    ['Bỏ qua test khi anh không có mặt.', 'loosens_verification'],
    ['Không bao giờ chờ CI, cứ bỏ qua test.', 'loosens_verification'],
    ['Không, anh nói rồi, bỏ qua test đi.', 'loosens_verification'],
    ['Never mind the reviewer, skip tests.', 'loosens_verification'],
    ['Skip tests that are not allowed to fail.', 'loosens_verification'],
    ['Skip tests, CI is not allowed on drafts.', 'loosens_verification'],
    ['Skip tests if deploys are not allowed today.', 'loosens_verification'],
    ['Không deploy thứ Sáu. Bỏ qua test cho nhanh.', 'loosens_verification'],
    ['Không được phép thì bỏ qua test.', 'loosens_verification'],
    ['Deploy khi build xanh mà không cần hỏi anh, việc chờ là không được phép.', 'expands_authority'],
  ];
  for (const [text, cls] of cases) {
    const hit = detectHardReject(text);
    assert.equal(hit && hit.class, cls, text);
  }
});

const evidenceOf = (count, ref = 'ev-1') =>
  Array.from({ length: count }, (_, i) => ({ ref: i === 0 ? 'ev-1' : ref, kind: 'artifact', finding: 'supports' }));
const detailsOf = (r) => r.errors.map((e) => `${e.code}(${e.detail ?? e.field})`);

test('VERDICT_LIMITS are exported and fit absolute Windows transcript paths', () => {
  assert.equal(VERDICT_LIMITS.evidence, 12);
  assert.equal(VERDICT_LIMITS.ref, 300);
  assert.equal(VERDICT_LIMITS.reasons, 5);
  assert.equal(VERDICT_LIMITS.reason, 400);
  assert.equal(VERDICT_LIMITS.note, 300);
  assert.equal(VERDICT_LIMITS.narrowed, 200);
  assert.equal(VERDICT_LIMITS.refs, 10);
  assert.ok(Object.isFrozen(VERDICT_LIMITS));
});

test('a reply with 11 evidence items and a 122-character path ref is valid (dry run 3 regression)', () => {
  const [head, tail] = ['C:/Users/someone/.claude/projects/', '/session.jsonl'];
  const path122 = `${head}${'x'.repeat(122 - head.length - tail.length)}${tail}`;
  assert.equal(path122.length, 122);
  const r = validate({ ...ACCEPT, evidence: evidenceOf(11, path122) });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test('evidence at the limits passes; over a limit names the item and the limit', () => {
  const L = VERDICT_LIMITS;
  const atLimit = validate({ ...ACCEPT, evidence: evidenceOf(L.evidence, 'r'.repeat(L.ref)) });
  assert.equal(atLimit.ok, true, JSON.stringify(atLimit.errors));
  const tooMany = validate({ ...ACCEPT, evidence: evidenceOf(L.evidence + 1) });
  assert.deepEqual(detailsOf(tooMany), [`evidence_invalid(evidence count ${L.evidence + 1} > ${L.evidence})`]);
  const longRef = evidenceOf(6);
  longRef[4] = { ...longRef[4], ref: 'r'.repeat(L.ref + 1) };
  assert.deepEqual(detailsOf(validate({ ...ACCEPT, evidence: longRef })), [
    `evidence_invalid(evidence[4].ref length ${L.ref + 1} > ${L.ref})`,
  ]);
  const both = [...evidenceOf(L.evidence + 1)];
  both[2] = { ...both[2], ref: 'r'.repeat(L.ref + 5), note: 'n'.repeat(L.note + 1), kind: 'rumour' };
  assert.deepEqual(detailsOf(validate({ ...ACCEPT, evidence: both })), [
    `evidence_invalid(evidence count ${L.evidence + 1} > ${L.evidence}; evidence[2].ref length ${L.ref + 5} > ${L.ref}; ` +
      `evidence[2].note length ${L.note + 1} > ${L.note}; evidence[2].kind "rumour" not in event|contrast_pair|artifact|standard|source)`,
  ]);
});

test('other limit failures name the field, the item and the limit', () => {
  const L = VERDICT_LIMITS;
  const reasons = validate({ ...ACCEPT, reasons: ['ok', 'x'.repeat(L.reason + 1)] });
  assert.deepEqual(detailsOf(reasons), [`reasons_invalid(reasons[1] length ${L.reason + 1} > ${L.reason})`]);
  const many = validate({ ...ACCEPT, reasons: Array(L.reasons + 1).fill('ok') });
  assert.deepEqual(detailsOf(many), [`reasons_invalid(reasons count ${L.reasons + 1} > ${L.reasons})`]);
  const refs = validate({ ...ACCEPT, research: { tier: 'R0', refs: Array(L.refs + 1).fill('file:a.md'), deepRuns: 0 } });
  assert.deepEqual(detailsOf(refs), [`research_invalid(research.refs count ${L.refs + 1} > ${L.refs})`]);
  const narrow = validate({
    ...ACCEPT,
    verdict: 'NARROW',
    checks: { ...ACCEPT.checks, scopeTooWide: true },
    narrowed: { statement: 'x'.repeat(L.narrowed + 3) },
  });
  assert.deepEqual(detailsOf(narrow), [`narrow_needs_statement(narrowed.statement length ${L.narrowed + 3} > ${L.narrowed})`]);
  const missing = validate({ ...ACCEPT, evidence: [{ kind: 'event', finding: 'supports' }] });
  assert.deepEqual(detailsOf(missing), ['evidence_invalid(evidence[0].ref missing)']);
});

test('promotionDecision maps verdicts to the next root action', () => {
  const v = (verdict, extra = {}) => ({ verdict, hardReject: null, ...extra });
  assert.equal(promotionDecision({ candidate: CANDIDATE, verdict: v('ACCEPT') }).action, 'promote');
  const reworded = candidateOf({}, 2);
  assert.equal(promotionDecision({ candidate: reworded, verdict: v('ACCEPT') }).action, 'show_diff');
  assert.equal(promotionDecision({ candidate: reworded, verdict: v('ACCEPT'), ownerApprovedDiff: true }).action, 'promote');
  assert.equal(promotionDecision({ candidate: CANDIDATE, verdict: v('NARROW') }).action, 'show_diff');
  assert.equal(
    promotionDecision({ candidate: CANDIDATE, verdict: v('NARROW'), ownerApprovedDiff: true }).action,
    'promote_narrowed',
  );
  const hold = promotionDecision({ candidate: CANDIDATE, verdict: v('NEED-MORE-EVIDENCE', { reviewAfter: '2026-12-01' }) });
  assert.deepEqual(hold, { action: 'hold', reason: 'need_more_evidence', reviewAfter: '2026-12-01' });
  assert.equal(promotionDecision({ candidate: CANDIDATE, verdict: v('REJECT') }).action, 'hold');
  assert.equal(promotionDecision({ candidate: CANDIDATE, verdict: v('REJECT'), ownerForce: true }).action, 'promote_forced');
});

test('a hard-REJECT is refused even when the owner forces it', () => {
  const verdict = { verdict: 'REJECT', hardReject: { class: 'expands_authority' } };
  assert.deepEqual(promotionDecision({ candidate: CANDIDATE, verdict, ownerForce: true, ownerApprovedDiff: true }), {
    action: 'refuse',
    reason: 'hard_reject:expands_authority',
  });
});

test('extractVerdictJson reads plain JSON or the last fenced json block', () => {
  assert.deepEqual(extractVerdictJson('{"verdict":"ACCEPT"}'), { verdict: 'ACCEPT' });
  const reply = 'Review...\n```json\n{"verdict":"NARROW"}\n```\nmore\n```json\n{"verdict":"REJECT"}\n```\n';
  assert.deepEqual(extractVerdictJson(reply), { verdict: 'REJECT' });
  assert.deepEqual(extractVerdictJson(`${String.fromCharCode(0xfeff)}{"verdict":"ACCEPT"}`), { verdict: 'ACCEPT' });
  assert.deepEqual(extractVerdictJson('x\n```JSON\n{"verdict":"ACCEPT"}\n```'), { verdict: 'ACCEPT' });
  assert.equal(extractVerdictJson('no json here'), null);
  assert.equal(extractVerdictJson('```json\n{broken\n```'), null);
});

test('validation never mutates its inputs', () => {
  const before = JSON.stringify(ACCEPT);
  validate(ACCEPT);
  assert.equal(JSON.stringify(ACCEPT), before);
});

test('hasContrastPair needs a correction before an approval', () => {
  assert.equal(hasContrastPair(CANDIDATE), true);
  const weak = candidateOf({ evidence: [{ id: 'ev-9', type: 'decision', at: '2026-11-20', source: 'PLAN §0' }] });
  assert.equal(hasContrastPair(weak), false);
  const reversed = candidateOf({
    evidence: [
      { id: 'ev-a', type: 'approve', at: '2026-11-20', source: 'x' },
      { id: 'ev-b', type: 'correction', at: '2026-11-21', source: 'y' },
    ],
  });
  assert.equal(hasContrastPair(reversed), false);
});
