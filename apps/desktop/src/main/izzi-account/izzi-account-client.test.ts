import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthManager } from '../auth/auth-manager';
import type { SecretStore } from '../agent/secret-store';
import type { CustomProviderConfig, ProviderSettingsStore } from '../agent/provider-settings-store';
import { IZZI_API_BASE } from '../config/public-config';
import { IzziAccountClient } from './izzi-account-client';

const TOKEN = 'test-jwt-SUPERSECRET-do-not-leak-abc123';
const TOKEN_2 = 'test-jwt-REFRESHED-do-not-leak-xyz789';
const STORED_KEY = 'izzi-0000000000000000000000000000000000000000aa11bb';
const NEW_KEY = 'izzi-ffffffffffffffffffffffffffffffffffffffffcc22dd';
/** The app's own chat key; matches k-other's prefix. */
const DESKTOP_KEY = 'izzi-9999999999999999999999999999999999999999123456';

type Reply = { status: number; body?: unknown } | Error;

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/** Routes "METHOD path" → reply (or a list consumed in order). */
function stubFetch(routes: Record<string, Reply | Reply[]>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = url.replace(IZZI_API_BASE, '').split('?')[0];
    const route = `${init?.method ?? 'GET'} ${path}`;
    const entry = routes[route];
    const reply = Array.isArray(entry) ? entry.shift() : entry;
    if (!reply) throw new Error(`unexpected request ${route}`);
    if (reply instanceof Error) throw reply;
    return jsonResponse(reply.status, reply.body ?? {});
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function fakeAuth(tokens: Array<string | null>, refreshOk = true, desktopKey: string | null = null) {
  const queue = [...tokens];
  return {
    getAccessToken: vi.fn(async () => (queue.length > 1 ? queue.shift()! : queue[0])),
    refreshAccessToken: vi.fn(async () => refreshOk),
    peekDesktopApiKey: vi.fn(() => desktopKey),
    forgetDesktopApiKey: vi.fn(),
  };
}

function fakeSecrets(key: string | null) {
  let stored = key;
  return {
    getKey: vi.fn(() => stored),
    setKey: vi.fn((k: string) => {
      stored = k;
    }),
    deleteKey: vi.fn(() => {
      stored = null;
    }),
  };
}

function fakeSettings(config: CustomProviderConfig | null) {
  return {
    getConfig: vi.fn(() => config),
    saveConfig: vi.fn(),
    clearConfig: vi.fn(),
    isCustomEnabled: vi.fn(() => false),
    setEnabled: vi.fn(),
  };
}

function makeClient(opts: {
  auth?: ReturnType<typeof fakeAuth>;
  secrets?: ReturnType<typeof fakeSecrets>;
  settings?: ReturnType<typeof fakeSettings>;
}) {
  const auth = opts.auth ?? fakeAuth([TOKEN]);
  const secrets = opts.secrets ?? fakeSecrets(STORED_KEY);
  const settings = opts.settings ?? fakeSettings(null);
  const client = new IzziAccountClient(
    auth as unknown as AuthManager,
    secrets as unknown as SecretStore,
    settings as unknown as ProviderSettingsStore,
  );
  return { client, auth, secrets, settings };
}

const KEYS_BODY = {
  keys: [
    { id: 'k-other', name: 'CI', key_prefix: 'izzi-...123456', status: 'active', last_used_at: null, created_at: '2026-10-01T00:00:00Z' },
    { id: 'k-app', name: 'Desktop', key_prefix: 'izzi-...aa11bb', status: 'active', last_used_at: '2026-10-06T00:00:00Z', created_at: '2026-10-02T00:00:00Z' },
  ],
};
const STATS_BODY = {
  summary: { totalCost: 1.5, totalRequests: 42, totalInputTokens: 1000, totalOutputTokens: 500, totalCachedTokens: 0 },
  daily: [{ day: '2026-10-06', cost: 1.5 }],
  byModel: [{ model: 'gpt-6.1-sol', cost: 1.5, requests: 42 }],
};

function overviewRoutes(over: Partial<Record<string, Reply | Reply[]>> = {}) {
  return {
    'GET /api/billing/balance': { status: 200, body: { balance: 9.25, plan: 'pro' } },
    'GET /api/usage/stats': { status: 200, body: STATS_BODY },
    'GET /api/keys': { status: 200, body: KEYS_BODY },
    ...over,
  } as Record<string, Reply | Reply[]>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('IzziAccountClient.getOverview', () => {
  it('returns balance, stats, keys and the in-use key id matched by the last 6 chars', async () => {
    const fetchMock = stubFetch(overviewRoutes());
    const { client } = makeClient({});

    const res = await client.getOverview();

    expect(res.ok).toBe(true);
    expect(res.balance).toBe(9.25);
    expect(res.plan).toBe('pro');
    expect(res.stats?.totalRequests).toBe(42);
    expect(res.stats?.byModel[0]).toEqual({ model: 'gpt-6.1-sol', cost: 1.5, requests: 42 });
    expect(res.keys?.map((k) => k.id)).toEqual(['k-other', 'k-app']);
    expect(res.inUseKeyId).toBe('k-app');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('marks the key the app uses for chat as managedKeyId', async () => {
    stubFetch(overviewRoutes());
    const { client } = makeClient({ auth: fakeAuth([TOKEN], true, DESKTOP_KEY) });

    const res = await client.getOverview();

    expect(res.managedKeyId).toBe('k-other');
    expect(JSON.stringify(res)).not.toContain(DESKTOP_KEY);
  });

  it('reports no managed key when the app has no chat key', async () => {
    stubFetch(overviewRoutes());
    const { client } = makeClient({});

    const res = await client.getOverview();

    expect(res.managedKeyId).toBeNull();
  });

  it('sends every request with an abort signal so a hung server cannot stall the tab', async () => {
    const fetchMock = stubFetch(overviewRoutes());
    const { client } = makeClient({});

    await client.getOverview();

    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.every((c) => (c[1] as RequestInit).signal instanceof AbortSignal)).toBe(true);
  });

  it('never exposes the stored key in the overview payload', async () => {
    stubFetch(overviewRoutes());
    const { client } = makeClient({});

    const res = await client.getOverview();

    expect(JSON.stringify(res)).not.toContain(STORED_KEY);
  });

  it('reports not-signed-in without any request when there is no session', async () => {
    const fetchMock = stubFetch({});
    const { client } = makeClient({ auth: fakeAuth([null]) });

    const res = await client.getOverview();

    expect(res).toMatchObject({ ok: false, reason: 'not-signed-in' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes exactly once when several parallel requests get 401, then retries them', async () => {
    const fetchMock = stubFetch(
      overviewRoutes({
        'GET /api/billing/balance': [{ status: 401 }, { status: 200, body: { balance: 3, plan: 'free' } }],
        'GET /api/usage/stats': [{ status: 401 }, { status: 200, body: STATS_BODY }],
        'GET /api/keys': [{ status: 401 }, { status: 200, body: KEYS_BODY }],
      }),
    );
    const auth = fakeAuth([TOKEN, TOKEN_2]);
    const { client } = makeClient({ auth });

    const res = await client.getOverview();

    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
    expect(res.balance).toBe(3);
    const retried = fetchMock.mock.calls.slice(3).map((c) => (c[1] as RequestInit).headers as Record<string, string>);
    expect(retried.every((h) => h.Authorization === `Bearer ${TOKEN_2}`)).toBe(true);
  });

  it('reports unauthorized when the refresh fails', async () => {
    stubFetch(overviewRoutes({ 'GET /api/keys': { status: 401 } }));
    const auth = fakeAuth([TOKEN], false);
    const { client } = makeClient({ auth });

    const res = await client.getOverview();

    expect(res).toMatchObject({ ok: false, reason: 'unauthorized' });
    expect(auth.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('reports forbidden on 403', async () => {
    stubFetch(overviewRoutes({ 'GET /api/keys': { status: 403 } }));
    const { client } = makeClient({});

    const res = await client.getOverview();

    expect(res).toMatchObject({ ok: false, reason: 'forbidden' });
  });

  it('keeps partial data and reports network when one request throws', async () => {
    stubFetch(overviewRoutes({ 'GET /api/usage/stats': new TypeError('fetch failed') }));
    const { client } = makeClient({});

    const res = await client.getOverview();

    expect(res).toMatchObject({ ok: false, reason: 'network', balance: 9.25, stats: null });
    expect(res.keys).toHaveLength(2);
  });

  it('never logs the token or the stored key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch(overviewRoutes({ 'GET /api/keys': { status: 500, body: { error: `boom ${TOKEN}` } } }));
    const { client } = makeClient({});

    await client.getOverview();

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('status 500');
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(STORED_KEY);
    expect(logged).not.toContain('boom');
  });
});

describe('IzziAccountClient.getRecentUsage', () => {
  it('returns a page of rows with key names resolved and hasMore when the page is full', async () => {
    const usage = Array.from({ length: 20 }, (_, i) => ({
      id: `u${i}`,
      key_id: 'k-app',
      model: 'gpt-6.1-sol',
      input_tokens: 10,
      output_tokens: 5,
      cost: 0.01,
      duration_ms: 900,
      status_code: 200,
      created_at: '2026-10-06T00:00:00Z',
    }));
    const fetchMock = stubFetch({
      'GET /api/usage': { status: 200, body: { usage } },
      'GET /api/keys': { status: 200, body: KEYS_BODY },
    });
    const { client } = makeClient({});

    const res = await client.getRecentUsage(20);

    expect(res.ok).toBe(true);
    expect(res.rows).toHaveLength(20);
    expect(res.rows[0]).toMatchObject({ id: 'u0', keyName: 'Desktop', model: 'gpt-6.1-sol', durationMs: 900, statusCode: 200 });
    expect(res.hasMore).toBe(true);
    const usageUrl = fetchMock.mock.calls.map((c) => c[0]).find((u) => u.includes('/api/usage?'));
    expect(usageUrl).toContain('limit=20');
    expect(usageUrl).toContain('offset=20');
  });

  it('clamps an invalid offset to 0', async () => {
    const fetchMock = stubFetch({
      'GET /api/usage': { status: 200, body: { usage: [] } },
      'GET /api/keys': { status: 200, body: KEYS_BODY },
    });
    const { client } = makeClient({});

    const res = await client.getRecentUsage(-5 as number);

    expect(res.hasMore).toBe(false);
    const usageUrl = fetchMock.mock.calls.map((c) => c[0]).find((u) => u.includes('/api/usage?'));
    expect(usageUrl).toContain('offset=0');
  });

  it('caps a huge offset', async () => {
    const fetchMock = stubFetch({
      'GET /api/usage': { status: 200, body: { usage: [] } },
      'GET /api/keys': { status: 200, body: KEYS_BODY },
    });
    const { client } = makeClient({});

    await client.getRecentUsage(1e12);

    const usageUrl = fetchMock.mock.calls.map((c) => c[0]).find((u) => u.includes('/api/usage?'));
    expect(usageUrl).toMatch(/offset=10000(&|$)/);
  });

  it('stops offering more rows at the offset cap', async () => {
    const usage = Array.from({ length: 20 }, (_, i) => ({ id: `u${i}`, model: 'm', cost: 0, created_at: '2026-10-06T00:00:00Z' }));
    stubFetch({
      'GET /api/usage': { status: 200, body: { usage } },
      'GET /api/keys': { status: 200, body: KEYS_BODY },
    });
    const { client } = makeClient({});

    const res = await client.getRecentUsage(10_000);

    expect(res.ok).toBe(true);
    expect(res.hasMore).toBe(false);
  });
});

describe('IzziAccountClient.createKey', () => {
  it('stores the new key, points the custom provider at izziapi with x-api-key, enables it and returns the key once', async () => {
    const fetchMock = stubFetch({
      'POST /api/keys': { status: 201, body: { key: NEW_KEY, id: 'k-new', name: 'Desktop 2', prefix: 'izzi-...cc22dd' } },
    });
    const secrets = fakeSecrets(null);
    const settings = fakeSettings({ baseUrl: `${IZZI_API_BASE}/v1`, authType: 'bearer', selectedModel: 'gpt-6.1-sol', reasoningEffort: 'high' });
    const { client } = makeClient({ secrets, settings });

    const res = await client.createKey('  Desktop 2  ');

    expect(res).toEqual({ success: true, key: NEW_KEY, id: 'k-new', name: 'Desktop 2', savedLocally: true });
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ name: 'Desktop 2' });
    expect(secrets.setKey).toHaveBeenCalledWith(NEW_KEY);
    expect(settings.saveConfig).toHaveBeenCalledWith({
      baseUrl: `${IZZI_API_BASE}/v1`,
      authType: 'x-api-key',
      selectedModel: 'gpt-6.1-sol',
      reasoningEffort: 'high',
    });
    expect(settings.setEnabled).toHaveBeenCalledWith(true);
  });

  it('defaults the model to izzi-smart when no provider is configured', async () => {
    stubFetch({ 'POST /api/keys': { status: 201, body: { key: NEW_KEY, id: 'k-new', name: 'X' } } });
    const settings = fakeSettings(null);
    const { client } = makeClient({ settings });

    await client.createKey('X');

    expect(settings.saveConfig).toHaveBeenCalledWith({
      baseUrl: `${IZZI_API_BASE}/v1`,
      authType: 'x-api-key',
      selectedModel: 'izzi-smart',
    });
  });

  it('resets the model to izzi-smart when the old provider was not izziapi', async () => {
    stubFetch({ 'POST /api/keys': { status: 201, body: { key: NEW_KEY, id: 'k-new', name: 'X' } } });
    const settings = fakeSettings({ baseUrl: 'https://old.example/v1', authType: 'bearer', selectedModel: 'claude-x' });
    const { client } = makeClient({ settings });

    const res = await client.createKey('X');

    expect(res.success).toBe(true);
    expect(settings.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ selectedModel: 'izzi-smart' }));
  });

  it('still returns the new key when saving it locally fails, flagged savedLocally:false', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch({ 'POST /api/keys': { status: 201, body: { key: NEW_KEY, id: 'k-new', name: 'X' } } });
    const secrets = fakeSecrets(null);
    secrets.setKey.mockImplementation(() => {
      throw new Error('safeStorage unavailable');
    });
    const { client, settings } = makeClient({ secrets });

    const res = await client.createKey('X');

    expect(res).toEqual({ success: true, key: NEW_KEY, id: 'k-new', name: 'X', savedLocally: false });
    expect(settings.setEnabled).not.toHaveBeenCalledWith(true);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).not.toContain(NEW_KEY);
  });

  it('puts the previous key and provider back when saving the new key fails part-way', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch({ 'POST /api/keys': { status: 201, body: { key: NEW_KEY, id: 'k-new', name: 'X' } } });
    const previous: CustomProviderConfig = { baseUrl: 'https://old.example/v1', authType: 'bearer', selectedModel: 'claude-x' };
    const secrets = fakeSecrets(STORED_KEY);
    const settings = fakeSettings(previous);
    settings.isCustomEnabled.mockReturnValue(true);
    settings.saveConfig.mockImplementationOnce(() => {
      throw new Error('db locked');
    });
    const { client } = makeClient({ secrets, settings });

    const res = await client.createKey('X');

    expect(res).toMatchObject({ success: true, savedLocally: false });
    expect(secrets.getKey()).toBe(STORED_KEY);
    expect(settings.saveConfig).toHaveBeenLastCalledWith(previous);
    expect(settings.setEnabled).toHaveBeenLastCalledWith(true);
  });

  it('leaves the custom provider off when the previous provider cannot be restored', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch({ 'POST /api/keys': { status: 201, body: { key: NEW_KEY, id: 'k-new', name: 'X' } } });
    const settings = fakeSettings({ baseUrl: 'https://old.example/v1', authType: 'bearer', selectedModel: 'claude-x' });
    settings.isCustomEnabled.mockReturnValue(true);
    settings.saveConfig.mockImplementation(() => {
      throw new Error('db locked');
    });
    const { client } = makeClient({ settings });

    const res = await client.createKey('X');

    expect(res).toMatchObject({ success: true, savedLocally: false });
    expect(settings.setEnabled).toHaveBeenLastCalledWith(false);
  });

  it('rejects an empty or overlong name without calling the backend', async () => {
    const fetchMock = stubFetch({});
    const { client } = makeClient({});

    const empty = await client.createKey('   ');
    const long = await client.createKey('x'.repeat(65));

    expect(empty.success).toBe(false);
    expect(long.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns fixed Vietnamese text, not backend text, and changes nothing on failure', async () => {
    stubFetch({ 'POST /api/keys': { status: 429, body: { error: 'internal detail' } } });
    const secrets = fakeSecrets(STORED_KEY);
    const settings = fakeSettings(null);
    const { client } = makeClient({ secrets, settings });

    const res = await client.createKey('X');

    expect(res).toEqual({ success: false, error: 'Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại.' });
    expect(secrets.setKey).not.toHaveBeenCalled();
    expect(settings.saveConfig).not.toHaveBeenCalled();
    expect(settings.setEnabled).not.toHaveBeenCalled();
  });

  it('treats a success response without a key as a failure', async () => {
    stubFetch({ 'POST /api/keys': { status: 201, body: { id: 'k-new' } } });
    const secrets = fakeSecrets(null);
    const { client } = makeClient({ secrets });

    const res = await client.createKey('X');

    expect(res.success).toBe(false);
    expect(secrets.setKey).not.toHaveBeenCalled();
  });

  it('asks to sign in when there is no session', async () => {
    const fetchMock = stubFetch({});
    const { client } = makeClient({ auth: fakeAuth([null]) });

    const res = await client.createKey('X');

    expect(res).toEqual({ success: false, error: 'Vui lòng đăng nhập Izzi để quản lý API key.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never logs the new key', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch({ 'POST /api/keys': { status: 500, body: { key: NEW_KEY } } });
    const { client } = makeClient({});

    await client.createKey('X');

    expect(warn.mock.calls.flat().join(' ')).not.toContain(NEW_KEY);
  });
});

describe('IzziAccountClient.revokeKey', () => {
  it('revoking the in-use key deletes the stored key and disables the custom provider', async () => {
    const fetchMock = stubFetch({
      'GET /api/keys': { status: 200, body: KEYS_BODY },
      'DELETE /api/keys/k-app': { status: 200, body: { message: 'Key revoked' } },
    });
    const secrets = fakeSecrets(STORED_KEY);
    const settings = fakeSettings(null);
    const { client } = makeClient({ secrets, settings });

    const res = await client.revokeKey('k-app');

    expect(res).toEqual({ success: true, wasInUse: true, wasManaged: false });
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit).method === 'DELETE')).toBe(true);
    expect(secrets.deleteKey).toHaveBeenCalled();
    expect(settings.setEnabled).toHaveBeenCalledWith(false);
  });

  it('still reports success and turns the provider off when the stored key cannot be deleted', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stubFetch({
      'GET /api/keys': { status: 200, body: KEYS_BODY },
      'DELETE /api/keys/k-app': { status: 200, body: { message: 'Key revoked' } },
    });
    const secrets = fakeSecrets(STORED_KEY);
    secrets.deleteKey.mockImplementation(() => {
      throw new Error('db locked');
    });
    const settings = fakeSettings(null);
    const { client } = makeClient({ secrets, settings });

    const res = await client.revokeKey('k-app');

    expect(res).toEqual({ success: true, wasInUse: true, wasManaged: false });
    expect(settings.setEnabled).toHaveBeenCalledWith(false);
  });

  it('revoking another key leaves the stored key alone', async () => {
    stubFetch({
      'GET /api/keys': { status: 200, body: KEYS_BODY },
      'DELETE /api/keys/k-other': { status: 200, body: {} },
    });
    const secrets = fakeSecrets(STORED_KEY);
    const settings = fakeSettings(null);
    const { client } = makeClient({ secrets, settings });

    const res = await client.revokeKey('k-other');

    expect(res).toEqual({ success: true, wasInUse: false, wasManaged: false });
    expect(secrets.deleteKey).not.toHaveBeenCalled();
    expect(settings.setEnabled).not.toHaveBeenCalled();
  });

  it('revoking the app chat key makes the app forget it so the next chat mints a fresh one', async () => {
    stubFetch({
      'GET /api/keys': { status: 200, body: KEYS_BODY },
      'DELETE /api/keys/k-other': { status: 200, body: {} },
    });
    const auth = fakeAuth([TOKEN], true, DESKTOP_KEY);
    const { client, secrets, settings } = makeClient({ auth });

    const res = await client.revokeKey('k-other');

    expect(res).toEqual({ success: true, wasInUse: false, wasManaged: true });
    expect(auth.forgetDesktopApiKey).toHaveBeenCalledTimes(1);
    expect(secrets.deleteKey).not.toHaveBeenCalled();
    expect(settings.setEnabled).not.toHaveBeenCalled();
  });

  it('does not revoke when it cannot tell whether the key is in use', async () => {
    const fetchMock = stubFetch({ 'GET /api/keys': { status: 500 } });
    const { client } = makeClient({});

    const res = await client.revokeKey('k-app');

    expect(res.success).toBe(false);
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit).method === 'DELETE')).toBe(false);
  });

  it('rejects a malformed id without calling the backend', async () => {
    const fetchMock = stubFetch({});
    const { client } = makeClient({});

    const res = await client.revokeKey('../billing');

    expect(res.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
