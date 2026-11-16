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

import { AuthManager } from './auth-manager';

function createDb(seedSession: Record<string, unknown>) {
  const settings = new Map<string, string>([['auth_session', JSON.stringify(seedSession)]]);
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
