// Validates a socrates verdict and stores it with its candidate, enforcing the verdict binding, the loop guard,
// the one JSON retry and the hard-REJECT floor and index.
//   node tools/agent-maturity/critic/record-verdict.mjs <candidate.json> <verdict.json | reply.md> --store <dir>
// The verdict file is plain JSON or the socrates reply holding exactly one fenced json block. The verdict must
// echo the inputFingerprint and candidateRevision brief.mjs printed, and that brief's snapshot must be stored.
// On success prints a JSON summary with `decision` (what root does next). Exit 1 = invalid (nothing stored; the
// refusal is logged and says whether one "fix only the JSON" retry is allowed), 3 = blocked (logged).

import { isObject } from './candidate.mjs';
import {
  CliError,
  EXIT,
  blockedError,
  invokedDirectly,
  parseCliArgs,
  readCandidateFile,
  readTextFile,
  refuseHardRejectedStatement,
  runMain,
} from './cli.mjs';
import { assertAdapter, createJsonAdapter } from './json-adapter.mjs';
import {
  MAX_CRITIQUES,
  MAX_JSON_RETRIES,
  canonical,
  inputFingerprint,
  planCritique,
  refusalsOf,
  statementKey,
} from './loop-guard.mjs';
import { selectResearchTier } from './research-tier.mjs';
import { extractVerdictJson, isFormatOnly, normalizeVerdictName, promotionDecision, validateVerdict } from './verdict.mjs';

// The brief for this exact input must have been printed (and stored) for this critique.
function checkSnapshot(adapter, candidate, plan) {
  const snapshot = adapter.loadBrief(candidate.id, plan.fingerprint);
  if (!snapshot) {
    throw new CliError(EXIT.invalid, `brief_snapshot_missing: no brief was printed for this exact candidate text; run brief.mjs first`);
  }
  const same =
    isObject(snapshot.candidate) &&
    snapshot.inputFingerprint === plan.fingerprint &&
    snapshot.critiqueNumber === plan.critiqueNumber &&
    snapshot.revision === candidate.revision &&
    inputFingerprint(snapshot.candidate) === plan.fingerprint &&
    canonical(snapshot.candidate) === canonical(candidate);
  if (!same) throw new CliError(EXIT.invalid, 'brief_snapshot_mismatch: the stored brief does not match this candidate and critique');
}

function checkReply(verdictText, candidate, plan) {
  const extracted = extractVerdictJson(verdictText);
  if (!extracted.ok) return { errors: [{ code: extracted.code, field: '' }], verdictName: null };
  const verdictName = normalizeVerdictName(extracted.value.verdict);
  const checked = validateVerdict(extracted.value, { candidate, tier: selectResearchTier(candidate) });
  if (!checked.ok) return { errors: checked.errors, verdictName };
  if (plan.retryOf && checked.value.verdict !== plan.retryOf) {
    return { errors: [{ code: 'retry_changed_verdict', field: 'verdict' }], verdictName };
  }
  return { value: checked.value };
}

// Logs the refused reply in the loop-guard log and throws exit 1, saying whether the one retry is left.
function refuse(adapter, { candidate, plan, errors, verdictName, now }) {
  const retryable = plan.attempt <= MAX_JSON_RETRIES && isFormatOnly(errors);
  adapter.logEvent({
    type: 'verdict_refused',
    candidateId: candidate.id,
    critiqueNumber: plan.critiqueNumber,
    inputFingerprint: plan.fingerprint,
    attempt: plan.attempt,
    retryable,
    codes: errors.map((e) => e.code),
    verdict: verdictName,
    at: now.toISOString(),
  });
  const list = errors.map((e) => `${e.code}(${e.detail ?? e.field})`).join(', ');
  const next = retryable
    ? 'one retry allowed: ask the same socrates run to fix only the JSON (format or limit error)'
    : `no retry (${isFormatOnly(errors) ? 'the one retry is used' : 'semantic error'}): hold the candidate and tell the owner`;
  throw new CliError(EXIT.invalid, `invalid verdict: ${list}; ${next}`);
}

function store(adapter, { candidate, plan, verdict, now }) {
  adapter.saveCandidate(candidate);
  adapter.saveVerdict(candidate.id, verdict);
  if (verdict.hardReject) {
    adapter.addHardReject({
      statementKey: statementKey(candidate.statement),
      candidateId: candidate.id,
      revision: candidate.revision,
      class: verdict.hardReject.class,
      at: verdict.recordedAt,
    });
  }
  adapter.logEvent({
    type: 'verdict_recorded',
    candidateId: candidate.id,
    critiqueNumber: plan.critiqueNumber,
    revision: candidate.revision,
    inputFingerprint: plan.fingerprint,
    verdict: verdict.verdict,
    hardReject: verdict.hardReject ? verdict.hardReject.class : null,
    at: now.toISOString(),
  });
}

function recordLocked({ parsed, verdictText, adapter, now }) {
  refuseHardRejectedStatement(adapter, parsed, now, 'record');
  const record = adapter.loadCandidate(parsed.id);
  const plan = planCritique(record, parsed, now, { refusals: refusalsOf(adapter.listEvents(parsed.id)), step: 'record' });
  if (!plan.allowed) {
    adapter.logEvent({ ...plan.event, step: 'record' });
    throw blockedError(plan, parsed.id);
  }
  const candidate = { ...parsed, revision: plan.revision };
  checkSnapshot(adapter, candidate, plan);
  const reply = checkReply(verdictText, candidate, plan);
  if (!reply.value) refuse(adapter, { candidate, plan, errors: reply.errors, verdictName: reply.verdictName, now });

  const tier = selectResearchTier(candidate);
  const verdict = {
    ...reply.value,
    critiqueNumber: plan.critiqueNumber,
    tier: tier.tier,
    tierRule: tier.ruleId,
    recordedAt: now.toISOString(),
  };
  store(adapter, { candidate, plan, verdict, now });
  return {
    ok: true,
    candidateId: candidate.id,
    revision: candidate.revision,
    critiqueNumber: plan.critiqueNumber,
    critiquesLeft: verdict.hardReject ? 0 : MAX_CRITIQUES - plan.critiqueNumber,
    verdict: verdict.verdict,
    hardReject: verdict.hardReject,
    tier: tier.tier,
    inputFingerprint: plan.fingerprint,
    decision: promotionDecision({ candidate, verdict }),
  };
}

export function recordVerdict({ candidate: parsed, verdictText, adapter, now = new Date() }) {
  assertAdapter(adapter);
  return adapter.withLock(() => recordLocked({ parsed, verdictText, adapter, now }));
}

function main(argv) {
  const {
    positional: [candidateFile, verdictFile],
    store: storeDir,
  } = parseCliArgs(argv, ['candidate.json', 'verdict.json|reply.md']);
  const candidate = readCandidateFile(candidateFile);
  const verdictText = readTextFile(verdictFile, 'verdict');
  const summary = recordVerdict({ candidate, verdictText, adapter: createJsonAdapter(storeDir) });
  process.stdout.write(`${JSON.stringify({ ...summary, store: storeDir.replaceAll('\\', '/') }, null, 2)}\n`);
  return EXIT.ok;
}

if (invokedDirectly(import.meta.filename)) runMain(main, process.argv.slice(2));
