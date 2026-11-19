import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CareGraphSnapshot, CareLeadSummary } from './care-graph-digest';
import { careWorkspaceKey } from './care-graph-digest';
import {
  CARE_GRAPH_FIRST_RUN_MS,
  CARE_GRAPH_REFRESH_MS,
  CareGraphPublisher,
  type CareGraphWriter,
} from './care-graph-publisher';

const HOUR = 60 * 60 * 1000;
const START = Date.parse('2026-11-19T05:00:00.000Z');
const IDENTITY = 'user-1';
const WORKSPACE = 'ws-hong-hung';

function snapshot(overrides: Partial<CareGraphSnapshot['source']> = {}): CareGraphSnapshot {
  return {
    identityId: IDENTITY,
    workspaceId: WORKSPACE,
    source: {
      pageName: 'Đồng Thờ Hồng Hưng',
      page: 'connected',
      handoffSet: true,
      facts: { byTopic: { catalog: 4, price: 1, quality: 0, policy: 0, contact: 3 }, expired: 0 },
      autoReply: {
        enabled: true,
        enabledAt: '2026-11-19T03:05:00.000Z',
        available: true,
        scriptUpdatedAt: '2026-11-19T03:05:00.000Z',
        factCount: 8,
        sentLast24h: 5,
        lastSentAt: '2026-11-19T04:30:00.000Z',
        stoppedLast24h: 2,
        lastProblem: null,
      },
      ...overrides,
    },
  };
}

const LEADS: CareLeadSummary = { last24h: 1, last7d: 3, open: 2, capped: false };

function fakeGraph() {
  const byUrl = new Map<string, string>();
  let seq = 0;
  const graph = {
    findOrCreateNodeByUrl: vi.fn(async (input: { url: string }) => {
      const existing = byUrl.get(input.url);
      if (existing) return { id: existing, created: false };
      seq += 1;
      const id = `node-${seq}`;
      byUrl.set(input.url, id);
      return { id, created: true };
    }),
    updateNode: vi.fn(async () => ({ ok: true as const })),
    createLink: vi.fn(async (sourceId: string, targetId: string) => ({ id: `link-${targetId}`, sourceId, targetId })),
  };
  return { graph, byUrl };
}

function setup(options: {
  read?: () => Promise<CareGraphSnapshot | null>;
  graph?: CareGraphWriter;
  identity?: () => string | null;
  workspace?: () => string | null;
} = {}) {
  let now = START;
  const settings = new Map<string, string>();
  const { graph } = fakeGraph();
  const log = vi.fn();
  const read = vi.fn(options.read ?? (async () => snapshot()));
  const publisher = new CareGraphPublisher({
    graph: options.graph ?? graph,
    readSnapshot: read,
    currentIdentityId: options.identity ?? (() => IDENTITY),
    currentWorkspaceId: options.workspace ?? (() => WORKSPACE),
    store: {
      getSetting: (key) => settings.get(key) ?? null,
      setSetting: (key, value) => { settings.set(key, value); },
    },
    now: () => now,
    log,
  });
  return {
    publisher,
    graph: (options.graph ?? graph) as ReturnType<typeof fakeGraph>['graph'],
    read,
    log,
    settings,
    advance: (ms: number) => { now += ms; },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CareGraphPublisher.run', () => {
  it('creates the three Care nodes once and links facts and results under the process', async () => {
    // Arrange
    const { publisher, graph } = setup();
    publisher.noteLeadSummary(IDENTITY, WORKSPACE, LEADS);

    // Act
    await publisher.run();

    // Assert
    expect(graph.findOrCreateNodeByUrl).toHaveBeenCalledTimes(3);
    const kinds = graph.findOrCreateNodeByUrl.mock.calls.map(([input]) => (input as { metadata: { kind: string } }).metadata.kind);
    expect(kinds).toEqual(['care-process', 'care-facts', 'care-results']);
    expect(graph.updateNode).not.toHaveBeenCalled();
    expect(graph.createLink.mock.calls).toEqual([
      ['node-1', 'node-2', 'dùng', '#5B8AA6'],
      ['node-1', 'node-3', 'kết quả', '#5B8AA6'],
    ]);
    const results = graph.findOrCreateNodeByUrl.mock.calls[2][0] as { metadata: Record<string, unknown> };
    expect(results.metadata).toMatchObject({ leads7d: 3, wsKey: careWorkspaceKey(WORKSPACE) });
  });

  it('sends nothing when nothing changed', async () => {
    // Arrange
    const { publisher, graph, advance } = setup();
    await publisher.run();
    graph.findOrCreateNodeByUrl.mockClear();

    // Act
    advance(7 * HOUR);
    await publisher.run();

    // Assert
    expect(graph.findOrCreateNodeByUrl).not.toHaveBeenCalled();
    expect(graph.updateNode).not.toHaveBeenCalled();
  });

  it('updates only the node whose content changed, without a second link', async () => {
    // Arrange
    let current = snapshot();
    const { publisher, graph } = setup({ read: async () => current });
    await publisher.run();
    graph.findOrCreateNodeByUrl.mockClear();
    graph.createLink.mockClear();

    // Act
    current = snapshot({ facts: { byTopic: { catalog: 4, price: 2, quality: 1, policy: 0, contact: 3 }, expired: 0 } });
    await publisher.run();

    // Assert
    expect(graph.findOrCreateNodeByUrl).toHaveBeenCalledTimes(1);
    expect(graph.updateNode).toHaveBeenCalledTimes(1);
    const [id, patch, options] = graph.updateNode.mock.calls[0] as unknown as [string, { metadata: { kind: string; missing: string[] } }, { queueOnOffline: boolean }];
    expect(id).toBe('node-2');
    expect(patch.metadata).toMatchObject({ kind: 'care-facts', missing: ['policy'] });
    expect(options).toEqual({ queueOnOffline: false });
    expect(graph.createLink).not.toHaveBeenCalled();
  });

  it('writes the results node at most once per 6 hours', async () => {
    // Arrange
    const { publisher, graph, advance } = setup();
    publisher.noteLeadSummary(IDENTITY, WORKSPACE, LEADS);
    await publisher.run();
    graph.findOrCreateNodeByUrl.mockClear();

    // Act: a new lead one hour later is held back...
    advance(HOUR);
    publisher.noteLeadSummary(IDENTITY, WORKSPACE, { ...LEADS, last24h: 2, last7d: 4 });
    await publisher.run();
    const heldBack = graph.findOrCreateNodeByUrl.mock.calls.length;
    // ...and written once 6 hours have passed since the last write.
    advance(5 * HOUR);
    publisher.noteLeadSummary(IDENTITY, WORKSPACE, { ...LEADS, last24h: 2, last7d: 4 });
    await publisher.run();

    // Assert
    expect(heldBack).toBe(0);
    expect(graph.updateNode).toHaveBeenCalledTimes(1);
    expect((graph.updateNode.mock.calls[0] as unknown as [string, { metadata: { leads7d: number } }])[1].metadata.leads7d).toBe(4);
  });

  it('refreshes the results time once a day even when the numbers stay the same', async () => {
    // Arrange
    const { publisher, graph, advance } = setup();
    await publisher.run();

    // Act
    advance(25 * HOUR);
    await publisher.run();

    // Assert
    expect(graph.updateNode).toHaveBeenCalledTimes(1);
    const patch = (graph.updateNode.mock.calls[0] as unknown as [string, { metadata: { kind: string; asOf: string } }])[1];
    expect(patch.metadata.kind).toBe('care-results');
    expect(patch.metadata.asOf).toBe(new Date(START + 25 * HOUR).toISOString());
  });

  it('ignores a lead summary older than 15 minutes or for another workspace', async () => {
    // Arrange
    const { publisher, graph, advance } = setup();
    publisher.noteLeadSummary(IDENTITY, 'ws-other', LEADS);
    publisher.noteLeadSummary(IDENTITY, WORKSPACE, LEADS);
    advance(16 * 60 * 1000);

    // Act
    await publisher.run();

    // Assert
    const results = graph.findOrCreateNodeByUrl.mock.calls[2][0] as { metadata: Record<string, unknown> };
    expect(results.metadata).toMatchObject({ leads24h: null, leads7d: null, leadsOpen: null });
  });

  it('writes nothing when Care is not readable, or the account or workspace changed during the read', async () => {
    // Arrange
    let identity: string | null = IDENTITY;
    const none = setup({ read: async () => null });
    const switched = setup({
      identity: () => identity,
      read: async () => { identity = 'user-2'; return snapshot(); },
    });
    const otherWorkspace = setup({ workspace: () => 'ws-other' });

    // Act
    await none.publisher.run();
    await switched.publisher.run();
    await otherWorkspace.publisher.run();

    // Assert
    expect(none.graph.findOrCreateNodeByUrl).not.toHaveBeenCalled();
    expect(switched.graph.findOrCreateNodeByUrl).not.toHaveBeenCalled();
    expect(otherWorkspace.graph.findOrCreateNodeByUrl).not.toHaveBeenCalled();
  });

  it('keeps going quietly on a failed write and retries it on the next run', async () => {
    // Arrange
    const { graph: base } = fakeGraph();
    const failing: CareGraphWriter = {
      ...base,
      findOrCreateNodeByUrl: vi.fn()
        .mockResolvedValueOnce({ error: 'network error' })
        .mockImplementation(base.findOrCreateNodeByUrl),
    };
    const { publisher, log } = setup({ graph: failing });

    // Act
    await expect(publisher.run()).resolves.toBeUndefined();
    await publisher.run();

    // Assert
    expect(failing.findOrCreateNodeByUrl).toHaveBeenCalledTimes(4);
    expect(log).toHaveBeenCalledWith('care graph write failed');
    expect(JSON.stringify(log.mock.calls)).not.toContain(WORKSPACE);
  });

  it('runs once more after a run that was requested while another was in flight', async () => {
    // Arrange
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const { publisher, read } = setup({
      read: async () => {
        calls += 1;
        if (calls === 1) await gate;
        return null;
      },
    });

    // Act
    const first = publisher.run();
    publisher.requestPublish();
    publisher.requestPublish();
    release();
    await first;
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));

    // Assert
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe('CareGraphPublisher timers', () => {
  it('first runs shortly after start, then every 6 hours, and stops cleanly', async () => {
    // Arrange
    vi.useFakeTimers();
    const { publisher, read } = setup({ read: async () => null });

    // Act
    publisher.start();
    await vi.advanceTimersByTimeAsync(CARE_GRAPH_FIRST_RUN_MS - 1);
    const beforeFirst = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(CARE_GRAPH_REFRESH_MS);
    publisher.stop();
    await vi.advanceTimersByTimeAsync(CARE_GRAPH_REFRESH_MS * 2);

    // Assert
    expect(beforeFirst).toBe(0);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
