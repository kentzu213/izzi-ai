import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphClient } from './graph-client';
import type { AuthManager } from '../auth/auth-manager';
import type { DatabaseManager } from '../db/database';

/**
 * The 5-minute sync re-downloaded the whole node list on every run (~0.37 MB
 * for the main account) even when nothing changed. `listNodesIfChanged` sends
 * the last ETag so the backend can answer 304 instead.
 */

const TOKEN = 'test-jwt-SUPERSECRET-do-not-leak-abc123';
const ETAG = 'W/"nodes-u1-331-2026-11-17T03:00:00+00:00"';

function fakeAuth(token: string | null): AuthManager {
  return { getAccessToken: vi.fn().mockResolvedValue(token) } as unknown as AuthManager;
}

type FakeDb = DatabaseManager & { appendDiagnosticEvent: ReturnType<typeof vi.fn> };

function fakeDb(): FakeDb {
  return { appendDiagnosticEvent: vi.fn() } as unknown as FakeDb;
}

function response(status: number, body: unknown, etag: string | null = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(etag ? { etag } : {}),
    json: vi.fn(async () => body),
  };
}

function backendNode(id: string) {
  return { id, title: id, nodeType: 'note', color: '#5ca7ff', createdAt: '2026-11-17T00:00:00Z', updatedAt: '2026-11-17T00:00:00Z' };
}

/** Headers of the single fetch call, as a plain lower-cased map. */
function sentHeaders(fetchMock: ReturnType<typeof vi.fn>): Record<string, string> {
  const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string> };
  return Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v]));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GraphClient.listNodesIfChanged', () => {
  it('sends the last ETag and reports unchanged on 304 without reading a body', async () => {
    const res = response(304, null);
    const fetchMock = vi.fn().mockResolvedValue(res);
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GraphClient(fakeAuth(TOKEN), fakeDb()).listNodesIfChanged(ETAG);

    expect(result).toEqual({ status: 'unchanged' });
    expect(sentHeaders(fetchMock)['if-none-match']).toBe(ETAG);
    expect(sentHeaders(fetchMock).authorization).toBe(`Bearer ${TOKEN}`);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('returns the mapped nodes and the new ETag when the list changed', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { nodes: [backendNode('a'), backendNode('b')] }, ETAG));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GraphClient(fakeAuth(TOKEN), fakeDb()).listNodesIfChanged('W/"old"');

    expect(result.status).toBe('changed');
    if (result.status !== 'changed') return;
    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(result.etag).toBe(ETAG);
  });

  it('omits If-None-Match when there is no ETag yet', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { nodes: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GraphClient(fakeAuth(TOKEN), fakeDb()).listNodesIfChanged(null);

    expect(sentHeaders(fetchMock)).not.toHaveProperty('if-none-match');
    expect(result).toEqual({ status: 'changed', nodes: [], etag: null });
  });

  it('fails closed without a backend call when there is no token', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GraphClient(fakeAuth(null), fakeDb()).listNodesIfChanged(ETAG);

    expect(result).toEqual({ status: 'failed' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails on 401 without retrying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(401, { error: 'Unauthorized' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new GraphClient(fakeAuth(TOKEN), fakeDb()).listNodesIfChanged(ETAG);

    expect(result).toEqual({ status: 'failed' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails and records a token-free diagnostic on a server error or network error', async () => {
    for (const failure of [
      vi.fn().mockResolvedValue(response(500, { error: 'boom' })),
      vi.fn().mockRejectedValue(new Error('network down')),
    ]) {
      vi.stubGlobal('fetch', failure);
      const db = fakeDb();

      const result = await new GraphClient(fakeAuth(TOKEN), db).listNodesIfChanged(ETAG);

      expect(result).toEqual({ status: 'failed' });
      expect(db.appendDiagnosticEvent).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(db.appendDiagnosticEvent.mock.calls[0][0])).not.toContain(TOKEN);
    }
  });
});
