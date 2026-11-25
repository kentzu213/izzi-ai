/**
 * MyGraph → CRM, Care CRM S3: the rules of the AI identity card. Pure functions only: what the card offers (the
 * customer's consent and the AI switch gate it), the values a staff correction sends, the version the card acts on
 * (so a 409 reloads instead of overwriting), and the Vietnamese text for every answer of the identity routes.
 * Nothing here stores, sends or logs an identity; the panel holds it in memory with the row.
 */
import {
  CUSTOMER_CARE_CRM_ADDRESS_FORMS,
  CUSTOMER_CARE_CRM_AGE_BANDS,
  CUSTOMER_CARE_CRM_BUDGET_BANDS,
  CUSTOMER_CARE_CRM_IDENTITY_FIELDS,
  CUSTOMER_CARE_CRM_OCCASIONS,
  CUSTOMER_CARE_CRM_PERSONAS,
  CUSTOMER_CARE_CRM_RECIPIENTS,
  CUSTOMER_CARE_CRM_TIMELINES,
  type CustomerCareCrmAgeBand,
  type CustomerCareCrmIdentity,
  type CustomerCareCrmIdentityAction,
  type CustomerCareCrmIdentityActionInput,
  type CustomerCareCrmIdentityActionResult,
  type CustomerCareCrmIdentityField,
  type CustomerCareCrmIdentityRefreshResult,
  type CustomerCareFacebookFailure,
  type CustomerCareFacebookRejectReason,
} from '../../shared/customer-care-types';
import { CRM_ADDRESS_FORM_OPTIONS, CRM_OCCASION_OPTIONS, crmFailureView, crmShouldSkipNextTick, type CrmProductOption } from './customer-crm-flow';
import { BUDGET_LABELS, RECIPIENT_LABELS, TIMELINE_LABELS, crmIsSocialDomain } from './customer-crm-graph';

export const CRM_IDENTITY_OFF_MESSAGE = 'AI hồ sơ khách chưa bật.';
export const CRM_IDENTITY_CONFLICT_MESSAGE = 'Hồ sơ vừa được cập nhật. Hãy xem lại rồi thao tác tiếp.';
export const CRM_IDENTITY_EMPTY_HINT = 'AI chưa ghi nhận gì về khách này.';
const MAX_PRODUCTS = 6;
const MAX_LINK_TITLE = 120;
const MAX_SHOP_NAME = 60;
const MAX_SHARED_LINKS = 3;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
// The server's rule for a Page name in a message: no control, format (bidi, zero-width) or separator character.
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// What the card offers
// ---------------------------------------------------------------------------

export interface CrmIdentityPermissions {
  /** Duyệt / Sửa / Bỏ on the fields shown (the server refuses the profile layer without consent; it is not shown). */
  fieldActions: boolean;
  /** "Xin phép khách": only when the server says izzi may ask now (24-hour window, at most twice, 7 days apart). */
  canAsk: boolean;
  /** "Khách rút đồng ý": once the customer agreed or was asked, even with the AI profile off. */
  canWithdraw: boolean;
  /** "Cập nhật hồ sơ". */
  canRefresh: boolean;
}

const NO_PERMISSIONS: CrmIdentityPermissions = { fieldActions: false, canAsk: false, canWithdraw: false, canRefresh: false };

/**
 * The AI actions need the AI profile on for the workspace (`identityEnabled`), the IPC handlers and a customer who
 * has not refused: after "Không" or a withdrawal the server refuses every identity action, so none is offered.
 * Withdrawing protects the customer, so the server takes it with the AI profile off too (backend 84c2523).
 */
export function crmIdentityPermissions(
  identity: CustomerCareCrmIdentity | null | undefined,
  enabled: boolean | null,
  hasHandlers: boolean,
): CrmIdentityPermissions {
  const state = identity?.consent?.state;
  if (enabled === null || !hasHandlers || state === undefined) return NO_PERMISSIONS;
  const canWithdraw = state === 'granted' || state === 'asked';
  if (enabled !== true || state === 'declined' || state === 'withdrawn') return { ...NO_PERMISSIONS, canWithdraw };
  return {
    fieldActions: true,
    canAsk: identity?.consent?.canAsk === true,
    canWithdraw,
    canRefresh: true,
  };
}

/** The field a card line acts on (`sharedLink:<server index>` for a link); the source ad is never one. */
export function crmIdentityLineTarget(key: string): { field: CustomerCareCrmIdentityField; index?: number } | null {
  const link = /^sharedLink:(\d)$/.exec(key);
  if (link) {
    const index = Number(link[1]);
    return index < MAX_SHARED_LINKS ? { field: 'sharedLink', index } : null;
  }
  return key !== 'sharedLink' && oneOf(CUSTOMER_CARE_CRM_IDENTITY_FIELDS, key) ? { field: key } : null;
}

// ---------------------------------------------------------------------------
// Staff corrections ("Sửa")
// ---------------------------------------------------------------------------

export interface CrmSelectOption {
  value: string;
  label: string;
}

export type CrmIdentityEditor =
  | { kind: 'select'; options: readonly CrmSelectOption[]; current: string }
  | { kind: 'products'; options: readonly CrmProductOption[]; current: string[] }
  | { kind: 'link'; title: string; domain: string };

const PERSONA_LABELS: Readonly<Record<(typeof CUSTOMER_CARE_CRM_PERSONAS)[number], string>> = {
  P1: 'P1 · Bàn thờ nhà mới',
  P2: 'P2 · Tết/giỗ',
  P3: 'P3 · Tranh/quà biếu',
  P4: 'P4 · Hỏi giá',
};

function bandRange(bands: readonly CustomerCareCrmAgeBand[]): string {
  const low = bands[0].replace('+', '').split('-')[0];
  const last = bands[bands.length - 1];
  return last === '55+' ? `${low}+` : `${low}–${last.split('-')[1]}`;
}

/** One band, then every pair of adjacent bands; the value joins the bands with "|". */
const AGE_OPTIONS: readonly CrmSelectOption[] = [
  ...CUSTOMER_CARE_CRM_AGE_BANDS.map((band) => ({ value: band, label: bandRange([band]) })),
  ...CUSTOMER_CARE_CRM_AGE_BANDS.slice(0, -1).map((band, index) => {
    const pair = [band, CUSTOMER_CARE_CRM_AGE_BANDS[index + 1]];
    return { value: pair.join('|'), label: bandRange(pair) };
  }),
];

const options = <T extends string>(values: readonly T[], labels: Readonly<Record<T, string>>): CrmSelectOption[] =>
  values.map((value) => ({ value, label: labels[value] }));
const fromOptions = (list: ReadonlyArray<{ value: string; label: string }>): CrmSelectOption[] =>
  list.map(({ value, label }) => ({ value, label }));

const SELECT_OPTIONS: Readonly<Partial<Record<CustomerCareCrmIdentityField, readonly CrmSelectOption[]>>> = {
  occasion: fromOptions(CRM_OCCASION_OPTIONS),
  timeline: options(CUSTOMER_CARE_CRM_TIMELINES, TIMELINE_LABELS),
  addressForm: fromOptions(CRM_ADDRESS_FORM_OPTIONS),
  ageBand: AGE_OPTIONS,
  family: options(CUSTOMER_CARE_CRM_RECIPIENTS, RECIPIENT_LABELS),
  persona: options(CUSTOMER_CARE_CRM_PERSONAS, PERSONA_LABELS),
  budgetBand: options(CUSTOMER_CARE_CRM_BUDGET_BANDS, BUDGET_LABELS),
};

/** The current value of a field as the editor shows it ("" when unknown). */
function selectCurrent(field: CustomerCareCrmIdentityField, identity: CustomerCareCrmIdentity): string {
  const value = field === 'budgetBand' ? identity.interests?.budgetBand?.value
    : field === 'family' ? identity.family?.value.recipient
      : field === 'ageBand' ? identity.ageBand?.value.join('|')
        : field === 'sharedLink' || field === 'productFactIds' ? undefined
          : identity[field]?.value;
  return typeof value === 'string' ? value : '';
}

/** What "Sửa" shows for a field; null when it cannot be corrected here (no products on this machine). */
export function crmIdentityEditor(
  field: CustomerCareCrmIdentityField,
  identity: CustomerCareCrmIdentity,
  index: number | undefined,
  products: readonly CrmProductOption[],
): CrmIdentityEditor | null {
  if (field === 'productFactIds') {
    return products.length === 0 ? null : { kind: 'products', options: products, current: [...(identity.productFactIds?.value ?? [])] };
  }
  if (field === 'sharedLink') {
    const link = identity.interests?.sharedLinks[index ?? -1]?.value;
    return { kind: 'link', title: link?.title ?? '', domain: link?.domain ?? '' };
  }
  const list = SELECT_OPTIONS[field];
  return list ? { kind: 'select', options: list, current: selectCurrent(field, identity) } : null;
}

/** The typed value a correction sends, or null when the input is outside the contract (main checks it again). */
export function crmIdentityEditValue(field: CustomerCareCrmIdentityField, raw: unknown): unknown {
  switch (field) {
    case 'occasion': return oneOf(CUSTOMER_CARE_CRM_OCCASIONS, raw) ? raw : null;
    case 'timeline': return oneOf(CUSTOMER_CARE_CRM_TIMELINES, raw) ? raw : null;
    case 'addressForm': return oneOf(CUSTOMER_CARE_CRM_ADDRESS_FORMS, raw) ? raw : null;
    case 'persona': return oneOf(CUSTOMER_CARE_CRM_PERSONAS, raw) ? raw : null;
    case 'budgetBand': return oneOf(CUSTOMER_CARE_CRM_BUDGET_BANDS, raw) ? raw : null;
    case 'family': return oneOf(CUSTOMER_CARE_CRM_RECIPIENTS, raw) ? { recipient: raw } : null;
    case 'ageBand': {
      const option = AGE_OPTIONS.find((item) => item.value === raw);
      return option ? option.value.split('|') : null;
    }
    case 'productFactIds': {
      if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_PRODUCTS || !raw.every((id) => typeof id === 'string')) return null;
      return new Set(raw).size === raw.length ? [...raw] : null;
    }
    case 'sharedLink': {
      const { title, domain } = (typeof raw === 'object' && raw !== null ? raw : {}) as { title?: unknown; domain?: unknown };
      const cleanDomain = typeof domain === 'string' ? domain.trim().toLowerCase() : '';
      const cleanTitle = typeof title === 'string' ? title.trim() : '';
      if (!DOMAIN_PATTERN.test(cleanDomain) || Array.from(cleanTitle).length > MAX_LINK_TITLE || UNSAFE_TEXT.test(cleanTitle)) return null;
      // A social-network link is kept as its domain only, like the server keeps it.
      return { title: cleanTitle === '' || crmIsSocialDomain(cleanDomain) ? null : cleanTitle, domain: cleanDomain };
    }
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// The card's own state: the version it opened with, the action in flight, the last answer
// ---------------------------------------------------------------------------

export interface CrmIdentityCardState {
  /** The identity `version` when the card opened, then the one each answer returned; sent as `expectedVersion`. */
  baseVersion: string | null;
  /** The line (or 'ask', 'withdraw', 'refresh') whose request is running; every action waits for it. */
  pending: string | null;
  message: { text: string; tone: CrmIdentityTone } | null;
}

export type CrmIdentityTone = 'success' | 'notice' | 'error';

export function crmIdentityCardStart(identity: CustomerCareCrmIdentity | null | undefined): CrmIdentityCardState {
  return { baseVersion: identity?.version ?? null, pending: null, message: null };
}

export function crmIdentityCardBegin(state: CrmIdentityCardState, key: string): CrmIdentityCardState {
  return { ...state, pending: key, message: null };
}

/** An answer arrived: take its identity's version (a 409 included), show its message, allow the next action. */
export function crmIdentityCardSettle(state: CrmIdentityCardState, view: CrmIdentityOutcomeView): CrmIdentityCardState {
  return {
    baseVersion: view.identity ? view.identity.version : state.baseVersion,
    pending: null,
    message: { text: view.message, tone: view.tone },
  };
}

export type CrmIdentityRequest =
  | { action: 'ask_consent' | 'withdraw_consent' }
  | { action: 'confirm' | 'reject'; field: CustomerCareCrmIdentityField; index?: number }
  | { action: 'correct'; field: CustomerCareCrmIdentityField; index?: number; value: unknown };

/** The IPC input: field actions carry the card's version, consent actions only the lead. */
export function crmIdentityActionInput(
  state: CrmIdentityCardState,
  leadId: string,
  request: CrmIdentityRequest,
): CustomerCareCrmIdentityActionInput {
  if (request.action === 'ask_consent' || request.action === 'withdraw_consent') return { leadId, action: request.action };
  return { leadId, ...request, expectedVersion: state.baseVersion };
}

/** The rows with one customer's identity replaced; every other row is kept as it is. */
export function crmRowsWithIdentity<T extends { leadId: string; identity?: CustomerCareCrmIdentity }>(
  rows: readonly T[],
  leadId: string,
  identity: CustomerCareCrmIdentity,
): T[] {
  return rows.map((row) => (row.leadId === leadId ? { ...row, identity } : row));
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export interface CrmIdentityOutcomeView {
  /** The identity to show from now on (after an action, a 409 or a refresh); null leaves the row as it is. */
  identity: CustomerCareCrmIdentity | null;
  /** The workspace the answer belongs to; the panel ignores an answer for another one. */
  workspaceId: string | null;
  message: string;
  tone: CrmIdentityTone;
  /** This account may no longer see the rows: the panel forgets all of them. */
  dropRows: boolean;
  /** The customer is gone (`lead_not_found`). */
  removeRow: boolean;
  /** A 429, a 503 or another server-side problem: the panel skips its next 60 s tick. */
  skipTick: boolean;
}

const SUCCESS_TEXT: Readonly<Record<CustomerCareCrmIdentityAction, string>> = {
  confirm: 'Đã duyệt.',
  correct: 'Đã sửa.',
  reject: 'Đã bỏ. AI sẽ không đề xuất lại giá trị này.',
  ask_consent: 'Đã gửi lời xin phép cho khách qua Messenger.',
  withdraw_consent: 'Đã ghi nhận khách rút đồng ý. Thông tin AI về khách đã được xoá.',
};

const INVALID_TEXT = 'Giá trị không hợp lệ. Hãy tải lại rồi thử lại.';
const FACEBOOK_UNAVAILABLE_TEXT = 'Chưa gửi được qua Facebook. Thử lại sau ít phút.';

/** Short Vietnamese text per reason; read by `reason`, never from the server's own text. */
const REASON_TEXT: Readonly<Partial<Record<CustomerCareFacebookRejectReason, string>>> = {
  consent_required: 'Khách chưa đồng ý lưu hồ sơ.',
  outside_window: 'Đã quá 24 giờ từ tin cuối của khách nên Messenger không cho gửi. Chờ khách nhắn lại.',
  // 84c2523: also a question already being sent (2-minute lease), or a refusal in the last 24 months.
  ask_limit: 'Chưa xin phép được lúc này: đã hỏi đủ 2 lần (cách nhau 7 ngày), đang có lời xin phép đang gửi, hoặc khách đã từ chối trong 24 tháng.',
  page_not_connected: 'Page chưa kết nối với izzi nên chưa gửi được.',
  permission_missing: 'Page chưa cho izzi quyền gửi tin nhắn. Kết nối lại Page để cấp quyền.',
  provider_rejected: 'Facebook không nhận tin này. Thử lại sau.',
  provider_timeout: FACEBOOK_UNAVAILABLE_TEXT,
  provider_unavailable: FACEBOOK_UNAVAILABLE_TEXT,
  profile_ai_off: CRM_IDENTITY_OFF_MESSAGE,
  identity_running: 'AI đang cập nhật hồ sơ này. Chờ một lát rồi thử lại.',
  daily_cap: 'Hôm nay đã hết lượt cập nhật hồ sơ. Mai thử lại nhé.',
  ai_unavailable: 'AI đang bận. Thử lại sau ít phút.',
  rate_limited: 'Đang có nhiều yêu cầu. Chờ ít phút rồi thử lại.',
  lead_not_found: 'Khách này không còn trong danh sách.',
  invalid_request: INVALID_TEXT,
};

const ERROR_TEXT: Readonly<Partial<Record<CustomerCareFacebookFailure['error'], string>>> = {
  invalid_input: INVALID_TEXT,
  unsupported: 'Máy chủ izzi chưa có hồ sơ AI.',
  not_configured: 'Máy chủ izzi chưa sẵn sàng cho hồ sơ AI. Hãy liên hệ hỗ trợ izzi.',
  'invalid-response': 'Phản hồi từ máy chủ không hợp lệ. Thử lại sau.',
  rejected: 'Máy chủ izzi chưa làm được việc này. Thử lại sau.',
};

function failureView(failure: CustomerCareFacebookFailure, unavailableText: string): CrmIdentityOutcomeView {
  const { dropRows, message: lostAccess } = crmFailureView(failure);
  const text = (failure.reason ? REASON_TEXT[failure.reason] : undefined)
    ?? (dropRows ? lostAccess : failure.error === 'unavailable' ? unavailableText : ERROR_TEXT[failure.error])
    ?? unavailableText;
  return {
    identity: null,
    workspaceId: null,
    message: text,
    tone: 'error',
    dropRows,
    removeRow: failure.reason === 'lead_not_found',
    skipTick: crmShouldSkipNextTick(failure),
  };
}

function settled(identity: CustomerCareCrmIdentity, workspaceId: string, message: string, tone: CrmIdentityTone): CrmIdentityOutcomeView {
  return { identity, workspaceId, message, tone, dropRows: false, removeRow: false, skipTick: false };
}

/**
 * On a consent action `lead_not_found` means the customer's conversation is not there (no stored message: messages
 * are kept 30 days, the lead 90), not that the customer left the list, so the row stays.
 */
const CONSENT_NO_CONVERSATION: Readonly<Record<'ask_consent' | 'withdraw_consent', string>> = {
  ask_consent: 'Không còn tin nhắn nào của khách được lưu (tin giữ 30 ngày) nên chưa gửi được lời xin phép.',
  withdraw_consent: 'Chưa ghi nhận được: không tìm thấy hội thoại của khách trên Page đang kết nối.',
};

/** A staff action's answer: its success text, "Hồ sơ vừa được cập nhật" after a 409, or the reason's text. */
export function crmIdentityActionView(action: CustomerCareCrmIdentityAction, result: CustomerCareCrmIdentityActionResult): CrmIdentityOutcomeView {
  if (result.ok) return settled(result.identity, result.workspaceId, SUCCESS_TEXT[action], 'success');
  if (result.error === 'identity_conflict') return settled(result.identity, result.workspaceId, CRM_IDENTITY_CONFLICT_MESSAGE, 'notice');
  const view = failureView(result, 'Chưa kết nối được máy chủ izzi. Thử lại sau ít phút.');
  if (result.reason === 'lead_not_found' && (action === 'ask_consent' || action === 'withdraw_consent')) {
    return { ...view, message: CONSENT_NO_CONVERSATION[action], removeRow: false };
  }
  return view;
}

/** Whole minutes, rounded up, at least one. */
export function crmRetryMinutes(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60));
}

/** "Cập nhật hồ sơ": the new identity, "Thử lại sau N phút", or the reason's text (a 45 s timeout is `unavailable`). */
export function crmIdentityRefreshView(result: CustomerCareCrmIdentityRefreshResult): CrmIdentityOutcomeView {
  if (result.ok) {
    return result.outcome === 'updated'
      ? settled(result.identity, result.workspaceId, 'Đã cập nhật hồ sơ.', 'success')
      : settled(result.identity, result.workspaceId, 'Hồ sơ chưa có gì mới.', 'notice');
  }
  if (result.error === 'refresh_too_soon') {
    return {
      identity: null, workspaceId: result.workspaceId, message: `Thử lại sau ${crmRetryMinutes(result.retryAfterSec)} phút.`,
      tone: 'notice', dropRows: false, removeRow: false, skipTick: false,
    };
  }
  return failureView(result, 'Chưa cập nhật được hồ sơ. Thử lại sau ít phút.');
}

// ---------------------------------------------------------------------------
// Confirm dialogs
// ---------------------------------------------------------------------------

function shopName(pageName: string | null): string {
  const name = pageName?.trim() ?? '';
  return name.length > 0 && name.length <= MAX_SHOP_NAME && !UNSAFE_TEXT.test(name) ? name : 'shop';
}

/**
 * The message the server sends for "Xin phép khách" (backend bae6259, copy version 1): the automated-assistant
 * disclosure, then the consent line, with the quick replies [Đồng ý] [Không]. When the server has a privacy page
 * set (`CUSTOMER_CARE_PROFILE_PRIVACY_URL`, not set yet), it adds " (chi tiết: <link>)" after "tại đây".
 */
export function crmConsentMessageText(pageName: string | null): string {
  const shop = shopName(pageName);
  return `Dạ em là trợ lý tự động của ${shop} ạ.\n`
    + `Dạ, để tư vấn đúng và báo ưu đãi hợp với nhà mình, ${shop} xin phép lưu thông tin anh/chị nhắn tại đây.`
    + ' Anh/chị bấm Đồng ý nhé; không muốn thì bấm Không hoặc nhắn KHÔNG bất cứ lúc nào, shop vẫn tư vấn bình thường ạ.';
}

export function crmConsentConfirmText(pageName: string | null): string {
  return `Gửi tin này cho khách qua Messenger?\n\n${crmConsentMessageText(pageName)}\n\nKèm 2 nút: [Đồng ý] [Không]`;
}

export function crmWithdrawConfirmText(name: string): string {
  return `Ghi nhận ${name} rút đồng ý lưu hồ sơ?\n\n`
    + 'izzi sẽ xoá các thông tin AI đã ghi về khách, đánh dấu không gửi ưu đãi và không xin phép lại trong 24 tháng. '
    + 'Giai đoạn, đơn hàng và ghi chú của nhân viên vẫn giữ nguyên.';
}
