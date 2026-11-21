// Code-level promote gate. D3's `promote` must call assertPromotable before it writes a standard to the
// KnowledgeMemory store, and must promote the `statement` it returns, nothing else. Pure: throws
// PromotionRefused with a code, or returns what may be promoted.
//
//   candidate      the CURRENT stored candidate, with its revision (adapter.loadCandidate(id).candidate)
//   verdictRecord  the LAST stored verdict for it, plus the owner's approval of the exact sentence to promote:
//                  { ...record.verdicts.at(-1), ownerApproval: { approved: true, statement: '<exact text>' } }
//
// Promotable only when: the verdict is a v2 record bound to this candidate (id, revision, inputFingerprint);
// it re-validates against the candidate today; it is ACCEPT (the candidate statement) or NARROW (the narrowed
// statement); it carries no hard-REJECT and the floor does not match the promoted text; and the owner approved
// that exact statement. The caller must also refuse a statement the store-wide hard-REJECT index holds
// (adapter.findHardReject(statementKey(statement))).

import { isObject, text, validateCandidate } from './candidate.mjs';
import { FINGERPRINT_RE, canonical, inputFingerprint } from './loop-guard.mjs';
import { selectResearchTier } from './research-tier.mjs';
import { VERDICT_SCHEMA, detectHardReject, validateVerdict } from './verdict.mjs';

export class PromotionRefused extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

const refuse = (code, message) => {
  throw new PromotionRefused(code, message);
};

function checkCandidate(candidate) {
  if (!isObject(candidate) || !Number.isInteger(candidate.revision) || candidate.revision < 1) {
    refuse('candidate_invalid', 'the candidate must be the stored candidate with its revision');
  }
  const { revision, ...raw } = candidate;
  const r = validateCandidate(raw);
  if (!r.ok || canonical(r.value) !== canonical(raw)) refuse('candidate_invalid', 'the candidate does not validate as stored');
}

function checkVersion(v) {
  if (!isObject(v)) refuse('verdict_missing', 'no verdict record');
  if (v.schema !== VERDICT_SCHEMA || !FINGERPRINT_RE.test(v.inputFingerprint ?? '')) {
    refuse('pre_v2_verdict', 'this verdict predates the fingerprint binding (dry-run evidence only)');
  }
}

function checkBinding(candidate, v) {
  if (v.hardReject) refuse('hard_reject', `hard-REJECT ${v.hardReject.class}`);
  if (v.verdict !== 'ACCEPT' && v.verdict !== 'NARROW') refuse('verdict_not_promotable', `verdict ${v.verdict}`);
  const bound =
    v.candidateId === candidate.id &&
    v.candidateRevision === candidate.revision &&
    v.inputFingerprint === inputFingerprint(candidate);
  if (!bound) refuse('fingerprint_mismatch', 'the verdict was given for another candidate text or revision');
  const recheck = validateVerdict(v, { candidate, tier: selectResearchTier(candidate) });
  if (!recheck.ok) refuse('verdict_invalid', recheck.errors.map((e) => e.code).join(', '));
}

export function assertPromotable(candidate, verdictRecord) {
  checkVersion(verdictRecord);
  checkCandidate(candidate);
  checkBinding(candidate, verdictRecord);
  const statement = verdictRecord.verdict === 'NARROW' ? verdictRecord.narrowed.statement : candidate.statement;
  if (detectHardReject(`${statement}\n${candidate.check}`)) refuse('hard_reject', 'the promoted text matches the hard-REJECT floor');
  const approval = verdictRecord.ownerApproval;
  if (!isObject(approval) || approval.approved !== true || typeof approval.statement !== 'string') {
    refuse('owner_approval_missing', 'the owner has not approved the statement to promote');
  }
  const approvedText = text(approval.statement, 400);
  if (!approvedText.ok || approvedText.value !== statement) {
    refuse('approval_statement_mismatch', 'the owner approved a different statement than the one this verdict allows');
  }
  return {
    candidateId: candidate.id,
    revision: candidate.revision,
    inputFingerprint: verdictRecord.inputFingerprint,
    verdict: verdictRecord.verdict,
    statement,
  };
}
