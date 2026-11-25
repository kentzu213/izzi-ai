/**
 * Care → MyGraph through CustomerCareService (docs/CARE-GRAPH-AGENTS.md). Invariants: the graph snapshot
 * carries counts, codes and the Page's public name only (never fact text, sources, the handoff text or the
 * Page id); only roles that may read leads get one; the publisher is told after a successful setup save
 * or switch change, and never after a failed one.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  CustomerCareAuthority,
  CustomerCareAutoReplyState,
  CustomerCareCrmRow,
  CustomerCareSetup,
} from '../../shared/customer-care-types';
import { CustomerCareService, type CustomerCareSafeStorage } from './customer-care-service';
import type { CareCrmGateway, CareCrmPage } from './care-crm';
import { buildCareGraphNodes, careWorkspaceKey } from './care-graph-digest';
import type {
  CareAutoReplyGateway,
  CareAutoReplyScript,
  CareFacebookConnection,
  CareFacebookGateway,
  CareFacebookResult,
  CareFacebookStatus,
} from './care-facebook-client';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const PAGE_ID = '105252511858057';
const OWNER: CustomerCareAuthority = { identityId: 'user-aaaa-1111', workspaceId: WORKSPACE, role: 'owner' };
const as = (role: CustomerCareAuthority['role']): CustomerCareAuthority => ({ ...OWNER, role });
const NOW = new Date('2026-11-19T05:00:00.000Z');

const STATE: CustomerCareAutoReplyState = {
  enabled: true,
  enabledAt: '2026-11-19T03:05:00.000Z',
  available: true,
  scriptUpdatedAt: '2026-11-19T03:05:00.000Z',
  factCount: 2,
  sentLast24h: 5,
  lastSentAt: '2026-11-19T04:30:00.000Z',
  stoppedLast24h: 2,
  lastProblem: null,
};

const SETUP: CustomerCareSetup = {
  merchantName: 'Đồng Thờ Hồng Hưng',
  pageId: PAGE_ID,
  pageName: 'Đồng Thờ Hồng Hưng',
  handoffTarget: 'Chị Hưng 0912345678',
  facts: [
    { id: 'gia', topic: 'price', text: 'Bộ đồ thờ 60cm giá 12.500.000đ', source: 'Bảng giá 11/2026', approvedAt: '2026-11-01T00:00:00.000Z' },
    { id: 'lien-he', topic: 'contact', text: 'Hotline 0987654321', source: 'Danh thiếp', approvedAt: '2026-11-01T00:00:00.000Z' },
  ],
};

const CONNECTION: CareFacebookConnection = {
  pageId: PAGE_ID,
  pageName: 'Đồng Thờ Hồng Hưng',
  status: 'active',
  grantedScopes: ['pages_messaging'],
  missingScopes: [],
  verifiedAt: '2026-11-18T00:00:00.000Z',
  tokenExpiresAt: null,
};

class MemorySettings {
  readonly values = new Map<string, string>();
  getSetting(key: string): string | null { return this.values.get(key) ?? null; }
  setSetting(key: string, value: string): void { this.values.set(key, value); }
}

const storage: CustomerCareSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, 'utf8'),
  decryptString: (value) => value.toString('utf8'),
};

class FakeFacebook implements Pick<CareFacebookGateway, 'getStatus'> {
  status: CareFacebookResult<CareFacebookStatus> = {
    ok: true,
    value: { success: true, workspaceId: WORKSPACE, requiredScopes: [], connection: CONNECTION },
  };
  async getStatus() { return this.status; }
}

class FakeAutoReply implements CareAutoReplyGateway {
  getResult: CareFacebookResult<CustomerCareAutoReplyState | null> = { ok: true, value: STATE };
  setResult: CareFacebookResult<CustomerCareAutoReplyState> = { ok: true, value: STATE };
  readonly getAutoReply = vi.fn(async () => this.getResult);
  async setAutoReply(_workspaceId: string, _enabled: boolean, _script: CareAutoReplyScript | null) { return this.setResult; }
}

function fixture(authority: CustomerCareAuthority | null = OWNER, crm?: CareCrmGateway) {
  const facebook = new FakeFacebook();
  const autoReply = new FakeAutoReply();
  const onCareChanged = vi.fn();
  const service = new CustomerCareService({
    store: new MemorySettings(),
    crypto: storage,
    resolveAuthority: async () => authority,
    currentIdentityId: () => authority?.identityId ?? null,
    now: () => NOW,
    facebook: facebook as unknown as CareFacebookGateway,
    autoReply,
    crm,
    onCareChanged,
  });
  return { service, facebook, autoReply, onCareChanged };
}

describe('CustomerCareService.readGraphSnapshot', () => {
  it('returns counts, codes and the Page name, and nothing a customer or staff member wrote', async () => {
    // Arrange
    const { service } = fixture();
    expect((await service.saveSetup(SETUP)).ok).toBe(true);

    // Act
    const snapshot = await service.readGraphSnapshot();

    // Assert
    expect(snapshot).toEqual({
      identityId: OWNER.identityId,
      workspaceId: WORKSPACE,
      source: {
        pageName: 'Đồng Thờ Hồng Hưng',
        page: 'connected',
        facts: { byTopic: { catalog: 0, price: 1, quality: 0, policy: 0, contact: 1 }, expired: 0, handoffSet: true },
        autoReply: STATE,
        crmSegments: null,
      },
    });
    const serialized = JSON.stringify(snapshot);
    for (const secret of ['12.500.000', '0987654321', '0912345678', 'Bảng giá', 'Chị Hưng', PAGE_ID]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('gives roles that cannot read leads no snapshot', async () => {
    for (const role of ['reviewer', 'viewer'] as const) {
      expect(await fixture(as(role)).service.readGraphSnapshot()).toBeNull();
    }
    expect(await fixture(null).service.readGraphSnapshot()).toBeNull();
    expect(await fixture(as('editor')).service.readGraphSnapshot()).not.toBeNull();
  });

  it('gives no snapshot for a workspace that does not use Care here: no setup and no connected Page', async () => {
    // Arrange
    const { service, facebook } = fixture();
    facebook.status = { ok: true, value: { success: true, workspaceId: WORKSPACE, requiredScopes: [], connection: null } };

    // Act
    const snapshot = await service.readGraphSnapshot();

    // Assert
    expect(snapshot).toBeNull();
  });

  it('reports the Page state and skips the automatic-reply read without a connected Page', async () => {
    // Arrange
    const disconnected = fixture();
    await disconnected.service.saveSetup(SETUP);
    disconnected.autoReply.getAutoReply.mockClear();
    disconnected.facebook.status = { ok: true, value: { success: true, workspaceId: WORKSPACE, requiredScopes: [], connection: null } };
    const reauth = fixture();
    reauth.facebook.status = {
      ok: true,
      value: { success: true, workspaceId: WORKSPACE, requiredScopes: [], connection: { ...CONNECTION, status: 'needs_reauth' } },
    };

    // Act
    const none = await disconnected.service.readGraphSnapshot();
    const stale = await reauth.service.readGraphSnapshot();

    // Assert
    expect(none?.source).toMatchObject({ page: 'not_connected', pageName: null, autoReply: null });
    expect(none?.source.facts).not.toBeNull();
    expect(disconnected.autoReply.getAutoReply).not.toHaveBeenCalled();
    expect(stale?.source.page).toBe('needs_reauth');
    expect(stale?.source.facts).toBeNull();
  });

  it('skips the run instead of writing "unknown" when the Page or switch state cannot be read', async () => {
    // Arrange
    const pageDown = fixture();
    await pageDown.service.saveSetup(SETUP);
    pageDown.facebook.status = { ok: false, error: 'unavailable' };
    const switchDown = fixture();
    switchDown.autoReply.getResult = { ok: false, error: 'unavailable' };

    // Act
    const withoutPage = await pageDown.service.readGraphSnapshot();
    const withoutSwitch = await switchDown.service.readGraphSnapshot();

    // Assert
    expect(withoutPage).toBeNull();
    expect(withoutSwitch).toBeNull();
  });

  it('aggregates crmSegments best-effort with 0% PII, and preserves the 3 Care nodes when CRM fails', async () => {
    const row: CustomerCareCrmRow = {
      leadId: '44444444-4444-4444-8444-444444444444',
      pageId: PAGE_ID,
      customerName: 'Nguyễn Văn Hùng',
      phone: '0901234567',
      zaloMentioned: true,
      leadStatus: 'contacted',
      phoneCapturedAt: '2026-11-18T10:00:00.000Z',
      lastMessageAt: '2026-11-19T02:00:00.000Z',
      recentMessages: [{ text: 'Anh sn 1988 cần mua bộ đồ thờ cho nhà mới số 0901234567', at: '2026-11-19T02:00:00.000Z' }],
      profile: {
        stage: 'consulting',
        ownerUserId: null,
        addressForm: 'anh',
        occasion: 'new_home',
        neededBy: '2026-12-15',
        productFactIds: ['gia'],
        nextStep: 'Gọi tư vấn gỗ gụ',
        nextStepDueAt: '2026-11-19T08:00:00.000Z',
        lostReason: null,
        purchasedAt: null,
        note: 'Khách thiện chí ở Quận 7\n[izzi-ctx: v=1; consent=granted]',
        updatedAt: '2026-11-19T03:00:00.000Z',
        updatedBy: null,
      },
    };
    const crmPage: CareCrmPage = {
      role: 'owner',
      canDelete: true,
      rows: [row],
      nextCursor: 'next-page-token',
      assignees: [],
    };
    const okCrm: CareCrmGateway = {
      listCrm: async () => ({ ok: true, value: crmPage }),
      saveCrmProfile: async () => ({ ok: false, error: 'unsupported' }),
    };
    const failingCrm: CareCrmGateway = {
      listCrm: async () => ({ ok: false, error: 'unavailable' }),
      saveCrmProfile: async () => ({ ok: false, error: 'unavailable' }),
    };

    const withCrm = fixture(OWNER, okCrm);
    await withCrm.service.saveSetup(SETUP);
    const snapOk = await withCrm.service.readGraphSnapshot();
    expect(snapOk?.source.crmSegments).toEqual({
      totalLeads: 1,
      leadsCapped: true,
      byStage: { has_phone: 0, consulting: 1, deposit: 0, delivered: 0, lost: 0, do_not_contact: 0 },
      byPersona: { P1: 1, P2: 0, P3: 0, P4: 0, unclassified: 0 },
      adsBuckets: { highIntent: 1, vipLookalike: 0, reengageLost: 0, consented: 1, suppressed: 0 },
      lifecycleDue: { postSale: 0, remarketing: 0 },
    });

    const graphNodes = buildCareGraphNodes(
      { ...snapOk!.source, leads: { last24h: 1, last7d: 1, open: 0, capped: false } },
      careWorkspaceKey(OWNER.identityId, WORKSPACE),
      NOW.toISOString(),
    );
    const serializedNodes = JSON.stringify(graphNodes);
    for (const secret of [
      '0901234567',
      'Nguyễn Văn Hùng',
      'Quận 7',
      '44444444-4444-4444-8444-444444444444',
      WORKSPACE,
      PAGE_ID,
    ]) {
      expect(serializedNodes).not.toContain(secret);
    }
    expect(serializedNodes).not.toMatch(/\d{8,}/);

    const withDownCrm = fixture(OWNER, failingCrm);
    await withDownCrm.service.saveSetup(SETUP);
    const snapFallback = await withDownCrm.service.readGraphSnapshot();
    expect(snapFallback).not.toBeNull();
    expect(snapFallback?.source.crmSegments).toBeNull();
    expect(snapFallback?.source.page).toBe('connected');
  });
});

describe('CustomerCareService onCareChanged', () => {
  it('fires after a saved setup and after a switch change, never after a failure', async () => {
    // Arrange
    const { service, autoReply, onCareChanged } = fixture();

    // Act
    await service.saveSetup({ ...SETUP, facts: 'not-a-list' });
    const afterFailedSave = onCareChanged.mock.calls.length;
    await service.saveSetup(SETUP);
    await service.setAutoReply({ enabled: false });
    autoReply.setResult = { ok: false, error: 'unavailable' };
    await service.setAutoReply({ enabled: false });

    // Assert
    expect(afterFailedSave).toBe(0);
    expect(onCareChanged).toHaveBeenCalledTimes(2);
  });

  it('never lets a throwing listener break the save', async () => {
    // Arrange
    const { service, onCareChanged } = fixture();
    onCareChanged.mockImplementation(() => { throw new Error('listener'); });

    // Act
    const result = await service.saveSetup(SETUP);

    // Assert
    expect(result.ok).toBe(true);
  });
});
