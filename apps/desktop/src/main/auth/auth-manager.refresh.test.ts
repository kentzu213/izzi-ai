import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';

const supabaseMock = vi.hoisted(() => ({
  createClient: vi.fn(),
  refreshSession: vi.fn(),
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
      auth: { refreshSession: supabaseMock.refreshSession },
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

    expect(await manager.getAccessToken()).toBeNull();

    expect(manager.isAuthenticated()).toBe(true);
    expect(db.settings.has('auth_session')).toBe(true);
    expect(db.settings.get('izzi_desktop_key')).toBe('cached-key');
    expect(onSessionExpired).not.toHaveBeenCalled();
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
