import { describe, expect, it, vi } from 'vitest';
import { refreshGraphNodes, type GraphNodeRefreshStore } from './graph-node-refresh';
import type { ConditionalNodeList } from '../graph/graph-client';
import type { GraphNode } from '../../shared/graph-types';

const ETAG = 'W/"nodes-u1-2-2026-11-17T03:00:00+00:00"';
const node = (id: string, updatedAt = '2026-11-17T03:00:00+00:00'): GraphNode =>
  ({ id, title: id, nodeType: 'note', updatedAt }) as GraphNode;

/** In-memory stand-in for the settings + user_data tables. */
function fakeStore(cachedNodes: GraphNode[] | null, etag: string | null) {
  const settings = new Map<string, string>(etag ? [['graph_nodes_etag', etag]] : []);
  let cache: unknown = cachedNodes;
  const store: GraphNodeRefreshStore = {
    getUserData: vi.fn(() => (cache === null ? [] : [cache])),
    cacheUserData: vi.fn((_id: string, _type: string, data: object) => { cache = data; }),
    getSetting: vi.fn((key: string) => settings.get(key) ?? null),
    setSetting: vi.fn((key: string, value: string) => { settings.set(key, value); }),
    deleteSetting: vi.fn((key: string) => { settings.delete(key); }),
  };
  return { store, settings, cache: () => cache };
}

function fakeClient(result: ConditionalNodeList) {
  return { listNodesIfChanged: vi.fn(async (_etag: string | null) => result) };
}

describe('refreshGraphNodes (sync step 5)', () => {
  it('keeps the cached list and writes nothing when the backend says unchanged', async () => {
    const cached = [node('a'), node('b')];
    const { store } = fakeStore(cached, ETAG);
    const client = fakeClient({ status: 'unchanged' });

    const nodes = await refreshGraphNodes(client, store);

    expect(client.listNodesIfChanged).toHaveBeenCalledWith(ETAG);
    expect(nodes).toEqual(cached);
    expect(store.cacheUserData).not.toHaveBeenCalled();
    expect(store.setSetting).not.toHaveBeenCalled();
  });

  it('caches a changed list together with its new ETag', async () => {
    const { store, settings, cache } = fakeStore([node('a')], 'W/"old"');
    const fresh = [node('a'), node('c', '2026-11-17T04:00:00+00:00')];

    const nodes = await refreshGraphNodes(fakeClient({ status: 'changed', nodes: fresh, etag: ETAG }), store);

    expect(nodes).toEqual(fresh);
    expect(cache()).toEqual(fresh);
    expect(settings.get('graph_nodes_etag')).toBe(ETAG);
  });

  it('forgets the old ETag when a changed list arrives without one', async () => {
    const { store, settings } = fakeStore([node('a')], 'W/"old"');

    await refreshGraphNodes(fakeClient({ status: 'changed', nodes: [node('a')], etag: null }), store);

    expect(settings.has('graph_nodes_etag')).toBe(false);
  });

  it('never sends an ETag without a cached list to fall back on', async () => {
    const { store } = fakeStore(null, ETAG);
    const client = fakeClient({ status: 'changed', nodes: [], etag: ETAG });

    await refreshGraphNodes(client, store);

    expect(client.listNodesIfChanged).toHaveBeenCalledWith(null);
  });

  it('never sends an ETag over an empty cached list (e.g. left by an older app version)', async () => {
    const { store } = fakeStore([], ETAG);
    const client = fakeClient({ status: 'changed', nodes: [node('a')], etag: ETAG });

    const nodes = await refreshGraphNodes(client, store);

    expect(client.listNodesIfChanged).toHaveBeenCalledWith(null);
    expect(nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('on failure keeps the previous behaviour (empty list) and drops the ETag', async () => {
    const { store, settings, cache } = fakeStore([node('a')], ETAG);

    const nodes = await refreshGraphNodes(fakeClient({ status: 'failed' }), store);

    expect(nodes).toEqual([]);
    expect(cache()).toEqual([]);
    expect(settings.has('graph_nodes_etag')).toBe(false);
  });
});
