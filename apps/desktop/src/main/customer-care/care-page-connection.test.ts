import { describe, expect, it } from 'vitest';
import type { CustomerCarePageConnection, CustomerCareSetup } from '../../shared/customer-care-types';
import {
  CARE_BLOCKER_PAGE_MISMATCH,
  CARE_BLOCKER_PAGE_NEEDS_REAUTH,
  CARE_BLOCKER_PAGE_NOT_CONNECTED,
  CARE_BLOCKER_PAGE_NOT_SAVED,
  CARE_BLOCKER_PAGE_STATUS_UNAVAILABLE,
  CARE_BLOCKER_PAGE_UNSUPPORTED,
  CARE_BLOCKER_PAGE_UNVERIFIED,
  CARE_MODE_REASON_PAGE,
  CARE_MODE_REASON_PHASE,
  CarePageConnectionCoordinator,
  deriveCareMode,
  derivePageBlockers,
  toCustomerCarePageConnection,
} from './care-page-connection';

const PAGE = '105252511858057';
const VERIFIED_AT = '2026-11-17T10:00:00.000Z';

function setup(pageId: string): CustomerCareSetup {
  return { merchantName: 'Đồ Đồng Hồng Hưng', pageId, pageName: '', handoffTarget: 'Sale', facts: [] };
}

function connected(overrides: Partial<Extract<CustomerCarePageConnection, { state: 'connected' }>> = {}): CustomerCarePageConnection {
  return {
    state: 'connected',
    pageId: PAGE,
    pageName: 'Đồ Đồng Hồng Hưng',
    status: 'active',
    missingScopes: [],
    verifiedAt: VERIFIED_AT,
    ...overrides,
  };
}

const ALL_STATES: CustomerCarePageConnection[] = [
  connected(),
  connected({ status: 'needs_reauth' }),
  connected({ missingScopes: ['pages_messaging'] }),
  { state: 'not_connected' },
  { state: 'unavailable' },
  { state: 'unsupported' },
];

describe('deriveCareMode', () => {
  it('stays shadow with outbound disabled for every connection state in phase A', () => {
    for (const pageConnection of ALL_STATES) {
      const mode = deriveCareMode({ pageConnection });
      expect(mode.mode).toBe('shadow');
      expect(mode.outboundEnabled).toBe(false);
      expect(mode.reasons[0]).toBe(CARE_MODE_REASON_PHASE);
    }
  });

  it('adds the Page reason unless an active Page has every scope', () => {
    expect(deriveCareMode({ pageConnection: connected() }).reasons).toEqual([CARE_MODE_REASON_PHASE]);
    for (const pageConnection of ALL_STATES.slice(1)) {
      expect(deriveCareMode({ pageConnection }).reasons).toEqual([CARE_MODE_REASON_PHASE, CARE_MODE_REASON_PAGE]);
    }
  });
});

describe('derivePageBlockers', () => {
  it('has no Page blocker when the active, fully scoped Page is the saved Page', () => {
    expect(derivePageBlockers(connected(), setup(PAGE))).toEqual([]);
  });

  it('explains re-auth, missing scopes, a Page ID mismatch and an unsaved Page', () => {
    expect(derivePageBlockers(connected({ status: 'needs_reauth' }), setup(PAGE))).toEqual([CARE_BLOCKER_PAGE_NEEDS_REAUTH]);
    const missing = derivePageBlockers(connected({ missingScopes: ['pages_messaging', 'pages_manage_metadata'] }), setup(PAGE));
    expect(missing).toHaveLength(1);
    expect(missing[0]).toContain('pages_messaging, pages_manage_metadata');
    expect(derivePageBlockers(connected(), setup('1234567890'))).toEqual([CARE_BLOCKER_PAGE_MISMATCH]);
    expect(derivePageBlockers(connected(), setup(''))).toEqual([CARE_BLOCKER_PAGE_NOT_SAVED]);
    expect(derivePageBlockers(connected(), null)).toEqual([CARE_BLOCKER_PAGE_NOT_SAVED]);
    expect(derivePageBlockers(connected({ status: 'needs_reauth', missingScopes: ['pages_messaging'] }), setup('99999')))
      .toHaveLength(3);
  });

  it('never treats a manually entered Page ID as verified', () => {
    expect(derivePageBlockers({ state: 'not_connected' }, setup(''))).toEqual([CARE_BLOCKER_PAGE_NOT_CONNECTED]);
    expect(derivePageBlockers({ state: 'not_connected' }, null)).toEqual([CARE_BLOCKER_PAGE_NOT_CONNECTED]);
    expect(derivePageBlockers({ state: 'not_connected' }, setup(PAGE))).toEqual([CARE_BLOCKER_PAGE_UNVERIFIED]);
    expect(derivePageBlockers({ state: 'unavailable' }, setup(''))).toEqual([CARE_BLOCKER_PAGE_STATUS_UNAVAILABLE]);
    expect(derivePageBlockers({ state: 'unavailable' }, setup(PAGE)))
      .toEqual([CARE_BLOCKER_PAGE_STATUS_UNAVAILABLE, CARE_BLOCKER_PAGE_UNVERIFIED]);
    expect(derivePageBlockers({ state: 'unsupported' }, null)).toEqual([CARE_BLOCKER_PAGE_UNSUPPORTED]);
    expect(derivePageBlockers({ state: 'unsupported' }, setup(PAGE)))
      .toEqual([CARE_BLOCKER_PAGE_UNSUPPORTED, CARE_BLOCKER_PAGE_UNVERIFIED]);
  });

  it('uses Vietnamese text with diacritics and no English claims of a connection', () => {
    const all = [
      CARE_BLOCKER_PAGE_MISMATCH, CARE_BLOCKER_PAGE_NEEDS_REAUTH, CARE_BLOCKER_PAGE_NOT_CONNECTED,
      CARE_BLOCKER_PAGE_NOT_SAVED, CARE_BLOCKER_PAGE_STATUS_UNAVAILABLE, CARE_BLOCKER_PAGE_UNSUPPORTED,
      CARE_BLOCKER_PAGE_UNVERIFIED, CARE_MODE_REASON_PAGE, CARE_MODE_REASON_PHASE,
    ];
    for (const text of all) {
      expect(text).toMatch(/[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]/i);
      expect(text).not.toMatch(/\bconnected\b|verified/i);
    }
  });
});

describe('toCustomerCarePageConnection', () => {
  const status = (connection: unknown) => ({
    ok: true as const,
    value: { success: true as const, workspaceId: 'w', requiredScopes: [], connection: connection as never },
  });

  it('maps a verified connection without exposing scopes granted or token expiry', () => {
    expect(toCustomerCarePageConnection(status({
      pageId: PAGE,
      pageName: null,
      status: 'needs_reauth',
      grantedScopes: ['pages_show_list'],
      missingScopes: ['pages_messaging'],
      verifiedAt: VERIFIED_AT,
      tokenExpiresAt: VERIFIED_AT,
    }))).toEqual({
      state: 'connected',
      pageId: PAGE,
      pageName: null,
      status: 'needs_reauth',
      missingScopes: ['pages_messaging'],
      verifiedAt: VERIFIED_AT,
    });
    expect(toCustomerCarePageConnection(status(null))).toEqual({ state: 'not_connected' });
  });

  it('maps 404 to unsupported and every other failure to unavailable', () => {
    expect(toCustomerCarePageConnection({ ok: false, error: 'unsupported' })).toEqual({ state: 'unsupported' });
    for (const error of ['forbidden', 'unavailable', 'not_configured', 'rejected', 'invalid-response'] as const) {
      expect(toCustomerCarePageConnection({ ok: false, error })).toEqual({ state: 'unavailable' });
    }
  });

  it('tracks secondary crmPages in CarePageConnectionCoordinator, deduplicates primary Page, and clears on disconnect', () => {
    const coordinator = new CarePageConnectionCoordinator();
    const crmPages = [
      { pageId: PAGE, pageName: 'Đồ Đồng Hồng Hưng', verifiedAt: VERIFIED_AT },
      { pageId: '631891669999823', pageName: 'Xưởng tranh đồng Đại Long', verifiedAt: VERIFIED_AT },
      { pageId: '741891669999824', pageName: 'Đồ đồng Đại Long', verifiedAt: VERIFIED_AT },
    ];
    const conn = coordinator.applyStatus('ws-1', {
      ok: true,
      value: {
        success: true,
        workspaceId: 'ws-1',
        requiredScopes: [],
        connection: {
          pageId: PAGE,
          pageName: 'Đồ Đồng Hồng Hưng',
          status: 'active',
          grantedScopes: [],
          missingScopes: [],
          verifiedAt: VERIFIED_AT,
          tokenExpiresAt: null,
        },
        crmPages,
      },
    });
    expect(conn).toEqual({
      state: 'connected',
      pageId: PAGE,
      pageName: 'Đồ Đồng Hồng Hưng',
      status: 'active',
      missingScopes: [],
      verifiedAt: VERIFIED_AT,
      crmPages: crmPages.slice(1),
    });

    coordinator.clearWorkspace('ws-1');
    expect(coordinator.getCrmPages('ws-1')).toEqual([]);
  });
});
