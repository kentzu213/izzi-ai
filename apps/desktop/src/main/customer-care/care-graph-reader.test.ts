import { describe, expect, it } from 'vitest';
import type { GraphNode } from '../../shared/graph-types';
import { buildCareGraphNodes, careWorkspaceKey, type CareGraphSource } from './care-graph-digest';
import { careDirectorContext, careDirectorContextFromCache, readCareGraph } from './care-graph-reader';

const NOW = Date.parse('2026-11-19T05:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const SCOPE = { identityId: 'user-1', workspaceId: 'ws-hong-hung' };
const WS = careWorkspaceKey(SCOPE.identityId, SCOPE.workspaceId);
const OTHER_WS = careWorkspaceKey(SCOPE.identityId, 'ws-other');

const SOURCE: CareGraphSource = {
  pageName: 'Đồng Thờ Hồng Hưng',
  page: 'connected',
  facts: { byTopic: { catalog: 4, price: 1, quality: 0, policy: 0, contact: 3 }, expired: 0, handoffSet: true },
  autoReply: {
    enabled: true,
    enabledAt: '2026-11-19T03:05:00.000Z',
    available: true,
    scriptUpdatedAt: '2026-11-19T03:05:00.000Z',
    factCount: 8,
    sentLast24h: 5,
    lastSentAt: '2026-11-19T04:30:00.000Z',
    stoppedLast24h: 2,
    lastProblem: { reason: 'standby', at: '2026-11-19T04:00:00.000Z' },
  },
  leads: { last24h: 1, last7d: 3, open: 2, capped: false },
};

/** The nodes as the synced graph cache holds them: ids, times, and backend auto-tags merged into metadata. */
function cachedNodes(source: CareGraphSource, wsKey: string, asOf: string, updatedAt = asOf): GraphNode[] {
  return buildCareGraphNodes(source, wsKey, asOf).map((draft, index) => ({
    id: `${wsKey}-${index}`,
    title: draft.title,
    nodeType: draft.nodeType,
    content: draft.content,
    url: draft.url,
    color: draft.color,
    metadata: { ...draft.metadata, tags: ['marketing'] },
    createdAt: asOf,
    updatedAt,
  }));
}

const directorText = (source: CareGraphSource, asOf: number): string => {
  const view = readCareGraph(cachedNodes(source, WS, new Date(asOf).toISOString()), WS)!;
  return careDirectorContext(view, NOW).join('\n');
};

describe('readCareGraph', () => {
  it('reads back the Care nodes of the workspace, ignoring backend tags and other nodes', () => {
    // Arrange
    const asOf = new Date(NOW).toISOString();
    const nodes = [
      { id: 'n1', title: 'Ghi chú', nodeType: 'note', color: '#fff', createdAt: asOf, updatedAt: asOf },
      ...cachedNodes(SOURCE, WS, asOf),
      ...cachedNodes({ ...SOURCE, facts: null }, OTHER_WS, asOf),
    ];

    // Act
    const view = readCareGraph(nodes, WS);

    // Assert
    const expected = buildCareGraphNodes(SOURCE, WS, asOf).map((node) => node.metadata);
    expect(view).toEqual({ process: expected[0], facts: expected[1], results: expected[2], crmSegments: null });
  });

  it('returns null when the cache is missing, not a list, or has no Care node for the workspace', () => {
    expect(readCareGraph(undefined, WS)).toBeNull();
    expect(readCareGraph({ nodes: [] }, WS)).toBeNull();
    expect(readCareGraph(cachedNodes(SOURCE, OTHER_WS, new Date(NOW).toISOString()), WS)).toBeNull();
  });

  it('drops a node whose metadata is malformed instead of trusting it', () => {
    // Arrange
    const asOf = new Date(NOW).toISOString();
    const [process, facts, results] = cachedNodes(SOURCE, WS, asOf);
    const broken = [
      { ...process, metadata: { ...process.metadata, autoReply: 'maybe' } },
      { ...facts, metadata: { ...facts.metadata, byTopic: { catalog: -1 } } },
      { ...results, metadata: { ...results.metadata, sent24h: 1.5, lastProblem: 'hacked' } },
    ];

    // Act
    const view = readCareGraph(broken, WS);

    // Assert
    expect(view).toBeNull();
  });

  it('prefers the most recently updated node when a kind appears twice', () => {
    // Arrange
    const older = cachedNodes(SOURCE, WS, new Date(NOW - 12 * HOUR).toISOString());
    const newer = cachedNodes(
      { ...SOURCE, leads: { last24h: 4, last7d: 9, open: 1, capped: false } },
      WS,
      new Date(NOW).toISOString(),
    ).map((node) => ({ ...node, id: `${node.id}-new` }));

    // Act
    const view = readCareGraph([...newer, ...older], WS);

    // Assert
    expect(view?.results?.leads7d).toBe(9);
  });

  it('parses valid care-crm-segments metadata and drops malformed segment counts', () => {
    const asOf = new Date(NOW).toISOString();
    const withCrm: CareGraphSource = {
      ...SOURCE,
      crmSegments: {
        totalLeads: 20,
        leadsCapped: false,
        byStage: { has_phone: 5, consulting: 8, deposit: 2, delivered: 3, lost: 1, do_not_contact: 1 },
        byPersona: { P1: 9, P2: 5, P3: 2, P4: 2, unclassified: 2 },
        adsBuckets: { highIntent: 13, vipLookalike: 5, reengageLost: 1, consented: 8, suppressed: 1 },
        lifecycleDue: { postSale: 2, remarketing: 3 },
      },
    };
    const nodes = cachedNodes(withCrm, WS, asOf);
    const view = readCareGraph(nodes, WS);
    expect(view?.crmSegments?.totalLeads).toBe(20);
    expect(view?.crmSegments?.byPersona.P1).toBe(9);

    const segNode = nodes.find((n) => (n.metadata as { kind?: string }).kind === 'care-crm-segments')!;
    const malformed = [{ ...segNode, metadata: { ...segNode.metadata, byPersona: { P1: -5 } } }];
    expect(readCareGraph(malformed, WS)).toBeNull();
  });
});

describe('careDirectorContextFromCache', () => {
  it('reads the cached graph for the account and workspace, and nothing cached for another account', () => {
    // Arrange
    const nodes = cachedNodes(SOURCE, WS, new Date(NOW).toISOString());

    // Act
    const lines = careDirectorContextFromCache(nodes, SCOPE, NOW);
    const otherWorkspace = careDirectorContextFromCache(nodes, { ...SCOPE, workspaceId: 'ws-other' }, NOW);
    const otherAccount = careDirectorContextFromCache(nodes, { ...SCOPE, identityId: 'user-2' }, NOW);
    const broken = careDirectorContextFromCache('not a list', SCOPE, NOW);

    // Assert
    expect(lines[0]).toContain('từ MyGraph');
    expect(otherWorkspace).toEqual([]);
    expect(otherAccount).toEqual([]);
    expect(broken).toEqual([]);
  });
});

describe('careDirectorContext', () => {
  it('summarises Care for the Director and turns gaps into actions', () => {
    // Act
    const text = directorText(SOURCE, NOW);

    // Assert
    expect(text).toContain('Chăm sóc khách trên Facebook Page (từ MyGraph, cập nhật 19/11/2026 12:00)');
    expect(text).toContain('Tự trả lời khách: đang bật từ 19/11/2026 10:05; Page đã kết nối.');
    expect(text).toContain(
      'Danh mục 4, Giá 1, Chất lượng 0, Chính sách 0, Liên hệ 3; còn thiếu: Chất lượng, Chính sách; bàn giao nhân viên đã cài.',
    );
    expect(text).toContain('24 giờ qua: izzi gửi 5 tin, dừng với 2 khách. 7 ngày qua: 3 khách để lại số, 2 khách chưa được gọi lại.');
    expect(text).toContain('CTA "Nhắn tin Page để được tư vấn"');
    expect(text).toContain('bổ sung thông tin đã duyệt về: Chất lượng, Chính sách');
    expect(text).toContain('Phân luồng hội thoại');
    expect(text).toContain('không phải proof claim');
  });

  it('does not promise instant Messenger answers when automatic replies are off', () => {
    // Act
    const text = directorText({ ...SOURCE, autoReply: { ...SOURCE.autoReply!, enabled: false, lastProblem: null } }, NOW);

    // Assert
    expect(text).toContain('Tự trả lời khách: đang tắt');
    expect(text).not.toContain('CTA "Nhắn tin Page để được tư vấn"');
    expect(text).toContain('không hứa khách sẽ được trả lời ngay trên Messenger');
    expect(text).not.toContain('Phân luồng hội thoại');
  });

  it('flags numbers older than 48 hours and drops the CTA and KPI advice built on them', () => {
    // Act
    const text = directorText(SOURCE, NOW - 49 * HOUR);

    // Assert
    expect(text).toContain('đã cũ hơn 48 giờ');
    expect(text).toContain('không đặt KPI theo các số này');
    expect(text).not.toContain('CTA "Nhắn tin Page để được tư vấn"');
    expect(text).toContain('Chưa có số liệu mới để xác nhận tự trả lời còn chạy');
  });

  it('gives no CTA advice when the graph has no results node yet', () => {
    // Act
    const text = directorText({ ...SOURCE, leads: null }, NOW);

    // Assert
    expect(text).toContain('(từ MyGraph, chưa có số liệu kết quả)');
    expect(text).not.toContain('CTA "Nhắn tin Page để được tư vấn"');
    expect(text).not.toContain('24 giờ qua');
  });

  it('shows reply counts the server did not give as unread rather than zero', () => {
    // Act
    const text = directorText({ ...SOURCE, autoReply: null }, NOW);

    // Assert
    expect(text).toContain('24 giờ qua: chưa đọc được số tin izzi gửi.');
    expect(text).toContain('7 ngày qua: 3 khách để lại số');
  });

  it('adds CRM segment summary and Director Ads/Lifecycle guidance when crmSegments is fresh (<48h), and omits it when stale', () => {
    const crmSegments = {
      totalLeads: 24,
      leadsCapped: false,
      byStage: { has_phone: 6, consulting: 9, deposit: 3, delivered: 4, lost: 1, do_not_contact: 1 },
      byPersona: { P1: 11, P2: 6, P3: 2, P4: 3, unclassified: 2 },
      adsBuckets: { highIntent: 15, vipLookalike: 7, reengageLost: 1, consented: 10, suppressed: 1 },
      lifecycleDue: { postSale: 3, remarketing: 4 },
    };

    const freshText = directorText({ ...SOURCE, crmSegments }, NOW);
    expect(freshText).toContain('Phân khúc CRM (24 khách');
    expect(freshText).toContain('P1 (Gia chủ nhà mới / Sắm chính');
    expect(freshText).toContain('Lookalike 1%–3%');
    expect(freshText).toContain('3 lịch Hậu mãi');

    const staleText = directorText({ ...SOURCE, crmSegments }, NOW - 49 * HOUR);
    expect(staleText).not.toContain('Phân khúc CRM (24 khách');
    expect(staleText).not.toContain('Lookalike 1%–3%');
  });
});
