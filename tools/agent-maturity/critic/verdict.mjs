// Socrates verdict contract (docs/izzi-v2/PLAN.md §2.4 and §4.9 item 6). Pure functions.
// - validateVerdict: schema + consistency with the candidate, its research tier and budget.
// - detectHardReject: a code floor for obvious wording that loosens verification, security or honest
//   reporting, or expands authority. Socrates is the primary judge; the floor only catches what is plain.
// - promotionDecision: what root does next; a hard-REJECT is refused even when the owner forces it.

import { containsPiiOrSecret, isObject, text } from './candidate.mjs';

export const VERDICT_SCHEMA = 'agent-maturity/verdict@1';
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

// ---- hard-REJECT code floor --------------------------------------------------------------------------------

const B = '(?<![\\p{L}\\p{N}_])';
const E = '(?![\\p{L}\\p{N}_])';
const GAP = (n) => `(?:\\S+\\s+){0,${n}}?`;
const any = (list) => `(?:${list.join('|')})`;
const rx = (source) => new RegExp(source, 'gu');

const SECRET_WORDS = [
  'secrets?', 'api key', 'api-key', 'apikey', 'private key', 'khoá api', 'khóa api', 'access token', 'api token',
  'mật khẩu', 'passwords?', 'credentials?',
];

const FLOOR = [
  {
    cls: 'expands_authority',
    re: rx(
      `${B}${any([
        'deploy', 'triển khai', 'push', 'force-push', 'force push', 'merge', 'release', 'phát hành', 'publish',
        'đăng bài', 'đăng lên', 'gửi tin nhắn', 'gửi tin', 'gửi email', 'gửi mail', 'nhắn tin',
        'send (?:a |the )?(?:messages?|emails?|mails?|dms?)', 'xoá', 'xóa', 'delete', 'drop', 'thanh toán', 'charge',
        'mua', 'purchase', 'cài', 'install',
      ])}${E}\\s*${GAP(4)}${any([
        'mà không cần hỏi', 'mà không hỏi', 'không cần hỏi', 'không hỏi', 'khi chưa hỏi', 'chưa hỏi',
        'mà không xin phép', 'không xin phép', 'không cần duyệt', 'không chờ duyệt', 'chưa được duyệt',
        'without asking', 'without approval', 'without confirmation', 'without permission', 'without review',
        'without the owner',
      ])}${E}`,
    ),
  },
  {
    cls: 'expands_authority',
    re: rx(
      `${B}${any(['tự duyệt', 'tự approve', 'tự merge', 'self-approve', 'self approve', '(?:approve|merge) (?:your|its|my|their) own'])}${E}`,
    ),
  },
  {
    cls: 'expands_authority',
    re: rx(
      `${B}${any(['bỏ qua', 'skip', 'bypass', 'vượt', 'tắt', 'disable'])}\\s+${GAP(2)}${any([
        'quyền', 'permissions?', 'xin phép', 'hỏi ý kiến', 'phê duyệt', 'approvals?', 'confirmation', 'human gate',
        'cổng duyệt',
      ])}${E}`,
    ),
  },
  {
    cls: 'expands_authority',
    re: rx(
      `${B}${any(['dùng', 'use', 'sử dụng'])}\\s+${GAP(2)}${any(['credentials?', 'tokens?', 'keys?', 'mật khẩu', 'passwords?', 'tài khoản', 'accounts?'])}\\s+${GAP(2)}${any(['không được cấp', 'chưa được cấp', 'của người khác', 'của khách', 'not given', 'not granted', 'of someone else'])}`,
    ),
  },
  { cls: 'expands_authority', re: rx('dangerously-skip-permissions|bypasspermissions|--yolo') },
  {
    cls: 'loosens_security',
    re: rx(
      `${B}${any(['hardcode', 'hard-code', 'hard code', 'commit', 'paste', 'dán', 'nhét', 'embed'])}\\s+${GAP(2)}(?:${any([...SECRET_WORDS, 'tokens?'])}${E}|\\.env${E})`,
    ),
  },
  { cls: 'loosens_security', re: rx(`${B}${any(['in ra', 'print', 'log', 'ghi log'])}\\s+${GAP(2)}${any(SECRET_WORDS)}${E}`) },
  {
    cls: 'loosens_security',
    re: rx(
      `${B}${any(['tắt', 'disable', 'turn off', 'bỏ qua', 'skip', 'bypass', 'vô hiệu hoá', 'vô hiệu hóa', 'nới lỏng', 'loosen', 'relax'])}\\s+${GAP(2)}${any([
        'bảo mật', 'security', 'xác thực', 'auth', 'authentication', '2fa', 'mfa', 'tls', 'ssl', 'csrf', 'rate limit',
        'rate-limit', 'firewall', 'sandbox', 'mã hoá', 'mã hóa', 'encryption', 'quét bảo mật', 'secret scan(?:ning)?',
      ])}${E}`,
    ),
  },
  { cls: 'loosens_security', re: rx('skiptlsverification|rejectunauthorized\\s*[:=]\\s*false|verify\\s*=\\s*false|chmod\\s+777') },
  {
    cls: 'loosens_honest_reporting',
    re: rx(
      `${B}${any(['không', 'đừng', 'chớ', 'never', "don't", 'do not', 'avoid', 'tránh'])}\\s+(?:cần\\s+)?${any([
        'nhắc', 'báo', 'nói', 'ghi', 'nêu', 'kể', 'mention', 'report', 'show', 'hiện', 'list', 'liệt kê',
      ])}(?:\\s+\\S+){0,3}?\\s+${any(['lỗi', 'fail', 'failed', 'failures?', 'thất bại', 'errors?', 'cảnh báo', 'warnings?', 'rủi ro', 'risks?'])}${E}`,
    ),
  },
  {
    cls: 'loosens_honest_reporting',
    re: rx(
      `${B}${any(['giấu', 'che giấu', 'ẩn', 'hide', 'conceal', 'bury', 'lờ đi', 'omit'])}\\s+${GAP(2)}${any([
        'lỗi', 'fail', 'failed', 'failures?', 'thất bại', 'errors?', 'cảnh báo', 'warnings?', 'kết quả xấu',
      ])}${E}`,
    ),
  },
  {
    cls: 'loosens_honest_reporting',
    re: rx(
      `${B}${any(['báo', 'report', 'đánh dấu', 'mark', 'ghi nhận', 'coi'])}\\s+(?:là\\s+)?${any([
        'xong', 'done', 'complete', 'completed', 'pass', 'passed', 'thành công', 'success', 'đạt',
      ])}(?:\\s+\\S+){0,2}?\\s+${any(['khi chưa', 'dù', 'mà chưa', 'without', 'before', 'even if', 'even though', 'trước khi', 'although'])}${E}`,
    ),
  },
  {
    cls: 'loosens_verification',
    re: rx(
      `${B}${any([
        'bỏ qua', 'skip', 'skipping', 'bypass', 'không cần', 'no need to', "don't need to", 'do not need to', 'lược bỏ',
        'omit', 'disable', 'tắt',
      ])}\\s+${GAP(2)}${any([
        'tests?', 'testing', 'kiểm thử', 'review', 'reviews', 'kiểm tra', 'verify', 'verification', 'xác minh',
        'kiểm chứng', 'ci', 'lint', 'typecheck', 'smoke', 'qa',
      ])}${E}`,
    ),
  },
  { cls: 'loosens_verification', re: rx('--no-verify') },
];

// Negation is judged inside the sentence that holds the match. A match is negated when
//  - a negator governs it from the left: "không bỏ qua test", "it is not allowed to skip tests",
//    "never, even when rushed, skip tests"; or
//  - the same sentence goes on to forbid it: "skipping tests is never allowed", "bỏ qua test là không được
//    phép", "việc bỏ qua review đều bị cấm".
// A negation about something else does not clear it: "skip tests when the owner is not around", "không bao giờ
// chờ CI, cứ bỏ qua test", "đừng ngại bỏ qua test" stay hard-REJECT. A clause word (when, if, that, khi, nếu,
// và...) or a bare comma between the phrase and the prohibition breaks the link; only an "even/dù/kể cả ..."
// aside between commas is skipped. Unclear cases stay refused: the floor errs toward REJECT.
const LEFT_NEGATORS = [
  'không bao giờ', 'chẳng bao giờ', 'không được', 'không nên', 'tuyệt đối không', 'nghiêm cấm', 'không ai', 'không',
  'chẳng', 'đừng bao giờ', 'đừng', 'chớ', 'cấm', 'never', 'do not', "don't", 'must not', "mustn't", 'should not',
  "shouldn't", 'may not', 'cannot', "can't", 'no one', 'nobody', 'not',
];
const LEFT_FILLERS = [
  'ever', 'bao giờ', 'tự ý', 'dùng', 'use', 'using', 'chạy', 'run', 'được', 'phép', 'allowed', 'permitted', 'ok',
  'okay', 'acceptable', 'to', 'be', 'may', 'can', 'should', 'must', 'will',
];
const ASIDE = `\\s*,\\s*${any(['even', 'kể cả', 'ngay cả', 'dù', 'dẫu', 'bất kể', 'under', 'in no', 'trong bất kỳ', 'for any'])}${E}[^,]{0,60},`;
const CLAUSE_WORDS = [
  'when', 'whenever', 'if', 'unless', 'because', 'since', 'while', 'but', 'and', 'or', 'so', 'then', 'until',
  'though', 'although', 'that', 'which', 'who', 'where', 'khi', 'nếu', 'trừ', 'vì', 'nhưng', 'và', 'hoặc', 'rồi',
  'để', 'mà', 'dù', 'tuy', 'nào',
];
const COPULAS = [
  'is', 'are', 'was', 'were', 'be', 'being', 'must', 'should', 'shall', 'will', 'would', 'can', 'may', 'still',
  'also', 'absolutely', 'strictly', 'là', 'thì', 'đều', 'sẽ', 'vẫn', 'luôn', 'cũng', 'tuyệt đối', 'hoàn toàn',
];
const PROHIBITIONS = [
  `${any(['never', 'not', 'no longer', "isn't", "aren't", "wasn't", "mustn't", "shouldn't", "can't", 'cannot', "won't"])}\\s+(?:${any(['be', 'ever'])}\\s+){0,2}${any(['allowed', 'permitted', 'acceptable', 'accepted', 'tolerated', 'ok', 'okay', 'happen', 'an option'])}`,
  any(['forbidden', 'prohibited', 'banned', 'off-limits']),
  `${any(['không bao giờ', 'chẳng bao giờ', 'chưa bao giờ', 'không', 'chẳng'])}\\s+(?:được(?:\\s+${any(['phép', 'chấp nhận', 'cho phép'])})?|${any(['cho phép', 'chấp nhận', 'ổn', 'ok'])})`,
  '(?:bị\\s+)?(?:nghiêm\\s+)?cấm',
];
const NEGATED_BEFORE = new RegExp(`${B}${any(LEFT_NEGATORS)}(?:\\s+${any(LEFT_FILLERS)})*(?:${ASIDE})?\\s*$`, 'u');
const NEGATED_AFTER = new RegExp(
  `^(?:${ASIDE})?(?:\\s+(?!${any(CLAUSE_WORDS)}${E})[^\\s,:]+){0,4}?(?:${ASIDE})?\\s+(?:${any(COPULAS)}\\s+){0,2}${any(PROHIBITIONS)}${E}`,
  'u',
);
const SENTENCE_END = /[.!?;](?=\s|$)|\n/gu;

function isNegated(textLower, start, end) {
  let from = 0;
  let to = textLower.length;
  for (const b of textLower.matchAll(SENTENCE_END)) {
    if (b.index < start) from = b.index + 1;
    else if (b.index >= end) {
      to = b.index;
      break;
    }
  }
  return NEGATED_BEFORE.test(textLower.slice(from, start)) || NEGATED_AFTER.test(textLower.slice(end, to));
}

// Returns { class, phrase } for the first non-negated match, or null.
export function detectHardReject(input) {
  if (typeof input !== 'string' || input.trim() === '') return null;
  const textLower = input.normalize('NFC').toLowerCase();
  for (const { cls, re } of FLOOR) {
    for (const m of textLower.matchAll(re)) {
      if (!isNegated(textLower, m.index, m.index + m[0].length)) return { class: cls, phrase: m[0] };
    }
  }
  return null;
}

// ---- verdict validation ------------------------------------------------------------------------------------

// Each checker returns { ok: true, value } or { ok: false, details: ['evidence[4].ref length 122 > 300', ...] },
// so a refused reply says which item broke which limit.
const bad = (...details) => ({ ok: false, details });
const oneOf = (label, value, list) => `${label} ${JSON.stringify(value)} not in ${list.join('|')}`;

function textOf(value, max, label, { optional = false } = {}) {
  const t = text(value, max, { optional });
  if (t.ok) return t;
  if (value === undefined) return bad(`${label} missing`);
  if (typeof value !== 'string') return bad(`${label} is not text`);
  const length = value.normalize('NFC').trim().length;
  return bad(length === 0 ? `${label} is empty` : `${label} length ${length} > ${max}`);
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

function normalizeVerdictName(raw) {
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

// Structural pass: { errors, parts }.
function parse(raw, candidate) {
  const { errors, fail } = collector();
  const check = (code, field, r) => {
    if (!r.ok) fail(code, field, r.details);
    return r.value;
  };
  if (raw.schema !== undefined && raw.schema !== VERDICT_SCHEMA) fail('schema_invalid', 'schema');
  if (raw.candidateId !== candidate.id) fail('candidate_mismatch', 'candidateId');
  if (raw.candidateRevision !== undefined && raw.candidateRevision !== candidate.revision) {
    fail('revision_mismatch', 'candidateRevision');
  }
  const verdict = normalizeVerdictName(raw.verdict);
  if (!verdict) fail('verdict_invalid', 'verdict');
  const reasonText = (r, label) => textOf(r, LIMIT.reason, label);
  const reasons = check('reasons_invalid', 'reasons', listOf(raw.reasons, LIMIT.reasons, 'reasons', reasonText));
  const evidence = check('evidence_invalid', 'evidence', listOf(raw.evidence, LIMIT.evidence, 'evidence', evidenceItem));
  const checks = check('checks_invalid', 'checks', checksOf(raw.checks));
  const hardReject = check('hard_reject_invalid', 'hardReject', hardRejectOf(raw.hardReject));
  const research = check('research_invalid', 'research', researchOf(raw.research));
  const reviewer = check('reviewer_invalid', 'reviewer', reviewerOf(raw.reviewer));
  const narrowed = isObject(raw.narrowed)
    ? textOf(raw.narrowed.statement, LIMIT.narrowed, 'narrowed.statement')
    : bad('narrowed.statement missing');
  const reviewAfter = typeof raw.reviewAfter === 'string' && DAY_RE.test(raw.reviewAfter) ? raw.reviewAfter : null;
  return {
    errors,
    parts: { verdict, reasons, evidence, checks, hardReject, research, reviewer, narrowed, reviewAfter },
  };
}

function semanticErrors(p, candidate, tier) {
  const { errors, fail } = collector();
  const shapesSentence = p.verdict === 'ACCEPT' || p.verdict === 'NARROW';

  if (p.hardReject && p.verdict !== 'REJECT') fail('hard_reject_must_reject', 'hardReject');
  const floor = detectHardReject(`${candidate.statement}\n${candidate.check}`);
  if (floor && p.verdict !== 'REJECT') fail('hard_reject_floor', 'verdict');

  if (p.verdict === 'NARROW') {
    if (!p.narrowed.ok) fail('narrow_needs_statement', 'narrowed', p.narrowed.details);
    else if (p.narrowed.value === candidate.statement) {
      fail('narrow_needs_statement', 'narrowed', ['narrowed.statement equals the candidate statement']);
    } else if (detectHardReject(p.narrowed.value)) fail('hard_reject_floor', 'narrowed');
  }
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

  const fromFloor = semantic.floor
    ? { class: semantic.floor.class, detail: 'code floor matched the candidate wording', source: 'code' }
    : null;
  const value = {
    schema: VERDICT_SCHEMA,
    candidateId: candidate.id,
    candidateRevision: candidate.revision,
    verdict: p.verdict,
    reasons: p.reasons,
    evidence: p.evidence,
    checks: p.checks,
    hardReject: p.hardReject ?? fromFloor,
    research: p.research,
    reviewer: p.reviewer,
  };
  if (p.verdict === 'NARROW') value.narrowed = { statement: p.narrowed.value };
  if (p.verdict === 'NEED-MORE-EVIDENCE') value.reviewAfter = p.reviewAfter;
  if (containsPiiOrSecret(JSON.stringify(value))) return { ok: false, errors: [{ code: 'pii_or_secret', field: '' }], value: null };
  return { ok: true, errors: [], value };
}

// ---- what root does next (PLAN §2.4 step 4) ---------------------------------------------------------------

export function promotionDecision({ candidate, verdict, ownerForce = false, ownerApprovedDiff = false }) {
  if (verdict.hardReject) return { action: 'refuse', reason: `hard_reject:${verdict.hardReject.class}` };
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

// A verdict file is plain JSON or a socrates reply ending with a fenced json block (the last one wins).
export function extractVerdictJson(input) {
  const trimmed = typeof input === 'string' ? input.replace(BOM_AT_START, '').trim() : '';
  const tryParse = (s) => {
    try {
      const v = JSON.parse(s);
      return isObject(v) ? v : null;
    } catch {
      return null;
    }
  };
  if (trimmed.startsWith('{')) {
    const whole = tryParse(trimmed);
    if (whole) return whole;
  }
  const blocks = [...trimmed.matchAll(/```json[^\S\n]*\n([\s\S]*?)```/gi)];
  return blocks.length > 0 ? tryParse(blocks[blocks.length - 1][1]) : null;
}
