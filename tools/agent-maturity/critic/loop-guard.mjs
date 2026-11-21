// Loop guard for the critic step (docs/izzi-v2/PLAN.md §1.2 and §2.4).
// Per candidate: 1 critique + 1 rewrite, and that rewrite gets one re-check. So at most 2 critiques:
//   critique 1  the candidate as the owner approved it;
//   critique 2  only with new input since critique 1 (a rewrite, new research or new evidence);
//   critique 3  always blocked and logged.
// A hard-REJECT is final: no rewrite, no re-check (a reworded loosening is a new candidate, not a retry).
// Pure: decides from the stored record; the caller logs `event` and stores the verdict.

import crypto from 'node:crypto';

export const MAX_CRITIQUES = 2;
export const MAX_REWRITES = 1;

// JSON with sorted keys, so fingerprints do not depend on key order.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const hash = (value) => crypto.createHash('sha256').update(canonical(value)).digest('hex').slice(0, 32);

// What the owner approves: the sentence, its kind, scope and check.
export function statementFingerprint(candidate) {
  const { statement, kind, scope, check } = candidate;
  return hash({ statement, kind, scope, check });
}

// Everything the critic judges: the statement plus evidence, research, flags and same-topic standards.
export function inputFingerprint(candidate) {
  return hash({
    statement: statementFingerprint(candidate),
    evidence: candidate.evidence.map((e) => `${e.id}|${e.type}|${e.at}`).sort(),
    research: [...(candidate.research?.refs ?? [])].sort(),
    flags: candidate.flags ?? {},
    standards: (candidate.existingStandards ?? []).map((s) => s.id).sort(),
  });
}

function blocked(candidateId, critiqueNumber, reason, now) {
  return {
    allowed: false,
    reason,
    critiqueNumber,
    event: { type: 'critique_blocked', candidateId, critiqueNumber, reason, at: now.toISOString() },
  };
}

// record: { candidate, verdicts } as returned by adapter.loadCandidate, or null.
// Returns { allowed: true, critiqueNumber, revision, isRewrite, fingerprint } or
// { allowed: false, reason, critiqueNumber, event }.
export function planCritique(record, candidate, now = new Date()) {
  const fingerprint = inputFingerprint(candidate);
  const verdicts = record?.verdicts ?? [];
  if (verdicts.length === 0) return { allowed: true, critiqueNumber: 1, revision: 1, isRewrite: false, fingerprint };

  const critiqueNumber = verdicts.length + 1;
  if (verdicts.length >= MAX_CRITIQUES) return blocked(candidate.id, critiqueNumber, 'max_critiques', now);
  const last = verdicts[verdicts.length - 1];
  if (last.hardReject) return blocked(candidate.id, critiqueNumber, 'hard_reject_final', now);
  if (last.inputFingerprint === fingerprint) return blocked(candidate.id, critiqueNumber, 'same_input', now);

  const stored = record.candidate;
  const isRewrite = statementFingerprint(stored) !== statementFingerprint(candidate);
  const revision = isRewrite ? stored.revision + 1 : stored.revision;
  return { allowed: true, critiqueNumber, revision, isRewrite, fingerprint };
}
