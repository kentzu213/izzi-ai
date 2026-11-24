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
      value: { role: 'owner', canDelete: true, rows: [ROW], nextCursor: null, assignees: LIST_BODY.assignees },
    });
    const [url, init] = call(fetchImpl);
    expect(url).toBe(`${ROOT}/crm?workspaceId=${WORKSPACE}`);
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe('error');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(url).not.toContain(TOKEN);
  });

  it('passes the opaque cursor encoded', async () => {
    const { instance, fetchImpl } = client(json(LIST_BODY));
    await instance.listCrm(WORKSPACE, 'crm_2026-11-20T10:00:00Z|abc');
    expect(call(fetchImpl)[0]).toBe(`${ROOT}/crm?workspaceId=${WORKSPACE}&cursor=crm_2026-11-20T10%3A00%3A00Z%7Cabc`);
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
    expect(await instance.saveCrmProfile(WORKSPACE, saveInput())).toEqual({ ok: true, value: { kind: 'saved', row: ROW } });
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
    expect(await conflict.instance.saveCrmProfile(WORKSPACE, saveInput())).toEqual({ ok: true, value: { kind: 'conflict', row: ROW } });
    const gone = client(json({ success: false, error: 'No Facebook Page available', reason: 'lead_not_found' }, 422));
    const result = await gone.instance.saveCrmProfile(WORKSPACE, saveInput());
    expect(result).toEqual({ ok: false, error: 'rejected', reason: 'lead_not_found' });
    expect(JSON.stringify(result)).not.toContain('Facebook Page');
  });

  it('turns a 409 profile_conflict into the current row, never an overwrite', async () => {
    const { instance } = client(json({ success: false, error: 'Conflict', reason: 'profile_conflict', row: ROW }, 409));
    expect(await instance.saveCrmProfile(WORKSPACE, saveInput())).toEqual({ ok: true, value: { kind: 'conflict', row: ROW } });
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
      '[CareCrmClient] crm: status 500',
      '[CareCrmClient] crm-profile: unavailable',
    ]);
    for (const secret of [PHONE, NAME, NOTE, TOKEN, WORKSPACE, LEAD_ID, 'Gọi lại']) expect(logged).not.toContain(secret);
  });
});
