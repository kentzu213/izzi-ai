// The single door for storing a dev standard (docs/izzi-v2/sessions/DI.md). Root runs it once, after the owner chose
// Nâng cấp (or Chỉnh) at a checkpoint and the D4 critic recorded a verdict:
//   node promote-standard.mjs --candidate <id> --owner-message <sessionId>:<ISO time of the owner answer>
//     [--critic-store <dir>] [--store <dir>] [--vault <dir>] [--out <file>] [--project <dir>]
// In this order, stopping at the first failure:
//   1. Verify the owner answer against the D1 hook log (<AGENT_MATURITY_HOME>/log): exactly one checkpoint_outcome
//      event of that session, outcome accept (Nâng cấp) or edit (Chỉnh), from an interactive entrypoint, at most
//      ±5 s from the given time. Read-only, so a refused pointer writes nothing (owner_message_unverified).
//   2. assertPromotable (D4 gate) on the critic store, with the hook event's own time as ownerMessage, so one logged
//      answer approves one text (owner_message_reused). The statement stored is the one the gate returns (the
//      narrowed text for NARROW), never an argument.
//   3. capture into KnowledgeMemory: topic dev-standard/<12 hex of statementKey>, source userSource(session, hook
//      time) plus the candidate and verdict ids, scope from the candidate (user unless projects is 'this').
//   4. promote with basis user_instruction and the gate token; 5. supersede the active standard on the same topic;
//   6. exportActive; 7. log standard_promoted in the critic store.
// Everything that can be checked without writing (inputs, the hook log, the KnowledgeMemory CLI) is checked before
// step 2. A failure after it is store_step_failed naming the step; capture and promote are idempotent (the same
// content is the same record), so once the cause is fixed the same command finishes the job.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ID_RE, isObject } from '../critic/candidate.mjs';
import { createJsonAdapter } from '../critic/json-adapter.mjs';
import { statementKey, verdictDigest } from '../critic/loop-guard.mjs';
import { assertPromotable } from '../critic/promote-gate.mjs';
import { promotedFloor, promotedTopics } from '../critic/verdict.mjs';
import { NUDGE_ENTRYPOINTS } from '../lib/decide.mjs';
import { logPath, resolveHome } from '../lib/store.mjs';
import { isInside } from './project-root.mjs';
import {
  TOPIC_PREFIX,
  capture,
  claimPromoteGate,
  cliAvailable,
  exportActive,
  exportPath,
  listActive,
  promote,
  supersede,
  userSource,
} from './store-cli.mjs';

const GATE = claimPromoteGate();
export const OWNER_MESSAGE_WINDOW_MS = 5_000;
export const APPROVING_OUTCOMES = Object.freeze(['accept', 'edit']);
// 12 hex characters: never 13 digits in a row, so the store's card-number check cannot trip on a topic.
const TOPIC_HASH_CHARS = 12;
const TITLE_MAX = 160;
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

// The one hook event that records the owner choosing Nâng cấp or Chỉnh in that session around that time.
export function findOwnerAnswer(home, message) {
  const at = Date.parse(message.ts);
  const matches = hookEvents(home, at).filter((e) =>
    isObject(e)
    && e.type === 'checkpoint_outcome'
    && e.session === message.sessionId
    && APPROVING_OUTCOMES.includes(e.outcome)
    && NUDGE_ENTRYPOINTS.has(e.ep)
    && typeof e.ts === 'string'
    && Math.abs(Date.parse(e.ts) - at) <= OWNER_MESSAGE_WINDOW_MS);
  if (matches.length === 0) {
    fail('owner_message_unverified', 'no Nâng cấp or Chỉnh answer of that session within 5 s of that time in the hook log (an interactive session with the hook installed)');
  }
  if (matches.length > 1) fail('owner_message_unverified', 'more than one checkpoint answer of that session within 5 s; give the exact time');
  return matches[0];
}

function refuseRealHome(dirs, env) {
  if (env.AGENT_MATURITY_TEST !== '1') return;
  const real = path.join(os.homedir(), '.claude');
  if (dirs.some((d) => isInside(d, real))) fail('refuse_real_store', 'AGENT_MATURITY_TEST=1: refusing the real ~/.claude');
}

// Under the critic store lock: the approval names what the stored verdict allows (the narrowed text for NARROW) and
// the floor label stored with it; the gate re-derives and checks every one of them and returns what may be stored.
function gateLocked(adapter, candidateId, ownerMessage, projectPath, now) {
  const record = adapter.loadCandidate(candidateId);
  const last = record && Array.isArray(record.verdicts) ? record.verdicts.at(-1) : undefined;
  const candidate = record && isObject(record.candidate) ? record.candidate : null;
  if (candidate && isObject(candidate.scope) && candidate.scope.projects === 'this' && !projectPath) {
    fail('project_path_required', 'this candidate is for one project: pass --project <checkout folder>');
  }
  const floorClass = isObject(last) ? promotedFloor(last) : undefined;
  const topics = isObject(last) ? promotedTopics(last) : null;
  const ownerApproval = {
    approved: true,
    statement: isObject(last) && last.verdict === 'NARROW' ? last.narrowed?.statement : candidate?.statement,
    ownerMessage,
    ...(typeof floorClass === 'string' ? { floorClass } : {}),
    ...(Array.isArray(topics) ? { topics } : {}),
  };
  const gate = assertPromotable({ adapter, candidateId, ownerApproval, now });
  return { gate, candidate, verdict: last };
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

function storeStandard({ adapter, gate, candidate, verdict, message, answer, projectPath, km, now }) {
  const key = statementKey(gate.statement);
  const topic = `${TOPIC_PREFIX}${key.slice(0, TOPIC_HASH_CHARS)}`;
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
  const record = runStep('promote', done, () => promote(captured.id, 'user_instruction', { ...km, gate: GATE }));
  const reason = `promote-standard: candidate ${candidate.id} verdict ${verdictRef} approved the same statement again (owner answer ${message.sessionId} ${answer.ts})`;
  const superseded = runStep('supersede', done, () =>
    listActive(topic, km)
      .filter((r) => r.id !== record.id && r.scope === record.scope && (r.project_id ?? null) === (record.project_id ?? null))
      .map((old) => supersede(old.id, record.id, reason, km).id));
  const exported = runStep('export', done, () => exportActive(km));
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
    ownerMessage: gate.ownerMessage,
    at: now.toISOString(),
  }));
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

// opts: { candidateId, ownerMessage, criticStore?, store?, vault?, out?, projectPath?, env?, python?, cli?, now? }.
// Returns what was stored; throws an error with `code` (and `step` after the gate).
export function promoteStandard(opts = {}) {
  const { candidateId, ownerMessage, criticStore, projectPath, env = process.env, now = new Date() } = opts;
  if (typeof candidateId !== 'string' || !ID_RE.test(candidateId)) fail('bad_input', '--candidate must be a candidate id');
  const message = parseOwnerMessage(ownerMessage);
  const home = resolveHome(env);
  const criticDir = path.resolve(criticStore ?? path.join(home, 'critic'));
  refuseRealHome([home, criticDir], env);
  const km = { store: opts.store, vault: opts.vault, out: opts.out, env, python: opts.python, cli: opts.cli };
  const answer = findOwnerAnswer(home, message);
  if (!cliAvailable(km)) fail('cli_unavailable', 'KnowledgeMemory CLI or bundled Python not found');
  if (!fs.existsSync(criticDir)) fail('candidate_missing', 'no critic store at that folder');
  const adapter = createJsonAdapter(criticDir);
  const ownerPointer = { sessionId: message.sessionId, ts: answer.ts };
  const { gate, candidate, verdict } = adapter.withLock(() => gateLocked(adapter, candidateId, ownerPointer, projectPath, now));
  return storeStandard({ adapter, gate, candidate, verdict, message, answer, projectPath, km, now });
}

const FLAGS = {
  '--candidate': 'candidateId',
  '--owner-message': 'ownerMessage',
  '--critic-store': 'criticStore',
  '--store': 'store',
  '--vault': 'vault',
  '--out': 'out',
  '--project': 'projectPath',
};
const USAGE = 'usage: node promote-standard.mjs --candidate <id> --owner-message <sessionId>:<ISO time> [--critic-store d] [--store d] [--vault d] [--out f] [--project d]';

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
