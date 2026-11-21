// Code-level promote gate. D3's `promote` must call assertPromotable before it writes a standard to the
// KnowledgeMemory store, and must promote the `statement` it returns, nothing else.
//
//   assertPromotable({ adapter, candidateId, ownerApproval })
//     adapter        the critic store adapter; the gate loads the CURRENT candidate, its LAST verdict and the
//                    store-wide hard-REJECT index itself, so a caller cannot hand it a different record
//     ownerApproval  { approved: true, statement: '<exact text>', ownerMessage, floorClass?, topics?,
//                      overrideReject?: true }; no other keys. ownerMessage { sessionId, uuid and/or ts } points to
//                      the owner's answer (Nâng cấp to the checkpoint question that showed this exact text, or the OK
//                      to a NARROW or rewrite diff) and is required for EVERY promotion, pass included; floorClass /
//                      topics are the floor label the owner was shown next to that exact text.
//
// Promotable only when: the stored candidate re-validates as stored; its last verdict is a v2 record bound to it
// (id, revision, inputFingerprint), re-validates against it today and matches the digest record-verdict logged (a
// stored verdict edited after recording is refused); the re-validated verdict carries no hard-REJECT; the promoted text is not hard_reject and its
// statementKey (and the candidate's) is not in the hard-REJECT index; the owner approved exactly that text, with
// ownerMessage pointing to that answer (whatever the floor class: no standard is stored without the owner choosing
// Nâng cấp on its exact text). The promoted text is the candidate statement for ACCEPT, only the stored narrowed
// statement for NARROW, and the candidate statement for a plain REJECT the owner overrides (overrideReject: true).
// owner_review_required text also needs floorClass and topics equal to the floor stored with the verdict, which must
// still be the floor of that text today (a label given with a pass text must match too). NEED-MORE-EVIDENCE is never
// promotable; hard_reject never.
// Audit trail: a promotion that clears every check appends, under the store lock, a promotion_approved event
// { candidateId, statementKey, floorClass, ownerMessage, at } and returns ownerMessage with the statement. One
// checkpoint answer approves one text: an ownerMessage already logged for a different statementKey (same session and
// the same uuid or the same instant) is refused (owner_message_reused). The pointer is RECORDED and REUSE-CHECKED
// here, not verified: the gate cannot read the transcript. Checking it against the D1 hook outcome log (the message
// exists, is the owner's, and answered Nâng cấp to this exact text) is an integration item for D2/D3.
// Throws PromotionRefused with a code, or returns what may be promoted.

import { isObject, text, validateCandidate } from './candidate.mjs';
import { FLOOR_CLASSES, TOPIC_NAMES, classifyCandidateFloor } from './floor.mjs';
import { assertAdapter } from './json-adapter.mjs';
import { FINGERPRINT_RE, canonical, inputFingerprint, statementKey, verdictDigest } from './loop-guard.mjs';
import { selectResearchTier } from './research-tier.mjs';
import { VERDICT_SCHEMA, promotedFloor, promotedTopics, validateVerdict } from './verdict.mjs';

export class PromotionRefused extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

const refuse = (code, message) => {
  throw new PromotionRefused(code, message);
};

const APPROVAL_KEYS = new Set(['approved', 'statement', 'floorClass', 'topics', 'ownerMessage', 'overrideReject']);
const MESSAGE_KEYS = new Set(['sessionId', 'uuid', 'ts']);
const SESSION_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

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
  // The stored candidate carries its revision; validation runs on the candidate fields without it.
  const raw = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== 'revision'));
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

// { sessionId, uuid and/or ts }: where the owner's answer is, never its text.
function messageOk(m) {
  if (!isObject(m) || !Object.keys(m).every((k) => MESSAGE_KEYS.has(k))) return false;
  if (typeof m.sessionId !== 'string' || !SESSION_RE.test(m.sessionId) || !('uuid' in m || 'ts' in m)) return false;
  return (!('uuid' in m) || (typeof m.uuid === 'string' && UUID_RE.test(m.uuid))) && (!('ts' in m) || (typeof m.ts === 'string' && TS_RE.test(m.ts)));
}

function checkApproval(approval) {
  if (!isObject(approval) || approval.approved !== true || typeof approval.statement !== 'string') {
    refuse('owner_approval_missing', 'the owner has not approved the statement to promote');
  }
  const bad = [
    ...Object.keys(approval).filter((k) => !APPROVAL_KEYS.has(k)),
    ...('overrideReject' in approval && typeof approval.overrideReject !== 'boolean' ? ['overrideReject'] : []),
    ...('floorClass' in approval && !FLOOR_CLASSES.includes(approval.floorClass) ? ['floorClass'] : []),
    ...('topics' in approval && !(Array.isArray(approval.topics) && approval.topics.every((t) => TOPIC_NAMES.includes(t))) ? ['topics'] : []),
    ...('ownerMessage' in approval && !messageOk(approval.ownerMessage) ? ['ownerMessage'] : []),
  ];
  if (bad.length > 0) refuse('owner_approval_invalid', `unexpected or malformed fields: ${bad.join(', ')}`);
}

const sameTopics = (a, b) => [...a].sort().join(',') === [...b].sort().join(',');

// The floor stored with the verdict must still be the floor of the promoted text today: the label the owner was
// shown came from it.
function checkStoredFloor(stored, floor) {
  const topics = promotedTopics(stored);
  if (promotedFloor(stored) !== floor.floor || topics === null || !sameTopics(topics, floor.topics)) {
    refuse('floor_changed', 'the floor label stored with the verdict is not the floor of this text today; ask the owner again');
  }
}

// owner_review_required needs the owner's acknowledgement of this label; any label given must match the text.
function checkFloorAck(approval, floor) {
  const given = ['floorClass', 'topics', 'ownerMessage'].filter((k) => k in approval);
  if (floor.floor === 'owner_review_required' && given.length < 3) {
    refuse('floor_ack_missing', `owner_review_required (${floor.topics.join(', ') || floor.reviewReasons.join(', ')}): the owner must have seen this label and topics next to the exact text`);
  }
  const mismatch =
    ('floorClass' in approval && approval.floorClass !== floor.floor) || ('topics' in approval && !sameTopics(approval.topics, floor.topics));
  if (mismatch) refuse('floor_ack_mismatch', 'the owner acknowledged a different floor label or topics than this text has');
}

// Every promotion, pass included, points to the owner's answer (Nâng cấp on the exact text, or OK to its diff).
function checkOwnerMessage(approval) {
  if (!('ownerMessage' in approval)) {
    refuse('owner_message_missing', 'no standard is stored without the owner choosing Nâng cấp on its exact text: give ownerMessage { sessionId, uuid or ts }');
  }
}

// Two pointers name the same answer when they share the session and the message uuid or its instant.
const instant = (ts) => {
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : ts;
};
function sameAnswer(a, b) {
  if (!isObject(a) || !isObject(b) || a.sessionId !== b.sessionId) return false;
  const uuid = typeof a.uuid === 'string' && typeof b.uuid === 'string' && a.uuid.toLowerCase() === b.uuid.toLowerCase();
  const ts = typeof a.ts === 'string' && typeof b.ts === 'string' && instant(a.ts) === instant(b.ts);
  return uuid || ts;
}

// One checkpoint answer approves one text.
function checkMessageUnused(adapter, ownerMessage, key) {
  const reused = adapter.listPromotionApprovals().find((e) => e.statementKey !== key && sameAnswer(e.ownerMessage, ownerMessage));
  if (reused) refuse('owner_message_reused', `this owner answer already approved another text (candidate ${reused.candidateId})`);
}

function checkIndex(adapter, statements) {
  for (const statement of statements) {
    const hit = adapter.findHardReject(statementKey(statement));
    if (hit) refuse('hard_reject_statement', `the statement of hard-REJECTed candidate ${hit.candidateId} (${hit.class})`);
  }
}

function assertLocked(adapter, candidateId, approval, now) {
  const { candidate, verdicts } = loadRecord(adapter, candidateId);
  checkCandidate(candidate, candidateId);
  const verdict = checkVerdict(candidate, verdicts.at(-1));
  checkRecorded(adapter, candidateId, verdicts.at(-1));
  const statement = verdict.verdict === 'NARROW' ? verdict.narrowed.statement : candidate.statement;
  const floor = classifyCandidateFloor(candidate, statement);
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
  checkStoredFloor(verdicts.at(-1), floor);
  checkFloorAck(approval, floor);
  checkOwnerMessage(approval);
  const key = statementKey(statement);
  checkMessageUnused(adapter, approval.ownerMessage, key);
  const ownerMessage = { ...approval.ownerMessage };
  adapter.logEvent({
    type: 'promotion_approved',
    candidateId: candidate.id,
    statementKey: key,
    floorClass: floor.floor,
    ownerMessage,
    at: now.toISOString(),
  });
  return {
    candidateId: candidate.id,
    revision: candidate.revision,
    inputFingerprint: verdict.inputFingerprint,
    verdict: verdict.verdict,
    floor: floor.floor,
    statement,
    ownerMessage,
  };
}

export function assertPromotable({ adapter, candidateId, ownerApproval, now = new Date() } = {}) {
  assertAdapter(adapter);
  return adapter.withLock(() => assertLocked(adapter, candidateId, ownerApproval, now));
}
