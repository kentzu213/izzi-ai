/**
 * Enterprise CRM intelligence & workflow engine (pure TypeScript, runtime-agnostic).
 *
 * Runs identically in Renderer (Chromium) and Main (Node) without `node:crypto` or network I/O:
 * - A1: `[izzi-ctx: v=1; ...]` codec inside `profile.note`: only a timeline and a recorded refusal (never consent)
 * - A2: 5-layer customer portrait (`buildCustomerPortrait`): server identity first, profile layer only after consent
 * - A3: Saler Playbook, Ads Audience Segmentation & SHA-256 Meta CSV export, and Lifecycle / Remarketing planner
 * - B1: Zero-PII CRM segment aggregation (`summarizeCareCrmSegments`) for `MyGraph → Memory doanh nghiệp`
 */

import {
  CUSTOMER_CARE_CRM_ADDRESS_FORMS,
  CUSTOMER_CARE_CRM_AGE_BANDS,
  CUSTOMER_CARE_CRM_BUDGET_BANDS,
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
  type CustomerCareCrmIdConfidence,
  type CustomerCareCrmIdField,
  type CustomerCareCrmIdentity,
  type CustomerCareCrmOccasion,
  type CustomerCareCrmPersona,
  type CustomerCareCrmProfileInput,
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

/** A refusal staff recorded in the note (beta.121). It only ever withholds; a note can never grant consent. */
export type CrmStaffRefusal = 'declined' | 'withdrawn';
const CRM_STAFF_REFUSALS: readonly CrmStaffRefusal[] = ['declined', 'withdrawn'];

/**
 * What the `[izzi-ctx]` tag may still carry: an order-layer timeline and a refusal. beta.121 also wrote profile-layer
 * keys (persona, age, recipient, budget, ad, domain) and `consent=granted` without the customer's consent; those are
 * ignored when read and dropped on the next save of the note.
 */
export interface CrmStaffContext {
  timeline: CustomerCareCrmTimeline | null;
  consent: CrmStaffRefusal | null;
}

export const EMPTY_CRM_STAFF_CONTEXT: Readonly<CrmStaffContext> = {
  timeline: null,
  consent: null,
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
    timeline: oneOf(CUSTOMER_CARE_CRM_TIMELINES, ctx.timeline) ? ctx.timeline : null,
    consent: oneOf(CRM_STAFF_REFUSALS, ctx.consent) ? ctx.consent : null,
  };
}

// ---------------------------------------------------------------------------
// A1. `[izzi-ctx]` Codec on `profile.note`
// ---------------------------------------------------------------------------

/** Reads `timeline` and a refusal; every other key (beta.121 profile-layer keys, `consent=granted`) is ignored. */
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
      case 'timeline':
        if (oneOf(CUSTOMER_CARE_CRM_TIMELINES, rawValue)) draft.timeline = rawValue;
        break;
      case 'consent':
        if (oneOf(CRM_STAFF_REFUSALS, rawValue)) draft.consent = rawValue;
        break;
      default:
        break;
    }
  }
  return sanitizeStaffContext(draft);
}

export function formatStaffContextTag(rawCtx: CrmStaffContext): string | null {
  const ctx = sanitizeStaffContext(rawCtx);
  const parts: string[] = [];
  if (ctx.timeline !== null) parts.push(`timeline=${ctx.timeline}`);
  if (ctx.consent !== null) parts.push(`consent=${ctx.consent}`);
  if (parts.length === 0) return null;
  return `[izzi-ctx: v=1; ${parts.join('; ')}]`;
}

/**
 * Splits `profile.note` into clean staff-visible `freeNote` (with all `[izzi-ctx: ...]` lines removed anywhere)
 * and validated `ctx`: the timeline from the last `[izzi-ctx: ...]` tag line, and a refusal from any of them (a later
 * tag never cancels a refusal).
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
  let refusal: CrmStaffRefusal | null = null;
  const keptLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = CTX_LINE_PATTERN.exec(trimmed);
    if (match) {
      ctx = parseStaffContextTagBody(match[1] ?? '');
      refusal = ctx.consent ?? refusal;
      continue;
    }
    if (CTX_ANY_LINE_PATTERN.test(trimmed)) {
      continue;
    }
    keptLines.push(line);
  }

  const freeNote = keptLines.join('\n').trim();
  return { freeNote, ctx: { ...ctx, consent: refusal } };
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

/**
 * A note on its way to the server. When it carries an `[izzi-ctx]` line the tag is written again from what the codec
 * reads (a timeline and a refusal), so the keys beta.121 left behind (persona, age, recipient, budget, ad, domain,
 * `consent=granted`) are dropped; a note without one is returned exactly as it is.
 */
export function normalizeCrmNoteTags(note: string | null): string | null {
  if (note === null) return null;
  const tagged = note.replace(/\r\n?/g, '\n').split('\n').some((line) => CTX_ANY_LINE_PATTERN.test(line.trim()));
  return tagged ? replaceEditableFreeNote(note, extractEditableFreeNote(note)) : note;
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
// A2. Customer portrait (`buildCustomerPortrait`): the server identity first, behind the consent gate
// ---------------------------------------------------------------------------
//
// Care CRM S3 (docs/CARE-CRM-S3-IDENTITY.md): the server's identity is the one source of truth. While the AI profile
// is on, the order layer (products, occasion, timeline) is the server's and this file's chat guesses fill only what
// it left empty; while it is off, or for a row without identity, the order layer is guessed from the chat. Those
// guesses need no consent. The profile layer (age band, who the purchase is for, interests, persona) exists only
// after the customer tapped "Đồng ý", so it is never guessed here: there is no gender, an age is a band labelled
// "ước tính", "who it is for" stands only with a quote of the customer's own words, and a social-network link keeps
// its domain.

export type CrmReasoningSource = 'staff' | 'identity' | 'chat' | 'note' | 'none';

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
  /** One band or two adjacent ones, from the server, after consent; always shown as an estimate. */
  ageBands: CustomerCareCrmAgeBand[];
}

export interface CrmPortraitLayer2Demographic extends CrmPortraitLayerBase {
  step: 2;
  addressForm: CustomerCareCrmAddressForm | null;
  salutation: string;
}

export interface CrmPortraitLayer3Household extends CrmPortraitLayerBase {
  step: 3;
  /** Who the purchase is for, only with a quote of the customer's own words. Never marital status. */
  recipient: CustomerCareCrmRecipient | null;
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
  missingPrompts: string[];
}

export interface CrmCustomerPortrait {
  layer_1_age: CrmPortraitLayer1Age;
  layer_2_demographic: CrmPortraitLayer2Demographic;
  layer_3_household: CrmPortraitLayer3Household;
  layer_4_interests: CrmPortraitLayer4Interests;
  layer_5_persona: CrmPortraitLayer5Persona;
  /** Whether the profile layer could be used for this row (see `crmProfileLayerAllowed`). */
  profileAllowed: boolean;
  missingPrompts: string[];
}

const PROFILE_LOCKED_LABEL = 'Chỉ có khi khách đồng ý';
const PROFILE_LOCKED_REASON = 'Phần hồ sơ này chỉ có sau khi khách bấm "Đồng ý".';

const SALUTATIONS: Readonly<Record<CustomerCareCrmAddressForm, string>> = {
  anh: 'Anh',
  chi: 'Chị',
  co: 'Cô',
  chu: 'Chú',
  ban: 'Bạn',
};

const RECIPIENT_LABELS: Readonly<Record<CustomerCareCrmRecipient, string>> = {
  self: 'Mua cho mình',
  spouse: 'Mua cùng vợ/chồng',
  parents: 'Mua biếu bố mẹ',
  children: 'Mua cho con',
  household: 'Sắm cho gia đình',
  gift: 'Mua làm quà biếu',
};

/**
 * Social networks: any link there may lead to a person, so it keeps its domain only, never a title. Every subdomain
 * counts. Mirrors the server (backend 84c2523).
 */
const CRM_SOCIAL_DOMAINS = ['facebook.com', 'fb.com', 'fb.me', 'fb.watch', 'm.me', 'instagram.com', 'threads.net', 'zalo.me', 'tiktok.com'];

export function isCrmSocialDomain(domain: string): boolean {
  return CRM_SOCIAL_DOMAINS.some((social) => domain === social || domain.endsWith(`.${social}`));
}

/** The row's identity as the server sent it; null when it sent none or the identity could not be read. */
export function crmServerIdentity(row: CustomerCareCrmRow): CustomerCareCrmIdentity | null {
  return row.identityUnavailable === true ? null : row.identity ?? null;
}

/** The profile layer may be shown and used: the server says the customer agreed and asked for nothing to be erased. */
export function crmProfileLayerAllowed(row: CustomerCareCrmRow): boolean {
  const consent = crmServerIdentity(row)?.consent;
  return consent?.state === 'granted' && (consent.eraseRequestedAt ?? null) === null;
}

function isShownField<T>(field: CustomerCareCrmIdField<T> | null | undefined): field is CustomerCareCrmIdField<T> {
  if (!field || typeof field !== 'object') return false;
  return (field.confidence === 'high' || field.confidence === 'medium')
    && oneOf(CUSTOMER_CARE_CRM_ID_KINDS, field.kind)
    && oneOf(CUSTOMER_CARE_CRM_ID_SOURCES, field.source)
    && oneOf(CUSTOMER_CARE_CRM_ID_STATUSES, field.status);
}

/** The persona P1–P4 from the server, only after consent; never guessed on the desktop. */
export function crmConsentedPersona(row: CustomerCareCrmRow): CustomerCareCrmPersona | null {
  if (!crmProfileLayerAllowed(row)) return null;
  const field = crmServerIdentity(row)?.persona;
  return isShownField(field) && oneOf(CUSTOMER_CARE_CRM_PERSONAS, field.value) ? field.value : null;
}

function fieldSource(field: CustomerCareCrmIdField<unknown>): CrmReasoningSource {
  return field.source === 'staff' ? 'staff' : 'identity';
}

function firstFieldQuote(field: CustomerCareCrmIdField<unknown>): string | null {
  for (const ev of field.evidence) {
    const cleaned = ev && typeof ev.quote === 'string' ? safeQuote(ev.quote) : null;
    if (cleaned) return cleaned;
  }
  return null;
}

/** A quote of the customer's own words (evidence from the customer), masked and free of sensitive terms. */
function customerQuote(field: CustomerCareCrmIdField<unknown>): string | null {
  for (const ev of field.evidence) {
    const cleaned = ev && ev.source === 'customer' && typeof ev.quote === 'string' ? safeQuote(ev.quote) : null;
    if (cleaned) return cleaned;
  }
  return null;
}

function formatAgeBandsLabel(bands: readonly CustomerCareCrmAgeBand[]): string {
  const first = bands[0]!;
  const last = bands[bands.length - 1]!;
  const rangeText = bands.length === 1
    ? (first === '55+' ? '55+ tuổi' : `${first.replace('-', '–')} tuổi`)
    : (last === '55+' ? `${first.split('-')[0]}+ tuổi` : `${first.split('-')[0]}–${last.split('-')[1]} tuổi`);
  return `${rangeText} (ước tính)`;
}

function vietnamDateKey(ms: number): string {
  return new Date(ms + VIETNAM_OFFSET_MS).toISOString().slice(0, 10);
}

function buildLayer1Age(identity: CustomerCareCrmIdentity | null, allowed: boolean): CrmPortraitLayer1Age {
  const title = 'Tầng 1 · Độ tuổi (ước tính)';
  const field = allowed ? identity?.ageBand : null;
  const bands = isShownField(field) && Array.isArray(field.value)
    ? field.value.filter((band): band is CustomerCareCrmAgeBand => oneOf(CUSTOMER_CARE_CRM_AGE_BANDS, band)).slice(0, 2)
    : [];
  if (!isShownField(field) || bands.length === 0) {
    return {
      step: 1,
      title,
      ageBands: [],
      label: allowed ? 'Chưa rõ' : PROFILE_LOCKED_LABEL,
      confidence: null,
      source: 'none',
      quote: null,
      reasoning: allowed ? 'AI chưa ước tính được nhóm tuổi.' : PROFILE_LOCKED_REASON,
    };
  }
  return {
    step: 1,
    title,
    ageBands: bands,
    label: formatAgeBandsLabel(bands),
    confidence: field.confidence,
    source: fieldSource(field),
    quote: firstFieldQuote(field),
    reasoning: 'Nhóm tuổi ước tính từ hồ sơ AI đã được khách đồng ý.',
  };
}

function buildLayer2AddressForm(
  row: CustomerCareCrmRow,
  identity: CustomerCareCrmIdentity | null,
  allowed: boolean,
): CrmPortraitLayer2Demographic {
  const title = 'Tầng 2 · Xưng hô';
  if (row.profile.addressForm !== null) {
    const salutation = SALUTATIONS[row.profile.addressForm];
    return {
      step: 2,
      title,
      addressForm: row.profile.addressForm,
      salutation,
      label: `Xưng ${salutation}`,
      confidence: 'high',
      source: 'staff',
      quote: null,
      reasoning: 'Nhân viên đã chọn cách xưng hô trên hồ sơ.',
    };
  }
  const field = allowed ? identity?.addressForm : null;
  if (isShownField(field) && oneOf(CUSTOMER_CARE_CRM_ADDRESS_FORMS, field.value)) {
    const salutation = SALUTATIONS[field.value];
    return {
      step: 2,
      title,
      addressForm: field.value,
      salutation,
      label: `${field.status === 'suggested' ? 'Gợi ý' : 'Xưng'} ${salutation}`,
      confidence: field.confidence,
      source: fieldSource(field),
      quote: firstFieldQuote(field),
      reasoning: 'Cách xưng hô trong hồ sơ AI đã được khách đồng ý.',
    };
  }
  return {
    step: 2,
    title,
    addressForm: null,
    salutation: 'Anh/Chị',
    label: 'Chưa rõ · Tạm xưng Anh/Chị',
    confidence: null,
    source: 'none',
    quote: null,
    reasoning: 'Chưa có cách xưng hô do nhân viên chọn.',
  };
}

function buildLayer3Recipient(identity: CustomerCareCrmIdentity | null, allowed: boolean): CrmPortraitLayer3Household {
  const title = 'Tầng 3 · Mua cho ai';
  const field = allowed ? identity?.family : null;
  const recipient = isShownField(field) && field.value && oneOf(CUSTOMER_CARE_CRM_RECIPIENTS, field.value.recipient)
    ? field.value.recipient
    : null;
  const quote = recipient !== null && isShownField(field) ? customerQuote(field) : null;
  if (recipient === null || quote === null || !isShownField(field)) {
    return {
      step: 3,
      title,
      recipient: null,
      label: allowed ? 'Khách chưa nói mua cho ai' : PROFILE_LOCKED_LABEL,
      confidence: null,
      source: 'none',
      quote: null,
      reasoning: allowed ? 'Chỉ ghi khi khách tự nói, kèm lời của khách.' : PROFILE_LOCKED_REASON,
    };
  }
  return {
    step: 3,
    title,
    recipient,
    label: RECIPIENT_LABELS[recipient],
    confidence: field.confidence,
    source: fieldSource(field),
    quote,
    reasoning: 'Theo lời khách nói, trong hồ sơ AI đã được khách đồng ý.',
  };
}

function normalizeMatchTokens(text: string): string[] {
  const stop = new Set([
    'bo', 'cai', 'chiec', 'mau', 'gia', 'bao', 'nhieu', 'trieu', 'dong', 'vnd', 'cm', 'mm',
    'cho', 'cua', 'shop', 'anh', 'chi', 'em', 'minh', 'loai', 'hang', 'san', 'pham',
  ]);
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
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

function inferTimelineFromText(segments: readonly TextSegment[]): CustomerCareCrmTimeline | null {
  for (const seg of segments) {
    if (/(?:trước\s+tết|kịp\s+tết|đón\s+tết|sắm\s+tết|dịp\s+tết|cuối\s+năm)/iu.test(seg.text)) return 'before_tet';
    if (/(?:trong\s+tuần\s+này|cuối\s+tuần\s+này|ngày\s+mai|giao\s+ngay|cần\s+gấp)/iu.test(seg.text)) return 'this_week';
    if (/(?:trong\s+tháng\s+này|cuối\s+tháng|tháng\s+tới|tháng\s+sau)/iu.test(seg.text)) return 'this_month';
    if (/(?:chưa\s+gấp|tham\s+khảo\s+trước|xem\s+trước|khi\s+nào\s+xong\s+nhà)/iu.test(seg.text)) return 'later';
  }
  return null;
}

/** The #85 occasion cues, in its order (gift, new home or replacement, Tết, giỗ). */
const OCCASION_CUES: ReadonlyArray<{ pattern: RegExp; occasion: CustomerCareCrmOccasion }> = [
  { pattern: /(?:hộp\s+quà|quà\s+tân\s+gia|tặng\s+tân\s+gia|biếu\s+sếp|làm\s+quà|quà\s+tặng|mua\s+tặng)/iu, occasion: 'gift' },
  { pattern: /(?:nhập\s+trạch|nhà\s+mới|căn\s+hộ\s+mới|chung\s+cư\s+mới|phòng\s+thờ\s+mới)/iu, occasion: 'new_home' },
  { pattern: /(?:thay\s+bàn\s+thờ|thay\s+đồ\s+thờ)/iu, occasion: 'replacement' },
  { pattern: /(?:sắm\s+tết|dịp\s+tết|đón\s+tết|kịp\s+tết|trước\s+tết)/iu, occasion: 'tet' },
  { pattern: /(?:cúng\s+giỗ|đám\s+giỗ|ngày\s+giỗ|làm\s+giỗ)/iu, occasion: 'anniversary' },
];

/** An occasion guessed from plain order talk. A sentence with a sensitive term (a death, an illness...) is never read. */
function inferOccasionFromText(segments: readonly TextSegment[]): CustomerCareCrmOccasion | null {
  for (const seg of segments) {
    if (containsSensitiveHouseholdTerm(seg.text)) continue;
    const cue = OCCASION_CUES.find((item) => item.pattern.test(seg.text));
    if (cue) return cue.occasion;
  }
  return null;
}

function timelineFromNeededBy(neededBy: string | null, occasion: CustomerCareCrmOccasion | null, nowMs: number): CustomerCareCrmTimeline | null {
  if (neededBy === null) return occasion === 'tet' ? 'before_tet' : null;
  const dueMs = Date.parse(`${neededBy}T23:59:59+07:00`);
  if (!Number.isFinite(dueMs)) return null;
  const diffDays = (dueMs - nowMs) / DAY_MS;
  if (diffDays <= 7) return 'this_week';
  if (diffDays <= 31) return 'this_month';
  return occasion === 'tet' ? 'before_tet' : 'later';
}

/**
 * Products the customer asked about: the staff's picks, plus the server's while the AI profile is on, or a match on
 * the chat when the server has none to give. `guessed` says the chat was used.
 */
function orderLayerProducts(
  row: CustomerCareCrmRow,
  orderIdentity: CustomerCareCrmIdentity | null,
  segments: readonly TextSegment[],
  products: readonly CrmEnterpriseProduct[],
): { matched: CrmEnterpriseProduct[]; guessed: boolean } {
  const known = new Set(products.map((product) => product.id));
  const matched = new Set(row.profile.productFactIds.filter((id) => known.has(id)));
  const field = orderIdentity?.productFactIds;
  const server = isShownField(field) && Array.isArray(field.value)
    ? field.value.filter((id): id is string => typeof id === 'string' && known.has(id))
    : [];
  const guessed = server.length === 0;
  if (guessed) {
    const corpusTokens = new Set(normalizeMatchTokens(segments.map((seg) => seg.text).join('\n')));
    for (const product of products) {
      const tokens = normalizeMatchTokens(product.label);
      const overlap = tokens.filter((token) => corpusTokens.has(token)).length;
      if ((tokens.length === 1 && overlap === 1) || overlap >= 2) matched.add(product.id);
    }
  } else {
    for (const id of server) matched.add(id);
  }
  return { matched: products.filter((product) => matched.has(product.id)), guessed };
}

/** The source ad, links the customer shared and a budget band: profile layer, from the server, after consent. */
function profileInterests(identity: CustomerCareCrmIdentity | null, allowed: boolean): {
  adTitle: string | null;
  sharedLinks: CustomerCareCrmSharedLink[];
  budgetBand: CustomerCareCrmBudgetBand | null;
  budgetQuote: string | null;
} {
  const interests = allowed ? identity?.interests ?? null : null;
  if (interests === null) return { adTitle: null, sharedLinks: [], budgetBand: null, budgetQuote: null };
  const adTitle = isShownField(interests.adTitle) ? sanitizeCtxAdTitle(interests.adTitle.value) : null;
  const sharedLinks: CustomerCareCrmSharedLink[] = [];
  for (const field of Array.isArray(interests.sharedLinks) ? interests.sharedLinks : []) {
    if (sharedLinks.length >= 3) break;
    if (!isShownField(field) || !field.value) continue;
    const domain = sanitizeCtxDomain(field.value.domain);
    if (domain === null) continue;
    const title = isCrmSocialDomain(domain) || !field.value.title ? null : sanitizeCtxAdTitle(field.value.title);
    sharedLinks.push({ domain, title });
  }
  const budget = interests.budgetBand;
  const budgetBand = isShownField(budget) && oneOf(CUSTOMER_CARE_CRM_BUDGET_BANDS, budget.value) ? budget.value : null;
  return { adTitle, sharedLinks, budgetBand, budgetQuote: budgetBand !== null && isShownField(budget) ? firstFieldQuote(budget) : null };
}

function buildLayer4Interests(
  row: CustomerCareCrmRow,
  identity: CustomerCareCrmIdentity | null,
  orderIdentity: CustomerCareCrmIdentity | null,
  allowed: boolean,
  ctx: CrmStaffContext,
  segments: readonly TextSegment[],
  products: readonly CrmEnterpriseProduct[],
  nowMs: number,
): CrmPortraitLayer4Interests {
  // Order layer (no consent needed): staff first, then the server while the AI profile is on, then a chat guess.
  const { matched: matchedProducts, guessed: productsGuessed } = orderLayerProducts(row, orderIdentity, segments, products);
  const corpus = segments.map((seg) => seg.text).join('\n');
  const topicKeywords = productsGuessed
    ? DOMAIN_PRODUCT_KEYWORDS.filter((item) => item.pattern.test(corpus)).map((item) => item.label)
    : [];

  const idOccasion = orderIdentity?.occasion;
  const serverOccasion = isShownField(idOccasion) && oneOf(CUSTOMER_CARE_CRM_OCCASIONS, idOccasion.value) ? idOccasion.value : null;
  const occasion = row.profile.occasion ?? serverOccasion ?? inferOccasionFromText(segments);

  const idTimeline = orderIdentity?.timeline;
  const serverTimeline = isShownField(idTimeline) && oneOf(CUSTOMER_CARE_CRM_TIMELINES, idTimeline.value) ? idTimeline.value : null;
  const timeline = serverTimeline
    ?? ctx.timeline
    ?? timelineFromNeededBy(row.profile.neededBy, occasion, nowMs)
    ?? inferTimelineFromText(segments);

  const { adTitle, sharedLinks, budgetBand, budgetQuote } = profileInterests(identity, allowed);

  const parts: string[] = [];
  if (matchedProducts.length > 0) {
    parts.push(`Sản phẩm: ${matchedProducts.map((product) => cleanSingleLine(maskCrmPhones(product.label), 48)).join(', ')}`);
  } else if (topicKeywords.length > 0) {
    parts.push(`Quan tâm: ${topicKeywords.slice(0, 3).join(', ')}`);
  }
  if (adTitle) parts.push(`QC: ${adTitle}`);
  if (sharedLinks.length > 0) parts.push(`Link: ${sharedLinks.map((link) => (link.title ? `${link.title} (${link.domain})` : link.domain)).join(', ')}`);
  if (budgetBand) parts.push(`Ngân sách: ${BUDGET_LABELS[budgetBand]}`);
  if (timeline) parts.push(`Thời hạn: ${TIMELINE_LABELS[timeline]}`);

  const staffSet = row.profile.productFactIds.length > 0 || row.profile.occasion !== null || row.profile.neededBy !== null || ctx.timeline !== null;
  const serverSet = serverOccasion !== null || serverTimeline !== null || !productsGuessed
    || adTitle !== null || sharedLinks.length > 0 || budgetBand !== null;
  const hasAny = parts.length > 0 || occasion !== null;
  const source: CrmReasoningSource = staffSet ? 'staff' : serverSet ? 'identity' : hasAny ? 'chat' : 'none';

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
    label: parts.length > 0 ? parts.join(' · ') : 'Chưa ghi nhận sản phẩm hoặc thời hạn cụ thể',
    confidence: hasAny ? (source === 'staff' ? 'high' : 'medium') : null,
    source,
    quote: budgetQuote,
    reasoning: hasAny
      ? 'Từ sản phẩm, dịp và thời hạn trên hồ sơ; quảng cáo, link và ngân sách chỉ khi khách đã đồng ý.'
      : 'Cần hỏi thêm mẫu khách quan tâm và thời điểm cần nhận hàng.',
  };
}

/** Order-layer questions only: the desktop never prompts staff to collect profile data the customer has not agreed to. */
function buildMissingPrompts(layer2: CrmPortraitLayer2Demographic, layer4: CrmPortraitLayer4Interests): string[] {
  const sal = layer2.salutation === 'Anh/Chị' ? 'anh/chị' : layer2.salutation.toLowerCase();
  const prompts: string[] = [];
  if (layer4.matchedProducts.length === 0 && layer4.topicKeywords.length === 0) {
    prompts.push(`Dạ ${sal} đang quan tâm mẫu nào hoặc kích thước khoảng bao nhiêu để em gửi ảnh thực tế ạ?`);
  }
  if (layer4.occasion === null && layer4.timeline === null && layer4.neededBy === null) {
    prompts.push(`Dạ ${sal} dự kiến sắm cho dịp nào và cần nhận trước ngày nào ạ?`);
  }
  if (layer2.addressForm === null) {
    prompts.push('Dạ em xin phép hỏi mình tiện xưng hô là Anh hay Chị để em hỗ trợ chu đáo ạ?');
  }
  return prompts;
}

function buildLayer5Persona(row: CustomerCareCrmRow, allowed: boolean, missingPrompts: string[]): CrmPortraitLayer5Persona {
  const title = 'Tầng 5 · Chân dung (P1–P4)';
  const persona = crmConsentedPersona(row);
  const field = crmServerIdentity(row)?.persona;
  if (persona === null || !isShownField(field)) {
    return {
      step: 5,
      title,
      persona: null,
      label: allowed ? 'Chưa xếp nhóm P1–P4' : PROFILE_LOCKED_LABEL,
      confidence: null,
      source: 'none',
      quote: null,
      reasoning: allowed ? 'AI chưa đủ tín hiệu để xếp nhóm.' : PROFILE_LOCKED_REASON,
      missingPrompts,
    };
  }
  return {
    step: 5,
    title,
    persona,
    label: `${persona} · ${PERSONA_SHORT_LABELS[persona]}`,
    confidence: field.confidence,
    source: fieldSource(field),
    quote: null,
    reasoning: 'Nhóm chân dung trong hồ sơ AI đã được khách đồng ý.',
    missingPrompts,
  };
}

export interface CrmPortraitOptions {
  /** The list answer's `identityEnabled`. Unless it is true, the order layer is guessed from the chat. */
  identityEnabled?: boolean | null;
}

/**
 * The five portrait layers that drive the Saler scripts, the lifecycle messages and the Ads counts. The server's
 * order layer while the AI profile is on, with chat guesses for what it left empty (and for everything while it is
 * off); the profile layer only from the server, after consent.
 */
export function buildCustomerPortrait(
  row: CustomerCareCrmRow,
  products: readonly CrmEnterpriseProduct[] = [],
  nowMs: number = Date.now(),
  options: CrmPortraitOptions = {},
): CrmCustomerPortrait {
  const identity = crmServerIdentity(row);
  const allowed = crmProfileLayerAllowed(row);
  const orderIdentity = options.identityEnabled === true ? identity : null;
  const { freeNote, ctx } = splitCrmNote(row.profile.note);
  const segments = splitSentences(row, freeNote);

  const layer_1_age = buildLayer1Age(identity, allowed);
  const layer_2_demographic = buildLayer2AddressForm(row, identity, allowed);
  const layer_3_household = buildLayer3Recipient(identity, allowed);
  const layer_4_interests = buildLayer4Interests(row, identity, orderIdentity, allowed, ctx, segments, products, nowMs);
  const missingPrompts = buildMissingPrompts(layer_2_demographic, layer_4_interests);
  const layer_5_persona = buildLayer5Persona(row, allowed, missingPrompts);

  return {
    layer_1_age,
    layer_2_demographic,
    layer_3_household,
    layer_4_interests,
    layer_5_persona,
    profileAllowed: allowed,
    missingPrompts,
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

/** Any sign the customer must not be marketed to; every refusal counts, wherever it was recorded. */
export function isCrmRowAdsSuppressed(row: CustomerCareCrmRow): boolean {
  if (row.profile.detailsUnreadable === true) return true;
  if (row.profile.stage === 'do_not_contact') return true;
  if (row.profile.lostReason === 'bought_elsewhere' || row.profile.lostReason === 'not_needed') return true;
  const consent = row.identity?.consent;
  if (consent?.noMarketing === true) return true;
  if (consent?.state === 'declined' || consent?.state === 'withdrawn') return true;
  if (consent?.eraseRequestedAt !== undefined && consent.eraseRequestedAt !== null) return true;
  return splitCrmNote(row.profile.note).ctx.consent !== null;
}

/**
 * The customer agreed, as the server recorded it: consent `granted`, offers not refused and no erase request pending.
 * Nothing on the desktop (a note tag, a heuristic) can grant it.
 */
export function hasExplicitMarketingConsent(row: CustomerCareCrmRow): boolean {
  if (isCrmRowAdsSuppressed(row)) return false;
  const consent = crmServerIdentity(row)?.consent;
  return consent?.state === 'granted' && consent.noMarketing === false && (consent.eraseRequestedAt ?? null) === null;
}

/** The page-level identity state an Ads export needs (the CRM list answer's `identityEnabled` / `identityUnavailable`). */
export interface CrmAdsIdentityState {
  identityEnabled: boolean | null;
  identityUnavailable: boolean;
}

export type CrmAdsExportBlock = 'identity_off' | 'identity_unavailable';

/**
 * Fails closed: with the AI customer profile off (or a server without it) nobody has agreed through izzi, and while the
 * identity could not be loaded nobody's consent can be checked, so nothing may be exported or counted as eligible.
 */
export function crmAdsExportBlock(state: CrmAdsIdentityState): CrmAdsExportBlock | null {
  if (state.identityUnavailable) return 'identity_unavailable';
  if (state.identityEnabled !== true) return 'identity_off';
  return null;
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

/**
 * Ads buckets and P1–P4 groups. A persona is counted only from the server, after consent; "consented" counts are the
 * customers an export would include, so they are 0 while `crmAdsExportBlock` blocks the export.
 */
export function summarizeAdsAudiences(
  rows: readonly CustomerCareCrmRow[],
  identityState: CrmAdsIdentityState,
): CrmAdsAudienceSummary {
  const exportBlocked = crmAdsExportBlock(identityState) !== null;
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
    const consented = !exportBlocked && hasExplicitMarketingConsent(row);
    buckets[bucket].count += 1;
    buckets[bucket].leadIds.push(row.leadId);
    if (consented) {
      buckets[bucket].consentedCount += 1;
      consentedCount += 1;
    }

    if (bucket !== 'suppressed') {
      const persona = crmConsentedPersona(row);
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

/** Who to export: everyone eligible, one bucket, or one persona (the server's, after consent). */
export type CrmMetaAudienceTarget = 'all' | Exclude<CrmAdsBucket, 'suppressed'> | CustomerCareCrmPersona;

export interface CrmMetaAudienceSelection {
  /** Why nothing may be exported now; null when the export is open. */
  blockedReason: CrmAdsExportBlock | null;
  /** The eligible customers' phones as `84xxxxxxxxx`, de-duplicated, in row order. */
  phones: string[];
  excludedNoConsent: number;
  excludedSuppressed: number;
}

export interface CrmMetaCustomAudienceCsvResult {
  /** One column, `phone`: lowercase SHA-256 hex only. Never a name, an age, family, a persona or a note. */
  csv: string;
  includedCount: number;
  excludedNoConsent: number;
  excludedSuppressed: number;
  blockedReason: CrmAdsExportBlock | null;
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

/** An unsaved draft can only withhold a customer ("Không liên hệ" typed but not saved yet), never add one. */
function draftSuppresses(row: CustomerCareCrmRow, draft: CustomerCareCrmProfileInput | undefined): boolean {
  return draft !== undefined && isCrmRowAdsSuppressed({ ...row, profile: { ...row.profile, ...draft } });
}

/**
 * The one selection both the export and its preview use. Fails closed (see `crmAdsExportBlock`); otherwise a customer
 * is included only when not suppressed and `hasExplicitMarketingConsent` (server consent `granted`, `noMarketing`
 * false, no erase request pending). There is no option to bypass it.
 */
export function selectMetaAudience(
  rows: readonly CustomerCareCrmRow[],
  target: CrmMetaAudienceTarget,
  identityState: CrmAdsIdentityState,
  drafts: Readonly<Record<string, CustomerCareCrmProfileInput>> = {},
): CrmMetaAudienceSelection {
  const blockedReason = crmAdsExportBlock(identityState);
  if (blockedReason !== null) return { blockedReason, phones: [], excludedNoConsent: 0, excludedSuppressed: 0 };

  const personaTarget = oneOf(CUSTOMER_CARE_CRM_PERSONAS, target);
  let excludedSuppressed = 0;
  let excludedNoConsent = 0;
  const phones: string[] = [];
  for (const row of rows) {
    if (personaTarget && crmConsentedPersona(row) !== target) continue;
    const bucket = classifyCrmAdsBucket(row);
    if (bucket === 'suppressed' || draftSuppresses(row, drafts[row.leadId])) {
      excludedSuppressed += 1;
      continue;
    }
    if (!personaTarget && target !== 'all' && bucket !== target) continue;
    if (!hasExplicitMarketingConsent(row)) {
      excludedNoConsent += 1;
      continue;
    }
    const phone = normalizeVietnamPhoneForMeta(row.phone);
    if (phone !== null && !phones.includes(phone)) phones.push(phone);
  }
  return { blockedReason: null, phones, excludedNoConsent, excludedSuppressed };
}

/** Exports a Meta Custom Audience CSV: a `phone` column of lowercase SHA-256 hex of `84xxxxxxxxx`, nothing else. */
export async function buildMetaCustomAudienceCsv(
  rows: readonly CustomerCareCrmRow[],
  target: CrmMetaAudienceTarget,
  identityState: CrmAdsIdentityState,
  drafts: Readonly<Record<string, CustomerCareCrmProfileInput>> = {},
): Promise<CrmMetaCustomAudienceCsvResult> {
  const selection = selectMetaAudience(rows, target, identityState, drafts);
  const hashes: string[] = [];
  for (const phone of selection.phones) hashes.push(await sha256HexLower(phone));
  return {
    csv: ['phone', ...hashes].join('\n'),
    includedCount: hashes.length,
    excludedNoConsent: selection.excludedNoConsent,
    excludedSuppressed: selection.excludedSuppressed,
    blockedReason: selection.blockedReason,
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
  options: CrmPortraitOptions = {},
): CrmLifecycleItem[] {
  const items: CrmLifecycleItem[] = [];

  for (const row of rows) {
    if (isCrmRowAdsSuppressed(row)) continue;

    const portrait = buildCustomerPortrait(row, products, nowMs, options);
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
 * Never carries phones, names, chat text, notes, urls, leadIds or workspaceIds. Personas are the server's, counted
 * only after consent; `consented` follows the Ads export gate.
 */
export function summarizeCareCrmSegments(
  rows: readonly CustomerCareCrmRow[],
  identityState: CrmAdsIdentityState,
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

  const ads = summarizeAdsAudiences(rows, identityState);
  const byPersona: Record<CustomerCareCrmPersona | 'unclassified', number> = {
    P1: ads.byPersona.P1.count,
    P2: ads.byPersona.P2.count,
    P3: ads.byPersona.P3.count,
    P4: ads.byPersona.P4.count,
    unclassified: ads.unclassifiedCount + ads.buckets.suppressed.count,
  };

  // Include suppressed rows' personas? No — keeping suppressed leads out of active P1–P4 marketing counts
  // (and counting only actionable lifecycle items due now or within 48 hours) keeps Director numbers clean.
  const plan = buildLifecyclePlan(rows, [], nowMs, { identityEnabled: identityState.identityEnabled });
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
