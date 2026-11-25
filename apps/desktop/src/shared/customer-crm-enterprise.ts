/**
 * Enterprise CRM intelligence & workflow engine (pure TypeScript, runtime-agnostic).
 *
 * Runs identically in Renderer (Chromium) and Main (Node) without `node:crypto` or network I/O:
 * - A1: `[izzi-ctx: v=1; ...]` codec inside `profile.note` (100% compatible with `POST /crm/profile` <= 1000 chars)
 * - A2: 5-Layer Customer Portrait reasoning chain (`buildCustomerPortrait`) + `effectiveCrmIdentity`
 * - A3: Saler Playbook, Ads Audience Segmentation & SHA-256 Meta CSV export, and Lifecycle / Remarketing planner
 * - B1: Zero-PII CRM segment aggregation (`summarizeCareCrmSegments`) for `MyGraph → Memory doanh nghiệp`
 */

import {
  CUSTOMER_CARE_CRM_ADDRESS_FORMS,
  CUSTOMER_CARE_CRM_AGE_BANDS,
  CUSTOMER_CARE_CRM_BUDGET_BANDS,
  CUSTOMER_CARE_CRM_CONSENT_STATES,
  CUSTOMER_CARE_CRM_ID_KINDS,
  CUSTOMER_CARE_CRM_ID_SOURCES,
  CUSTOMER_CARE_CRM_ID_STATUSES,
  CUSTOMER_CARE_CRM_OCCASIONS,
  CUSTOMER_CARE_CRM_PERSONAS,
  CUSTOMER_CARE_CRM_RECIPIENTS,
  CUSTOMER_CARE_CRM_STAGES,
  CUSTOMER_CARE_CRM_TIMELINES,
  type CustomerCareCrmAddressForm,
  type CustomerCareCrmAgeBand,
  type CustomerCareCrmBudgetBand,
  type CustomerCareCrmConsent,
  type CustomerCareCrmConsentState,
  type CustomerCareCrmEvidence,
  type CustomerCareCrmIdConfidence,
  type CustomerCareCrmIdField,
  type CustomerCareCrmIdentity,
  type CustomerCareCrmOccasion,
  type CustomerCareCrmPersona,
  type CustomerCareCrmRecipient,
  type CustomerCareCrmRow,
  type CustomerCareCrmSharedLink,
  type CustomerCareCrmStage,
  type CustomerCareCrmTimeline,
} from './customer-care-types';

// ---------------------------------------------------------------------------
// Shared constants & option labels for UI chips / pickers
// ---------------------------------------------------------------------------

export const CARE_CRM_MAX_NOTE = 1_000;
export const CARE_CRM_MAX_AD_TITLE = 48;
export const CARE_CRM_MAX_SHARED_DOMAIN = 80;
export const CARE_CRM_MAX_QUOTE = 80;
export const CARE_CRM_MAX_NEXT_STEP = 200;

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MESSENGER_SAFE_WINDOW_MS = 23 * HOUR_MS;
const CONSULTING_STALE_MS = 48 * HOUR_MS;

export interface CrmEnterpriseProduct {
  id: string;
  label: string;
}

export interface CrmStaffContext {
  persona: CustomerCareCrmPersona | null;
  ageBand: CustomerCareCrmAgeBand | null;
  recipient: CustomerCareCrmRecipient | null;
  timeline: CustomerCareCrmTimeline | null;
  budgetBand: CustomerCareCrmBudgetBand | null;
  consent: CustomerCareCrmConsentState | null;
  adTitle: string | null;
  sharedDomain: string | null;
}

export const EMPTY_CRM_STAFF_CONTEXT: Readonly<CrmStaffContext> = {
  persona: null,
  ageBand: null,
  recipient: null,
  timeline: null,
  budgetBand: null,
  consent: null,
  adTitle: null,
  sharedDomain: null,
};

export const CRM_PERSONA_OPTIONS: ReadonlyArray<{
  value: CustomerCareCrmPersona;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    value: 'P1',
    label: 'P1 · Gia chủ nhà mới / Sắm chính',
    shortLabel: 'Gia chủ nhà mới',
    description: 'Nhập trạch, chung cư/nhà phố mới hoặc thay mới không gian thờ tự chính.',
  },
  {
    value: 'P2',
    label: 'P2 · Gia đình truyền thống / Lễ Tết & Hiếu kính',
    shortLabel: 'Truyền thống & Lễ Tết',
    description: 'Sắm dịp Tết, giỗ chạp, từ đường hoặc mua biếu bố mẹ trang nghiêm.',
  },
  {
    value: 'P3',
    label: 'P3 · Khách mua Quà biếu / Tri ân',
    shortLabel: 'Quà biếu & Tri ân',
    description: 'Tặng tân gia, đối tác, người thân; cần đóng gói hộp quà và giao đúng hẹn.',
  },
  {
    value: 'P4',
    label: 'P4 · Khách khảo giá / Cân nhắc ngân sách',
    shortLabel: 'Khảo giá & Ngân sách',
    description: 'Đang tham khảo mức giá, so sánh chất liệu hoặc ngân sách tiết kiệm.',
  },
];

export const CRM_AGE_BAND_OPTIONS: ReadonlyArray<{ value: CustomerCareCrmAgeBand; label: string }> = [
  { value: '18-24', label: '18–24 tuổi' },
  { value: '25-34', label: '25–34 tuổi' },
  { value: '35-44', label: '35–44 tuổi' },
  { value: '45-54', label: '45–54 tuổi' },
  { value: '55+', label: '55+ tuổi' },
];

export const CRM_RECIPIENT_OPTIONS: ReadonlyArray<{ value: CustomerCareCrmRecipient; label: string }> = [
  { value: 'self', label: 'Mua cá nhân' },
  { value: 'spouse', label: 'Mua cùng vợ/chồng' },
  { value: 'parents', label: 'Mua biếu bố mẹ' },
  { value: 'children', label: 'Mua cho con' },
  { value: 'household', label: 'Sắm cho gia đình' },
  { value: 'gift', label: 'Mua làm quà biếu' },
];

export const CRM_TIMELINE_OPTIONS: ReadonlyArray<{ value: CustomerCareCrmTimeline; label: string }> = [
  { value: 'this_week', label: 'Trong tuần này' },
  { value: 'this_month', label: 'Trong tháng này' },
  { value: 'before_tet', label: 'Trước Tết' },
  { value: 'later', label: 'Chưa gấp' },
];

export const CRM_BUDGET_BAND_OPTIONS: ReadonlyArray<{ value: CustomerCareCrmBudgetBand; label: string }> = [
  { value: 'under_5m', label: 'Dưới 5 triệu' },
  { value: '5m_15m', label: '5–15 triệu' },
  { value: '15m_30m', label: '15–30 triệu' },
  { value: '30m_plus', label: 'Trên 30 triệu' },
];

export const CRM_CONSENT_OPTIONS: ReadonlyArray<{ value: CustomerCareCrmConsentState; label: string }> = [
  { value: 'unknown', label: 'Chưa hỏi' },
  { value: 'asked', label: 'Đã hỏi' },
  { value: 'granted', label: 'Đồng ý nhận tin' },
  { value: 'declined', label: 'Từ chối' },
  { value: 'withdrawn', label: 'Rút lại đồng ý' },
];

const OCCASION_LABELS: Readonly<Record<CustomerCareCrmOccasion, string>> = {
  new_home: 'Nhà mới / Nhập trạch',
  tet: 'Dịp Tết',
  anniversary: 'Giỗ, kỷ niệm',
  gift: 'Làm quà biếu',
  replacement: 'Thay đồ cũ',
  other: 'Dịp khác',
};

const BUDGET_LABELS: Readonly<Record<CustomerCareCrmBudgetBand, string>> = {
  under_5m: 'Dưới 5 triệu',
  '5m_15m': '5–15 triệu',
  '15m_30m': '15–30 triệu',
  '30m_plus': 'Trên 30 triệu',
};

const TIMELINE_LABELS: Readonly<Record<CustomerCareCrmTimeline, string>> = {
  this_week: 'Trong tuần này',
  this_month: 'Trong tháng này',
  before_tet: 'Trước Tết',
  later: 'Chưa gấp',
};

const PERSONA_SHORT_LABELS: Readonly<Record<CustomerCareCrmPersona, string>> = {
  P1: 'Gia chủ nhà mới / Sắm chính',
  P2: 'Gia đình truyền thống / Lễ Tết & Hiếu kính',
  P3: 'Khách mua Quà biếu / Tri ân',
  P4: 'Khách khảo giá / Cân nhắc ngân sách',
};

// ---------------------------------------------------------------------------
// Text safety & sanitization helpers (mirrors prod rc-58d8ea0 / care-crm.ts)
// ---------------------------------------------------------------------------

const UNSAFE_NOTE_CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;
const UNSAFE_INLINE_CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const FORMAT_EXCEPT_ZWJ = /(?!\u200D)\p{Cf}/gu;
const LINE_SEPARATORS = /[\u2028\u2029]/g;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const PHONE_RUN = /\+?\p{Nd}(?:[\s._/,-]{0,3}\p{Nd}){6,}/gu;
const PHONE_MASK = '•••';
const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const CTX_LINE_PATTERN = /^\[izzi-ctx:\s*([^\]]*)\]$/i;
const CTX_ANY_LINE_PATTERN = /^\s*\[izzi-ctx:(?:[^\]]*\]\s*$|$)/i;
const MAX_EXTRACT_URL_LENGTH = 2_048;

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function codePointLength(text: string): number {
  return Array.from(text).length;
}

function sliceCodePoints(text: string, max: number): string {
  if (max <= 0) return '';
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  let sliced = chars.slice(0, max);
  while (sliced.length > 0 && sliced[sliced.length - 1] === '\u200D') {
    sliced = sliced.slice(0, -1);
  }
  return sliced.join('').trimEnd();
}

function stripCtxLines(text: string): string {
  return text
    .split('\n')
    .filter((line) => !CTX_ANY_LINE_PATTERN.test(line.trim()))
    .join('\n');
}

function cleanMultilineNote(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(LINE_SEPARATORS, '\n')
    .replace(/\t/g, ' ')
    .replace(FORMAT_EXCEPT_ZWJ, '')
    .replace(UNSAFE_NOTE_CONTROL, ' ')
    .replace(LONE_SURROGATE, '')
    .trim();
}

function cleanSingleLine(raw: string, max: number): string {
  const cleaned = raw
    .normalize('NFC')
    .replace(FORMAT_EXCEPT_ZWJ, '')
    .replace(UNSAFE_INLINE_CONTROL, ' ')
    .replace(LONE_SURROGATE, '')
    .replace(/\s+/g, ' ')
    .trim();
  return sliceCodePoints(cleaned, max);
}

export function maskCrmPhones(raw: string): string {
  return raw.normalize('NFKC').replace(PHONE_RUN, PHONE_MASK);
}

function safeQuote(raw: string | null | undefined, max = CARE_CRM_MAX_QUOTE): string | null {
  if (typeof raw !== 'string') return null;
  if (containsSensitiveHouseholdTerm(raw)) return null;
  const masked = cleanSingleLine(maskCrmPhones(raw), max);
  if (masked === '' || masked === PHONE_MASK || containsSensitiveHouseholdTerm(masked)) return null;
  return masked;
}

export function sanitizeCtxAdTitle(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const withoutDelims = maskCrmPhones(raw).replace(/[;\]\r\n\t]+/g, ' ');
  const cleaned = cleanSingleLine(withoutDelims, CARE_CRM_MAX_AD_TITLE);
  return cleaned !== '' ? cleaned : null;
}

export function sanitizeCtxDomain(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length > 256) return null;
  const candidate = raw
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  if (candidate.length === 0 || candidate.length > CARE_CRM_MAX_SHARED_DOMAIN) return null;
  if (PHONE_RUN.test(candidate) || /\d{7,}/.test(candidate.replace(/[\s._/,-]/g, ''))) return null;
  return DOMAIN_PATTERN.test(candidate) ? candidate : null;
}

export function sanitizeStaffContext(ctx: Partial<CrmStaffContext> | null | undefined): CrmStaffContext {
  if (!ctx || typeof ctx !== 'object') return { ...EMPTY_CRM_STAFF_CONTEXT };
  return {
    persona: oneOf(CUSTOMER_CARE_CRM_PERSONAS, ctx.persona) ? ctx.persona : null,
    ageBand: oneOf(CUSTOMER_CARE_CRM_AGE_BANDS, ctx.ageBand) ? ctx.ageBand : null,
    recipient: oneOf(CUSTOMER_CARE_CRM_RECIPIENTS, ctx.recipient) ? ctx.recipient : null,
    timeline: oneOf(CUSTOMER_CARE_CRM_TIMELINES, ctx.timeline) ? ctx.timeline : null,
    budgetBand: oneOf(CUSTOMER_CARE_CRM_BUDGET_BANDS, ctx.budgetBand) ? ctx.budgetBand : null,
    consent: oneOf(CUSTOMER_CARE_CRM_CONSENT_STATES, ctx.consent) ? ctx.consent : null,
    adTitle: sanitizeCtxAdTitle(ctx.adTitle),
    sharedDomain: sanitizeCtxDomain(ctx.sharedDomain),
  };
}

// ---------------------------------------------------------------------------
// A1. `[izzi-ctx]` Codec on `profile.note`
// ---------------------------------------------------------------------------

function parseStaffContextTagBody(body: string): CrmStaffContext {
  const draft: Partial<CrmStaffContext> = {};
  const entries = body.split(';').map((part) => part.trim()).filter(Boolean);
  for (const entry of entries) {
    const eqIndex = entry.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = entry.slice(0, eqIndex).trim().toLowerCase();
    const rawValue = entry.slice(eqIndex + 1).trim();
    if (!rawValue) continue;
    switch (key) {
      case 'v':
        if (rawValue !== '1') return { ...EMPTY_CRM_STAFF_CONTEXT };
        break;
      case 'persona':
        if (oneOf(CUSTOMER_CARE_CRM_PERSONAS, rawValue)) draft.persona = rawValue;
        break;
      case 'age':
        if (oneOf(CUSTOMER_CARE_CRM_AGE_BANDS, rawValue)) draft.ageBand = rawValue;
        break;
      case 'recipient':
        if (oneOf(CUSTOMER_CARE_CRM_RECIPIENTS, rawValue)) draft.recipient = rawValue;
        break;
      case 'timeline':
        if (oneOf(CUSTOMER_CARE_CRM_TIMELINES, rawValue)) draft.timeline = rawValue;
        break;
      case 'budget':
        if (oneOf(CUSTOMER_CARE_CRM_BUDGET_BANDS, rawValue)) draft.budgetBand = rawValue;
        break;
      case 'consent':
        if (oneOf(CUSTOMER_CARE_CRM_CONSENT_STATES, rawValue)) draft.consent = rawValue;
        break;
      case 'ad': {
        const cleanAd = sanitizeCtxAdTitle(rawValue);
        if (cleanAd) draft.adTitle = cleanAd;
        break;
      }
      case 'domain': {
        const cleanDomain = sanitizeCtxDomain(rawValue);
        if (cleanDomain) draft.sharedDomain = cleanDomain;
        break;
      }
      default:
        break;
    }
  }
  return sanitizeStaffContext(draft);
}

export function formatStaffContextTag(rawCtx: CrmStaffContext): string | null {
  const ctx = sanitizeStaffContext(rawCtx);
  const parts: string[] = [];
  if (ctx.persona !== null) parts.push(`persona=${ctx.persona}`);
  if (ctx.ageBand !== null) parts.push(`age=${ctx.ageBand}`);
  if (ctx.recipient !== null) parts.push(`recipient=${ctx.recipient}`);
  if (ctx.timeline !== null) parts.push(`timeline=${ctx.timeline}`);
  if (ctx.budgetBand !== null) parts.push(`budget=${ctx.budgetBand}`);
  if (ctx.consent !== null) parts.push(`consent=${ctx.consent}`);
  if (ctx.adTitle !== null) parts.push(`ad=${ctx.adTitle}`);
  if (ctx.sharedDomain !== null) parts.push(`domain=${ctx.sharedDomain}`);
  if (parts.length === 0) return null;
  return `[izzi-ctx: v=1; ${parts.join('; ')}]`;
}

/**
 * Splits `profile.note` into clean staff-visible `freeNote` (with all `[izzi-ctx: ...]` lines removed anywhere)
 * and validated `ctx` from the last `[izzi-ctx: ...]` tag line.
 */
export function splitCrmNote(note: string | null): { freeNote: string; ctx: CrmStaffContext } {
  if (note === null || typeof note !== 'string') {
    return { freeNote: '', ctx: { ...EMPTY_CRM_STAFF_CONTEXT } };
  }
  const normalized = cleanMultilineNote(note);
  if (normalized === '') {
    return { freeNote: '', ctx: { ...EMPTY_CRM_STAFF_CONTEXT } };
  }
  const lines = normalized.split('\n');
  let ctx: CrmStaffContext = { ...EMPTY_CRM_STAFF_CONTEXT };
  const keptLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = CTX_LINE_PATTERN.exec(trimmed);
    if (match) {
      ctx = parseStaffContextTagBody(match[1] ?? '');
      continue;
    }
    if (CTX_ANY_LINE_PATTERN.test(trimmed)) {
      continue;
    }
    keptLines.push(line);
  }

  const freeNote = keptLines.join('\n').trim();
  return { freeNote, ctx };
}

/**
 * Maximum code points remaining for `freeNote` given the current `ctx` so `composeCrmNote` stays `<= 1000`.
 */
export function maxFreeNoteLength(ctx: CrmStaffContext): number {
  const tag = formatStaffContextTag(ctx);
  if (tag === null) return CARE_CRM_MAX_NOTE;
  return Math.max(0, CARE_CRM_MAX_NOTE - 1 - codePointLength(tag));
}

/**
 * True when `freeNote` exceeds the safe budget left by `nextCtx`, allowing the UI to warn instead of truncating.
 */
export function wouldTruncateFreeNote(freeNote: string, nextCtx: CrmStaffContext): boolean {
  const cleanFree = splitCrmNote(freeNote).freeNote;
  if (cleanFree === '') return false;
  return codePointLength(cleanFree) > maxFreeNoteLength(nextCtx);
}

/**
 * Composes `freeNote` + `[izzi-ctx: v=1; ...]` safely within 1000 code points and server character rules.
 */
export function composeCrmNote(freeNote: string, ctx: CrmStaffContext): string | null {
  const strippedFree = splitCrmNote(freeNote).freeNote;
  const tag = formatStaffContextTag(ctx);
  if (strippedFree === '' && tag === null) return null;
  if (tag === null) {
    const cleanOnly = stripCtxLines(sliceCodePoints(strippedFree, CARE_CRM_MAX_NOTE)).trim();
    return cleanOnly !== '' ? cleanOnly : null;
  }
  if (strippedFree === '') return tag;
  const maxFree = maxFreeNoteLength(ctx);
  const safeFree = stripCtxLines(sliceCodePoints(strippedFree, maxFree)).trim();
  return safeFree !== '' ? `${safeFree}\n${tag}` : tag;
}

/** Stateless `<textarea>` reader: strips `[izzi-ctx: ...]` lines while keeping the user's live spaces/newlines. */
export function extractEditableFreeNote(note: string | null): string {
  if (note === null || typeof note !== 'string') return '';
  const normalized = note.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const kept = lines.filter((line) => !CTX_LINE_PATTERN.test(line.trim()) && !CTX_ANY_LINE_PATTERN.test(line.trim()));
  return kept.join('\n');
}

/** Stateless `<textarea>` writer: updates free text without losing `[izzi-ctx: ...]` or trimming live typing spaces. */
export function replaceEditableFreeNote(note: string | null, nextFreeNote: string): string | null {
  const { ctx } = splitCrmNote(note);
  const tag = formatStaffContextTag(ctx);
  const cleanedDraft = nextFreeNote
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(LINE_SEPARATORS, '\n')
    .replace(/\t/g, ' ')
    .replace(FORMAT_EXCEPT_ZWJ, '')
    .replace(UNSAFE_NOTE_CONTROL, ' ')
    .replace(LONE_SURROGATE, '');
  const withoutTags = stripCtxLines(cleanedDraft);
  if (tag === null) {
    const sliced = stripCtxLines(sliceCodePoints(withoutTags, CARE_CRM_MAX_NOTE));
    return sliced.trim() === '' ? null : sliced;
  }
  const maxFree = maxFreeNoteLength(ctx);
  const sliced = stripCtxLines(sliceCodePoints(withoutTags, maxFree));
  return sliced.trim() === '' ? tag : `${sliced}\n${tag}`;
}

// ---------------------------------------------------------------------------
// Sensitive Denylist (bereavement, severe illness, divorce, personal religion)
// ---------------------------------------------------------------------------

// Note: Matches standalone Vietnamese words/phrases; NEVER matches product names
// such as "bàn thờ", "bàn thờ Phật", "tranh Quan Âm", "lư hương", "ngũ sự".
const SENSITIVE_HOUSEHOLD_TERMS = [
  // Tang chế
  'mất',
  'qua đời',
  'đám tang',
  'tang lễ',
  '49 ngày',
  '100 ngày',
  'mộ',
  'mồ mả',
  'bốc mộ',
  // Bệnh tật
  'ung thư',
  'tai biến',
  'bệnh viện',
  'ốm nặng',
  'nằm viện',
  // Ly hôn
  'ly hôn',
  'ly dị',
  'đơn thân',
  // Tôn giáo cá nhân
  'theo đạo',
  'công giáo',
  'phật tử',
  'hầu đồng',
  'đi lễ chùa',
] as const;

const SENSITIVE_HOUSEHOLD_REGEX = new RegExp(
  `(?:^|[^\\p{L}\\p{N}])(?:${SENSITIVE_HOUSEHOLD_TERMS.map((t) => t.replace(/\s+/g, '\\s+')).join('|')})(?=$|[^\\p{L}\\p{N}])`,
  'iu',
);

export function containsSensitiveHouseholdTerm(text: string): boolean {
  return SENSITIVE_HOUSEHOLD_REGEX.test(text.normalize('NFC'));
}

interface TextSegment {
  text: string;
  origin: 'chat' | 'note';
}

function splitIntoClauses(raw: string): string[] {
  // Split on line breaks or sentence-ending punctuation followed by whitespace/end, never inside URLs (?u=, shopee.vn), money or phones.
  return raw
    .normalize('NFC')
    .split(/(?:\r?\n|[.!?]+(?=\s+|$))+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitSentences(row: CustomerCareCrmRow, freeNote: string): TextSegment[] {
  const segments: TextSegment[] = [];
  for (const msg of row.recentMessages) {
    for (const part of splitIntoClauses(msg.text)) {
      segments.push({ text: part, origin: 'chat' });
    }
  }
  if (freeNote) {
    for (const part of splitIntoClauses(freeNote)) {
      segments.push({ text: part, origin: 'note' });
    }
  }
  return segments;
}

// ---------------------------------------------------------------------------
// A2. 5-Layer Customer Portrait (`buildCustomerPortrait`) & `effectiveCrmIdentity`
// ---------------------------------------------------------------------------

export type CrmReasoningSource = 'staff' | 'identity' | 'chat' | 'note' | 'name' | 'none';

export interface CrmPortraitLayerBase {
  step: 1 | 2 | 3 | 4 | 5;
  title: string;
  label: string;
  confidence: CustomerCareCrmIdConfidence | null;
  source: CrmReasoningSource;
  quote: string | null;
  reasoning: string;
}

export interface CrmPortraitLayer1Age extends CrmPortraitLayerBase {
  step: 1;
  ageBands: CustomerCareCrmAgeBand[];
  ageBand: CustomerCareCrmAgeBand | null;
  exactAge: number | null;
}

export interface CrmPortraitLayer2Demographic extends CrmPortraitLayerBase {
  step: 2;
  addressForm: CustomerCareCrmAddressForm | null;
  inferredGender: 'male' | 'female' | 'unknown';
  salutation: string;
}

export interface CrmPortraitLayer3Household extends CrmPortraitLayerBase {
  step: 3;
  recipient: CustomerCareCrmRecipient | null;
  sensitiveFiltered: boolean;
}

export interface CrmPortraitLayer4Interests extends CrmPortraitLayerBase {
  step: 4;
  sharedLinks: CustomerCareCrmSharedLink[];
  adTitle: string | null;
  matchedProducts: CrmEnterpriseProduct[];
  topicKeywords: string[];
  budgetBand: CustomerCareCrmBudgetBand | null;
  budgetLabel: string | null;
  timeline: CustomerCareCrmTimeline | null;
  timelineLabel: string | null;
  neededBy: string | null;
  occasion: CustomerCareCrmOccasion | null;
  occasionLabel: string | null;
}

export interface CrmPortraitLayer5Persona extends CrmPortraitLayerBase {
  step: 5;
  persona: CustomerCareCrmPersona | null;
  completenessPct: number;
  filledDimensions: number;
  missingDimensions: string[];
  summary: string;
  missingPrompts: string[];
}

export interface CrmCustomerPortrait {
  layer_1_age: CrmPortraitLayer1Age;
  layer_2_demographic: CrmPortraitLayer2Demographic;
  layer_3_household: CrmPortraitLayer3Household;
  layer_4_interests: CrmPortraitLayer4Interests;
  layer_5_persona: CrmPortraitLayer5Persona;
  completenessPct: number;
  summary: string;
  missingPrompts: string[];
}

function isShownField<T>(field: CustomerCareCrmIdField<T> | null | undefined): field is CustomerCareCrmIdField<T> {
  if (!field || typeof field !== 'object') return false;
  return (field.confidence === 'high' || field.confidence === 'medium')
    && oneOf(CUSTOMER_CARE_CRM_ID_KINDS, field.kind)
    && oneOf(CUSTOMER_CARE_CRM_ID_SOURCES, field.source)
    && oneOf(CUSTOMER_CARE_CRM_ID_STATUSES, field.status);
}

function firstFieldQuote(field: CustomerCareCrmIdField<unknown> | null | undefined): string | null {
  if (!field || !Array.isArray(field.evidence)) return null;
  for (const ev of field.evidence) {
    if (ev && typeof ev.quote === 'string') {
      const cleaned = safeQuote(ev.quote);
      if (cleaned) return cleaned;
    }
  }
  return null;
}

function ageToBand(age: number): CustomerCareCrmAgeBand {
  if (age <= 24) return '18-24';
  if (age <= 34) return '25-34';
  if (age <= 44) return '35-44';
  if (age <= 54) return '45-54';
  return '55+';
}

function formatAgeBandsLabel(bands: readonly CustomerCareCrmAgeBand[], exactAge: number | null = null): string {
  if (bands.length === 0) return 'Chưa rõ độ tuổi';
  const first = bands[0]!;
  const last = bands[bands.length - 1]!;
  const rangeText = bands.length === 1
    ? (first === '55+' ? '55+ tuổi' : `${first.replace('-', '–')} tuổi`)
    : (last === '55+' ? `${first.split('-')[0]}+ tuổi` : `${first.split('-')[0]}–${last.split('-')[1]} tuổi`);
  return exactAge !== null ? `${exactAge} tuổi · Nhóm ${rangeText}` : `${rangeText} (ước tính)`;
}

function vietnamYear(nowMs: number): number {
  return new Date(nowMs + VIETNAM_OFFSET_MS).getUTCFullYear();
}

function vietnamDateKey(ms: number): string {
  return new Date(ms + VIETNAM_OFFSET_MS).toISOString().slice(0, 10);
}

function inferLayer1Age(
  row: CustomerCareCrmRow,
  ctx: CrmStaffContext,
  segments: readonly TextSegment[],
  nowMs: number,
): CrmPortraitLayer1Age {
  const idAge = row.identity?.ageBand;
  if (isShownField(idAge) && Array.isArray(idAge.value)) {
    const valid = idAge.value.filter((b): b is CustomerCareCrmAgeBand => oneOf(CUSTOMER_CARE_CRM_AGE_BANDS, b)).slice(0, 2);
    if (valid.length > 0) {
      return {
        step: 1,
        title: 'Tầng 1 · Độ tuổi ước tính',
        ageBands: valid,
        ageBand: valid[0]!,
        exactAge: null,
        label: formatAgeBandsLabel(valid),
        confidence: idAge.confidence,
        source: idAge.source === 'staff' ? 'staff' : 'identity',
        quote: firstFieldQuote(idAge),
        reasoning: idAge.source === 'staff' ? 'Nhân viên đã xác nhận nhóm tuổi.' : 'Tổng hợp từ hồ sơ định danh khách hàng.',
      };
    }
  }

  if (ctx.ageBand !== null) {
    return {
      step: 1,
      title: 'Tầng 1 · Độ tuổi ước tính',
      ageBands: [ctx.ageBand],
      ageBand: ctx.ageBand,
      exactAge: null,
      label: formatAgeBandsLabel([ctx.ageBand]),
      confidence: 'high',
      source: 'staff',
      quote: null,
      reasoning: 'Nhân viên gắn thẻ nhóm tuổi trong ngữ cảnh hồ sơ.',
    };
  }

  const currentYear = vietnamYear(nowMs);
  for (const seg of segments) {
    // Birth year: "sn 1988", "sinh năm 1985"
    const birthMatch = /(?:^|[^\p{L}\p{N}])(?:sinh\s+năm|sn)\s*(19[3-9]\d|200\d)(?=$|[^\p{L}\p{N}])/iu.exec(seg.text);
    if (birthMatch) {
      const birthYear = Number(birthMatch[1]);
      const age = currentYear - birthYear;
      if (age >= 18 && age <= 95) {
        const band = ageToBand(age);
        return {
          step: 1,
          title: 'Tầng 1 · Độ tuổi ước tính',
          ageBands: [band],
          ageBand: band,
          exactAge: age,
          label: formatAgeBandsLabel([band], age),
          confidence: 'high',
          source: seg.origin,
          quote: safeQuote(seg.text),
          reasoning: `Khách nêu năm sinh ${birthYear} (~${age} tuổi).`,
        };
      }
    }

    // Explicit age: "38 tuổi", "năm nay 42 tuổi" (ignoring child references right before the number)
    const ageIter = /(?:^|[^\p{L}\p{N}])(\d{2})\s*tuổi(?=$|[^\p{L}\p{N}])/giu;
    let ageMatch: RegExpExecArray | null;
    while ((ageMatch = ageIter.exec(seg.text)) !== null) {
      const prefix = seg.text.slice(Math.max(0, ageMatch.index - 20), ageMatch.index);
      if (/(?:bé|con|con\s+trai|con\s+gái|cháu\s+nhỏ)\s*$/iu.test(prefix)) continue;
      const age = Number(ageMatch[1]);
      if (age >= 18 && age <= 95) {
        const band = ageToBand(age);
        return {
          step: 1,
          title: 'Tầng 1 · Độ tuổi ước tính',
          ageBands: [band],
          ageBand: band,
          exactAge: age,
          label: formatAgeBandsLabel([band], age),
          confidence: 'high',
          source: seg.origin,
          quote: safeQuote(seg.text),
          reasoning: `Khách tự nêu độ tuổi (${age} tuổi).`,
        };
      }
    }
  }

  // Contextual & pronoun signals
  if (row.profile.addressForm === 'co' || row.profile.addressForm === 'chu') {
    return {
      step: 1,
      title: 'Tầng 1 · Độ tuổi ước tính',
      ageBands: ['55+'],
      ageBand: '55+',
      exactAge: null,
      label: formatAgeBandsLabel(['55+']),
      confidence: 'medium',
      source: 'staff',
      quote: null,
      reasoning: `Hồ sơ xưng hô "${row.profile.addressForm === 'co' ? 'Cô' : 'Chú'}" gợi ý nhóm tuổi trung niên/cao niên.`,
    };
  }

  for (const seg of segments) {
    if (/(?:^|[^\p{L}])(?:cô\s+(?:mua|muốn|đặt|tìm|hỏi|cần)|chú\s+(?:mua|muốn|đặt|tìm|hỏi|cần)|bác\s+(?:mua|muốn|tìm|hỏi)|nhà\s+(?:cô|chú|bác)|cho\s+(?:cô|chú|bác)\s+(?:hỏi|xem)|cháu\s+nội|cháu\s+ngoại|về\s+hưu)(?=$|[^\p{L}])/iu.test(seg.text)) {
      return {
        step: 1,
        title: 'Tầng 1 · Độ tuổi ước tính',
        ageBands: ['55+'],
        ageBand: '55+',
        exactAge: null,
        label: formatAgeBandsLabel(['55+']),
        confidence: 'medium',
        source: seg.origin,
        quote: safeQuote(seg.text),
        reasoning: 'Tín hiệu xưng hô cô/chú/bác hoặc nhắc tới cháu nội/ngoại.',
      };
    }
  }

  for (const seg of segments) {
    if (/(?:từ\s+đường|nhà\s+thờ\s+họ|trưởng\s+họ)/iu.test(seg.text)) {
      return {
        step: 1,
        title: 'Tầng 1 · Độ tuổi ước tính',
        ageBands: ['45-54'],
        ageBand: '45-54',
        exactAge: null,
        label: formatAgeBandsLabel(['45-54']),
        confidence: 'medium',
        source: seg.origin,
        quote: safeQuote(seg.text),
        reasoning: 'Quan tâm hạng mục từ đường / nhà thờ họ (thường nhóm 45–54 tuổi).',
      };
    }
    if (/(?:mua\s+cho\s+bố\s+mẹ|biếu\s+bố\s+mẹ|cho\s+ba\s+má|biếu\s+ba\s+má)/iu.test(seg.text)) {
      return {
        step: 1,
        title: 'Tầng 1 · Độ tuổi ước tính',
        ageBands: ['35-44', '45-54'],
        ageBand: '35-44',
        exactAge: null,
        label: formatAgeBandsLabel(['35-44', '45-54']),
        confidence: 'medium',
        source: seg.origin,
        quote: safeQuote(seg.text),
        reasoning: 'Khách sắm sửa/biếu bố mẹ, phổ biến ở nhóm 35–54 tuổi đã ổn định tài chính.',
      };
    }
  }

  const hasAdultAddress = row.profile.addressForm === 'anh'
    || row.profile.addressForm === 'chi'
    || segments.some((s) => /(?:^|[^\p{L}])(?:anh|chị)(?=$|[^\p{L}])/iu.test(s.text));

  for (const seg of segments) {
    if (hasAdultAddress && /(?:nhập\s+trạch|lỗ\s+ban|kích\s+thước\s+lỗ\s+ban|nhà\s+mới|nhà\s+phố|biệt\s+thự)/iu.test(seg.text)) {
      return {
        step: 1,
        title: 'Tầng 1 · Độ tuổi ước tính',
        ageBands: ['35-44'],
        ageBand: '35-44',
        exactAge: null,
        label: formatAgeBandsLabel(['35-44']),
        confidence: 'medium',
        source: seg.origin,
        quote: safeQuote(seg.text),
        reasoning: 'Xưng anh/chị kèm nhu cầu nhập trạch / đo thước Lỗ Ban nhà mới.',
      };
    }
  }

  for (const seg of segments) {
    if (/(?:vợ\s+chồng\s+em|hai\s+vợ\s+chồng|2\s+vợ\s+chồng|chung\s+cư|căn\s+hộ|mới\s+cưới|ra\s+ở\s+riêng)/iu.test(seg.text)) {
      return {
        step: 1,
        title: 'Tầng 1 · Độ tuổi ước tính',
        ageBands: ['25-34'],
        ageBand: '25-34',
        exactAge: null,
        label: formatAgeBandsLabel(['25-34']),
        confidence: 'medium',
        source: seg.origin,
        quote: safeQuote(seg.text),
        reasoning: 'Ngữ cảnh vợ chồng trẻ / căn hộ chung cư / mới cưới.',
      };
    }
  }

  for (const seg of segments) {
    if (
      seg.origin === 'chat'
      && (
        /(?:^|[^\p{L}])(?:cháu\s+(?:hỏi|muốn|mua|tìm)|con\s+(?:hỏi|muốn|mua|tìm))(?=$|[^\p{L}])/iu.test(seg.text)
        || /(?:^|[^\p{L}])(?:ko|dc|đc|bnhiu|ib\s+mk|mik)(?=$|[^\p{L}])/iu.test(seg.text)
      )
    ) {
      return {
        step: 1,
        title: 'Tầng 1 · Độ tuổi ước tính',
        ageBands: ['18-24'],
        ageBand: '18-24',
        exactAge: null,
        label: formatAgeBandsLabel(['18-24']),
        confidence: 'medium',
        source: 'chat',
        quote: safeQuote(seg.text),
        reasoning: 'Xưng cháu/con hoặc dùng cách viết tắt trẻ trung trong tin nhắn.',
      };
    }
  }

  return {
    step: 1,
    title: 'Tầng 1 · Độ tuổi ước tính',
    ageBands: [],
    ageBand: null,
    exactAge: null,
    label: 'Chưa rõ độ tuổi',
    confidence: null,
    source: 'none',
    quote: null,
    reasoning: 'Chưa có thông tin tuổi hoặc tín hiệu ngữ cảnh rõ ràng.',
  };
}

// Vietnamese demographic name dictionaries
const VN_SURNAMES = new Set([
  'nguyễn', 'trần', 'lê', 'phạm', 'hoàng', 'huỳnh', 'phan', 'vũ', 'võ', 'đặng',
  'bùi', 'đỗ', 'hồ', 'ngô', 'dương', 'lý', 'đinh', 'đoàn', 'lương', 'trương', 'trịnh',
]);

const VN_MALE_MIDDLE = new Set(['văn', 'đức', 'mạnh', 'quốc', 'đình', 'bá', 'trọng', 'công', 'hữu']);
const VN_FEMALE_MIDDLE = new Set(['thị', 'diệu', 'mỹ', 'thục', 'đoan']);

const VN_MALE_GIVEN = new Set([
  'văn', 'đức', 'hùng', 'tuấn', 'mạnh', 'nghĩa', 'quốc', 'sơn', 'tùng', 'hưng',
  'long', 'dũng', 'cường', 'thắng', 'đạt', 'kiên', 'phong', 'nam', 'hải', 'hiếu',
  'huy', 'khải', 'khôi', 'lâm', 'lộc', 'quân', 'quang', 'tài', 'thịnh', 'tiến',
  'toàn', 'trung', 'trường', 'việt', 'vinh', 'vương', 'bách', 'khang', 'phát', 'thành',
]);

const VN_FEMALE_GIVEN = new Set([
  'thị', 'hương', 'lan', 'thảo', 'trang', 'huyền', 'phương', 'ngọc', 'thu', 'mai',
  'hoa', 'yến', 'nhung', 'hạnh', 'hiền', 'nga', 'oanh', 'quỳnh', 'thúy', 'thủy',
  'trâm', 'trinh', 'tuyết', 'vân', 'vy', 'xuân', 'ánh', 'bích', 'chi', 'diệp',
  'đào', 'hằng', 'huệ', 'kiều', 'liên', 'ly', 'my', 'ngân', 'nhi', 'phượng', 'thơ', 'thư', 'uyên',
]);

const VN_UNISEX_GIVEN = new Set(['anh', 'bình', 'châu', 'giang', 'hà', 'khánh', 'minh', 'nhân', 'an', 'linh', 'tâm', 'thanh']);

const BUSINESS_NAME_NOISE = /(?:shop|store|công\s*ty|cty|tnhh|doanh\s*nghiệp|nội\s*thất|đồ\s*thờ|phong\s*thủy|official|fanpage|admin|khách\s*hàng|facebook)/iu;

function addressFormToMeta(
  form: CustomerCareCrmAddressForm,
  isSuggestion: boolean,
): { inferredGender: 'male' | 'female' | 'unknown'; salutation: string; label: string } {
  const verb = isSuggestion ? 'Gợi ý' : 'Xưng';
  switch (form) {
    case 'anh':
      return { inferredGender: 'male', salutation: 'Anh', label: `Nam · ${verb} Anh` };
    case 'chu':
      return { inferredGender: 'male', salutation: 'Chú', label: `Nam · ${verb} Chú` };
    case 'chi':
      return { inferredGender: 'female', salutation: 'Chị', label: `Nữ · ${verb} Chị` };
    case 'co':
      return { inferredGender: 'female', salutation: 'Cô', label: `Nữ · ${verb} Cô` };
    case 'ban':
      return { inferredGender: 'unknown', salutation: 'Bạn', label: `Chưa xác định · ${verb} Bạn` };
  }
}

function inferGenderFromVietnameseName(rawName: string | null): 'male' | 'female' | null {
  if (!rawName) return null;
  const cleaned = rawName.normalize('NFC').trim();
  if (cleaned === '' || PHONE_RUN.test(cleaned) || BUSINESS_NAME_NOISE.test(cleaned)) return null;
  const tokens = (cleaned.match(/\p{L}+/gu) ?? []).map((t) => t.toLowerCase());
  if (tokens.length === 0 || tokens.length > 6) return null;

  if (tokens.length === 1) {
    const single = tokens[0]!;
    if (VN_UNISEX_GIVEN.has(single) || VN_SURNAMES.has(single)) return null;
    if (VN_MALE_GIVEN.has(single)) return 'male';
    if (VN_FEMALE_GIVEN.has(single)) return 'female';
    return null;
  }

  // Handle "Tuấn Nguyễn" (Given + Surname) vs standard "Nguyễn Văn Tuấn" (Surname + Middle + Given)
  const lastIsSurname = VN_SURNAMES.has(tokens[tokens.length - 1]!) && !VN_SURNAMES.has(tokens[0]!);
  const given = lastIsSurname ? tokens[0]! : tokens[tokens.length - 1]!;
  const middles = lastIsSurname ? tokens.slice(1, -1) : tokens.slice(1, -1);

  if (middles.some((m) => VN_FEMALE_MIDDLE.has(m))) return 'female';
  if (middles.some((m) => VN_MALE_MIDDLE.has(m))) return 'male';

  if (VN_UNISEX_GIVEN.has(given)) return null;
  if (VN_FEMALE_GIVEN.has(given)) return 'female';
  if (VN_MALE_GIVEN.has(given)) return 'male';

  // Two-word name like "Văn Minh" or "Thu Hà" where first token is middle name
  if (tokens.length === 2 && !lastIsSurname) {
    const first = tokens[0]!;
    if (VN_FEMALE_MIDDLE.has(first) || (VN_FEMALE_GIVEN.has(first) && !VN_SURNAMES.has(first))) return 'female';
    if (VN_MALE_MIDDLE.has(first) || (VN_MALE_GIVEN.has(first) && !VN_SURNAMES.has(first))) return 'male';
  }
  return null;
}

function inferLayer2Demographic(
  row: CustomerCareCrmRow,
  layer1: CrmPortraitLayer1Age,
): CrmPortraitLayer2Demographic {
  if (row.profile.addressForm !== null) {
    const meta = addressFormToMeta(row.profile.addressForm, false);
    return {
      step: 2,
      title: 'Tầng 2 · Giới tính & Xưng hô',
      addressForm: row.profile.addressForm,
      ...meta,
      confidence: 'high',
      source: 'staff',
      quote: null,
      reasoning: 'Nhân viên đã chọn cách xưng hô chính thức trên hồ sơ.',
    };
  }

  const idForm = row.identity?.addressForm;
  if (isShownField(idForm) && oneOf(CUSTOMER_CARE_CRM_ADDRESS_FORMS, idForm.value)) {
    const meta = addressFormToMeta(idForm.value, idForm.status === 'suggested');
    return {
      step: 2,
      title: 'Tầng 2 · Giới tính & Xưng hô',
      addressForm: idForm.value,
      ...meta,
      confidence: idForm.confidence,
      source: idForm.source === 'staff' ? 'staff' : 'identity',
      quote: firstFieldQuote(idForm),
      reasoning: 'Tổng hợp từ trường xưng hô của hồ sơ định danh.',
    };
  }

  // Self-reference in customer chat messages
  for (const msg of row.recentMessages) {
    const text = msg.text.normalize('NFC');
    const matchForm = (pattern: RegExp, form: CustomerCareCrmAddressForm): CrmPortraitLayer2Demographic | null => {
      if (!pattern.test(text)) return null;
      const meta = addressFormToMeta(form, false);
      return {
        step: 2,
        title: 'Tầng 2 · Giới tính & Xưng hô',
        addressForm: form,
        ...meta,
        confidence: 'high',
        source: 'chat',
        quote: safeQuote(text),
        reasoning: `Khách tự xưng "${meta.salutation}" trực tiếp trong tin nhắn.`,
      };
    };

    const hit = matchForm(/(?:^|[^\p{L}])(?:cô\s+(?:mua|muốn|đặt|tìm|hỏi|cần|xem|đang|ở|sn|sinh\s+năm|năm\s+nay)|cho\s+cô\s+(?:hỏi|xem)|báo\s+giá\s+cho\s+cô|nhà\s+cô)(?=$|[^\p{L}])/iu, 'co')
      ?? matchForm(/(?:^|[^\p{L}])(?:chú\s+(?:mua|muốn|đặt|tìm|hỏi|cần|xem|đang|ở|sn|sinh\s+năm|năm\s+nay)|cho\s+chú\s+(?:hỏi|xem)|báo\s+giá\s+cho\s+chú|nhà\s+chú)(?=$|[^\p{L}])/iu, 'chu')
      ?? matchForm(/(?:^|[^\p{L}])(?:anh\s+(?:mua|muốn|đặt|tìm|hỏi|cần|xem|lấy|đang|ở|sn|sinh\s+năm|năm\s+nay|nhắn|chốt)|cho\s+anh\s+(?:hỏi|xem)|tư\s+vấn\s+cho\s+anh|báo\s+giá\s+cho\s+anh|gửi\s+anh|số\s+anh|zalo\s+anh|vợ\s+chồng\s+anh|bà\s+xã|vợ\s+anh)(?=$|[^\p{L}])/iu, 'anh')
      ?? matchForm(/(?:^|[^\p{L}])(?:chị\s+(?:mua|muốn|đặt|tìm|hỏi|cần|xem|lấy|đang|ở|sn|sinh\s+năm|năm\s+nay|nhắn|chốt)|cho\s+chị\s+(?:hỏi|xem)|tư\s+vấn\s+cho\s+chị|báo\s+giá\s+cho\s+chị|gửi\s+chị|số\s+chị|zalo\s+chị|vợ\s+chồng\s+chị|ông\s+xã|chồng\s+chị|chồng\s+em)(?=$|[^\p{L}])/iu, 'chi');
    if (hit) return hit;
  }

  // Vietnamese name dictionary heuristic
  const nameGender = inferGenderFromVietnameseName(row.customerName);
  if (nameGender !== null) {
    const senior = layer1.ageBand === '55+';
    const form: CustomerCareCrmAddressForm = nameGender === 'male'
      ? (senior ? 'chu' : 'anh')
      : (senior ? 'co' : 'chi');
    const meta = addressFormToMeta(form, true);
    return {
      step: 2,
      title: 'Tầng 2 · Giới tính & Xưng hô',
      addressForm: form,
      ...meta,
      confidence: 'medium',
      source: 'name',
      quote: null,
      reasoning: `Phân tích tên hiển thị tiếng Việt để gợi ý xưng hô ${meta.salutation}.`,
    };
  }

  return {
    step: 2,
    title: 'Tầng 2 · Giới tính & Xưng hô',
    addressForm: null,
    inferredGender: 'unknown',
    salutation: 'Anh/Chị',
    label: 'Chưa xác định · Tạm xưng Anh/Chị',
    confidence: null,
    source: 'none',
    quote: null,
    reasoning: 'Chưa có xưng hô tự nêu và tên hiển thị trung tính/chưa đủ căn cứ.',
  };
}

const STAFF_RECIPIENT_LABELS: Readonly<Record<CustomerCareCrmRecipient, string>> = {
  spouse: 'Đã lập gia đình · Mua cùng vợ/chồng',
  parents: 'Gia đình đa thế hệ · Mua biếu bố mẹ',
  children: 'Đã lập gia đình · Mua cho con',
  household: 'Đã lập gia đình · Sắm cho gia đình',
  self: 'Mua cá nhân',
  gift: 'Mua làm quà biếu',
};

function inferLayer3Household(
  row: CustomerCareCrmRow,
  ctx: CrmStaffContext,
  allSegments: readonly TextSegment[],
): CrmPortraitLayer3Household {
  const sensitiveFiltered = allSegments.some((seg) => containsSensitiveHouseholdTerm(seg.text));
  const cleanSegments = allSegments.filter((seg) => !containsSensitiveHouseholdTerm(seg.text));

  if (ctx.recipient !== null) {
    return {
      step: 3,
      title: 'Tầng 3 · Tình trạng hôn nhân & Gia đình',
      recipient: ctx.recipient,
      label: STAFF_RECIPIENT_LABELS[ctx.recipient],
      confidence: 'high',
      source: 'staff',
      quote: null,
      sensitiveFiltered,
      reasoning: 'Nhân viên đã xác nhận đối tượng thụ hưởng trên hồ sơ.',
    };
  }

  const idFamily = row.identity?.family;
  if (isShownField(idFamily) && idFamily.value && oneOf(CUSTOMER_CARE_CRM_RECIPIENTS, idFamily.value.recipient)) {
    const rawQuote = firstFieldQuote(idFamily);
    if (rawQuote && !containsSensitiveHouseholdTerm(rawQuote)) {
      return {
        step: 3,
        title: 'Tầng 3 · Tình trạng hôn nhân & Gia đình',
        recipient: idFamily.value.recipient,
        label: STAFF_RECIPIENT_LABELS[idFamily.value.recipient],
        confidence: idFamily.confidence,
        source: idFamily.source === 'staff' ? 'staff' : 'identity',
        quote: rawQuote,
        sensitiveFiltered,
        reasoning: 'Trích xuất từ thông tin đối tượng mua hàng đã xác thực.',
      };
    }
  }

  for (const seg of cleanSegments) {
    const matchRule = (
      pattern: RegExp,
      recipient: CustomerCareCrmRecipient,
      label: string,
      reason: string,
    ): CrmPortraitLayer3Household | null => {
      if (!pattern.test(seg.text)) return null;
      return {
        step: 3,
        title: 'Tầng 3 · Tình trạng hôn nhân & Gia đình',
        recipient,
        label,
        confidence: seg.origin === 'chat' ? 'high' : 'medium',
        source: seg.origin,
        quote: safeQuote(seg.text),
        sensitiveFiltered,
        reasoning: reason,
      };
    };

    const hit = matchRule(
      /(?:hai\s+vợ\s+chồng|2\s+vợ\s+chồng|vợ\s+chồng\s+(?:em|anh|chị|mình)|bà\s+xã|ông\s+xã|hỏi\s+ý\s+kiến\s+(?:vợ|chồng)|bàn\s+với\s+(?:vợ|chồng)|mới\s+cưới)/iu,
      'spouse',
      'Đã lập gia đình · Vợ chồng',
      'Khách nhắc tới vợ/chồng cùng tham gia quyết định mua sắm.',
    )
      ?? matchRule(
        /(?:biếu\s+bố\s+mẹ|mua\s+cho\s+bố\s+mẹ|cho\s+bố\s+mẹ|cho\s+ba\s+má|biếu\s+ba\s+má|ông\s+bà|nhà\s+bố\s+mẹ)/iu,
        'parents',
        'Gia đình · Mua cho bố mẹ',
        'Khách nêu nhu cầu mua sắm / biếu tặng bố mẹ, ông bà.',
      )
      ?? matchRule(
        /(?:cho\s+con\s+trai|cho\s+con\s+gái|vợ\s+chồng\s+con|cho\s+con\s+ra\s+riêng|mua\s+cho\s+con)/iu,
        'children',
        'Đã có con',
        'Khách mua sắm cho con cái.',
      )
      ?? matchRule(
        /(?:làm\s+quà\s+biếu|quà\s+tân\s+gia|tặng\s+tân\s+gia|biếu\s+sếp|mua\s+tặng|quà\s+tặng)/iu,
        'gift',
        'Mua làm quà biếu',
        'Khách mua sản phẩm để làm quà tặng / biếu.',
      )
      ?? matchRule(
        /(?:gia\s+đình\s+mình|nhà\s+(?:anh|chị|em|mình)|cả\s+nhà|từ\s+đường|nhà\s+thờ\s+họ)/iu,
        'household',
        'Gia đình riêng',
        'Khách mua sắm cho không gian sinh hoạt/thờ tự của gia đình.',
      );

    if (hit) return hit;
  }

  return {
    step: 3,
    title: 'Tầng 3 · Tình trạng hôn nhân & Gia đình',
    recipient: null,
    label: 'Chưa rõ thông tin gia đình',
    confidence: null,
    source: 'none',
    quote: null,
    sensitiveFiltered,
    reasoning: sensitiveFiltered
      ? 'Đã lọc bỏ câu chứa thông tin nhạy cảm riêng tư theo quy tắc an toàn.'
      : 'Khách chưa đề cập người thụ hưởng hoặc bối cảnh gia đình.',
  };
}

// URL extraction without network calls
const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]}]+/gi;
const FB_CONTENT_PATH = /\/(?:posts|videos|reel|reels|share|permalink)\b|\/(?:permalink|story|watch)\.php\b/i;

export function extractSafeSharedLink(rawUrl: string): CustomerCareCrmSharedLink | null {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > MAX_EXTRACT_URL_LENGTH) {
    return null;
  }
  const trimmed = rawUrl.trim().replace(/[.,;:!?)]+$/, '');
  if (trimmed.length === 0 || trimmed.length > MAX_EXTRACT_URL_LENGTH) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  let host = parsed.hostname.toLowerCase().replace(/^(?:www|m|web|touch)\./, '');
  if ((host === 'l.facebook.com' || host === 'lm.facebook.com') && parsed.pathname.startsWith('/l.php')) {
    const inner = parsed.searchParams.get('u');
    if (!inner || inner.length > MAX_EXTRACT_URL_LENGTH) return null;
    let unwrapped: URL;
    try {
      unwrapped = new URL(inner);
    } catch {
      return null;
    }
    if (unwrapped.protocol !== 'http:' && unwrapped.protocol !== 'https:') {
      return null;
    }
    parsed = unwrapped;
    host = parsed.hostname.toLowerCase().replace(/^(?:www|m|web|touch)\./, '');
  }

  const domain = sanitizeCtxDomain(host);
  if (!domain) return null;

  if (domain === 'facebook.com' || domain.endsWith('.facebook.com')) {
    // Personal Facebook profile `facebook.com/<username>` or `profile.php` => keep ONLY `facebook.com`, title = null
    if (!FB_CONTENT_PATH.test(parsed.pathname)) {
      return { domain: 'facebook.com', title: null };
    }
    const lowerPath = parsed.pathname.toLowerCase();
    let title = 'Nội dung chia sẻ Facebook';
    if (lowerPath.includes('/reel')) title = 'Reels Facebook';
    else if (lowerPath.includes('/video') || lowerPath.includes('/watch')) title = 'Video Facebook';
    else if (lowerPath.includes('/post')) title = 'Bài viết Facebook';
    return { domain: 'facebook.com', title };
  }

  if (domain === 'fb.watch') {
    return { domain: 'facebook.com', title: 'Video Facebook' };
  }

  return { domain, title: null };
}

function parseVietnameseBudget(text: string): CustomerCareCrmBudgetBand | null {
  const norm = text.normalize('NFC').toLowerCase();

  // Explicit "dưới X tr / triệu / củ" or "trên X tr / triệu / củ"
  const underMatch = /(?:dưới|tối\s+đa|không\s+quá|đổ\s+lại)\s*(\d{1,3})(?:[.,](\d))?\s*(?:tr|triệu|củ)\b/u.exec(norm);
  if (underMatch) {
    const millions = Number(underMatch[1]) + (underMatch[2] ? Number(underMatch[2]) / 10 : 0);
    if (millions <= 5) return 'under_5m';
    if (millions <= 15) return '5m_15m';
    if (millions <= 30) return '15m_30m';
    return '30m_plus';
  }

  const overMatch = /(?:trên|hơn|từ)\s*(\d{1,3})(?:[.,](\d))?\s*(?:tr|triệu|củ)\s*(?:trở\s+lên)?\b/u.exec(norm);
  if (overMatch && !/(?:đến|tới|-|–)/u.test(norm.slice(overMatch.index, overMatch.index + 32))) {
    const millions = Number(overMatch[1]) + (overMatch[2] ? Number(overMatch[2]) / 10 : 0);
    if (millions >= 30) return '30m_plus';
    if (millions >= 15) return '15m_30m';
    if (millions >= 5) return '5m_15m';
  }

  // Range like "5-10tr", "10 đến 15 triệu"
  const rangeMatch = /\b(\d{1,3})\s*(?:-|–|đến|tới)\s*(\d{1,3})\s*(?:tr|triệu|củ)\b/u.exec(norm);
  if (rangeMatch) {
    const avg = (Number(rangeMatch[1]) + Number(rangeMatch[2])) / 2;
    if (avg < 5) return 'under_5m';
    if (avg <= 15) return '5m_15m';
    if (avg <= 30) return '15m_30m';
    return '30m_plus';
  }

  // Single million amount: "tầm 8 triệu", "20 củ", "4tr5", "12,5 triệu"
  const millionMatch = /\b(\d{1,3})(?:(?:[.,](\d))\s*(?:tr|triệu|củ)|(?:\s*(?:tr|triệu|củ)\s*(\d)?))\b/u.exec(norm);
  if (millionMatch) {
    const dec = millionMatch[2] ?? millionMatch[3];
    const millions = Number(millionMatch[1]) + (dec ? Number(dec) / 10 : 0);
    if (millions > 0 && millions < 5) return 'under_5m';
    if (millions >= 5 && millions <= 15) return '5m_15m';
    if (millions > 15 && millions <= 30) return '15m_30m';
    if (millions > 30) return '30m_plus';
  }

  // Thousands: "500k", "800 nghìn"
  const thousandMatch = /\b(\d{2,4})\s*(?:k|nghìn|ngàn)\b/u.exec(norm);
  if (thousandMatch) {
    const thousands = Number(thousandMatch[1]);
    if (thousands >= 50 && thousands < 5000) return 'under_5m';
  }

  // Formatted VND with .000.000: "12.500.000đ"
  const vndMatch = /(?:^|[^\d])([1-9]\d{0,2})\.(\d{3})\.000\s*(?:đ|đồng|vnd)?(?=$|[^\d])/u.exec(norm);
  if (vndMatch) {
    const millions = Number(vndMatch[1]) + Number(vndMatch[2]) / 1000;
    if (millions < 5) return 'under_5m';
    if (millions <= 15) return '5m_15m';
    if (millions <= 30) return '15m_30m';
    return '30m_plus';
  }

  return null;
}

function normalizeMatchTokens(text: string): string[] {
  const stop = new Set([
    'bo', 'cai', 'chiec', 'mau', 'gia', 'bao', 'nhieu', 'trieu', 'dong', 'vnd', 'cm', 'mm',
    'cho', 'cua', 'shop', 'anh', 'chi', 'em', 'minh', 'loai', 'hang', 'san', 'pham',
  ]);
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((tok) => tok.length >= 2 && !stop.has(tok) && !/^\d+$/.test(tok));
}

const DOMAIN_PRODUCT_KEYWORDS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /bàn\s+thờ/iu, label: 'Bàn thờ' },
  { pattern: /án\s+gian/iu, label: 'Án gian' },
  { pattern: /sập\s+thờ/iu, label: 'Sập thờ' },
  { pattern: /tủ\s+thờ/iu, label: 'Tủ thờ' },
  { pattern: /ngũ\s+sự/iu, label: 'Bộ ngũ sự' },
  { pattern: /tam\s+sự/iu, label: 'Bộ tam sự' },
  { pattern: /lư\s+hương|đỉnh\s+đồng/iu, label: 'Lư hương / Đỉnh đồng' },
  { pattern: /tranh\s+quan\s+âm/iu, label: 'Tranh Quan Âm' },
  { pattern: /gỗ\s+gụ/iu, label: 'Gỗ gụ' },
  { pattern: /gỗ\s+hương/iu, label: 'Gỗ hương' },
  { pattern: /gỗ\s+mít/iu, label: 'Gỗ mít' },
  { pattern: /đồng\s+đỏ|đồng\s+catut/iu, label: 'Đồng đỏ / Catut' },
];

function inferTimelineFromText(segments: readonly TextSegment[]): { timeline: CustomerCareCrmTimeline; quote: string | null; origin: 'chat' | 'note' } | null {
  for (const seg of segments) {
    if (/(?:trước\s+tết|kịp\s+tết|đón\s+tết|sắm\s+tết|dịp\s+tết|cuối\s+năm)/iu.test(seg.text)) {
      return { timeline: 'before_tet', quote: safeQuote(seg.text), origin: seg.origin };
    }
    if (/(?:trong\s+tuần\s+này|cuối\s+tuần\s+này|ngày\s+mai|giao\s+ngay|cần\s+gấp)/iu.test(seg.text)) {
      return { timeline: 'this_week', quote: safeQuote(seg.text), origin: seg.origin };
    }
    if (/(?:trong\s+tháng\s+này|cuối\s+tháng|tháng\s+tới|tháng\s+sau)/iu.test(seg.text)) {
      return { timeline: 'this_month', quote: safeQuote(seg.text), origin: seg.origin };
    }
    if (/(?:chưa\s+gấp|tham\s+khảo\s+trước|xem\s+trước|khi\s+nào\s+xong\s+nhà)/iu.test(seg.text)) {
      return { timeline: 'later', quote: safeQuote(seg.text), origin: seg.origin };
    }
  }
  return null;
}

function inferLayer4Interests(
  row: CustomerCareCrmRow,
  ctx: CrmStaffContext,
  segments: readonly TextSegment[],
  products: readonly CrmEnterpriseProduct[],
  nowMs: number,
): CrmPortraitLayer4Interests {
  // 1. Shared links (identity + ctx.sharedDomain + URLs in chat/note, max 3)
  const sharedLinks: CustomerCareCrmSharedLink[] = [];
  const addLink = (link: CustomerCareCrmSharedLink | null) => {
    if (!link || sharedLinks.length >= 3) return;
    const key = `${link.domain}|${link.title ?? ''}`;
    if (sharedLinks.some((item) => `${item.domain}|${item.title ?? ''}` === key)) return;
    // Upgrade existing domain-only entry if a newer source has a title
    const sameDomainIdx = sharedLinks.findIndex((item) => item.domain === link.domain && item.title === null && link.title !== null);
    if (sameDomainIdx >= 0) {
      sharedLinks[sameDomainIdx] = link;
      return;
    }
    if (sharedLinks.some((item) => item.domain === link.domain && link.title === null)) return;
    sharedLinks.push(link);
  };

  for (const field of row.identity?.interests?.sharedLinks ?? []) {
    if (isShownField(field) && field.value) {
      const domain = sanitizeCtxDomain(field.value.domain);
      const title = field.value.title ? sanitizeCtxAdTitle(field.value.title) : null;
      if (domain) addLink({ domain, title });
    }
  }
  if (ctx.sharedDomain) {
    addLink({ domain: ctx.sharedDomain, title: null });
  }
  for (const seg of segments) {
    const rawUrls = seg.text.match(URL_IN_TEXT) ?? [];
    for (const rawUrl of rawUrls) {
      addLink(extractSafeSharedLink(rawUrl));
    }
  }

  // 2. Source Ad
  const idAd = row.identity?.interests?.adTitle;
  const adTitle = (isShownField(idAd) ? sanitizeCtxAdTitle(idAd.value) : null) ?? ctx.adTitle;

  // 3. Matched shop products + domain keywords
  const byId = new Map(products.map((p) => [p.id, p]));
  const matchedIds = new Set<string>();
  for (const id of row.profile.productFactIds) {
    if (byId.has(id)) matchedIds.add(id);
  }
  const idProducts = row.identity?.productFactIds;
  if (isShownField(idProducts) && Array.isArray(idProducts.value)) {
    for (const id of idProducts.value) {
      if (typeof id === 'string' && byId.has(id)) matchedIds.add(id);
    }
  }

  const combinedCorpus = segments.map((s) => s.text).join('\n');
  const corpusTokens = new Set(normalizeMatchTokens(combinedCorpus));
  for (const product of products) {
    if (matchedIds.has(product.id)) continue;
    const prodTokens = normalizeMatchTokens(product.label);
    if (prodTokens.length === 0) continue;
    const overlap = prodTokens.filter((t) => corpusTokens.has(t)).length;
    if ((prodTokens.length === 1 && overlap === 1) || overlap >= 2) {
      matchedIds.add(product.id);
    }
  }
  const matchedProducts = products.filter((p) => matchedIds.has(p.id));
  const topicKeywords = DOMAIN_PRODUCT_KEYWORDS
    .filter((item) => item.pattern.test(combinedCorpus))
    .map((item) => item.label);

  // 4. Budget & Timeline
  let budgetBand: CustomerCareCrmBudgetBand | null = null;
  let budgetQuote: string | null = null;
  let budgetSource: CrmReasoningSource = 'none';
  const idBudget = row.identity?.interests?.budgetBand;
  if (isShownField(idBudget) && oneOf(CUSTOMER_CARE_CRM_BUDGET_BANDS, idBudget.value)) {
    budgetBand = idBudget.value;
    budgetQuote = firstFieldQuote(idBudget);
    budgetSource = idBudget.source === 'staff' ? 'staff' : 'identity';
  } else if (ctx.budgetBand !== null) {
    budgetBand = ctx.budgetBand;
    budgetSource = 'staff';
  } else {
    for (const seg of segments) {
      const parsedBudget = parseVietnameseBudget(seg.text);
      if (parsedBudget) {
        budgetBand = parsedBudget;
        budgetQuote = safeQuote(seg.text);
        budgetSource = seg.origin;
        break;
      }
    }
  }

  const idOccasion = row.identity?.occasion;
  const occasion: CustomerCareCrmOccasion | null = row.profile.occasion
    ?? (isShownField(idOccasion) && oneOf(CUSTOMER_CARE_CRM_OCCASIONS, idOccasion.value) ? idOccasion.value : null);

  let timeline: CustomerCareCrmTimeline | null = null;
  const idTimeline = row.identity?.timeline;
  if (isShownField(idTimeline) && oneOf(CUSTOMER_CARE_CRM_TIMELINES, idTimeline.value)) {
    timeline = idTimeline.value;
  } else if (ctx.timeline !== null) {
    timeline = ctx.timeline;
  } else if (row.profile.neededBy !== null) {
    const dueMs = Date.parse(`${row.profile.neededBy}T23:59:59+07:00`);
    if (Number.isFinite(dueMs)) {
      const diffDays = (dueMs - nowMs) / DAY_MS;
      if (diffDays <= 7) timeline = 'this_week';
      else if (diffDays <= 31) timeline = 'this_month';
      else if (occasion === 'tet') timeline = 'before_tet';
      else timeline = 'later';
    }
  } else if (occasion === 'tet') {
    timeline = 'before_tet';
  } else {
    timeline = inferTimelineFromText(segments)?.timeline ?? null;
  }

  const summaryParts: string[] = [];
  if (matchedProducts.length > 0) {
    summaryParts.push(`Sản phẩm: ${matchedProducts.map((p) => cleanSingleLine(maskCrmPhones(p.label), 48)).join(', ')}`);
  } else if (topicKeywords.length > 0) {
    summaryParts.push(`Quan tâm: ${topicKeywords.slice(0, 3).join(', ')}`);
  }
  if (adTitle) summaryParts.push(`QC: ${adTitle}`);
  if (sharedLinks.length > 0) {
    summaryParts.push(`Link: ${sharedLinks.map((l) => (l.title ? `${l.title} (${l.domain})` : l.domain)).join(', ')}`);
  }
  if (budgetBand) summaryParts.push(`Ngân sách: ${BUDGET_LABELS[budgetBand]}`);
  if (timeline) summaryParts.push(`Thời hạn: ${TIMELINE_LABELS[timeline]}`);

  const hasAny = summaryParts.length > 0 || row.profile.neededBy !== null || occasion !== null;
  const source: CrmReasoningSource = (row.profile.productFactIds.length > 0 || ctx.adTitle !== null || ctx.sharedDomain !== null || ctx.budgetBand !== null || ctx.timeline !== null)
    ? 'staff'
    : (budgetSource !== 'none' ? budgetSource : (hasAny ? 'chat' : 'none'));

  return {
    step: 4,
    title: 'Tầng 4 · Mối quan tâm gần đây',
    sharedLinks,
    adTitle,
    matchedProducts,
    topicKeywords,
    budgetBand,
    budgetLabel: budgetBand ? BUDGET_LABELS[budgetBand] : null,
    timeline,
    timelineLabel: timeline ? TIMELINE_LABELS[timeline] : null,
    neededBy: row.profile.neededBy,
    occasion,
    occasionLabel: occasion ? OCCASION_LABELS[occasion] : null,
    label: summaryParts.length > 0 ? summaryParts.join(' · ') : 'Chưa ghi nhận sản phẩm, link hoặc ngân sách cụ thể',
    confidence: hasAny ? (source === 'staff' ? 'high' : 'medium') : null,
    source,
    quote: budgetQuote,
    reasoning: hasAny
      ? 'Tổng hợp từ sản phẩm đã chọn, quảng cáo nguồn, link chia sẻ và ngân sách/thời hạn trong hội thoại.'
      : 'Cần khai thác thêm mẫu mã, ngân sách và thời điểm khách cần nhận hàng.',
  };
}

function buildPersonaSummary(
  persona: CustomerCareCrmPersona | null,
  layer1: CrmPortraitLayer1Age,
  layer2: CrmPortraitLayer2Demographic,
  layer3: CrmPortraitLayer3Household,
  layer4: CrmPortraitLayer4Interests,
): string {
  const parts: string[] = [];
  const who = layer2.addressForm !== null
    ? `Khách ${layer2.inferredGender === 'male' ? 'nam' : layer2.inferredGender === 'female' ? 'nữ' : ''} (${layer2.salutation}${layer1.ageBands.length > 0 ? `, ${formatAgeBandsLabel(layer1.ageBands, layer1.exactAge)}` : ''})`.replace(/\s+/g, ' ')
    : (layer1.ageBands.length > 0 ? `Khách (${formatAgeBandsLabel(layer1.ageBands, layer1.exactAge)})` : 'Khách tiềm năng');
  parts.push(who);

  if (persona !== null) {
    parts.push(`thuộc nhóm ${persona} (${PERSONA_SHORT_LABELS[persona]})`);
  }
  if (layer3.recipient !== null) {
    parts.push(STAFF_RECIPIENT_LABELS[layer3.recipient].toLowerCase());
  }
  if (layer4.matchedProducts.length > 0) {
    const firstProd = cleanSingleLine(maskCrmPhones(layer4.matchedProducts[0]!.label), 48);
    parts.push(`đang quan tâm ${firstProd}`);
  } else if (layer4.topicKeywords.length > 0) {
    parts.push(`đang tìm hiểu ${layer4.topicKeywords.slice(0, 2).join(', ')}`);
  }
  if (layer4.budgetLabel) {
    parts.push(`ngân sách ${layer4.budgetLabel.toLowerCase()}`);
  }
  if (layer4.timelineLabel) {
    parts.push(`cần ${layer4.timelineLabel.toLowerCase()}`);
  }

  if (parts.length <= 1 && persona === null) {
    return 'Khách mới để lại thông tin liên hệ, cần hỏi thêm sản phẩm quan tâm, dịp mua và ngân sách dự kiến.';
  }
  return `${parts.join(', ')}.`;
}

function buildMissingPrompts(
  salutation: string,
  missingDimensions: readonly string[],
): string[] {
  const sal = salutation === 'Anh/Chị' ? 'anh/chị' : salutation.toLowerCase();
  const prompts: string[] = [];
  for (const dim of missingDimensions) {
    switch (dim) {
      case 'Sản phẩm/Link quan tâm':
        prompts.push(`Dạ ${sal} đang quan tâm mẫu nào hoặc kích thước khoảng bao nhiêu để em gửi ảnh thực tế ạ?`);
        break;
      case 'Dịp/Thời hạn':
        prompts.push(`Dạ ${sal} dự kiến sắm cho dịp nào (nhập trạch, lễ Tết hay biếu tặng) và cần nhận trước ngày nào ạ?`);
        break;
      case 'Ngân sách':
        prompts.push(`Dạ ${sal} đang dự trù tầm ngân sách khoảng bao nhiêu để em chọn chất liệu phù hợp nhất ạ?`);
        break;
      case 'Gia đình':
        prompts.push(`Dạ mình sắm cho không gian gia đình mình hay mua biếu người thân để em tư vấn quy cách chuẩn nhất ạ?`);
        break;
      case 'Xưng hô':
        prompts.push('Dạ em xin phép hỏi mình tiện xưng hô là Anh hay Chị để em lưu hồ sơ hỗ trợ chu đáo ạ?');
        break;
      case 'Độ tuổi':
        prompts.push(`Dạ ${sal} thích phong cách truyền thống chạm khắc kỹ hay tối giản hiện đại cho hợp gu không gian nhà mình ạ?`);
        break;
      default:
        break;
    }
  }
  return prompts;
}

function inferLayer5Persona(
  row: CustomerCareCrmRow,
  ctx: CrmStaffContext,
  segments: readonly TextSegment[],
  layer1: CrmPortraitLayer1Age,
  layer2: CrmPortraitLayer2Demographic,
  layer3: CrmPortraitLayer3Household,
  layer4: CrmPortraitLayer4Interests,
): CrmPortraitLayer5Persona {
  let persona: CustomerCareCrmPersona | null = null;
  let confidence: CustomerCareCrmIdConfidence | null = null;
  let source: CrmReasoningSource = 'none';
  let reasoning = 'Chưa đủ tín hiệu dịp mua, đối tượng hoặc ngân sách để xếp nhóm chân dung P1–P4.';

  const idPersona = row.identity?.persona;
  const corpus = segments.map((s) => s.text).join('\n');

  if (isShownField(idPersona) && oneOf(CUSTOMER_CARE_CRM_PERSONAS, idPersona.value)) {
    persona = idPersona.value;
    confidence = idPersona.confidence;
    source = idPersona.source === 'staff' ? 'staff' : 'identity';
    reasoning = 'Tổng hợp từ chân dung định danh đã lưu.';
  } else if (ctx.persona !== null) {
    persona = ctx.persona;
    confidence = 'high';
    source = 'staff';
    reasoning = 'Nhân viên đã gắn trực tiếp nhóm chân dung khách hàng.';
  } else if (
    layer4.occasion === 'gift'
    || layer3.recipient === 'gift'
    || /(?:hộp\s+quà|thiệp|quà\s+tân\s+gia|tặng\s+tân\s+gia|biếu\s+sếp|giao\s+kịp\s+dịp\s+tặng|làm\s+quà)/iu.test(corpus)
  ) {
    persona = 'P3';
    confidence = layer4.occasion === 'gift' || layer3.source === 'staff' ? 'high' : 'medium';
    source = layer4.occasion === 'gift' ? 'staff' : 'chat';
    reasoning = 'Khách mua làm quà biếu/tri ân, ưu tiên hình thức trang trọng và giao đúng hẹn.';
  } else if (
    layer4.occasion === 'new_home'
    || layer4.occasion === 'replacement'
    || /(?:nhập\s+trạch|lỗ\s+ban|chung\s+cư|căn\s+hộ|nhà\s+mới|phòng\s+thờ\s+mới|thay\s+bàn\s+thờ)/iu.test(corpus)
  ) {
    persona = 'P1';
    confidence = layer4.occasion !== null ? 'high' : 'medium';
    source = layer4.occasion !== null ? 'staff' : 'chat';
    reasoning = 'Khách sắm chính cho nhà mới / thay mới không gian thờ, quan tâm kích thước Lỗ Ban & chất liệu.';
  } else if (
    layer4.occasion === 'tet'
    || layer4.occasion === 'anniversary'
    || layer3.recipient === 'parents'
    || layer4.timeline === 'before_tet'
    || /(?:gia\s+tiên|lư\s+hương|đồng\s+đỏ|ngũ\s+sự|từ\s+đường|nhà\s+thờ\s+họ|sắm\s+tết|cúng\s+giỗ)/iu.test(corpus)
  ) {
    persona = 'P2';
    confidence = layer4.occasion !== null || layer3.source === 'staff' ? 'high' : 'medium';
    source = layer4.occasion !== null ? 'staff' : 'chat';
    reasoning = 'Khách chú trọng giá trị truyền thống, lễ Tết, giỗ chạp hoặc hiếu kính bố mẹ.';
  } else if (
    layer4.budgetBand === 'under_5m'
    || row.profile.lostReason === 'price'
    || (layer4.occasion === null && /(?:giá\s+bn|giá\s+bao\s+nhiêu|bao\s+nhiêu\s+tiền|bnhiu|rẻ\s+hơn\s+không|xin\s+giá|báo\s+giá)/iu.test(corpus))
  ) {
    persona = 'P4';
    confidence = row.profile.lostReason === 'price' ? 'high' : 'medium';
    source = row.profile.lostReason === 'price' ? 'staff' : 'chat';
    reasoning = 'Khách đang tập trung khảo giá, so sánh chi phí hoặc cân nhắc ngân sách dưới 5 triệu.';
  }

  // 6 completeness dimensions
  const dimensions: ReadonlyArray<{ name: string; filled: boolean }> = [
    { name: 'Xưng hô', filled: layer2.addressForm !== null },
    { name: 'Độ tuổi', filled: layer1.ageBands.length > 0 },
    { name: 'Gia đình', filled: layer3.recipient !== null },
    {
      name: 'Sản phẩm/Link quan tâm',
      filled: layer4.matchedProducts.length > 0 || layer4.sharedLinks.length > 0 || layer4.adTitle !== null || layer4.topicKeywords.length > 0,
    },
    { name: 'Ngân sách', filled: layer4.budgetBand !== null },
    {
      name: 'Dịp/Thời hạn',
      filled: layer4.occasion !== null || layer4.timeline !== null || row.profile.neededBy !== null,
    },
  ];

  const filledDimensions = dimensions.filter((d) => d.filled).length;
  const missingDimensions = dimensions.filter((d) => !d.filled).map((d) => d.name);
  const completenessPct = Math.round((filledDimensions / dimensions.length) * 100);
  const summary = buildPersonaSummary(persona, layer1, layer2, layer3, layer4);
  const missingPrompts = buildMissingPrompts(layer2.salutation, missingDimensions);

  return {
    step: 5,
    title: 'Tầng 5 · Chân dung khách hàng tổng hợp',
    persona,
    label: persona !== null ? `${persona} · ${PERSONA_SHORT_LABELS[persona]}` : 'Chưa phân loại chân dung (P1–P4)',
    confidence,
    source,
    quote: null,
    reasoning,
    completenessPct,
    filledDimensions,
    missingDimensions,
    summary,
    missingPrompts,
  };
}

/**
 * Builds the ordered 5-Layer Customer Portrait reasoning chain (`layer_1_age` → `layer_5_persona`).
 */
export function buildCustomerPortrait(
  row: CustomerCareCrmRow,
  products: readonly CrmEnterpriseProduct[] = [],
  nowMs: number = Date.now(),
): CrmCustomerPortrait {
  const { freeNote, ctx } = splitCrmNote(row.profile.note);
  const segments = splitSentences(row, freeNote);

  const layer_1_age = inferLayer1Age(row, ctx, segments, nowMs);
  const layer_2_demographic = inferLayer2Demographic(row, layer_1_age);
  const layer_3_household = inferLayer3Household(row, ctx, segments);
  const layer_4_interests = inferLayer4Interests(row, ctx, segments, products, nowMs);
  const layer_5_persona = inferLayer5Persona(
    row,
    ctx,
    segments,
    layer_1_age,
    layer_2_demographic,
    layer_3_household,
    layer_4_interests,
  );

  return {
    layer_1_age,
    layer_2_demographic,
    layer_3_household,
    layer_4_interests,
    layer_5_persona,
    completenessPct: layer_5_persona.completenessPct,
    summary: layer_5_persona.summary,
    missingPrompts: layer_5_persona.missingPrompts,
  };
}

function sanitizeEvidenceList(evidence: readonly CustomerCareCrmEvidence[] | undefined): CustomerCareCrmEvidence[] {
  if (!Array.isArray(evidence)) return [];
  const cleaned: CustomerCareCrmEvidence[] = [];
  for (const item of evidence) {
    if (!item || typeof item !== 'object') continue;
    if (item.quote === null) {
      cleaned.push({ ...item, quote: null });
      continue;
    }
    const safe = safeQuote(item.quote);
    if (safe !== null) {
      cleaned.push({ ...item, quote: safe });
    }
  }
  return cleaned;
}

function cleanBaseField<T>(field: CustomerCareCrmIdField<T> | null | undefined): CustomerCareCrmIdField<T> | null {
  if (!isShownField(field)) return null;
  return { ...field, evidence: sanitizeEvidenceList(field.evidence) };
}

function makeIdField<T>(
  value: T,
  sourceOrigin: CrmReasoningSource,
  confidence: CustomerCareCrmIdConfidence,
  updatedAt: string,
  quote: string | null = null,
): CustomerCareCrmIdField<T> {
  const isStaff = sourceOrigin === 'staff';
  const safe = safeQuote(quote);
  const evidence: CustomerCareCrmEvidence[] = safe
    ? [{ source: sourceOrigin === 'note' ? 'note' : 'customer', at: updatedAt, quote: safe }]
    : [];
  return {
    value,
    confidence,
    kind: isStaff || sourceOrigin === 'chat' ? 'stated' : 'inferred',
    source: isStaff ? 'staff' : 'ai',
    status: isStaff ? 'confirmed' : 'suggested',
    updatedAt,
    evidence,
  };
}

/**
 * Merges `row.identity` (when present) with `[izzi-ctx]` staff tags and `medium|high` portrait inferences.
 * Enforces the `c5898f6` consent gate: profile-layer fields (`persona`, `ageBand`, `addressForm`, `family`,
 * `interests`) are populated ONLY when `consent === 'granted'`; before consent, only order-layer fields
 * (`occasion`, `timeline`, `productFactIds`) are exposed. Unreadable rows return all-null fields.
 */
export function effectiveCrmIdentity(
  row: CustomerCareCrmRow,
  products: readonly CrmEnterpriseProduct[] = [],
  nowMs: number = Date.now(),
): CustomerCareCrmIdentity {
  const updatedAt = row.profile.updatedAt ?? row.lastMessageAt;
  if (row.profile.detailsUnreadable === true) {
    return {
      version: null,
      lastRunAt: null,
      consent: null,
      occasion: null,
      timeline: null,
      productFactIds: null,
      addressForm: null,
      ageBand: null,
      family: null,
      interests: null,
      persona: null,
    };
  }

  const base = row.identity ?? null;
  const { ctx } = splitCrmNote(row.profile.note);
  const portrait = buildCustomerPortrait(row, products, nowMs);

  // Consent merge: any explicit decline/withdrawal or DNC overrides softer states
  let consent: CustomerCareCrmConsent | null = base?.consent ? { ...base.consent } : null;
  if (ctx.consent !== null) {
    const refused = ctx.consent === 'declined' || ctx.consent === 'withdrawn' || base?.consent?.noMarketing === true;
    // Never overwrite a server-recorded refusal with a softer state
    if (!(base?.consent && (base.consent.state === 'declined' || base.consent.state === 'withdrawn'))) {
      consent = {
        state: ctx.consent,
        at: base?.consent?.at ?? updatedAt,
        noMarketing: refused || row.profile.stage === 'do_not_contact',
        canAsk: ctx.consent === 'unknown',
      };
    }
  } else if (!consent && row.profile.stage === 'do_not_contact') {
    consent = { state: 'declined', at: updatedAt, noMarketing: true, canAsk: false };
  }

  const occasion = cleanBaseField(base?.occasion)
    ?? (portrait.layer_4_interests.occasion && portrait.layer_4_interests.confidence
      ? makeIdField(portrait.layer_4_interests.occasion, portrait.layer_4_interests.source, portrait.layer_4_interests.confidence, updatedAt)
      : null);

  const timeline = cleanBaseField(base?.timeline)
    ?? (portrait.layer_4_interests.timeline && portrait.layer_4_interests.confidence
      ? makeIdField(portrait.layer_4_interests.timeline, ctx.timeline ? 'staff' : portrait.layer_4_interests.source, ctx.timeline ? 'high' : 'medium', updatedAt)
      : null);

  const mergedProdIds = [...new Set([
    ...row.profile.productFactIds,
    ...portrait.layer_4_interests.matchedProducts.map((p) => p.id),
  ])].slice(0, 8);
  const productFactIds = cleanBaseField(base?.productFactIds)
    ?? (mergedProdIds.length > 0
      ? makeIdField(mergedProdIds, row.profile.productFactIds.length > 0 ? 'staff' : 'chat', row.profile.productFactIds.length > 0 ? 'high' : 'medium', updatedAt)
      : null);

  // Consent gate (matches c5898f6): profile-layer fields require explicit `consent === 'granted'` and non-suppressed status
  const profileLayerGranted = !isCrmRowAdsSuppressed(row) && hasExplicitMarketingConsent(row) && consent?.state === 'granted';
  if (!profileLayerGranted) {
    return {
      version: base?.version ?? 'izzi-enterprise-v1',
      lastRunAt: base?.lastRunAt ?? updatedAt,
      consent,
      occasion,
      timeline,
      productFactIds,
      addressForm: null,
      ageBand: null,
      family: null,
      interests: null,
      persona: null,
    };
  }

  const addressForm = cleanBaseField(base?.addressForm)
    ?? (portrait.layer_2_demographic.addressForm && portrait.layer_2_demographic.confidence && portrait.layer_2_demographic.confidence !== 'low'
      ? makeIdField(
        portrait.layer_2_demographic.addressForm,
        portrait.layer_2_demographic.source,
        portrait.layer_2_demographic.confidence,
        updatedAt,
        portrait.layer_2_demographic.quote,
      )
      : null);

  const ageBand = cleanBaseField(base?.ageBand)
    ?? (portrait.layer_1_age.ageBands.length > 0 && portrait.layer_1_age.confidence && portrait.layer_1_age.confidence !== 'low'
      ? makeIdField(
        portrait.layer_1_age.ageBands,
        portrait.layer_1_age.source,
        portrait.layer_1_age.confidence,
        updatedAt,
        portrait.layer_1_age.quote,
      )
      : null);

  const cleanedBaseFamily = cleanBaseField(base?.family);
  const validBaseFamily = cleanedBaseFamily
    && cleanedBaseFamily.evidence.some((ev) => ev.source === 'customer' && ev.quote !== null)
    ? cleanedBaseFamily
    : null;
  const family = validBaseFamily
    ?? (portrait.layer_3_household.recipient && portrait.layer_3_household.confidence && portrait.layer_3_household.confidence !== 'low'
      ? makeIdField(
        { recipient: portrait.layer_3_household.recipient },
        portrait.layer_3_household.source,
        portrait.layer_3_household.confidence,
        updatedAt,
        portrait.layer_3_household.quote,
      )
      : null);

  const adTitleField = cleanBaseField(base?.interests?.adTitle)
    ?? (portrait.layer_4_interests.adTitle
      ? {
        ...makeIdField(portrait.layer_4_interests.adTitle, 'staff', 'high', updatedAt),
        source: ctx.adTitle ? ('staff' as const) : ('ad' as const),
      }
      : null);

  const existingSharedLinks = (base?.interests?.sharedLinks ?? [])
    .map((item) => cleanBaseField(item))
    .filter((item): item is CustomerCareCrmIdField<CustomerCareCrmSharedLink> => item !== null);
  const seenDomains = new Set(existingSharedLinks.map((item) => item.value.domain.toLowerCase()));
  const extraSharedLinks: CustomerCareCrmIdField<CustomerCareCrmSharedLink>[] = [];
  for (const link of portrait.layer_4_interests.sharedLinks) {
    if (seenDomains.has(link.domain.toLowerCase())) continue;
    seenDomains.add(link.domain.toLowerCase());
    const isStaffDomain = ctx.sharedDomain === link.domain;
    extraSharedLinks.push(makeIdField(link, isStaffDomain ? 'staff' : 'chat', isStaffDomain ? 'high' : 'medium', updatedAt));
  }
  const sharedLinks = [...existingSharedLinks, ...extraSharedLinks].slice(0, 3);

  const budgetBand = cleanBaseField(base?.interests?.budgetBand)
    ?? (portrait.layer_4_interests.budgetBand
      ? makeIdField(
        portrait.layer_4_interests.budgetBand,
        ctx.budgetBand ? 'staff' : 'chat',
        ctx.budgetBand ? 'high' : 'medium',
        updatedAt,
        portrait.layer_4_interests.quote,
      )
      : null);

  const cleanedBasePersona = isShownField(base?.persona)
    ? {
      ...base!.persona,
      evidence: sanitizeEvidenceList(base!.persona.evidence),
      summary: containsSensitiveHouseholdTerm(base!.persona.summary ?? '') ? '' : cleanSingleLine(maskCrmPhones(base!.persona.summary ?? ''), 120),
    }
    : null;

  const persona = cleanedBasePersona
    ?? (portrait.layer_5_persona.persona && portrait.layer_5_persona.confidence && portrait.layer_5_persona.confidence !== 'low'
      ? {
        ...makeIdField(
          portrait.layer_5_persona.persona,
          portrait.layer_5_persona.source,
          portrait.layer_5_persona.confidence,
          updatedAt,
        ),
        summary: cleanSingleLine(portrait.summary, 120),
      }
      : null);

  return {
    version: base?.version ?? 'izzi-enterprise-v1',
    lastRunAt: base?.lastRunAt ?? updatedAt,
    consent,
    occasion,
    timeline,
    productFactIds,
    addressForm,
    ageBand,
    family,
    interests: (adTitleField || sharedLinks.length > 0 || budgetBand)
      ? { adTitle: adTitleField, sharedLinks, budgetBand }
      : null,
    persona,
  };
}

// ---------------------------------------------------------------------------
// A3.1 Saler Playbook (`buildSalerPlaybook`)
// ---------------------------------------------------------------------------

export type CrmSalerPriorityBand = 'hot' | 'warm' | 'normal' | 'closed';

export interface CrmSalerPlaybook {
  priorityScore: number;
  priorityBand: CrmSalerPriorityBand;
  canContact: boolean;
  opener: string;
  discoveryQuestions: string[];
  objectionHint: string;
  closingChecklist: string[];
  suggestedNextStep: string;
  suggestedDueIso: string;
}

function clampFutureIso(targetMs: number, nowMs: number): string {
  const minSafe = nowMs + 30 * 60 * 1000;
  const maxSafe = nowMs + 365 * DAY_MS;
  const bounded = Math.min(maxSafe, Math.max(minSafe, targetMs));
  return new Date(bounded).toISOString();
}

export function buildSalerPlaybook(
  row: CustomerCareCrmRow,
  portrait: CrmCustomerPortrait,
  products: readonly CrmEnterpriseProduct[] = [],
  nowMs: number = Date.now(),
): CrmSalerPlaybook {
  const { stage, lostReason, neededBy, nextStep, nextStepDueAt } = row.profile;
  const sal = portrait.layer_2_demographic.salutation;
  const salLower = sal === 'Anh/Chị' ? 'anh/chị' : sal.toLowerCase();
  const persona = portrait.layer_5_persona.persona;
  const firstProduct = portrait.layer_4_interests.matchedProducts[0]?.label
    ?? products.find((p) => row.profile.productFactIds.includes(p.id))?.label
    ?? portrait.layer_4_interests.topicKeywords[0]
    ?? 'mẫu sản phẩm bên shop';
  const cleanProd = cleanSingleLine(maskCrmPhones(firstProduct), 60);

  if (row.profile.detailsUnreadable === true) {
    return {
      priorityScore: 0,
      priorityBand: 'closed',
      canContact: false,
      opener: 'Không đọc được chi tiết hồ sơ đã niêm phong của khách này — tạm khóa liên hệ chủ động và chỉnh sửa.',
      discoveryQuestions: [],
      objectionHint: 'Hồ sơ đang ở chế độ chỉ đọc do máy chủ chưa mở được phần chi tiết niêm phong; không tự ý ghi đè dữ liệu.',
      closingChecklist: [
        'Giữ nguyên hồ sơ ở chế độ chỉ đọc',
        'Không lưu đè thông tin chi tiết khi máy chủ chưa mở niêm phong',
        'Thử tải lại sau khi kết nối máy chủ ổn định',
      ],
      suggestedNextStep: 'Chờ máy chủ khôi phục đọc chi tiết hồ sơ',
      suggestedDueIso: clampFutureIso(nowMs + DAY_MS, nowMs),
    };
  }

  if (isCrmRowAdsSuppressed(row)) {
    const boughtOrDone = lostReason === 'bought_elsewhere' || lostReason === 'not_needed';
    return {
      priorityScore: 0,
      priorityBand: 'closed',
      canContact: false,
      opener: boughtOrDone
        ? 'Khách đã mua nơi khác hoặc không còn nhu cầu — dừng lịch gọi bám đuổi để tập trung khách tiềm năng.'
        : 'Khách đã từ chối liên hệ / tiếp thị — tuyệt đối không gọi điện hoặc nhắn tin làm phiền.',
      discoveryQuestions: [],
      objectionHint: boughtOrDone
        ? 'Tôn trọng quyết định của khách đã mua nơi khác hoặc hết nhu cầu; không spam lại.'
        : 'Tôn trọng yêu cầu dừng liên hệ của khách; không đưa vào chiến dịch gọi lại hay quảng cáo.',
      closingChecklist: [
        boughtOrDone ? 'Giữ trạng thái đóng lịch chăm sóc' : 'Giữ nguyên trạng thái từ chối / không liên hệ',
        'Không gửi tin nhắn Zalo hoặc gọi điện thêm',
        'Loại trừ hoàn toàn khỏi danh sách Remarketing & Ads',
      ],
      suggestedNextStep: boughtOrDone ? 'Đã đóng theo dõi (khách hết nhu cầu)' : 'Tôn trọng yêu cầu không liên hệ của khách',
      suggestedDueIso: clampFutureIso(nowMs + DAY_MS, nowMs),
    };
  }

  let priorityScore = 0;
  if (stage === 'lost' || stage === 'do_not_contact') {
    priorityScore = 0;
  } else {
    const stageBase: Record<Exclude<CustomerCareCrmStage, 'lost' | 'do_not_contact'>, number> = {
      deposit: 68,
      has_phone: 62,
      consulting: 52,
      delivered: 28,
    };
    priorityScore = stageBase[stage];

    const lastMsgMs = Date.parse(row.lastMessageAt);
    if (Number.isFinite(lastMsgMs)) {
      const ageHours = (nowMs - lastMsgMs) / HOUR_MS;
      if (ageHours <= 2) priorityScore += 20;
      else if (ageHours <= 24) priorityScore += 12;
      else if (ageHours <= 72) priorityScore += 5;
    }

    if (nextStepDueAt !== null) {
      const dueMs = Date.parse(nextStepDueAt);
      if (Number.isFinite(dueMs)) {
        if (dueMs <= nowMs) priorityScore += 14;
        else if (vietnamDateKey(dueMs) === vietnamDateKey(nowMs)) priorityScore += 10;
      }
    } else if (stage === 'has_phone' && nextStep === null) {
      priorityScore += 10;
    }

    if (portrait.layer_4_interests.timeline === 'this_week') priorityScore += 10;
    else if (portrait.layer_4_interests.timeline === 'before_tet' || portrait.layer_4_interests.timeline === 'this_month') {
      priorityScore += 5;
    }

    if (portrait.layer_4_interests.budgetBand === '15m_30m' || portrait.layer_4_interests.budgetBand === '30m_plus') {
      priorityScore += 6;
    }
    if (portrait.layer_4_interests.matchedProducts.length > 0) priorityScore += 4;
    priorityScore = Math.max(1, Math.min(100, priorityScore));
  }

  const priorityBand: CrmSalerPriorityBand = priorityScore === 0
    ? 'closed'
    : priorityScore >= 75
      ? 'hot'
      : priorityScore >= 50
        ? 'warm'
        : 'normal';

  const occasionPhrase = neededBy
    ? `kịp trước ngày ${neededBy}`
    : portrait.layer_4_interests.occasionLabel
      ? `cho dịp ${portrait.layer_4_interests.occasionLabel.toLowerCase()}`
      : portrait.layer_4_interests.timelineLabel
        ? `trong khung ${portrait.layer_4_interests.timelineLabel.toLowerCase()}`
        : 'phù hợp nhu cầu thực tế của mình';

  let personaHook = 'gửi ảnh thực tế tại xưởng và báo giá chi tiết';
  if (persona === 'P1') personaHook = 'tư vấn chuẩn kích thước thước Lỗ Ban và phối cảnh hợp không gian phòng thờ mới';
  else if (persona === 'P2') personaHook = 'chọn chất liệu bền đẹp, trang nghiêm chuẩn truyền thống gia đình';
  else if (persona === 'P3') personaHook = 'chuẩn bị quy cách đóng gói hộp quà trang trọng và lịch giao đúng hẹn tặng';
  else if (persona === 'P4') personaHook = 'gửi bảng so sánh rõ từng phân khúc chất liệu tối ưu nhất trong tầm ngân sách';

  const opener = stage === 'delivered'
    ? `Dạ em chào ${salLower}, em gọi từ shop để hỏi thăm ${cleanProd} bên mình lắp đặt đã ưng ý chưa và gửi hướng dẫn bảo quản bền màu ạ.`
    : `Dạ em chào ${salLower}, em thấy ${salLower} để lại số quan tâm ${cleanProd} ${occasionPhrase} — em xin phép ${personaHook} cho ${salLower} nhé ạ!`;

  const discoveryQuestions = portrait.missingPrompts.slice(0, 3);
  if (discoveryQuestions.length === 0) {
    discoveryQuestions.push(`Dạ ${salLower} muốn em quay video trực tiếp ${cleanProd} dưới ánh sáng tự nhiên qua Zalo để mình chốt mẫu luôn không ạ?`);
  }

  let objectionHint = 'Nhấn mạnh cam kết chất liệu đúng mô tả, gửi video quay thực tế tại xưởng và chính sách bảo hành/kiểm hàng trước khi thanh toán.';
  if (lostReason === 'price' || persona === 'P4' || portrait.layer_4_interests.budgetBand === 'under_5m') {
    objectionHint = 'Không hạ giá đột ngột gây nghi ngờ chất lượng: đặt cạnh nhau 2 quy cách (độ dày gỗ/đồng, hoàn thiện thủ công) để khách thấy rõ giá trị hoặc chọn kích thước vừa ngân sách.';
  } else if (portrait.layer_3_household.recipient === 'spouse' || portrait.layer_3_household.recipient === 'parents' || portrait.layer_3_household.recipient === 'household') {
    objectionHint = `Khách thường bàn bạc cùng gia đình: chủ động gửi 1 tin tóm tắt gọn (Ảnh thực tế + Kích thước Lỗ Ban + Giá trọn gói + Bảo hành) qua Zalo để ${salLower} dễ chuyển cho người thân xem cùng.`;
  }

  const closingChecklist = stage === 'deposit' || stage === 'delivered'
    ? [
      `Xác nhận ngày/giờ giao lắp ${cleanProd} và người nhận tại điểm giao`,
      'Gửi ảnh kiểm tra hoàn thiện trước khi đóng gói xuất xưởng',
      'Hướng dẫn kiểm hàng, nghiệm thu và lưu lịch chăm sóc N+1 / N+7',
    ]
    : [
      `Chốt mẫu & kích thước chuẩn của ${cleanProd} theo không gian thực tế`,
      `Gửi báo giá trọn gói (kèm vận chuyển/lắp đặt ${occasionPhrase})`,
      'Gửi video/ảnh thực tế + chính sách bảo hành bằng văn bản qua Zalo',
      `Đề xuất giữ mẫu / đặt cọc nhẹ để khóa lịch giao ${occasionPhrase}`,
    ];

  const suggestedNextStep = cleanSingleLine(
    stage === 'has_phone'
      ? `Gọi/nhắn Zalo chào ${sal} và tư vấn ${cleanProd}`
      : stage === 'consulting'
        ? `Gửi ảnh thực tế & bảng kích thước ${cleanProd} cho ${sal}`
        : stage === 'deposit'
          ? `Xác nhận lịch giao lắp ${cleanProd} với ${sal}`
          : stage === 'delivered'
            ? `Hỏi thăm sau giao hàng & xin ảnh thực tế từ ${sal}`
            : `Nhắn hỏi thăm nhẹ dịp ưu đãi mẫu ${cleanProd}`,
    CARE_CRM_MAX_NEXT_STEP,
  );

  const dueOffsetMs = stage === 'has_phone'
    ? 2 * HOUR_MS
    : stage === 'consulting'
      ? 4 * HOUR_MS
      : stage === 'deposit'
        ? DAY_MS
        : 3 * DAY_MS;

  return {
    priorityScore,
    priorityBand,
    canContact: true,
    opener,
    discoveryQuestions,
    objectionHint,
    closingChecklist,
    suggestedNextStep,
    suggestedDueIso: clampFutureIso(nowMs + dueOffsetMs, nowMs),
  };
}

// ---------------------------------------------------------------------------
// A3.2 Ads Segmentation & SHA-256 Meta Custom Audience CSV
// ---------------------------------------------------------------------------

export const CRM_ADS_BUCKETS = ['suppressed', 'vip_lookalike', 'high_intent', 'reengage_lost'] as const;
export type CrmAdsBucket = (typeof CRM_ADS_BUCKETS)[number];

export interface CrmAdAngle {
  headline: string;
  hook: string;
  recommendedFormat: string;
  exclusionNote: string;
}

export interface CrmAdsBucketSummary {
  bucket: CrmAdsBucket;
  label: string;
  description: string;
  count: number;
  consentedCount: number;
  leadIds: string[];
  adAngles: CrmAdAngle[];
}

export interface CrmAdsPersonaSummary {
  persona: CustomerCareCrmPersona;
  label: string;
  count: number;
  consentedCount: number;
  leadIds: string[];
  adAngles: CrmAdAngle[];
}

export interface CrmAdsAudienceSummary {
  totalRows: number;
  consentedCount: number;
  suppressedCount: number;
  buckets: Record<CrmAdsBucket, CrmAdsBucketSummary>;
  byPersona: Record<CustomerCareCrmPersona, CrmAdsPersonaSummary>;
  unclassifiedCount: number;
}

export function isCrmRowAdsSuppressed(row: CustomerCareCrmRow): boolean {
  if (row.profile.detailsUnreadable === true) return true;
  if (row.profile.stage === 'do_not_contact') return true;
  if (row.profile.lostReason === 'bought_elsewhere' || row.profile.lostReason === 'not_needed') return true;
  if (row.identity?.consent?.noMarketing === true) return true;
  const idState = row.identity?.consent?.state;
  if (idState === 'declined' || idState === 'withdrawn') return true;
  const { ctx } = splitCrmNote(row.profile.note);
  if (ctx.consent === 'declined' || ctx.consent === 'withdrawn') return true;
  return false;
}

export function hasExplicitMarketingConsent(row: CustomerCareCrmRow): boolean {
  if (isCrmRowAdsSuppressed(row)) return false;
  if (row.identity?.consent?.state === 'granted') return true;
  const { ctx } = splitCrmNote(row.profile.note);
  return ctx.consent === 'granted';
}

export function classifyCrmAdsBucket(row: CustomerCareCrmRow): CrmAdsBucket {
  if (isCrmRowAdsSuppressed(row)) return 'suppressed';
  switch (row.profile.stage) {
    case 'deposit':
    case 'delivered':
      return 'vip_lookalike';
    case 'has_phone':
    case 'consulting':
      return 'high_intent';
    case 'lost':
      return 'reengage_lost';
    case 'do_not_contact':
      return 'suppressed';
  }
}

const BUCKET_AD_ANGLES: Readonly<Record<CrmAdsBucket, CrmAdAngle[]>> = {
  high_intent: [
    {
      headline: 'Quay Trực Tiếp Tại Xưởng — Chuẩn Từng Đường Chạm & Kích Thước Lỗ Ban',
      hook: 'Đang phân vân chất liệu & kích thước cho phòng thờ gia đình? Xem cận cảnh mộc/đồng nguyên bản chưa sơn phủ.',
      recommendedFormat: 'Video Reels / Carousel cận cảnh chi tiết + nút Nhắn tin Messenger',
      exclusionNote: 'Loại trừ tệp Đã cọc/Đã giao (vip_lookalike) và tệp Đã chặn (suppressed).',
    },
  ],
  vip_lookalike: [
    {
      headline: 'Không Gian Thờ Tự Trang Nghiêm Của Hơn Hàng Trăm Gia Chủ Tinh Tế',
      hook: 'Dùng tệp khách đã mua làm hạt giống Lookalike 1%–3% để tìm gia chủ mới có cùng gu thẩm mỹ & thu nhập.',
      recommendedFormat: 'Video bàn giao thực tế tại nhà khách + Album ảnh không gian hoàn thiện',
      exclusionNote: 'Loại trừ trực tiếp tệp VIP gốc khỏi chiến dịch tìm khách mới để tránh lãng phí ngân sách.',
    },
  ],
  reengage_lost: [
    {
      headline: 'Ưu Đãi Đặt Sớm Theo Đợt Xưởng & Hỗ Trợ Lắp Đặt Tận Nhà',
      hook: 'Ra mắt dòng quy cách tối ưu ngân sách vẫn giữ trọn nét trang nghiêm và bảo hành dài hạn.',
      recommendedFormat: 'Ảnh so sánh quy cách rõ ràng / Collection kèm ưu đãi vận chuyển dịp lễ Tết',
      exclusionNote: 'Loại trừ khách đã mua nơi khác, không còn nhu cầu và khách Không liên hệ.',
    },
  ],
  suppressed: [
    {
      headline: 'Tệp Loại Trừ Bắt Buộc (Suppression List)',
      hook: 'Không phân phối bất kỳ quảng cáo bám đuổi nào tới nhóm này.',
      recommendedFormat: 'Không chạy quảng cáo',
      exclusionNote: 'Luôn loại trừ khỏi mọi chiến dịch Remarketing.',
    },
  ],
};

const PERSONA_AD_ANGLES: Readonly<Record<CustomerCareCrmPersona, CrmAdAngle[]>> = {
  P1: [
    {
      headline: 'Chuẩn Thước Lỗ Ban Cho Căn Hộ & Nhà Phố Mới Nhập Trạch',
      hook: 'Chọn đúng cung đẹp, tỷ lệ hài hòa trần chung cư/nhà phố và lắp đặt gọn sạch trước giờ nhập trạch.',
      recommendedFormat: 'Video tư vấn kích thước thực tế + Bảng tra cứu kích thước chuẩn',
      exclusionNote: 'Loại trừ tệp Đã giao hàng và tệp Không liên hệ.',
    },
  ],
  P2: [
    {
      headline: 'Giữ Gìn Nếp Nhà Trang Nghiêm Dịp Lễ Tết & Hiếu Kính Gia Tiên',
      hook: 'Chất liệu tuyển chọn bền bỉ qua nhiều thế hệ, hoàn thiện thủ công tỉ mỉ kịp đón Tết sum vầy.',
      recommendedFormat: 'Phim ngắn cảm xúc gia đình + Carousel bộ đầy đủ cho bàn thờ gia tiên',
      exclusionNote: 'Loại trừ tệp Không liên hệ và khách đã chốt đơn trong 30 ngày qua.',
    },
  ],
  P3: [
    {
      headline: 'Quà Tặng Tân Gia & Tri Ân Tinh Tế — Hộp Quà Sang Trọng Giao Đúng Hẹn',
      hook: 'Món quà mang ý nghĩa bình an, thịnh vượng kèm thiệp viết tay và đóng gói chỉn chu.',
      recommendedFormat: 'Video đập hộp quà tặng (Unboxing) + Ảnh chụp thực tế kèm hộp lụa',
      exclusionNote: 'Loại trừ tệp Không liên hệ.',
    },
  ],
  P4: [
    {
      headline: 'Giá Tận Xưởng Minh Bạch Từng Quy Cách — Kiểm Hàng Trước Khi Thanh Toán',
      hook: 'So sánh trực quan từng mức ngân sách để chọn đúng sản phẩm bền đẹp, không phát sinh chi phí ẩn.',
      recommendedFormat: 'Carousel bảng quy cách minh bạch + Video giải thích sự khác biệt chất liệu',
      exclusionNote: 'Loại trừ khách đã mua nơi khác và tệp Không liên hệ.',
    },
  ],
};

export function summarizeAdsAudiences(
  rows: readonly CustomerCareCrmRow[],
  products: readonly CrmEnterpriseProduct[] = [],
  nowMs: number = Date.now(),
): CrmAdsAudienceSummary {
  const buckets: Record<CrmAdsBucket, CrmAdsBucketSummary> = {
    high_intent: {
      bucket: 'high_intent',
      label: 'Khách ấm (Có số & Đang tư vấn)',
      description: 'Tệp khách đang cân nhắc, ưu tiên bám đuổi chốt đơn bằng video thực tế & chứng thực chất lượng.',
      count: 0,
      consentedCount: 0,
      leadIds: [],
      adAngles: BUCKET_AD_ANGLES.high_intent,
    },
    vip_lookalike: {
      bucket: 'vip_lookalike',
      label: 'Hạt giống VIP Lookalike 1%–3% (Đã cọc & Đã giao)',
      description: 'Dùng làm tệp gốc nhân bản Lookalike tìm khách mới và loại trừ khỏi chiến dịch thu hút khách lạnh.',
      count: 0,
      consentedCount: 0,
      leadIds: [],
      adAngles: BUCKET_AD_ANGLES.vip_lookalike,
    },
    reengage_lost: {
      bucket: 'reengage_lost',
      label: 'Đánh thức lại (Chưa chốt vì giá / ngắt quãng)',
      description: 'Tệp khách cũ có thể quay lại vào dịp ưu đãi xưởng hoặc mùa cao điểm Lễ Tết.',
      count: 0,
      consentedCount: 0,
      leadIds: [],
      adAngles: BUCKET_AD_ANGLES.reengage_lost,
    },
    suppressed: {
      bucket: 'suppressed',
      label: 'Đã chặn quảng cáo (Không liên hệ / Từ chối / Đã mua nơi khác)',
      description: 'Bị khóa xuất dữ liệu để bảo vệ quyền riêng tư và tránh lãng phí ngân sách.',
      count: 0,
      consentedCount: 0,
      leadIds: [],
      adAngles: BUCKET_AD_ANGLES.suppressed,
    },
  };

  const byPersona: Record<CustomerCareCrmPersona, CrmAdsPersonaSummary> = {
    P1: { persona: 'P1', label: CRM_PERSONA_OPTIONS[0]!.label, count: 0, consentedCount: 0, leadIds: [], adAngles: PERSONA_AD_ANGLES.P1 },
    P2: { persona: 'P2', label: CRM_PERSONA_OPTIONS[1]!.label, count: 0, consentedCount: 0, leadIds: [], adAngles: PERSONA_AD_ANGLES.P2 },
    P3: { persona: 'P3', label: CRM_PERSONA_OPTIONS[2]!.label, count: 0, consentedCount: 0, leadIds: [], adAngles: PERSONA_AD_ANGLES.P3 },
    P4: { persona: 'P4', label: CRM_PERSONA_OPTIONS[3]!.label, count: 0, consentedCount: 0, leadIds: [], adAngles: PERSONA_AD_ANGLES.P4 },
  };

  let consentedCount = 0;
  let unclassifiedCount = 0;

  for (const row of rows) {
    const bucket = classifyCrmAdsBucket(row);
    const consented = hasExplicitMarketingConsent(row);
    buckets[bucket].count += 1;
    buckets[bucket].leadIds.push(row.leadId);
    if (consented) {
      buckets[bucket].consentedCount += 1;
      consentedCount += 1;
    }

    if (bucket !== 'suppressed') {
      const portrait = buildCustomerPortrait(row, products, nowMs);
      const persona = portrait.layer_5_persona.persona;
      if (persona !== null) {
        byPersona[persona].count += 1;
        byPersona[persona].leadIds.push(row.leadId);
        if (consented) byPersona[persona].consentedCount += 1;
      } else {
        unclassifiedCount += 1;
      }
    }
  }

  return {
    totalRows: rows.length,
    consentedCount,
    suppressedCount: buckets.suppressed.count,
    buckets,
    byPersona,
    unclassifiedCount,
  };
}

export interface CrmMetaAudienceFilterObject {
  bucket?: Exclude<CrmAdsBucket, 'suppressed'> | 'suppressed' | 'all';
  persona?: CustomerCareCrmPersona | 'any';
  products?: readonly CrmEnterpriseProduct[];
  nowMs?: number;
}

export type CrmMetaAudienceFilter =
  | CrmAdsBucket
  | CustomerCareCrmPersona
  | 'all'
  | CrmMetaAudienceFilterObject;

export interface CrmMetaCustomAudienceCsvResult {
  csv: string;
  includedCount: number;
  excludedNoConsent: number;
  excludedSuppressed: number;
}

/** Normalizes Vietnamese mobile (`0xxxxxxxxx` / `+84xxxxxxxxx` / `84xxxxxxxxx`) to `84xxxxxxxxx` for Meta hashing. */
export function normalizeVietnamPhoneForMeta(rawPhone: string): string | null {
  const digits = rawPhone.replace(/[\s.-]/g, '').replace(/^\+/, '');
  if (/^0[35789]\d{8}$/.test(digits)) {
    return `84${digits.slice(1)}`;
  }
  if (/^84[35789]\d{8}$/.test(digits)) {
    return digits;
  }
  return null;
}

async function sha256HexLower(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Exports a Meta Custom Audience CSV (`phone` column with lowercase SHA-256 hex of `84xxxxxxxxx`).
 * Fail-closed: unconditionally requires `!isCrmRowAdsSuppressed(row)` and `hasExplicitMarketingConsent(row)`
 * on 100% of calls, with no option to bypass explicit consent.
 */
export async function buildMetaCustomAudienceCsv(
  rows: readonly CustomerCareCrmRow[],
  filterBucketOrPersona: CrmMetaAudienceFilter = 'all',
  options?: {
    products?: readonly CrmEnterpriseProduct[];
    nowMs?: number;
  },
): Promise<CrmMetaCustomAudienceCsvResult> {
  let targetBucket: CrmAdsBucket | 'all' = 'all';
  let targetPersona: CustomerCareCrmPersona | 'any' = 'any';
  const products = options?.products ?? (typeof filterBucketOrPersona === 'object' ? filterBucketOrPersona.products : undefined) ?? [];
  const nowMs = options?.nowMs ?? (typeof filterBucketOrPersona === 'object' ? filterBucketOrPersona.nowMs : undefined) ?? Date.now();

  if (typeof filterBucketOrPersona === 'string') {
    if (filterBucketOrPersona === 'all') {
      targetBucket = 'all';
    } else if (oneOf(CRM_ADS_BUCKETS, filterBucketOrPersona)) {
      targetBucket = filterBucketOrPersona;
    } else if (oneOf(CUSTOMER_CARE_CRM_PERSONAS, filterBucketOrPersona)) {
      targetPersona = filterBucketOrPersona;
    }
  } else if (filterBucketOrPersona && typeof filterBucketOrPersona === 'object') {
    if (filterBucketOrPersona.bucket) targetBucket = filterBucketOrPersona.bucket;
    if (filterBucketOrPersona.persona) targetPersona = filterBucketOrPersona.persona;
  }

  let excludedSuppressed = 0;
  let excludedNoConsent = 0;
  const seenNormalizedPhones = new Set<string>();
  const hashes: string[] = [];

  for (const row of rows) {
    if (targetPersona !== 'any') {
      const portrait = buildCustomerPortrait(row, products, nowMs);
      if (portrait.layer_5_persona.persona !== targetPersona) continue;
    }

    const bucket = classifyCrmAdsBucket(row);
    if (bucket === 'suppressed' || targetBucket === 'suppressed' || isCrmRowAdsSuppressed(row)) {
      excludedSuppressed += 1;
      continue;
    }

    if (targetBucket !== 'all' && bucket !== targetBucket) {
      continue;
    }

    if (!hasExplicitMarketingConsent(row)) {
      excludedNoConsent += 1;
      continue;
    }

    const normalizedPhone = normalizeVietnamPhoneForMeta(row.phone);
    if (!normalizedPhone || seenNormalizedPhones.has(normalizedPhone)) continue;
    seenNormalizedPhones.add(normalizedPhone);
    hashes.push(await sha256HexLower(normalizedPhone));
  }

  return {
    csv: ['phone', ...hashes].join('\n'),
    includedCount: hashes.length,
    excludedNoConsent,
    excludedSuppressed,
  };
}

// ---------------------------------------------------------------------------
// A3.3 Post-Sale Lifecycle & Remarketing Planner (`buildLifecyclePlan`)
// ---------------------------------------------------------------------------

export type CrmLifecycleCategory = 'post_sale' | 'remarketing';
export type CrmLifecycleChannel = 'messenger_24h' | 'zalo_or_call';

export interface CrmLifecycleItem {
  leadId: string;
  category: CrmLifecycleCategory;
  milestoneLabel: string;
  dueDay: string;
  isOverdue: boolean;
  channel: CrmLifecycleChannel;
  channelLabel: string;
  messageTemplate: string;
  suggestedNextStep: string;
  suggestedDueIso: string;
}

function resolveContactChannel(row: CustomerCareCrmRow, nowMs: number): {
  channel: CrmLifecycleChannel;
  channelLabel: string;
} {
  const lastMs = Date.parse(row.lastMessageAt);
  if (Number.isFinite(lastMs) && nowMs - lastMs < MESSENGER_SAFE_WINDOW_MS) {
    return {
      channel: 'messenger_24h',
      channelLabel: 'Messenger (còn trong khung 24h hợp lệ)',
    };
  }
  return {
    channel: 'zalo_or_call',
    channelLabel: row.zaloMentioned
      ? 'Zalo / Gọi điện (đã quá 23h Messenger — ưu tiên Zalo khách đã nhắn)'
      : 'Gọi điện / Zalo theo SĐT khách để lại (không spam Messenger ngoài 24h)',
  };
}

export function buildLifecyclePlan(
  rows: readonly CustomerCareCrmRow[],
  products: readonly CrmEnterpriseProduct[] = [],
  nowMs: number = Date.now(),
): CrmLifecycleItem[] {
  const items: CrmLifecycleItem[] = [];

  for (const row of rows) {
    if (isCrmRowAdsSuppressed(row)) continue;

    const portrait = buildCustomerPortrait(row, products, nowMs);
    const sal = portrait.layer_2_demographic.salutation;
    const salLower = sal === 'Anh/Chị' ? 'anh/chị' : sal.toLowerCase();
    const firstProd = cleanSingleLine(
      maskCrmPhones(
        portrait.layer_4_interests.matchedProducts[0]?.label
          ?? portrait.layer_4_interests.topicKeywords[0]
          ?? 'sản phẩm bên shop',
      ),
      56,
    );
    const { channel, channelLabel } = resolveContactChannel(row, nowMs);
    const { stage, purchasedAt, lostReason } = row.profile;

    if (stage === 'deposit' || stage === 'delivered') {
      const anchorMs = purchasedAt !== null && Number.isFinite(Date.parse(`${purchasedAt}T09:00:00+07:00`))
        ? Date.parse(`${purchasedAt}T09:00:00+07:00`)
        : Date.parse(row.lastMessageAt);
      const safeAnchorMs = Number.isFinite(anchorMs) ? anchorMs : nowMs;

      const postSaleMilestones: ReadonlyArray<{
        offsetDays: number;
        milestoneLabel: string;
        messageTemplate: string;
        nextStep: string;
      }> = [
        {
          offsetDays: 1,
          milestoneLabel: 'N+1 · Kiểm tra nhận hàng/lắp đặt & hướng dẫn bảo quản',
          messageTemplate: `Dạ em chào ${salLower}, em nhắn hỏi thăm ${firstProd} bên mình nhận/lắp đặt đã ưng ý hoàn toàn chưa ạ? Em gửi kèm lưu ý vệ sinh & bảo quản để ${firstProd} luôn bền đẹp ạ.`,
          nextStep: `Chăm sóc N+1: kiểm tra lắp đặt & gửi hướng dẫn bảo quản cho ${sal}`,
        },
        {
          offsetDays: 7,
          milestoneLabel: 'N+7 · Xin ảnh thực tế & gửi ưu đãi giới thiệu người thân',
          messageTemplate: `Dạ ${salLower} ơi, sau 1 tuần bài trí ${firstProd}, nếu tiện ${salLower} cho shop xin 1 tấm ảnh không gian thực tế làm kỷ niệm nhé ạ. Shop xin gửi tặng mã ưu đãi tri ân khi ${salLower} giới thiệu bạn bè/người thân ạ!`,
          nextStep: `Chăm sóc N+7: xin ảnh thực tế & gửi ưu đãi giới thiệu cho ${sal}`,
        },
        {
          offsetDays: 30,
          milestoneLabel: 'N+30 / Trước Tết & Dịp lễ · Nhắc bảo dưỡng & tri ân khách cũ',
          messageTemplate: `Dạ nhân dịp sắp tới kỳ lễ/Tết, shop gửi ${salLower} mẹo lau dọn bảo dưỡng ${firstProd} sáng đẹp đón lộc và ưu đãi dành riêng cho khách hàng thân thiết của shop ạ.`,
          nextStep: `Chăm sóc N+30 / Lễ Tết: nhắc bảo dưỡng & gửi quà tri ân cho ${sal}`,
        },
      ];

      for (const m of postSaleMilestones) {
        const dueMs = safeAnchorMs + m.offsetDays * DAY_MS;
        const isOverdue = dueMs < nowMs;
        items.push({
          leadId: row.leadId,
          category: 'post_sale',
          milestoneLabel: m.milestoneLabel,
          dueDay: vietnamDateKey(dueMs),
          isOverdue,
          channel,
          channelLabel,
          messageTemplate: m.messageTemplate,
          suggestedNextStep: cleanSingleLine(m.nextStep, CARE_CRM_MAX_NEXT_STEP),
          suggestedDueIso: clampFutureIso(dueMs, nowMs),
        });
      }
      continue;
    }

    if (stage === 'consulting') {
      const lastMs = Date.parse(row.lastMessageAt);
      if (Number.isFinite(lastMs) && nowMs - lastMs >= CONSULTING_STALE_MS) {
        const dueMs = lastMs + CONSULTING_STALE_MS;
        items.push({
          leadId: row.leadId,
          category: 'remarketing',
          milestoneLabel: 'Tư vấn >48h chưa phản hồi · Gửi video thực tế khơi gợi lại',
          dueDay: vietnamDateKey(dueMs),
          isOverdue: true,
          channel,
          channelLabel,
          messageTemplate: `Dạ em chào ${salLower}, hôm trước mình đang xem dở ${firstProd} — xưởng vừa hoàn thiện mẻ mới đẹp sắc nét, em gửi ${salLower} xem video thực tế để mình dễ cân nhắc nhé ạ.`,
          suggestedNextStep: cleanSingleLine(`Remarketing >48h: gửi video thực tế ${firstProd} cho ${sal}`, CARE_CRM_MAX_NEXT_STEP),
          suggestedDueIso: clampFutureIso(nowMs + 2 * HOUR_MS, nowMs),
        });
      }
      continue;
    }

    if (stage === 'lost') {
      const reasonLabel = lostReason === 'price'
        ? 'Chưa chốt vì giá · Giới thiệu quy cách tối ưu ngân sách / ưu đãi đợt xưởng'
        : lostReason === 'no_reply'
          ? 'Khách ngắt quãng phản hồi · Hỏi thăm nhẹ không gây áp lực'
          : 'Khách tạm hoãn mua · Cập nhật mẫu mới dịp Lễ Tết';

      const messageTemplate = lostReason === 'price'
        ? `Dạ em chào ${salLower}, đợt này xưởng có thêm phiên bản ${firstProd} tối ưu chi phí rất hợp ngân sách mà vẫn bảo hành đầy đủ — nếu ${salLower} còn quan tâm em gửi ảnh kèm giá mới để mình tham khảo nhé ạ.`
        : lostReason === 'no_reply'
          ? `Dạ em chào ${salLower}, em nhắn ngắn hỏi thăm xem mình đã chọn được ${firstProd} ưng ý chưa ạ? Nếu cần đo lại kích thước hoặc xem mẫu thực tế ${salLower} cứ nhắn em hỗ trợ ngay nhé ạ.`
          : `Dạ em chào ${salLower}, sắp tới mùa cao điểm sửa sang không gian gia đình, nếu mình cần xem lại mẫu ${firstProd} hoặc đặt lịch trước để kịp ngày đẹp thì báo em giữ ưu đãi nhé ạ.`;

      items.push({
        leadId: row.leadId,
        category: 'remarketing',
        milestoneLabel: reasonLabel,
        dueDay: vietnamDateKey(nowMs),
        isOverdue: true,
        channel,
        channelLabel,
        messageTemplate,
        suggestedNextStep: cleanSingleLine(`Remarketing khách cũ: hỏi thăm nhu cầu ${firstProd} của ${sal}`, CARE_CRM_MAX_NEXT_STEP),
        suggestedDueIso: clampFutureIso(nowMs + 4 * HOUR_MS, nowMs),
      });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// B1. Zero-PII CRM Segments Summary for `MyGraph → Memory doanh nghiệp`
// ---------------------------------------------------------------------------

export interface CareCrmSegmentSummary {
  totalLeads: number;
  leadsCapped: boolean;
  byStage: Record<CustomerCareCrmStage, number>;
  byPersona: Record<CustomerCareCrmPersona | 'unclassified', number>;
  adsBuckets: {
    highIntent: number;
    vipLookalike: number;
    reengageLost: number;
    consented: number;
    suppressed: number;
  };
  lifecycleDue: {
    postSale: number;
    remarketing: number;
  };
}

/**
 * Pure counts-only summary of CRM rows for MyGraph business memory.
 * Never carries phones, names, chat text, notes, urls, leadIds or workspaceIds.
 */
export function summarizeCareCrmSegments(
  rows: readonly CustomerCareCrmRow[],
  products: readonly CrmEnterpriseProduct[] = [],
  nowMs: number = Date.now(),
  leadsCapped = false,
): CareCrmSegmentSummary {
  const byStage: Record<CustomerCareCrmStage, number> = {
    has_phone: 0,
    consulting: 0,
    deposit: 0,
    delivered: 0,
    lost: 0,
    do_not_contact: 0,
  };
  for (const row of rows) {
    if (oneOf(CUSTOMER_CARE_CRM_STAGES, row.profile.stage)) {
      byStage[row.profile.stage] += 1;
    }
  }

  const ads = summarizeAdsAudiences(rows, products, nowMs);
  const byPersona: Record<CustomerCareCrmPersona | 'unclassified', number> = {
    P1: ads.byPersona.P1.count,
    P2: ads.byPersona.P2.count,
    P3: ads.byPersona.P3.count,
    P4: ads.byPersona.P4.count,
    unclassified: ads.unclassifiedCount + ads.buckets.suppressed.count,
  };

  // Include suppressed rows' personas? No — keeping suppressed leads out of active P1–P4 marketing counts
  // (and counting only actionable lifecycle items due now or within 48 hours) keeps Director numbers clean.
  const plan = buildLifecyclePlan(rows, products, nowMs);
  const todayKey = vietnamDateKey(nowMs);
  const tomorrowKey = vietnamDateKey(nowMs + DAY_MS);

  let postSaleDue = 0;
  let remarketingDue = 0;
  for (const item of plan) {
    if (item.category === 'post_sale') {
      if (item.isOverdue || item.dueDay === todayKey || item.dueDay === tomorrowKey) {
        postSaleDue += 1;
      }
    } else if (item.isOverdue || item.dueDay <= todayKey) {
      remarketingDue += 1;
    }
  }

  return {
    totalLeads: rows.length,
    leadsCapped,
    byStage,
    byPersona,
    adsBuckets: {
      highIntent: ads.buckets.high_intent.count,
      vipLookalike: ads.buckets.vip_lookalike.count,
      reengageLost: ads.buckets.reengage_lost.count,
      consented: ads.consentedCount,
      suppressed: ads.buckets.suppressed.count,
    },
    lifecycleDue: {
      postSale: postSaleDue,
      remarketing: remarketingDue,
    },
  };
}
