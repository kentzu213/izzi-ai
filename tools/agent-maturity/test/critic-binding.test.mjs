// Verdict binding (inputFingerprint + brief snapshot), the one JSON retry, the store-wide hard-REJECT index and
// the store lock, through the in-process brief and record functions.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { briefCandidate } from '../critic/brief.mjs';
import { validateCandidate } from '../critic/candidate.mjs';
import { EXIT } from '../critic/cli.mjs';
import { createJsonAdapter } from '../critic/json-adapter.mjs';
import { inputFingerprint } from '../critic/loop-guard.mjs';
import { recordVerdict } from '../critic/record-verdict.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'am-critic-bind-'));
after(() => rmSync(scratch, { recursive: true, force: true }));
let n = 0;
const freshStore = () => join(scratch, `store-${(n += 1)}`);
const NOW = new Date('2026-11-21T10:00:00.000Z');

const RAW_A = {
  id: 'bind-case',
  statement: 'Báo cáo tiến độ tối đa 5 gạch đầu dòng.',
  kind: 'preference',
  scope: { agent: 'orchestrator', taskType: 'báo cáo tiến độ', projects: 'all' },
  check: 'Mỗi báo cáo có ≤5 gạch đầu dòng.',
  evidence: [
    { id: 'ev-1', type: 'correction', at: '2026-11-20', source: 's1 turn 4' },
    { id: 'ev-2', type: 'approve_after_reject', at: '2026-11-20', source: 's1 turn 6' },
  ],
};
const parsed = (raw) => {
  const r = validateCandidate(raw);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return r.value;
};
const A = parsed(RAW_A);
const B = parsed({ ...RAW_A, statement: 'Báo cáo tiến độ tối đa 3 gạch đầu dòng.' });
const C = parsed({ ...RAW_A, scope: { ...RAW_A.scope, projects: 'this' } });
const fp = (candidate, revision = 1) => inputFingerprint({ ...candidate, revision });

const ACCEPT_CHECKS = { evidenceSupports: true, scopeTooWide: false, contradictsExisting: false, tierCorrect: true };
const reply = (candidate, extra = {}, revision = 1) =>
  JSON.stringify({
    candidateId: candidate.id,
    candidateRevision: revision,
    inputFingerprint: fp(candidate, revision),
    verdict: 'ACCEPT',
    reasons: ['Cặp đối chứng ev-1 → ev-2 đỡ đúng câu chuẩn.'],
    evidence: [{ ref: 'ev-1', kind: 'event', finding: 'supports' }],
    checks: ACCEPT_CHECKS,
    hardReject: null,
    research: { tier: 'R0', refs: [], deepRuns: 0 },
    reviewer: { agent: 'socrates' },
    ...extra,
  });

const brief = (adapter, candidate) => briefCandidate({ candidate, adapter, now: NOW });
const record = (adapter, candidate, verdictText) => recordVerdict({ candidate, verdictText, adapter, now: NOW });
const refused = (exitCode, pattern) => (error) => error.exitCode === exitCode && pattern.test(error.message);
const events = (store) =>
  existsSync(join(store, 'log.jsonl'))
    ? readFileSync(join(store, 'log.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];

// ---- finding 1: a verdict is bound to the text that was briefed ----------------------------------------------

test('ACCEPT recorded for A cannot be recorded for B (same id, changed statement or scope)', () => {
  for (const other of [B, C]) {
    const store = freshStore();
    const adapter = createJsonAdapter(store);
    brief(adapter, A);
    assert.equal(record(adapter, A, reply(A)).verdict, 'ACCEPT');
    assert.throws(() => record(adapter, other, reply(A)), refused(EXIT.invalid, /brief_snapshot_missing/));
    brief(adapter, other);
    assert.throws(() => record(adapter, other, reply(A)), refused(EXIT.invalid, /fingerprint_mismatch|revision_mismatch/));
    assert.equal(adapter.loadCandidate('bind-case').verdicts.length, 1, 'nothing stored for the other text');
    assert.equal(adapter.loadCandidate('bind-case').candidate.statement, A.statement);
  }
});

test('a reply judged on A is refused when the candidate file became B before recording', () => {
  const store = freshStore();
  const adapter = createJsonAdapter(store);
  brief(adapter, A);
  assert.throws(() => record(adapter, B, reply(A)), refused(EXIT.invalid, /brief_snapshot_missing/));
  brief(adapter, B);
  assert.throws(() => record(adapter, B, reply(A)), refused(EXIT.invalid, /fingerprint_mismatch/));
  assert.equal(adapter.loadCandidate('bind-case'), null);
});

test('record-verdict refuses when the stored snapshot does not match what is recorded', () => {
  const store = freshStore();
  const adapter = createJsonAdapter(store);
  const { fingerprint } = brief(adapter, A);
  const file = join(store, 'briefs', 'bind-case', `${fingerprint}.json`);
  const snapshot = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...snapshot, candidate: { ...snapshot.candidate, statement: B.statement } }));
  assert.throws(() => record(adapter, A, reply(A)), refused(EXIT.invalid, /brief_snapshot_mismatch/));
  writeFileSync(file, JSON.stringify({ ...snapshot, critiqueNumber: 2 }));
  assert.throws(() => record(adapter, A, reply(A)), refused(EXIT.invalid, /brief_snapshot_mismatch/));
  assert.equal(adapter.loadCandidate('bind-case'), null);
});

test('a reply without inputFingerprint is refused (format, one retry)', () => {
  const adapter = createJsonAdapter(freshStore());
  brief(adapter, A);
  const { inputFingerprint: _drop, ...noFp } = JSON.parse(reply(A));
  assert.throws(() => record(adapter, A, JSON.stringify(noFp)), refused(EXIT.invalid, /fingerprint_missing.*one retry/));
  assert.equal(record(adapter, A, reply(A)).verdict, 'ACCEPT');
});

// ---- finding 5: at most one "fix only the JSON" retry, only for format/limit errors ---------------------------

test('a format error gets exactly one retry, logged in the loop-guard log', () => {
  const store = freshStore();
  const adapter = createJsonAdapter(store);
  brief(adapter, A);
  const tooLong = reply(A, { evidence: [{ ref: 'r'.repeat(301), kind: 'event', finding: 'supports' }] });
  assert.throws(() => record(adapter, A, tooLong), refused(EXIT.invalid, /evidence_invalid.*one retry/));
  assert.throws(() => brief(adapter, A), refused(EXIT.blocked, /json_retry_pending/));
  assert.equal(record(adapter, A, reply(A)).verdict, 'ACCEPT');
  const refusals = events(store).filter((e) => e.type === 'verdict_refused');
  assert.equal(refusals.length, 1);
  assert.deepEqual(
    [refusals[0].critiqueNumber, refusals[0].attempt, refusals[0].retryable, refusals[0].inputFingerprint],
    [1, 1, true, fp(A)],
  );
});

test('a second refused reply ends the critique', () => {
  const store = freshStore();
  const adapter = createJsonAdapter(store);
  brief(adapter, A);
  const twoBlocks = `\`\`\`json\n${reply(A)}\n\`\`\`\n\`\`\`json\n${reply(A)}\n\`\`\``;
  assert.throws(() => record(adapter, A, twoBlocks), refused(EXIT.invalid, /multiple_json_blocks.*one retry/));
  const dup = reply(A).replace('"verdict":"ACCEPT"', '"verdict":"REJECT","verdict":"ACCEPT"');
  assert.throws(() => record(adapter, A, dup), refused(EXIT.invalid, /duplicate_keys.*no retry/));
  assert.throws(() => record(adapter, A, reply(A)), refused(EXIT.blocked, /reply_refused_final|json_retry_used/));
  assert.equal(adapter.loadCandidate('bind-case'), null);
});

test('semantic errors get no retry: accept_checks_failed and research_deep_run_missing', () => {
  const R2 = parsed({ ...RAW_A, id: 'bind-r2', kind: 'procedure', statement: 'Vẽ sơ đồ trước rồi mới giao việc cho subagent.' });
  const cases = [
    [A, reply(A, { checks: { ...ACCEPT_CHECKS, scopeTooWide: true } }), /accept_checks_failed.*no retry/],
    [R2, reply(R2, { research: { tier: 'R2', refs: ['https://a.example/x'], deepRuns: 0 } }), /research_deep_run_missing.*no retry/],
  ];
  for (const [candidate, text, pattern] of cases) {
    const store = freshStore();
    const adapter = createJsonAdapter(store);
    brief(adapter, candidate);
    assert.throws(() => record(adapter, candidate, text), refused(EXIT.invalid, pattern));
    assert.throws(() => record(adapter, candidate, reply(candidate)), refused(EXIT.blocked, /reply_refused_final/));
    assert.throws(() => brief(adapter, candidate), refused(EXIT.blocked, /reply_refused_final/));
    const refusal = events(store).find((e) => e.type === 'verdict_refused');
    assert.equal(refusal.retryable, false);
  }
});

test('the JSON retry cannot change the verdict', () => {
  const adapter = createJsonAdapter(freshStore());
  brief(adapter, A);
  const narrowTooLong = reply(A, {
    verdict: 'NARROW',
    checks: { ...ACCEPT_CHECKS, scopeTooWide: true },
    narrowed: { statement: 'x'.repeat(201) },
  });
  assert.throws(() => record(adapter, A, narrowTooLong), refused(EXIT.invalid, /narrowed_invalid.*one retry/));
  assert.throws(() => record(adapter, A, reply(A)), refused(EXIT.invalid, /retry_changed_verdict/));
});

// ---- finding 6: a hard-REJECT is final across the store -------------------------------------------------------

test('a new id with the same normalized statement as a hard-REJECTed candidate is refused without critique', () => {
  const store = freshStore();
  const adapter = createJsonAdapter(store);
  const loose = parsed({ ...RAW_A, id: 'loose-one', statement: 'Push thẳng lên main không hỏi khi CI xanh.' });
  brief(adapter, loose);
  const summary = record(adapter, loose, reply(loose, { verdict: 'REJECT' }));
  assert.equal(summary.hardReject.class, 'expands_authority');
  for (const statement of [
    'Push thẳng lên main không hỏi khi CI xanh.',
    'push thang len main KHONG hoi, khi ci xanh!',
    'Push  thẳng lên main — không hỏi khi CI xanh',
  ]) {
    const again = parsed({ ...RAW_A, id: 'loose-two', statement });
    assert.throws(() => brief(adapter, again), refused(EXIT.blocked, /hard_reject_statement.*loose-one/));
    assert.throws(() => record(adapter, again, reply(again, { verdict: 'REJECT' })), refused(EXIT.blocked, /hard_reject_statement/));
  }
  assert.equal(adapter.loadCandidate('loose-two'), null);
  assert.equal(existsSync(join(store, 'briefs', 'loose-two')), false);
  assert.ok(events(store).some((e) => e.type === 'critique_blocked' && e.reason === 'hard_reject_statement'));
});

// ---- finding 8: the JSON store locks its read-modify-write ---------------------------------------------------

test('a fresh lock held by another writer blocks a store write; a stale lock is taken over', () => {
  const store = freshStore();
  mkdirSync(store, { recursive: true });
  const lock = join(store, '.lock');
  writeFileSync(lock, 'other-writer');
  const adapter = createJsonAdapter(store, { lockWaitMs: 60, lockStaleMs: 60_000 });
  assert.throws(() => adapter.logEvent({ type: 'x', candidateId: 'bind-case' }), /locked/);
  assert.throws(() => brief(adapter, A), /locked/);
  assert.equal(existsSync(join(store, 'log.jsonl')), false);
  const old = new Date(Date.now() - 120_000);
  utimesSync(lock, old, old);
  adapter.logEvent({ type: 'x', candidateId: 'bind-case' });
  assert.equal(events(store).length, 1);
  assert.equal(existsSync(lock), false, 'lock released after the write');
});

test('the lock is re-entrant inside one adapter and released after an error', () => {
  const store = freshStore();
  const adapter = createJsonAdapter(store);
  adapter.withLock(() => {
    adapter.logEvent({ type: 'inner', candidateId: 'bind-case' });
    assert.ok(existsSync(join(store, '.lock')));
  });
  assert.equal(existsSync(join(store, '.lock')), false);
  assert.throws(() => adapter.withLock(() => {
    throw new Error('boom');
  }), /boom/);
  assert.equal(existsSync(join(store, '.lock')), false);
});

test('recordVerdict refuses an adapter that lacks the binding, index or lock methods', () => {
  const partial = { loadCandidate: () => null, saveCandidate() {}, saveVerdict() {} };
  assert.throws(() => record(partial, A, reply(A)), /adapter is missing/);
});
