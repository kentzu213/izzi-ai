import { describe, expect, it } from 'vitest';
import type { CustomerCareAutoReplyState } from '../../shared/customer-care-types';
import { CUSTOMER_CARE_AUTO_REPLY_PROBLEMS } from '../../shared/customer-care-types';
import {
  autoReplyErrorMessage,
  autoReplyProblemText,
  autoReplyScriptNotice,
  autoReplyStatusLines,
  autoReplyViewFromResult,
  canToggleAutoReply,
} from './customer-care-auto-reply-flow';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-11-18T10:00:00.000Z');
const STATE: CustomerCareAutoReplyState = {
  enabled: true,
  enabledAt: '2026-11-18T08:00:00.000Z',
  available: true,
  scriptUpdatedAt: '2026-11-18T09:50:00.000Z',
  factCount: 8,
  sentLast24h: 5,
  lastSentAt: '2026-11-18T09:55:00.000Z',
  stoppedLast24h: 2,
  lastProblem: null,
};

describe('automatic reply view', () => {
  it('hides the section for viewers, old servers and workspaces without a Page', () => {
    expect(autoReplyViewFromResult({ ok: false, error: 'forbidden' }, WORKSPACE)).toEqual({ state: 'hidden' });
    expect(autoReplyViewFromResult({ ok: false, error: 'unsupported' }, WORKSPACE)).toEqual({ state: 'hidden' });
    expect(autoReplyViewFromResult({ ok: true, workspaceId: WORKSPACE, autoReply: null, canManage: true }, WORKSPACE))
      .toEqual({ state: 'hidden' });
    expect(autoReplyViewFromResult({ ok: true, workspaceId: 'other', autoReply: STATE, canManage: true }, WORKSPACE))
      .toEqual({ state: 'hidden' });
  });

  it('shows a retryable error otherwise, and the state when ready', () => {
    expect(autoReplyViewFromResult({ ok: false, error: 'unavailable' }, WORKSPACE).state).toBe('error');
    expect(autoReplyViewFromResult({ ok: true, workspaceId: WORKSPACE, autoReply: STATE, canManage: false }, WORKSPACE))
      .toEqual({ state: 'ready', autoReply: STATE, canManage: false });
  });

  it('lets only managers switch, and turning on only while the server allows it', () => {
    const ready = (autoReply: CustomerCareAutoReplyState, canManage = true) => ({ state: 'ready' as const, autoReply, canManage });
    expect(canToggleAutoReply(ready(STATE))).toBe(true);
    expect(canToggleAutoReply(ready(STATE, false))).toBe(false);
    expect(canToggleAutoReply(ready({ ...STATE, enabled: false, available: false }))).toBe(false);
    expect(canToggleAutoReply(ready({ ...STATE, enabled: true, available: false }))).toBe(true);
  });
});

describe('automatic reply status lines', () => {
  it('says plainly when nothing is sent', () => {
    expect(autoReplyStatusLines({ ...STATE, enabled: false, enabledAt: null }, NOW)).toEqual(['Đang tắt: izzi không gửi tin nào cho khách.']);
    expect(autoReplyStatusLines({ ...STATE, enabled: false, available: false }, NOW)).toEqual(['Máy chủ izzi chưa bật tính năng trả lời tự động.']);
  });

  it('reports what was sent and stopped, never a customer', () => {
    const lines = autoReplyStatusLines(STATE, NOW);
    expect(lines[0]).toMatch(/^Đang bật từ .+\. Trả lời bằng 8 thông tin đã duyệt \(cập nhật 10 phút trước\)\.$/);
    expect(lines[1]).toBe('24 giờ qua: đã gửi 5 tin; dừng với 2 khách (đã để số, từ chối hoặc nhân viên đã trả lời).');
    expect(lines).toHaveLength(2);
  });

  it('explains the last reply that was not sent', () => {
    const lines = autoReplyStatusLines({ ...STATE, lastProblem: { reason: 'standby', at: '2026-11-18T09:58:00.000Z' } }, NOW);
    expect(lines.at(-1)).toMatch(/^Không gửi 2 phút trước: Page đang để ứng dụng khác/);
  });

  it('has Vietnamese text for every problem code', () => {
    for (const reason of CUSTOMER_CARE_AUTO_REPLY_PROBLEMS) {
      expect(autoReplyProblemText(reason).length).toBeGreaterThan(10);
    }
  });
});

describe('automatic reply errors and save notice', () => {
  it('maps each refusal to fixed text', () => {
    expect(autoReplyErrorMessage({ ok: false, error: 'setup_required' })).toMatch(/lưu thiết lập/);
    expect(autoReplyErrorMessage({ ok: false, error: 'rejected', reason: 'inbox_off' })).toMatch(/Nhận tin nhắn từ Page/);
    expect(autoReplyErrorMessage({ ok: false, error: 'rejected', reason: 'permission_missing' })).toMatch(/quyền gửi tin/);
    expect(autoReplyErrorMessage({ ok: false, error: 'forbidden' })).toMatch(/Chỉ chủ sở hữu và quản lý/);
    expect(autoReplyErrorMessage({ ok: false, error: 'not_configured' })).toMatch(/chưa bật/);
  });

  it('tells the shop whether a saved setup reached automatic replies', () => {
    expect(autoReplyScriptNotice(undefined)).toBeNull();
    expect(autoReplyScriptNotice('updated')?.kind).toBe('success');
    expect(autoReplyScriptNotice('failed')).toEqual(expect.objectContaining({ kind: 'error' }));
  });
});
