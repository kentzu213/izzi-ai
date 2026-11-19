import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphClient } from './graph-client';
import type { AuthManager } from '../auth/auth-manager';
import type { DatabaseManager } from '../db/database';

/**
 * Background writers (Care → MyGraph) need an idempotent find-or-create: the backend returns the
 * caller's existing node for the same url, and the writer must know whether the node is new so it links
 * it only once. Background writes never go to the offline queue.
 */

const TOKEN = 'test-jwt-SUPERSECRET-do-not-leak-abc123';
const URL = 'https://izziapi.com/aibase/graph?care=care-process&ws=abcdefghijklmnop';

function fakeAuth(token: string | null): AuthManager {
  return { getAccessToken: vi.fn().mockResolvedValue(token) } as unknown as AuthManager;
}

type FakeDb = DatabaseManager & {
  appendDiagnosticEvent: ReturnType<typeof vi.fn>;
  enqueueOp: ReturnType<typeof vi.fn>;
};

function fakeDb(): FakeDb {
  return { appendDiagnosticEvent: vi.fn(), enqueueOp: vi.fn() } as unknown as FakeDb;
}

function response(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: vi.fn(async () => body) };
}

const INPUT = { title: 'Chăm sóc khách · Quy trình', content: 'Quy trình', url: URL, metadata: { kind: 'care-process' } };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GraphClient.findOrCreateNodeByUrl', () => {
  it('posts the node with its url and reports a newly created node', async () => {
    // Arrange
    const fetchMock = vi.fn().mockResolvedValue(response(200, { node: { id: 'node-1', title: INPUT.title } }));
    vi.stubGlobal('fetch', fetchMock);

    // Act
    const result = await new GraphClient(fakeAuth(TOKEN), fakeDb()).findOrCreateNodeByUrl(INPUT);

    // Assert
    expect(result).toEqual({ id: 'node-1', created: true });
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; body: string; headers: Record<string, string> }];
    expect(url).toMatch(/\/api\/aibase\/nodes$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(INPUT);
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('reports an existing node when the backend deduplicated the url', async () => {
    // Arrange
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, { node: { id: 'node-1' }, deduped: true })));

    // Act
    const result = await new GraphClient(fakeAuth(TOKEN), fakeDb()).findOrCreateNodeByUrl(INPUT);

    // Assert
    expect(result).toEqual({ id: 'node-1', created: false });
  });

  it('refuses without a token, a url or a title, before any request', async () => {
    // Arrange
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // Act
    const noToken = await new GraphClient(fakeAuth(null), fakeDb()).findOrCreateNodeByUrl(INPUT);
    const noUrl = await new GraphClient(fakeAuth(TOKEN), fakeDb()).findOrCreateNodeByUrl({ ...INPUT, url: ' ' });
    const noTitle = await new GraphClient(fakeAuth(TOKEN), fakeDb()).findOrCreateNodeByUrl({ ...INPUT, title: ' ' });

    // Assert
    expect(noToken).toEqual({ error: 'unauthorized' });
    expect(noUrl).toEqual({ error: 'url and title required' });
    expect(noTitle).toEqual({ error: 'url and title required' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never queues a background write offline and logs no token', async () => {
    // Arrange
    const db = fakeDb();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    // Act
    const result = await new GraphClient(fakeAuth(TOKEN), db).findOrCreateNodeByUrl(INPUT);

    // Assert
    expect(result).toEqual({ error: 'network error' });
    expect(db.enqueueOp).not.toHaveBeenCalled();
    expect(JSON.stringify(db.appendDiagnosticEvent.mock.calls)).not.toContain(TOKEN);
  });

  it('passes a backend rejection through and rejects a response without a node id', async () => {
    // Arrange
    const db = fakeDb();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(500, { error: 'db down' }))
      .mockResolvedValueOnce(response(401, {}))
      .mockResolvedValueOnce(response(200, { node: {} }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new GraphClient(fakeAuth(TOKEN), db);

    // Act
    const rejected = await client.findOrCreateNodeByUrl(INPUT);
    const unauthorized = await client.findOrCreateNodeByUrl(INPUT);
    const invalid = await client.findOrCreateNodeByUrl(INPUT);

    // Assert
    expect(rejected).toEqual({ error: 'db down' });
    expect(unauthorized).toEqual({ error: 'unauthorized' });
    expect(invalid).toEqual({ error: 'Invalid response' });
    expect(db.appendDiagnosticEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'graph.findOrCreateNode' }));
  });
});
