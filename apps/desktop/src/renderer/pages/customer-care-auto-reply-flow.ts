/**
 * Pure decisions for the Care "Tự động trả lời khách" section (Phase C). `CustomerCareAutoReplyPanel` keeps
 * the React state and IPC calls; labels, status lines and error text live here so they test without a DOM.
 * The izzi server sends every reply; this section only shows the switch and what happened.
 */
import type {
  CustomerCareAutoReplyProblem,
  CustomerCareAutoReplyResult,
  CustomerCareAutoReplyState,
  CustomerCareFacebookFailure,
} from '../../shared/customer-care-types';
import { facebookErrorMessage } from './CustomerCareFacebookPage';
import { formatLeadAbsoluteTime, formatLeadTime } from './customer-care-leads-flow';

/** How often the visible Care tab re-reads the automatic reply state. */
export const CARE_AUTO_REPLY_REFRESH_MS = 60_000;

export const CARE_AUTO_REPLY_RULES =
  'izzi tự trả lời khách nhắn Page bằng thông tin đã duyệt và xin số điện thoại hoặc Zalo, tối đa 3 tin mỗi khách '
  + 'trong 24 giờ. izzi dừng với khách đó khi khách để số, khi khách từ chối, hoặc khi nhân viên trả lời trên Page '
  + 'hay Pancake.';

export const CARE_AUTO_REPLY_ENABLE_CONFIRM =
  'Bật tự động trả lời? izzi sẽ tự nhắn cho khách nhắn Page từ bây giờ, chỉ dùng các thông tin đã duyệt đang lưu '
  + 'trên máy này, tối đa 3 tin mỗi khách trong 24 giờ, và xin số điện thoại hoặc Zalo. izzi dừng ngay khi khách để '
  + 'số, từ chối, hoặc khi nhân viên trả lời. Khách đang trò chuyện với nhân viên trong 24 giờ qua được để nguyên. '
  + 'Bạn có thể tắt bất cứ lúc nào.';

export type CareAutoReplyView =
  | { state: 'loading' }
  | { state: 'hidden' }
  | { state: 'error'; message: string }
  | { state: 'ready'; autoReply: CustomerCareAutoReplyState; canManage: boolean };

const PROBLEM_TEXT: Record<CustomerCareAutoReplyProblem, string> = {
  standby: 'Page đang để ứng dụng khác (ví dụ Pancake) điều khiển hội thoại nên izzi không được trả lời. '
    + 'Muốn izzi trả lời: Cài đặt Page → Nhắn tin nâng cao → Phân luồng hội thoại.',
  outside_window: 'Khách nhắn đã gần 24 giờ; Facebook không cho trả lời tự động sau 24 giờ.',
  page_limit: 'Page đã chạm giới hạn an toàn 60 tin tự động mỗi giờ.',
  declined: 'Khách từ chối để lại liên hệ nên izzi đã dừng với khách này.',
  other_app: 'Ứng dụng khác đang điều khiển hội thoại (Pancake hoặc Hộp thư Page) nên izzi đã nhường.',
  recipient_not_allowed: 'Facebook chỉ cho gửi tới tài khoản có vai trò trên ứng dụng cho tới khi App Review được duyệt.',
  recipient_unavailable: 'Khách không nhận được tin (đã chặn Page hoặc tài khoản không còn).',
  token_invalid: 'Quyền truy cập Page đã hết hiệu lực. Hãy kết nối lại Page.',
  token_unreadable: 'Máy chủ không đọc được quyền truy cập Page. Hãy kết nối lại Page.',
  permission_missing: 'Page chưa cấp quyền gửi tin cho izzi. Hãy kết nối lại Page và giữ đủ quyền.',
  rate_limited: 'Facebook đang giới hạn tốc độ gửi; izzi sẽ trả lời các tin sau.',
  invalid_script: 'Máy chủ không đọc được thông tin đã duyệt. Hãy lưu lại thiết lập.',
  message_unreadable: 'Máy chủ không đọc được tin của khách nên izzi không trả lời tin đó.',
  switched_off: 'Trả lời tự động vừa được tắt (hoặc dữ liệu khách vừa bị xoá) nên tin đó không gửi.',
  unknown: 'Lần gửi gần nhất không thành công.',
};

export function autoReplyProblemText(reason: CustomerCareAutoReplyProblem): string {
  return PROBLEM_TEXT[reason] ?? PROBLEM_TEXT.unknown;
}

/**
 * What the section shows for an answer. Viewers (forbidden), a backend without Phase C routes and a
 * workspace without a live Page binding see nothing; other failures show a retryable message.
 */
export function autoReplyViewFromResult(result: CustomerCareAutoReplyResult, scopeKey: string): CareAutoReplyView {
  if (!result.ok) {
    if (result.error === 'forbidden' || result.error === 'unsupported') return { state: 'hidden' };
    return { state: 'error', message: autoReplyErrorMessage(result) };
  }
  if (result.workspaceId !== scopeKey || result.autoReply === null) return { state: 'hidden' };
  return { state: 'ready', autoReply: result.autoReply, canManage: result.canManage };
}

/** Status lines under the switch; no customer is ever named. */
export function autoReplyStatusLines(state: CustomerCareAutoReplyState, nowMs: number): string[] {
  if (!state.available && !state.enabled) return ['Máy chủ izzi chưa bật tính năng trả lời tự động.'];
  if (!state.enabled) return ['Đang tắt: izzi không gửi tin nào cho khách.'];
  const lines: string[] = [];
  const since = state.enabledAt ? ` từ ${formatLeadAbsoluteTime(state.enabledAt)}` : '';
  const script = state.scriptUpdatedAt ? ` (cập nhật ${formatLeadTime(state.scriptUpdatedAt, nowMs).toLowerCase()})` : '';
  lines.push(`Đang bật${since}. Trả lời bằng ${state.factCount} thông tin đã duyệt${script}.`);
  if (!state.available) lines.push('Máy chủ izzi đang tạm dừng gửi tin tự động.');
  lines.push(`24 giờ qua: đã gửi ${state.sentLast24h} tin; dừng với ${state.stoppedLast24h} khách `
    + '(đã để số, từ chối hoặc nhân viên đã trả lời).');
  if (state.lastProblem) {
    lines.push(`Không gửi ${formatLeadTime(state.lastProblem.at, nowMs).toLowerCase()}: ${autoReplyProblemText(state.lastProblem.reason)}`);
  }
  return lines;
}

/** Turning on is possible only for a manager, while the server allows it (turning off always is). */
export function canToggleAutoReply(view: CareAutoReplyView): boolean {
  return view.state === 'ready' && view.canManage && (view.autoReply.enabled || view.autoReply.available);
}

/** Fixed Vietnamese text for a bounded failure; nothing from the server is ever shown. */
export function autoReplyErrorMessage(failure: CustomerCareFacebookFailure): string {
  if (failure.error === 'setup_required') return 'Hãy lưu thiết lập chăm sóc khách hàng (thông tin đã duyệt) trước khi bật.';
  if (failure.reason === 'inbox_off') return 'Hãy bật “Nhận tin nhắn từ Page” trước khi bật trả lời tự động.';
  if (failure.reason === 'permission_missing') {
    return 'Page chưa cấp quyền gửi tin cho izzi. Hãy kết nối lại Page và giữ đủ quyền.';
  }
  if (failure.reason === 'page_not_connected') return 'Page Facebook chưa được kết nối hoặc cần kết nối lại.';
  if (failure.error === 'forbidden') return 'Chỉ chủ sở hữu và quản lý workspace được bật hoặc tắt trả lời tự động.';
  if (failure.error === 'not_configured') return 'Máy chủ izzi chưa bật tính năng trả lời tự động.';
  if (failure.error === 'unsupported') return 'Máy chủ izzi chưa hỗ trợ trả lời tự động.';
  if (failure.error === 'rejected') return 'Facebook hoặc máy chủ izzi chưa cho bật trả lời tự động. Hãy thử lại sau.';
  return facebookErrorMessage(failure.error, failure.reason);
}

/** The workspace notice after a setup save while automatic replies are on. */
export function autoReplyScriptNotice(outcome: 'updated' | 'failed' | undefined): { kind: 'success' | 'error'; text: string } | null {
  if (outcome === 'updated') return { kind: 'success', text: 'Đã cập nhật thông tin đã duyệt cho trả lời tự động.' };
  if (outcome === 'failed') {
    return {
      kind: 'error',
      text: 'Đã lưu thiết lập, nhưng chưa cập nhật được thông tin cho trả lời tự động. izzi vẫn trả lời bằng bản cũ; hãy lưu lại sau.',
    };
  }
  return null;
}
