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
const LIMIT = { reasons: 5, reason: 400, evidence: 10, ref: 120, note: 300, detail: 300, refs: 10, model: 80 };

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

// A match counts as negated only when a negation sits right before it ("không bỏ qua test", "never deploy
// without asking"). A negation further away ("đừng ngại bỏ qua test") does not clear it.
const NEGATED_PREFIX = new RegExp(
  `${B}${any([
    'không bao giờ', 'không được', 'không nên', 'tuyệt đối không', 'không', 'đừng bao giờ', 'đừng', 'chớ', 'cấm',
    'never', 'do not', "don't", 'must not', "mustn't", 'should not', "shouldn't", 'not',
  ])}(?:\\s+${any(['ever', 'bao giờ', 'tự ý', 'dùng', 'use', 'using', 'chạy', 'run'])})*\\s*$`,
  'u',
);

// Returns { class, phrase } for the first non-negated match, or null.
export function detectHardReject(input) {
  if (typeof input !== 'string' || input.trim() === '') return null;
  const textLower = input.normalize('NFC').toLowerCase();
  for (const { cls, re } of FLOOR) {
    for (const m of textLower.matchAll(re)) {
      if (!NEGATED_PREFIX.test(textLower.slice(0, m.index))) return { class: cls, phrase: m[0] };
    }
  }
  return null;
}

// ---- verdict validation ------------------------------------------------------------------------------------

function listOf(raw, max, mapItem) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > max) return null;
  const items = raw.map(mapItem);
  return items.every((x) => x !== null) ? items : null;
}

function evidenceItem(raw) {
  if (!isObject(raw)) return null;
  const ref = text(raw.ref, LIMIT.ref);
  const note = text(raw.note, LIMIT.note, { optional: true });
  if (!ref.ok || !note.ok || !EVIDENCE_KINDS.includes(raw.kind) || !FINDINGS.includes(raw.finding)) return null;
  const item = { ref: ref.value, kind: raw.kind, finding: raw.finding };
  if (note.value !== undefined) item.note = note.value;
  return item;
}

function checksOf(raw) {
  if (!isObject(raw) || !CHECK_KEYS.every((k) => typeof raw[k] === 'boolean')) return null;
  return Object.fromEntries(CHECK_KEYS.map((k) => [k, raw[k]]));
}

function hardRejectOf(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const detail = text(raw.detail, LIMIT.detail, { optional: true });
  if (!isObject(raw) || !HARD_REJECT_CLASSES.includes(raw.class) || !detail.ok) return { ok: false };
  return { ok: true, value: { class: raw.class, detail: detail.value ?? '', source: 'critic' } };
}

function researchOf(raw) {
  if (!isObject(raw) || !(raw.tier in TIER_RANK)) return null;
  const refs = raw.refs === undefined ? [] : raw.refs;
  if (!Array.isArray(refs) || refs.length > LIMIT.refs) return null;
  const items = refs.map((r) => text(r, 300));
  if (!items.every((r) => r.ok)) return null;
  const deepRuns = raw.deepRuns === undefined ? 0 : raw.deepRuns;
  if (!Number.isInteger(deepRuns) || deepRuns < 0 || deepRuns > 5) return null;
  return { tier: raw.tier, refs: items.map((r) => r.value), deepRuns };
}

function reviewerOf(raw) {
  if (!isObject(raw) || raw.agent !== 'socrates') return null;
  const model = text(raw.model, LIMIT.model, { optional: true });
  if (!model.ok) return null;
  return model.value === undefined ? { agent: 'socrates' } : { agent: 'socrates', model: model.value };
}

function normalizeVerdictName(raw) {
  if (typeof raw !== 'string') return null;
  const upper = raw.trim().toUpperCase();
  const name = ALIASES[upper] ?? upper;
  return VERDICTS.includes(name) ? name : null;
}

// Structural pass: { errors, parts }.
function parse(raw, candidate) {
  const errors = [];
  const fail = (code, field) => errors.push({ code, field });
  if (raw.schema !== undefined && raw.schema !== VERDICT_SCHEMA) fail('schema_invalid', 'schema');
  if (raw.candidateId !== candidate.id) fail('candidate_mismatch', 'candidateId');
  if (raw.candidateRevision !== undefined && raw.candidateRevision !== candidate.revision) {
    fail('revision_mismatch', 'candidateRevision');
  }
  const verdict = normalizeVerdictName(raw.verdict);
  if (!verdict) fail('verdict_invalid', 'verdict');
  const reasons = listOf(raw.reasons, LIMIT.reasons, (r) => {
    const t = text(r, LIMIT.reason);
    return t.ok ? t.value : null;
  });
  if (!reasons) fail('reasons_invalid', 'reasons');
  const evidence = listOf(raw.evidence, LIMIT.evidence, evidenceItem);
  if (!evidence) fail('evidence_invalid', 'evidence');
  const checks = checksOf(raw.checks);
  if (!checks) fail('checks_invalid', 'checks');
  const hardReject = hardRejectOf(raw.hardReject);
  if (!hardReject.ok) fail('hard_reject_invalid', 'hardReject');
  const research = researchOf(raw.research);
  if (!research) fail('research_invalid', 'research');
  const reviewer = reviewerOf(raw.reviewer);
  if (!reviewer) fail('reviewer_invalid', 'reviewer');
  const narrowed = isObject(raw.narrowed) ? text(raw.narrowed.statement, 200) : { ok: false };
  const reviewAfter = typeof raw.reviewAfter === 'string' && DAY_RE.test(raw.reviewAfter) ? raw.reviewAfter : null;
  return {
    errors,
    parts: { verdict, reasons, evidence, checks, hardReject: hardReject.value, research, reviewer, narrowed, reviewAfter },
  };
}

function semanticErrors(p, candidate, tier) {
  const errors = [];
  const fail = (code, field) => errors.push({ code, field });
  const shapesSentence = p.verdict === 'ACCEPT' || p.verdict === 'NARROW';

  if (p.hardReject && p.verdict !== 'REJECT') fail('hard_reject_must_reject', 'hardReject');
  const floor = detectHardReject(`${candidate.statement}\n${candidate.check}`);
  if (floor && p.verdict !== 'REJECT') fail('hard_reject_floor', 'verdict');

  if (p.verdict === 'NARROW') {
    if (!p.narrowed.ok || p.narrowed.value === candidate.statement) fail('narrow_needs_statement', 'narrowed');
    else if (detectHardReject(p.narrowed.value)) fail('hard_reject_floor', 'narrowed');
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
  if (r.refs.length > tier.budget.maxSources || r.deepRuns > tier.budget.maxDeepRuns) fail('research_over_budget', 'research');
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
