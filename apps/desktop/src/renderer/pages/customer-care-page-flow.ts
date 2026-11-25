/**
 * Pure wiring decisions for the Care Facebook Page flow. `CustomerCareWorkspace` keeps only the React
 * state and the IPC calls; every transition (picker shown, waiting, timeout, retry, save payload) lives
 * here so it can be tested without a DOM.
 */
import type {
  CustomerCareBackfillSkipReason,
  CustomerCareBackfillSummary,
  CustomerCareFacebookActionResult,
  CustomerCareFacebookChoicesEvent,
  CustomerCareFacebookConnectResult,
  CustomerCareSetup,
  CustomerCareSnapshot,
} from '../../shared/customer-care-types';
import { facebookErrorMessage, setupForSave, type CustomerCareFacebookPageChoices } from './CustomerCareFacebookPage';

/** How long the screen waits for Facebook Login before reporting the attempt as expired. */
export const CARE_FACEBOOK_WAIT_MS = 15 * 60_000;

const SCOPE_MISMATCH = 'Phạm vi chăm sóc khách hàng không khớp workspace hiện tại. Hãy tải lại workspace.';
const BROWSER_OPENED =
  "Đã mở Facebook trong trình duyệt. Quan trọng trên cửa sổ Facebook: Đừng bấm ngay 'Tiếp tục dưới tên...' — hãy bấm 'Chỉnh sửa cài đặt trước đó' (hoặc 'Chỉnh sửa quyền truy cập') rồi tích chọn thêm các Page cần lấy data (như Xưởng tranh đồng Đại Long, Đồ đồng Đại Long) trước khi bấm Tiếp tục.";

export const BACKFILL_SKIP_REASON_LABELS: Record<CustomerCareBackfillSkipReason, string> = {
  permission_missing: 'chưa được tích cấp quyền Tin nhắn trên Facebook',
  token_invalid: 'phiên quyền hết hạn, cần kết nối lại',
  bound_elsewhere: 'đang gắn ở dự án khác',
  provider_error: 'lỗi tạm thời từ Facebook',
};

export interface CarePageFlowState {
  busy: boolean;
  /** Epoch ms after which the wait for Facebook is reported as expired; null when not waiting. */
  waitingUntil: number | null;
  choices: CustomerCareFacebookPageChoices | null;
  selectedPageId: string;
}

/** One transition: the next flow plus optional updates to the screen's shared alerts and snapshot. */
export interface CarePageFlowStep {
  flow: CarePageFlowState;
  /** `''` clears the alert; undefined leaves it as is. */
  error?: string;
  notice?: string;
  noticeTone?: 'success' | 'warning';
  snapshot?: CustomerCareSnapshot;
}

export const INITIAL_PAGE_FLOW: CarePageFlowState = { busy: false, waitingUntil: null, choices: null, selectedPageId: '' };

/** A Facebook Login outcome, pushed live or taken from main's buffer. `null` (nothing buffered) changes nothing. */
export function pageFlowOnChoices(
  flow: CarePageFlowState,
  event: CustomerCareFacebookChoicesEvent | null,
  connectedPageId?: string | null,
): CarePageFlowStep {
  if (!event) return { flow };
  if (!event.ok) {
    return {
      flow: { ...flow, waitingUntil: null, choices: null, selectedPageId: '' },
      error: facebookErrorMessage(event.error, event.reason),
      notice: '',
    };
  }
  const eligible = event.pages.filter((page) => page.eligible);
  const selectedPageId = connectedPageId && eligible.some((page) => page.pageId === connectedPageId)
    ? connectedPageId
    : (eligible.length === 1 ? eligible[0].pageId : '');
  return {
    flow: {
      ...flow,
      waitingUntil: null,
      choices: {
        choiceId: event.choiceId,
        expiresAt: event.expiresAt,
        pages: event.pages,
        missingScopes: event.missingScopes,
      },
      selectedPageId,
    },
    error: '',
    notice: '',
  };
}

/** Connect and disconnect start from a clean slate; select keeps the picker until its result is known. */
export function pageFlowOnStart(flow: CarePageFlowState, keepChoices = false): CarePageFlowStep {
  return {
    flow: keepChoices ? { ...flow, busy: true } : { ...INITIAL_PAGE_FLOW, busy: true },
    error: '',
    notice: '',
  };
}

export function pageFlowOnConnectResult(
  flow: CarePageFlowState,
  response: CustomerCareFacebookConnectResult,
  now: number,
): CarePageFlowStep {
  if (!response.ok) {
    return { flow: { ...flow, busy: false, waitingUntil: null }, error: facebookErrorMessage(response.error, response.reason) };
  }
  return { flow: { ...flow, busy: false, waitingUntil: now + CARE_FACEBOOK_WAIT_MS }, notice: BROWSER_OPENED };
}

export function pageFlowOnWaitTimeout(flow: CarePageFlowState, now: number): CarePageFlowStep {
  if (flow.waitingUntil === null || now < flow.waitingUntil) return { flow };
  return { flow: { ...flow, waitingUntil: null }, error: facebookErrorMessage('expired'), notice: '' };
}

export function formatBackfillSummaryNotice(backfill: CustomerCareBackfillSummary): string {
  const base = `Đã đồng bộ ${backfill.pagesProcessed} Page (quét ${backfill.conversationsScanned} hội thoại): cập nhật ${backfill.leadsImported} khách có SĐT, ${backfill.namesSealed} tên khách hàng vào CRM.`;
  const skipped = backfill.skippedPages ?? [];
  if (skipped.length === 0) return base;
  const details = skipped
    .map((page) => {
      const name = page.pageName?.trim() ? page.pageName.trim() : `Page ${page.pageId}`;
      return `${name} (${BACKFILL_SKIP_REASON_LABELS[page.reason]})`;
    })
    .join('; ');
  const actionHint = skipped.some((page) => page.reason === 'permission_missing')
    ? " Hãy bấm 'Kết nối lại / Thêm Page CRM' → chọn 'Chỉnh sửa cài đặt trước đó' trên Facebook để tích cấp quyền cho các Page này."
    : '';
  return `${base} Cảnh báo — có ${skipped.length} Page bị bỏ qua chưa đồng bộ được: ${details}.${actionHint}`;
}

/**
 * Select, multi-Page backfill or disconnect result. Success applies the snapshot (only for the workspace on screen)
 * and closes the picker; `unavailable` keeps the Page list so the same choice can be retried; anything else drops it.
 */
export function pageFlowOnActionResult(
  flow: CarePageFlowState,
  response: CustomerCareFacebookActionResult,
  scopeKey: string,
  success: string,
): CarePageFlowStep {
  if (!response.ok) {
    const error = facebookErrorMessage(response.error, response.reason);
    return response.error === 'unavailable'
      ? { flow: { ...flow, busy: false }, error }
      : { flow: { ...INITIAL_PAGE_FLOW, waitingUntil: flow.waitingUntil }, error };
  }
  if (response.snapshot.workspaceId !== scopeKey) return { flow: INITIAL_PAGE_FLOW, error: SCOPE_MISMATCH };
  const hasSkipped = (response.backfill?.skippedPages?.length ?? 0) > 0;
  const backfillText = response.backfill ? formatBackfillSummaryNotice(response.backfill) : '';
  const notice = backfillText
    ? (success ? `${success} ${backfillText}` : backfillText)
    : success;
  return {
    flow: INITIAL_PAGE_FLOW,
    snapshot: response.snapshot,
    notice,
    ...(hasSkipped ? { noticeTone: 'warning' as const } : {}),
  };
}

/** A thrown IPC call is treated as transient: the Page list stays so the operator can retry. */
export function pageFlowOnFailure(flow: CarePageFlowState, message: string): CarePageFlowStep {
  return { flow: { ...flow, busy: false }, error: message };
}

/** The setup sent on save: Page ID and name always come from the verified connection. */
export function savePayload(setup: CustomerCareSetup, snapshot: CustomerCareSnapshot | null): CustomerCareSetup {
  return setupForSave(setup, snapshot?.pageConnection);
}

export function isSaveDisabled(input: {
  saving: boolean;
  assisting: boolean;
  pageBusy: boolean;
  encryptedStorageAvailable: boolean;
  shadowSafe: boolean;
}): boolean {
  return input.saving || input.assisting || input.pageBusy || !input.encryptedStorageAvailable || !input.shadowSafe;
}
