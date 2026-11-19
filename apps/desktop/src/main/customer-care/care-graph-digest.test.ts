import { describe, expect, it } from 'vitest';
import type { CustomerCareAutoReplyState } from '../../shared/customer-care-types';
import {
  CARE_GRAPH_COLOR,
  buildCareGraphNodes,
  carePageState,
  careWorkspaceKey,
  countCareFacts,
  formatCareGraphTime,
  scrubCareGraphText,
  summarizeCareLeads,
  type CareGraphSource,
} from './care-graph-digest';

const NOW = Date.parse('2026-11-19T05:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const iso = (ms: number): string => new Date(ms).toISOString();

const AUTO_REPLY_ON: CustomerCareAutoReplyState = {
  enabled: true,
  enabledAt: '2026-11-19T03:05:00.000Z',
  available: true,
  scriptUpdatedAt: '2026-11-19T03:05:00.000Z',
  factCount: 8,
  sentLast24h: 5,
  lastSentAt: '2026-11-19T04:30:00.000Z',
  stoppedLast24h: 2,
  lastProblem: { reason: 'standby', at: '2026-11-19T04:00:00.000Z' },
};

function source(overrides: Partial<CareGraphSource> = {}): CareGraphSource {
  return {
    pageName: 'Đồng Thờ Hồng Hưng',
    page: 'connected',
    facts: {
      byTopic: { catalog: 4, price: 1, quality: 0, policy: 0, contact: 3 },
      expired: 0,
      handoffSet: true,
    },
    autoReply: AUTO_REPLY_ON,
    leads: { last24h: 1, last7d: 3, open: 2, capped: false },
    ...overrides,
  };
}

describe('careWorkspaceKey', () => {
  it('is stable, 16 letters a-p, and depends on both the account and the workspace', () => {
    // Act
    const key = careWorkspaceKey('user-1', 'ws-1234567890-abc');

    // Assert
    expect(key).toMatch(/^[a-p]{16}$/);
    expect(careWorkspaceKey('user-1', 'ws-1234567890-abc')).toBe(key);
    expect(careWorkspaceKey('user-1', 'ws-other')).not.toBe(key);
    expect(careWorkspaceKey('user-2', 'ws-1234567890-abc')).not.toBe(key);
  });
});

describe('carePageState', () => {
  it('names an active, a stale, a missing and an unreadable Page connection', () => {
    const connected = {
      state: 'connected' as const, pageId: '1', pageName: null, missingScopes: [], verifiedAt: iso(NOW),
    };
    expect(carePageState({ ...connected, status: 'active' })).toBe('connected');
    expect(carePageState({ ...connected, status: 'needs_reauth' })).toBe('needs_reauth');
    expect(carePageState({ state: 'not_connected' })).toBe('not_connected');
    expect(carePageState({ state: 'unsupported' })).toBe('unknown');
  });
});

describe('countCareFacts', () => {
  it('counts active facts by topic and counts expired ones apart', () => {
    // Arrange
    const facts = [
      { topic: 'catalog' as const },
      { topic: 'catalog' as const, expiresAt: iso(NOW + HOUR) },
      { topic: 'price' as const, expiresAt: iso(NOW - HOUR) },
      { topic: 'contact' as const },
    ];

    // Act
    const coverage = countCareFacts(facts, NOW);

    // Assert
    expect(coverage).toEqual({
      byTopic: { catalog: 2, price: 0, quality: 0, policy: 0, contact: 1 },
      expired: 1,
    });
  });
});

describe('summarizeCareLeads', () => {
  it('counts phones left in the last 24 hours and 7 days, and leads not called back yet', () => {
    // Arrange
    const leads = [
      { phoneCapturedAt: iso(NOW - 2 * HOUR), status: 'new' as const },
      { phoneCapturedAt: iso(NOW - 30 * HOUR), status: 'contacted' as const },
      { phoneCapturedAt: iso(NOW - 6 * 24 * HOUR), status: 'new' as const },
      { phoneCapturedAt: iso(NOW - 9 * 24 * HOUR), status: 'closed' as const },
      { phoneCapturedAt: 'not-a-date', status: 'new' as const },
    ];

    // Act
    const summary = summarizeCareLeads(leads, NOW, false);

    // Assert
    expect(summary).toEqual({ last24h: 1, last7d: 3, open: 3, capped: false });
  });

  it('marks the counts as a lower bound when the first page was full', () => {
    expect(summarizeCareLeads([], NOW, true)).toEqual({ last24h: 0, last7d: 0, open: 0, capped: true });
  });
});

describe('scrubCareGraphText', () => {
  it('replaces runs of 8 or more digits, even with separators, and bounds the length', () => {
    expect(scrubCareGraphText('Shop 0912 345 678 Hà Nội')).toBe('Shop [số] Hà Nội');
    expect(scrubCareGraphText('Page 2024')).toBe('Page 2024');
    expect(scrubCareGraphText('  ')).toBeNull();
    expect(scrubCareGraphText(null)).toBeNull();
    expect(scrubCareGraphText('a'.repeat(200))?.length).toBe(80);
  });
});

describe('formatCareGraphTime', () => {
  it('shows Vietnam time as dd/MM/yyyy HH:mm', () => {
    expect(formatCareGraphTime('2026-11-19T03:05:00.000Z')).toBe('19/11/2026 10:05');
    expect(formatCareGraphTime('2026-11-19T18:30:00.000Z')).toBe('20/11/2026 01:30');
  });
});

describe('buildCareGraphNodes', () => {
  const wsKey = careWorkspaceKey('user-1', 'ws-hong-hung');
  const asOf = iso(NOW);

  it('builds the three Care nodes with fixed titles, a per-workspace url and the muted color', () => {
    // Act
    const nodes = buildCareGraphNodes(source(), wsKey, asOf);

    // Assert
    expect(nodes.map((node) => node.kind)).toEqual(['care-process', 'care-facts', 'care-results']);
    expect(nodes.map((node) => node.title)).toEqual([
      'Chăm sóc khách · Quy trình',
      'Chăm sóc khách · Thông tin đã duyệt',
      'Chăm sóc khách · Kết quả',
    ]);
    for (const node of nodes) {
      expect(node.url).toBe(`https://izziapi.com/aibase/graph?care=${node.kind}&ws=${wsKey}`);
      expect(node.color).toBe(CARE_GRAPH_COLOR);
      expect(node.nodeType).toBe('note');
      expect(node.metadata.wsKey).toBe(wsKey);
      expect(node.metadata.schema).toBe(1);
    }
  });

  it('describes the process, the switch and the Page in the process node, from server state only', () => {
    // Act
    const [process] = buildCareGraphNodes(source(), wsKey, asOf);

    // Assert
    expect(process.metadata).toEqual({
      kind: 'care-process',
      schema: 1,
      wsKey,
      processVersion: 'phase-c-1',
      page: 'connected',
      autoReply: 'on',
      autoReplySince: '2026-11-19T03:05:00.000Z',
      factsUploadedAt: '2026-11-19T03:05:00.000Z',
      serverFactCount: 8,
    });
    expect(process.content).toContain('Máy chủ đang trả lời bằng 8 thông tin đã duyệt, gửi lên lúc 19/11/2026 10:05.');
    expect(process.content).toContain('Đồng Thờ Hồng Hưng');
    expect(process.content).toContain('đang bật từ 19/11/2026 10:05');
    expect(process.content).toContain('tối đa 3 tin');
  });

  it('lists topic counts, missing topics and the handoff flag in the facts node, never fact text', () => {
    // Act
    const [, facts] = buildCareGraphNodes(source(), wsKey, asOf);

    // Assert
    expect(facts.metadata).toEqual({
      kind: 'care-facts',
      schema: 1,
      wsKey,
      handoffSet: true,
      byTopic: { catalog: 4, price: 1, quality: 0, policy: 0, contact: 3 },
      expired: 0,
      missing: ['quality', 'policy'],
    });
    expect(facts.content).toContain('Danh mục 4 · Giá 1 · Chất lượng 0 · Chính sách 0 · Liên hệ 3');
    expect(facts.content).toContain('Còn thiếu: Chất lượng, Chính sách');
    expect(facts.content).toContain('Bàn giao nhân viên: đã cài');
  });

  it('leaves the facts node alone when this machine holds a different setup than the server answers with', () => {
    // Arrange: automatic replies are on and the server script has 9 facts; this machine has 8 active ones.
    const older = source({ autoReply: { ...AUTO_REPLY_ON, factCount: 9 } });
    const offline = source({ autoReply: { ...AUTO_REPLY_ON, enabled: false, factCount: 9 } });

    // Act
    const kinds = buildCareGraphNodes(older, wsKey, asOf).map((node) => node.kind);
    const kindsWhenOff = buildCareGraphNodes(offline, wsKey, asOf).map((node) => node.kind);

    // Assert
    expect(kinds).toEqual(['care-process', 'care-results']);
    expect(kindsWhenOff).toEqual(['care-process', 'care-facts', 'care-results']);
  });

  it('keeps the facts fingerprint when only the server upload time changes', () => {
    // Act
    const before = buildCareGraphNodes(source(), wsKey, asOf);
    const after = buildCareGraphNodes(
      source({ autoReply: { ...AUTO_REPLY_ON, scriptUpdatedAt: '2026-11-19T04:59:00.000Z' } }),
      wsKey,
      asOf,
    );

    // Assert
    expect(after[1].fingerprint).toBe(before[1].fingerprint);
    expect(after[0].fingerprint).not.toBe(before[0].fingerprint);
  });

  it('puts only counts, a problem code and the time in the results node', () => {
    // Act
    const [, , results] = buildCareGraphNodes(source(), wsKey, asOf);

    // Assert
    expect(results.metadata).toEqual({
      kind: 'care-results',
      schema: 1,
      wsKey,
      asOf,
      sent24h: 5,
      stopped24h: 2,
      leads24h: 1,
      leads7d: 3,
      leadsOpen: 2,
      leadsCapped: false,
      lastProblem: 'standby',
    });
    expect(results.content).toContain('izzi gửi 5 tin');
    expect(results.content).toContain('3 khách để lại số');
  });

  it('builds only the process node when this machine has no saved setup and no fresh lead check', () => {
    // Act
    const nodes = buildCareGraphNodes(
      source({ page: 'not_connected', pageName: null, facts: null, autoReply: null, leads: null }),
      wsKey,
      asOf,
    );

    // Assert
    expect(nodes.map((node) => node.kind)).toEqual(['care-process']);
    expect(nodes[0].metadata).toMatchObject({
      page: 'not_connected', autoReply: 'unknown', autoReplySince: null, factsUploadedAt: null, serverFactCount: null,
    });
  });

  it('keeps a fingerprint that ignores the refresh time but follows every number', () => {
    // Act
    const first = buildCareGraphNodes(source(), wsKey, asOf);
    const later = buildCareGraphNodes(source(), wsKey, iso(NOW + 6 * HOUR));
    const changed = buildCareGraphNodes(
      source({ leads: { last24h: 2, last7d: 4, open: 2, capped: false } }),
      wsKey,
      asOf,
    );

    // Assert
    expect(later.map((node) => node.fingerprint)).toEqual(first.map((node) => node.fingerprint));
    expect(changed[2].fingerprint).not.toBe(first[2].fingerprint);
    expect(changed[0].fingerprint).toBe(first[0].fingerprint);
  });

  it('never lets customer data or long digit runs into any node payload', () => {
    // Arrange: a Page name with a phone, and ids that must not travel anywhere.
    const planted = ['0912345678', '7712345678901234', 'user-1', 'zalo.me/0912345678'];
    const nodes = buildCareGraphNodes(
      source({ pageName: 'Hồng Hưng 0912345678 zalo.me/0912345678' }),
      careWorkspaceKey('user-1', '7712345678901234'),
      asOf,
    );

    // Act
    const serialized = JSON.stringify(nodes);

    // Assert
    for (const value of planted) expect(serialized).not.toContain(value);
    expect(serialized).not.toMatch(/\d{8,}/);
  });
});
