// Socrates verdict contract (docs/izzi-v2/PLAN.md §2.4 and §4.9 item 6). Pure functions.
// - validateVerdict: schema + consistency with the candidate, its research tier and budget; the verdict must echo
//   the inputFingerprint and candidateRevision the brief printed. A hard_reject floor forces REJECT; the stored
//   verdict carries the floor class of the text it would promote.
// - classifyFloor / detectHardReject: the three-way code floor (floor.mjs), re-exported here.
// - promotionDecision: what root does next; a hard-REJECT is refused even when the owner forces it.
// - extractVerdictJson: plain JSON or exactly one fenced json block, with no duplicate keys.

import { containsPiiOrSecret, isObject, text } from './candidate.mjs';
import { classifyFloor, detectHardReject } from './floor.mjs';
import { inputFingerprint } from './loop-guard.mjs';

export { classifyFloor, detectHardReject };

export const VERDICT_SCHEMA = 'agent-maturity/verdict@2';
export const VERDICTS = ['ACCEPT', 'NARROW', 'NEED-MORE-EVIDENCE', 'REJECT'];
export const HARD_REJECT_CLASSES = [
  'loosens_verification',
  'loosens_security',
  'loosens_honest_reporting',
  'expands_authority',
];
export const EVIDENCE_KINDS = ['event', 'contrast_pair', 'artifact', 'standard', 'source'];
export const FINDINGS = ['supports', 'contradicts', 'insufficient'];
export const CHECK_KEYS = ['evidenceSupports', 'scopeTooWide', 'contradictsExisting', 'tierCorrect'];

// A refused reply may get one "fix only the JSON" retry only when every error is one of these: the reply could
// not be read, or a field broke its shape or a limit. Every other code is a semantic error: no retry.
export const FORMAT_ERROR_CODES = Object.freeze([
  'no_json',
  'json_invalid',
  'multiple_json_blocks',
  'duplicate_keys',
  'not_object',
  'schema_invalid',
  'verdict_invalid',
  'reasons_invalid',
  'evidence_invalid',
  'checks_invalid',
  'hard_reject_invalid',
  'research_invalid',
  'reviewer_invalid',
  'narrowed_invalid',
  'fingerprint_missing',
  'revision_missing',
]);
export const isFormatOnly = (errors) => errors.length > 0 && errors.every((e) => FORMAT_ERROR_CODES.includes(e.code));

const ALIASES = { 'NEED-MORE': 'NEED-MORE-EVIDENCE', NEED_MORE_EVIDENCE: 'NEED-MORE-EVIDENCE' };
const TIER_RANK = { R0: 0, R1: 1, R2: 2 };
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const BOM_AT_START = new RegExp(`^${String.fromCharCode(0xfeff)}`);
// Every limit the validator enforces. brief.mjs prints them from here so the brief and the validator never
// drift. ref fits absolute Windows transcript paths (~120+ characters).
export const VERDICT_LIMITS = Object.freeze({
  reasons: 5,
  reason: 400,
  evidence: 12,
  ref: 300,
  note: 300,
  narrowed: 200,
  refs: 10,
  researchRef: 300,
  detail: 300,
  model: 80,
});
const LIMIT = VERDICT_LIMITS;
const MAX_DETAILS = 5;

// ---- verdict validation ------------------------------------------------------------------------------------

// Each checker returns { ok: true, value } or { ok: false, details: ['evidence[4].ref length 122 > 300', ...] },
// so a refused reply says which item broke which limit.
const bad = (...details) => ({ ok: false, details });
const oneOf = (label, value, list) => `${label} ${JSON.stringify(value)} not in ${list.join('|')}`;

function textOf(value, max, label, { optional = false } = {}) {
  const t = text(value, max, { optional });
  if (t.ok) return t;
  if (value === undefined) return bad(`${label} missing`);
  if (t.reason === 'type') return bad(`${label} is not text`);
  if (t.reason === 'unsafe') return bad(`${label} has a control, format or line-break character`);
  if (t.reason === 'empty') return bad(`${label} is empty`);
  return bad(`${label} length ${t.length} > ${max}`);
}

function listOf(raw, max, label, checkItem, { allowEmpty = false } = {}) {
  if (!Array.isArray(raw)) return bad(raw === undefined ? `${label} missing` : `${label} is not a list`);
  const details = [];
  if (raw.length === 0 && !allowEmpty) details.push(`${label} is empty`);
  if (raw.length > max) details.push(`${label} count ${raw.length} > ${max}`);
  const value = raw.map((item, i) => {
    const r = checkItem(item, `${label}[${i}]`);
    if (!r.ok) details.push(...r.details);
    return r.value;
  });
  if (details.length === 0) return { ok: true, value };
  const extra = details.length - MAX_DETAILS;
  return bad(...details.slice(0, MAX_DETAILS), ...(extra > 0 ? [`+${extra} more`] : []));
}

function evidenceItem(raw, label) {
  if (!isObject(raw)) return bad(`${label} is not an object`);
  const ref = textOf(raw.ref, LIMIT.ref, `${label}.ref`);
  const note = textOf(raw.note, LIMIT.note, `${label}.note`, { optional: true });
  const details = [ref, note].flatMap((r) => (r.ok ? [] : r.details));
  if (!EVIDENCE_KINDS.includes(raw.kind)) details.push(oneOf(`${label}.kind`, raw.kind, EVIDENCE_KINDS));
  if (!FINDINGS.includes(raw.finding)) details.push(oneOf(`${label}.finding`, raw.finding, FINDINGS));
  if (details.length > 0) return bad(...details);
  const item = { ref: ref.value, kind: raw.kind, finding: raw.finding };
  if (note.value !== undefined) item.note = note.value;
  return { ok: true, value: item };
}

function checksOf(raw) {
  if (!isObject(raw)) return bad('checks missing');
  const missing = CHECK_KEYS.filter((k) => typeof raw[k] !== 'boolean');
  if (missing.length > 0) return bad(...missing.map((k) => `checks.${k} must be true or false`));
  return { ok: true, value: Object.fromEntries(CHECK_KEYS.map((k) => [k, raw[k]])) };
}

function hardRejectOf(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (!isObject(raw)) return bad('hardReject must be null or an object');
  const detail = textOf(raw.detail, LIMIT.detail, 'hardReject.detail', { optional: true });
  const details = detail.ok ? [] : detail.details;
  if (!HARD_REJECT_CLASSES.includes(raw.class)) details.push(oneOf('hardReject.class', raw.class, HARD_REJECT_CLASSES));
  if (details.length > 0) return bad(...details);
  return { ok: true, value: { class: raw.class, detail: detail.value ?? '', source: 'critic' } };
}

function researchOf(raw) {
  if (!isObject(raw)) return bad('research missing');
  const rawRefs = raw.refs === undefined ? [] : raw.refs;
  const refText = (r, label) => textOf(r, LIMIT.researchRef, label);
  const refs = listOf(rawRefs, LIMIT.refs, 'research.refs', refText, { allowEmpty: true });
  const details = refs.ok ? [] : refs.details;
  if (!(raw.tier in TIER_RANK)) details.unshift(oneOf('research.tier', raw.tier, Object.keys(TIER_RANK)));
  const deepRuns = raw.deepRuns === undefined ? 0 : raw.deepRuns;
  if (!Number.isInteger(deepRuns) || deepRuns < 0 || deepRuns > 5) details.push('research.deepRuns must be 0-5');
  if (details.length > 0) return bad(...details);
  return { ok: true, value: { tier: raw.tier, refs: refs.value, deepRuns } };
}

function reviewerOf(raw) {
  if (!isObject(raw) || raw.agent !== 'socrates') return bad('reviewer.agent must be socrates');
  const model = textOf(raw.model, LIMIT.model, 'reviewer.model', { optional: true });
  if (!model.ok) return model;
  return { ok: true, value: model.value === undefined ? { agent: 'socrates' } : { agent: 'socrates', model: model.value } };
}

function narrowedOf(raw) {
  const statement = isObject(raw) ? raw.statement : undefined;
  const missing = statement === undefined || (typeof statement === 'string' && statement.trim() === '');
  if (missing) return { ...bad('narrowed.statement missing'), missing: true };
  return textOf(statement, LIMIT.narrowed, 'narrowed.statement');
}

export function normalizeVerdictName(raw) {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  const name = ALIASES[upper] ?? upper;
  return VERDICTS.includes(name) ? name : null;
}

// errors: [{ code, field, detail? }]; detail names the item and the limit when there is one.
function collector() {
  const errors = [];
  const fail = (code, field, details) => {
    errors.push(details && details.length > 0 ? { code, field, detail: details.join('; ') } : { code, field });
  };
  return { errors, fail };
}

// The verdict must name the exact text the brief showed: candidate id, revision and inputFingerprint.
function bindingErrors(raw, candidate, fail) {
  if (raw.candidateId !== candidate.id) fail('candidate_mismatch', 'candidateId');
  if (raw.candidateRevision === undefined) fail('revision_missing', 'candidateRevision');
  else if (raw.candidateRevision !== candidate.revision) fail('revision_mismatch', 'candidateRevision');
  if (raw.inputFingerprint === undefined) fail('fingerprint_missing', 'inputFingerprint');
  else if (raw.inputFingerprint !== inputFingerprint(candidate)) fail('fingerprint_mismatch', 'inputFingerprint');
}

// Structural pass: { errors, parts }.
function parse(raw, candidate) {
  const { errors, fail } = collector();
  const check = (code, field, r) => {
    if (!r.ok) fail(code, field, r.details);
    return r.value;
  };
  if (raw.schema !== undefined && raw.schema !== VERDICT_SCHEMA) fail('schema_invalid', 'schema');
  bindingErrors(raw, candidate, fail);
  const verdict = normalizeVerdictName(raw.verdict);
  if (!verdict) fail('verdict_invalid', 'verdict');
  const reasonText = (r, label) => textOf(r, LIMIT.reason, label);
  const reasons = check('reasons_invalid', 'reasons', listOf(raw.reasons, LIMIT.reasons, 'reasons', reasonText));
  const evidence = check('evidence_invalid', 'evidence', listOf(raw.evidence, LIMIT.evidence, 'evidence', evidenceItem));
  const checks = check('checks_invalid', 'checks', checksOf(raw.checks));
  const hardReject = check('hard_reject_invalid', 'hardReject', hardRejectOf(raw.hardReject));
  const research = check('research_invalid', 'research', researchOf(raw.research));
  const reviewer = check('reviewer_invalid', 'reviewer', reviewerOf(raw.reviewer));
  const narrowed = narrowedOf(raw.narrowed);
  const reviewAfter = typeof raw.reviewAfter === 'string' && DAY_RE.test(raw.reviewAfter) ? raw.reviewAfter : null;
  return {
    errors,
    parts: { verdict, reasons, evidence, checks, hardReject, research, reviewer, narrowed, reviewAfter },
  };
}

function narrowErrors(p, candidate, fail) {
  if (!p.narrowed.ok) fail(p.narrowed.missing ? 'narrow_needs_statement' : 'narrowed_invalid', 'narrowed', p.narrowed.details);
  else if (p.narrowed.value === candidate.statement) {
    fail('narrow_needs_statement', 'narrowed', ['narrowed.statement equals the candidate statement']);
  } else if (detectHardReject(p.narrowed.value)) fail('hard_reject_floor', 'narrowed');
}

function researchErrors(p, tier, fail) {
  const shapesSentence = p.verdict === 'ACCEPT' || p.verdict === 'NARROW';
  const r = p.research;
  if (shapesSentence && TIER_RANK[r.tier] < TIER_RANK[tier.tier]) fail('research_tier_below_required', 'research');
  const { maxSources, maxDeepRuns } = tier.budget;
  const overBudget = [
    ...(r.refs.length > maxSources ? [`research.refs count ${r.refs.length} > ${tier.tier} budget ${maxSources}`] : []),
    ...(r.deepRuns > maxDeepRuns ? [`research.deepRuns ${r.deepRuns} > ${tier.tier} budget ${maxDeepRuns}`] : []),
  ];
  if (overBudget.length > 0) fail('research_over_budget', 'research', overBudget);
  if (tier.external !== 'allowed' && r.refs.some((ref) => /^https?:/i.test(ref))) {
    fail('external_research_not_allowed', 'research');
  }
  if (shapesSentence && tier.tier !== 'R0' && r.refs.length === 0) fail('research_refs_missing', 'research');
  if (shapesSentence && tier.tier === 'R2' && tier.external === 'allowed' && r.deepRuns < 1) {
    fail('research_deep_run_missing', 'research');
  }
}

function semanticErrors(p, candidate, tier) {
  const { errors, fail } = collector();
  const shapesSentence = p.verdict === 'ACCEPT' || p.verdict === 'NARROW';

  if (p.hardReject && p.verdict !== 'REJECT') fail('hard_reject_must_reject', 'hardReject');
  const floor = classifyFloor(`${candidate.statement}\n${candidate.check}`);
  if (floor.floor === 'hard_reject' && p.verdict !== 'REJECT') fail('hard_reject_floor', 'verdict');

  if (p.verdict === 'NARROW') narrowErrors(p, candidate, fail);
  if (p.verdict === 'ACCEPT') {
    const c = p.checks;
    if (!c.evidenceSupports || c.scopeTooWide || c.contradictsExisting || !c.tierCorrect) fail('accept_checks_failed', 'checks');
  }
  if (shapesSentence) {
    const ids = new Set(candidate.evidence.map((e) => e.id));
    if (!p.evidence.some((e) => e.finding === 'supports' && ids.has(e.ref))) {
      fail(`${p.verdict.toLowerCase()}_needs_candidate_evidence`, 'evidence');
    }
  }
  if (p.verdict === 'NEED-MORE-EVIDENCE' && !p.reviewAfter) fail('need_more_needs_review_date', 'reviewAfter');
  researchErrors(p, tier, fail);
  return { errors, floor };
}

// candidate: normalized candidate with its revision; tier: selectResearchTier(candidate).
// Returns { ok, errors: [{ code, field }], value } with value ready to store (unknown fields dropped).
export function validateVerdict(raw, { candidate, tier }) {
  if (!isObject(raw)) return { ok: false, errors: [{ code: 'not_object', field: '' }], value: null };
  const { errors, parts: p } = parse(raw, candidate);
  if (errors.length > 0) return { ok: false, errors, value: null };
  const semantic = semanticErrors(p, candidate, tier);
  if (semantic.errors.length > 0) return { ok: false, errors: semantic.errors, value: null };

  const { floor } = semantic;
  const fromFloor =
    floor.floor === 'hard_reject' ? { class: floor.class, detail: 'code floor matched the candidate wording', source: 'code' } : null;
  const value = {
    schema: VERDICT_SCHEMA,
    candidateId: candidate.id,
    candidateRevision: candidate.revision,
    inputFingerprint: raw.inputFingerprint,
    verdict: p.verdict,
    reasons: p.reasons,
    evidence: p.evidence,
    checks: p.checks,
    hardReject: p.hardReject ?? fromFloor,
    floor: floor.floor,
    research: p.research,
    reviewer: p.reviewer,
  };
  if (p.verdict === 'NARROW') {
    value.narrowed = { statement: p.narrowed.value, floor: classifyFloor(`${p.narrowed.value}\n${candidate.check}`).floor };
  }
  if (p.verdict === 'NEED-MORE-EVIDENCE') value.reviewAfter = p.reviewAfter;
  if (containsPiiOrSecret(JSON.stringify(value))) return { ok: false, errors: [{ code: 'pii_or_secret', field: '' }], value: null };
  return { ok: true, errors: [], value };
}

// ---- what root does next (PLAN §2.4 step 4) ---------------------------------------------------------------

// The floor class of the text a verdict would promote: the narrowed statement for NARROW, else the candidate's.
export const promotedFloor = (verdict) => (verdict.verdict === 'NARROW' ? verdict.narrowed?.floor : verdict.floor);

// A hard-REJECT is refused, even when the owner forces it. On owner_review_required text a socrates ACCEPT or
// NARROW is not enough: the owner approves the exact text and acknowledges the protected topic (assertPromotable
// checks it). A plain REJECT is held; the owner may still override it by approving the exact text.
export function promotionDecision({ candidate, verdict, ownerForce = false, ownerApprovedDiff = false }) {
  if (verdict.hardReject) return { action: 'refuse', reason: `hard_reject:${verdict.hardReject.class}` };
  const decision = verdictDecision({ candidate, verdict, ownerForce, ownerApprovedDiff });
  if (promotedFloor(verdict) !== 'owner_review_required') return decision;
  return decision.action === 'hold'
    ? { ...decision, ownerReviewRequired: true }
    : { action: 'owner_review', reason: 'protected_topic', ownerReviewRequired: true };
}

function verdictDecision({ candidate, verdict, ownerForce, ownerApprovedDiff }) {
  switch (verdict.verdict) {
    case 'ACCEPT':
      if (candidate.revision === 1) return { action: 'promote', reason: 'accept_unchanged' };
      return ownerApprovedDiff
        ? { action: 'promote', reason: 'accept_owner_approved_rewrite' }
        : { action: 'show_diff', reason: 'accept_reworded' };
    case 'NARROW':
      return ownerApprovedDiff
        ? { action: 'promote_narrowed', reason: 'narrow_owner_approved' }
        : { action: 'show_diff', reason: 'narrowed' };
    case 'NEED-MORE-EVIDENCE':
      return { action: 'hold', reason: 'need_more_evidence', reviewAfter: verdict.reviewAfter };
    default:
      return ownerForce ? { action: 'promote_forced', reason: 'owner_forced_reject' } : { action: 'hold', reason: 'rejected' };
  }
}

// ---- reading the reply ---------------------------------------------------------------------------------------

// True when some object in valid JSON text repeats a key (JSON.parse would silently keep the last one).
function hasDuplicateKeys(source) {
  const stack = [];
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"') {
      let j = i + 1;
      while (source[j] !== '"') j += source[j] === '\\' ? 2 : 1;
      const top = stack[stack.length - 1];
      if (top && top.keys && top.expectKey) {
        const key = JSON.parse(source.slice(i, j + 1));
        if (top.keys.has(key)) return true;
        top.keys.add(key);
        top.expectKey = false;
      }
      i = j;
    } else if (ch === '{') stack.push({ keys: new Set(), expectKey: true });
    else if (ch === '[') stack.push({ keys: null });
    else if (ch === '}' || ch === ']') stack.pop();
    else if (ch === ',' && stack.length > 0 && stack[stack.length - 1].keys) stack[stack.length - 1].expectKey = true;
  }
  return false;
}

function parseObject(source) {
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    return { ok: false, code: 'json_invalid' };
  }
  if (!isObject(value)) return { ok: false, code: 'json_invalid' };
  return hasDuplicateKeys(source) ? { ok: false, code: 'duplicate_keys' } : { ok: true, value };
}

// A verdict file is plain JSON or a socrates reply holding exactly one fenced json block (a fenced block whose
// language is json or whose body starts with "{"). Returns { ok: true, value } or { ok: false, code }.
export function extractVerdictJson(input) {
  const trimmed = typeof input === 'string' ? input.replace(BOM_AT_START, '').trim() : '';
  if (trimmed.startsWith('{')) {
    const whole = parseObject(trimmed);
    if (whole.ok || whole.code === 'duplicate_keys') return whole;
  }
  const blocks = [...trimmed.matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)].filter(
    ([, lang, body]) => lang.trim().toLowerCase() === 'json' || body.trim().startsWith('{'),
  );
  if (blocks.length > 1) return { ok: false, code: 'multiple_json_blocks' };
  if (blocks.length === 0) return { ok: false, code: trimmed.startsWith('{') ? 'json_invalid' : 'no_json' };
  return parseObject(blocks[0][2]);
}
