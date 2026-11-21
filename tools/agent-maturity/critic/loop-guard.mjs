// Loop guard for the critic step (docs/izzi-v2/PLAN.md §1.2 and §2.4).
// Per candidate: 1 critique + 1 rewrite, and that rewrite gets one re-check. So at most 2 critiques:
//   critique 1  the candidate as the owner approved it;
//   critique 2  only with new input since critique 1 (a rewrite, new research or new evidence);
//   critique 3  always blocked and logged.
// A hard-REJECT is final: no rewrite, no re-check (a reworded loosening is a new candidate, not a retry).
// A refused socrates reply gets at most one "fix only the JSON" retry, and only for a format or limit error;
// a semantic error, or a second refusal, ends the critique.
// Pure: decides from the stored record and the refusal events; the caller logs `event` and stores the verdict.

import crypto from 'node:crypto';

import { stripDiacritics } from './candidate.mjs';

export const MAX_CRITIQUES = 2;
export const MAX_REWRITES = 1;
export const MAX_JSON_RETRIES = 1;
export const FINGERPRINT_RE = /^[0-9a-f]{64}$/;

// JSON with sorted keys, so fingerprints do not depend on key order.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// What the owner approves: the sentence, its kind, scope and check. Decides whether a change is a rewrite.
export function statementFingerprint(candidate) {
  const { statement, kind, scope, check } = candidate;
  return sha256(canonical({ statement, kind, scope, check })).slice(0, 32);
}

// Everything the brief shows the critic, bound to the revision: brief.mjs prints it, the verdict must echo it and
// record-verdict refuses a verdict whose fingerprint does not match the current candidate. Evidence order is
// kept: the contrast pair depends on it.
export function inputFingerprint(candidate) {
  if (!Number.isInteger(candidate?.revision) || candidate.revision < 1) {
    throw new Error('inputFingerprint needs the candidate revision');
  }
  return sha256(
    canonical({
      v: 2,
      id: candidate.id,
      revision: candidate.revision,
      statement: candidate.statement,
      kind: candidate.kind,
      scope: candidate.scope,
      check: candidate.check,
      evidence: candidate.evidence.map(({ id, type, at, source, note }) => ({ id, type, at, source, note })),
      flags: candidate.flags ?? {},
      existingStandards: (candidate.existingStandards ?? []).map(({ id, statement }) => ({ id, statement })),
      research: candidate.research?.refs ?? [],
    }),
  );
}

// Store-wide key for "the same statement": NFKC, lower case, no diacritics, punctuation and spacing collapsed.
export function statementKey(statement) {
  const folded = stripDiacritics(String(statement).normalize('NFKC').toLowerCase());
  return sha256(folded.replace(/[^\p{L}\p{N}]+/gu, ' ').trim());
}

// The verdict_refused events of one candidate, as planCritique reads them.
export const refusalsOf = (events) => events.filter((e) => e && e.type === 'verdict_refused');

function blocked(candidateId, critiqueNumber, reason, now) {
  return {
    allowed: false,
    reason,
    critiqueNumber,
    event: { type: 'critique_blocked', candidateId, critiqueNumber, reason, at: now.toISOString() },
  };
}

// The revision this input would get, or a block reason from the stored verdicts.
function revisionFor(record, candidate, critiqueNumber, now) {
  const verdicts = record?.verdicts ?? [];
  if (verdicts.length === 0) return { revision: 1, isRewrite: false };
  if (verdicts.length >= MAX_CRITIQUES) return blocked(candidate.id, critiqueNumber, 'max_critiques', now);
  const last = verdicts[verdicts.length - 1];
  if (last.hardReject) return blocked(candidate.id, critiqueNumber, 'hard_reject_final', now);
  if (!FINGERPRINT_RE.test(last.inputFingerprint ?? '')) return blocked(candidate.id, critiqueNumber, 'pre_v2_record', now);
  const stored = record.candidate;
  const isRewrite = statementFingerprint(stored) !== statementFingerprint(candidate);
  return { revision: isRewrite ? stored.revision + 1 : stored.revision, isRewrite };
}

// record: { candidate, verdicts } as returned by adapter.loadCandidate, or null.
// refusals: verdict_refused events of this candidate; step: 'brief' (a fresh socrates run) or 'record'.
// Returns { allowed: true, critiqueNumber, revision, isRewrite, fingerprint, attempt, retryOf } or
// { allowed: false, reason, critiqueNumber, event }.
export function planCritique(record, candidate, now = new Date(), { refusals = [], step = 'record' } = {}) {
  const verdicts = record?.verdicts ?? [];
  const critiqueNumber = verdicts.length + 1;
  const r = revisionFor(record, candidate, critiqueNumber, now);
  if (r.allowed === false) return r;
  const fingerprint = inputFingerprint({ ...candidate, revision: r.revision });
  if (verdicts.length > 0 && verdicts[verdicts.length - 1].inputFingerprint === fingerprint) {
    return blocked(candidate.id, critiqueNumber, 'same_input', now);
  }

  const pending = refusals.filter((e) => e.critiqueNumber === critiqueNumber);
  if (pending.some((e) => e.retryable !== true)) return blocked(candidate.id, critiqueNumber, 'reply_refused_final', now);
  if (pending.length > MAX_JSON_RETRIES) return blocked(candidate.id, critiqueNumber, 'json_retry_used', now);
  if (pending.length > 0 && (step === 'brief' || pending[0].inputFingerprint !== fingerprint)) {
    return blocked(candidate.id, critiqueNumber, 'json_retry_pending', now);
  }
  return {
    allowed: true,
    critiqueNumber,
    revision: r.revision,
    isRewrite: r.isRewrite,
    fingerprint,
    attempt: pending.length + 1,
    retryOf: pending.length > 0 ? pending[0].verdict ?? null : null,
  };
}
