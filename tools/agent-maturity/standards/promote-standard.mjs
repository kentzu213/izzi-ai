// The single door for storing a dev standard (docs/izzi-v2/sessions/DI.md). Root runs it once, after the owner chose
// Nâng cấp at a checkpoint on the exact text it stores and the D4 critic recorded a verdict:
//   node promote-standard.mjs --candidate <id> --owner-message <sessionId>:<ISO time of the owner answer>
//     [--store <dir>] [--vault <dir>] [--out <file>] [--project <dir>] [--supersedes <standardId>]
//     [--critic-store <dir>: tests only, with AGENT_MATURITY_TEST=1; otherwise always ~/.claude/agent-maturity/critic]
// In this order, stopping at the first failure:
//   1. Verify the owner answer against the D1 hook log (<AGENT_MATURITY_HOME>/log): exactly one checkpoint_outcome
//      event of that session from an interactive entrypoint, at most ±5 s from the given time
//      (owner_message_unverified), with outcome accept: only Nâng cấp approves, Chỉnh or Bỏ qua is
//      owner_message_not_accept, and only a reply that was exactly the option word (the hook logged literalOption:
//      true) promotes, otherwise owner_message_not_literal. The answer is at most 7 days old (owner_message_stale),
//      and for NARROW later than the recorded verdict (owner_message_before_verdict). Read-only, so a refused pointer
//      writes nothing.
//   1b. Bind the answer to the text (owner_message_unbound): the hook logged proposalSha256, the sha256 of the NFC
//      "Đề xuất" line of the ask block the owner answered; it must be the sha256 of the statement the gate will store
//      (the narrowed text for NARROW), and when that text's floor class is not pass, the label the block showed must
//      be that class (hard_reject is refused by the gate whatever was shown). Read-only too.
//   1c. --supersedes <standardId>, new wording for an old standard (supersedes_invalid): the id is in the candidate's
//      existingStandards, and that record is a standard this door stored (not an import) on the same scope and
//      project, active or already superseded by this candidate's own record (a rerun or a later revision). Read-only
//      too. The new record is then captured under the OLD record's topic, so KnowledgeMemory supersede accepts it.
//   1d. The same text is never active twice, and a candidate has one standard: an active door-made standard of the
//      same scope and project whose standard_promoted event has this statementKey or this candidate (an earlier
//      revision) is replaced too, so the new record is captured under its topic (KnowledgeMemory supersedes only
//      within one topic). Records to replace on two topics are refused (supersedes_invalid with --supersedes,
//      duplicate_active without). Read-only too: every supersede check is done here, before anything is written.
//   2. assertPromotable (D4 gate) on the critic store, with the hook event's own time as ownerMessage, so one logged
//      answer approves one text of one candidate (owner_message_reused). The statement stored is the one the gate
//      returns (the narrowed text for NARROW), never an argument.
//   3. capture into KnowledgeMemory: topic dev-standard/<12 hex of statementKey> (or the topic from 1c/1d), source
//      userSource(session, hook time) plus the candidate and verdict ids, scope from the candidate (user unless
//      projects is 'this').
//   4. promote with basis user_instruction (store-cli promoteApproved); 5. supersede the active standards on that
//   topic; 6. log standard_promoted in the critic store; 7. exportActive, which passes a dev standard on only with
//   that event (not_via_door otherwise), so the log comes first.
// Everything that can be checked without writing (inputs, the hook log, the KnowledgeMemory CLI) is checked before
// step 2. A failure after it is store_step_failed naming the step; capture and promote are idempotent (the same
// content is the same record), so once the cause is fixed the same command finishes the job.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ID_RE, isObject, text } from '../critic/candidate.mjs';
import { createJsonAdapter } from '../critic/json-adapter.mjs';
import { statementKey, verdictDigest } from '../critic/loop-guard.mjs';
import { assertPromotable } from '../critic/promote-gate.mjs';
import { promotedFloor, promotedTopics } from '../critic/verdict.mjs';
import { proposalDigest } from '../lib/classify.mjs';
import { NUDGE_ENTRYPOINTS } from '../lib/decide.mjs';
import { logPath, resolveHome } from '../lib/store.mjs';
import { isInside } from './project-root.mjs';
import {
  TOPIC_PREFIX,
  capture,
  cliAvailable,
  criticPath,
  doorCandidate,
  exportActive,
  exportPath,
  get,
  isDoorMade,
  isImported,
  listActive,
  listDoorActive,
  lookupProject,
  promoteApproved,
  supersede,
  userSource,
} from './store-cli.mjs';

export const OWNER_MESSAGE_WINDOW_MS = 5_000;
// An owner answer approves a promotion for at most this long.
export const OWNER_ANSWER_MAX_AGE_MS = 7 * 86_400_000;
// Only Nâng cấp approves. Chỉnh (edit) means the owner changed the text: ask again with the new exact text.
export const APPROVING_OUTCOMES = Object.freeze(['accept']);
// The outcomes the hook logs for an answer to an ask block (abstained is no answer).
const ANSWER_OUTCOMES = new Set(['accept', 'edit', 'skip', 'ignored']);
const OUTCOME_WORDS = { edit: 'Chỉnh', skip: 'Bỏ qua', ignored: 'không chọn' };
// 12 hex characters: never 13 digits in a row, so the store's card-number check cannot trip on a topic.
const TOPIC_HASH_CHARS = 12;
const TITLE_MAX = 160;
// critic/promote-gate.mjs reads the approved statement with text(statement, 400).
const GATE_STATEMENT_MAX = 400;
// The hook logs a safe session id as-is (lib/store.mjs sessionKey); userSource accepts the same set.
const SESSION_RE = /^[A-Za-z0-9-]{1,128}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const STORE_KIND = { preference: 'preference', procedure: 'procedure', quality_gate: 'procedure', pitfall: 'pitfall' };

export class PromoteStandardError extends Error {
  constructor(code, message, step = null) {
    super(message);
    this.name = 'PromoteStandardError';
    this.code = code;
    this.step = step;
  }
}

const fail = (code, message, step) => {
  throw new PromoteStandardError(code, message, step);
};

// "<sessionId>:<ISO time>" -> { sessionId, ts }. A message uuid cannot be checked: the hook logs times only.
export function parseOwnerMessage(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  const cut = raw.indexOf(':');
  const sessionId = cut > 0 ? raw.slice(0, cut) : '';
  const at = cut > 0 ? raw.slice(cut + 1) : '';
  if (!SESSION_RE.test(sessionId) || at === '') fail('bad_input', '--owner-message must be <sessionId>:<ISO time of the owner answer>');
  if (UUID_RE.test(at)) fail('owner_message_unverified', 'the hook log records no message uuid, only its time: give <sessionId>:<ISO time of the owner answer>');
  if (!TS_RE.test(at) || !Number.isFinite(Date.parse(at))) fail('bad_input', '--owner-message time must be an ISO time with a zone, for example 2026-11-21T10:00:05.123Z');
  return { sessionId, ts: at };
}

// Hook log lines of the month files around `atMs`; a line that does not parse is not evidence.
function hookEvents(home, atMs) {
  const files = new Set([atMs - OWNER_MESSAGE_WINDOW_MS, atMs + OWNER_MESSAGE_WINDOW_MS].map((ms) => logPath(home, new Date(ms))));
  const events = [];
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      fail('owner_message_unverified', `the hook log cannot be read (${error.code ?? error.name})`);
    }
    for (const line of text.split('\n')) {
      try {
        events.push(JSON.parse(line));
      } catch {
        // an empty, torn or foreign line
      }
    }
  }
  return events;
}

// The one hook event that records the owner answering an ask block in that session around that time; only
// Nâng cấp approves (owner_message_not_accept otherwise).
export function findOwnerAnswer(home, message) {
  const at = Date.parse(message.ts);
  const matches = hookEvents(home, at).filter((e) =>
    isObject(e)
    && e.type === 'checkpoint_outcome'
    && e.session === message.sessionId
    && ANSWER_OUTCOMES.has(e.outcome)
    && NUDGE_ENTRYPOINTS.has(e.ep)
    && typeof e.ts === 'string'
    && Math.abs(Date.parse(e.ts) - at) <= OWNER_MESSAGE_WINDOW_MS);
  if (matches.length === 0) {
    fail('owner_message_unverified', 'no checkpoint answer of that session within 5 s of that time in the hook log (an interactive session with the hook installed)');
  }
  if (matches.length > 1) fail('owner_message_unverified', 'more than one checkpoint answer of that session within 5 s; give the exact time');
  const [answer] = matches;
  if (!APPROVING_OUTCOMES.includes(answer.outcome)) {
    fail('owner_message_not_accept', `that answer was ${OUTCOME_WORDS[answer.outcome]}, not Nâng cấp: only Nâng cấp on the exact text approves (after Chỉnh, ask again with the new text)`);
  }
  if (answer.literalOption !== true) {
    fail('owner_message_not_literal', 'that answer was not exactly the option word Nâng cấp (a looser yes such as "nâng cấp nhé", "có" or "1" does not promote): ask again and have the owner reply with only Nâng cấp');
  }
  return answer;
}

function refuseRealHome(dirs, env) {
  if (env.AGENT_MATURITY_TEST !== '1') return;
  const real = path.join(os.homedir(), '.claude');
  if (dirs.some((d) => isInside(d, real))) fail('refuse_real_store', 'AGENT_MATURITY_TEST=1: refusing the real ~/.claude');
}

function checkAnswerAge(answer, now) {
  if (now.getTime() - Date.parse(answer.ts) > OWNER_ANSWER_MAX_AGE_MS) {
    fail('owner_message_stale', 'that owner answer is more than 7 days old: ask the checkpoint question again');
  }
}

// A NARROW text was shown to the owner only after socrates gave it: the answer must come after the recorded verdict.
function checkAnsweredAfterVerdict(adapter, candidateId, verdict, ownerMessage) {
  if (!isObject(verdict) || verdict.verdict !== 'NARROW') return;
  const recorded = adapter
    .listEvents(candidateId)
    .filter((e) => e.type === 'verdict_recorded' && e.critiqueNumber === verdict.critiqueNumber)
    .at(-1);
  if (recorded && !(Date.parse(ownerMessage.ts) > Date.parse(recorded.at))) {
    fail('owner_message_before_verdict', 'that answer came before socrates narrowed the text: ask again with the narrowed text');
  }
}

// The owner answered the ask block that showed exactly this text and, unless it is pass, its floor label. The gate
// stores a statement only when text(approval.statement) equals it, so that value is what the gate will return; a
// statement that does not read as text is left to the gate, which refuses it (no candidate, verdict or narrowed text).
function checkAnswerBound(answer, statement, floorClass) {
  const stored = text(statement, GATE_STATEMENT_MAX);
  if (!stored.ok) return;
  if (answer.proposalSha256 !== proposalDigest(stored.value)) {
    fail('owner_message_unbound', 'that answer was not to an ask block whose "Đề xuất" line is exactly the text to store (the narrowed one for NARROW): ask again with that exact text');
  }
  if (floorClass !== 'pass' && floorClass !== 'hard_reject' && answer.floor !== floorClass) {
    fail('owner_message_unbound', `that ask block did not show the safety label ${floorClass} of this text: ask again with the label`);
  }
}

// --supersedes: the owner approved new wording for an old standard. Returns the old record, or refuses
// (supersedes_invalid). On a rerun the old record is already superseded by this candidate's own door-made record.
function checkSupersedes(candidate, oldId, scope, projectId, km) {
  const refuse = (why) => fail('supersedes_invalid', `--supersedes ${oldId}: ${why}`);
  const read = (id) => {
    try {
      return get(id, km);
    } catch (error) {
      return refuse(`record ${id} cannot be read (${error.code ?? error.name}: ${error.message})`);
    }
  };
  if (!(candidate.existingStandards ?? []).some((e) => e.id === oldId)) refuse('the candidate does not list it in existingStandards');
  const old = read(oldId);
  if (isImported(old) || !isDoorMade(old, km)) refuse('it is not a standard promote-standard stored');
  if (old.scope !== scope || (old.project_id ?? null) !== projectId) refuse('it is on another scope or project than this candidate');
  if (old.state === 'active') return old;
  const by = old.state === 'superseded' && old.superseded_by ? read(old.superseded_by) : null;
  if (!by || doorCandidate(by) !== candidate.id || !isDoorMade(by, km)) refuse(`it is ${old.state}, not active`);
  return old;
}

// Read-only, before the gate (every supersede check is here, so a refusal writes nothing): the topic the new record
// is captured under. Step 5 supersedes every active standard on that topic in the record's scope, so each one it
// replaces must be there: the --supersedes record, any active door-made standard whose standard_promoted event has
// the same statementKey (the same text is never active twice, whatever its topic) and any of an earlier revision of
// this candidate. Returns { old, topic }; topic is null when the statement is not text (the gate refuses it).
function planTopic({ candidate, statement, supersedes, projectPath, km }) {
  const stored = text(statement, GATE_STATEMENT_MAX);
  if (!stored.ok) return { old: null, topic: null };
  const key = statementKey(stored.value);
  const scope = candidate.scope.projects === 'this' ? 'project' : 'user';
  const projectId = scope === 'project' ? (lookupProject(projectPath, km)?.id ?? null) : null;
  const old = supersedes ? checkSupersedes(candidate, supersedes, scope, projectId, km) : null;
  const replaced = listDoorActive(km)
    .filter(({ record, event }) => record.scope === scope && (record.project_id ?? null) === projectId
      && (event.statementKey === key || event.candidateId === candidate.id))
    .map(({ record }) => record);
  const topics = [...new Set([...(old ? [old.topic_key] : []), ...replaced.map((r) => r.topic_key)])];
  if (topics.length > 1) {
    const ids = replaced.map((r) => r.id).join(', ');
    fail(old ? 'supersedes_invalid' : 'duplicate_active', `this text is already active as ${ids} under another topic than ${old ? `--supersedes ${old.id}` : 'the others'}: retract the extra standard first (store-cli retract)`);
  }
  return { old, topic: topics[0] ?? `${TOPIC_PREFIX}${key.slice(0, TOPIC_HASH_CHARS)}` };
}

// Under the critic store lock: the approval names what the stored verdict allows (the narrowed text for NARROW) and
// the floor label stored with it; the gate re-derives and checks every one of them and returns what may be stored.
function gateLocked({ adapter, candidateId, answer, ownerMessage, projectPath, supersedes, km, now }) {
  const record = adapter.loadCandidate(candidateId);
  const last = record && Array.isArray(record.verdicts) ? record.verdicts.at(-1) : undefined;
  const candidate = record && isObject(record.candidate) ? record.candidate : null;
  if (candidate && isObject(candidate.scope) && candidate.scope.projects === 'this' && !projectPath) {
    fail('project_path_required', 'this candidate is for one project: pass --project <checkout folder>');
  }
  checkAnsweredAfterVerdict(adapter, candidateId, last, ownerMessage);
  const floorClass = isObject(last) ? promotedFloor(last) : undefined;
  const topics = isObject(last) ? promotedTopics(last) : null;
  const statement = isObject(last) && last.verdict === 'NARROW' ? last.narrowed?.statement : candidate?.statement;
  checkAnswerBound(answer, statement, floorClass);
  const { old, topic } = candidate ? planTopic({ candidate, statement, supersedes, projectPath, km }) : { old: null, topic: null };
  const ownerApproval = {
    approved: true,
    statement,
    ownerMessage,
    ...(typeof floorClass === 'string' ? { floorClass } : {}),
    ...(Array.isArray(topics) ? { topics } : {}),
  };
  const gate = assertPromotable({ adapter, candidateId, ownerApproval, now });
  return { gate, candidate, verdict: last, old, topic };
}

const titleOf = (scope) => {
  const t = `${scope.agent} · ${scope.taskType}`;
  return t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1)}…` : t;
};
const summaryOf = (statement, check) => `${statement}${/[.!?…]$/u.test(statement) ? '' : '.'} Cách kiểm: ${check}`;

// Runs one store step; a failure names the step and what already happened.
function runStep(name, done, fn) {
  try {
    const result = fn();
    done.push(name);
    return result;
  } catch (error) {
    fail('store_step_failed', `${name} failed (${error.code ?? error.name}: ${error.message}); done: ${done.join(', ')}. Once the cause is fixed, the same command finishes the job (capture and promote are idempotent).`, name);
  }
}

function storeStandard({ adapter, gate, candidate, verdict, old, topic, message, answer, projectPath, km, now }) {
  const key = statementKey(gate.statement);
  const verdictSha256 = verdictDigest(verdict);
  const verdictRef = `c${verdict.critiqueNumber}.${verdictSha256.slice(0, 12)}`;
  const base = userSource(message.sessionId, answer.ts);
  const isProject = candidate.scope.projects === 'this';
  const entry = {
    topic,
    title: titleOf(candidate.scope),
    summary: summaryOf(gate.statement, candidate.check),
    source: { ...base, uri: `${base.uri}?candidate=${candidate.id}&verdict=${verdictRef}` },
    kind: STORE_KIND[candidate.kind],
    scope: isProject ? 'project' : 'user',
    ...(isProject ? { projectPath } : {}),
  };
  const done = ['gate'];
  const captured = runStep('capture', done, () => capture(entry, km));
  if (captured.state !== 'candidate' && captured.state !== 'active') {
    fail('store_step_failed', `capture returned a ${captured.state} record (${captured.id}): this exact approval was dropped before; ask the owner again`, 'capture');
  }
  const record = runStep('promote', done, () => promoteApproved(captured.id, km));
  const what = old ? `replaced standard ${old.id} with new wording` : 'approved the same statement again';
  const reason = `promote-standard: candidate ${candidate.id} verdict ${verdictRef} ${what} (owner answer ${message.sessionId} ${answer.ts})`;
  const superseded = runStep('supersede', done, () =>
    listActive(topic, km)
      .filter((r) => r.id !== record.id && r.scope === record.scope && (r.project_id ?? null) === (record.project_id ?? null))
      .map((old) => supersede(old.id, record.id, reason, km).id));
  // The export passes on only records with this event (store-cli.mjs doorMade), so it is logged first.
  runStep('log', done, () => adapter.logEvent({
    type: 'standard_promoted',
    candidateId: candidate.id,
    revision: gate.revision,
    critiqueNumber: verdict.critiqueNumber,
    verdictSha256,
    statementKey: key,
    recordId: record.id,
    topic,
    scope: record.scope,
    superseded,
    ...(old ? { supersedes: old.id } : {}),
    ownerMessage: gate.ownerMessage,
    at: now.toISOString(),
  }));
  const exported = runStep('export', done, () => exportActive(km));
  return {
    candidateId: candidate.id,
    verdict: gate.verdict,
    floor: gate.floor,
    statement: gate.statement,
    recordId: record.id,
    topic,
    scope: record.scope,
    superseded,
    export: { file: exportPath(km).replace(/\\/g, '/'), standards: exported.standards.length, skipped: exported.skipped.length },
  };
}

// opts: { candidateId, ownerMessage, criticStore?, store?, vault?, out?, projectPath?, supersedes?, env?, python?,
// cli?, now? }. Returns what was stored; throws an error with `code` (and `step` after the gate).
export function promoteStandard(opts = {}) {
  const { candidateId, ownerMessage, criticStore, projectPath, supersedes, env = process.env, now = new Date() } = opts;
  if (typeof candidateId !== 'string' || !ID_RE.test(candidateId)) fail('bad_input', '--candidate must be a candidate id');
  if (supersedes !== undefined && !(typeof supersedes === 'string' && UUID_RE.test(supersedes))) fail('bad_input', '--supersedes must be a standard record id');
  const message = parseOwnerMessage(ownerMessage);
  const home = resolveHome(env);
  // The export reads only this critic store (store-cli criticPath): --critic-store is for tests only.
  const criticDir = criticPath({ criticStore, env });
  refuseRealHome([home, criticDir], env);
  const km = { store: opts.store, vault: opts.vault, out: opts.out, criticStore: criticDir, env, python: opts.python, cli: opts.cli };
  const answer = findOwnerAnswer(home, message);
  checkAnswerAge(answer, now);
  if (!cliAvailable(km)) fail('cli_unavailable', 'KnowledgeMemory CLI or bundled Python not found');
  if (!fs.existsSync(criticDir)) fail('candidate_missing', 'no critic store at that folder');
  const adapter = createJsonAdapter(criticDir);
  const ownerPointer = { sessionId: message.sessionId, ts: answer.ts };
  const { gate, candidate, verdict, old, topic } = adapter.withLock(() =>
    gateLocked({ adapter, candidateId, answer, ownerMessage: ownerPointer, projectPath, supersedes, km, now }));
  return storeStandard({ adapter, gate, candidate, verdict, old, topic, message, answer, projectPath, km, now });
}

const FLAGS = {
  '--candidate': 'candidateId',
  '--owner-message': 'ownerMessage',
  '--critic-store': 'criticStore',
  '--store': 'store',
  '--vault': 'vault',
  '--out': 'out',
  '--project': 'projectPath',
  '--supersedes': 'supersedes',
};
const USAGE = 'usage: node promote-standard.mjs --candidate <id> --owner-message <sessionId>:<ISO time> [--critic-store d] [--store d] [--vault d] [--out f] [--project d] [--supersedes <standardId>]';

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = FLAGS[argv[i]];
    const value = argv[i + 1];
    if (!key || value === undefined || value.startsWith('--') || key in opts) return null;
    opts[key] = value;
  }
  return opts.candidateId && opts.ownerMessage ? opts : null;
}

// Prints one JSON object. Exit 0 stored, 1 refused or failed (nothing stored unless `step` says otherwise), 2 usage.
export function main(argv, env = process.env) {
  const opts = parseArgs(argv);
  if (!opts) {
    process.stdout.write(`${JSON.stringify({ error: 'usage', message: USAGE })}\n`);
    return 2;
  }
  try {
    const result = promoteStandard({ ...opts, env });
    process.stdout.write(`${JSON.stringify({ result }, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: error.code ?? error.name, ...(error.step ? { step: error.step } : {}), message: error.message })}\n`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === import.meta.filename.toLowerCase();
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
