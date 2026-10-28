import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphClient } from './graph-client';
import type { AuthManager } from '../auth/auth-manager';
import type { DatabaseManager } from '../db/database';

const auth = (token: string | null) => ({ getAccessToken: vi.fn().mockResolvedValue(token) }) as unknown as AuthManager;
const db = () => ({ appendDiagnosticEvent: vi.fn() }) as unknown as DatabaseManager;
const response = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
});
afterEach(() => vi.unstubAllGlobals());

describe('checked graph reads', () => {
  it('distinguishes an authenticated empty graph from a missing session', async () => {
    const request = vi.fn().mockResolvedValue(response(200, { nodes: [] }));
    vi.stubGlobal('fetch', request);
    expect(await new GraphClient(auth(null), db()).readNodes()).toMatchObject({ data: null, status: 401 });
    expect(request).not.toHaveBeenCalled();
    expect(await new GraphClient(auth('fixture-token'), db()).readNodes()).toEqual({ data: [], error: null, status: 200 });
  });

  it.each([401, 403, 429, 503])('preserves HTTP %s without anonymous retry or response-body disclosure', async (status) => {
    const request = vi.fn().mockResolvedValue(response(status, { error: 'private-backend-details' }));
    vi.stubGlobal('fetch', request);
    const result = await new GraphClient(auth('fixture-token'), db()).readLinks();
    expect(result).toMatchObject({ data: null, status });
    expect(JSON.stringify(result)).not.toContain('private-backend-details');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reports offline/auth-provider errors without leaking exception text', async () => {
    const diagnostics = db();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fixture-private-token')));
    const result = await new GraphClient(auth('fixture-private-token'), diagnostics).readNodes();
    expect(result).toMatchObject({ data: null, status: 0 });
    expect(JSON.stringify([result, vi.mocked(diagnostics.appendDiagnosticEvent).mock.calls])).not.toContain('fixture-private-token');
    const brokenAuth = { getAccessToken: vi.fn().mockRejectedValue(new Error('fixture-auth-secret')) } as unknown as AuthManager;
    expect(await new GraphClient(brokenAuth, db()).readLinks()).toMatchObject({ data: null, status: 0 });
  });

  it('rejects malformed payloads instead of displaying an empty graph', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(200, { links: 'bad' })));
    expect(await new GraphClient(auth('fixture-token'), db()).readLinks()).toMatchObject({ data: null, status: 502 });
  });

  it('maps valid links and attaches a bounded request timeout', async () => {
    const request = vi.fn().mockResolvedValue(response(200, { links: [{ id: 'edge', sourceId: 'a', targetId: 'b' }] }));
    vi.stubGlobal('fetch', request);
    expect(await new GraphClient(auth('fixture-token'), db()).readLinks()).toMatchObject({ error: null, data: [{ id: 'edge', sourceId: 'a', targetId: 'b' }] });
    expect(request.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});
