import { describe, expect, it } from 'vitest';
import type {
  CustomerCareFacebookChoicesEvent,
  CustomerCarePageConnection,
  CustomerCareSetup,
  CustomerCareSnapshot,
} from '../../shared/customer-care-types';
import { facebookErrorMessage } from './CustomerCareFacebookPage';
import {
  CARE_BACKFILL_POLL_MS,
  CARE_FACEBOOK_WAIT_MS,
  INITIAL_PAGE_FLOW,
  backfillPollStep,
  formatBackfillProgressText,
  isSaveDisabled,
  pageFlowOnActionResult,
  pageFlowOnChoices,
  pageFlowOnConnectResult,
  pageFlowOnFailure,
  pageFlowOnStart,
  pageFlowOnWaitTimeout,
  savePayload,
  type CarePageFlowState,
} from './customer-care-page-flow';

const NOW = Date.parse('2026-11-17T00:00:00.000Z');
const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const PAGE = '105252511858057';
const CHOICES_EVENT: CustomerCareFacebookChoicesEvent = {
  ok: true,
  choiceId: '33333333-3333-4333-8333-333333333333',
  expiresAt: '2026-11-17T00:15:00.000Z',
  pages: [
    { pageId: PAGE, name: 'Đồ Đồng Hồng Hưng', eligible: true, reason: 'eligible' },
    { pageId: '1234567890', name: 'Page phụ', eligible: false, reason: 'missing_moderate_task' },
  ],
  missingScopes: [],
};
const CONNECTED: CustomerCarePageConnection = {
  state: 'connected',
  pageId: PAGE,
  pageName: 'Đồ Đồng Hồng Hưng',
  status: 'active',
  missingScopes: [],
  verifiedAt: '2026-11-17T00:00:00.000Z',
};

function snapshot(overrides: Partial<CustomerCareSnapshot> = {}): CustomerCareSnapshot {
  return {
    workspaceId: WORKSPACE,
    setup: null,
    blockers: [],
    pageConnection: CONNECTED,
    canManagePage: true,
    mode: 'shadow',
    modeReasons: [],
    outboundEnabled: false,
    encryptedStorageAvailable: true,
    ...overrides,
  };
}

function withChoices(): CarePageFlowState {
  return pageFlowOnChoices(INITIAL_PAGE_FLOW, CHOICES_EVENT).flow;
}

describe('Care Page flow: Facebook outcome', () => {
  it('shows the picker when the choices arrive and preselects the only eligible Page', () => {
    const waiting: CarePageFlowState = { ...INITIAL_PAGE_FLOW, waitingUntil: NOW + 1_000 };
    const step = pageFlowOnChoices(waiting, CHOICES_EVENT);
    expect(step.flow.choices).toEqual({
      choiceId: CHOICES_EVENT.ok ? CHOICES_EVENT.choiceId : '',
      expiresAt: '2026-11-17T00:15:00.000Z',
      pages: CHOICES_EVENT.ok ? CHOICES_EVENT.pages : [],
      missingScopes: [],
    });
    expect(step.flow.selectedPageId).toBe(PAGE);
    expect(step.flow.waitingUntil).toBeNull();
    expect(step).toMatchObject({ error: '', notice: '' });
  });

  it('does not preselect when several Pages are eligible unless connectedPageId matches an eligible Page', () => {
    const several = { ...CHOICES_EVENT, pages: [
      { pageId: PAGE, name: 'A', eligible: true, reason: 'eligible' },
      { pageId: '1234567890', name: 'B', eligible: true, reason: 'eligible' },
    ] } as CustomerCareFacebookChoicesEvent;
    expect(pageFlowOnChoices(INITIAL_PAGE_FLOW, several).flow.selectedPageId).toBe('');
    expect(pageFlowOnChoices(INITIAL_PAGE_FLOW, several, PAGE).flow.selectedPageId).toBe(PAGE);
  });

  it('clears the waiting notice and shows the error when a failure arrives', () => {
    const waiting: CarePageFlowState = { ...withChoices(), waitingUntil: NOW + 1_000 };
    const step = pageFlowOnChoices(waiting, { ok: false, error: 'declined' });
    expect(step.flow).toMatchObject({ waitingUntil: null, choices: null, selectedPageId: '' });
    expect(step.error).toBe(facebookErrorMessage('declined'));
    expect(step.notice).toBe('');
  });

  it('ignores an empty take', () => {
    const flow = withChoices();
    expect(pageFlowOnChoices(flow, null)).toEqual({ flow });
  });
});

describe('Care Page flow: connect and waiting', () => {
  it('marks the flow busy and drops any old picker when an action starts', () => {
    expect(pageFlowOnStart(withChoices())).toEqual({
      flow: { ...INITIAL_PAGE_FLOW, busy: true },
      error: '',
      notice: '',
    });
  });

  it('waits up to 15 minutes for Facebook after the browser opens', () => {
    const step = pageFlowOnConnectResult({ ...INITIAL_PAGE_FLOW, busy: true }, { ok: true }, NOW);
    expect(step.flow).toEqual({ ...INITIAL_PAGE_FLOW, waitingUntil: NOW + CARE_FACEBOOK_WAIT_MS });
    expect(step.notice).toContain('Đã mở Facebook');
    expect(CARE_FACEBOOK_WAIT_MS).toBe(15 * 60_000);
  });

  it('shows a refused connect without waiting', () => {
    const step = pageFlowOnConnectResult({ ...INITIAL_PAGE_FLOW, busy: true }, { ok: false, error: 'unsupported' }, NOW);
    expect(step.flow).toEqual(INITIAL_PAGE_FLOW);
    expect(step.error).toBe('Máy chủ chưa bật kết nối Page Facebook.');
  });

  it('times out the wait with the expired message', () => {
    const waiting: CarePageFlowState = { ...INITIAL_PAGE_FLOW, waitingUntil: NOW + CARE_FACEBOOK_WAIT_MS };
    expect(pageFlowOnWaitTimeout(waiting, NOW + CARE_FACEBOOK_WAIT_MS - 1)).toEqual({ flow: waiting });
    const step = pageFlowOnWaitTimeout(waiting, NOW + CARE_FACEBOOK_WAIT_MS);
    expect(step.flow.waitingUntil).toBeNull();
    expect(step.error).toBe(facebookErrorMessage('expired'));
    expect(step.notice).toBe('');
    expect(pageFlowOnWaitTimeout(INITIAL_PAGE_FLOW, NOW + CARE_FACEBOOK_WAIT_MS)).toEqual({ flow: INITIAL_PAGE_FLOW });
  });
});

describe('Care Page flow: select and disconnect results', () => {
  const busyWithChoices = (): CarePageFlowState => ({ ...withChoices(), busy: true });

  it('applies the snapshot, formats backfill summary notice and closes the picker on success', () => {
    const next = snapshot();
    const step = pageFlowOnActionResult(busyWithChoices(), { ok: true, snapshot: next }, WORKSPACE, 'Đã kết nối');
    expect(step).toEqual({ flow: INITIAL_PAGE_FLOW, snapshot: next, notice: 'Đã kết nối' });

    const withBackfill = pageFlowOnActionResult(busyWithChoices(), {
      ok: true,
      snapshot: next,
      backfill: { pagesProcessed: 3, conversationsScanned: 90, leadsImported: 24, messagesStored: 52, namesSealed: 21 },
    }, WORKSPACE, '');
    expect(withBackfill.notice).toBe(
      'Đã đồng bộ 3 Page (quét 90 hội thoại): cập nhật 24 khách có SĐT, 21 tên khách hàng vào CRM.',
    );
    expect(withBackfill.noticeTone).toBeUndefined();

    const withSkipped = pageFlowOnActionResult(busyWithChoices(), {
      ok: true,
      snapshot: next,
      backfill: {
        pagesProcessed: 1,
        conversationsScanned: 115,
        leadsImported: 12,
        messagesStored: 30,
        namesSealed: 12,
        skippedPages: [
          { pageId: '631891669999823', pageName: 'Xưởng tranh đồng Đại Long', reason: 'permission_missing' },
          { pageId: '741891669999824', pageName: 'Đồ đồng Đại Long', reason: 'token_invalid' },
          { pageId: '851891669999825', pageName: 'Page Khác', reason: 'bound_elsewhere' },
          { pageId: '961891669999826', pageName: null, reason: 'provider_error' },
        ],
      },
    }, WORKSPACE, '');
    expect(withSkipped.noticeTone).toBe('warning');
    expect(withSkipped.notice).toContain('Cảnh báo — có 4 Page bị bỏ qua chưa đồng bộ được:');
    expect(withSkipped.notice).toContain('Xưởng tranh đồng Đại Long (chưa được tích cấp quyền Tin nhắn trên Facebook)');
    expect(withSkipped.notice).toContain('Đồ đồng Đại Long (phiên quyền hết hạn, cần kết nối lại)');
    expect(withSkipped.notice).toContain('Page Khác (đang gắn ở dự án khác)');
    expect(withSkipped.notice).toContain('Page 961891669999826 (lỗi tạm thời từ Facebook)');
    expect(withSkipped.notice).toContain('Chỉnh sửa cài đặt trước đó');
  });

  it('keeps the Page list after an unavailable error so the same choice can be retried', () => {
    const before = busyWithChoices();
    const step = pageFlowOnActionResult(before, { ok: false, error: 'unavailable' }, WORKSPACE, 'x');
    expect(step.flow).toEqual({ ...before, busy: false });
    expect(step.flow.choices).not.toBeNull();
    expect(step.flow.selectedPageId).toBe(PAGE);
    expect(step.error).toBe(facebookErrorMessage('unavailable'));
  });

  it('drops the Page list after a definitive failure', () => {
    for (const failure of [
      { ok: false, error: 'rejected', reason: 'choice_expired' },
      { ok: false, error: 'page_bound_elsewhere' },
      { ok: false, error: 'access_changed' },
    ] as const) {
      const step = pageFlowOnActionResult(busyWithChoices(), failure, WORKSPACE, 'x');
      expect(step.flow).toEqual(INITIAL_PAGE_FLOW);
      expect(step.error).toBe(facebookErrorMessage(failure.error, 'reason' in failure ? failure.reason : undefined));
    }
  });

  it('treats a thrown IPC call as transient: not busy, Page list kept, error shown', () => {
    const before = busyWithChoices();
    expect(pageFlowOnFailure(before, 'Lỗi tạm thời')).toEqual({ flow: { ...before, busy: false }, error: 'Lỗi tạm thời' });
  });

  it('refuses a snapshot for another workspace', () => {
    const step = pageFlowOnActionResult(busyWithChoices(), { ok: true, snapshot: snapshot({ workspaceId: 'other' }) }, WORKSPACE, 'x');
    expect(step.snapshot).toBeUndefined();
    expect(step.error).toContain('không khớp workspace');
    expect(step.flow.busy).toBe(false);
  });

  it('closes PagePicker immediately when backfillJob is running, updates progress on 2.5s polls, and emits final summary on completion or failure', () => {
    expect(CARE_BACKFILL_POLL_MS).toBe(2_500);
    const runningJob = {
      status: 'running' as const,
      startedAt: '2026-11-25T10:00:00.000Z',
      updatedAt: '2026-11-25T10:00:02.000Z',
      completedAt: null,
      pagesTotal: 3,
      pagesProcessed: 0,
      conversationsScanned: 120,
      leadsImported: 32,
      messagesStored: 90,
      namesSealed: 31,
      skippedPages: [],
    };
    const started = pageFlowOnActionResult(busyWithChoices(), {
      ok: true,
      snapshot: snapshot(),
      backfill: { pagesProcessed: 0, conversationsScanned: 0, leadsImported: 0, messagesStored: 0, namesSealed: 0 },
      backfillJob: runningJob,
    }, WORKSPACE, '');
    expect(started.flow).toEqual(INITIAL_PAGE_FLOW);
    expect(started.flow.choices).toBeNull();
    expect(started.notice).toBe('');
    expect(started.snapshot?.backfillJob).toEqual(runningJob);
    expect(formatBackfillProgressText(runningJob)).toBe(
      'Đang quét lịch sử 90 ngày (Page 1/3): đã quét 120 hội thoại · trích xuất 32 khách có SĐT...',
    );

    const midPoll = backfillPollStep(started.snapshot!, {
      ...runningJob,
      pagesProcessed: 2,
      conversationsScanned: 3100,
      leadsImported: 804,
    });
    expect(midPoll.completed).toBe(false);
    expect(formatBackfillProgressText(midPoll.snapshot!.backfillJob!)).toBe(
      'Đang quét lịch sử 90 ngày (Page 3/3): đã quét 3100 hội thoại · trích xuất 804 khách có SĐT...',
    );

    const donePoll = backfillPollStep(midPoll.snapshot!, {
      ...runningJob,
      status: 'completed',
      completedAt: '2026-11-25T10:00:45.000Z',
      pagesProcessed: 3,
      conversationsScanned: 4256,
      leadsImported: 831,
      messagesStored: 2400,
      namesSealed: 829,
      skippedPages: [{ pageId: '741891669999824', pageName: 'Đồ Đồng Đại Long', reason: 'provider_error' }],
    });
    expect(donePoll.completed).toBe(true);
    expect(donePoll.snapshot?.backfillJob).toBeUndefined();
    expect(donePoll.noticeTone).toBe('warning');
    expect(donePoll.notice).toContain('Đã đồng bộ 3 Page (quét 4256 hội thoại): cập nhật 831 khách có SĐT');
    expect(donePoll.notice).toContain('Đồ Đồng Đại Long (lỗi tạm thời từ Facebook)');

    const failedPoll = backfillPollStep(started.snapshot!, {
      ...runningJob,
      status: 'failed',
      completedAt: '2026-11-25T10:00:30.000Z',
      conversationsScanned: 900,
      leadsImported: 157,
    });
    expect(failedPoll.completed).toBe(true);
    expect(failedPoll.snapshot?.backfillJob).toBeUndefined();
    expect(failedPoll.error).toContain('157 khách có SĐT');
  });
});

describe('Care setup save wiring', () => {
  const stale: CustomerCareSetup = {
    merchantName: 'Shop', pageId: '99999', pageName: 'Nhập tay', handoffTarget: 'Sale', facts: [],
  };

  it('saves the connected Page ID and name instead of the stale manual one', () => {
    expect(savePayload(stale, snapshot())).toEqual({ ...stale, pageId: PAGE, pageName: 'Đồ Đồng Hồng Hưng' });
  });

  it('leaves the setup untouched when no Page is connected or the snapshot is missing', () => {
    expect(savePayload(stale, snapshot({ pageConnection: { state: 'not_connected' } }))).toEqual(stale);
    expect(savePayload(stale, null)).toEqual(stale);
  });

  it('disables Save while a Page action runs, as well as while saving, drafting or unsafe', () => {
    const ready = { saving: false, assisting: false, pageBusy: false, encryptedStorageAvailable: true, shadowSafe: true };
    expect(isSaveDisabled(ready)).toBe(false);
    expect(isSaveDisabled({ ...ready, pageBusy: true })).toBe(true);
    expect(isSaveDisabled({ ...ready, saving: true })).toBe(true);
    expect(isSaveDisabled({ ...ready, assisting: true })).toBe(true);
    expect(isSaveDisabled({ ...ready, encryptedStorageAvailable: false })).toBe(true);
    expect(isSaveDisabled({ ...ready, shadowSafe: false })).toBe(true);
  });
});
