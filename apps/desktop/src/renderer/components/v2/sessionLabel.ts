import type { AgentChatSession } from '../../types/agent-registry';

/*
 * AgentChatSession has no title field, so V2 lists label a session by its
 * agent plus a short preview of the last non-empty message.
 */

export const SESSION_PREVIEW_MAX = 60;

export function sessionPreview(session: AgentChatSession): string {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const text = session.messages[index]?.content.replace(/\s+/g, ' ').trim();
    if (text) return text.length > SESSION_PREVIEW_MAX ? `${text.slice(0, SESSION_PREVIEW_MAX - 1)}…` : text;
  }
  return 'Phiên trống';
}

export function sessionLabel(session: AgentChatSession): string {
  return `${session.agentName || 'Agent'} · ${sessionPreview(session)}`;
}

/** Time of the last message, else creation; sessions carry no updatedAt. */
export function lastActivity(session: AgentChatSession): string {
  return session.messages[session.messages.length - 1]?.createdAt ?? session.createdAt;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;

/** Short Vietnamese relative time for list meta lines; '' for invalid input. */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE_MS) return 'vừa xong';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} phút trước`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} giờ trước`;
  if (elapsed < WEEK_MS) return `${Math.floor(elapsed / DAY_MS)} ngày trước`;
  if (elapsed < MONTH_MS) return `${Math.floor(elapsed / WEEK_MS)} tuần trước`;
  return new Date(time).toLocaleDateString('vi-VN');
}
