// Verdict binding (inputFingerprint + brief snapshot), the one JSON retry, the store-wide hard-REJECT index and
// the store lock, through the in-process brief and record functions.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { briefCandidate } from '../critic/brief.mjs';
import { validateCandidate } from '../critic/candidate.mjs';
import { EXIT } from '../critic/cli.mjs';
import { clearStaleLock, createJsonAdapter } from '../critic/json-adapter.mjs';
import { inputFingerprint, statementKey } from '../critic/loop-guard.mjs';
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
  const loose = parsed({ ...RAW_A, id: 'loose-one', statement: 'Push thẳng lên main không hỏi.' });
  brief(adapter, loose);
  const summary = record(adapter, loose, reply(loose, { verdict: 'REJECT' }));
  assert.equal(summary.hardReject.class, 'expands_authority');
  for (const statement of ['Push thẳng lên main không hỏi.', 'push thẳng lên main KHÔNG hỏi!', 'Push  thẳng lên main — không hỏi']) {
    const again = parsed({ ...RAW_A, id: 'loose-two', statement });
    assert.throws(() => brief(adapter, again), refused(EXIT.blocked, /hard_reject_statement.*loose-one/));
    assert.throws(() => record(adapter, again, reply(again, { verdict: 'REJECT' })), refused(EXIT.blocked, /hard_reject_statement/));
  }
  assert.equal(adapter.loadCandidate('loose-two'), null);
  assert.equal(existsSync(join(store, 'briefs', 'loose-two')), false);
  assert.ok(events(store).some((e) => e.type === 'critique_blocked' && e.reason === 'hard_reject_statement'));
  // Diacritics are part of the key: the unaccented spelling is a different statement (the floor judges it anew).
  const unaccented = parsed({ ...RAW_A, id: 'loose-three', statement: 'Push thang len main khong hoi.' });
  assert.notEqual(statementKey(unaccented.statement), statementKey(loose.statement));
  assert.equal(brief(adapter, unaccented).plan.allowed, true);
});

test('the hard-REJECT index is written before the verdict record', () => {
  const store = freshStore();
  const real = createJsonAdapter(store);
  const loose = parsed({ ...RAW_A, id: 'loose-crash', statement: 'Push thẳng lên main không hỏi.' });
  brief(real, loose);
  const crashing = { ...real, saveVerdict() {
    throw new Error('crash before the verdict is written');
  } };
  assert.throws(() => record(crashing, loose, reply(loose, { verdict: 'REJECT' })), /crash before the verdict/);
  assert.equal(real.findHardReject(statementKey(loose.statement)).candidateId, 'loose-crash');
  assert.equal(real.loadCandidate('loose-crash').verdicts.length, 0);
});

// ---- N2: the retry keeps the first reply's verdict and hardReject presence -------------------------------------

test('a refusal logs the raw first-reply verdict and whether hardReject was set', () => {
  const store = freshStore();
  const adapter = createJsonAdapter(store);
  brief(adapter, A);
  const longRef = [{ ref: 'r'.repeat(301), kind: 'event', finding: 'supports' }];
  assert.throws(() => record(adapter, A, reply(A, { verdict: ' need-more ', evidence: longRef })), refused(EXIT.invalid, /one retry/));
  const refusal = events(store).find((e) => e.type === 'verdict_refused');
  assert.deepEqual([refusal.verdict, refusal.rawVerdict, refusal.hardRejectPresent], ['NEED-MORE-EVIDENCE', ' need-more ', false]);
});

test('after an unreadable first verdict, the retry may only be REJECT or NEED-MORE-EVIDENCE', () => {
  for (const first of ['no json at all', reply(A, { verdict: 'MAYBE' })]) {
    const store = freshStore();
    const adapter = createJsonAdapter(store);
    brief(adapter, A);
    assert.throws(() => record(adapter, A, first), refused(EXIT.invalid, /one retry/));
    assert.equal(events(store).find((e) => e.type === 'verdict_refused').verdict, null);
    assert.throws(() => record(adapter, A, reply(A)), refused(EXIT.invalid, /retry_verdict_not_allowed/));
  }
  const adapter = createJsonAdapter(freshStore());
  brief(adapter, A);
  assert.throws(() => record(adapter, A, 'no json at all'), refused(EXIT.invalid, /no_json.*one retry/));
  assert.equal(record(adapter, A, reply(A, { verdict: 'REJECT' })).verdict, 'REJECT');
});

test('the retry cannot add or drop hardReject', () => {
  const longRef = [{ ref: 'r'.repeat(301), kind: 'event', finding: 'supports' }];
  const withHard = { verdict: 'REJECT', hardReject: { class: 'loosens_verification', detail: 'x' } };
  const cases = [
    [reply(A, { ...withHard, evidence: longRef }), reply(A, { verdict: 'REJECT' })],
    [reply(A, { verdict: 'REJECT', evidence: longRef }), reply(A, withHard)],
  ];
  for (const [first, retry] of cases) {
    const adapter = createJsonAdapter(freshStore());
    brief(adapter, A);
    assert.throws(() => record(adapter, A, first), refused(EXIT.invalid, /one retry/));
    assert.throws(() => record(adapter, A, retry), refused(EXIT.invalid, /retry_changed_hard_reject/));
  }
});

// ---- N6: every brief is logged, at most two per candidate revision ---------------------------------------------

test('a third brief for the same candidate revision is blocked and logged', () => {
  const store = freshStore();
  const adapter = createJsonAdapter(store);
  brief(adapter, A);
  brief(adapter, A);
  assert.throws(() => brief(adapter, A), refused(EXIT.blocked, /brief_cap/));
  const log = events(store);
  assert.equal(log.filter((e) => e.type === 'brief_generated').length, 2);
  assert.ok(log.some((e) => e.type === 'critique_blocked' && e.reason === 'brief_cap' && e.step === 'brief'));
});

test('the brief cap also holds per statement: a new candidate id does not reset it', () => {
  // Arrange
  const store = freshStore();
  const adapter = createJsonAdapter(store);
  brief(adapter, A);
  brief(adapter, A);

  // Act + Assert: the same statement under new ids (case and spacing do not matter) gets no third brief
  for (const raw of [{ ...RAW_A, id: 'bind-case-copy' }, { ...RAW_A, id: 'bind-case-upper', statement: `  ${RAW_A.statement.toUpperCase()}` }]) {
    assert.throws(() => brief(adapter, parsed(raw)), refused(EXIT.blocked, /statement_brief_cap/), raw.id);
  }
  assert.equal(brief(adapter, parsed({ ...RAW_A, id: 'bind-case-other', statement: B.statement })).plan.critiqueNumber, 1);
  const log = events(store);
  assert.ok(log.filter((e) => e.type === 'brief_generated').every((e) => e.statementKey === statementKey(e.candidateId === 'bind-case-other' ? B.statement : A.statement)));
  assert.ok(log.some((e) => e.type === 'critique_blocked' && e.reason === 'statement_brief_cap' && e.candidateId === 'bind-case-copy'));
  assert.equal(adapter.listBriefsForStatement(statementKey(A.statement)).length, 2);
});

// ---- N7: torn log tail and lock ownership ---------------------------------------------------------------------

test('a torn trailing log line is skipped by readers and cut off by the next append', () => {
  const store = freshStore();
  const adapter = createJsonAdapter(store);
  adapter.logEvent({ type: 'x', candidateId: 'bind-case' });
  const log = join(store, 'log.jsonl');
  writeFileSync(log, `${readFileSync(log, 'utf8')}{"type":"verdict_ref`);
  assert.deepEqual(adapter.listEvents('bind-case'), [{ type: 'x', candidateId: 'bind-case' }]);
  adapter.logEvent({ type: 'y', candidateId: 'bind-case' });
  const lines = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((e) => e.type), ['x', 'log_repaired', 'y']);
  assert.equal(lines[1].droppedBytes, '{"type":"verdict_ref'.length);
  writeFileSync(log, `${readFileSync(log, 'utf8')}{"type":"z","candidateId":"bind-case"}`);
  adapter.logEvent({ type: 'w', candidateId: 'bind-case' });
  assert.deepEqual(adapter.listEvents('bind-case').map((e) => e.type), ['x', 'y', 'z', 'w'], 'a complete last line is kept');
  writeFileSync(log, `{"type":"broken\n${readFileSync(log, 'utf8')}`);
  assert.throws(() => adapter.listEvents('bind-case'), SyntaxError, 'a corrupt line in the middle is not skipped');
});

test('release leaves a lock that another writer took over; the lock records pid and nonce', () => {
  const store = freshStore();
  const adapter = createJsonAdapter(store);
  const lock = join(store, '.lock');
  adapter.withLock(() => {
    assert.match(readFileSync(lock, 'utf8'), new RegExp(`^${process.pid} [0-9a-f]{16} `));
    writeFileSync(lock, 'other-writer 0123456789abcdef now\n');
  });
  assert.equal(readFileSync(lock, 'utf8'), 'other-writer 0123456789abcdef now\n', 'not removed: it is not ours');
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

test('a stale lock is removed through a tombstone; a lock replaced after the stale check is put back', () => {
  // Arrange
  const store = freshStore();
  mkdirSync(store, { recursive: true });
  const lock = join(store, '.lock');
  const old = new Date(Date.now() - 120_000);
  const judged = 'dead-writer 0123456789abcdef then\n';

  // Act + Assert: the stale lock that was judged is removed
  writeFileSync(lock, judged);
  utimesSync(lock, old, old);
  assert.equal(clearStaleLock(lock, judged, 30_000), true);
  assert.equal(existsSync(lock), false);

  // another writer replaced it after the stale check: its lock is put back, never deleted
  writeFileSync(lock, 'new-writer fedcba9876543210 now\n');
  utimesSync(lock, old, old);
  assert.equal(clearStaleLock(lock, judged, 30_000), false);
  assert.equal(readFileSync(lock, 'utf8'), 'new-writer fedcba9876543210 now\n');

  // a fresh lock is never touched
  writeFileSync(lock, 'live-writer 00112233445566aa now\n');
  assert.equal(clearStaleLock(lock, 'live-writer 00112233445566aa now\n', 30_000), false);
  assert.equal(readFileSync(lock, 'utf8'), 'live-writer 00112233445566aa now\n');
  assert.deepEqual(readdirSync(store).filter((f) => f.includes('.stale-')), [], 'no tombstone left behind');
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
