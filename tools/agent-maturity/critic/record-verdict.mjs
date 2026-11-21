// Validates a socrates verdict and stores it with its candidate, enforcing the loop guard and the hard-REJECT
// floor.
//   node tools/agent-maturity/critic/record-verdict.mjs <candidate.json> <verdict.json | reply.md> --store <dir>
// The verdict file is plain JSON or the socrates reply ending with a fenced json block. On success prints a
// JSON summary with `decision` (what root does next). Exit 1 = invalid (nothing stored, does not count as a
// critique), 3 = blocked by the loop guard (logged).

import { CliError, EXIT, invokedDirectly, parseCliArgs, readCandidateFile, readTextFile, runMain } from './cli.mjs';
import { createJsonAdapter } from './json-adapter.mjs';
import { MAX_CRITIQUES, planCritique } from './loop-guard.mjs';
import { selectResearchTier } from './research-tier.mjs';
import { extractVerdictJson, promotionDecision, validateVerdict } from './verdict.mjs';

export function recordVerdict({ candidate: parsed, verdictText, adapter, now = new Date() }) {
  const record = adapter.loadCandidate(parsed.id);
  const plan = planCritique(record, parsed, now);
  if (!plan.allowed) {
    adapter.logEvent?.({ ...plan.event, step: 'record' });
    throw new CliError(EXIT.blocked, `critique ${plan.critiqueNumber} blocked for ${parsed.id}: ${plan.reason}`);
  }
  const candidate = { ...parsed, revision: plan.revision };
  const tier = selectResearchTier(candidate);
  const raw = extractVerdictJson(verdictText);
  if (!raw) throw new CliError(EXIT.invalid, 'no verdict JSON found (plain JSON, or a fenced json block at the end)');
  const checked = validateVerdict(raw, { candidate, tier });
  if (!checked.ok) {
    throw new CliError(EXIT.invalid, `invalid verdict: ${checked.errors.map((e) => `${e.code}(${e.field})`).join(', ')}`);
  }

  const verdict = {
    ...checked.value,
    critiqueNumber: plan.critiqueNumber,
    inputFingerprint: plan.fingerprint,
    tier: tier.tier,
    tierRule: tier.ruleId,
    recordedAt: now.toISOString(),
  };
  adapter.saveCandidate(candidate);
  adapter.saveVerdict(candidate.id, verdict);
  adapter.logEvent?.({
    type: 'verdict_recorded',
    candidateId: candidate.id,
    critiqueNumber: plan.critiqueNumber,
    revision: candidate.revision,
    verdict: verdict.verdict,
    hardReject: verdict.hardReject ? verdict.hardReject.class : null,
    at: verdict.recordedAt,
  });
  return {
    ok: true,
    candidateId: candidate.id,
    revision: candidate.revision,
    critiqueNumber: plan.critiqueNumber,
    critiquesLeft: verdict.hardReject ? 0 : MAX_CRITIQUES - plan.critiqueNumber,
    verdict: verdict.verdict,
    hardReject: verdict.hardReject,
    tier: tier.tier,
    decision: promotionDecision({ candidate, verdict }),
  };
}

function main(argv) {
  const {
    positional: [candidateFile, verdictFile],
    store,
  } = parseCliArgs(argv, ['candidate.json', 'verdict.json|reply.md']);
  const candidate = readCandidateFile(candidateFile);
  const verdictText = readTextFile(verdictFile, 'verdict');
  const summary = recordVerdict({ candidate, verdictText, adapter: createJsonAdapter(store) });
  process.stdout.write(`${JSON.stringify({ ...summary, store: store.replaceAll('\\', '/') }, null, 2)}\n`);
  return EXIT.ok;
}

if (invokedDirectly(import.meta.filename)) runMain(main, process.argv.slice(2));
