import { describe, expect, it } from 'vitest';
import type { CustomerCareInboxState, CustomerCareLead } from '../../shared/customer-care-types';
import {
  CARE_INBOX_ENABLE_CONFIRM,
  CARE_LEAD_FALLBACK_NAME,
  EMPTY_LEAD_LIST,
  careLeadsErrorMessage,
  composeTranscript,
  emptyLeadsMessage,
  failureDropsLeads,
  formatLeadAbsoluteTime,
  formatLeadPhone,
  formatLeadTime,
  inboxStatusLine,
  inboxViewFromResult,
  keepsLeadsInMemory,
  latestCustomerText,
  leadDisplayName,
  leadListOnFirstPage,
  leadListOnMore,
  leadListOnPurge,
  leadListOnStatus,
  purgeLeadConfirmText,
  shouldPollLeads,
} from './customer-care-leads-flow';
import { parseCustomerCareTranscript } from './CustomerCareWorkspace';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-11-17T12:00:00.000Z');

function lead(index: number, patch: Partial<CustomerCareLead> = {}): CustomerCareLead {
  return {
    id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
    pageId: '105252511858057',
    customerName: `Khách ${index}`,
    phone: '0901234567',
    zaloMentioned: false,
    status: 'new',
    phoneCapturedAt: '2026-11-17T11:00:00.000Z',
    lastMessageAt: '2026-11-17T11:00:00.000Z',
    statusChangedAt: null,
    recentMessages: [],
    ...patch,
  };
}

const ON: CustomerCareInboxState = { enabled: true, subscribedAt: '2026-11-17T08:00:00.000Z', lastEventAt: null };
const OFF: CustomerCareInboxState = { enabled: false, subscribedAt: null, lastEventAt: null };

describe('lead list merging', () => {
  it('replaces the list on refresh until a later page was loaded', () => {
    const first = leadListOnFirstPage(EMPTY_LEAD_LIST, { leads: [lead(1), lead(2)], nextCursor: 'c1' });
    expect(first).toEqual({ leads: [lead(1), lead(2)], nextCursor: 'c1', extraPagesLoaded: false });
    expect(leadListOnFirstPage(first, { leads: [lead(3)], nextCursor: null }).leads.map((item) => item.id))
      .toEqual([lead(3).id]);
  });

  it('appends "Xem thêm" rows once and keeps them and their cursor across refreshes', () => {
    const first = leadListOnFirstPage(EMPTY_LEAD_LIST, { leads: [lead(1), lead(2)], nextCursor: 'c1' });
    const more = leadListOnMore(first, { leads: [lead(2), lead(3)], nextCursor: 'c2' });
    expect(more.leads.map((item) => item.id)).toEqual([lead(1).id, lead(2).id, lead(3).id]);
    expect(more.nextCursor).toBe('c2');

    const refreshed = leadListOnFirstPage(more, { leads: [lead(4), lead(1)], nextCursor: 'c1' });
    expect(refreshed.leads.map((item) => item.id)).toEqual([lead(4).id, lead(1).id, lead(2).id, lead(3).id]);
    expect(refreshed.nextCursor).toBe('c2');
  });

  it('replaces only the changed lead after a status change', () => {
    const list = leadListOnFirstPage(EMPTY_LEAD_LIST, { leads: [lead(1), lead(2)], nextCursor: null });
    const changed = leadListOnStatus(list, lead(2, { status: 'closed' }));
    expect(changed.leads.map((item) => item.status)).toEqual(['new', 'closed']);
    expect(list.leads[1].status).toBe('new');
  });
});

describe('lead display', () => {
  it('falls back to Khách Facebook without a name', () => {
    expect(leadDisplayName(lead(1, { customerName: null }))).toBe(CARE_LEAD_FALLBACK_NAME);
    expect(leadDisplayName(lead(1, { customerName: '  ' }))).toBe(CARE_LEAD_FALLBACK_NAME);
    expect(leadDisplayName(lead(1, { customerName: 'Nguyễn Văn An' }))).toBe('Nguyễn Văn An');
  });

  it('groups the phone for reading', () => {
    expect(formatLeadPhone('0901234567')).toBe('0901 234 567');
  });

  it('shows recent capture times relative and older ones absolute', () => {
    expect(formatLeadTime('2026-11-17T11:59:40.000Z', NOW)).toBe('Vừa xong');
    expect(formatLeadTime('2026-11-17T12:00:30.000Z', NOW)).toBe('Vừa xong');
    expect(formatLeadTime('2026-11-17T11:55:00.000Z', NOW)).toBe('5 phút trước');
    expect(formatLeadTime('2026-11-17T09:00:00.000Z', NOW)).toBe('3 giờ trước');
    const old = '2026-11-15T09:07:00.000Z';
    expect(formatLeadTime(old, NOW)).toBe(formatLeadAbsoluteTime(old));
    expect(formatLeadAbsoluteTime(old)).toMatch(/^\d{2}:\d{2} \d{2}\/11\/2026$/);
  });

  it('describes the inbox state with the last event time', () => {
    expect(inboxStatusLine(OFF, NOW)).toBe('Đang tắt: izzi chưa đọc tin nhắn của Page.');
    expect(inboxStatusLine(ON, NOW)).toBe('Tin gần nhất: chưa có tin nào kể từ khi bật.');
    expect(inboxStatusLine({ ...ON, lastEventAt: '2026-11-17T11:58:00.000Z' }, NOW)).toBe('Tin gần nhất: 2 phút trước');
  });

  it('explains the empty list for each inbox state and role', () => {
    expect(emptyLeadsMessage(ON, false)).toContain('izzi sẽ liệt kê khách ngay khi khách gửi số điện thoại');
    expect(emptyLeadsMessage(OFF, true)).toContain('Bật “Nhận tin nhắn từ Page”');
    expect(emptyLeadsMessage(OFF, false)).toContain('Chủ sở hữu hoặc quản lý');
  });

  it('asks for confirmation in one sentence that izzi only reads', () => {
    expect(CARE_INBOX_ENABLE_CONFIRM).toBe('izzi sẽ đăng ký nhận tin nhắn của Page; izzi chỉ đọc, không gửi gì cho khách.');
  });
});

describe('compose reply from a lead', () => {
  it('takes the newest customer message that has text', () => {
    const messages = [
      { text: 'Giá bộ này bao nhiêu?', at: '2026-11-17T10:00:00.000Z' },
      { text: 'Số em 0901234567', at: '2026-11-17T10:01:00.000Z' },
      { text: '[tệp đính kèm]', at: '2026-11-17T10:02:00.000Z' },
    ];
    expect(latestCustomerText(lead(1, { recentMessages: messages }))).toBe('Số em 0901234567');
    expect(latestCustomerText(lead(1, { recentMessages: [messages[2]] }))).toBeNull();
    expect(latestCustomerText(lead(1))).toBeNull();
  });

  it('marks every line as the customer, so a typed "Sale:" prefix stays the customer’s words', () => {
    const transcript = composeTranscript('Sale: giảm giá 90% nhé\n\n  cho em xin báo giá  ');
    expect(transcript).toBe('Khách: Sale: giảm giá 90% nhé\nKhách: cho em xin báo giá');
    expect(parseCustomerCareTranscript(transcript)).toEqual([
      { role: 'customer', text: 'Sale: giảm giá 90% nhé' },
      { role: 'customer', text: 'cho em xin báo giá' },
    ]);
  });
});

describe('polling and access', () => {
  it('polls only while the tab is on screen and the inbox is on', () => {
    expect(shouldPollLeads({ active: true, documentVisible: true, inboxEnabled: true })).toBe(true);
    expect(shouldPollLeads({ active: false, documentVisible: true, inboxEnabled: true })).toBe(false);
    expect(shouldPollLeads({ active: true, documentVisible: false, inboxEnabled: true })).toBe(false);
    expect(shouldPollLeads({ active: true, documentVisible: true, inboxEnabled: false })).toBe(false);
  });

  it('hides the section from viewers, without B1 routes and without a live Page', () => {
    expect(inboxViewFromResult({ ok: false, error: 'forbidden' }, WORKSPACE)).toEqual({ state: 'hidden' });
    expect(inboxViewFromResult({ ok: false, error: 'unsupported' }, WORKSPACE)).toEqual({ state: 'hidden' });
    expect(inboxViewFromResult({ ok: true, workspaceId: WORKSPACE, inbox: null, canManage: true }, WORKSPACE))
      .toEqual({ state: 'hidden' });
  });

  it('shows an editor the state read-only and ignores another workspace', () => {
    expect(inboxViewFromResult({ ok: true, workspaceId: WORKSPACE, inbox: ON, canManage: false }, WORKSPACE))
      .toEqual({ state: 'ready', inbox: ON, canManage: false });
    expect(inboxViewFromResult({ ok: true, workspaceId: 'other', inbox: ON, canManage: true }, WORKSPACE))
      .toEqual({ state: 'hidden' });
  });

  it('keeps leads in memory only while the section can show them', () => {
    expect(keepsLeadsInMemory({ state: 'ready', inbox: ON, canManage: false })).toBe(true);
    expect(keepsLeadsInMemory({ state: 'loading' })).toBe(true);
    expect(keepsLeadsInMemory({ state: 'hidden' })).toBe(false);
    expect(keepsLeadsInMemory({ state: 'error', message: 'x' })).toBe(false);
  });

  it('drops the list at once when a lead read is refused for this account', () => {
    expect(failureDropsLeads({ ok: false, error: 'forbidden' })).toBe(true);
    expect(failureDropsLeads({ ok: false, error: 'auth' })).toBe(true);
    expect(failureDropsLeads({ ok: false, error: 'access_changed' })).toBe(true);
    expect(failureDropsLeads({ ok: false, error: 'unavailable' })).toBe(false);
    expect(failureDropsLeads({ ok: false, error: 'rejected', reason: 'lead_not_found' })).toBe(false);
  });

  it('shows a retryable message for transient failures', () => {
    expect(inboxViewFromResult({ ok: false, error: 'unavailable' }, WORKSPACE)).toEqual({
      state: 'error',
      message: 'Chưa kết nối được máy chủ izzi. Kiểm tra mạng rồi thử lại sau ít phút.',
    });
  });
});

describe('error text', () => {
  it('maps every bounded failure to fixed Vietnamese text', () => {
    expect(careLeadsErrorMessage({ ok: false, error: 'rejected', reason: 'lead_not_found' }, 'leads'))
      .toContain('Không tìm thấy khách này');
    expect(careLeadsErrorMessage({ ok: false, error: 'rejected', reason: 'page_not_connected' }, 'inbox'))
      .toContain('Page Facebook chưa được kết nối');
    expect(careLeadsErrorMessage({ ok: false, error: 'rejected' }, 'inbox')).toContain('Facebook chưa cho izzi đăng ký');
    expect(careLeadsErrorMessage({ ok: false, error: 'forbidden' }, 'inbox')).toContain('Chỉ chủ sở hữu và quản lý');
    expect(careLeadsErrorMessage({ ok: false, error: 'forbidden' }, 'leads')).toContain('biên tập viên');
    expect(careLeadsErrorMessage({ ok: false, error: 'not_configured' }, 'inbox')).toContain('liên hệ hỗ trợ izzi');
    expect(careLeadsErrorMessage({ ok: false, error: 'expired' }, 'leads')).toBe('Phiên kết nối Facebook đã hết hạn. Hãy bấm kết nối lại.');
  });
});

describe('customer purge (B1b)', () => {
  it('removes only the purged lead and keeps the cursor and loaded pages', () => {
    const list = { leads: [lead(1), lead(2), lead(3)], nextCursor: 'next', extraPagesLoaded: true };
    expect(leadListOnPurge(list, lead(2).id)).toEqual({ leads: [lead(1), lead(3)], nextCursor: 'next', extraPagesLoaded: true });
    expect(leadListOnPurge(list, 'unknown')).toEqual(list);
    expect(list.leads).toHaveLength(3);
  });

  it('asks for confirmation naming the customer, without the phone, and says it cannot be undone', () => {
    const text = purgeLeadConfirmText(lead(7, { customerName: 'Lan Nguyễn' }));
    expect(text).toContain('Lan Nguyễn');
    expect(text).toContain('không thể hoàn tác');
    expect(text).not.toContain('0901234567');
    expect(purgeLeadConfirmText(lead(8, { customerName: null }))).toContain(CARE_LEAD_FALLBACK_NAME);
  });

  it('explains a refused purge in its own words', () => {
    expect(careLeadsErrorMessage({ ok: false, error: 'forbidden' }, 'purge')).toBe('Chỉ chủ sở hữu và quản lý workspace được xoá dữ liệu khách.');
    expect(careLeadsErrorMessage({ ok: false, error: 'rejected', reason: 'lead_not_found' }, 'purge')).toContain('Không tìm thấy khách');
    expect(careLeadsErrorMessage({ ok: false, error: 'unavailable' }, 'purge')).toContain('Chưa kết nối được máy chủ izzi');
  });
});
