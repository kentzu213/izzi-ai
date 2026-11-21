// DI: the single door for a dev standard. Candidate -> brief -> verdict (D4 critic store) -> the owner's checkpoint
// answer as the real D1 hook logs it -> promote-standard -> KnowledgeMemory (temp store and vault) -> export ->
// SessionStart block. Everything runs on temp folders; the real stores and ~/.claude are checked untouched.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { briefCandidate } from '../critic/brief.mjs';
import { validateCandidate } from '../critic/candidate.mjs';
import { createJsonAdapter } from '../critic/json-adapter.mjs';
import { inputFingerprint, statementKey } from '../critic/loop-guard.mjs';
import { recordVerdict } from '../critic/record-verdict.mjs';
import { OWNER_ANSWER_MAX_AGE_MS, OWNER_MESSAGE_WINDOW_MS, promoteStandard } from '../standards/promote-standard.mjs';
import { StoreCliError, capture, claimPromoteGate, cliAvailable, get, promote, runCli, userSource } from '../standards/store-cli.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REAL_CLAUDE = join(homedir(), '.claude');
const REAL_SETTINGS = join(REAL_CLAUDE, 'settings.json');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const settingsAtStart = existsSync(REAL_SETTINGS) ? sha(readFileSync(REAL_SETTINGS)) : null;
const realMaturityExisted = existsSync(join(REAL_CLAUDE, 'agent-maturity'));
const ENV = { ...process.env, AGENT_MATURITY_TEST: '1' };
delete ENV.AGENT_MATURITY_HOME;
delete ENV.AGENT_MATURITY;
const skip = !cliAvailable() && 'KnowledgeMemory CLI or bundled Python not found';
const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'am-di-')));
const fakeUser = join(scratch, 'user');
mkdirSync(fakeUser);

after(() => {
  rmSync(scratch, { recursive: true, force: true });
  if (settingsAtStart) assert.equal(sha(readFileSync(REAL_SETTINGS)), settingsAtStart, 'real settings.json changed');
  assert.equal(existsSync(join(REAL_CLAUDE, 'agent-maturity')), realMaturityExisted, 'real ~/.claude/agent-maturity touched');
});

// One isolated world: AGENT_MATURITY_HOME (hook log + export), critic store, KnowledgeMemory store and vault.
let n = 0;
function world() {
  n += 1;
  const dir = join(scratch, `w${n}`);
  const w = { dir, home: join(dir, 'home'), critic: join(dir, 'critic'), store: join(dir, 'km'), vault: join(dir, 'vault') };
  for (const d of [w.home, w.store, w.vault]) mkdirSync(d, { recursive: true });
  w.env = { ...ENV, AGENT_MATURITY_HOME: w.home };
  w.km = { store: w.store, vault: w.vault, env: w.env };
  w.adapter = createJsonAdapter(w.critic);
  return w;
}

const BASE = {
  id: 'di-summary',
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
const SCOPED = { id: 'di-scoped', statement: 'Không bỏ qua test khi merge lên main.', check: 'Mỗi lần merge lên main có test xanh.' };
const LOOSE = { id: 'di-loose', statement: 'Push thẳng lên main không hỏi.' };
const ACCEPT_CHECKS = { evidenceSupports: true, scopeTooWide: false, contradictsExisting: false, tierCorrect: true };
const NARROW = { verdict: 'NARROW', checks: { ...ACCEPT_CHECKS, scopeTooWide: true }, narrowed: { statement: NARROWED } };

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

// The real D4 flow: brief, then record the socrates verdict.
function critique(w, overrides = {}, verdictExtra = {}) {
  const r = validateCandidate({ ...BASE, ...overrides });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  briefCandidate({ candidate: r.value, adapter: w.adapter });
  recordVerdict({ candidate: r.value, verdictText: reply(r.value, verdictExtra), adapter: w.adapter });
  return r.value;
}

const readLines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const hookEvents = (w) => {
  const dir = join(w.home, 'log');
  return existsSync(dir) ? readdirSync(dir).flatMap((f) => readLines(join(dir, f))) : [];
};
const criticLog = (w) => readLines(join(w.critic, 'log.jsonl'));
const ofType = (w, type) => criticLog(w).filter((e) => e.type === type);

// The owner answers a checkpoint question in a fresh session; the real D1 hook logs the outcome. Returns the logged
// event and at(offsetMs): the --owner-message pointer "<session>:<time>" offset from the logged time.
function ownerAnswers(w, answer = 'Nâng cấp', { ep = 'cli', statement = BASE.statement } = {}) {
  const session = randomUUID();
  const transcript = join(w.dir, `${session}.jsonl`);
  const ask = [
    'Đã xong.',
    '',
    '[Checkpoint nâng cấp] Anh có muốn em nâng cấp cách làm không?',
    `- Đề xuất: ${statement}`,
    '- Áp dụng cho: orchestrator · tóm tắt tiến độ · mọi dự án',
    '- Cách kiểm: đếm gạch đầu dòng',
    '- Bằng chứng: anh chê bản dài → anh duyệt bản 5 dòng',
    '- Loại: sở thích · Tra cứu: R0',
    'Trả lời: Nâng cấp / Chỉnh (gõ chỗ cần đổi) / Bỏ qua',
  ].join('\n');
  writeFileSync(transcript, [
    JSON.stringify({ type: 'user', message: { content: 'merge' } }),
    JSON.stringify({ type: 'assistant', uuid: randomUUID(), message: { content: [{ type: 'text', text: ask }] } }),
  ].join('\n'));
  const env = { ...w.env, HOME: fakeUser, USERPROFILE: fakeUser, CLAUDE_CODE_ENTRYPOINT: ep };
  const r = spawnSync(process.execPath, [join(ROOT, 'hooks', 'prompt-signal.mjs')], {
    input: JSON.stringify({ prompt: answer, session_id: session, transcript_path: transcript, cwd: w.dir, hook_event_name: 'UserPromptSubmit' }),
    encoding: 'utf8',
    env,
    timeout: 15_000,
  });
  assert.equal(r.status, 0);
  const event = hookEvents(w).filter((e) => e.type === 'checkpoint_outcome' && e.session === session).at(-1);
  assert.ok(event, 'the hook logged the checkpoint answer');
  return { session, event, at: (offsetMs = 0) => `${session}:${new Date(Date.parse(event.ts) + offsetMs).toISOString()}` };
}

const door = (w, candidateId, ownerMessage, extra = {}) =>
  promoteStandard({ candidateId, ownerMessage, criticStore: w.critic, store: w.store, vault: w.vault, env: w.env, ...extra });
const refusedWith = (code, fn) => assert.throws(fn, (e) => e.code === code, code);
const exported = (w) => JSON.parse(readFileSync(join(w.home, 'standards.json'), 'utf8'));
const topicOf = (statement) => `dev-standard/${statementKey(statement).slice(0, 12)}`;
// Nothing reached KnowledgeMemory and no promotion was recorded in the critic store.
function nothingStored(w) {
  assert.equal(existsSync(join(w.store, 'memory.sqlite3')), false, 'KnowledgeMemory untouched');
  assert.equal(existsSync(join(w.home, 'standards.json')), false, 'no export written');
  assert.deepEqual(ofType(w, 'standard_promoted'), []);
}

function sessionStartBlock(w) {
  const env = { ...w.env, HOME: fakeUser, USERPROFILE: fakeUser, CLAUDE_CODE_ENTRYPOINT: 'cli' };
  const r = spawnSync(process.execPath, [join(ROOT, 'hooks', 'session-start.mjs')], {
    input: JSON.stringify({ session_id: randomUUID(), hook_event_name: 'SessionStart', source: 'startup', cwd: scratch }),
    encoding: 'utf8',
    env,
    timeout: 15_000,
  });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.additionalContext : '';
}

test('1. ACCEPT + Nâng cấp logged by the hook: one promote-standard command stores, exports and injects the standard', { skip }, (t) => {
  // Arrange
  const w = world();
  const c = critique(w);
  const answer = ownerAnswers(w);

  // Act: the command line, with the owner's message time 1.2 s off the hook's own timestamp
  const r = spawnSync(process.execPath, [
    join(ROOT, 'standards', 'promote-standard.mjs'),
    '--candidate', c.id,
    '--owner-message', answer.at(1200),
    '--critic-store', w.critic,
    '--store', w.store,
    '--vault', w.vault,
  ], { encoding: 'utf8', env: w.env, timeout: 120_000 });

  // Assert
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout).result;
  assert.equal(out.statement, c.statement);
  assert.equal(out.topic, topicOf(c.statement));
  assert.equal(out.scope, 'user');
  assert.deepEqual(out.superseded, []);
  const rec = get(out.recordId, w.km);
  assert.equal(rec.state, 'active');
  assert.equal(rec.basis, 'user_instruction');
  assert.equal(rec.topic_key, out.topic);
  assert.equal(rec.kind, 'preference');
  assert.ok(rec.summary.startsWith(c.statement), rec.summary);
  assert.ok(rec.summary.includes(c.check));
  assert.equal(rec.source.type, 'user');
  assert.ok(rec.source.uri.startsWith(`${userSource(answer.session, answer.event.ts).uri}?candidate=${c.id}&verdict=c1.`), rec.source.uri);
  assert.deepEqual(exported(w).standards.map((s) => s.id), [out.recordId]);
  const block = sessionStartBlock(w);
  assert.ok(block.includes(c.statement), block);
  const logged = ofType(w, 'standard_promoted');
  assert.equal(logged.length, 1);
  assert.equal(logged[0].recordId, out.recordId);
  assert.equal(logged[0].candidateId, c.id);
  assert.deepEqual(logged[0].ownerMessage, { sessionId: answer.session, ts: answer.event.ts }, 'the pointer is the hook event, not the argument');
  assert.equal(ofType(w, 'promotion_approved').length, 1);
  t.diagnostic(`record ${out.recordId} topic ${out.topic}; block ${block.length} chars`);
});

test('2. NARROW stores only the narrowed sentence; owner_review_required text promotes with the label stored with its verdict', { skip }, () => {
  // Arrange
  const w = world();
  critique(w, {}, NARROW);
  const scoped = critique(w, SCOPED);

  // Act
  const narrow = door(w, BASE.id, ownerAnswers(w, 'Nâng cấp', { statement: NARROWED }).at(-800));
  const review = door(w, SCOPED.id, ownerAnswers(w, 'Nâng cấp', { statement: scoped.statement }).at(300));

  // Assert
  assert.equal(narrow.statement, NARROWED);
  assert.equal(narrow.verdict, 'NARROW');
  assert.equal(narrow.topic, topicOf(NARROWED));
  const rec = get(narrow.recordId, w.km);
  assert.ok(rec.summary.startsWith(NARROWED));
  assert.equal(rec.summary.includes(BASE.statement), false, 'the candidate sentence is not stored');
  assert.equal(review.floor, 'owner_review_required');
  assert.equal(review.statement, SCOPED.statement);
  const summaries = exported(w).standards.map((s) => s.summary);
  assert.equal(summaries.length, 2);
  assert.ok(summaries.some((s) => s.startsWith(NARROWED)));
  assert.equal(summaries.some((s) => s.startsWith(BASE.statement)), false);
});

test('3. the owner answer must be in the hook log: right session, Nâng cấp, interactive, within 5 s, used once', { skip }, () => {
  // Arrange
  const w = world();
  const c = critique(w);
  const other = critique(w, { id: 'di-other', statement: SCOPED.statement, check: SCOPED.check });
  const unverified = (pointer) => refusedWith('owner_message_unverified', () => door(w, c.id, pointer));

  // Act + Assert: refused before anything is written
  unverified(`${randomUUID()}:${new Date().toISOString()}`); // no hook log at all
  const skipped = ownerAnswers(w, 'Bỏ qua');
  assert.equal(skipped.event.outcome, 'skip');
  refusedWith('owner_message_not_accept', () => door(w, c.id, skipped.at()));
  const sdk = ownerAnswers(w, 'Nâng cấp', { ep: 'sdk-ts' });
  assert.equal(sdk.event.outcome, 'accept');
  unverified(sdk.at());
  const answer = ownerAnswers(w);
  assert.equal(answer.event.outcome, 'accept');
  unverified(`${randomUUID()}:${new Date(Date.parse(answer.event.ts)).toISOString()}`); // wrong session
  unverified(answer.at(OWNER_MESSAGE_WINDOW_MS + 1));
  unverified(answer.at(-OWNER_MESSAGE_WINDOW_MS - 1));
  unverified(`${answer.session}:${randomUUID()}`); // the hook logs no message uuid
  refusedWith('bad_input', () => door(w, c.id, 'not-a-pointer'));
  refusedWith('bad_input', () => door(w, c.id, `${answer.session}:yesterday`));
  nothingStored(w);
  assert.deepEqual(ofType(w, 'promotion_approved'), [], 'a refused pointer is not recorded as an approval');

  // Act + Assert: exactly 5 s off still names the answer; the same answer cannot approve a second text
  const ok = door(w, c.id, answer.at(OWNER_MESSAGE_WINDOW_MS));
  assert.equal(ok.statement, c.statement);
  refusedWith('owner_message_reused', () => door(w, other.id, answer.at(2000)));
  const twin = critique(w, { id: 'di-twin' });
  assert.equal(twin.statement, c.statement);
  refusedWith('owner_message_reused', () => door(w, twin.id, answer.at()));
  assert.deepEqual(exported(w).standards.map((s) => s.id), [ok.recordId]);
  assert.equal(ofType(w, 'standard_promoted').length, 1);
});

test('the owner answer is at most 7 days old, and a NARROW answer comes after the recorded verdict', { skip }, () => {
  // Arrange
  const w = world();
  const c = critique(w);
  const answer = ownerAnswers(w);
  const early = ownerAnswers(w, 'Nâng cấp', { statement: NARROWED });
  critique(w, { id: 'di-narrow-late' }, NARROW);
  const atAnswer = Date.parse(answer.event.ts);

  // Act + Assert
  refusedWith('owner_message_stale', () => door(w, c.id, answer.at(), { now: new Date(atAnswer + OWNER_ANSWER_MAX_AGE_MS + 1) }));
  refusedWith('owner_message_before_verdict', () => door(w, 'di-narrow-late', early.at()));
  nothingStored(w);
  assert.deepEqual(ofType(w, 'promotion_approved'), []);
  assert.equal(door(w, c.id, answer.at(), { now: new Date(atAnswer + OWNER_ANSWER_MAX_AGE_MS) }).statement, c.statement);
  assert.equal(door(w, 'di-narrow-late', ownerAnswers(w, 'Nâng cấp', { statement: NARROWED }).at()).statement, NARROWED);
});

test('Chỉnh is not approval: an edit answer is refused (owner_message_not_accept) and writes nothing', { skip }, () => {
  // Arrange
  const w = world();
  const c = critique(w);
  const edit = ownerAnswers(w, 'Chỉnh: bỏ chữ tối đa');

  // Act + Assert
  assert.equal(edit.event.outcome, 'edit');
  refusedWith('owner_message_not_accept', () => door(w, c.id, edit.at()));
  nothingStored(w);
  assert.deepEqual(ofType(w, 'promotion_approved'), []);
});

test('4. a hard_reject or REJECT verdict is refused, with a verified owner answer', { skip }, () => {
  // Arrange
  const w = world();
  critique(w, {}, { verdict: 'REJECT' });
  critique(w, LOOSE, { verdict: 'REJECT' });

  // Act + Assert
  refusedWith('verdict_not_promotable', () => door(w, BASE.id, ownerAnswers(w).at()));
  refusedWith('hard_reject', () => door(w, LOOSE.id, ownerAnswers(w, 'Nâng cấp', { statement: LOOSE.statement }).at()));
  refusedWith('candidate_missing', () => door(w, 'di-never-briefed', ownerAnswers(w).at()));
  nothingStored(w);
  assert.deepEqual(ofType(w, 'promotion_approved'), []);
});

test('5. promote straight into dev-standard/ is refused (promote_requires_gate); other records keep the old behaviour', { skip }, () => {
  // Arrange
  const w = world();
  const rec = capture({ topic: 'di-backdoor', title: 'Chuẩn x', summary: 'Nội dung x.', source: userSource(randomUUID(), '2026-11-21T01:00:00Z') }, w.km);
  const file = join(w.dir, 'other.json');
  writeFileSync(file, JSON.stringify({
    scope: 'user', kind: 'fact', topic_key: 'some-other-memory', title: 'Not a standard', summary: 'Other knowledge.',
    source: { type: 'user', uri: 'claude-session://x/2026-11-21' }, author: 'root', evidence: 'direct', confidence: 0.9,
  }));
  const other = runCli(['capture', '--file', file], w.km);
  const gateRefused = (e) => e instanceof StoreCliError && e.code === 'promote_requires_gate';

  // Act + Assert
  assert.throws(() => claimPromoteGate(), gateRefused, 'promote-standard already holds the one gate token');
  assert.throws(() => promote(rec.id, 'user_instruction', w.km), gateRefused);
  assert.throws(() => promote(rec.id, 'user_instruction', { ...w.km, gate: Symbol('agent-maturity promote gate') }), gateRefused);
  const cli = spawnSync(process.execPath, [join(ROOT, 'standards', 'store-cli.mjs'), 'promote', rec.id, '--basis', 'user_instruction', '--store', w.store, '--vault', w.vault, '--out', join(w.home, 'standards.json')], {
    encoding: 'utf8', env: w.env, timeout: 60_000,
  });
  assert.equal(cli.status, 1, cli.stdout + cli.stderr);
  assert.equal(JSON.parse(cli.stdout).error, 'promote_requires_gate');
  assert.equal(get(rec.id, w.km).state, 'candidate');
  assert.equal(promote(other.id, 'user_instruction', w.km).state, 'active', 'a record outside dev-standard/ needs no gate');
});

test('6. the same statement approved again supersedes the old standard; the export keeps only the new one; a rerun is idempotent', { skip }, () => {
  // Arrange
  const w = world();
  const c1 = critique(w);
  const c2 = critique(w, { id: 'di-summary-again' });
  const first = door(w, c1.id, ownerAnswers(w).at());
  const second = ownerAnswers(w);

  // Act
  const next = door(w, c2.id, second.at(-1500));
  const rerun = door(w, c2.id, second.at());

  // Assert
  assert.equal(next.topic, first.topic);
  assert.notEqual(next.recordId, first.recordId);
  assert.deepEqual(next.superseded, [first.recordId]);
  const old = get(first.recordId, w.km);
  assert.equal(old.state, 'superseded', 'history is kept');
  assert.equal(old.superseded_by, next.recordId);
  assert.deepEqual(exported(w).standards.map((s) => s.id), [next.recordId]);
  assert.equal(rerun.recordId, next.recordId, 'same content, same record');
  assert.deepEqual(rerun.superseded, []);
  assert.deepEqual(exported(w).standards.map((s) => s.id), [next.recordId]);
  const block = sessionStartBlock(w);
  assert.equal(block.split(c1.statement).length - 1, 1, 'the statement is injected once');
});

test('a failing store step stops there and names it; nothing is half-written', { skip }, (t) => {
  // Arrange: KnowledgeMemory refuses a 16-digit card-like number the candidate validator lets through
  const w = world();
  const c = critique(w, { check: 'Mỗi bản tóm tắt có ≤5 gạch đầu dòng, mã 4111 1111 1111 1111.' });

  // Act
  let caught = null;
  try {
    door(w, c.id, ownerAnswers(w).at());
  } catch (error) {
    caught = error;
  }

  // Assert
  assert.ok(caught, 'refused');
  assert.equal(caught.code, 'store_step_failed');
  assert.equal(caught.step, 'capture');
  assert.match(caught.message, /cli_failed: KnowledgeMemory rejected the call \(MemoryValidationError\)/);
  assert.equal(caught.message.includes('4111'), false, 'no payload text in the message');
  assert.equal(existsSync(join(w.home, 'standards.json')), false);
  assert.deepEqual(ofType(w, 'standard_promoted'), []);
  t.diagnostic(caught.message);
});

test('project scope needs --project; nothing is written without it', { skip }, () => {
  // Arrange
  const w = world();
  const c = critique(w, { scope: { ...BASE.scope, projects: 'this' } });

  // Act + Assert
  refusedWith('project_path_required', () => door(w, c.id, ownerAnswers(w).at()));
  nothingStored(w);
  assert.deepEqual(ofType(w, 'promotion_approved'), []);
});

test('preflight: missing KnowledgeMemory CLI, the real ~/.claude under test, and usage errors write nothing', () => {
  // Arrange
  const w = world();
  critique(w);
  const answer = ownerAnswers(w);

  // Act + Assert
  refusedWith('cli_unavailable', () => door(w, BASE.id, answer.at(), { python: join(scratch, 'no-python.exe') }));
  refusedWith('refuse_real_store', () => door(w, BASE.id, answer.at(), { criticStore: join(REAL_CLAUDE, 'agent-maturity', 'critic') }));
  refusedWith('bad_input', () => door(w, 'Not An Id', answer.at()));
  nothingStored(w);
  assert.deepEqual(ofType(w, 'promotion_approved'), []);
  const usage = spawnSync(process.execPath, [join(ROOT, 'standards', 'promote-standard.mjs'), '--candidate'], { encoding: 'utf8', env: w.env, timeout: 30_000 });
  assert.equal(usage.status, 2);
});
