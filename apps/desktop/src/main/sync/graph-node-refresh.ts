import type { DatabaseManager } from '../db/database';
import type { GraphClient } from '../graph/graph-client';
import type { GraphNode } from '../../shared/graph-types';

const GRAPH_NODES_CACHE = 'graph_nodes';
const GRAPH_NODES_ETAG = 'graph_nodes_etag';

/** The settings + user_data calls the refresh needs. */
export type GraphNodeRefreshStore = Pick<
  DatabaseManager,
  'getUserData' | 'cacheUserData' | 'getSetting' | 'setSetting' | 'deleteSetting'
>;

/** Cached node list from the last full read, or null when there is none. */
function readCachedNodes(store: GraphNodeRefreshStore): GraphNode[] | null {
  const [cached] = store.getUserData(GRAPH_NODES_CACHE);
  return Array.isArray(cached) ? (cached as GraphNode[]) : null;
}

/**
 * Sync step 5: refresh the cached node list and return the list the offline
 * queue flush should use for last-write-wins. The ETag is sent only over a
 * non-empty cached list, so a 304 always has a real list to fall back on —
 * even if an older app version cached `[]` after a failure and kept the ETag.
 * An empty graph is a tiny full read anyway.
 */
export async function refreshGraphNodes(
  client: Pick<GraphClient, 'listNodesIfChanged'>,
  store: GraphNodeRefreshStore,
): Promise<GraphNode[]> {
  const cached = readCachedNodes(store);
  const etag = cached && cached.length > 0 ? store.getSetting(GRAPH_NODES_ETAG) : null;
  const result = await client.listNodesIfChanged(etag);

  if (result.status === 'unchanged' && cached) return cached;

  if (result.status === 'changed') {
    store.cacheUserData(GRAPH_NODES_CACHE, GRAPH_NODES_CACHE, result.nodes);
    if (result.etag) store.setSetting(GRAPH_NODES_ETAG, result.etag);
    else store.deleteSetting(GRAPH_NODES_ETAG);
    return result.nodes;
  }

  // Failed: same as before (the list is cached empty), and forget the ETag so
  // the next sync reads the list in full.
  store.deleteSetting(GRAPH_NODES_ETAG);
  store.cacheUserData(GRAPH_NODES_CACHE, GRAPH_NODES_CACHE, []);
  return [];
}
