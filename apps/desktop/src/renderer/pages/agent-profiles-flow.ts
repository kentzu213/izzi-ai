/**
 * Display logic for the "Hồ sơ agent" section of the Memory page (docs/MYGRAPH-AGENT-MEMORY.md, S2 and S4).
 * Pure: the component only renders what these functions decide.
 */
import {
  AGENT_IDS_NOT_READING_PROFILE,
  type AgentProfilesError,
  type AgentProfilesResult,
  type AgentProfilesState,
} from '../../shared/agent-profile-types';

const ERROR_TEXT: Record<AgentProfilesError, string> = {
  auth: 'Hãy đăng nhập izzi để cập nhật hồ sơ agent.',
  busy: 'Đang chắt lọc hồ sơ, chờ một chút rồi xem lại.',
  no_activity: 'Chưa có hoạt động mới kể từ lần cập nhật trước, nên không cần gọi AI.',
  daily_limit: 'Đã dùng hết số lần cập nhật cho phép hôm nay. Mai bạn cập nhật tiếp được.',
  quota: 'Tài khoản izzi đã hết credit, nên chưa cập nhật được hồ sơ.',
  model_unavailable: 'Máy chủ AI đang bận hoặc không trả lời. Thử lại sau ít phút.',
  invalid_output: 'AI trả về kết quả không dùng được nên lần này bỏ qua. Lần sau chỉ đọc hoạt động mới.',
  invalid_input: 'Yêu cầu không hợp lệ. Tải lại trang rồi thử lại.',
  not_found: 'Hồ sơ này đã đổi trạng thái. Tải lại để xem trạng thái mới.',
  storage: 'Không lưu được thay đổi trên máy này, nên hồ sơ vẫn như cũ. Thử lại sau.',
};

export function agentProfilesErrorText(error: AgentProfilesError): string {
  return ERROR_TEXT[error] ?? ERROR_TEXT.model_unavailable;
}

export interface RefreshButtonState {
  disabled: boolean;
  label: string;
  hint: string | null;
}

export function refreshButtonState(state: AgentProfilesState | null, running: boolean): RefreshButtonState {
  if (running) return { disabled: true, label: 'Đang chắt lọc…', hint: null };
  if (!state) return { disabled: true, label: 'Cập nhật hồ sơ ngay', hint: null };
  if (state.callsToday >= state.maxCallsPerDay) {
    return { disabled: true, label: 'Cập nhật hồ sơ ngay', hint: 'Đã dùng hết lượt gọi AI hôm nay.' };
  }
  const left = Math.max(0, state.maxRunsPerDay - state.runsToday);
  return left === 0
    ? { disabled: true, label: 'Cập nhật hồ sơ ngay', hint: `Đã dùng hết ${state.maxRunsPerDay} lần hôm nay.` }
    : { disabled: false, label: 'Cập nhật hồ sơ ngay', hint: `Còn ${left}/${state.maxRunsPerDay} lần hôm nay.` };
}

export function refreshNotice(result: AgentProfilesResult): string {
  if (!result.ok) return agentProfilesErrorText(result.error);
  const updated = result.updated ?? 0;
  return updated > 0
    ? `Đã cập nhật ${updated} hồ sơ. Xem rồi bấm "Dùng" cho hồ sơ bạn đồng ý.`
    : 'Chưa có điều gì đáng ghi thêm vào hồ sơ.';
}

export interface ProfileLineDiff {
  added: string[];
  removed: string[];
}

/** One line as compared: inner spacing folded, ends trimmed. */
function normalizedLines(text: string): string[] {
  return text.split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter((line) => line.length > 0);
}

/** What the pending profile adds to, and drops from, the approved one, line by line. */
export function profileLineDiff(approvedText: string, pendingText: string): ProfileLineDiff {
  const before = normalizedLines(approvedText);
  const after = normalizedLines(pendingText);
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    added: after.filter((line) => !beforeSet.has(line)),
    removed: before.filter((line) => !afterSet.has(line)),
  };
}

const DIRECTOR_AGENT_ID = 'customer-marketing-director';

/** How the agent uses its approved profile, when that is not the usual chat context; null otherwise. */
export function profileUseNote(agentId: string): string | null {
  if (agentId === 'hermes') return 'Hermes dùng bộ nhớ riêng nên không đọc hồ sơ này.';
  if (AGENT_IDS_NOT_READING_PROFILE.includes(agentId)) return 'Agent này viết bài công khai nên không đọc hồ sơ này.';
  if (agentId === DIRECTOR_AGENT_ID) return 'Chỉ dùng làm gợi ý trong kế hoạch, chờ bạn duyệt.';
  return null;
}

export function forgetConfirmText(agentName: string): string {
  return `Ngừng dùng hồ sơ của ${agentName}? Agent sẽ không đọc hồ sơ này nữa và bản đang dùng bị xoá khỏi máy.`;
}
