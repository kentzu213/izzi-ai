import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real @supabase/supabase-js (and auth-js) client: only the network below it is faked.
vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: vi.fn() },
  BrowserWindow: vi.fn(),
}));

vi.mock('../config/public-config', () => ({
  IZZI_API_BASE: 'https://api.example.test',
  IZZI_WEB_BASE: 'https://web.example.test',
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'anon-key',
}));

import { AUTH_SERVER_UNREACHABLE_ERROR, AuthManager } from './auth-manager';

function createDb(seedSession: Record<string, unknown> | null) {
  const settings = new Map<string, string>(seedSession ? [['auth_session', JSON.stringify(seedSession)]] : []);
  return {
    settings,
    getSetting: (key: string) => settings.get(key) ?? null,
    setSetting: (key: string, value: string) => { settings.set(key, value); },
    deleteSetting: (key: string) => { settings.delete(key); },
    appendDiagnosticEvent: vi.fn(),
  };
}

describe('AuthManager with the real auth-js client against a hung auth server', () => {
  let refreshCalls: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    refreshCalls = [];
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('grant_type=refresh_token')) refreshCalls.push(url);
      // Accepts the connection and never answers; only the abort signal ends the request.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
      });
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('aborts each attempt, lets the auth-js retry loop end, keeps the session and allows a new refresh', async () => {
    const db = createDb({
      accessToken: 'old-access',
      refreshToken: 'old-refresh',
      expiresAt: Date.now() - 1_000,
      user: { id: 'user-1', email: 'user@example.test', name: 'User' },
    });
    const onSessionExpired = vi.fn();
    const manager = new AuthManager(db as never, { onSessionExpired });

    const token = manager.getAccessToken();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await token).toBeNull();
    expect(manager.isSessionRefreshUnavailable()).toBe(true);

    // auth-js retries each AuthRetryableFetchError inside its 30 s backoff window, then gives up.
    await vi.advanceTimersByTimeAsync(40_000);
    const attempts = refreshCalls.length;
    expect(attempts).toBeGreaterThan(1);
    expect(attempts).toBeLessThanOrEqual(5);

    expect(manager.isAuthenticated()).toBe(true);
    expect(manager.isSessionRefreshUnavailable()).toBe(true);
    expect(JSON.parse(db.settings.get('auth_session') ?? '{}').refreshToken).toBe('old-refresh');
    expect(onSessionExpired).not.toHaveBeenCalled();

    // The in-flight refresh was released: the next read starts a new request instead of waiting.
    const next = manager.getAccessToken();
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshCalls.length).toBe(attempts + 1);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await next).toBeNull();
    await vi.advanceTimersByTimeAsync(40_000);
  });
});

describe('AuthManager logout and re-login with the real auth-js client', () => {
  let events: string[];
  let passwordGrants: number;

  function sessionBody(label: string) {
    const now = Math.floor(Date.now() / 1000);
    return {
      access_token: `${label}-access`,
      refresh_token: `${label}-refresh`,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: now + 3600,
      user: { id: 'user-1', aud: 'authenticated', email: 'user@example.test', user_metadata: {}, app_metadata: {} },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
    passwordGrants = 0;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const headers = new Headers(init?.headers);
      if (url.includes('grant_type=password')) {
        passwordGrants += 1;
        const label = `S${passwordGrants}`;
        events.push(`grant ${label}`);
        return Promise.resolve(new Response(JSON.stringify(sessionBody(label)), { status: 200 }));
      }
      if (url.includes('/auth/v1/logout')) {
        events.push(`logout ${headers.get('Authorization')}`);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.includes('grant_type=refresh_token')) {
        events.push('refresh attempt');
        // The auth server accepts the refresh and never answers.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('This operation was aborted', 'AbortError')));
        });
      }
      return Promise.resolve(new Response('{}', { status: 404 })); // /api/auth/me
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refuses a re-login while the queued sign-out is stuck, then signs in without the new session being revoked', async () => {
    const db = createDb(null);
    const manager = new AuthManager(db as never);
    const first = manager.login('user@example.test', 'pw');
    await vi.advanceTimersByTimeAsync(0);
    expect((await first).success).toBe(true);

    // A refresh hangs inside auth-js and holds its lock; logout queues the remote sign-out behind it.
    void manager.refreshAccessToken();
    await vi.advanceTimersByTimeAsync(0);
    await manager.logout();
    expect(manager.isAuthenticated()).toBe(false);
    expect(db.settings.has('auth_session')).toBe(false);

    const refused = manager.login('user@example.test', 'pw');
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await refused).toEqual({ success: false, error: AUTH_SERVER_UNREACHABLE_ERROR });
    expect(passwordGrants).toBe(1);

    // The refresh loop gives up, the queued sign-out revokes the old session, then sign-in works.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(events.filter((event) => event.startsWith('logout'))).toEqual(['logout Bearer S1-access']);
    const second = manager.login('user@example.test', 'pw');
    await vi.advanceTimersByTimeAsync(0);
    expect((await second).success).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await manager.getAccessToken()).toBe('S2-access');
    expect(events.filter((event) => !event.startsWith('refresh'))).toEqual([
      'grant S1',
      'logout Bearer S1-access',
      'grant S2',
    ]);
    expect(JSON.parse(db.settings.get('auth_session') ?? '{}').refreshToken).toBe('S2-refresh');
  });
});
