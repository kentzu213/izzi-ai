import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CustomerCareAuthorityLookup,
  CustomerCareInboxState,
  CustomerCareLead,
} from '../../shared/customer-care-types';
import type { CareFacebookResult, CareFacebookStatus, CareLeadPage } from './care-facebook-client';
import {
  CARE_LEAD_CONTEXT_TTL_MS,
  CARE_LEAD_MAX_CLOCK_SKEW_MS,
  CARE_LEAD_NOTIFICATION_BODY,
  CARE_LEAD_NOTIFICATION_TITLE,
  CARE_LEAD_POLL_MS,
  CareLeadNotifier,
  type CareLeadNotification,
} from './care-lead-notifier';

const IDENTITY = 'user-aaaa-1111';
const OTHER_IDENTITY = 'user-bbbb-2222';
const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE = '22222222-2222-4222-8222-222222222222';
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const NOW = Date.parse('2026-11-17T12:00:00.000Z');
const FIXED_NOTIFICATION = { title: CARE_LEAD_NOTIFICATION_TITLE, body: CARE_LEAD_NOTIFICATION_BODY };

function lead(index: number, capturedAt: string, customerName: string | null = `Khách ${index}`): CustomerCareLead {
  return {
    id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
    pageId: '105252511858057',
    customerName,
    phone: `09012345${String(index).padStart(2, '0')}`,
    zaloMentioned: false,
    status: 'new',
    phoneCapturedAt: capturedAt,
    lastMessageAt: capturedAt,
    statusChangedAt: null,
    recentMessages: [{ text: `Số em 09012345${String(index).padStart(2, '0')}`, at: capturedAt }],
  };
}

class MemorySettings {
  readonly values = new Map<string, string>();
  getSetting(key: string): string | null { return this.values.get(key) ?? null; }
  setSetting(key: string, value: string): void { this.values.set(key, value); }
}

function fixture(options: { role?: 'owner' | 'manager' | 'editor' | 'reviewer' | 'viewer' } = {}) {
  const state = {
    identity: IDENTITY as string | null,
    authority: { identityId: IDENTITY, workspaceId: WORKSPACE, role: options.role ?? 'editor' } as CustomerCareAuthorityLookup,
    inbox: { ok: true, value: { enabled: true, subscribedAt: null, lastEventAt: null } } as
      CareFacebookResult<CustomerCareInboxState | null>,
    status: {
      ok: true,
      value: { success: true, workspaceId: WORKSPACE, requiredScopes: [], connection: null, crmPages: [] },
    } as CareFacebookResult<CareFacebookStatus>,
    leads: [] as CustomerCareLead[],
    leadsFailure: null as null | { ok: false; error: 'forbidden' | 'unavailable' },
    /** The workspace main stores as active for this account, read locally without a request. */
    activeWorkspace: WORKSPACE as string | null,
    clock: NOW,
  };
  const notifications: CareLeadNotification[] = [];
  const store = new MemorySettings();
  const resolveAuthority = vi.fn(async () => state.authority);
  const getInbox = vi.fn(async (_workspaceId: string) => state.inbox);
  const getStatus = vi.fn(async (_workspaceId: string) => state.status);
  const listLeads = vi.fn(async (_workspaceId: string, _cursor: string | null): Promise<CareFacebookResult<CareLeadPage>> =>
    state.leadsFailure ?? { ok: true, value: { leads: state.leads, nextCursor: null } });
  const notifier = new CareLeadNotifier({
    resolveAuthority,
    currentIdentityId: () => state.identity,
    currentWorkspaceId: () => state.activeWorkspace,
    gateway: { getInbox, getStatus, listLeads },
    store,
    notify: (notification) => { notifications.push(notification); },
    now: () => state.clock,
  });
  return { notifier, state, store, notifications, resolveAuthority, getInbox, getStatus, listLeads };
}

afterEach(() => vi.useRealTimers());

describe('CareLeadNotifier first run', () => {
  it('sets the mark to the newest lead without notifying for leads that already existed', async () => {
    const { notifier, state, store, notifications } = fixture();
    state.leads = [lead(2, '2026-11-17T10:05:00.000Z'), lead(1, '2026-11-17T10:00:00.000Z')];

    await notifier.tick();

    expect(notifications).toEqual([]);
    expect([...store.values.values()]).toEqual(['2026-11-17T10:05:00.000Z']);
  });

  it('notifies a lead that arrives after an empty first run exactly once', async () => {
    const { notifier, state, notifications } = fixture();
    await notifier.tick();
    expect(notifications).toEqual([]);

    state.leads = [lead(1, '2026-11-17T10:00:00.000Z', 'Nguyễn Văn An')];
    await notifier.tick();
    await notifier.tick();

    expect(notifications).toEqual([FIXED_NOTIFICATION]);
  });

  it('keeps marks per account and workspace', async () => {
    const { notifier, state, store, notifications } = fixture();
    await notifier.tick();
    state.authority = { identityId: IDENTITY, workspaceId: OTHER_WORKSPACE, role: 'owner' };
    state.activeWorkspace = OTHER_WORKSPACE;
    state.leads = [lead(1, '2026-11-17T10:00:00.000Z')];
    notifier.refresh();
    await vi.waitFor(() => expect(store.values.size).toBe(2));
    expect(notifications).toEqual([]);
  });
});

describe('CareLeadNotifier notifications', () => {
  async function primed() {
    const f = fixture();
    f.state.leads = [lead(1, '2026-11-17T10:00:00.000Z')];
    await f.notifier.tick();
    return f;
  }

  // Windows keeps toasts in Action Center and on the lock screen: no name, phone or message may appear.
  it.each([1, 3, 5])('shows %i new lead(s) with fixed text only, never a name, phone or message', async (count) => {
    const { notifier, state, notifications } = await primed();
    const fresh = Array.from({ length: count }, (_, index) =>
      lead(10 + index, `2026-11-17T11:${String(10 + index).padStart(2, '0')}:00.000Z`, `Trần Thị Bình ${index}`));
    state.leads = [...fresh, ...state.leads];

    await notifier.tick();

    expect(notifications).toEqual(count > 3
      ? [{ title: CARE_LEAD_NOTIFICATION_TITLE, body: `${count} khách mới đã để lại số điện thoại.` }]
      : [FIXED_NOTIFICATION]);
    const shown = JSON.stringify(notifications);
    for (const item of fresh) {
      expect(shown).not.toContain(item.customerName);
      expect(shown).not.toContain(item.phone);
      expect(shown).not.toContain(item.recentMessages[0].text);
    }
    expect(shown).not.toMatch(/Trần|Bình|0\d{9}/);
  });

  it('turns more than three new leads into one summary', async () => {
    const { notifier, state, notifications } = await primed();
    state.leads = [4, 5, 6, 7].map((index) => lead(index, `2026-11-17T10:0${index}:00.000Z`));
    await notifier.tick();
    expect(notifications).toEqual([{ title: CARE_LEAD_NOTIFICATION_TITLE, body: '4 khách mới đã để lại số điện thoại.' }]);
  });

  it('notifies again only when a lead captures a newer phone', async () => {
    const { notifier, state, notifications } = await primed();
    await notifier.tick();
    expect(notifications).toEqual([]);
    state.leads = [{ ...lead(1, '2026-11-17T11:00:00.000Z'), phone: '0389999999' }];
    await notifier.tick();
    expect(notifications).toHaveLength(1);
  });

  it('stores only an ISO time on disk', async () => {
    const { notifier, state, store } = await primed();
    state.leads = [lead(2, '2026-11-17T10:09:00.000Z'), ...state.leads];
    await notifier.tick();
    for (const [key, value] of store.values) {
      expect(value).toMatch(ISO_PATTERN);
      expect(key).not.toContain(WORKSPACE);
      expect(key).not.toContain(IDENTITY);
    }
  });

  it('does not notify when the mark could not be saved', async () => {
    const { notifier, state, store, notifications } = await primed();
    store.setSetting = () => { throw new Error('disk full'); };
    state.leads = [lead(2, '2026-11-17T10:09:00.000Z')];
    await notifier.tick();
    expect(notifications).toEqual([]);
  });
});

describe('CareLeadNotifier gating', () => {
  it.each(['viewer', 'reviewer'] as const)('never reads inbox or leads for a %s', async (role) => {
    const { notifier, getInbox, listLeads } = fixture({ role });
    await notifier.tick();
    expect(getInbox).not.toHaveBeenCalled();
    expect(listLeads).not.toHaveBeenCalled();
  });

  it('makes no request at all while signed out', async () => {
    const { notifier, state, resolveAuthority, listLeads } = fixture();
    state.identity = null;
    await notifier.tick();
    expect(resolveAuthority).not.toHaveBeenCalled();
    expect(listLeads).not.toHaveBeenCalled();
  });

  it('keeps watching and notifies when a Page is connected even if inbox webhook is off (Pancake active)', async () => {
    const { notifier, state, notifications, listLeads } = fixture();
    state.inbox = { ok: true, value: { enabled: false, subscribedAt: null, lastEventAt: null } };
    await notifier.tick();
    expect(listLeads).toHaveBeenCalledTimes(1);

    state.leads = [lead(1, '2026-11-17T10:00:00.000Z')];
    await notifier.tick();
    expect(listLeads).toHaveBeenCalledTimes(2);
    expect(notifications).toEqual([FIXED_NOTIFICATION]);
  });

  it('keeps watching when primary inbox is null but CRM-synced Pages are connected', async () => {
    const { notifier, state, notifications, getStatus, listLeads } = fixture();
    state.inbox = { ok: true, value: null };
    state.status = {
      ok: true,
      value: {
        success: true,
        workspaceId: WORKSPACE,
        requiredScopes: [],
        connection: null,
        crmPages: [{ pageId: '105252511858057', pageName: 'Đồ Đồng Đại Long', verifiedAt: '2026-11-17T08:00:00.000Z' }],
      },
    };
    await notifier.tick();
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(listLeads).toHaveBeenCalledTimes(1);

    state.leads = [lead(1, '2026-11-17T10:00:00.000Z')];
    await notifier.tick();
    expect(listLeads).toHaveBeenCalledTimes(2);
    expect(notifications).toEqual([FIXED_NOTIFICATION]);
  });

  it('sets the mark once and stays quiet when neither primary Page nor CRM Pages are connected', async () => {
    const { notifier, state, listLeads } = fixture();
    state.inbox = { ok: true, value: null };
    state.status = {
      ok: true,
      value: { success: true, workspaceId: WORKSPACE, requiredScopes: [], connection: null, crmPages: [] },
    };
    await notifier.tick();
    await notifier.tick();
    expect(listLeads).toHaveBeenCalledTimes(1);
  });

  it('does not read leads when the backend has no inbox routes yet', async () => {
    const { notifier, state, listLeads } = fixture();
    state.inbox = { ok: false, error: 'unsupported' };
    await notifier.tick();
    expect(listLeads).not.toHaveBeenCalled();
  });

  it('reuses workspace, role and inbox for a few minutes, then reads them again', async () => {
    const { notifier, state, resolveAuthority, getInbox, listLeads } = fixture();
    await notifier.tick();
    state.clock += CARE_LEAD_POLL_MS;
    await notifier.tick();
    expect(resolveAuthority).toHaveBeenCalledTimes(1);
    expect(getInbox).toHaveBeenCalledTimes(1);
    expect(listLeads).toHaveBeenCalledTimes(2);

    state.clock += CARE_LEAD_CONTEXT_TTL_MS;
    await notifier.tick();
    expect(resolveAuthority).toHaveBeenCalledTimes(2);
    expect(getInbox).toHaveBeenCalledTimes(2);
  });

  it('asks again on the next check when the authority or inbox is unreachable', async () => {
    const { notifier, state, resolveAuthority, getInbox } = fixture();
    state.authority = 'unavailable';
    await notifier.tick();
    state.authority = { identityId: IDENTITY, workspaceId: WORKSPACE, role: 'owner' };
    state.inbox = { ok: false, error: 'unavailable' };
    await notifier.tick();
    await notifier.tick();
    expect(resolveAuthority).toHaveBeenCalledTimes(3);
    expect(getInbox).toHaveBeenCalledTimes(2);
  });

  it('forgets the workspace when the backend says the role no longer reads leads', async () => {
    const { notifier, state, resolveAuthority } = fixture();
    await notifier.tick();
    state.leadsFailure = { ok: false, error: 'forbidden' };
    await notifier.tick();
    await notifier.tick();
    expect(resolveAuthority).toHaveBeenCalledTimes(2);
  });

  it('ignores an authority that belongs to another account', async () => {
    const { notifier, state, listLeads } = fixture();
    state.authority = { identityId: OTHER_IDENTITY, workspaceId: WORKSPACE, role: 'owner' };
    await notifier.tick();
    expect(listLeads).not.toHaveBeenCalled();
  });
});

describe('CareLeadNotifier workspace switch', () => {
  it('re-reads the authority at once when the active workspace changes and stops watching the old one', async () => {
    const { notifier, state, notifications, resolveAuthority, listLeads } = fixture();
    await notifier.tick();
    expect(listLeads).toHaveBeenLastCalledWith(WORKSPACE, null);

    // The account now works in another workspace where it is only a viewer; the cached context is young.
    state.activeWorkspace = OTHER_WORKSPACE;
    state.authority = { identityId: IDENTITY, workspaceId: OTHER_WORKSPACE, role: 'viewer' };
    state.leads = [lead(1, '2026-11-17T11:00:00.000Z')];
    state.clock += CARE_LEAD_POLL_MS;
    await notifier.tick();
    await notifier.tick();

    expect(resolveAuthority).toHaveBeenCalledTimes(2);
    expect(listLeads).toHaveBeenCalledTimes(1);
    expect(notifications).toEqual([]);
  });

  it('watches the new workspace with its own mark after a switch', async () => {
    const { notifier, state, store, notifications, listLeads } = fixture();
    await notifier.tick();
    state.activeWorkspace = OTHER_WORKSPACE;
    state.authority = { identityId: IDENTITY, workspaceId: OTHER_WORKSPACE, role: 'owner' };
    state.leads = [lead(1, '2026-11-17T11:00:00.000Z')];
    await notifier.tick();

    expect(listLeads).toHaveBeenLastCalledWith(OTHER_WORKSPACE, null);
    expect(store.values.size).toBe(2);
    expect(notifications).toEqual([]);
  });

  it('drops an answer for the old workspace that arrives after the switch', async () => {
    const { notifier, state, store, notifications, listLeads } = fixture();
    await notifier.tick();
    let release: () => void = () => {};
    listLeads.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ ok: true, value: { leads: [lead(1, '2026-11-17T11:00:00.000Z')], nextCursor: null } });
    }));
    const pending = notifier.tick();
    await vi.waitFor(() => expect(listLeads).toHaveBeenCalledTimes(2));

    state.activeWorkspace = OTHER_WORKSPACE;
    release();
    await pending;

    expect(notifications).toEqual([]);
    expect([...store.values.values()]).toEqual(['1970-01-01T00:00:00.000Z']);
  });
});

describe('CareLeadNotifier clock skew', () => {
  async function primed() {
    const f = fixture();
    f.state.leads = [lead(1, '2026-11-17T10:00:00.000Z')];
    await f.notifier.tick();
    return f;
  }

  it('ignores a capture time far in the future, so it cannot silence later leads', async () => {
    const { notifier, state, store, notifications } = await primed();
    const future = new Date(NOW + 24 * 60 * 60_000).toISOString();
    state.leads = [lead(9, future), ...state.leads];
    await notifier.tick();
    expect(notifications).toEqual([]);
    for (const value of store.values.values()) expect(Date.parse(value)).toBeLessThanOrEqual(NOW);

    state.leads = [lead(9, future), lead(2, '2026-11-17T11:30:00.000Z'), lead(1, '2026-11-17T10:00:00.000Z')];
    await notifier.tick();
    expect(notifications).toEqual([FIXED_NOTIFICATION]);
    expect([...store.values.values()]).toEqual(['2026-11-17T11:30:00.000Z']);
  });

  it('accepts a capture time slightly ahead of this clock', async () => {
    const { notifier, state, notifications } = await primed();
    state.leads = [lead(2, new Date(NOW + CARE_LEAD_MAX_CLOCK_SKEW_MS - 1_000).toISOString()), ...state.leads];
    await notifier.tick();
    expect(notifications).toEqual([FIXED_NOTIFICATION]);
  });

  it('replaces a stored mark far in the future instead of staying silent', async () => {
    const { notifier, state, store, notifications } = await primed();
    const [key] = [...store.values.keys()];
    store.values.set(key, '2099-01-01T00:00:00.000Z');
    state.leads = [lead(2, '2026-11-17T11:00:00.000Z'), ...state.leads];
    await notifier.tick();
    expect([...store.values.values()]).toEqual(['2026-11-17T11:00:00.000Z']);

    state.leads = [lead(3, '2026-11-17T11:40:00.000Z'), ...state.leads];
    await notifier.tick();
    expect(notifications).toEqual([FIXED_NOTIFICATION]);
  });
});

describe('CareLeadNotifier sign-out and lifecycle', () => {
  it('drops an answer that arrives after sign-out and makes no further request', async () => {
    const { notifier, state, store, notifications, listLeads } = fixture();
    await notifier.tick();
    let release: () => void = () => {};
    listLeads.mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ ok: true, value: { leads: [lead(1, '2026-11-17T10:00:00.000Z')], nextCursor: null } });
    }));
    const pending = notifier.tick();
    await vi.waitFor(() => expect(listLeads).toHaveBeenCalledTimes(2));

    state.identity = null;
    notifier.reset();
    release();
    await pending;
    await notifier.tick();

    expect(notifications).toEqual([]);
    expect([...store.values.values()]).toEqual(['1970-01-01T00:00:00.000Z']);
    expect(listLeads).toHaveBeenCalledTimes(2);
  });

  it('checks once a minute after start and stops on stop', async () => {
    vi.useFakeTimers();
    const { notifier, listLeads } = fixture();
    notifier.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(listLeads).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CARE_LEAD_POLL_MS);
    expect(listLeads).toHaveBeenCalledTimes(2);

    notifier.stop();
    await vi.advanceTimersByTimeAsync(CARE_LEAD_POLL_MS * 3);
    expect(listLeads).toHaveBeenCalledTimes(2);
  });

  it('keeps checking after a notification hook throws', async () => {
    const f = fixture();
    await f.notifier.tick();
    const notifier = new CareLeadNotifier({
      resolveAuthority: f.resolveAuthority,
      currentIdentityId: () => IDENTITY,
      gateway: { getInbox: f.getInbox, listLeads: f.listLeads },
      store: f.store,
      notify: () => { throw new Error('toast failed'); },
    });
    f.state.leads = [lead(1, '2026-11-17T10:00:00.000Z')];
    await expect(notifier.tick()).resolves.toBeUndefined();
    f.state.leads = [lead(2, '2026-11-17T10:01:00.000Z'), ...f.state.leads];
    await expect(notifier.tick()).resolves.toBeUndefined();
    expect(f.listLeads).toHaveBeenCalledTimes(3);
  });
});
