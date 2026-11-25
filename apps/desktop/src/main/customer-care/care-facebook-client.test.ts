/**
 * Offline tests for the Care Facebook Page client. `fetch` is injected; no request leaves the process.
 * Invariants: the token only travels in the Authorization header, every response is parsed against an
 * exact allowlist, and failures collapse to bounded codes (404 => unsupported, 5xx/network => unavailable).
 */
import { describe, expect, it, vi } from 'vitest';
import { CARE_FACEBOOK_CALLBACK_TIMEOUT_MS, CareFacebookClient } from './care-facebook-client';
import type { NativeMarketingTokenProvider } from '../marketing/native-marketing-client';

const ORIGIN = 'https://api.izziapi.com';
const ROOT = `${ORIGIN}/api/marketing/care/facebook`;
const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE = '22222222-2222-4222-8222-222222222222';
const CHOICE = '33333333-3333-4333-8333-333333333333';
const PAGE = '105252511858057';
const STATE = 'care-state-0123456789abcdef';
const CODE = 'provider-code-0123456789';
const TOKEN = 'test-supabase-access-token';
const ISO = '2026-11-17T10:00:00.000Z';
const AUTHORIZE_URL = `https://www.facebook.com/v26.0/dialog/oauth?client_id=123&state=${STATE}&scope=pages_show_list`;

function tokens(token: string | null = TOKEN): NativeMarketingTokenProvider {
  return { getAccessToken: async () => token };
}

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function client(response: Response | (() => Promise<Response>), token: string | null = TOKEN) {
  const fetchImpl = vi.fn(async () => (typeof response === 'function' ? response() : response));
  const instance = new CareFacebookClient(tokens(token), { fetchImpl: fetchImpl as unknown as typeof fetch });
  return { instance, fetchImpl };
}

const CONNECTION = {
  pageId: PAGE,
  pageName: 'Đồ Đồng Hồng Hưng',
  status: 'active',
  grantedScopes: ['pages_show_list', 'pages_manage_metadata', 'pages_messaging'],
  missingScopes: [],
  verifiedAt: ISO,
  tokenExpiresAt: null,
};

const PAGES = [
  { pageId: PAGE, name: 'Đồ Đồng Hồng Hưng', eligible: true, reason: 'eligible' },
  { pageId: '1234567890', name: null, eligible: false, reason: 'missing_moderate_task' },
];

const CONNECT_BODY = { success: true, workspaceId: WORKSPACE, state: STATE, expiresAt: ISO, authorizeUrl: AUTHORIZE_URL };
const CALLBACK_BODY = {
  success: true,
  workspaceId: WORKSPACE,
  choiceId: CHOICE,
  expiresAt: ISO,
  grantedScopes: ['pages_show_list'],
  missingScopes: ['pages_messaging'],
  pages: PAGES,
};

describe('CareFacebookClient requests', () => {
  it('sends the session token only in the Authorization header and the workspace only in the body', async () => {
    const { instance, fetchImpl } = client(json(CONNECT_BODY, 201));

    const result = await instance.startConnect(WORKSPACE);

    expect(result).toEqual({ ok: true, value: CONNECT_BODY });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ROOT}/connect`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ workspaceId: WORKSPACE });
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(url).not.toContain(TOKEN);
    expect(String(init.body)).not.toContain(TOKEN);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('uses the contract paths and bodies for callback, select, status and disconnect', async () => {
    const { instance: a, fetchImpl: fa } = client(json(CALLBACK_BODY));
    await a.completeCallback(WORKSPACE, STATE, CODE);
    expect(fa.mock.calls[0][0]).toBe(`${ROOT}/callback`);
    expect(JSON.parse(String((fa.mock.calls[0] as unknown as [string, RequestInit])[1].body)))
      .toEqual({ workspaceId: WORKSPACE, state: STATE, code: CODE, clientVersion: 2 });

    const { instance: b, fetchImpl: fb } = client(json({ success: true, workspaceId: WORKSPACE, connection: CONNECTION }));
    await b.selectPage(WORKSPACE, CHOICE, PAGE);
    expect(fb.mock.calls[0][0]).toBe(`${ROOT}/select`);
    expect(JSON.parse(String((fb.mock.calls[0] as unknown as [string, RequestInit])[1].body)))
      .toEqual({ workspaceId: WORKSPACE, choiceId: CHOICE, pageId: PAGE });

    const { instance: c, fetchImpl: fc } = client(json({
      success: true, workspaceId: WORKSPACE, requiredScopes: ['pages_messaging'], connection: null, crmPages: [],
    }));
    await c.getStatus(WORKSPACE);
    expect(fc.mock.calls[0][0]).toBe(`${ROOT}/status?workspaceId=${WORKSPACE}&include=crmPages`);
    expect((fc.mock.calls[0] as unknown as [string, RequestInit])[1].method ?? 'GET').toBe('GET');

    const { instance: d, fetchImpl: fd } = client(json({ success: true, workspaceId: WORKSPACE, connection: null }));
    await d.disconnect(WORKSPACE);
    expect(fd.mock.calls[0][0]).toBe(`${ROOT}?workspaceId=${WORKSPACE}`);
    expect((fd.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe('DELETE');
  });

  it('rejects malformed inputs locally without any request', async () => {
    const { instance, fetchImpl } = client(json(CONNECT_BODY));

    expect(await instance.startConnect('not-a-uuid')).toEqual({ ok: false, error: 'rejected', reason: 'invalid_request' });
    expect((await instance.completeCallback(WORKSPACE, 'short', CODE)).ok).toBe(false);
    expect((await instance.completeCallback(WORKSPACE, STATE, 'bad code with spaces')).ok).toBe(false);
    expect((await instance.selectPage(WORKSPACE, 'not-a-uuid', PAGE)).ok).toBe(false);
    for (const pageId of ['1234', 'abc12345', '1'.repeat(31), ` ${PAGE}`]) {
      expect((await instance.selectPage(WORKSPACE, CHOICE, pageId)).ok).toBe(false);
    }
    expect((await instance.getStatus('../other')).ok).toBe(false);
    expect((await instance.disconnect('')).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed without a reviewed origin or a session token', async () => {
    const fetchImpl = vi.fn();
    const unreviewed = new CareFacebookClient(tokens(), {
      baseUrl: 'https://evil.example.com', fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(await unreviewed.getStatus(WORKSPACE)).toEqual({ ok: false, error: 'not_configured' });

    const { instance, fetchImpl: signedOut } = client(json(CONNECT_BODY), null);
    expect(await instance.startConnect(WORKSPACE)).toEqual({ ok: false, error: 'auth' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(signedOut).not.toHaveBeenCalled();
  });
});

describe('CareFacebookClient failure mapping', () => {
  it.each([
    [404, { success: false, error: 'Not Found' }, { ok: false, error: 'unsupported' }],
    [401, { success: false, error: 'Unauthorized' }, { ok: false, error: 'auth' }],
    [403, { success: false, error: 'Workspace not accessible', reason: 'forbidden' }, { ok: false, error: 'forbidden' }],
    [500, { success: false, error: 'x' }, { ok: false, error: 'unavailable' }],
    [502, { success: false, error: 'x', reason: 'provider_unavailable' }, { ok: false, error: 'unavailable' }],
    [502, { success: false, error: 'x', reason: 'provider_timeout' }, { ok: false, error: 'unavailable' }],
    // Facebook refused the grant itself: retrying later will not help, so this is not "check the network".
    [502, { success: false, error: 'x', reason: 'provider_rejected' }, { ok: false, error: 'rejected' }],
    [429, { success: false, error: 'Too Many Requests' }, { ok: false, error: 'unavailable' }],
    [413, { success: false, error: 'Payload Too Large' }, { ok: false, error: 'rejected' }],
    // Facebook answered, but the token does not prove this Page: re-auth helps, retrying later does not.
    [502, { success: false, error: 'x', reason: 'token_page_mismatch' }, { ok: false, error: 'rejected', reason: 'token_page_mismatch' }],
    [502, { success: false, error: 'x', reason: 'token_invalid' }, { ok: false, error: 'rejected', reason: 'token_invalid' }],
    [502, { success: false, error: 'x', reason: 'token_app_mismatch' }, { ok: false, error: 'rejected', reason: 'token_app_mismatch' }],
    [503, { success: false, error: 'x', reason: 'not_persisted' }, { ok: false, error: 'unavailable' }],
    [503, { success: false, error: 'x', reason: 'not_configured' }, { ok: false, error: 'not_configured' }],
    [503, { success: false, error: 'x', reason: 'redirect_relay_incompatible' }, { ok: false, error: 'not_configured' }],
    [409, { success: false, error: 'x', reason: 'page_bound_elsewhere' }, { ok: false, error: 'page_bound_elsewhere' }],
    [422, { success: false, error: 'x', reason: 'no_pages' }, { ok: false, error: 'no_pages' }],
    [400, { success: false, error: 'x', reason: 'choice_expired' }, { ok: false, error: 'rejected', reason: 'choice_expired' }],
    [400, { success: false, error: 'x', reason: 'made_up_reason' }, { ok: false, error: 'rejected' }],
    [400, 'not json', { ok: false, error: 'rejected' }],
  ])('maps HTTP %i %j to a bounded code', async (status, body, expected) => {
    const { instance } = client(json(body, status));
    expect(await instance.getStatus(WORKSPACE)).toEqual(expected);
  });

  it('maps network failures and timeouts to unavailable', async () => {
    const { instance } = client(async () => { throw new TypeError('fetch failed: secret detail'); });
    expect(await instance.getStatus(WORKSPACE)).toEqual({ ok: false, error: 'unavailable' });

    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }));
      const slow = new CareFacebookClient(tokens(), { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 1_000 });
      const pending = slow.getStatus(WORKSPACE);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await pending).toEqual({ ok: false, error: 'unavailable' });
    } finally {
      vi.useRealTimers();
    }
  });

  // The callback exchanges the code and reads every Graph page of the
  // merchant's Pages (up to 100), so it gets a longer budget than other calls.
  it('gives the callback a longer budget than the default timeout', async () => {
    expect(CARE_FACEBOOK_CALLBACK_TIMEOUT_MS).toBe(30_000);
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }));
      const slow = new CareFacebookClient(tokens(), { fetchImpl: fetchImpl as unknown as typeof fetch, timeoutMs: 1_000 });
      let settled = false;
      const pending = slow.completeCallback(WORKSPACE, STATE, CODE).then((result) => {
        settled = true;
        return result;
      });
      await vi.advanceTimersByTimeAsync(CARE_FACEBOOK_CALLBACK_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({ ok: false, error: 'unavailable' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats an unreadable success body as an invalid response', async () => {
    const { instance } = client({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } } as unknown as Response);
    expect(await instance.getStatus(WORKSPACE)).toEqual({ ok: false, error: 'invalid-response' });
  });
});

describe('CareFacebookClient strict response parsing', () => {
  async function connectWith(body: unknown) {
    return client(json(body, 201)).instance.startConnect(WORKSPACE);
  }

  it('rejects connect responses with extra or missing keys, a foreign workspace or bad values', async () => {
    const invalid = { ok: false, error: 'invalid-response' };
    expect(await connectWith({ ...CONNECT_BODY, accessToken: 'EAAB' })).toEqual(invalid);
    const { authorizeUrl: _omit, ...missing } = CONNECT_BODY;
    expect(await connectWith(missing)).toEqual(invalid);
    expect(await connectWith({ ...CONNECT_BODY, success: 'true' })).toEqual(invalid);
    expect(await connectWith({ ...CONNECT_BODY, workspaceId: OTHER_WORKSPACE })).toEqual(invalid);
    expect(await connectWith({ ...CONNECT_BODY, state: 'x' })).toEqual(invalid);
    expect(await connectWith({ ...CONNECT_BODY, expiresAt: 'tomorrow' })).toEqual(invalid);
    expect(await connectWith([CONNECT_BODY])).toEqual(invalid);
  });

  it.each([
    ['http scheme', AUTHORIZE_URL.replace('https:', 'http:')],
    ['foreign host', AUTHORIZE_URL.replace('www.facebook.com', 'www.facebook.com.evil.example')],
    ['m.facebook host', AUTHORIZE_URL.replace('www.facebook.com', 'm.facebook.com')],
    ['non-dialog path', AUTHORIZE_URL.replace('/dialog/oauth', '/login.php')],
    ['credentials', AUTHORIZE_URL.replace('https://', 'https://user:pw@')],
    ['explicit port', AUTHORIZE_URL.replace('www.facebook.com', 'www.facebook.com:8443')],
    ['fragment', `${AUTHORIZE_URL}#x`],
    ['different state', AUTHORIZE_URL.replace(STATE, 'another-state-0123456789')],
    ['client secret', `${AUTHORIZE_URL}&client_secret=s`],
    ['not a url', 'javascript:alert(1)'],
  ])('rejects a non-Facebook authorize URL (%s)', async (_label, authorizeUrl) => {
    expect(await connectWith({ ...CONNECT_BODY, authorizeUrl })).toEqual({ ok: false, error: 'invalid-response' });
  });

  it('accepts the unversioned dialog path', async () => {
    const authorizeUrl = `https://www.facebook.com/dialog/oauth?state=${STATE}`;
    expect((await connectWith({ ...CONNECT_BODY, authorizeUrl })).ok).toBe(true);
  });

  async function callbackWith(body: unknown) {
    return client(json(body)).instance.completeCallback(WORKSPACE, STATE, CODE);
  }

  it('parses the Page choices exactly and never forwards extra provider material', async () => {
    expect(await callbackWith(CALLBACK_BODY)).toEqual({ ok: true, value: CALLBACK_BODY });

    const invalid = { ok: false, error: 'invalid-response' };
    expect(await callbackWith({ ...CALLBACK_BODY, pages: [{ ...PAGES[0], accessToken: 'EAAB' }] })).toEqual(invalid);
    expect(await callbackWith({ ...CALLBACK_BODY, pages: [{ pageId: PAGE, name: 'x', eligible: true }] })).toEqual(invalid);
    expect(await callbackWith({ ...CALLBACK_BODY, userToken: 'EAAB' })).toEqual(invalid);
    expect(await callbackWith({ ...CALLBACK_BODY, choiceId: 'choice-1' })).toEqual(invalid);
    expect(await callbackWith({ ...CALLBACK_BODY, workspaceId: OTHER_WORKSPACE })).toEqual(invalid);
  });

  it.each([
    ['short page id', [{ ...PAGES[0], pageId: '1234' }]],
    ['non-digit page id', [{ ...PAGES[0], pageId: '12345abc' }]],
    ['31-digit page id', [{ ...PAGES[0], pageId: '1'.repeat(31) }]],
    ['numeric page id', [{ ...PAGES[0], pageId: 105252511858057 }]],
    ['duplicate page', [PAGES[0], PAGES[0]]],
    ['unknown reason', [{ ...PAGES[0], reason: 'admin' }]],
    ['eligible with an ineligible reason', [{ ...PAGES[0], eligible: true, reason: 'missing_page_token' }]],
    ['ineligible with the eligible reason', [{ ...PAGES[0], eligible: false, reason: 'eligible' }]],
    ['control characters in the name', [{ ...PAGES[0], name: `Shop${String.fromCharCode(0x202e)}evil` }]],
    ['oversized name', [{ ...PAGES[0], name: 'x'.repeat(201) }]],
    ['more than 100 pages', Array.from({ length: 101 }, (_, index) => ({ ...PAGES[0], pageId: String(10_000 + index) }))],
  ])('rejects Page choices with %s', async (_label, pages) => {
    expect(await callbackWith({ ...CALLBACK_BODY, pages })).toEqual({ ok: false, error: 'invalid-response' });
  });

  // Merchants with many Pages (their own plus Business portfolios') get up to 100.
  it('accepts exactly 100 pages', async () => {
    const pages = Array.from({ length: 100 }, (_, index) => ({ ...PAGES[0], pageId: String(10_000 + index) }));
    const result = await callbackWith({ ...CALLBACK_BODY, pages });
    expect(result.ok && result.value.pages).toHaveLength(100);
  });

  it.each([
    ['upper-case scope', ['Pages_Messaging']],
    ['short scope', ['ab']],
    ['scope with a token', ['access_token=EAAB']],
    ['non-string scope', [42]],
  ])('rejects scope lists with %s', async (_label, scopes) => {
    expect(await callbackWith({ ...CALLBACK_BODY, grantedScopes: scopes })).toEqual({ ok: false, error: 'invalid-response' });
    expect(await callbackWith({ ...CALLBACK_BODY, missingScopes: scopes })).toEqual({ ok: false, error: 'invalid-response' });
  });

  it('parses the connection and requires it to be the selected Page', async () => {
    const ok = client(json({ success: true, workspaceId: WORKSPACE, connection: CONNECTION }));
    expect(await ok.instance.selectPage(WORKSPACE, CHOICE, PAGE)).toEqual({ ok: true, value: CONNECTION });

    const other = client(json({ success: true, workspaceId: WORKSPACE, connection: { ...CONNECTION, pageId: '1234567890' } }));
    expect(await other.instance.selectPage(WORKSPACE, CHOICE, PAGE)).toEqual({ ok: false, error: 'invalid-response' });

    const missing = client(json({ success: true, workspaceId: WORKSPACE, connection: null }));
    expect(await missing.instance.selectPage(WORKSPACE, CHOICE, PAGE)).toEqual({ ok: false, error: 'invalid-response' });
  });

  it.each([
    ['extra connection key', { ...CONNECTION, pageAccessToken: 'EAAB' }],
    ['unknown status', { ...CONNECTION, status: 'disconnected' }],
    ['bad verifiedAt', { ...CONNECTION, verifiedAt: 'yesterday' }],
    ['bad tokenExpiresAt', { ...CONNECTION, tokenExpiresAt: 0 }],
    ['missing scopes key', (({ missingScopes: _m, ...rest }) => rest)(CONNECTION)],
  ])('rejects a status connection with %s', async (_label, connection) => {
    const { instance } = client(json({ success: true, workspaceId: WORKSPACE, requiredScopes: [], connection }));
    expect(await instance.getStatus(WORKSPACE)).toEqual({ ok: false, error: 'invalid-response' });
  });

  it('parses status with and without a connection, including v2 crmPages and 400 fallback', async () => {
    const crmPages = [
      { pageId: '631891669999823', pageName: 'Xưởng tranh đồng Đại Long', verifiedAt: ISO },
      { pageId: '741891669999824', pageName: 'Đồ đồng Đại Long', verifiedAt: ISO },
    ];
    const connectedV2 = {
      success: true,
      workspaceId: WORKSPACE,
      requiredScopes: ['pages_messaging'],
      connection: { ...CONNECTION, status: 'needs_reauth', tokenExpiresAt: ISO },
      crmPages,
    };
    expect(await client(json(connectedV2)).instance.getStatus(WORKSPACE)).toEqual({ ok: true, value: connectedV2 });

    // 4-key response (server ignored include=crmPages) defaults crmPages to []
    const noneV1 = { success: true, workspaceId: WORKSPACE, requiredScopes: [], connection: null };
    expect(await client(json(noneV1)).instance.getStatus(WORKSPACE)).toEqual({
      ok: true,
      value: { ...noneV1, crmPages: [] },
    });
    expect(await client(json({ ...noneV1, extra: 1 })).instance.getStatus(WORKSPACE)).toEqual({ ok: false, error: 'invalid-response' });

    // Older server rejecting ?include=crmPages with HTTP 400 falls back to plain /status?workspaceId=...
    const fallbackFetch = vi.fn()
      .mockResolvedValueOnce(json({ success: false, error: 'Invalid query', reason: 'invalid_request' }, 400))
      .mockResolvedValueOnce(json({ success: true, workspaceId: WORKSPACE, requiredScopes: ['pages_messaging'], connection: CONNECTION }));
    const fallbackClient = new CareFacebookClient(tokens(), { fetchImpl: fallbackFetch as unknown as typeof fetch });
    expect(await fallbackClient.getStatus(WORKSPACE)).toEqual({
      ok: true,
      value: { success: true, workspaceId: WORKSPACE, requiredScopes: ['pages_messaging'], connection: CONNECTION, crmPages: [] },
    });
    expect(fallbackFetch.mock.calls.map((c) => c[0])).toEqual([
      `${ROOT}/status?workspaceId=${WORKSPACE}&include=crmPages`,
      `${ROOT}/status?workspaceId=${WORKSPACE}`,
    ]);

    // Malformed crmPages on include=crmPages also falls back safely to plain /status, while extra token key is rejected
    const badCrmFetch = vi.fn()
      .mockResolvedValueOnce(json({ ...connectedV2, crmPages: [{ pageId: '631891669999823', pageName: 'X', verifiedAt: ISO, pageToken: 'EAAB' }] }))
      .mockResolvedValueOnce(json({ success: true, workspaceId: WORKSPACE, requiredScopes: ['pages_messaging'], connection: CONNECTION }));
    const badCrmClient = new CareFacebookClient(tokens(), { fetchImpl: badCrmFetch as unknown as typeof fetch });
    expect(await badCrmClient.getStatus(WORKSPACE)).toEqual({
      ok: true,
      value: { success: true, workspaceId: WORKSPACE, requiredScopes: ['pages_messaging'], connection: CONNECTION, crmPages: [] },
    });
  });

  it('parses callback v2 missing_messaging_scope reason and 5-key v2 envelope', async () => {
    const v2Pages = [
      { pageId: PAGE, name: 'Đồng Thờ Hồng Hưng', eligible: true, reason: 'eligible' },
      { pageId: '631891669999823', name: 'Xưởng tranh đồng Đại Long', eligible: false, reason: 'missing_messaging_scope' },
      { pageId: '741891669999824', name: 'Đồ đồng Đại Long', eligible: false, reason: 'missing_messaging_scope' },
    ];
    const fiveKeyBody = {
      success: true,
      choiceId: CHOICE,
      expiresAt: ISO,
      missingScopes: [],
      pages: v2Pages,
    };
    const { instance } = client(json(fiveKeyBody));
    expect(await instance.completeCallback(WORKSPACE, STATE, CODE)).toEqual({
      ok: true,
      value: {
        success: true,
        workspaceId: WORKSPACE,
        choiceId: CHOICE,
        expiresAt: ISO,
        grantedScopes: [],
        missingScopes: [],
        pages: v2Pages,
      },
    });

    // Rejects eligible: true paired with missing_messaging_scope
    expect(await client(json({
      ...fiveKeyBody,
      pages: [{ pageId: '631891669999823', name: 'X', eligible: true, reason: 'missing_messaging_scope' }],
    })).instance.completeCallback(WORKSPACE, STATE, CODE)).toEqual({ ok: false, error: 'invalid-response' });
  });

  it('requires disconnect to answer with a null connection', async () => {
    const done = client(json({ success: true, workspaceId: WORKSPACE, connection: null }));
    expect(await done.instance.disconnect(WORKSPACE)).toEqual({ ok: true, value: null });
    const stale = client(json({ success: true, workspaceId: WORKSPACE, connection: CONNECTION }));
    expect(await stale.instance.disconnect(WORKSPACE)).toEqual({ ok: false, error: 'invalid-response' });
  });

  it('supports multi-Page backfill on selectPage (importOnly, backfillPageIds, includeCrmPages, skippedPages & crmPages) with 30s timeout', async () => {
    const page2 = '631891669999823';
    const page3 = '741891669999824';
    const backfill = {
      pagesProcessed: 1,
      conversationsScanned: 84,
      leadsImported: 19,
      messagesStored: 47,
      namesSealed: 18,
      skippedPages: [
        { pageId: page2, pageName: 'Xưởng tranh đồng Đại Long', reason: 'permission_missing' as const },
        { pageId: page3, pageName: 'Đồ đồng Đại Long', reason: 'token_invalid' as const },
      ],
    };
    const crmPages = [{ pageId: page2, pageName: 'Xưởng tranh đồng Đại Long', verifiedAt: ISO }];
    const { instance, fetchImpl } = client(json({
      success: true,
      workspaceId: WORKSPACE,
      connection: CONNECTION,
      backfill,
      crmPages,
    }));

    const res = await instance.selectPage(WORKSPACE, CHOICE, PAGE, {
      backfillPageIds: [PAGE, page2, page3],
      importOnly: true,
    });
    expect(res).toEqual({ ok: true, value: { connection: CONNECTION, backfill, crmPages } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ROOT}/select`);
    expect(JSON.parse(String(init.body))).toEqual({
      workspaceId: WORKSPACE,
      choiceId: CHOICE,
      pageId: PAGE,
      backfillPageIds: [PAGE, page2, page3],
      importOnly: true,
      includeCrmPages: true,
      async: true,
    });

    // Also accepts 4-key response without crmPages for backwards compatibility
    const v1Select = client(json({
      success: true,
      workspaceId: WORKSPACE,
      connection: CONNECTION,
      backfill: { pagesProcessed: 3, conversationsScanned: 84, leadsImported: 19, messagesStored: 47, namesSealed: 18 },
    }));
    expect((await v1Select.instance.selectPage(WORKSPACE, CHOICE, PAGE, { backfillPageIds: [PAGE], importOnly: true })).ok).toBe(true);

    // Rejects unknown skippedPages reason or extra keys in backfill summary
    const badSkipped = client(json({
      success: true,
      workspaceId: WORKSPACE,
      connection: CONNECTION,
      backfill: { ...backfill, skippedPages: [{ pageId: page2, pageName: 'X', reason: 'unknown_reason' }] },
    }));
    expect(await badSkipped.instance.selectPage(WORKSPACE, CHOICE, PAGE, { backfillPageIds: [PAGE] }))
      .toEqual({ ok: false, error: 'invalid-response' });

    const badExtra = client(json({
      success: true,
      workspaceId: WORKSPACE,
      connection: CONNECTION,
      backfill: { ...backfill, rawToken: 'EAAB' },
    }));
    expect(await badExtra.instance.selectPage(WORKSPACE, CHOICE, PAGE, { backfillPageIds: [PAGE] }))
      .toEqual({ ok: false, error: 'invalid-response' });

    // Rejects duplicate or empty backfillPageIds locally without sending a request
    const local = client(json({}));
    expect(await local.instance.selectPage(WORKSPACE, CHOICE, PAGE, { backfillPageIds: [] }))
      .toEqual({ ok: false, error: 'rejected', reason: 'invalid_request' });
    expect(await local.instance.selectPage(WORKSPACE, CHOICE, PAGE, { backfillPageIds: [PAGE, PAGE] }))
      .toEqual({ ok: false, error: 'rejected', reason: 'invalid_request' });
    expect(local.fetchImpl).not.toHaveBeenCalled();
  });

  it('calls POST /backfill with includeCrmPages: true and parses both 3-key and 4-key envelopes with skippedPages', async () => {
    const backfill = {
      pagesProcessed: 2,
      conversationsScanned: 42,
      leadsImported: 11,
      messagesStored: 29,
      namesSealed: 11,
      skippedPages: [
        { pageId: '741891669999824', pageName: 'Đồ đồng Đại Long', reason: 'bound_elsewhere' as const },
      ],
    };
    const crmPages = [{ pageId: '631891669999823', pageName: 'Xưởng tranh đồng Đại Long', verifiedAt: ISO }];
    const { instance, fetchImpl } = client(json({
      success: true,
      workspaceId: WORKSPACE,
      backfill,
      crmPages,
    }));
    expect(await instance.backfillBoundPage(WORKSPACE)).toEqual({ ok: true, value: { ...backfill, crmPages } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${ROOT}/backfill`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ workspaceId: WORKSPACE, includeCrmPages: true, async: true });

    // 3-key backward-compatible envelope
    const threeKey = client(json({ success: true, workspaceId: WORKSPACE, backfill }));
    expect(await threeKey.instance.backfillBoundPage(WORKSPACE)).toEqual({ ok: true, value: backfill });

    expect(await instance.backfillBoundPage('not-a-uuid'))
      .toEqual({ ok: false, error: 'rejected', reason: 'invalid_request' });
    expect(await client(json({ success: true, workspaceId: WORKSPACE, backfill: { ...backfill, extra: 1 } })).instance.backfillBoundPage(WORKSPACE))
      .toEqual({ ok: false, error: 'invalid-response' });
  });

  it('supports Contract v3 async backfillJob on POST /select, POST /backfill, GET /backfill, and legacy 400 fallback', async () => {
    const runningJob = {
      status: 'running' as const,
      startedAt: ISO,
      updatedAt: ISO,
      completedAt: null,
      pagesTotal: 3,
      pagesProcessed: 1,
      conversationsScanned: 512,
      leadsImported: 157,
      messagesStored: 410,
      namesSealed: 155,
      skippedPages: [],
    };
    const completedJob = {
      status: 'completed' as const,
      startedAt: ISO,
      updatedAt: ISO,
      completedAt: ISO,
      pagesTotal: 3,
      pagesProcessed: 3,
      conversationsScanned: 4256,
      leadsImported: 831,
      messagesStored: 2180,
      namesSealed: 829,
      skippedPages: [
        { pageId: '741891669999824', pageName: 'Đồ đồng Đại Long', reason: 'provider_error' as const },
      ],
    };
    const crmPages = [
      { pageId: '631891669999823', pageName: 'Xưởng tranh đồng Đại Long Nam Định', verifiedAt: ISO },
      { pageId: '741891669999824', pageName: 'Đồ Đồng Đại Long', verifiedAt: ISO },
    ];
    const zeroBackfill = { pagesProcessed: 0, conversationsScanned: 0, leadsImported: 0, messagesStored: 0, namesSealed: 0 };

    // 6-key v3 POST /select response with backfillJob
    const selectV3 = client(json({
      success: true,
      workspaceId: WORKSPACE,
      connection: CONNECTION,
      backfill: zeroBackfill,
      crmPages,
      backfillJob: runningJob,
    }));
    expect(await selectV3.instance.selectPage(WORKSPACE, CHOICE, PAGE, {
      backfillPageIds: [PAGE, '631891669999823', '741891669999824'],
      importOnly: true,
    })).toEqual({
      ok: true,
      value: { connection: CONNECTION, backfill: zeroBackfill, crmPages, backfillJob: runningJob },
    });

    // 5-key v3 POST /backfill response with backfillJob
    const backfillV3 = client(json({
      success: true,
      workspaceId: WORKSPACE,
      backfill: zeroBackfill,
      crmPages,
      backfillJob: runningJob,
    }));
    expect(await backfillV3.instance.backfillBoundPage(WORKSPACE)).toEqual({
      ok: true,
      value: { ...zeroBackfill, crmPages, backfillJob: runningJob },
    });

    // 3-key v3 GET /backfill polling response
    const pollV3 = client(json({
      success: true,
      workspaceId: WORKSPACE,
      job: completedJob,
    }));
    expect(await pollV3.instance.getBackfillStatus(WORKSPACE)).toEqual({ ok: true, value: completedJob });
    expect(pollV3.fetchImpl.mock.calls[0][0]).toBe(`${ROOT}/backfill?workspaceId=${WORKSPACE}`);
    expect((pollV3.fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].method ?? 'GET').toBe('GET');

    // Rejects malformed GET /backfill inputs or extra/invalid keys
    expect(await pollV3.instance.getBackfillStatus('bad-uuid')).toEqual({
      ok: false,
      error: 'rejected',
      reason: 'invalid_request',
    });
    expect(await client(json({
      success: true,
      workspaceId: WORKSPACE,
      job: { ...completedJob, rawToken: 'EAAB' },
    })).instance.getBackfillStatus(WORKSPACE)).toEqual({ ok: false, error: 'invalid-response' });
    expect(await client(json({
      success: true,
      workspaceId: WORKSPACE,
      job: { ...completedJob, status: 'queued' },
    })).instance.getBackfillStatus(WORKSPACE)).toEqual({ ok: false, error: 'invalid-response' });
    expect(await client(json({
      success: true,
      workspaceId: OTHER_WORKSPACE,
      job: completedJob,
    })).instance.getBackfillStatus(WORKSPACE)).toEqual({ ok: false, error: 'invalid-response' });

    // Legacy pre-v3 server rejecting async: true with 400 invalid_request falls back cleanly without async: true
    const legacyBackfillFetch = vi.fn()
      .mockResolvedValueOnce(json({ success: false, error: 'Unknown key async', reason: 'invalid_request' }, 400))
      .mockResolvedValueOnce(json({ success: true, workspaceId: WORKSPACE, backfill: zeroBackfill, crmPages }));
    const legacyBackfillClient = new CareFacebookClient(tokens(), { fetchImpl: legacyBackfillFetch as unknown as typeof fetch });
    expect(await legacyBackfillClient.backfillBoundPage(WORKSPACE)).toEqual({
      ok: true,
      value: { ...zeroBackfill, crmPages },
    });
    expect(legacyBackfillFetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((legacyBackfillFetch.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({
      workspaceId: WORKSPACE,
      includeCrmPages: true,
    });
  });
});
