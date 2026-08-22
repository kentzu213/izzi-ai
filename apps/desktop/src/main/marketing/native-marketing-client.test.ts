/**
 * Focused tests for the native Marketing client (native-marketing, Phase 1).
 *
 * The security-critical invariants: the base URL is a reviewed https origin and
 * never loopback, the Supabase token only ever appears in the Authorization
 * header, renderer-facing payloads are allowlisted, and bad input or bad
 * responses fail closed with bounded codes. Every test is offline — `fetch` is
 * injected.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  NativeMarketingClient,
  nativeMarketingFailureCode,
  parseNativeMarketingAccountList,
  parseNativeMarketingOAuthState,
  parseNativeMarketingPostList,
  parseNativeMarketingWorkspaceList,
  resolveNativeMarketingBaseUrl,
  type NativeMarketingTokenProvider,
} from './native-marketing-client';

const REVIEWED_ORIGIN = 'https://api.izziapi.com';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const POST_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'test-supabase-access-token';

function tokenProvider(token: string | null = TOKEN): NativeMarketingTokenProvider {
  return { getAccessToken: async () => token };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function workspaceEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    workspace: { id: WORKSPACE_ID, name: 'Native Workspace', plan: 'pro', ...overrides },
    membership: { role: 'owner' },
    quota: { credits_limit: 1000, credits_used: 40 },
  };
}

describe('resolveNativeMarketingBaseUrl', () => {
  it('defaults to the public IzziAPI origin', () => {
    expect(resolveNativeMarketingBaseUrl()).toBe(REVIEWED_ORIGIN);
    expect(resolveNativeMarketingBaseUrl('')).toBe(REVIEWED_ORIGIN);
    expect(resolveNativeMarketingBaseUrl(null)).toBe(REVIEWED_ORIGIN);
  });

  it('accepts a reviewed https origin override and trims it', () => {
    expect(resolveNativeMarketingBaseUrl('  https://marketing-staging.izziapi.com  '))
      .toBe('https://marketing-staging.izziapi.com');
  });

  it('never accepts loopback or the Auto Post extension backend', () => {
    for (const origin of [
      'http://127.0.0.1:3001',
      'http://127.0.0.1:3005',
      'https://127.0.0.1:3001',
      'http://localhost:3001',
      'https://localhost',
      'http://[::1]:3001',
    ]) {
      expect(resolveNativeMarketingBaseUrl(origin)).toBeNull();
    }
  });

  it('rejects http, unreviewed hosts, credentials, and path/query/fragment URLs', () => {
    expect(resolveNativeMarketingBaseUrl('http://api.izziapi.com')).toBeNull();
    expect(resolveNativeMarketingBaseUrl('https://evil.example.com')).toBeNull();
    expect(resolveNativeMarketingBaseUrl('https://api.izziapi.com.evil.example')).toBeNull();
    expect(resolveNativeMarketingBaseUrl('https://user:pass@api.izziapi.com')).toBeNull();
    expect(resolveNativeMarketingBaseUrl('https://api.izziapi.com/api/marketing')).toBeNull();
    expect(resolveNativeMarketingBaseUrl('https://api.izziapi.com/?next=x')).toBeNull();
    expect(resolveNativeMarketingBaseUrl('not-a-url')).toBeNull();
  });
});

describe('nativeMarketingFailureCode', () => {
  it('maps statuses to bounded codes', () => {
    expect(nativeMarketingFailureCode(401)).toBe('auth-required');
    expect(nativeMarketingFailureCode(403)).toBe('forbidden');
    expect(nativeMarketingFailureCode(404)).toBe('not-found');
    expect(nativeMarketingFailureCode(409)).toBe('conflict');
    expect(nativeMarketingFailureCode(429)).toBe('rate-limited');
    expect(nativeMarketingFailureCode(422)).toBe('request-rejected');
    expect(nativeMarketingFailureCode(503)).toBe('server-error');
    expect(nativeMarketingFailureCode()).toBe('network-error');
  });
});

describe('response allowlisting', () => {
  it('keeps only the reviewed workspace fields', () => {
    const workspaces = parseNativeMarketingWorkspaceList({
      workspaces: [{
        ...workspaceEnvelope(),
        workspace: {
          id: WORKSPACE_ID,
          name: 'Native Workspace',
          plan: 'pro',
          accessToken: 'leaked-token',
          service_role_key: 'leaked-secret',
        },
        secrets: { refreshToken: 'leaked-refresh' },
      }],
    });

    expect(workspaces).toEqual([{
      id: WORKSPACE_ID,
      name: 'Native Workspace',
      role: 'owner',
      plan: 'pro',
      creditsLimit: 1000,
      creditsUsed: 40,
    }]);
    expect(JSON.stringify(workspaces)).not.toContain('leaked');
  });

  it('fails closed on malformed workspace rows', () => {
    expect(parseNativeMarketingWorkspaceList({ workspaces: 'nope' })).toBeNull();
    expect(parseNativeMarketingWorkspaceList({
      workspaces: [{ workspace: { id: 'not-a-uuid', name: 'x', plan: 'pro' }, membership: { role: 'owner' } }],
    })).toBeNull();
    expect(parseNativeMarketingWorkspaceList({
      workspaces: [{ workspace: { id: WORKSPACE_ID, name: 'x', plan: 'pro' }, membership: { role: 'root' } }],
    })).toBeNull();
  });

  it('allowlists accounts and rejects unknown platforms or a mismatched workspace', () => {
    const body = {
      workspaceId: WORKSPACE_ID,
      accounts: [{
        id: ACCOUNT_ID,
        platform: 'facebook',
        displayName: 'Izzi Page',
        status: 'connected',
        accessToken: 'leaked-token',
        refresh_token: 'leaked-refresh',
      }],
    };

    expect(parseNativeMarketingAccountList(body, WORKSPACE_ID)).toEqual([{
      id: ACCOUNT_ID,
      platform: 'facebook',
      name: 'Izzi Page',
      status: 'connected',
      active: true,
    }]);
    expect(parseNativeMarketingAccountList(body, POST_ID)).toBeNull();
    expect(parseNativeMarketingAccountList({
      workspaceId: WORKSPACE_ID,
      accounts: [{ id: ACCOUNT_ID, platform: 'myspace', status: 'connected' }],
    }, WORKSPACE_ID)).toBeNull();
  });

  it('bounds the post excerpt and drops unreviewed post fields', () => {
    const posts = parseNativeMarketingPostList({
      workspaceId: WORKSPACE_ID,
      posts: [{
        id: POST_ID,
        title: 'Launch',
        status: 'draft',
        content: 'a'.repeat(5_000),
        updatedAt: '2026-08-22T10:00:00.000Z',
        scheduledAt: null,
        internalNotes: 'leaked-note',
      }],
    }, WORKSPACE_ID);

    expect(posts).toHaveLength(1);
    expect(posts?.[0].excerpt).toHaveLength(280);
    expect(Object.keys(posts?.[0] ?? {}).sort())
      .toEqual(['excerpt', 'id', 'scheduledAt', 'status', 'title', 'updatedAt']);
    expect(JSON.stringify(posts)).not.toContain('leaked-note');
  });

  it('returns the opaque state plus a validated public authorize URL', () => {
    const state = 'nzB3Qk9y_state-value.1234';
    expect(parseNativeMarketingOAuthState(
      {
        workspaceId: WORKSPACE_ID,
        platform: 'facebook',
        state,
        clientId: 'leaked-client-id',
        codeVerifier: 'leaked-verifier',
        authorizeUrl: `https://www.facebook.com/v21.0/dialog/oauth?state=${state}`,
      },
      WORKSPACE_ID,
      'facebook',
    )).toEqual({
      state,
      authorizeUrl: `https://www.facebook.com/v21.0/dialog/oauth?state=${state}`,
      expiresAt: null,
    });

    expect(parseNativeMarketingOAuthState(
      {
        workspaceId: WORKSPACE_ID,
        platform: 'facebook',
        state,
        authorizeUrl: `https://www.facebook.com/oauth?state=${state}&client_secret=leaked`,
      },
      WORKSPACE_ID,
      'facebook',
    )).toBeNull();

    expect(parseNativeMarketingOAuthState(
      { workspaceId: WORKSPACE_ID, platform: 'instagram', state },
      WORKSPACE_ID,
      'facebook',
    )).toBeNull();
    expect(parseNativeMarketingOAuthState(
      { workspaceId: WORKSPACE_ID, platform: 'facebook', state: 'short' },
      WORKSPACE_ID,
      'facebook',
    )).toBeNull();
  });
});

describe('NativeMarketingClient', () => {
  it('fails closed without calling fetch when the origin is unreviewed', async () => {
    const fetchImpl = vi.fn();
    const client = new NativeMarketingClient(tokenProvider(), {
      baseUrl: 'http://127.0.0.1:3001',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(client.isConfigured()).toBe(false);
    expect(client.getBaseUrl()).toBeNull();
    await expect(client.listWorkspaces()).resolves.toEqual({ ok: false, error: 'configuration-required' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed without calling fetch when there is no session token', async () => {
    const fetchImpl = vi.fn();
    const client = new NativeMarketingClient(tokenProvider(null), {
      baseUrl: REVIEWED_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.listWorkspaces()).resolves.toEqual({ ok: false, error: 'not-signed-in' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the token only in the Authorization header and keeps it out of the result', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ workspaces: [workspaceEnvelope()] }));
    const client = new NativeMarketingClient(tokenProvider(), {
      baseUrl: REVIEWED_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.listWorkspaces();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe(`${REVIEWED_ORIGIN}/api/marketing/workspaces`);
    expect(headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(url).not.toContain(TOKEN);
    expect(init.body).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(result).toEqual({ ok: true, workspaces: [expect.objectContaining({ id: WORKSPACE_ID })] });
  });

  it('creates the native workspace and rejects an empty name before any request', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ workspace: workspaceEnvelope() }, 201));
    const client = new NativeMarketingClient(tokenProvider(), {
      baseUrl: REVIEWED_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.createWorkspace({ name: '   ' }))
      .resolves.toEqual({ ok: false, error: 'invalid-workspace-name' });
    expect(fetchImpl).not.toHaveBeenCalled();

    const created = await client.createWorkspace({ name: 'Native Workspace' });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];

    expect(created.ok).toBe(true);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ name: 'Native Workspace', slug: 'native-workspace' });
  });

  it('rejects unsupported platforms and bad workspace ids before any request', async () => {
    const fetchImpl = vi.fn();
    const client = new NativeMarketingClient(tokenProvider(), {
      baseUrl: REVIEWED_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.createOAuthState(WORKSPACE_ID, 'myspace' as never))
      .resolves.toEqual({ ok: false, error: 'unsupported-platform' });
    await expect(client.listAccounts('not-a-uuid'))
      .resolves.toEqual({ ok: false, error: 'invalid-workspace-id' });
    await expect(client.listPosts(WORKSPACE_ID, 'deleted'))
      .resolves.toEqual({ ok: false, error: 'invalid-post-status' });
    await expect(client.createDraftPost(WORKSPACE_ID, { platform: 'facebook', content: '  ' }))
      .resolves.toEqual({ ok: false, error: 'invalid-draft' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('creates posts as drafts with no accounts and no schedule', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      workspaceId: WORKSPACE_ID,
      post: { id: POST_ID, platform: 'facebook', status: 'draft', body: 'Hello world', scheduled_at: null, created_at: '2026-08-22T00:00:00.000Z' },
    }, 201));
    const client = new NativeMarketingClient(tokenProvider(), {
      baseUrl: REVIEWED_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.createDraftPost(WORKSPACE_ID, { platform: 'facebook', content: 'Hello world', title: 'Launch' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));

    expect(url).toBe(`${REVIEWED_ORIGIN}/api/marketing/posts`);
    expect(body).toEqual({ workspaceId: WORKSPACE_ID, platform: 'facebook', body: 'Hello world', status: 'draft' });
    expect(body.accountIds).toBeUndefined();
    expect(body.scheduledAt).toBeUndefined();
    expect(result).toEqual({ ok: true, post: expect.objectContaining({ id: POST_ID, status: 'draft' }) });
  });

  it('fails closed when the server returns a post that is not a draft', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      workspaceId: WORKSPACE_ID,
      post: { id: POST_ID, platform: 'facebook', status: 'published', body: 'Hello world' },
    }, 201));
    const client = new NativeMarketingClient(tokenProvider(), {
      baseUrl: REVIEWED_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.createDraftPost(WORKSPACE_ID, { platform: 'facebook', content: 'Hello world' }))
      .resolves.toEqual({ ok: false, error: 'invalid-response' });
  });

  it('maps HTTP failures to bounded codes and never forwards server error text', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(
      { message: `token ${TOKEN} rejected by upstream`, stack: 'at Server.handler' },
      401,
    ));
    const client = new NativeMarketingClient(tokenProvider(), {
      baseUrl: REVIEWED_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.listAccounts(WORKSPACE_ID);
    expect(result).toEqual({ ok: false, error: 'auth-required' });
    expect(JSON.stringify(result)).not.toContain('upstream');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('reports a transport failure as network-error', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error(`ECONNRESET ${TOKEN}`); });
    const client = new NativeMarketingClient(tokenProvider(), {
      baseUrl: REVIEWED_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.listPosts(WORKSPACE_ID, 'draft');
    expect(result).toEqual({ ok: false, error: 'network-error' });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('issues an OAuth session without exposing provider secrets', async () => {
    const state = 'nzB3Qk9y_state-value.1234';
    const fetchImpl = vi.fn(async () => jsonResponse({
      workspaceId: WORKSPACE_ID,
      platform: 'facebook',
      state,
      expiresAt: '2026-08-22T12:00:00.000Z',
      authorizeUrl: `https://www.facebook.com/v21.0/dialog/oauth?state=${state}`,
      clientSecret: 'leaked-secret',
    }, 201));
    const client = new NativeMarketingClient(tokenProvider(), {
      baseUrl: REVIEWED_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.createOAuthState(WORKSPACE_ID, 'facebook');
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];

    expect(url).toBe(`${REVIEWED_ORIGIN}/api/marketing/oauth/state`);
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)))
      .toEqual({ workspaceId: WORKSPACE_ID, platform: 'facebook' });
    expect(result).toEqual({
      ok: true,
      platform: 'facebook',
      state: {
        state,
        authorizeUrl: `https://www.facebook.com/v21.0/dialog/oauth?state=${state}`,
        expiresAt: '2026-08-22T12:00:00.000Z',
      },
    });
    expect(JSON.stringify(result)).not.toContain('leaked-secret');
  });

  it('completes native OAuth and returns only the linked account summary', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      workspaceId: WORKSPACE_ID,
      platform: 'facebook',
      status: 'state_consumed',
      exchange: 'linked',
      account: {
        id: ACCOUNT_ID,
        platform: 'facebook',
        displayName: 'Test Page',
        status: 'connected',
        active: true,
        accessToken: 'must-not-cross-ipc',
      },
    }));
    const client = new NativeMarketingClient(tokenProvider(), {
      baseUrl: REVIEWED_ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.completeOAuth(WORKSPACE_ID, 'facebook', 'nzB3Qk9y_state-value.1234', 'code-value-1234');
    expect(result).toEqual({
      ok: true,
      platform: 'facebook',
      exchange: 'linked',
      account: {
        id: ACCOUNT_ID,
        platform: 'facebook',
        name: 'Test Page',
        status: 'connected',
        active: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain('must-not-cross-ipc');
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body)))
      .toMatchObject({ workspaceId: WORKSPACE_ID, platform: 'facebook' });
  });
});
