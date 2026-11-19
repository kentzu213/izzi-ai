/**
 * The minute lead check also hands the Care graph publisher a lead summary (docs/CARE-GRAPH-AGENTS.md):
 * counts only, from the page it already read, so lead numbers cost no extra request and no phone, name or
 * message ever leaves the notifier.
 */
import { describe, expect, it, vi } from 'vitest';
import type { CustomerCareLead } from '../../shared/customer-care-types';
import type { CareFacebookResult, CareLeadPage } from './care-facebook-client';
import { CARE_LEADS_PAGE_SIZE } from './care-facebook-client';
import { CareLeadNotifier } from './care-lead-notifier';

const IDENTITY = 'user-aaaa-1111';
const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-11-19T05:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function lead(index: number, capturedMs: number, status: CustomerCareLead['status'] = 'new'): CustomerCareLead {
  const at = new Date(capturedMs).toISOString();
  return {
    id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
    pageId: '105252511858057',
    customerName: `Khách ${index}`,
    phone: `09012345${String(index).padStart(2, '0')}`,
    zaloMentioned: true,
    status,
    phoneCapturedAt: at,
    lastMessageAt: at,
    statusChangedAt: null,
    recentMessages: [{ text: `Số em 09012345${String(index).padStart(2, '0')}`, at }],
  };
}

function fixture(page: CareFacebookResult<CareLeadPage>, role: 'owner' | 'viewer' = 'owner') {
  const onLeadSummary = vi.fn();
  const settings = new Map<string, string>();
  const notifier = new CareLeadNotifier({
    resolveAuthority: async () => ({ identityId: IDENTITY, workspaceId: WORKSPACE, role }),
    currentIdentityId: () => IDENTITY,
    currentWorkspaceId: () => WORKSPACE,
    gateway: {
      getInbox: async () => ({ ok: true, value: { enabled: true, subscribedAt: null, lastEventAt: null } }),
      listLeads: async () => page,
    },
    store: { getSetting: (key) => settings.get(key) ?? null, setSetting: (key, value) => { settings.set(key, value); } },
    notify: () => {},
    now: () => NOW,
    onLeadSummary,
  });
  return { notifier, onLeadSummary };
}

describe('CareLeadNotifier lead summary', () => {
  it('reports counts of the page it read, and no lead data', async () => {
    // Arrange
    const leads = [lead(3, NOW - HOUR), lead(2, NOW - 2 * 24 * HOUR, 'contacted'), lead(1, NOW - 10 * 24 * HOUR)];
    const { notifier, onLeadSummary } = fixture({ ok: true, value: { leads, nextCursor: null } });

    // Act
    await notifier.tick();

    // Assert
    expect(onLeadSummary).toHaveBeenCalledWith(IDENTITY, WORKSPACE, { last24h: 1, last7d: 2, open: 2, capped: false });
    const passed = JSON.stringify(onLeadSummary.mock.calls);
    for (const value of ['0901234503', 'Khách 3', 'Số em', '105252511858057']) expect(passed).not.toContain(value);
  });

  it('marks the counts as a lower bound when more leads exist than the first page', async () => {
    // Arrange
    const full = Array.from({ length: CARE_LEADS_PAGE_SIZE }, (_, index) => lead(index, NOW - HOUR));
    const more = fixture({ ok: true, value: { leads: [lead(1, NOW - HOUR)], nextCursor: 'cursor-2' } });
    const exactlyFull = fixture({ ok: true, value: { leads: full, nextCursor: null } });

    // Act
    await more.notifier.tick();
    await exactlyFull.notifier.tick();

    // Assert
    expect(more.onLeadSummary.mock.calls[0][2]).toMatchObject({ capped: true });
    expect(exactlyFull.onLeadSummary.mock.calls[0][2]).toMatchObject({ capped: true, last24h: CARE_LEADS_PAGE_SIZE });
  });

  it('reports nothing when the leads could not be read or the role cannot read them', async () => {
    // Arrange
    const failed = fixture({ ok: false, error: 'unavailable' });
    const viewer = fixture({ ok: true, value: { leads: [], nextCursor: null } }, 'viewer');

    // Act
    await failed.notifier.tick();
    await viewer.notifier.tick();

    // Assert
    expect(failed.onLeadSummary).not.toHaveBeenCalled();
    expect(viewer.onLeadSummary).not.toHaveBeenCalled();
  });

  it('keeps notifying even when the summary listener throws', async () => {
    // Arrange
    const notify = vi.fn();
    const settings = new Map<string, string>([]);
    let leads: CustomerCareLead[] = [];
    const notifier = new CareLeadNotifier({
      resolveAuthority: async () => ({ identityId: IDENTITY, workspaceId: WORKSPACE, role: 'owner' }),
      currentIdentityId: () => IDENTITY,
      currentWorkspaceId: () => WORKSPACE,
      gateway: {
        getInbox: async () => ({ ok: true, value: { enabled: true, subscribedAt: null, lastEventAt: null } }),
        listLeads: async () => ({ ok: true, value: { leads, nextCursor: null } }),
      },
      store: { getSetting: (key) => settings.get(key) ?? null, setSetting: (key, value) => { settings.set(key, value); } },
      notify,
      now: () => NOW,
      onLeadSummary: () => { throw new Error('listener'); },
    });
    await notifier.tick();

    // Act
    leads = [lead(1, NOW - 60_000)];
    await notifier.tick();

    // Assert
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
