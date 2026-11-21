// Loop guard for the critic step (docs/izzi-v2/PLAN.md §1.2 and §2.4).
// Per candidate: 1 critique + 1 rewrite, and that rewrite gets one re-check. So at most 2 critiques:
//   critique 1  the candidate as the owner approved it;
//   critique 2  only with new input since critique 1 (a rewrite, new research or new evidence);
//   critique 3  always blocked and logged.
// A hard-REJECT is final: no rewrite, no re-check (a reworded loosening is a new candidate, not a retry).
// A refused socrates reply gets at most one "fix only the JSON" retry, and only for a format or limit error;
// a semantic error, or a second refusal, ends the critique. The retry keeps the first reply's verdict and whether
// it set hardReject; when the first verdict could not be read, the retry may only be REJECT or NEED-MORE-EVIDENCE.
// At most two briefs per candidate revision and two per statement store-wide (each brief is logged with its
// statementKey; a new candidate id does not reset the count), so a brief cannot be re-run to shop for a verdict.
// Pure: decides from the stored record and the logged events; the caller logs `event` and stores the verdict.

import crypto from 'node:crypto';

export const MAX_CRITIQUES = 2;
export const MAX_REWRITES = 1;
export const MAX_JSON_RETRIES = 1;
export const MAX_BRIEFS_PER_REVISION = 2;
// A retry after a reply whose verdict could not be read may only hold the candidate.
export const UNREADABLE_RETRY_VERDICTS = Object.freeze(['REJECT', 'NEED-MORE-EVIDENCE']);
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

// Digest of a stored verdict record; record-verdict logs it and the promote gate checks it.
export const verdictDigest = (verdict) => sha256(canonical(verdict));

// Store-wide key for "the same statement": NFKC, lower case, punctuation and spacing collapsed. Diacritics are
// kept: "tắt" (turn off) and "tất" (all) are different words.
export function statementKey(statement) {
  const folded = String(statement).normalize('NFKC').toLowerCase();
  return sha256(folded.replace(/[^\p{L}\p{N}]+/gu, ' ').trim());
}

// The verdict_refused and brief_generated events of one candidate, as planCritique reads them.
export const refusalsOf = (events) => events.filter((e) => e && e.type === 'verdict_refused');
export const briefsOf = (events) => events.filter((e) => e && e.type === 'brief_generated');

// What a refused first reply said, as record-verdict logged it.
const firstReply = (e) => ({
  verdict: typeof e.verdict === 'string' ? e.verdict : null,
  hardRejectPresent: typeof e.hardRejectPresent === 'boolean' ? e.hardRejectPresent : null,
});

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
// refusals: verdict_refused events of this candidate; briefs: its brief_generated events; statementBriefs: the
// brief_generated events of this statement under any id; step: 'brief' (a fresh socrates run) or 'record'. Returns { allowed: true, critiqueNumber, revision, isRewrite, fingerprint, attempt,
// retryOf } or { allowed: false, reason, critiqueNumber, event }. retryOf is null on a first attempt, else what the
// refused first reply said: { verdict (null when unreadable), hardRejectPresent (null when unknown) }.
export function planCritique(record, candidate, now = new Date(), { refusals = [], briefs = [], statementBriefs = [], step = 'record' } = {}) {
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
  if (step === 'brief' && briefs.filter((e) => e.revision === r.revision).length >= MAX_BRIEFS_PER_REVISION) {
    return blocked(candidate.id, critiqueNumber, 'brief_cap', now);
  }
  if (step === 'brief' && statementBriefs.length >= MAX_BRIEFS_PER_REVISION) {
    return blocked(candidate.id, critiqueNumber, 'statement_brief_cap', now);
  }
  return {
    allowed: true,
    critiqueNumber,
    revision: r.revision,
    isRewrite: r.isRewrite,
    fingerprint,
    attempt: pending.length + 1,
    retryOf: pending.length > 0 ? firstReply(pending[0]) : null,
  };
}
