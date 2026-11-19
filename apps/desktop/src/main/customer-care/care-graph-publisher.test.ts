import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GraphNode } from '../../shared/graph-types';
import type { CareGraphSnapshot, CareLeadSummary } from './care-graph-digest';
import { careNodeUrl, careWorkspaceKey } from './care-graph-digest';
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
const WS_KEY = careWorkspaceKey(IDENTITY, WORKSPACE);

function snapshot(overrides: Partial<CareGraphSnapshot['source']> = {}): CareGraphSnapshot {
  return {
    identityId: IDENTITY,
    workspaceId: WORKSPACE,
    source: {
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
        lastProblem: null,
      },
      ...overrides,
    },
  };
}

const LEADS: CareLeadSummary = { last24h: 1, last7d: 3, open: 2, capped: false };

type TopicCounts = { catalog: number; price: number; quality: number; policy: number; contact: number };

/** A new saved setup that the server now answers with too (same active fact count). */
function withFacts(byTopic: TopicCounts): Partial<CareGraphSnapshot['source']> {
  const base = snapshot().source.autoReply!;
  const factCount = Object.values(byTopic).reduce((sum, count) => sum + count, 0);
  return { facts: { byTopic, expired: 0, handoffSet: true }, autoReply: { ...base, factCount } };
}

/** The production backend: POST always inserts, PATCH of an unknown id answers ok and changes nothing. */
function fakeServer(clock: () => number) {
  const nodes: GraphNode[] = [];
  let seq = 0;
  const graph = {
    readNodes: vi.fn(async () => ({ data: nodes.map((node) => ({ ...node })), error: null, status: 200 })),
    createNode: vi.fn(async (input: { title: string; url: string; metadata: Record<string, unknown> }) => {
      seq += 1;
      const at = new Date(clock()).toISOString();
      const node: GraphNode = {
        id: `node-${seq}`, title: input.title, nodeType: 'note', color: '#000', url: input.url,
        metadata: input.metadata, createdAt: at, updatedAt: at,
      };
      nodes.push(node);
      return node;
    }),
    updateNode: vi.fn(async (id: string, patch: { metadata: Record<string, unknown> }) => {
      const node = nodes.find((item) => item.id === id);
      if (node) Object.assign(node, { metadata: patch.metadata, updatedAt: new Date(clock()).toISOString() });
      return { ok: true as const };
    }),
    createLink: vi.fn(async (sourceId: string, targetId: string) => ({ id: `link-${targetId}`, sourceId, targetId })),
  };
  return { graph, nodes };
}

function setup(options: {
  read?: () => Promise<CareGraphSnapshot | null>;
  graph?: CareGraphWriter;
  identity?: () => string | null;
  workspace?: () => string | null;
} = {}) {
  let now = START;
  let cache: unknown = [];
  const settings = new Map<string, string>();
  const server = fakeServer(() => now);
  const graph = options.graph ?? server.graph;
  const log = vi.fn();
  const read = vi.fn(options.read ?? (async () => snapshot()));
  const publisher = new CareGraphPublisher({
    graph,
    readSnapshot: read,
    readCachedNodes: () => cache,
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
    graph: graph as ReturnType<typeof fakeServer>['graph'],
    server,
    read,
    log,
    /** What the 5-minute sync would cache now. */
    sync: () => { cache = server.nodes.map((node) => ({ ...node })); },
    setCache: (value: unknown) => { cache = value; },
    advance: (ms: number) => { now += ms; },
    noteLeads: (summary: CareLeadSummary = LEADS) => publisher.noteLeadSummary(IDENTITY, WORKSPACE, summary),
  };
}

function patchedKinds(graph: ReturnType<typeof fakeServer>['graph']): string[] {
  return graph.updateNode.mock.calls.map((call) => (call[1] as { metadata: { kind: string } }).metadata.kind);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('CareGraphPublisher.run', () => {
  it('creates the Care nodes once, after checking the graph, and links facts and results under the process', async () => {
    // Arrange
    const context = setup();
    context.noteLeads();

    // Act
    await context.publisher.run();

    // Assert
    expect(context.graph.readNodes).toHaveBeenCalledTimes(1);
    expect(context.server.nodes.map((node) => node.url)).toEqual([
      careNodeUrl('care-process', WS_KEY),
      careNodeUrl('care-facts', WS_KEY),
      careNodeUrl('care-results', WS_KEY),
    ]);
    expect(context.graph.createNode.mock.calls[0][1]).toEqual({ queueOnOffline: false });
    expect(context.graph.createLink.mock.calls).toEqual([
      ['node-1', 'node-2', 'dùng', '#5B8AA6'],
      ['node-1', 'node-3', 'kết quả', '#5B8AA6'],
    ]);
  });

  it('sends nothing at all when nothing changed', async () => {
    // Arrange
    const context = setup();
    context.noteLeads();
    await context.publisher.run();
    context.sync();
    vi.clearAllMocks();

    // Act
    context.advance(HOUR);
    context.noteLeads();
    await context.publisher.run();

    // Assert
    expect(context.graph.readNodes).not.toHaveBeenCalled();
    expect(context.graph.createNode).not.toHaveBeenCalled();
    expect(context.graph.updateNode).not.toHaveBeenCalled();
  });

  it('patches the cached node that changed, without a fresh read, a new node or a second link', async () => {
    // Arrange
    let current = snapshot();
    const context = setup({ read: async () => current });
    await context.publisher.run();
    context.sync();
    vi.clearAllMocks();

    // Act
    current = snapshot(withFacts({ catalog: 4, price: 2, quality: 1, policy: 0, contact: 3 }));
    await context.publisher.run();

    // Assert: the process node shows the new server fact count, the facts node the new topics.
    expect(context.graph.readNodes).not.toHaveBeenCalled();
    expect(context.graph.createNode).not.toHaveBeenCalled();
    expect(patchedKinds(context.graph)).toEqual(['care-process', 'care-facts']);
    const [id, patch, options] = context.graph.updateNode.mock.calls[1] as unknown as [string, { metadata: Record<string, unknown> }, unknown];
    expect(id).toBe('node-2');
    expect(patch.metadata).toMatchObject({ kind: 'care-facts', missing: ['policy'] });
    expect(options).toEqual({ queueOnOffline: false });
    expect(context.graph.createLink).not.toHaveBeenCalled();
  });

  it('never duplicates a node the sync has not cached yet: one fresh read finds it', async () => {
    // Arrange: the first run created the nodes; the cache is still the old, empty list.
    let current = snapshot();
    const context = setup({ read: async () => current });
    await context.publisher.run();
    vi.clearAllMocks();

    // Act
    current = snapshot({ page: 'needs_reauth' });
    await context.publisher.run();

    // Assert
    expect(context.graph.readNodes).toHaveBeenCalledTimes(1);
    expect(context.graph.createNode).not.toHaveBeenCalled();
    expect(context.graph.updateNode.mock.calls[0][0]).toBe('node-1');
    expect(context.server.nodes).toHaveLength(2);
  });

  it('creates nothing when the fresh read fails, and tries again on the next run', async () => {
    // Arrange
    const context = setup();
    context.graph.readNodes.mockResolvedValueOnce({ data: null, error: 'down', status: 500 } as never);

    // Act
    await context.publisher.run();
    const afterFailure = context.server.nodes.length;
    await context.publisher.run();

    // Assert
    expect(afterFailure).toBe(0);
    expect(context.log).toHaveBeenCalledWith('care graph read failed');
    expect(context.server.nodes).toHaveLength(2);
  });

  it('patches the most recently updated node when the graph already holds duplicates', async () => {
    // Arrange
    let current = snapshot();
    const context = setup({ read: async () => current });
    const url = careNodeUrl('care-facts', WS_KEY);
    const at = (ms: number) => new Date(ms).toISOString();
    await context.publisher.run();
    context.setCache([
      ...context.server.nodes,
      { id: 'dup-old', title: 't', nodeType: 'note', color: '#000', url, createdAt: at(0), updatedAt: at(START - 2 * HOUR) },
      { id: 'dup-new', title: 't', nodeType: 'note', color: '#000', url, createdAt: at(0), updatedAt: at(START + HOUR) },
    ]);
    vi.clearAllMocks();

    // Act
    current = snapshot({ facts: { byTopic: { catalog: 4, price: 1, quality: 0, policy: 0, contact: 3 }, expired: 0, handoffSet: false } });
    await context.publisher.run();

    // Assert
    expect(context.graph.updateNode.mock.calls.map((call) => call[0])).toEqual(['dup-new']);
  });

  it('writes the results node at most once per 6 hours', async () => {
    // Arrange
    const context = setup();
    context.noteLeads();
    await context.publisher.run();
    context.sync();
    vi.clearAllMocks();

    // Act: a new lead one hour later is held back...
    context.advance(HOUR);
    context.noteLeads({ ...LEADS, last24h: 2, last7d: 4 });
    await context.publisher.run();
    const heldBack = context.graph.updateNode.mock.calls.length;
    // ...and written once 6 hours have passed since the last write.
    context.advance(5 * HOUR);
    context.noteLeads({ ...LEADS, last24h: 2, last7d: 4 });
    await context.publisher.run();

    // Assert
    expect(heldBack).toBe(0);
    expect(patchedKinds(context.graph)).toEqual(['care-results']);
    expect((context.graph.updateNode.mock.calls[0][1] as { metadata: { leads7d: number } }).metadata.leads7d).toBe(4);
  });

  it('refreshes the results time once a day even when the numbers stay the same', async () => {
    // Arrange
    const context = setup();
    context.noteLeads();
    await context.publisher.run();
    context.sync();
    vi.clearAllMocks();

    // Act
    context.advance(25 * HOUR);
    context.noteLeads();
    await context.publisher.run();

    // Assert
    expect(patchedKinds(context.graph)).toEqual(['care-results']);
    const patch = context.graph.updateNode.mock.calls[0][1] as { metadata: { asOf: string } };
    expect(patch.metadata.asOf).toBe(new Date(START + 25 * HOUR).toISOString());
  });

  it('leaves the results node alone without a fresh lead check for this workspace', async () => {
    // Arrange
    const context = setup();
    context.publisher.noteLeadSummary(IDENTITY, 'ws-other', LEADS);
    context.noteLeads();
    context.advance(16 * 60 * 1000);

    // Act
    await context.publisher.run();

    // Assert
    expect(context.server.nodes.map((node) => (node.metadata as { kind: string }).kind)).toEqual(['care-process', 'care-facts']);
  });

  it('links a re-created process node to the facts node the graph still holds', async () => {
    // Arrange: the owner deleted only the process node.
    let current = snapshot();
    const context = setup({ read: async () => current });
    await context.publisher.run();
    context.server.nodes.splice(0, 1);
    context.sync();
    vi.clearAllMocks();

    // Act
    current = snapshot({ page: 'needs_reauth' });
    await context.publisher.run();

    // Assert
    expect(context.graph.createNode).toHaveBeenCalledTimes(1);
    expect(context.graph.createLink.mock.calls).toEqual([['node-3', 'node-2', 'dùng', '#5B8AA6']]);
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
    for (const context of [none, switched, otherWorkspace]) {
      expect(context.graph.readNodes).not.toHaveBeenCalled();
      expect(context.graph.createNode).not.toHaveBeenCalled();
    }
  });

  it('keeps going quietly on a failed write and retries it on the next run', async () => {
    // Arrange
    const context = setup();
    context.graph.createNode.mockResolvedValueOnce({ error: 'network error' } as never);

    // Act
    await expect(context.publisher.run()).resolves.toBeUndefined();
    await context.publisher.run();

    // Assert
    expect(context.log).toHaveBeenCalledWith('care graph write failed');
    expect(context.server.nodes).toHaveLength(2);
    expect(JSON.stringify(context.log.mock.calls)).not.toContain(WORKSPACE);
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
