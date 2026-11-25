import { describe, expect, it } from 'vitest';
import type {
  CustomerCareFacebookChoicesEvent,
  CustomerCarePageConnection,
  CustomerCareSetup,
  CustomerCareSnapshot,
} from '../../shared/customer-care-types';
import { facebookErrorMessage } from './CustomerCareFacebookPage';
import {
  CARE_FACEBOOK_WAIT_MS,
  INITIAL_PAGE_FLOW,
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

  it('does not preselect when several Pages are eligible', () => {
    const several = { ...CHOICES_EVENT, pages: [
      { pageId: PAGE, name: 'A', eligible: true, reason: 'eligible' },
      { pageId: '1234567890', name: 'B', eligible: true, reason: 'eligible' },
    ] } as CustomerCareFacebookChoicesEvent;
    expect(pageFlowOnChoices(INITIAL_PAGE_FLOW, several).flow.selectedPageId).toBe('');
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
