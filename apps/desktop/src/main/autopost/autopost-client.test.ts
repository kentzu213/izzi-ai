import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOPOST_CONNECT_PLATFORMS,
  AutopostClient,
  isAllowedAutopostConnectUrl,
  isAutopostConnectPlatform,
  summarizeAutopostAccounts,
  type AutopostConnectPlatform,
} from './autopost-client';
import type { AutopostAuth } from './autopost-auth';

function stubAuth(jwt: string | null = 'jwt-token') {
  const clear = vi.fn();
  const auth = {
    baseUrl: 'http://127.0.0.1:3001',
    getJwt: async () => jwt,
    getWorkspaceId: () => 'ws-1',
    clear,
  } as unknown as AutopostAuth;
  return { auth, clear };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

const originalFetch = globalThis.fetch;

describe('AutopostClient.beginConnect', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('accepts only facebook and youtube', () => {
    expect([...AUTOPOST_CONNECT_PLATFORMS]).toEqual(['facebook', 'youtube']);
    expect(isAutopostConnectPlatform('facebook')).toBe(true);
    expect(isAutopostConnectPlatform('youtube')).toBe(true);
    expect(isAutopostConnectPlatform('tiktok')).toBe(false);
  });

  it('allows only exact HTTPS OAuth provider hosts', () => {
    expect(isAllowedAutopostConnectUrl(
      'facebook',
      'https://www.facebook.com/v22.0/dialog/oauth?state=test-state',
    )).toBe(true);
    expect(isAllowedAutopostConnectUrl(
      'youtube',
      'https://accounts.google.com/o/oauth2/v2/auth?state=test-state',
    )).toBe(true);
    expect(isAllowedAutopostConnectUrl('youtube', 'http://accounts.google.com/auth')).toBe(false);
    expect(isAllowedAutopostConnectUrl('youtube', 'https://accounts.google.com.evil.test/auth')).toBe(false);
    expect(isAllowedAutopostConnectUrl('facebook', 'https://user:pass@facebook.com/auth')).toBe(false);
    expect(isAllowedAutopostConnectUrl('facebook', 'https://accounts.google.com/auth')).toBe(false);
    expect(isAllowedAutopostConnectUrl('facebook', 'http://localhost:3005/auth/mock-oauth')).toBe(false);
  });

  it('rejects an unsupported platform before network access', async () => {
    const client = new AutopostClient(stubAuth().auth);
    const result = await client.beginConnect('tiktok' as unknown as AutopostConnectPlatform);
    expect(result).toEqual({ ok: false, error: 'unsupported-platform' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests Facebook OAuth with the Auto Post JWT', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      redirectUrl: 'https://www.facebook.com/v22.0/dialog/oauth?state=test-state',
    }));
    const client = new AutopostClient(stubAuth().auth);
    const result = await client.beginConnect('facebook');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3001/social-auth/connect/facebook');
    expect(init.method).toBe('GET');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-token');
    expect(result.redirectUrl).toContain('www.facebook.com');
    expect(result).not.toHaveProperty('data');
  });

  it('uses the YouTube OAuth endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {
      redirectUrl: 'https://accounts.google.com/o/oauth2/v2/auth?scope=youtube',
    }));
    const result = await new AutopostClient(stubAuth().auth).beginConnect('youtube');
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://127.0.0.1:3001/social-auth/connect/youtube',
    );
    expect(result.redirectUrl).toContain('accounts.google.com');
  });

  it('fails closed when auth or redirect data is unavailable', async () => {
    const disconnected = await new AutopostClient(stubAuth(null).auth).beginConnect('facebook');
    expect(disconnected).toEqual({ ok: false, status: undefined, error: 'not-connected' });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(jsonResponse(200, { redirectUrl: '   ' }));
    const missing = await new AutopostClient(stubAuth().auth).beginConnect('youtube');
    expect(missing).toEqual({ ok: false, status: 200, error: 'missing-redirect-url' });
  });

  it('clears stale auth on 401 and never throws on network failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { message: 'Unauthorized' }));
    const { auth, clear } = stubAuth();
    expect(await new AutopostClient(auth).beginConnect('facebook')).toEqual({
      ok: false,
      status: 401,
      error: 'Unauthorized',
    });
    expect(clear).toHaveBeenCalledTimes(1);

    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const unavailable = await new AutopostClient(stubAuth().auth).beginConnect('youtube');
    expect(unavailable.ok).toBe(false);
    expect(unavailable.error).toBe('connect ECONNREFUSED');
  });
});

describe('summarizeAutopostAccounts', () => {
  it('returns only bounded display metadata and strips credential material', () => {
    const result = summarizeAutopostAccounts([{
      id: 'facebook-account-1',
      platform: 'FACEBOOK',
      accountName: 'IzziAPI Test Page',
      status: 'active',
      accessToken: 'must-not-cross-ipc',
      refreshToken: 'must-not-cross-ipc',
      oauthState: 'must-not-cross-ipc',
      metadata: { clientSecret: 'must-not-cross-ipc' },
    }]);

    expect(result).toEqual([{
      id: 'facebook-account-1',
      platform: 'facebook',
      name: 'IzziAPI Test Page',
      status: 'active',
      active: true,
    }]);
    expect(JSON.stringify(result)).not.toMatch(/token|secret|oauth|state/i);
  });

  it('normalizes unknown fields and inactive account states', () => {
    expect(summarizeAutopostAccounts([
      { provider: 'google', channelTitle: 'Private Channel', state: 'revoked' },
      { platform: 'unexpected-network', name: 'Account', status: 'custom-secret-status' },
      null,
    ])).toEqual([
      { id: '', platform: 'google', name: 'Private Channel', status: 'revoked', active: false },
      { id: '', platform: 'social', name: 'Account', status: 'unknown', active: true },
    ]);
  });
});
