// Code-level promote gate. D3's `promote` must call assertPromotable before it writes a standard to the
// KnowledgeMemory store, and must promote the `statement` it returns, nothing else.
//
//   assertPromotable({ adapter, candidateId, ownerApproval })
//     adapter        the critic store adapter; the gate loads the CURRENT candidate, its LAST verdict and the
//                    store-wide hard-REJECT index itself, so a caller cannot hand it a different record
//     ownerApproval  { approved: true, statement: '<exact text>', ownerAcknowledgedProtectedTopic?: true,
//                      overrideReject?: true }; no other keys
//
// Promotable only when: the stored candidate re-validates as stored; its last verdict is a v2 record bound to it
// (id, revision, inputFingerprint), re-validates against it today and matches the digest record-verdict logged (a
// stored verdict edited after recording is refused); the re-validated verdict carries no hard-REJECT; the promoted text is not hard_reject and its
// statementKey (and the candidate's) is not in the hard-REJECT index; the owner approved exactly that text. The
// promoted text is the candidate statement for ACCEPT, only the stored narrowed statement for NARROW, and the
// candidate statement for a plain REJECT the owner overrides (overrideReject: true). owner_review_required text
// also needs ownerAcknowledgedProtectedTopic: true. NEED-MORE-EVIDENCE is never promotable; hard_reject never.
// Throws PromotionRefused with a code, or returns what may be promoted.

import { isObject, text, validateCandidate } from './candidate.mjs';
import { classifyFloor } from './floor.mjs';
import { assertAdapter } from './json-adapter.mjs';
import { FINGERPRINT_RE, canonical, inputFingerprint, statementKey, verdictDigest } from './loop-guard.mjs';
import { selectResearchTier } from './research-tier.mjs';
import { VERDICT_SCHEMA, validateVerdict } from './verdict.mjs';

export class PromotionRefused extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

const refuse = (code, message) => {
  throw new PromotionRefused(code, message);
};

const APPROVAL_KEYS = new Set(['approved', 'statement', 'ownerAcknowledgedProtectedTopic', 'overrideReject']);

function loadRecord(adapter, candidateId) {
  let record;
  try {
    record = adapter.loadCandidate(candidateId);
  } catch (error) {
    refuse('candidate_invalid', error.message);
  }
  if (!record) refuse('candidate_missing', `no stored candidate ${JSON.stringify(candidateId)}`);
  return record;
}

function checkCandidate(candidate, candidateId) {
  if (!isObject(candidate) || candidate.id !== candidateId || !Number.isInteger(candidate.revision) || candidate.revision < 1) {
    refuse('candidate_invalid', 'the stored candidate must carry this id and its revision');
  }
  const { revision, ...raw } = candidate;
  const r = validateCandidate(raw);
  if (!r.ok || canonical(r.value) !== canonical(raw)) refuse('candidate_invalid', 'the candidate does not validate as stored');
}

// Returns the verdict as it re-validates today (floor and hard-REJECT recomputed from the stored candidate).
function checkVerdict(candidate, v) {
  if (!isObject(v)) refuse('verdict_missing', 'no verdict record');
  if (v.schema !== VERDICT_SCHEMA || !FINGERPRINT_RE.test(v.inputFingerprint ?? '')) {
    refuse('pre_v2_verdict', 'this verdict predates the fingerprint binding (dry-run evidence only)');
  }
  const bound =
    v.candidateId === candidate.id && v.candidateRevision === candidate.revision && v.inputFingerprint === inputFingerprint(candidate);
  if (!bound) refuse('fingerprint_mismatch', 'the verdict was given for another candidate text or revision');
  const recheck = validateVerdict(v, { candidate, tier: selectResearchTier(candidate) });
  if (!recheck.ok) refuse('verdict_invalid', recheck.errors.map((e) => e.code).join(', '));
  const value = recheck.value;
  if (value.hardReject) refuse('hard_reject', `hard-REJECT ${value.hardReject.class}`);
  if (value.verdict === 'NEED-MORE-EVIDENCE') refuse('verdict_not_promotable', 'verdict NEED-MORE-EVIDENCE');
  return value;
}

// The stored verdict must be byte-for-byte what record-verdict stored: its digest is in the verdict_recorded event.
function checkRecorded(adapter, candidateId, v) {
  const recorded = adapter
    .listEvents(candidateId)
    .filter((e) => e.type === 'verdict_recorded' && e.critiqueNumber === v.critiqueNumber)
    .at(-1);
  if (!recorded || recorded.verdictSha256 !== verdictDigest(v)) {
    refuse('verdict_tampered', 'the stored verdict differs from the one record-verdict recorded');
  }
}

function checkApproval(approval) {
  if (!isObject(approval) || approval.approved !== true || typeof approval.statement !== 'string') {
    refuse('owner_approval_missing', 'the owner has not approved the statement to promote');
  }
  const extra = Object.keys(approval).filter((k) => !APPROVAL_KEYS.has(k));
  const flags = ['ownerAcknowledgedProtectedTopic', 'overrideReject'].filter((k) => k in approval && typeof approval[k] !== 'boolean');
  if (extra.length > 0 || flags.length > 0) refuse('owner_approval_invalid', `unexpected or non-boolean fields: ${[...extra, ...flags].join(', ')}`);
}

function checkIndex(adapter, statements) {
  for (const statement of statements) {
    const hit = adapter.findHardReject(statementKey(statement));
    if (hit) refuse('hard_reject_statement', `the statement of hard-REJECTed candidate ${hit.candidateId} (${hit.class})`);
  }
}

function assertLocked(adapter, candidateId, approval) {
  const { candidate, verdicts } = loadRecord(adapter, candidateId);
  checkCandidate(candidate, candidateId);
  const verdict = checkVerdict(candidate, verdicts.at(-1));
  checkRecorded(adapter, candidateId, verdicts.at(-1));
  const statement = verdict.verdict === 'NARROW' ? verdict.narrowed.statement : candidate.statement;
  const floor = classifyFloor(`${statement}\n${candidate.check}`);
  if (floor.floor === 'hard_reject') refuse('hard_reject', 'the promoted text is a hard_reject loosening');
  checkIndex(adapter, [...new Set([statement, candidate.statement])]);
  checkApproval(approval);
  const approvedText = text(approval.statement, 400);
  if (!approvedText.ok || approvedText.value !== statement) {
    refuse('approval_statement_mismatch', 'the owner approved a different statement than the one this verdict allows');
  }
  if (verdict.verdict === 'REJECT' && approval.overrideReject !== true) {
    refuse('verdict_not_promotable', 'verdict REJECT; only an explicit owner override (overrideReject) promotes it');
  }
  if (floor.floor === 'owner_review_required' && approval.ownerAcknowledgedProtectedTopic !== true) {
    refuse('protected_topic_ack_missing', `owner_review_required (${floor.topics.join(', ') || 'unreadable'}); the owner must acknowledge the protected topic`);
  }
  return {
    candidateId: candidate.id,
    revision: candidate.revision,
    inputFingerprint: verdict.inputFingerprint,
    verdict: verdict.verdict,
    floor: floor.floor,
    statement,
  };
}

export function assertPromotable({ adapter, candidateId, ownerApproval } = {}) {
  assertAdapter(adapter);
  return adapter.withLock(() => assertLocked(adapter, candidateId, ownerApproval));
}
