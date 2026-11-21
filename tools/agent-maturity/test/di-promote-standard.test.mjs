// DI: the single door for a dev standard. Candidate -> brief -> verdict (D4 critic store) -> the owner's checkpoint
// answer as the real D1 hook logs it -> promote-standard -> KnowledgeMemory (temp store and vault) -> export ->
// SessionStart block. Everything runs on temp folders; the real stores and ~/.claude are checked untouched.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { briefCandidate } from '../critic/brief.mjs';
import { validateCandidate } from '../critic/candidate.mjs';
import { createJsonAdapter } from '../critic/json-adapter.mjs';
import { inputFingerprint, statementKey } from '../critic/loop-guard.mjs';
import { recordVerdict } from '../critic/record-verdict.mjs';
import { proposalDigest } from '../lib/classify.mjs';
import { OWNER_ANSWER_MAX_AGE_MS, OWNER_MESSAGE_WINDOW_MS, promoteStandard } from '../standards/promote-standard.mjs';
import * as storeCli from '../standards/store-cli.mjs';
import { IMPORT_AUTHOR, StoreCliError, capture, cliAvailable, exportActive, get, promote, promoteApproved, retract, userSource } from '../standards/store-cli.mjs';
import { rawCli } from './fixtures/door-standard.mjs';

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

// One isolated world: AGENT_MATURITY_HOME (hook log + export), critic store, KnowledgeMemory store and vault, and the
// projects folder holding the session transcripts (~/.claude/projects in real use).
let n = 0;
function world() {
  n += 1;
  const dir = join(scratch, `w${n}`);
  const w = { dir, home: join(dir, 'home'), critic: join(dir, 'critic'), store: join(dir, 'km'), vault: join(dir, 'vault'), projects: join(dir, 'projects') };
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

const reply = (candidate, extra = {}, revision = 1) =>
  JSON.stringify({
    candidateId: candidate.id,
    candidateRevision: revision,
    inputFingerprint: inputFingerprint({ ...candidate, revision }),
    verdict: 'ACCEPT',
    reasons: ['Cặp đối chứng ev-1 → ev-2 đỡ đúng câu chuẩn.'],
    evidence: [{ ref: 'ev-1', kind: 'event', finding: 'supports' }],
    checks: ACCEPT_CHECKS,
    hardReject: null,
    research: { tier: 'R0', refs: [], deepRuns: 0 },
    reviewer: { agent: 'socrates' },
    ...extra,
  });

// The real D4 flow: brief, then record the socrates verdict. A rewritten statement of a stored candidate is its next
// revision.
function critique(w, overrides = {}, verdictExtra = {}, revision = 1) {
  const r = validateCandidate({ ...BASE, ...overrides });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  briefCandidate({ candidate: r.value, adapter: w.adapter });
  recordVerdict({ candidate: r.value, verdictText: reply(r.value, verdictExtra, revision), adapter: w.adapter });
  return r.value;
}

const readLines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const hookEvents = (w) => {
  const dir = join(w.home, 'log');
  return existsSync(dir) ? readdirSync(dir).flatMap((f) => readLines(join(dir, f))) : [];
};
const criticLog = (w) => readLines(join(w.critic, 'log.jsonl'));
const ofType = (w, type) => criticLog(w).filter((e) => e.type === type);

// The owner answers a checkpoint question in a fresh session; the real D1 hook logs the outcome, then the reply is
// written to the session transcript (<projects>/<project>/<session>.jsonl) with its send time, as Claude Code does.
// Returns the logged event, the transcript and at(offsetMs): the --owner-message pointer "<session>:<time>" offset
// from the logged time. `before` is text above the ask block in the same assistant message.
function ownerAnswers(w, answer = 'Nâng cấp', { ep = 'cli', statement = BASE.statement, floor = null, before = 'Đã xong.' } = {}) {
  const session = randomUUID();
  mkdirSync(join(w.projects, 'F--repo'), { recursive: true });
  const transcript = join(w.projects, 'F--repo', `${session}.jsonl`);
  const sentAt = Date.now();
  const stamp = (offsetMs) => new Date(sentAt + offsetMs).toISOString();
  const ask = [
    before,
    '',
    '[Checkpoint nâng cấp] Anh có muốn em nâng cấp cách làm không?',
    `- Đề xuất: ${statement}`,
    '- Áp dụng cho: orchestrator · tóm tắt tiến độ · mọi dự án',
    '- Cách kiểm: đếm gạch đầu dòng',
    '- Bằng chứng: anh chê bản dài → anh duyệt bản 5 dòng',
    '- Loại: sở thích · Tra cứu: R0',
    ...(floor ? [`- Nhãn an toàn: ${floor} (cần anh xem) · Chủ đề: kiểm thử · Lý do: đụng tới kiểm thử`] : []),
    'Trả lời: Nâng cấp / Chỉnh (gõ chỗ cần đổi) / Bỏ qua',
  ].join('\n');
  writeFileSync(transcript, `${[
    JSON.stringify({ type: 'user', timestamp: stamp(-60_000), message: { content: 'merge' } }),
    JSON.stringify({ type: 'assistant', uuid: randomUUID(), timestamp: stamp(-30_000), message: { content: [{ type: 'text', text: ask }] } }),
  ].join('\n')}\n`);
  const env = { ...w.env, HOME: fakeUser, USERPROFILE: fakeUser, CLAUDE_CODE_ENTRYPOINT: ep };
  const r = spawnSync(process.execPath, [join(ROOT, 'hooks', 'prompt-signal.mjs')], {
    input: JSON.stringify({ prompt: answer, session_id: session, transcript_path: transcript, cwd: w.dir, hook_event_name: 'UserPromptSubmit' }),
    encoding: 'utf8',
    env,
    timeout: 15_000,
  });
  assert.equal(r.status, 0);
  appendFileSync(transcript, `${JSON.stringify({ type: 'user', timestamp: stamp(0), message: { content: answer } })}\n`);
  const event = hookEvents(w).filter((e) => e.type === 'checkpoint_outcome' && e.session === session).at(-1);
  assert.ok(event, 'the hook logged the checkpoint answer');
  return { session, event, transcript, at: (offsetMs = 0) => `${session}:${new Date(Date.parse(event.ts) + offsetMs).toISOString()}` };
}

const door = (w, candidateId, ownerMessage, extra = {}) =>
  promoteStandard({ candidateId, ownerMessage, criticStore: w.critic, projectsDir: w.projects, store: w.store, vault: w.vault, env: w.env, ...extra });
// Appends one line to the hook log, as if the hook had written it.
function hookLine(w, event) {
  mkdirSync(join(w.home, 'log'), { recursive: true });
  appendFileSync(join(w.home, 'log', `events-${event.ts.slice(0, 7)}.jsonl`), `${JSON.stringify(event)}\n`);
}
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
    '--projects-dir', w.projects,
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
  const review = door(w, SCOPED.id, ownerAnswers(w, 'Nâng cấp', { statement: scoped.statement, floor: 'owner_review_required' }).at(300));

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

  // Act + Assert: exactly 5 s off still names the answer; the same answer cannot approve a second text (it is bound
  // to the text its ask block showed) nor a second candidate
  const ok = door(w, c.id, answer.at(OWNER_MESSAGE_WINDOW_MS));
  assert.equal(ok.statement, c.statement);
  refusedWith('owner_message_unbound', () => door(w, other.id, answer.at(2000)));
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

test('the answer is bound to the exact Đề xuất text and safety label its ask block showed (owner_message_unbound)', { skip }, () => {
  // Arrange
  const w = world();
  const c = critique(w);
  critique(w, { id: 'di-narrowed' }, NARROW);
  const scoped = critique(w, SCOPED);
  const legacy = { ts: new Date().toISOString(), session: randomUUID(), ep: 'cli', type: 'checkpoint_outcome', turn: 2, outcome: 'accept', initiated: 'agent' };
  hookLine(w, legacy);
  const unbound = (pointer, id = c.id) => refusedWith('owner_message_unbound', () => door(w, id, pointer));

  // Act + Assert: refused before the gate, so nothing is written and no approval is recorded
  // logged before the hook bound answers: no literalOption, no proposalSha256
  refusedWith('owner_message_not_literal', () => door(w, c.id, `${legacy.session}:${legacy.ts}`));
  unbound(ownerAnswers(w, 'Nâng cấp', { statement: 'Tóm tắt tiến độ ngắn gọn.' }).at()); // a paraphrase
  unbound(ownerAnswers(w, 'Nâng cấp', { statement: `"${c.statement}"` }).at()); // quoted
  unbound(ownerAnswers(w).at(), 'di-narrowed'); // the candidate text, not the narrowed one
  unbound(ownerAnswers(w, 'Nâng cấp', { statement: scoped.statement }).at(), scoped.id); // label not shown
  unbound(ownerAnswers(w, 'Nâng cấp', { statement: scoped.statement, floor: 'pass' }).at(), scoped.id); // wrong label
  const otherBlock = `[Checkpoint nâng cấp] Anh có muốn em nâng cấp cách làm không?\n- Đề xuất: ${c.statement}\nTrả lời: Nâng cấp / Chỉnh / Bỏ qua`;
  const twoBlocks = ownerAnswers(w, 'Nâng cấp', { before: otherBlock });
  assert.equal(twoBlocks.event.proposalSha256, undefined, 'two live ask blocks: no proposal hash');
  unbound(twoBlocks.at()); // the same text twice still binds nothing
  nothingStored(w);
  assert.deepEqual(ofType(w, 'promotion_approved'), []);

  // Act + Assert: the same text in NFD form is the same text; a pass text needs no label
  const nfd = ownerAnswers(w, 'Nâng cấp', { statement: c.statement.normalize('NFD') });
  assert.equal(nfd.event.proposalSha256, createHash('sha256').update(c.statement.normalize('NFC'), 'utf8').digest('hex'));
  assert.equal(nfd.event.floor, undefined);
  assert.equal(door(w, c.id, nfd.at()).statement, c.statement);
  const labelled = ownerAnswers(w, 'Nâng cấp', { statement: scoped.statement, floor: 'owner_review_required' });
  assert.equal(labelled.event.floor, 'owner_review_required');
  assert.equal(door(w, scoped.id, labelled.at()).floor, 'owner_review_required');
});

test('only the option word itself approves: a looser Nâng cấp reply is refused (owner_message_not_literal) and writes nothing', { skip }, () => {
  // Arrange
  const w = world();
  const c = critique(w);
  const loose = ownerAnswers(w, 'Nâng cấp nhé anh');

  // Act + Assert
  assert.equal(loose.event.outcome, 'accept', 'the hook still counts it as accept');
  refusedWith('owner_message_not_literal', () => door(w, c.id, loose.at()));
  nothingStored(w);
  assert.deepEqual(ofType(w, 'promotion_approved'), []);
  assert.equal(door(w, c.id, ownerAnswers(w, 'nang cap!').at()).statement, c.statement);
});

test('the real transcript must show that answer: a forged log line or an edited, missing or ambiguous transcript is refused (owner_message_transcript_mismatch)', { skip }, () => {
  // Arrange
  const w = world();
  const c = critique(w);
  const forged = { ts: new Date().toISOString(), session: randomUUID(), ep: 'cli', type: 'checkpoint_outcome', turn: 2, outcome: 'accept', initiated: 'agent', proposalSha256: proposalDigest(c.statement), literalOption: true };
  hookLine(w, forged); // a log line that passes every log check, with no transcript behind it
  const edited = (from, to) => {
    const answer = ownerAnswers(w);
    writeFileSync(answer.transcript, readFileSync(answer.transcript, 'utf8').replace(from, to));
    return answer;
  };
  const looseReply = edited('"content":"Nâng cấp"}', '"content":"Nâng cấp nhé"}');
  const otherText = edited(`- Đề xuất: ${c.statement}`, '- Đề xuất: Tóm tắt tiến độ ngắn gọn.');
  const secondBlock = edited('Đã xong.', `[Checkpoint nâng cấp] Hỏi thêm\\n- Đề xuất: ${c.statement}\\nTrả lời: Nâng cấp`);
  const laterReply = edited('"content":"Nâng cấp"}', '"content":"x"}\n{"type":"user","timestamp":"2000-01-01T00:00:00.000Z","message":{"content":"Nâng cấp"}}');
  const gone = ownerAnswers(w);
  rmSync(gone.transcript);
  const twin = ownerAnswers(w);
  mkdirSync(join(w.projects, 'F--other'));
  writeFileSync(join(w.projects, 'F--other', `${twin.session}.jsonl`), readFileSync(twin.transcript));
  const mismatch = (pointer) => refusedWith('owner_message_transcript_mismatch', () => door(w, c.id, pointer));
  const notTest = { ...w.env };
  delete notTest.AGENT_MATURITY_TEST;

  // Act + Assert: refused before the gate
  mismatch(`${forged.session}:${forged.ts}`);
  for (const answer of [looseReply, otherText, secondBlock, laterReply, gone, twin]) mismatch(answer.at());
  refusedWith('owner_message_transcript_mismatch', () => door(w, c.id, ownerAnswers(w).at(), { projectsDir: join(w.dir, 'empty-projects') }));
  refusedWith('bad_input', () => promoteStandard({ candidateId: c.id, ownerMessage: ownerAnswers(w).at(), projectsDir: w.projects, env: notTest })); // tests only
  nothingStored(w);
  assert.deepEqual(ofType(w, 'promotion_approved'), []);

  // Act + Assert: the untouched transcript passes
  assert.equal(door(w, c.id, ownerAnswers(w).at()).statement, c.statement);
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
  const other = rawCli(['capture', '--file', file], w.km);
  const gateRefused = (e) => e instanceof StoreCliError && e.code === 'promote_requires_gate';

  // Act + Assert
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

// A dev-standard/ payload shaped like the door's (12 hex topic, a user source in the door's format), for the raw CLI.
function doorShaped(w, name, uriExtra, extra = {}) {
  const file = join(w.dir, `${name}.json`);
  writeFileSync(file, JSON.stringify({
    scope: 'user', kind: 'preference', topic_key: `dev-standard/${sha(name).slice(0, 12)}`, title: `Chuẩn ${name}`, summary: `Lối tắt ${name}.`,
    source: { type: 'user', uri: `${userSource(randomUUID(), '2026-11-21T01:00:00Z').uri}${uriExtra}` }, author: 'root', evidence: 'direct', confidence: 0.9,
    ...extra,
  }));
  return rawCli(['capture', '--file', file], w.km);
}

test('the export is the boundary: a dev standard promoted outside the door is never exported (not_via_door)', { skip }, async () => {
  // Arrange: one standard through the real door, so its candidate has a standard_promoted event
  const w = world();
  const c = critique(w);
  const stored = door(w, c.id, ownerAnswers(w).at());
  const fresh = await import('../standards/store-cli.mjs?fresh');
  const doorUri = `?candidate=${c.id}&verdict=c1.${'a'.repeat(12)}`;
  const km = { ...w.km, criticStore: w.critic };

  // Act: every other route to an active dev-standard/ record
  const viaExport = doorShaped(w, 'via-exported-door-function', doorUri);
  promoteApproved(viaExport.id, km); // the door's exported promote step, called outside the door
  const viaFresh = doorShaped(w, 'via-fresh-import', doorUri);
  assert.throws(() => fresh.promote(viaFresh.id, 'user_instruction', km), (err) => err.code === 'promote_requires_gate');
  fresh.promoteApproved(viaFresh.id, km);
  const viaRaw = doorShaped(w, 'via-raw-cli', doorUri);
  rawCli(['promote', viaRaw.id, '--basis', 'user_instruction', '--reviewer', 'root'], km); // what runCli did
  const imported = doorShaped(w, 'via-import', doorUri, { topic_key: 'dev-standard/import/via-import-0a1b2c3d', author: IMPORT_AUTHOR });
  rawCli(['promote', imported.id, '--basis', 'user_instruction', '--reviewer', 'root'], km);
  const forged = doorShaped(w, 'via-forged-log', '');
  rawCli(['promote', forged.id, '--basis', 'user_instruction', '--reviewer', 'root'], km);
  for (const rec of [imported, forged]) w.adapter.logEvent({ type: 'standard_promoted', candidateId: c.id, recordId: rec.id });
  const e = exportActive(km);

  // Assert
  for (const mod of [storeCli, fresh]) {
    assert.equal('claimPromoteGate' in mod, false, 'no gate token to claim');
    assert.equal('runCli' in mod, false, 'no raw CLI runner');
  }
  const bypass = [viaExport, viaFresh, viaRaw, imported, forged].map((r) => r.id);
  for (const id of bypass) assert.equal(get(id, km).state, 'active', 'active in KnowledgeMemory');
  assert.deepEqual(e.standards.map((x) => x.id), [stored.recordId]);
  assert.deepEqual(e.skipped.filter((x) => x.reason === 'not_via_door').map((x) => x.id).sort(), [...bypass].sort());
  const block = sessionStartBlock(w);
  assert.ok(block.includes(c.statement), block);
  assert.equal(block.includes('Lối tắt'), false, block);
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

// The same kind of sentence as BASE (a pass floor), worded differently.
const reworded = (n) => `Tóm tắt tiến độ tối đa ${n} gạch đầu dòng.`;

test('--supersedes: reworded text replaces an old standard under its topic; the export keeps only the new one; a rerun is done', { skip }, () => {
  // Arrange
  const w = world();
  const first = door(w, critique(w).id, ownerAnswers(w).at());
  const c2 = critique(w, { id: 'di-reworded', statement: reworded(3), existingStandards: [{ id: first.recordId, statement: BASE.statement }] });
  const answer = ownerAnswers(w, 'Nâng cấp', { statement: reworded(3) });

  // Act: the function, then the same approval again through the command line
  const next = door(w, c2.id, answer.at(), { supersedes: first.recordId });
  const rerun = spawnSync(process.execPath, [
    join(ROOT, 'standards', 'promote-standard.mjs'),
    '--candidate', c2.id,
    '--owner-message', answer.at(400),
    '--critic-store', w.critic,
    '--projects-dir', w.projects,
    '--store', w.store,
    '--vault', w.vault,
    '--supersedes', first.recordId,
  ], { encoding: 'utf8', env: w.env, timeout: 120_000 });

  // Assert
  assert.equal(next.statement, reworded(3));
  assert.equal(next.topic, first.topic, 'captured under the old topic');
  assert.notEqual(next.topic, topicOf(reworded(3)));
  assert.deepEqual(next.superseded, [first.recordId]);
  const old = get(first.recordId, w.km);
  assert.equal(old.state, 'superseded', 'history is kept');
  assert.equal(old.superseded_by, next.recordId);
  assert.equal(rerun.status, 0, rerun.stdout + rerun.stderr);
  const again = JSON.parse(rerun.stdout).result;
  assert.equal(again.recordId, next.recordId, 'same content, same record');
  assert.deepEqual(again.superseded, [], 'already superseded by this record: done');
  assert.deepEqual(exported(w).standards.map((x) => x.id), [next.recordId]);
  const block = sessionStartBlock(w);
  assert.ok(block.includes(reworded(3)), block);
  assert.equal(block.includes(BASE.statement), false, block);
  assert.deepEqual(ofType(w, 'standard_promoted').map((e) => e.supersedes), [undefined, first.recordId, first.recordId]);
});

test('the same text is never active twice: a fresh approval of a text active under another topic replaces that standard', { skip }, () => {
  // Arrange: BASE stored, then reworded with --supersedes, so the reworded text lives under BASE's topic
  const w = world();
  const first = door(w, critique(w).id, ownerAnswers(w).at());
  const c2 = critique(w, { id: 'di-moved', statement: reworded(4), existingStandards: [{ id: first.recordId, statement: BASE.statement }] });
  const moved = door(w, c2.id, ownerAnswers(w, 'Nâng cấp', { statement: reworded(4) }).at(), { supersedes: first.recordId });
  const c3 = critique(w, { id: 'di-fresh-same-text', statement: reworded(4) });

  // Act: the same text approved again on a candidate that names no --supersedes
  const fresh = door(w, c3.id, ownerAnswers(w, 'Nâng cấp', { statement: reworded(4) }).at());

  // Assert
  assert.equal(moved.topic, first.topic);
  assert.equal(fresh.topic, moved.topic, 'captured where the same text already lives');
  assert.deepEqual(fresh.superseded, [moved.recordId]);
  assert.equal(get(moved.recordId, w.km).superseded_by, fresh.recordId);
  assert.deepEqual(exported(w).standards.map((s) => s.id), [fresh.recordId]);
  const block = sessionStartBlock(w);
  assert.equal(block.split(reworded(4)).length - 1, 1, 'the text is injected once');
});

// The bytes of every file in the KnowledgeMemory store folder.
const storeBytes = (w) => readdirSync(w.store, { recursive: true })
  .map((f) => join(w.store, String(f)))
  .filter((f) => existsSync(f) && !statSync(f).isDirectory())
  .sort()
  .map((f) => `${f}:${sha(readFileSync(f))}`)
  .join('\n');

test('a later revision of a candidate supersedes the standard of its earlier revision, with or without --supersedes', { skip }, () => {
  // Arrange: candidate di-rev stored at revision 1; di-reworded replaced BASE with --supersedes at revision 1
  const w = world();
  const first = door(w, critique(w).id, ownerAnswers(w).at());
  const listed = { existingStandards: [{ id: first.recordId, statement: BASE.statement }] };
  const r1 = door(w, critique(w, { id: 'di-reworded', statement: reworded(3), ...listed }).id, ownerAnswers(w, 'Nâng cấp', { statement: reworded(3) }).at(), { supersedes: first.recordId });
  const plain1 = door(w, critique(w, { id: 'di-rev', statement: reworded(8) }).id, ownerAnswers(w, 'Nâng cấp', { statement: reworded(8) }).at());
  critique(w, { id: 'di-reworded', statement: reworded(5), ...listed }, {}, 2);
  critique(w, { id: 'di-rev', statement: reworded(6) }, {}, 2);

  // Act
  const r2 = door(w, 'di-reworded', ownerAnswers(w, 'Nâng cấp', { statement: reworded(5) }).at(), { supersedes: first.recordId });
  const plain2 = door(w, 'di-rev', ownerAnswers(w, 'Nâng cấp', { statement: reworded(6) }).at());

  // Assert
  assert.equal(r2.topic, first.topic);
  assert.deepEqual(r2.superseded, [r1.recordId]);
  assert.equal(get(r1.recordId, w.km).superseded_by, r2.recordId);
  assert.equal(get(first.recordId, w.km).superseded_by, r1.recordId, 'history is kept');
  assert.equal(plain2.topic, plain1.topic, 'captured under the earlier revision\'s topic');
  assert.deepEqual(plain2.superseded, [plain1.recordId]);
  assert.deepEqual(exported(w).standards.map((s) => s.id).sort(), [r2.recordId, plain2.recordId].sort());
});

test('a --supersedes that cannot be done is refused before the gate: nothing reaches KnowledgeMemory', { skip }, () => {
  // Arrange: BASE and another text stored; a candidate rewords BASE into exactly that other, already active text
  const w = world();
  const first = door(w, critique(w).id, ownerAnswers(w).at());
  const other = door(w, critique(w, { id: 'di-other-text', statement: reworded(7) }).id, ownerAnswers(w, 'Nâng cấp', { statement: reworded(7) }).at());
  const c = critique(w, { id: 'di-sup-dup', statement: reworded(7), existingStandards: [{ id: first.recordId, statement: BASE.statement }] });
  const at = ownerAnswers(w, 'Nâng cấp', { statement: reworded(7) }).at();
  const before = { bytes: storeBytes(w), approvals: ofType(w, 'promotion_approved').length, exported: exported(w) };

  // Act + Assert
  assert.throws(() => door(w, c.id, at, { supersedes: first.recordId }), (e) => e.code === 'supersedes_invalid' && e.message.includes(other.recordId) && !e.step);
  assert.equal(storeBytes(w), before.bytes, 'no capture');
  assert.equal(ofType(w, 'promotion_approved').length, before.approvals, 'refused before the gate');
  assert.deepEqual(exported(w), before.exported);
  assert.equal(get(first.recordId, w.km).state, 'active');
});

test('--supersedes is refused before the gate unless it names an active, door-made standard of the same scope the candidate lists', { skip }, () => {
  // Arrange: a door-made standard, a retracted door-made one, a raw-CLI one and an import
  const w = world();
  const first = door(w, critique(w).id, ownerAnswers(w).at());
  const retired = door(w, critique(w, { id: 'di-retired', statement: reworded(9) }).id, ownerAnswers(w, 'Nâng cấp', { statement: reworded(9) }).at());
  retract(retired.recordId, 'owner dropped it', w.km);
  const raw = doorShaped(w, 'raw-old', '');
  rawCli(['promote', raw.id, '--basis', 'user_instruction', '--reviewer', 'root'], w.km);
  const imported = doorShaped(w, 'import-old', '', { topic_key: 'dev-standard/import/import-old-0a1b2c3d', author: IMPORT_AUTHOR });
  const listing = (id, n, extra = {}) => {
    const c = critique(w, { id: `di-sup-${n}`, statement: reworded(n), existingStandards: [{ id, statement: 'Chuẩn cũ.' }], ...extra });
    return { id: c.id, at: ownerAnswers(w, 'Nâng cấp', { statement: reworded(n) }).at() };
  };
  const cases = [
    [listing(retired.recordId, 2), retired.recordId, {}, /it is retracted, not active/],
    [listing(raw.id, 4), raw.id, {}, /not a standard promote-standard stored/],
    [listing(imported.id, 6), imported.id, {}, /not a standard promote-standard stored/],
    [listing(first.recordId, 7, { scope: { ...BASE.scope, projects: 'this' } }), first.recordId, { projectPath: w.dir }, /another scope or project/],
    [listing(retired.recordId, 8), first.recordId, {}, /does not list it in existingStandards/],
  ];
  const approvals = ofType(w, 'promotion_approved').length;
  const exportBefore = exported(w).standards.map((x) => x.id);

  // Act + Assert
  for (const [c, supersedes, extra, why] of cases) {
    assert.throws(() => door(w, c.id, c.at, { supersedes, ...extra }), (e) => e.code === 'supersedes_invalid' && why.test(e.message), String(why));
  }
  refusedWith('bad_input', () => door(w, cases[0][0].id, cases[0][0].at, { supersedes: 'not-a-record-id' }));
  assert.equal(ofType(w, 'promotion_approved').length, approvals, 'refused before the gate');
  assert.equal(ofType(w, 'standard_promoted').length, 2);
  assert.equal(get(first.recordId, w.km).state, 'active');
  assert.deepEqual(exported(w).standards.map((x) => x.id), exportBefore);
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
  const notTest = { ...w.env };
  delete notTest.AGENT_MATURITY_TEST;
  refusedWith('critic_store_test_only', () => door(w, BASE.id, answer.at(), { env: notTest, projectsDir: undefined })); // --critic-store is for tests only
  refusedWith('bad_input', () => door(w, 'Not An Id', answer.at()));
  nothingStored(w);
  assert.deepEqual(ofType(w, 'promotion_approved'), []);
  const usage = spawnSync(process.execPath, [join(ROOT, 'standards', 'promote-standard.mjs'), '--candidate'], { encoding: 'utf8', env: w.env, timeout: 30_000 });
  assert.equal(usage.status, 2);
});
