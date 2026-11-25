import { describe, expect, it, vi } from 'vitest';
import type { GraphApi, UserLink, UserNode } from '@kentzu213/graph-view';
import type { CustomerCareCrmRow } from '../../shared/customer-care-types';
import {
  CRM_VIRTUAL_HUB_ID,
  CRM_VIRTUAL_LEAD_PREFIX,
  CRM_VIRTUAL_LINK_PREFIX,
  CRM_VIRTUAL_PAGE_PREFIX,
  CRM_VIRTUAL_PERSONA_PREFIX,
  CRM_VIRTUAL_PREFIX,
  CRM_VIRTUAL_SALER_PREFIX,
  createMyGraphWithCrmApi,
} from './mygraph-crm-overlay';

const WS_A = '11111111-1111-4111-8111-111111111111';
const WS_B = '22222222-2222-4222-8222-222222222222';
const PAGE_ID = '105252511858057';
const SALER_ID = 'saler-lan-1';

function row(overrides: Partial<CustomerCareCrmRow> = {}): CustomerCareCrmRow {
  return {
    leadId: '44444444-4444-4444-8444-444444444444',
    pageId: PAGE_ID,
    customerName: 'Nguyễn Văn Hùng',
    phone: '0901234567',
    zaloMentioned: true,
    leadStatus: 'contacted',
    phoneCapturedAt: '2026-11-20T08:00:00.000Z',
    lastMessageAt: '2026-11-20T09:00:00.000Z',
    recentMessages: [{ text: 'Anh muốn đặt bộ đồ thờ 0901234567', at: '2026-11-20T09:00:00.000Z' }],
    profile: {
      stage: 'consulting',
      ownerUserId: null,
      addressForm: 'anh',
      occasion: 'new_home',
      neededBy: null,
      productFactIds: [],
      nextStep: 'Gọi lại chiều nay',
      nextStepDueAt: null,
      lostReason: null,
      purchasedAt: null,
      note: null,
      salerId: SALER_ID,
      careStep: 'step2_called',
      callTries: 1,
      updatedAt: '2026-11-20T09:05:00.000Z',
      updatedBy: null,
    },
    ...overrides,
  };
}

function makeBaseApi() {
  const cloudNode: UserNode = {
    id: 'cloud-node-1',
    title: 'Ghi chú doanh nghiệp',
    nodeType: 'note',
    color: '#5ca7ff',
    metadata: JSON.stringify({ tags: ['company'] }),
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  };
  const cloudLink: UserLink = {
    id: 'cloud-link-1',
    sourceId: 'cloud-node-1',
    targetId: 'cloud-node-2',
    label: 'related',
  };
  const baseApi: GraphApi = {
    fetchMe: vi.fn(async () => ({ data: { id: 'user-1' }, error: null, status: 200 })),
    fetchNodes: vi.fn(async () => ({ data: { nodes: [cloudNode] }, error: null, status: 200 })),
    fetchLinks: vi.fn(async () => ({ data: { links: [cloudLink] }, error: null, status: 200 })),
    fetchContributions: vi.fn(async () => ({ data: { contributions: [] }, error: null, status: 200 })),
    createNode: vi.fn(async () => ({ data: { node: { id: 'created-1' } }, error: null, status: 200 })),
    updateNode: vi.fn(async () => ({ data: { node: null }, error: null, status: 200 })),
    removeNode: vi.fn(async () => ({ data: undefined as void, error: null, status: 200 })),
    createLink: vi.fn(async () => ({ data: { link: cloudLink }, error: null, status: 200 })),
    updateLink: vi.fn(async () => ({ data: { link: cloudLink }, error: null, status: 200 })),
    removeLink: vi.fn(async () => ({ data: undefined as void, error: null, status: 200 })),
    searchNodes: vi.fn(async () => ({ data: { results: [] }, error: null, status: 200 })),
    fetchCommunities: vi.fn(async () => ({ data: { communities: [] }, error: null, status: 200 })),
    importUrl: vi.fn(async () => ({ data: null, error: 'unused', status: 400 })),
    extractDocument: vi.fn(async () => ({ data: null, error: 'unused', status: 400 })),
    extractPdf: vi.fn(async () => ({ nodes: [], links: [] })),
    synthesizeTopic: vi.fn(async () => ({ data: null, error: 'unused', status: 400 })),
  };
  return { baseApi, cloudNode, cloudLink };
}

describe('mygraph-crm-overlay', () => {
  it('merges virtual Hub, Page, Saler and masked Lead nodes in RAM after cloud nodes', async () => {
    const { baseApi } = makeBaseApi();
    const api = createMyGraphWithCrmApi(baseApi, {
      getElectronApi: () => ({
        auth: { getUser: async () => ({ id: 'user-1' }) },
        customerCare: {
          listCrm: async () => ({
            ok: true,
            workspaceId: WS_A,
            role: 'owner',
            canDelete: true,
            rows: [row()],
            nextCursor: null,
            assignees: [],
            pages: [{ pageId: PAGE_ID, pageName: 'Đồ Đồng Đại Long' }],
            salers: [{ id: SALER_ID, name: 'Lan', color: 'teal', active: true, assignedPageIds: [PAGE_ID], memberUserId: null }],
            identityEnabled: true,
            identityUnavailable: false,
            consentAsk: null,
          }),
        },
      }),
    });

    const nodesRes = await api.fetchNodes();
    const linksRes = await api.fetchLinks();
    const nodes = nodesRes.data!.nodes;
    const links = linksRes.data!.links;

    expect(nodes.map((n) => n.id)).toEqual([
      'cloud-node-1',
      CRM_VIRTUAL_HUB_ID,
      `${CRM_VIRTUAL_PAGE_PREFIX}${PAGE_ID}`,
      `${CRM_VIRTUAL_SALER_PREFIX}${SALER_ID}`,
      `${CRM_VIRTUAL_LEAD_PREFIX}44444444-4444-4444-8444-444444444444`,
    ]);

    const leadNode = nodes.find((n) => n.id.startsWith(CRM_VIRTUAL_LEAD_PREFIX))!;
    // Title masks prefix/middle digits against screen-recording leaks.
    expect(leadNode.title).toBe('Nguyễn Văn Hùng · •••567');
    expect(leadNode.title).not.toContain('0901234567');
    // Detail content holds full info in RAM.
    expect(leadNode.content).toContain('SĐT đầy đủ: 0901234567');
    expect(leadNode.content).toContain('Page nguồn: Đồ Đồng Đại Long');
    expect(leadNode.content).toContain('Saler phụ trách: Lan');
    expect(leadNode.content).toContain('Có nhắc Zalo');
    expect(JSON.parse(String(leadNode.metadata))).toMatchObject({
      virtualCrm: true,
      tags: expect.arrayContaining(['data-khach-hang', 'sdt-khach', 'co-zalo']),
    });
    expect(links.some((l) => l.targetId === leadNode.id && l.sourceId === `${CRM_VIRTUAL_PAGE_PREFIX}${PAGE_ID}`)).toBe(true);
    expect(links.some((l) => l.targetId === leadNode.id && l.sourceId === `${CRM_VIRTUAL_SALER_PREFIX}${SALER_ID}`)).toBe(true);
    expect(nodes.some((n) => n.id.startsWith(CRM_VIRTUAL_PERSONA_PREFIX))).toBe(false);
    expect(baseApi.createNode).not.toHaveBeenCalled();
    expect(baseApi.updateNode).not.toHaveBeenCalled();
  });

  it('links Persona P1-P4 ONLY when consent.state === granted', async () => {
    const { baseApi } = makeBaseApi();
    const identityBase = {
      version: '1',
      lastRunAt: '2026-11-20T09:00:00.000Z',
      occasion: null,
      timeline: null,
      productFactIds: null,
      addressForm: null,
      ageBand: null,
      family: null,
      interests: null,
      persona: {
        value: 'P1' as const,
        confidence: 'high' as const,
        kind: 'inferred' as const,
        source: 'ai' as const,
        status: 'confirmed' as const,
        updatedAt: '2026-11-20T09:00:00.000Z',
        evidence: [],
        summary: 'Nhà mới',
      },
    };
    const api = createMyGraphWithCrmApi(baseApi, {
      getElectronApi: () => ({
        auth: { getUser: async () => ({ id: 'user-1' }) },
        customerCare: {
          listCrm: async () => ({
            ok: true,
            workspaceId: WS_A,
            role: 'manager',
            canDelete: true,
            rows: [
              row({
                leadId: '44444444-4444-4444-8444-444444444441',
                identity: { ...identityBase, consent: { state: 'unknown', at: null, noMarketing: false, canAsk: true } },
              }),
              row({
                leadId: '44444444-4444-4444-8444-444444444442',
                identity: { ...identityBase, consent: { state: 'granted', at: '2026-11-20T09:00:00.000Z', noMarketing: false, canAsk: false } },
              }),
            ],
            nextCursor: null,
            assignees: [],
            pages: [{ pageId: PAGE_ID, pageName: 'Đồ Đồng Đại Long' }],
            identityEnabled: true,
            identityUnavailable: false,
            consentAsk: null,
          }),
        },
      }),
    });

    const links = (await api.fetchLinks()).data!.links;
    expect(links.some((l) => l.targetId === `${CRM_VIRTUAL_LEAD_PREFIX}44444444-4444-4444-8444-444444444441` && l.sourceId.startsWith(CRM_VIRTUAL_PERSONA_PREFIX))).toBe(false);
    expect(links.some((l) => l.targetId === `${CRM_VIRTUAL_LEAD_PREFIX}44444444-4444-4444-8444-444444444442` && l.sourceId === `${CRM_VIRTUAL_PERSONA_PREFIX}P1`)).toBe(true);
  });

  it('searches virtual CRM nodes in RAM by name, full 10-digit phone, last 4 digits, Page and Saler', async () => {
    const { baseApi } = makeBaseApi();
    const api = createMyGraphWithCrmApi(baseApi, {
      getElectronApi: () => ({
        auth: { getUser: async () => ({ id: 'user-1' }) },
        customerCare: {
          listCrm: async () => ({
            ok: true,
            workspaceId: WS_A,
            role: 'editor',
            canDelete: false,
            rows: [row()],
            nextCursor: null,
            assignees: [],
            pages: [{ pageId: PAGE_ID, pageName: 'Đồ Đồng Đại Long' }],
            salers: [{ id: SALER_ID, name: 'Lan', color: 'teal', active: true, assignedPageIds: [PAGE_ID], memberUserId: null }],
            identityEnabled: false,
            identityUnavailable: false,
            consentAsk: null,
          }),
        },
      }),
    });

    for (const q of ['Hung', '0901 234 567', '4567', 'Đồ Đồng Đại Long', 'Lan']) {
      const res = await api.searchNodes(q, 10);
      expect(res.data?.results.length, q).toBeGreaterThan(0);
    }
  });

  it('enforces @socrates SECURITY GATE: allows {x,y} in RAM only, fails closed on content/link mutations and removeNode', async () => {
    const { baseApi } = makeBaseApi();
    const api = createMyGraphWithCrmApi(baseApi, {
      getElectronApi: () => ({
        auth: { getUser: async () => ({ id: 'user-1' }) },
        customerCare: {
          listCrm: async () => ({
            ok: true,
            workspaceId: WS_A,
            role: 'owner',
            canDelete: true,
            rows: [row()],
            nextCursor: null,
            assignees: [],
            identityEnabled: false,
            identityUnavailable: false,
            consentAsk: null,
          }),
        },
      }),
    });

    const leadId = `${CRM_VIRTUAL_LEAD_PREFIX}44444444-4444-4444-8444-444444444444`;
    const posRes = await api.updateNode(leadId, { x: 120, y: 240 });
    expect(posRes).toEqual({ data: { node: null }, error: null, status: 200 });
    expect(baseApi.updateNode).not.toHaveBeenCalled();

    const fetched = (await api.fetchNodes()).data!.nodes.find((n) => n.id === leadId)!;
    expect(fetched.x).toBe(120);
    expect(fetched.y).toBe(240);

    for (const forbiddenPatch of [
      { title: 'hacked' },
      { content: 'hacked' },
      { url: 'https://evil.example' },
      { metadata: '{}' },
      { x: 10, title: 'hacked' },
    ]) {
      const bad = await api.updateNode(leadId, forbiddenPatch);
      expect(bad.data).toBeNull();
      expect(bad.status).toBe(403);
      expect(baseApi.updateNode).not.toHaveBeenCalled();
    }

    expect((await api.removeNode(leadId)).status).toBe(403);
    expect(baseApi.removeNode).not.toHaveBeenCalled();

    expect((await api.createLink({ sourceId: leadId, targetId: 'cloud-node-1' })).status).toBe(403);
    expect(baseApi.createLink).not.toHaveBeenCalled();

    expect((await api.updateLink(`${CRM_VIRTUAL_LINK_PREFIX}1`, { label: 'x' })).status).toBe(403);
    expect(baseApi.updateLink).not.toHaveBeenCalled();

    expect((await api.removeLink(`${CRM_VIRTUAL_LINK_PREFIX}1`)).status).toBe(403);
    expect(baseApi.removeLink).not.toHaveBeenCalled();

    // Real cloud nodes still delegate normally.
    await api.updateNode('cloud-node-1', { title: 'Updated' });
    expect(baseApi.updateNode).toHaveBeenCalledWith('cloud-node-1', { title: 'Updated' });
  });

  it('clears RAM cache when role drops to viewer, user logs out, or workspace changes', async () => {
    const { baseApi } = makeBaseApi();
    let user: { id: string } | null = { id: 'user-1' };
    let workspace = WS_A;
    let role: 'owner' | 'viewer' = 'owner';
    let clock = 1_000;

    const api = createMyGraphWithCrmApi(baseApi, {
      now: () => clock,
      getElectronApi: () => ({
        auth: { getUser: async () => user },
        customerCare: {
          listCrm: async () => {
            if (role === 'viewer') return { ok: false, error: 'forbidden' };
            return {
              ok: true,
              workspaceId: workspace,
              role,
              canDelete: true,
              rows: [row({ customerName: workspace === WS_A ? 'Khách A' : 'Khách B' })],
              nextCursor: null,
              assignees: [],
              identityEnabled: false,
              identityUnavailable: false,
              consentAsk: null,
            };
          },
        },
      }),
    });

    expect((await api.fetchNodes()).data!.nodes.some((n) => n.id.startsWith(CRM_VIRTUAL_PREFIX))).toBe(true);

    // Role downgraded after TTL -> cleared.
    role = 'viewer';
    clock += 20_000;
    const viewerNodes = (await api.fetchNodes()).data!.nodes;
    expect(viewerNodes.map((n) => n.id)).toEqual(['cloud-node-1']);

    // Workspace switch -> loads new workspace only.
    role = 'owner';
    workspace = WS_B;
    clock += 20_000;
    const wsBNodes = (await api.fetchNodes()).data!.nodes;
    expect(wsBNodes.some((n) => n.title.includes('Khách B'))).toBe(true);
    expect(wsBNodes.some((n) => n.title.includes('Khách A'))).toBe(false);

    // Logout -> clears immediately even before TTL expires.
    user = null;
    const loggedOutNodes = (await api.fetchNodes()).data!.nodes;
    expect(loggedOutNodes.map((n) => n.id)).toEqual(['cloud-node-1']);
  });

  it('caps canvas lead nodes with balanced Page sampling while searching 100% of leads including +84 format', async () => {
    const { baseApi } = makeBaseApi();
    const total = 260;
    const rows: CustomerCareCrmRow[] = Array.from({ length: total }, (_, idx) =>
      row({
        leadId: `lead-${idx}`,
        pageId: idx % 2 === 0 ? '105252511858057' : '605108389343942',
        customerName: idx === 259 ? 'Khách Ẩn Cuối Sách' : `Khách ${idx}`,
        phone: idx === 259 ? '0911222333' : `0987${String(idx).padStart(6, '0')}`,
        lastMessageAt: new Date(Date.UTC(2026, 10, 1) + idx * 60_000).toISOString(),
      }));
    const api = createMyGraphWithCrmApi(baseApi, {
      getElectronApi: () => ({
        auth: { getUser: async () => ({ id: 'user-1' }) },
        customerCare: {
          listCrm: async () => ({
            ok: true,
            workspaceId: WS_A,
            role: 'owner',
            canDelete: true,
            rows,
            nextCursor: null,
            assignees: [],
            identityEnabled: false,
            identityUnavailable: false,
            consentAsk: null,
          }),
        },
      }),
    });

    const nodesRes = await api.fetchNodes();
    const leadNodes = nodesRes.data!.nodes.filter((n) => n.id.startsWith(`${CRM_VIRTUAL_PREFIX}lead:`));
    expect(leadNodes.length).toBe(240);

    const searchOldest = await api.searchNodes('+84 911 222 333', 5);
    expect(searchOldest.data?.results.some((r) => r.title.includes('Khách Ẩn Cuối Sách'))).toBe(true);

    const multiToken = await api.searchNodes('khach an cuoi', 5);
    expect(multiToken.data?.results.some((r) => r.title.includes('Khách Ẩn Cuối Sách'))).toBe(true);
  });

  it('rejects createNode parented under virtual CRM nodes and invalidates cache on workspace switch within TTL', async () => {
    const { baseApi } = makeBaseApi();
    let workspace = WS_A;
    let clock = 5_000;
    const api = createMyGraphWithCrmApi(baseApi, {
      now: () => clock,
      getElectronApi: () => ({
        auth: { getUser: async () => ({ id: 'user-1' }) },
        customerCare: {
          getSnapshot: async () => ({ workspaceId: workspace } as never),
          listCrm: async () => ({
            ok: true,
            workspaceId: workspace,
            role: 'owner',
            canDelete: true,
            rows: [row({ leadId: `lead-${workspace}`, customerName: workspace === WS_A ? 'Khách WS A' : 'Khách WS B' })],
            nextCursor: null,
            assignees: [],
            identityEnabled: false,
            identityUnavailable: false,
            consentAsk: null,
          }),
        },
      }),
    });

    const parentGuard = await api.createNode({ title: 'Test', parentId: `${CRM_VIRTUAL_PREFIX}hub` });
    expect(parentGuard.status).toBe(403);
    expect(baseApi.createNode).not.toHaveBeenCalled();

    const first = await api.fetchNodes();
    expect(first.data!.nodes.some((n) => n.title.includes('Khách WS A'))).toBe(true);

    workspace = WS_B;
    clock += 1_000; // Within TTL!
    const second = await api.fetchNodes();
    expect(second.data!.nodes.some((n) => n.title.includes('Khách WS B'))).toBe(true);
    expect(second.data!.nodes.some((n) => n.title.includes('Khách WS A'))).toBe(false);
  });
});
