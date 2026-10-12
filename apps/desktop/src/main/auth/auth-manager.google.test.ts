import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signInWithOAuth: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  setSession: vi.fn(),
  openExternal: vi.fn(),
  startLoopbackReceiver: vi.fn(),
}));

vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
  shell: { openExternal: mocks.openExternal },
}));

vi.mock('../config/public-config', () => ({
  IZZI_API_BASE: 'https://api.example.test',
  SUPABASE_URL: 'https://supabase.example.test',
  SUPABASE_ANON_KEY: 'anon-key',
}));

vi.mock('@supabase/supabase-js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/supabase-js')>();
  return {
    ...actual,
    createClient: mocks.createClient.mockImplementation(() => ({
      auth: {
        signInWithOAuth: mocks.signInWithOAuth,
        exchangeCodeForSession: mocks.exchangeCodeForSession,
        setSession: mocks.setSession,
      },
    })),
  };
});

vi.mock('./oauth-loopback', () => ({ startLoopbackReceiver: mocks.startLoopbackReceiver }));

import { AuthManager } from './auth-manager';

const REDIRECT = 'http://127.0.0.1:50123/auth/callback';
const SESSION = { access_token: 'access', refresh_token: 'refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 };

function createDb() {
  const settings = new Map<string, string>();
  return {
    settings,
    getSetting: (key: string) => settings.get(key) ?? null,
    setSetting: (key: string, value: string) => { settings.set(key, value); },
    deleteSetting: (key: string) => { settings.delete(key); },
    appendDiagnosticEvent: vi.fn(),
  };
}

function receiverWith(outcome: unknown) {
  return { redirectUrl: REDIRECT, result: Promise.resolve(outcome), close: vi.fn() };
}

function createManager() {
  return new AuthManager(createDb() as never);
}

describe('AuthManager Google login in the system browser', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockClear();
    mocks.signInWithOAuth.mockResolvedValue({ data: { url: 'https://supabase.example.test/authorize?x=1' }, error: null });
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { session: SESSION }, error: null });
    mocks.setSession.mockResolvedValue({
      data: { session: SESSION, user: { id: 'user-1', email: 'user@example.test', user_metadata: { full_name: 'User' } } },
      error: null,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  });

  it('opens the OAuth URL externally and exchanges the loopback code with a PKCE client', async () => {
    const receiver = receiverWith({ kind: 'code', code: 'pkce-code' });
    mocks.startLoopbackReceiver.mockResolvedValue(receiver);

    const result = await createManager().loginWithGoogle();

    expect(mocks.createClient).toHaveBeenLastCalledWith('https://supabase.example.test', 'anon-key', {
      auth: { autoRefreshToken: false, persistSession: false, flowType: 'pkce' },
    });
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: REDIRECT, skipBrowserRedirect: true },
    });
    expect(mocks.openExternal).toHaveBeenCalledWith('https://supabase.example.test/authorize?x=1');
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('pkce-code');
    expect(mocks.setSession).toHaveBeenCalledWith({ access_token: 'access', refresh_token: 'refresh' });
    expect(result).toMatchObject({ success: true, user: { id: 'user-1', email: 'user@example.test' } });
    expect(receiver.close).toHaveBeenCalled();
  });

  it('keeps the main client on the implicit flow used by signup confirmation links', async () => {
    mocks.startLoopbackReceiver.mockResolvedValue(receiverWith({ kind: 'code', code: 'c' }));

    await createManager().loginWithGoogle();

    expect(mocks.createClient.mock.calls[0][2].auth.flowType).toBe('implicit');
  });

  it('returns the browser error without exchanging a code', async () => {
    mocks.startLoopbackReceiver.mockResolvedValue(receiverWith({ kind: 'error', message: 'Google từ chối đăng nhập (denied)' }));

    const result = await createManager().loginWithGoogle();

    expect(result).toEqual({ success: false, error: 'Google từ chối đăng nhập (denied)' });
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  it('reports a failed code exchange', async () => {
    mocks.startLoopbackReceiver.mockResolvedValue(receiverWith({ kind: 'code', code: 'c' }));
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { session: null }, error: new Error('invalid flow state') });

    const result = await createManager().loginWithGoogle();

    expect(result).toEqual({ success: false, error: 'invalid flow state' });
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  it('closes the receiver when the OAuth URL cannot be built', async () => {
    const receiver = receiverWith({ kind: 'code', code: 'c' });
    mocks.startLoopbackReceiver.mockResolvedValue(receiver);
    mocks.signInWithOAuth.mockResolvedValue({ data: { url: null }, error: new Error('provider disabled') });

    const result = await createManager().loginWithGoogle();

    expect(result).toEqual({ success: false, error: 'provider disabled' });
    expect(mocks.openExternal).not.toHaveBeenCalled();
    expect(receiver.close).toHaveBeenCalled();
  });

  it('cancels a pending attempt when the user clicks Google login again', async () => {
    let settleFirst!: (outcome: unknown) => void;
    const first = {
      redirectUrl: REDIRECT,
      result: new Promise((resolve) => { settleFirst = resolve; }),
      close: vi.fn(() => settleFirst({ kind: 'error', message: 'cancelled' })),
    };
    mocks.startLoopbackReceiver.mockResolvedValueOnce(first).mockResolvedValueOnce(receiverWith({ kind: 'code', code: 'c' }));
    const manager = createManager();

    const firstAttempt = manager.loginWithGoogle();
    await vi.waitFor(() => expect(mocks.openExternal).toHaveBeenCalledTimes(1));
    const second = await manager.loginWithGoogle();

    expect(first.close).toHaveBeenCalled();
    await expect(firstAttempt).resolves.toEqual({ success: false, error: 'cancelled' });
    expect(second.success).toBe(true);
  });
});
