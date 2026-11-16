import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError, AuthRetryableFetchError, AuthUnknownError } from '@supabase/supabase-js';

const supabaseMock = vi.hoisted(() => ({
  createClient: vi.fn(),
  refreshSession: vi.fn(),
  signInWithPassword: vi.fn(),
}));

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

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>();
  return {
    ...actual,
    createClient: supabaseMock.createClient.mockImplementation(() => ({
      auth: { refreshSession: supabaseMock.refreshSession, signInWithPassword: supabaseMock.signInWithPassword },
    })),
  };
});

import { AuthManager } from './auth-manager';

const USER = { id: 'user-1', email: 'user@example.test', name: 'User' };

function createDb(seedSession: Record<string, unknown> | null) {
  const settings = new Map<string, string>();
  if (seedSession) settings.set('auth_session', JSON.stringify(seedSession));
  settings.set('izzi_desktop_key', 'cached-key');
  return {
    settings,
    getSetting: (key: string) => settings.get(key) ?? null,
    setSetting: (key: string, value: string) => { settings.set(key, value); },
    deleteSetting: (key: string) => { settings.delete(key); },
    appendDiagnosticEvent: vi.fn(),
  };
}

function nearExpirySession() {
  return {
    accessToken: 'old-access',
    refreshToken: 'old-refresh',
    expiresAt: Date.now() + 60_000,
    user: USER,
  };
}

function refreshedSession() {
  return {
    data: {
      session: {
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    },
    error: null,
  };
}

function rejected(error: Error) {
  return { data: { session: null }, error };
}

describe('AuthManager token refresh', () => {
  beforeEach(() => {
    supabaseMock.createClient.mockClear();
    supabaseMock.refreshSession.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  });

  it('owns token refresh itself instead of letting the Supabase client rotate tokens in the background', () => {
    new AuthManager(createDb(null) as never);

    const options = supabaseMock.createClient.mock.calls[0][2];
    expect(options.auth.autoRefreshToken).toBe(false);
  });

  it('shares one refresh request between concurrent token reads', async () => {
    let resolveRefresh: (value: unknown) => void = () => {};
    supabaseMock.refreshSession.mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }));
    const manager = new AuthManager(createDb(nearExpirySession()) as never);

    const reads = [manager.getAccessToken(), manager.getAccessToken(), manager.getAccessToken()];
    resolveRefresh(refreshedSession());

    expect(await Promise.all(reads)).toEqual(['new-access', 'new-access', 'new-access']);
    expect(supabaseMock.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('keeps the session when the refresh fails for a transient network or server reason', async () => {
    supabaseMock.refreshSession.mockResolvedValue(rejected(new AuthRetryableFetchError('fetch failed', 0)));
    const onSessionExpired = vi.fn();
    const db = createDb(nearExpirySession());
    const manager = new AuthManager(db as never, { onSessionExpired });

    expect(await manager.getAccessToken()).toBe('old-access');

    expect(manager.isAuthenticated()).toBe(true);
    expect(db.settings.has('auth_session')).toBe(true);
    expect(db.settings.get('izzi_desktop_key')).toBe('cached-key');
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('returns no token after a transient refresh failure once the current token has expired', async () => {
    supabaseMock.refreshSession.mockResolvedValue(rejected(new AuthRetryableFetchError('fetch failed', 0)));
    const manager = new AuthManager(createDb({ ...nearExpirySession(), expiresAt: Date.now() - 1_000 }) as never);

    expect(await manager.getAccessToken()).toBeNull();

    expect(manager.isAuthenticated()).toBe(true);
  });

  it('persists the rotated tokens before the profile request finishes', async () => {
    supabaseMock.refreshSession.mockResolvedValue(refreshedSession());
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})));
    const db = createDb(nearExpirySession());
    const manager = new AuthManager(db as never);

    void manager.getAccessToken();
    await vi.waitFor(() => expect(JSON.parse(db.settings.get('auth_session') ?? '{}').refreshToken).toBe('new-refresh'));

    expect(JSON.parse(db.settings.get('auth_session') ?? '{}').user).toEqual(USER);
  });

  it('keeps the session and reports the auth server unreachable when it answers a refresh with an HTML page', async () => {
    // auth-js raises AuthUnknownError (no status) when a non-2xx body is not JSON, e.g. a 5xx/530 HTML page.
    const htmlError = new AuthUnknownError(
      `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`,
      new SyntaxError('html'),
    );
    supabaseMock.refreshSession.mockResolvedValue(rejected(htmlError));
    const onSessionExpired = vi.fn();
    const db = createDb({ ...nearExpirySession(), expiresAt: Date.now() - 1_000 });
    const manager = new AuthManager(db as never, { onSessionExpired });

    expect(await manager.getAccessToken()).toBeNull();

    expect(manager.isSessionRefreshUnavailable()).toBe(true);
    expect(manager.isAuthenticated()).toBe(true);
    expect(JSON.parse(db.settings.get('auth_session') ?? '{}').refreshToken).toBe('old-refresh');
    expect(db.settings.get('izzi_desktop_key')).toBe('cached-key');
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it.each([
    ['a network failure', new AuthRetryableFetchError('fetch failed', 0)],
    ['a 503 from the auth server', new AuthRetryableFetchError('Service Unavailable', 503)],
  ])('reports the auth server unreachable after %s', async (_label, error) => {
    supabaseMock.refreshSession.mockResolvedValue(rejected(error));
    const manager = new AuthManager(createDb({ ...nearExpirySession(), expiresAt: Date.now() - 1_000 }) as never);

    expect(await manager.getAccessToken()).toBeNull();

    expect(manager.isSessionRefreshUnavailable()).toBe(true);
    expect(manager.isAuthenticated()).toBe(true);
  });

  it('clears the unreachable flag once a later refresh succeeds', async () => {
    supabaseMock.refreshSession
      .mockResolvedValueOnce(rejected(new AuthRetryableFetchError('fetch failed', 0)))
      .mockResolvedValueOnce(refreshedSession());
    const manager = new AuthManager(createDb({ ...nearExpirySession(), expiresAt: Date.now() - 1_000 }) as never);
    expect(await manager.getAccessToken()).toBeNull();

    expect(await manager.getAccessToken()).toBe('new-access');

    expect(manager.isSessionRefreshUnavailable()).toBe(false);
  });

  it('does not report the auth server unreachable when it rejected the refresh token', async () => {
    supabaseMock.refreshSession.mockResolvedValue(
      rejected(new AuthApiError('Invalid Refresh Token: Revoked', 400, 'refresh_token_not_found')),
    );
    const manager = new AuthManager(createDb(nearExpirySession()) as never);

    expect(await manager.getAccessToken()).toBeNull();

    expect(manager.isSessionRefreshUnavailable()).toBe(false);
  });

  it('keeps the session when Supabase is rate limiting refreshes', async () => {
    supabaseMock.refreshSession.mockResolvedValue(rejected(new AuthApiError('Too many requests', 429, 'over_request_rate_limit')));
    const manager = new AuthManager(createDb(nearExpirySession()) as never);

    await manager.getAccessToken();

    expect(manager.isAuthenticated()).toBe(true);
  });

  it('signs out and notifies the window when Supabase rejects the refresh token', async () => {
    supabaseMock.refreshSession.mockResolvedValue(
      rejected(new AuthApiError('Invalid Refresh Token: Already Used', 400, 'refresh_token_already_used')),
    );
    const onSessionExpired = vi.fn();
    const db = createDb(nearExpirySession());
    const manager = new AuthManager(db as never, { onSessionExpired });

    expect(await manager.getAccessToken()).toBeNull();

    expect(manager.isAuthenticated()).toBe(false);
    expect(db.settings.has('auth_session')).toBe(false);
    expect(db.settings.has('izzi_desktop_key')).toBe(false);
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  it('does not resurrect a session the user logged out of while a refresh was in flight', async () => {
    let resolveRefresh: (value: unknown) => void = () => {};
    supabaseMock.refreshSession.mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }));
    const db = createDb(nearExpirySession());
    const manager = new AuthManager(db as never);

    const read = manager.getAccessToken();
    await manager.logout();
    resolveRefresh(refreshedSession());

    expect(await read).toBeNull();
    expect(manager.isAuthenticated()).toBe(false);
    expect(db.settings.has('auth_session')).toBe(false);
  });
});

describe('AuthManager when the auth server hangs', () => {
  function hungRefresh() {
    let settle: (value: unknown) => void = () => {};
    let fail: (error: unknown) => void = () => {};
    supabaseMock.refreshSession.mockReturnValueOnce(new Promise((resolve, reject) => { settle = resolve; fail = reject; }));
    return { settle: (value: unknown) => settle(value), fail: (error: unknown) => fail(error) };
  }

  function expiredSession() {
    return { ...nearExpirySession(), expiresAt: Date.now() - 1_000 };
  }

  function loginSucceeds() {
    supabaseMock.signInWithPassword.mockResolvedValue({
      data: {
        session: { access_token: 'login-access', refresh_token: 'login-refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 },
        user: { id: 'user-2', email: 'other@example.test', user_metadata: {} },
      },
      error: null,
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    supabaseMock.createClient.mockClear();
    supabaseMock.refreshSession.mockReset();
    supabaseMock.signInWithPassword.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('aborts every Supabase Auth request after 8 seconds, including the body read', async () => {
    const network = vi.fn((_input: unknown, _init?: RequestInit) => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', network);
    new AuthManager(createDb(null) as never);
    const authFetch = supabaseMock.createClient.mock.calls[0][2].global.fetch as typeof fetch;

    void authFetch('https://supabase.example.test/auth/v1/token?grant_type=refresh_token', { method: 'POST' });
    const signal = network.mock.calls[0][1]?.signal as AbortSignal;
    await vi.advanceTimersByTimeAsync(7_999);
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(signal.aborted).toBe(true);
    expect(network.mock.calls[0][1]?.method).toBe('POST');
  });

  it('returns no token within 8 seconds, keeps the session and reports the auth server unreachable', async () => {
    hungRefresh();
    const onSessionExpired = vi.fn();
    const db = createDb(expiredSession());
    const manager = new AuthManager(db as never, { onSessionExpired });

    const token = manager.getAccessToken();
    await vi.advanceTimersByTimeAsync(8_000);

    expect(await token).toBeNull();
    expect(manager.isSessionRefreshUnavailable()).toBe(true);
    expect(manager.isAuthenticated()).toBe(true);
    expect(JSON.parse(db.settings.get('auth_session') ?? '{}').refreshToken).toBe('old-refresh');
    expect(db.settings.get('izzi_desktop_key')).toBe('cached-key');
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  it('keeps using a still-valid token when the refresh hangs', async () => {
    hungRefresh();
    const manager = new AuthManager(createDb(nearExpirySession()) as never);

    const token = manager.getAccessToken();
    await vi.advanceTimersByTimeAsync(8_000);

    expect(await token).toBe('old-access');
    expect(manager.isSessionRefreshUnavailable()).toBe(true);
  });

  it('shares the hung refresh and answers later callers at once instead of starting another request', async () => {
    hungRefresh();
    const manager = new AuthManager(createDb(expiredSession()) as never);
    const first = [manager.getAccessToken(), manager.getAccessToken()];
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await Promise.all(first)).toEqual([null, null]);

    const later = manager.getAccessToken();
    await vi.advanceTimersByTimeAsync(0);

    await expect(later).resolves.toBeNull();
    expect(supabaseMock.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('applies a refresh that finishes after the deadline, because the server already rotated the token', async () => {
    const refresh = hungRefresh();
    const db = createDb(expiredSession());
    const manager = new AuthManager(db as never);
    const token = manager.getAccessToken();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await token).toBeNull();

    refresh.settle(refreshedSession());
    await vi.advanceTimersByTimeAsync(0);

    expect(JSON.parse(db.settings.get('auth_session') ?? '{}').refreshToken).toBe('new-refresh');
    expect(manager.isSessionRefreshUnavailable()).toBe(false);
    expect(await manager.getAccessToken()).toBe('new-access');
  });

  it('starts a fresh refresh once the hung one has given up, and clears the flag when it succeeds', async () => {
    const refresh = hungRefresh();
    const manager = new AuthManager(createDb(expiredSession()) as never);
    const token = manager.getAccessToken();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await token).toBeNull();
    refresh.settle(rejected(new AuthRetryableFetchError('signal is aborted without reason', 0)));
    await vi.advanceTimersByTimeAsync(0);
    expect(manager.isSessionRefreshUnavailable()).toBe(true);
    supabaseMock.refreshSession.mockResolvedValueOnce(refreshedSession());

    expect(await manager.getAccessToken()).toBe('new-access');

    expect(supabaseMock.refreshSession).toHaveBeenCalledTimes(2);
    expect(manager.isSessionRefreshUnavailable()).toBe(false);
  });

  it('does not let a late refresh overwrite a newer sign-in', async () => {
    const refresh = hungRefresh();
    loginSucceeds();
    const db = createDb(expiredSession());
    const manager = new AuthManager(db as never);
    const token = manager.getAccessToken();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await token).toBeNull();
    expect((await manager.login('other@example.test', 'pw')).success).toBe(true);

    refresh.settle(refreshedSession());
    await vi.advanceTimersByTimeAsync(0);

    expect(JSON.parse(db.settings.get('auth_session') ?? '{}').refreshToken).toBe('login-refresh');
    expect(await manager.getAccessToken()).toBe('login-access');
    expect(manager.isSessionRefreshUnavailable()).toBe(false);
  });

  it('does not let a late refresh resurrect a session the user signed out of', async () => {
    const refresh = hungRefresh();
    const db = createDb(expiredSession());
    const manager = new AuthManager(db as never);
    const token = manager.getAccessToken();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(await token).toBeNull();
    await manager.logout();

    refresh.settle(refreshedSession());
    await vi.advanceTimersByTimeAsync(0);

    expect(manager.isAuthenticated()).toBe(false);
    expect(db.settings.has('auth_session')).toBe(false);
  });

  it('keeps the session and reports the auth server unreachable when the refresh call throws', async () => {
    const refresh = hungRefresh();
    const db = createDb(expiredSession());
    const manager = new AuthManager(db as never);
    const token = manager.getAccessToken();

    refresh.fail(new TypeError('fetch failed'));
    await vi.advanceTimersByTimeAsync(0);

    expect(await token).toBeNull();
    expect(manager.isSessionRefreshUnavailable()).toBe(true);
    expect(JSON.parse(db.settings.get('auth_session') ?? '{}').refreshToken).toBe('old-refresh');
  });

  it('does not flag a newer session when a refresh for the previous one throws late', async () => {
    const refresh = hungRefresh();
    loginSucceeds();
    const manager = new AuthManager(createDb(expiredSession()) as never);
    void manager.getAccessToken();
    expect((await manager.login('other@example.test', 'pw')).success).toBe(true);

    refresh.fail(new TypeError('fetch failed'));
    await vi.advanceTimersByTimeAsync(0);

    expect(manager.isSessionRefreshUnavailable()).toBe(false);
    expect(await manager.getAccessToken()).toBe('login-access');
  });

  it('treats a session without a refresh token as a sign-in requirement, not an outage', async () => {
    const manager = new AuthManager(createDb({ ...expiredSession(), refreshToken: '' }) as never);
    await vi.advanceTimersByTimeAsync(0); // let the constructor's refresh attempt settle
    // A flag left over from an earlier outage must not survive a refresh that cannot even start.
    (manager as unknown as { refreshUnavailable: boolean }).refreshUnavailable = true;

    expect(await manager.getAccessToken()).toBeNull();

    expect(manager.isSessionRefreshUnavailable()).toBe(false);
    expect(supabaseMock.refreshSession).not.toHaveBeenCalled();
  });
});
