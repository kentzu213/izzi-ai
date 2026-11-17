/**
 * Pure decisions for the Care "Khách để lại số" section (Phase B1). `CustomerCareLeadsPanel` keeps the React
 * state and IPC calls; list merging, labels, polling and error text live here so they test without a DOM.
 * Phones and messages are only ever held in component memory; nothing here stores or reports them.
 */
import type {
  CustomerCareFacebookFailure,
  CustomerCareInboxResult,
  CustomerCareInboxState,
  CustomerCareLead,
  CustomerCareLeadStatus,
} from '../../shared/customer-care-types';
import { facebookErrorMessage } from './CustomerCareFacebookPage';

/** How often the visible Care tab asks for new leads. */
export const CARE_LEADS_REFRESH_MS = 30_000;
export const CARE_LEAD_FALLBACK_NAME = 'Khách Facebook';
/** What the backend stores for a message that only carried a file or image. */
export const CARE_LEAD_ATTACHMENT_TEXT = '[tệp đính kèm]';
export const CARE_INBOX_ENABLE_CONFIRM = 'izzi sẽ đăng ký nhận tin nhắn của Page; izzi chỉ đọc, không gửi gì cho khách.';

export const CARE_LEAD_STATUS_OPTIONS: ReadonlyArray<{ value: CustomerCareLeadStatus; label: string }> = [
  { value: 'new', label: 'Mới' },
  { value: 'contacted', label: 'Đã liên hệ' },
  { value: 'closed', label: 'Xong' },
];

export interface CareLeadListState {
  leads: CustomerCareLead[];
  nextCursor: string | null;
  /** True once "Xem thêm" loaded a later page; a refresh then keeps those rows and their cursor. */
  extraPagesLoaded: boolean;
}

export const EMPTY_LEAD_LIST: CareLeadListState = { leads: [], nextCursor: null, extraPagesLoaded: false };

export interface CareLeadPage {
  leads: CustomerCareLead[];
  nextCursor: string | null;
}

/** A refresh of the first page: newest rows first, older loaded rows kept once below them. */
export function leadListOnFirstPage(state: CareLeadListState, page: CareLeadPage): CareLeadListState {
  if (!state.extraPagesLoaded) return { leads: [...page.leads], nextCursor: page.nextCursor, extraPagesLoaded: false };
  const fresh = new Set(page.leads.map((lead) => lead.id));
  return {
    leads: [...page.leads, ...state.leads.filter((lead) => !fresh.has(lead.id))],
    nextCursor: state.nextCursor,
    extraPagesLoaded: true,
  };
}

/** "Xem thêm": append the next page, skipping rows already on screen. */
export function leadListOnMore(state: CareLeadListState, page: CareLeadPage): CareLeadListState {
  const shown = new Set(state.leads.map((lead) => lead.id));
  return {
    leads: [...state.leads, ...page.leads.filter((lead) => !shown.has(lead.id))],
    nextCursor: page.nextCursor,
    extraPagesLoaded: true,
  };
}

export function leadListOnStatus(state: CareLeadListState, lead: CustomerCareLead): CareLeadListState {
  return { ...state, leads: state.leads.map((item) => (item.id === lead.id ? lead : item)) };
}

export function leadDisplayName(lead: Pick<CustomerCareLead, 'customerName'>): string {
  const name = lead.customerName?.trim();
  return name ? name : CARE_LEAD_FALLBACK_NAME;
}

/** 0901234567 → "0901 234 567"; copying always uses the raw number. */
export function formatLeadPhone(phone: string): string {
  return /^\d{10}$/.test(phone) ? `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}` : phone;
}

/** The newest customer message with real text, or null when there is only an attachment. */
export function latestCustomerText(lead: Pick<CustomerCareLead, 'recentMessages'>): string | null {
  for (let index = lead.recentMessages.length - 1; index >= 0; index -= 1) {
    const text = lead.recentMessages[index].text.trim();
    if (text && text !== CARE_LEAD_ATTACHMENT_TEXT) return text;
  }
  return null;
}

/**
 * The draft panel's transcript for one customer message. Every line is marked as the customer's, so
 * a customer who types "Sale: ..." cannot make the draft treat their words as the shop's.
 */
export function composeTranscript(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `Khách: ${line}`)
    .join('\n');
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local date and time, e.g. "14:05 17/11/2026". */
export function formatLeadAbsoluteTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())} ${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** Relative for the last day ("5 phút trước"), absolute after that. */
export function formatLeadTime(iso: string, nowMs: number): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const minutes = Math.floor((nowMs - time) / 60_000);
  if (minutes < 1) return 'Vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} giờ trước`;
  return formatLeadAbsoluteTime(iso);
}

export function inboxStatusLine(inbox: CustomerCareInboxState, nowMs: number): string {
  if (!inbox.enabled) return 'Đang tắt: izzi chưa đọc tin nhắn của Page.';
  return inbox.lastEventAt
    ? `Tin gần nhất: ${formatLeadTime(inbox.lastEventAt, nowMs)}`
    : 'Tin gần nhất: chưa có tin nào kể từ khi bật.';
}

export function emptyLeadsMessage(inbox: CustomerCareInboxState, canManage: boolean): string {
  if (inbox.enabled) {
    return 'Chưa có khách nào để lại số. izzi sẽ liệt kê khách ngay khi khách gửi số điện thoại qua tin nhắn Page.';
  }
  return canManage
    ? 'Bật “Nhận tin nhắn từ Page” để izzi liệt kê khách để lại số điện thoại.'
    : 'Chủ sở hữu hoặc quản lý workspace cần bật “Nhận tin nhắn từ Page” để izzi liệt kê khách để lại số.';
}

/** New leads are asked for only while the Care tab is on screen and the inbox is on. */
export function shouldPollLeads(input: { active: boolean; documentVisible: boolean; inboxEnabled: boolean }): boolean {
  return input.active && input.documentVisible && input.inboxEnabled;
}

export type CareInboxView =
  | { state: 'loading' }
  | { state: 'hidden' }
  | { state: 'error'; message: string }
  | { state: 'ready'; inbox: CustomerCareInboxState; canManage: boolean };

/**
 * What the section shows for an inbox answer. Viewers (forbidden), a backend without B1 routes and a
 * workspace without a live Page binding see nothing; other failures show a retryable message.
 */
export function inboxViewFromResult(result: CustomerCareInboxResult, scopeKey: string): CareInboxView {
  if (!result.ok) {
    if (result.error === 'forbidden' || result.error === 'unsupported') return { state: 'hidden' };
    return { state: 'error', message: careLeadsErrorMessage(result, 'leads') };
  }
  if (result.workspaceId !== scopeKey || result.inbox === null) return { state: 'hidden' };
  return { state: 'ready', inbox: result.inbox, canManage: result.canManage };
}

/** Phones stay in memory only while the section can show them: a hidden or failed section drops them. */
export function keepsLeadsInMemory(view: CareInboxView): boolean {
  return view.state === 'ready' || view.state === 'loading';
}

/** A read refused for this account (role lowered, signed out, workspace changed) drops the list at once. */
export function failureDropsLeads(failure: CustomerCareFacebookFailure): boolean {
  return failure.error === 'forbidden' || failure.error === 'auth' || failure.error === 'access_changed';
}

const LEADS_MESSAGES: Partial<Record<CustomerCareFacebookFailure['error'], string>> = {
  auth: 'Hãy đăng nhập và chọn workspace để xem khách để lại số.',
  forbidden: 'Chỉ chủ sở hữu, quản lý và biên tập viên workspace xem được khách để lại số.',
  access_changed: 'Tài khoản hoặc workspace đã thay đổi. Danh sách sẽ được tải lại.',
  invalid_input: 'Yêu cầu không hợp lệ. Hãy tải lại danh sách.',
  unavailable: 'Chưa kết nối được máy chủ izzi. Kiểm tra mạng rồi thử lại sau ít phút.',
  unsupported: 'Máy chủ izzi chưa bật nhận tin nhắn từ Page.',
  not_configured: 'Máy chủ izzi chưa cấu hình nhận tin nhắn từ Page. Hãy liên hệ hỗ trợ izzi.',
  rejected: 'Máy chủ izzi từ chối yêu cầu. Hãy thử lại.',
  'invalid-response': 'Phản hồi từ máy chủ không hợp lệ. Hãy thử lại sau.',
};

const INBOX_MESSAGES: Partial<Record<CustomerCareFacebookFailure['error'], string>> = {
  forbidden: 'Chỉ chủ sở hữu và quản lý workspace được bật hoặc tắt nhận tin nhắn từ Page.',
  rejected: 'Facebook chưa cho izzi đăng ký nhận tin nhắn của Page. Hãy kiểm tra quyền của Page rồi thử lại.',
};

/** Fixed Vietnamese text for a bounded failure; nothing from the server is ever shown. */
export function careLeadsErrorMessage(failure: CustomerCareFacebookFailure, context: 'leads' | 'inbox'): string {
  if (failure.reason === 'page_not_connected') return 'Page Facebook chưa được kết nối. Hãy kết nối Page trước.';
  if (failure.reason === 'lead_not_found') return 'Không tìm thấy khách này trong workspace. Danh sách đã được tải lại.';
  if (failure.error === 'rejected' && failure.reason === 'invalid_request') return LEADS_MESSAGES.invalid_input!;
  const contextual = context === 'inbox' ? INBOX_MESSAGES[failure.error] : undefined;
  return contextual ?? LEADS_MESSAGES[failure.error] ?? facebookErrorMessage(failure.error, failure.reason);
}
