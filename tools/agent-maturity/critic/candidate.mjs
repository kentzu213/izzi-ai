// Candidate standard schema for the critic step (docs/izzi-v2/PLAN.md §2.4, research report §5.2).
// Pure: validates and normalizes; the revision is managed by the loop guard, never read from a file.

export const CANDIDATE_SCHEMA = 'agent-maturity/candidate@1';
export const KINDS = ['preference', 'procedure', 'quality_gate', 'pitfall'];
export const EVIDENCE_TYPES = ['correction', 'reject', 'edit', 'approve_after_reject', 'approve', 'decision', 'outcome'];
export const FLAG_NAMES = ['touchesLaw', 'touchesSecurity', 'contentClaim', 'changesWorkflow', 'ownerPrivate'];
export const ID_RE = /^[a-z0-9][a-z0-9-]{2,63}$/;

const REF_RE = /^[A-Za-z0-9._:#§/-]{1,80}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;
const CORRECTION_TYPES = new Set(['correction', 'reject', 'edit']);
const APPROVAL_TYPES = new Set(['approve_after_reject', 'approve', 'decision']);
const LIMIT = { statement: 200, check: 300, agent: 80, taskType: 120, source: 200, note: 300, list: 10, ref: 300 };

// Keys, tokens, phone numbers and emails must never be stored in a candidate or verdict.
const PII_OR_SECRET = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /(?<![\dA-Za-z])(?:\+84|0)[35789](?:[ .-]?\d){8}(?![\dA-Za-z])/,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
];

export const containsPiiOrSecret = (text) => typeof text === 'string' && PII_OR_SECRET.some((re) => re.test(text));

export const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function text(value, max, { optional = false } = {}) {
  if (value === undefined && optional) return { ok: true, value: undefined };
  if (typeof value !== 'string') return { ok: false };
  const trimmed = value.normalize('NFC').trim();
  return trimmed.length > 0 && trimmed.length <= max ? { ok: true, value: trimmed } : { ok: false };
}

function evidenceItem(raw) {
  if (!isObject(raw)) return null;
  const source = text(raw.source, LIMIT.source);
  const note = text(raw.note, LIMIT.note, { optional: true });
  const ok =
    typeof raw.id === 'string' &&
    REF_RE.test(raw.id) &&
    EVIDENCE_TYPES.includes(raw.type) &&
    typeof raw.at === 'string' &&
    DATE_RE.test(raw.at) &&
    source.ok &&
    note.ok;
  if (!ok) return null;
  const item = { id: raw.id, type: raw.type, at: raw.at, source: source.value };
  if (note.value !== undefined) item.note = note.value;
  return item;
}

function listOf(raw, max, mapItem) {
  if (raw === undefined) return { ok: true, value: [] };
  if (!Array.isArray(raw) || raw.length > max) return { ok: false };
  const items = raw.map(mapItem);
  return items.every((x) => x !== null) ? { ok: true, value: items } : { ok: false };
}

function flagsOf(raw) {
  if (raw === undefined) return { ok: true, value: {} };
  if (!isObject(raw)) return { ok: false };
  const entries = Object.entries(raw);
  const ok = entries.every(([k, v]) => FLAG_NAMES.includes(k) && typeof v === 'boolean');
  return ok ? { ok: true, value: Object.fromEntries(entries) } : { ok: false };
}

function scopeOf(raw) {
  if (!isObject(raw)) return { ok: false };
  const agent = text(raw.agent, LIMIT.agent);
  const taskType = text(raw.taskType, LIMIT.taskType);
  const ok = agent.ok && taskType.ok && (raw.projects === 'all' || raw.projects === 'this');
  return ok ? { ok: true, value: { agent: agent.value, taskType: taskType.value, projects: raw.projects } } : { ok: false };
}

const standardItem = (raw) => {
  if (!isObject(raw) || typeof raw.id !== 'string' || !REF_RE.test(raw.id)) return null;
  const statement = text(raw.statement, LIMIT.ref);
  return statement.ok ? { id: raw.id, statement: statement.value } : null;
};

const refItem = (raw) => {
  const r = text(raw, LIMIT.ref);
  return r.ok ? r.value : null;
};

function researchOf(raw) {
  if (raw === undefined) return { ok: true, value: { refs: [] } };
  if (!isObject(raw)) return { ok: false };
  const refs = listOf(raw.refs, LIMIT.list, refItem);
  return refs.ok ? { ok: true, value: { refs: refs.value } } : { ok: false };
}

// { ok, errors: [{ code, field }], value }. value is the normalized candidate (no revision, unknown keys dropped).
export function validateCandidate(raw) {
  if (!isObject(raw)) return { ok: false, errors: [{ code: 'not_object', field: '' }], value: null };
  const errors = [];
  const fail = (code, field) => errors.push({ code, field });

  if (raw.schema !== undefined && raw.schema !== CANDIDATE_SCHEMA) fail('schema_invalid', 'schema');
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) fail('id_invalid', 'id');
  const statement = text(raw.statement, LIMIT.statement);
  if (!statement.ok) fail('statement_invalid', 'statement');
  if (!KINDS.includes(raw.kind)) fail('kind_invalid', 'kind');
  const scope = scopeOf(raw.scope);
  if (!scope.ok) fail('scope_invalid', 'scope');
  const check = text(raw.check, LIMIT.check);
  if (!check.ok) fail('check_invalid', 'check');
  const evidence = listOf(raw.evidence, LIMIT.list, evidenceItem);
  if (!evidence.ok || evidence.value.length === 0) fail('evidence_invalid', 'evidence');
  const flags = flagsOf(raw.flags);
  if (!flags.ok) fail('flags_invalid', 'flags');
  const existingStandards = listOf(raw.existingStandards, LIMIT.list, standardItem);
  if (!existingStandards.ok) fail('existing_standards_invalid', 'existingStandards');
  const research = researchOf(raw.research);
  if (!research.ok) fail('research_invalid', 'research');
  if (errors.length > 0) return { ok: false, errors, value: null };

  const value = {
    id: raw.id,
    statement: statement.value,
    kind: raw.kind,
    scope: scope.value,
    check: check.value,
    evidence: evidence.value,
    flags: flags.value,
    existingStandards: existingStandards.value,
    research: research.value,
  };
  if (containsPiiOrSecret(JSON.stringify(value))) return { ok: false, errors: [{ code: 'pii_or_secret', field: '' }], value: null };
  return { ok: true, errors: [], value };
}

// Strong evidence (research report §3.3 rule 1): a correction, rejection or edit followed later, in list order,
// by an approval or decision. Evidence is listed oldest first.
export function hasContrastPair(candidate) {
  const list = candidate.evidence;
  const firstCorrection = list.findIndex((e) => CORRECTION_TYPES.has(e.type));
  return firstCorrection !== -1 && list.slice(firstCorrection + 1).some((e) => APPROVAL_TYPES.has(e.type));
}
