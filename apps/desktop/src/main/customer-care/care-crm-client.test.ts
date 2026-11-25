/**
 * Offline tests for the Care CRM routes (S2). `fetch` is injected; no request leaves the machine.
 * Invariants: contract paths and bodies, the token only in the Authorization header, answers rebuilt from
 * exact allowlists, a 409 profile_conflict carrying the current row, bounded failure codes, and logs that
 * hold only a route label and a status.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomerCareCrmProfileInput } from '../../shared/customer-care-types';
import type { NativeMarketingTokenProvider } from '../marketing/native-marketing-client';
import { CareCrmClient } from './care-crm-client';

const ROOT = 'https://api.izziapi.com/api/marketing/care/facebook';
const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE = '22222222-2222-4222-8222-222222222222';
const LEAD_ID = '44444444-4444-4444-8444-444444444444';
const OWNER_ID = '66666666-6666-4666-8666-666666666666';
const TOKEN = 'test-supabase-access-token';
const ISO = '2026-11-20T10:00:00.000Z';
const UPDATED = '2026-11-21T09:30:00.123+00:00';
const PHONE = '0901234567';
const NAME = 'Nguyễn Thị Hoa';
const NOTE = 'Nhà mới ở Thủ Đức';

const PROFILE: CustomerCareCrmProfileInput = {
  stage: 'consulting',
  ownerUserId: OWNER_ID,
  addressForm: 'chi',
  occasion: 'new_home',
  neededBy: '2026-12-20',
  productFactIds: ['ban-tho-127'],
  nextStep: 'Gọi lại báo giá',
  nextStepDueAt: '2026-11-25T02:00:00.000Z',
  lostReason: null,
  purchasedAt: null,
  note: NOTE,
};

const ROW = {
  leadId: LEAD_ID,
  pageId: '105252511858057',
  customerName: NAME,
  phone: PHONE,
  zaloMentioned: false,
  leadStatus: 'contacted',
  phoneCapturedAt: ISO,
  lastMessageAt: ISO,
  recentMessages: [{ text: `Số em ${PHONE}`, at: ISO }],
  profile: { ...PROFILE, updatedAt: UPDATED, updatedBy: OWNER_ID },
};

const LIST_BODY = {
  success: true,
  workspaceId: WORKSPACE,
  role: 'owner',
  canDelete: true,
  rows: [ROW],
  nextCursor: null,
  assignees: [{ userId: OWNER_ID, label: 'Lan' }],
};

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function client(response: Response | (() => Promise<Response>), options: { baseUrl?: string } = {}) {
  const fetchImpl = vi.fn(typeof response === 'function' ? response : async () => response);
  const tokens: NativeMarketingTokenProvider = { getAccessToken: async () => TOKEN };
  return {
    instance: new CareCrmClient(tokens, { fetchImpl: fetchImpl as unknown as typeof fetch, ...options }),
    fetchImpl,
  };
}

function call(fetchImpl: ReturnType<typeof vi.fn>, index = 0): [string, RequestInit] {
  return fetchImpl.mock.calls[index] as unknown as [string, RequestInit];
}

const saveInput = (expectedUpdatedAt: string | null = UPDATED) => ({ leadId: LEAD_ID, expectedUpdatedAt, profile: PROFILE });

afterEach(() => vi.restoreAllMocks());

describe('CareCrmClient GET /crm', () => {
  it('reads one page for the workspace with the token in the header only', async () => {
    const { instance, fetchImpl } = client(json(LIST_BODY));
    const result = await instance.listCrm(WORKSPACE, null);
    expect(result).toEqual({
      ok: true,
      value: { role: 'owner', canDelete: true, rows: [ROW], nextCursor: null, assignees: LIST_BODY.assignees, identityEnabled: null,
        identityUnavailable: false, consentAsk: null },
    });
    const [url, init] = call(fetchImpl);
    expect(url).toBe(`${ROOT}/crm?workspaceId=${WORKSPACE}&include=identity,pages`);
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(url).not.toContain(TOKEN);
  });

  it('passes the opaque cursor encoded', async () => {
    const { instance, fetchImpl } = client(json(LIST_BODY));
    await instance.listCrm(WORKSPACE, 'crm_2026-11-20T10:00:00Z|abc');
    expect(call(fetchImpl)[0]).toBe(`${ROOT}/crm?workspaceId=${WORKSPACE}&include=identity,pages&cursor=crm_2026-11-20T10%3A00%3A00Z%7Cabc`);
  });

  it('rejects an answer for another workspace or with an invalid row', async () => {
    expect(await client(json({ ...LIST_BODY, workspaceId: OTHER_WORKSPACE })).instance.listCrm(WORKSPACE, null))
      .toEqual({ ok: false, error: 'invalid-response' });
    expect(await client(json({ ...LIST_BODY, rows: [{ ...ROW, phone: '123' }] })).instance.listCrm(WORKSPACE, null))
      .toEqual({ ok: false, error: 'invalid-response' });
  });

  it('refuses bad arguments without a request', async () => {
    const { instance, fetchImpl } = client(json(LIST_BODY));
    expect(await instance.listCrm('not-a-uuid', null)).toEqual({ ok: false, error: 'rejected', reason: 'invalid_request' });
    expect(await instance.listCrm(WORKSPACE, 'has space')).toEqual({ ok: false, error: 'rejected', reason: 'invalid_request' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('CareCrmClient POST /crm/profile', () => {
  it('sends the full replace with the expected updatedAt and returns the saved row', async () => {
    const { instance, fetchImpl } = client(json({ success: true, workspaceId: WORKSPACE, row: ROW }));
    expect(await instance.saveCrmProfile(WORKSPACE, saveInput())).toEqual({ ok: true, value: { kind: 'saved', leadId: LEAD_ID, profile: ROW.profile } });
    const [url, init] = call(fetchImpl);
    expect(url).toBe(`${ROOT}/crm/profile`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      workspaceId: WORKSPACE, leadId: LEAD_ID, expectedUpdatedAt: UPDATED, profile: PROFILE,
    });
  });

  it('sends null for a first save', async () => {
    const { instance, fetchImpl } = client(json({ success: true, workspaceId: WORKSPACE, row: ROW }));
    await instance.saveCrmProfile(WORKSPACE, saveInput(null));
    expect(JSON.parse(call(fetchImpl)[1].body as string).expectedUpdatedAt).toBeNull();
  });

  it('sends every one of the 11 profile keys, with null for an empty field, never leaving a key out', async () => {
    const { instance, fetchImpl } = client(json({ success: true, workspaceId: WORKSPACE, row: ROW }));
    const empty: CustomerCareCrmProfileInput = {
      stage: 'has_phone', ownerUserId: null, addressForm: null, occasion: null, neededBy: null, productFactIds: [],
      nextStep: null, nextStepDueAt: null, lostReason: null, purchasedAt: null, note: null,
    };
    await instance.saveCrmProfile(WORKSPACE, { leadId: LEAD_ID, expectedUpdatedAt: null, profile: empty });
    const body = JSON.parse(call(fetchImpl)[1].body as string);
    expect(Object.keys(body).sort()).toEqual(['expectedUpdatedAt', 'leadId', 'profile', 'workspaceId']);
    expect(Object.keys(body.profile)).toHaveLength(11);
    expect(body.profile).toEqual(empty);
  });

  it('echoes expectedUpdatedAt byte for byte', async () => {
    const { instance, fetchImpl } = client(json({ success: true, workspaceId: WORKSPACE, row: ROW }));
    await instance.saveCrmProfile(WORKSPACE, saveInput('2026-11-21T09:30:00.123Z'));
    expect(call(fetchImpl)[1].body as string).toContain('"expectedUpdatedAt":"2026-11-21T09:30:00.123Z"');
  });

  it('reads the exact server envelopes by reason, never by their English error text', async () => {
    const conflict = client(json({ success: false, error: 'Customer profile changed', reason: 'profile_conflict', row: ROW }, 409));
    expect(await conflict.instance.saveCrmProfile(WORKSPACE, saveInput())).toEqual({ ok: true, value: { kind: 'conflict', leadId: LEAD_ID, profile: ROW.profile } });
    const gone = client(json({ success: false, error: 'No Facebook Page available', reason: 'lead_not_found' }, 422));
    const result = await gone.instance.saveCrmProfile(WORKSPACE, saveInput());
    expect(result).toEqual({ ok: false, error: 'rejected', reason: 'lead_not_found' });
    expect(JSON.stringify(result)).not.toContain('Facebook Page');
  });

  it('turns a 409 profile_conflict into the current row, never an overwrite', async () => {
    const { instance } = client(json({ success: false, error: 'Conflict', reason: 'profile_conflict', row: ROW }, 409));
    expect(await instance.saveCrmProfile(WORKSPACE, saveInput())).toEqual({ ok: true, value: { kind: 'conflict', leadId: LEAD_ID, profile: ROW.profile } });
  });

  it('treats a committed save whose row came back partial as a success with the saved profile', async () => {
    const partial = { ...ROW, phone: '', phoneCapturedAt: '', lastMessageAt: '', recentMessages: [], customerName: null };
    const saved = client(json({ success: true, workspaceId: WORKSPACE, row: partial }));
    expect(await saved.instance.saveCrmProfile(WORKSPACE, saveInput()))
      .toEqual({ ok: true, value: { kind: 'saved', leadId: LEAD_ID, profile: ROW.profile } });
    const conflict = client(json({ success: false, error: 'Customer profile changed', reason: 'profile_conflict', row: partial }, 409));
    expect(await conflict.instance.saveCrmProfile(WORKSPACE, saveInput()))
      .toEqual({ ok: true, value: { kind: 'conflict', leadId: LEAD_ID, profile: ROW.profile } });
  });

  it('never sends the read-only profile fields, even if the profile object carries them', async () => {
    const { instance, fetchImpl } = client(json({ success: true, workspaceId: WORKSPACE, row: ROW }));
    const carrying = { ...PROFILE, updatedAt: UPDATED, updatedBy: OWNER_ID, detailsUnreadable: true } as CustomerCareCrmProfileInput;
    await instance.saveCrmProfile(WORKSPACE, { leadId: LEAD_ID, expectedUpdatedAt: UPDATED, profile: carrying });
    const sent = JSON.parse(call(fetchImpl)[1].body as string).profile;
    expect(Object.keys(sent).sort()).toEqual(Object.keys(PROFILE).sort());
  });

  it('reads 403 owner_not_eligible apart from a viewer\'s 403', async () => {
    const owner = client(json({ success: false, error: 'Forbidden', reason: 'owner_not_eligible' }, 403));
    expect(await owner.instance.saveCrmProfile(WORKSPACE, saveInput()))
      .toEqual({ ok: false, error: 'rejected', reason: 'owner_not_eligible' });
    const viewer = client(json({ success: false, error: 'Forbidden', reason: 'forbidden' }, 403));
    expect(await viewer.instance.saveCrmProfile(WORKSPACE, saveInput())).toEqual({ ok: false, error: 'forbidden' });
  });

  it('reports a 409 without a readable row as an invalid answer', async () => {
    const { instance } = client(json({ success: false, error: 'Conflict', reason: 'profile_conflict' }, 409));
    expect(await instance.saveCrmProfile(WORKSPACE, saveInput())).toEqual({ ok: false, error: 'invalid-response' });
  });

  it('rejects a saved row for another lead', async () => {
    const other = { ...ROW, leadId: '55555555-5555-4555-8555-555555555555' };
    const { instance } = client(json({ success: true, workspaceId: WORKSPACE, row: other }));
    expect(await instance.saveCrmProfile(WORKSPACE, saveInput())).toEqual({ ok: false, error: 'invalid-response' });
  });

  it('refuses an invalid workspace or lead without a request', async () => {
    const { instance, fetchImpl } = client(json({}));
    expect(await instance.saveCrmProfile('nope', saveInput())).toEqual({ ok: false, error: 'rejected', reason: 'invalid_request' });
    expect(await instance.saveCrmProfile(WORKSPACE, { ...saveInput(), leadId: 'nope' }))
      .toEqual({ ok: false, error: 'rejected', reason: 'invalid_request' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('CareCrmClient failures', () => {
  it.each([
    [400, { success: false, error: 'Bad', reason: 'invalid_request' }, { ok: false, error: 'rejected', reason: 'invalid_request' }],
    [401, { success: false, error: 'Unauthorized' }, { ok: false, error: 'auth' }],
    [403, { success: false, error: 'Forbidden', reason: 'forbidden' }, { ok: false, error: 'forbidden' }],
    [404, { success: false, error: 'Not found' }, { ok: false, error: 'unsupported' }],
    [422, { success: false, error: 'x', reason: 'lead_not_found' }, { ok: false, error: 'rejected', reason: 'lead_not_found' }],
    [429, { success: false, error: 'Too many requests', reason: 'rate_limited' }, { ok: false, error: 'unavailable', reason: 'rate_limited' }],
    // Fallback: a 429 without a reason is still read as the rate limit.
    [429, { success: false, error: 'Too many requests' }, { ok: false, error: 'unavailable', reason: 'rate_limited' }],
    [500, { success: false, error: 'Internal' }, { ok: false, error: 'unavailable' }],
    [503, { success: false, error: 'x', reason: 'not_configured' }, { ok: false, error: 'not_configured' }],
  ])('maps status %i to a bounded failure', async (status, body, expected) => {
    expect(await client(json(body, status)).instance.saveCrmProfile(WORKSPACE, saveInput())).toEqual(expected);
    expect(await client(json(body, status)).instance.listCrm(WORKSPACE, null)).toEqual(expected);
  });

  it('answers not_configured without an origin and auth without a token', async () => {
    const noOrigin = new CareCrmClient({ getAccessToken: async () => TOKEN }, { baseUrl: 'http://evil.example' });
    expect(await noOrigin.listCrm(WORKSPACE, null)).toEqual({ ok: false, error: 'not_configured' });
    const fetchImpl = vi.fn();
    const noToken = new CareCrmClient({ getAccessToken: async () => null }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(await noToken.listCrm(WORKSPACE, null)).toEqual({ ok: false, error: 'auth' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('answers unavailable when the network fails or the body is not JSON', async () => {
    expect(await client(async () => { throw new Error(`socket ${PHONE}`); }).instance.listCrm(WORKSPACE, null))
      .toEqual({ ok: false, error: 'unavailable' });
    const unreadable = { ok: true, status: 200, json: async () => { throw new Error('x'); } } as unknown as Response;
    expect(await client(unreadable).instance.listCrm(WORKSPACE, null)).toEqual({ ok: false, error: 'invalid-response' });
  });

  it('logs only the route label and status, never the body, phone, name, note or token', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await client(json({ success: false, error: `bad ${PHONE}`, reason: 'profile_conflict', row: ROW }, 409))
      .instance.saveCrmProfile(WORKSPACE, saveInput());
    await client(json({ success: false, error: NAME }, 500)).instance.listCrm(WORKSPACE, null);
    await client(async () => { throw new Error(NOTE); }).instance.saveCrmProfile(WORKSPACE, saveInput());
    const logged = [...warn.mock.calls, ...log.mock.calls, ...error.mock.calls].flat().map(String).join('\n');
    expect(warn.mock.calls.map((args) => args.join(' '))).toEqual([
      '[CareCrmClient] crm-profile: status 409',
      // The identity read, then the read without it (both failed).
      '[CareCrmClient] crm: status 500',
      '[CareCrmClient] crm: status 500',
      '[CareCrmClient] crm-profile: unavailable',
    ]);
    for (const secret of [PHONE, NAME, NOTE, TOKEN, WORKSPACE, LEAD_ID, 'Gọi lại']) expect(logged).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------
// Care CRM S3: the identity card (backend bae6259)
// ---------------------------------------------------------------------------

const VERSION = '2026-11-25T01:02:03.456Z';
const QUOTE = 'em mua cho bố mẹ ạ';
const IDENTITY = {
  version: VERSION,
  lastRunAt: VERSION,
  consent: { state: 'granted', at: VERSION, noMarketing: false, canAsk: false },
  occasion: null,
  timeline: null,
  productFactIds: null,
  addressForm: null,
  ageBand: null,
  family: {
    value: { recipient: 'parents' }, confidence: 'high', kind: 'stated', source: 'ai', status: 'suggested', updatedAt: VERSION,
    evidence: [{ source: 'customer', at: VERSION, quote: QUOTE }],
  },
  interests: { adTitle: null, sharedLinks: [], budgetBand: null },
  persona: null,
};
const CONFIRM = { leadId: LEAD_ID, action: 'confirm' as const, field: 'family' as const, expectedVersion: VERSION };
const actionOk = (identity: unknown = IDENTITY) => json({ success: true, workspaceId: WORKSPACE, leadId: LEAD_ID, identity });
const refreshOk = (outcome = 'updated') => json({ success: true, workspaceId: WORKSPACE, leadId: LEAD_ID, identity: IDENTITY, outcome });

describe('CareCrmClient GET /crm?include=identity', () => {
  it('asks for include=identity,pages and takes both identity and pages when returned', async () => {
    const pages = [{ pageId: '105252511858057', pageName: 'Đồng Thờ Hồng Hưng' }];
    const body = { ...LIST_BODY, identityEnabled: true, pages, rows: [{ ...ROW, identity: IDENTITY }] };
    const { instance, fetchImpl } = client(json(body));
    const result = await instance.listCrm(WORKSPACE, null);
    expect(call(fetchImpl)[0]).toBe(`${ROOT}/crm?workspaceId=${WORKSPACE}&include=identity,pages`);
    expect(result.ok && result.value.identityEnabled).toBe(true);
    expect(result.ok && result.value.pages).toEqual(pages);
    expect(result.ok && result.value.rows[0].identity).toEqual(IDENTITY);
  });

  // The identity read must never take the CRM down (review of a694110).
  function sequence(...responses: Response[]) {
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const instance = new CareCrmClient({ getAccessToken: async () => TOKEN }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    return { instance, fetchImpl, urls: () => fetchImpl.mock.calls.map((args) => (args as unknown as [string])[0]) };
  }

  it.each([400, 422])('falls back from include=identity,pages to include=identity on %i invalid_request, preserving identity', async (status) => {
    const identityBody = { ...LIST_BODY, identityEnabled: true, rows: [{ ...ROW, identity: IDENTITY }] };
    const { instance, urls } = sequence(
      json({ success: false, error: 'x', reason: 'invalid_request' }, status),
      json(identityBody),
      json(identityBody),
    );
    const first = await instance.listCrm(WORKSPACE, 'crm-next-1');
    expect(first.ok && first.value.identityEnabled).toBe(true);
    expect(first.ok && first.value.identityUnavailable).toBe(false);
    expect(first.ok && first.value.rows[0].identity).toEqual(IDENTITY);
    // Next page within 5 minutes skips `pages` directly to `include=identity` without burning another 400.
    const second = await instance.listCrm(WORKSPACE, 'crm-next-2');
    expect(second.ok && second.value.identityEnabled).toBe(true);
    expect(urls()).toEqual([
      `${ROOT}/crm?workspaceId=${WORKSPACE}&include=identity,pages&cursor=crm-next-1`,
      `${ROOT}/crm?workspaceId=${WORKSPACE}&include=identity&cursor=crm-next-1`,
      `${ROOT}/crm?workspaceId=${WORKSPACE}&include=identity&cursor=crm-next-2`,
    ]);
  });

  it.each([
    [400, 'invalid_request'],
    [422, 'invalid_request'],
  ])('falls back all the way to plain /crm when both include=identity,pages and include=identity return %i %s', async (status, reason) => {
    const { instance, urls } = sequence(
      json({ success: false, error: 'x', reason }, status),
      json({ success: false, error: 'x', reason }, status),
      json(LIST_BODY),
    );
    const result = await instance.listCrm(WORKSPACE, 'crm-next-1');
    expect(result).toEqual({
      ok: true,
      value: {
        role: 'owner', canDelete: true, rows: [ROW], nextCursor: null, assignees: LIST_BODY.assignees,
        identityEnabled: null, identityUnavailable: true, consentAsk: null,
      },
    });
    expect(urls()).toEqual([
      `${ROOT}/crm?workspaceId=${WORKSPACE}&include=identity,pages&cursor=crm-next-1`,
      `${ROOT}/crm?workspaceId=${WORKSPACE}&include=identity&cursor=crm-next-1`,
      `${ROOT}/crm?workspaceId=${WORKSPACE}&cursor=crm-next-1`,
    ]);
  });

  it.each([
    [500, undefined],
    [502, undefined],
    [503, 'not_configured'],
  ])('reads the list again without identity after a %i on include=identity,pages, once', async (status, reason) => {
    const { instance, urls } = sequence(json({ success: false, error: 'x', ...(reason ? { reason } : {}) }, status), json(LIST_BODY));
    const result = await instance.listCrm(WORKSPACE, 'crm-next-1');
    expect(result).toEqual({
      ok: true,
      value: {
        role: 'owner', canDelete: true, rows: [ROW], nextCursor: null, assignees: LIST_BODY.assignees,
        identityEnabled: null, identityUnavailable: true, consentAsk: null,
      },
    });
    expect(urls()).toEqual([
      `${ROOT}/crm?workspaceId=${WORKSPACE}&include=identity,pages&cursor=crm-next-1`,
      `${ROOT}/crm?workspaceId=${WORKSPACE}&cursor=crm-next-1`,
    ]);
  });

  it('does not retry an answer that would not change without include: 401, 403, 404, 429', async () => {
    for (const [status, expected] of [
      [401, { ok: false, error: 'auth' }],
      [403, { ok: false, error: 'forbidden' }],
      [404, { ok: false, error: 'unsupported' }],
      [429, { ok: false, error: 'unavailable', reason: 'rate_limited' }],
    ] as const) {
      const { instance, fetchImpl } = sequence(json({ success: false, error: 'x', reason: 'forbidden' }, status), json(LIST_BODY));
      expect(await instance.listCrm(WORKSPACE, null), String(status)).toEqual(expected);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('fails as before when the read without include fails too', async () => {
    const { instance, fetchImpl } = sequence(json({ success: false, error: 'x' }, 500), json({ success: false, error: 'x' }, 500));
    expect(await instance.listCrm(WORKSPACE, null)).toEqual({ ok: false, error: 'unavailable' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('skips include for 5 minutes after a failure, so a broken identity read never doubles the Care budget', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-25T10:00:00.000Z'));
      const { instance, urls } = sequence(
        json({ success: false, error: 'x' }, 500), json(LIST_BODY), json(LIST_BODY), json({ ...LIST_BODY, identityEnabled: true }),
      );
      await instance.listCrm(WORKSPACE, null);
      vi.setSystemTime(new Date('2026-11-25T10:04:59.000Z'));
      const during = await instance.listCrm(WORKSPACE, null);
      expect(during.ok && during.value.identityUnavailable).toBe(true);
      vi.setSystemTime(new Date('2026-11-25T10:05:01.000Z'));
      const after = await instance.listCrm(WORKSPACE, null);
      expect(after.ok && after.value).toMatchObject({ identityEnabled: true, identityUnavailable: false });
      expect(urls().map((url) => url.includes('include=identity'))).toEqual([true, false, false, true]);
    } finally {
      vi.useRealTimers();
    }
  });

  // Re-review of a394761, LOW 2.
  const FAIL = () => json({ success: false, error: 'x' }, 500);
  const includes = (urls: string[]) => urls.map((url) => url.includes('include=identity'));

  it('pauses the identity read only when the read without it succeeded', async () => {
    const both = sequence(FAIL(), FAIL(), FAIL(), json(LIST_BODY));
    expect(await both.instance.listCrm(WORKSPACE, null)).toEqual({ ok: false, error: 'unavailable' });
    await both.instance.listCrm(WORKSPACE, null);
    expect(includes(both.urls())).toEqual([true, false, true, false]);
  });

  it('starts afresh on a workspace or account switch', async () => {
    const { instance, urls } = sequence(
      FAIL(), json(LIST_BODY), json({ ...LIST_BODY, workspaceId: OTHER_WORKSPACE }), json({ ...LIST_BODY, identityEnabled: true }),
    );
    await instance.listCrm(WORKSPACE, null, { scope: 'account-a:workspace-1' });
    await instance.listCrm(OTHER_WORKSPACE, null, { scope: 'account-a:workspace-2' });
    await instance.listCrm(WORKSPACE, null, { scope: 'account-b:workspace-1' });
    expect(includes(urls())).toEqual([true, false, true, true]);
  });

  it('tries the identity again during the pause when the user asks ("Làm mới"), and resumes it when it works', async () => {
    const { instance, urls } = sequence(FAIL(), json(LIST_BODY), json({ ...LIST_BODY, identityEnabled: true }), json(LIST_BODY));
    const scope = { scope: 'account-a:workspace-1' };
    await instance.listCrm(WORKSPACE, null, scope);
    const retried = await instance.listCrm(WORKSPACE, null, { ...scope, retryIdentity: true });
    expect(retried.ok && retried.value).toMatchObject({ identityEnabled: true, identityUnavailable: false });
    await instance.listCrm(WORKSPACE, null, scope);
    expect(includes(urls())).toEqual([true, false, true, true]);
  });
});

describe('CareCrmClient POST /crm/identity clear_erase_request (backend 79e14f9)', () => {
  const CLEAR = { leadId: LEAD_ID, action: 'clear_erase_request' as const };

  it('sends exactly the workspace, the lead and the action, and returns the identity after it', async () => {
    const cleared = { ...IDENTITY, consent: { ...IDENTITY.consent, noMarketing: true, eraseRequestedAt: null } };
    const { instance, fetchImpl } = client(actionOk(cleared));
    expect(await instance.identityAction(WORKSPACE, CLEAR)).toEqual({ ok: true, value: { kind: 'applied', leadId: LEAD_ID, identity: cleared } });
    expect(JSON.parse(call(fetchImpl)[1].body as string)).toEqual({ workspaceId: WORKSPACE, leadId: LEAD_ID, action: 'clear_erase_request' });
  });

  it.each([
    [400, 'invalid_request', { ok: false, error: 'rejected', reason: 'invalid_request' }],
    [401, undefined, { ok: false, error: 'auth' }],
    [403, 'forbidden', { ok: false, error: 'forbidden' }],
    [404, undefined, { ok: false, error: 'unsupported' }],
    [422, 'lead_not_found', { ok: false, error: 'rejected', reason: 'lead_not_found' }],
    [429, 'rate_limited', { ok: false, error: 'unavailable', reason: 'rate_limited' }],
    [500, undefined, { ok: false, error: 'unavailable' }],
    [503, 'not_configured', { ok: false, error: 'not_configured' }],
  ])('maps %i %s', async (status, reason, expected) => {
    const body = reason === undefined ? { success: false, error: 'x' } : { success: false, error: 'x', reason };
    expect(await client(json(body, status)).instance.identityAction(WORKSPACE, CLEAR)).toEqual(expected);
  });
});

describe('CareCrmClient POST /crm/identity', () => {
  it('sends the live workspace with exactly the action keys and returns the identity after it', async () => {
    const { instance, fetchImpl } = client(actionOk());
    expect(await instance.identityAction(WORKSPACE, CONFIRM)).toEqual({ ok: true, value: { kind: 'applied', leadId: LEAD_ID, identity: IDENTITY } });
    const [url, init] = call(fetchImpl);
    expect(url).toBe(`${ROOT}/crm/identity`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ workspaceId: WORKSPACE, ...CONFIRM });
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('sends ask_consent with the lead only', async () => {
    const { instance, fetchImpl } = client(actionOk());
    await instance.identityAction(WORKSPACE, { leadId: LEAD_ID, action: 'ask_consent' });
    expect(JSON.parse(call(fetchImpl)[1].body as string)).toEqual({ workspaceId: WORKSPACE, leadId: LEAD_ID, action: 'ask_consent' });
  });

  it('turns a 409 identity_conflict into the current identity, never an overwrite', async () => {
    const newer = { ...IDENTITY, version: '2026-11-25T02:00:00.000Z' };
    const { instance } = client(json({ success: false, error: 'Customer identity changed', reason: 'identity_conflict', identity: newer }, 409));
    expect(await instance.identityAction(WORKSPACE, CONFIRM)).toEqual({ ok: true, value: { kind: 'conflict', leadId: LEAD_ID, identity: newer } });
  });

  it('reports a 409 conflict without a readable identity, and a 200 for another lead, as invalid answers', async () => {
    const conflict = client(json({ success: false, error: 'x', reason: 'identity_conflict' }, 409));
    expect(await conflict.instance.identityAction(WORKSPACE, CONFIRM)).toEqual({ ok: false, error: 'invalid-response' });
    const other = client(json({ success: true, workspaceId: WORKSPACE, leadId: '55555555-5555-4555-8555-555555555555', identity: IDENTITY }));
    expect(await other.instance.identityAction(WORKSPACE, CONFIRM)).toEqual({ ok: false, error: 'invalid-response' });
  });

  it.each([
    [400, 'invalid_request', { ok: false, error: 'rejected', reason: 'invalid_request' }],
    [401, undefined, { ok: false, error: 'auth' }],
    [403, 'forbidden', { ok: false, error: 'forbidden' }],
    [404, undefined, { ok: false, error: 'unsupported' }],
    [422, 'lead_not_found', { ok: false, error: 'rejected', reason: 'lead_not_found' }],
    [422, 'consent_required', { ok: false, error: 'rejected', reason: 'consent_required' }],
    [422, 'outside_window', { ok: false, error: 'rejected', reason: 'outside_window' }],
    [422, 'ask_limit', { ok: false, error: 'rejected', reason: 'ask_limit' }],
    [422, 'page_not_connected', { ok: false, error: 'rejected', reason: 'page_not_connected' }],
    [422, 'permission_missing', { ok: false, error: 'rejected', reason: 'permission_missing' }],
    [429, 'rate_limited', { ok: false, error: 'unavailable', reason: 'rate_limited' }],
    [502, 'provider_rejected', { ok: false, error: 'rejected', reason: 'provider_rejected' }],
    [502, 'provider_timeout', { ok: false, error: 'unavailable', reason: 'provider_timeout' }],
    [502, 'provider_unavailable', { ok: false, error: 'unavailable', reason: 'provider_unavailable' }],
    [503, 'not_configured', { ok: false, error: 'not_configured' }],
    [503, 'profile_ai_off', { ok: false, error: 'rejected', reason: 'profile_ai_off' }],
  ])('maps %i %s by reason', async (status, reason, expected) => {
    const body = reason === undefined ? { success: false, error: 'x' } : { success: false, error: 'x', reason };
    expect(await client(json(body, status)).instance.identityAction(WORKSPACE, CONFIRM)).toEqual(expected);
  });

  it('refuses an invalid workspace or lead without a request', async () => {
    const { instance, fetchImpl } = client(actionOk());
    expect(await instance.identityAction('nope', CONFIRM)).toEqual({ ok: false, error: 'rejected', reason: 'invalid_request' });
    expect(await instance.identityAction(WORKSPACE, { ...CONFIRM, leadId: 'nope' })).toEqual({ ok: false, error: 'rejected', reason: 'invalid_request' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('CareCrmClient POST /crm/identity/refresh', () => {
  it('posts the workspace and lead and returns the identity with its outcome', async () => {
    const { instance, fetchImpl } = client(refreshOk('no_change'));
    expect(await instance.refreshIdentity(WORKSPACE, LEAD_ID)).toEqual({
      ok: true, value: { kind: 'refreshed', leadId: LEAD_ID, identity: IDENTITY, outcome: 'no_change' },
    });
    const [url, init] = call(fetchImpl);
    expect(url).toBe(`${ROOT}/crm/identity/refresh`);
    expect(JSON.parse(init.body as string)).toEqual({ workspaceId: WORKSPACE, leadId: LEAD_ID });
  });

  it('reads refresh_too_soon with its retryAfterSec apart from daily_cap and the router rate limit', async () => {
    const soon = client(json({ success: false, error: 'Too many requests', reason: 'refresh_too_soon', retryAfterSec: 420 }, 429));
    expect(await soon.instance.refreshIdentity(WORKSPACE, LEAD_ID)).toEqual({ ok: true, value: { kind: 'too_soon', leadId: LEAD_ID, retryAfterSec: 420 } });
    const cap = client(json({ success: false, error: 'Too many requests', reason: 'daily_cap' }, 429));
    expect(await cap.instance.refreshIdentity(WORKSPACE, LEAD_ID)).toEqual({ ok: false, error: 'rejected', reason: 'daily_cap' });
    const limited = client(json({ success: false, error: 'Too many requests', reason: 'rate_limited' }, 429));
    expect(await limited.instance.refreshIdentity(WORKSPACE, LEAD_ID)).toEqual({ ok: false, error: 'unavailable', reason: 'rate_limited' });
    const broken = client(json({ success: false, error: 'Too many requests', reason: 'refresh_too_soon' }, 429));
    expect(await broken.instance.refreshIdentity(WORKSPACE, LEAD_ID)).toEqual({ ok: false, error: 'invalid-response' });
  });

  it.each([
    [409, 'identity_running', { ok: false, error: 'rejected', reason: 'identity_running' }],
    [422, 'consent_required', { ok: false, error: 'rejected', reason: 'consent_required' }],
    [422, 'lead_not_found', { ok: false, error: 'rejected', reason: 'lead_not_found' }],
    [502, 'ai_unavailable', { ok: false, error: 'unavailable', reason: 'ai_unavailable' }],
    [503, 'profile_ai_off', { ok: false, error: 'rejected', reason: 'profile_ai_off' }],
    [503, 'not_configured', { ok: false, error: 'not_configured' }],
  ])('maps %i %s by reason', async (status, reason, expected) => {
    expect(await client(json({ success: false, error: 'x', reason }, status)).instance.refreshIdentity(WORKSPACE, LEAD_ID)).toEqual(expected);
  });

  it('waits 45 s for the synchronous run (not the 8 s default), then gives up as unavailable', async () => {
    vi.useFakeTimers();
    try {
      let aborted = false;
      const pending = (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
      });
      const fetchImpl = vi.fn(pending);
      const instance = new CareCrmClient({ getAccessToken: async () => TOKEN }, { fetchImpl: fetchImpl as unknown as typeof fetch });
      const result = instance.refreshIdentity(WORKSPACE, LEAD_ID);
      await vi.advanceTimersByTimeAsync(44_999);
      expect(aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(aborted).toBe(true);
      expect(await result).toEqual({ ok: false, error: 'unavailable' });

      // A staff action keeps the client's 8 s default.
      aborted = false;
      const action = instance.identityAction(WORKSPACE, CONFIRM);
      await vi.advanceTimersByTimeAsync(8_000);
      expect(aborted).toBe(true);
      expect(await action).toEqual({ ok: false, error: 'unavailable' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses an invalid lead without a request', async () => {
    const { instance, fetchImpl } = client(refreshOk());
    expect(await instance.refreshIdentity(WORKSPACE, 'nope')).toEqual({ ok: false, error: 'rejected', reason: 'invalid_request' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('logs only the route label and status, never a quote, the version or the lead', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await client(json({ success: false, error: QUOTE, reason: 'identity_conflict', identity: IDENTITY }, 409))
      .instance.identityAction(WORKSPACE, CONFIRM);
    await client(json({ success: false, error: QUOTE, reason: 'ai_unavailable' }, 502)).instance.refreshIdentity(WORKSPACE, LEAD_ID);
    expect(warn.mock.calls.map((args) => args.join(' '))).toEqual([
      '[CareCrmClient] crm-identity: status 409',
      '[CareCrmClient] crm-identity-refresh: status 502',
    ]);
    const logged = warn.mock.calls.flat().map(String).join('\n');
    for (const secret of [QUOTE, VERSION, LEAD_ID, WORKSPACE, TOKEN]) expect(logged).not.toContain(secret);
  });
});
