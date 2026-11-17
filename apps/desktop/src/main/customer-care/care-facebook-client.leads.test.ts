/**
 * Offline tests for the Phase B1 inbox and lead routes of the Care Facebook client. `fetch` is injected.
 * Invariants: contract paths and bodies, every response rebuilt from an exact allowlist (a phone that is
 * not a normalized Vietnamese mobile, an unknown status or an oversized message rejects the answer),
 * and failures collapse to bounded codes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CareFacebookClient } from './care-facebook-client';
import type { NativeMarketingTokenProvider } from '../marketing/native-marketing-client';

const ROOT = 'https://api.izziapi.com/api/marketing/care/facebook';
const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE = '22222222-2222-4222-8222-222222222222';
const LEAD_ID = '44444444-4444-4444-8444-444444444444';
const LEAD_ID_2 = '55555555-5555-4555-8555-555555555555';
const PAGE = '105252511858057';
const TOKEN = 'test-supabase-access-token';
const PHONE = '0901234567';
const ISO = '2026-11-17T10:00:00.000Z';
const LATER = '2026-11-17T10:05:00.000Z';

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function client(response: Response) {
  const fetchImpl = vi.fn(async () => response);
  const tokens: NativeMarketingTokenProvider = { getAccessToken: async () => TOKEN };
  return { instance: new CareFacebookClient(tokens, { fetchImpl: fetchImpl as unknown as typeof fetch }), fetchImpl };
}

function call(fetchImpl: ReturnType<typeof vi.fn>, index = 0): [string, RequestInit] {
  return fetchImpl.mock.calls[index] as unknown as [string, RequestInit];
}

const INBOX = { enabled: true, subscribedAt: ISO, lastEventAt: LATER };
const LEAD = {
  id: LEAD_ID,
  pageId: PAGE,
  customerName: 'Nguyễn Văn An',
  phone: PHONE,
  zaloMentioned: true,
  status: 'new',
  phoneCapturedAt: LATER,
  lastMessageAt: LATER,
  statusChangedAt: null,
  recentMessages: [
    { text: 'Shop ơi bộ này giá bao nhiêu?', at: ISO },
    { text: 'Số em 0901 234 567, nhắn Zalo giúp em', at: LATER },
  ],
};
const LEADS_BODY = { success: true, workspaceId: WORKSPACE, leads: [LEAD], nextCursor: 'cursor_2026-11-17T10:05:00Z' };

afterEach(() => vi.restoreAllMocks());

describe('CareFacebookClient Phase B1 requests', () => {
  it('reads the inbox, then turns it on with the workspace in the body and the token in the header only', async () => {
    const read = client(json({ success: true, workspaceId: WORKSPACE, inbox: INBOX }));
    expect(await read.instance.getInbox(WORKSPACE)).toEqual({ ok: true, value: INBOX });
    expect(call(read.fetchImpl)[0]).toBe(`${ROOT}/inbox?workspaceId=${WORKSPACE}`);
    expect(call(read.fetchImpl)[1].method ?? 'GET').toBe('GET');

    const write = client(json({ success: true, workspaceId: WORKSPACE, inbox: INBOX }));
    expect(await write.instance.setInbox(WORKSPACE, true)).toEqual({ ok: true, value: INBOX });
    const [url, init] = call(write.fetchImpl);
    expect(url).toBe(`${ROOT}/inbox`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ workspaceId: WORKSPACE, enabled: true });
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(String(init.body)).not.toContain(TOKEN);
  });

  it('lists the first page without a cursor and a later page with the encoded opaque cursor', async () => {
    const first = client(json(LEADS_BODY));
    expect(await first.instance.listLeads(WORKSPACE)).toEqual({
      ok: true,
      value: { leads: [LEAD], nextCursor: LEADS_BODY.nextCursor },
    });
    expect(call(first.fetchImpl)[0]).toBe(`${ROOT}/leads?workspaceId=${WORKSPACE}`);

    const next = client(json({ ...LEADS_BODY, nextCursor: null }));
    await next.instance.listLeads(WORKSPACE, 'a+b/c=&d');
    expect(call(next.fetchImpl)[0]).toBe(`${ROOT}/leads?workspaceId=${WORKSPACE}&cursor=a%2Bb%2Fc%3D%26d`);
  });

  it('posts a status change with the lead id and requires that lead back in that status', async () => {
    const contacted = { ...LEAD, status: 'contacted', statusChangedAt: LATER };
    const ok = client(json({ success: true, workspaceId: WORKSPACE, lead: contacted }));
    expect(await ok.instance.setLeadStatus(WORKSPACE, LEAD_ID, 'contacted')).toEqual({ ok: true, value: contacted });
    const [url, init] = call(ok.fetchImpl);
    expect(url).toBe(`${ROOT}/leads/status`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ workspaceId: WORKSPACE, leadId: LEAD_ID, status: 'contacted' });

    const invalid = { ok: false, error: 'invalid-response' };
    const otherLead = client(json({ success: true, workspaceId: WORKSPACE, lead: { ...contacted, id: LEAD_ID_2 } }));
    expect(await otherLead.instance.setLeadStatus(WORKSPACE, LEAD_ID, 'contacted')).toEqual(invalid);
    const otherStatus = client(json({ success: true, workspaceId: WORKSPACE, lead: LEAD }));
    expect(await otherStatus.instance.setLeadStatus(WORKSPACE, LEAD_ID, 'contacted')).toEqual(invalid);
  });

  it('rejects malformed inputs locally without any request', async () => {
    const { instance, fetchImpl } = client(json(LEADS_BODY));
    const invalidRequest = { ok: false, error: 'rejected', reason: 'invalid_request' };
    expect(await instance.getInbox('not-a-uuid')).toEqual(invalidRequest);
    expect(await instance.setInbox(WORKSPACE, 'yes' as unknown as boolean)).toEqual(invalidRequest);
    for (const cursor of ['', 'has space', 'x'.repeat(513), 'tab\there', 'ç']) {
      expect(await instance.listLeads(WORKSPACE, cursor)).toEqual(invalidRequest);
    }
    expect(await instance.setLeadStatus(WORKSPACE, 'lead-1', 'new')).toEqual(invalidRequest);
    expect(await instance.setLeadStatus(WORKSPACE, LEAD_ID, 'done' as never)).toEqual(invalidRequest);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('CareFacebookClient Phase B1 strict parsing', () => {
  const invalid = { ok: false, error: 'invalid-response' };

  async function leadsWith(body: unknown) {
    return client(json(body)).instance.listLeads(WORKSPACE);
  }

  async function leadWith(patch: Record<string, unknown>) {
    return leadsWith({ ...LEADS_BODY, leads: [{ ...LEAD, ...patch }] });
  }

  it.each([
    ['01 prefix', '0123456789'],
    ['04 prefix', '0401234567'],
    ['+84 form', '+84901234567'],
    ['84 form', '84901234567'],
    ['nine digits', '090123456'],
    ['eleven digits', '09012345678'],
    ['separators', '0901 234 567'],
    ['a number', 901234567],
  ])('rejects a lead whose phone is not a normalized mobile (%s)', async (_label, phone) => {
    expect(await leadWith({ phone })).toEqual(invalid);
  });

  it.each(['03', '05', '07', '08', '09'])('accepts a normalized mobile starting with %s', async (prefix) => {
    expect((await leadWith({ phone: `${prefix}12345678` })).ok).toBe(true);
  });

  it.each([
    ['an unknown status', { status: 'done' }],
    ['four messages', { recentMessages: [...LEAD.recentMessages, ...LEAD.recentMessages] }],
    ['a 501-character message', { recentMessages: [{ text: 'a'.repeat(501), at: ISO }] }],
    ['a message with an extra key', { recentMessages: [{ text: 'hi', at: ISO, senderPsid: '123' }] }],
    ['a message without a time', { recentMessages: [{ text: 'hi' }] }],
    ['a non-text message', { recentMessages: [{ text: 42, at: ISO }] }],
    ['a non-uuid id', { id: 'lead-1' }],
    ['a short page id', { pageId: '1234' }],
    ['a non-boolean zalo flag', { zaloMentioned: 'yes' }],
    ['a bad capture time', { phoneCapturedAt: 'today' }],
    ['a bad status change time', { statusChangedAt: 0 }],
    ['a numeric name', { customerName: 42 }],
    ['an extra field', { psid: '123456789' }],
  ])('rejects the page when a lead has %s', async (_label, patch) => {
    expect(await leadWith(patch)).toEqual(invalid);
  });

  it('rejects a lead with a missing field, duplicate leads, more than 50 leads and a foreign workspace', async () => {
    const { recentMessages: _omit, ...missing } = LEAD;
    expect(await leadsWith({ ...LEADS_BODY, leads: [missing] })).toEqual(invalid);
    expect(await leadsWith({ ...LEADS_BODY, leads: [LEAD, LEAD] })).toEqual(invalid);
    const many = Array.from({ length: 51 }, (_, index) => ({
      ...LEAD,
      id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
    }));
    expect(await leadsWith({ ...LEADS_BODY, leads: many })).toEqual(invalid);
    expect(await leadsWith({ ...LEADS_BODY, workspaceId: OTHER_WORKSPACE })).toEqual(invalid);
    expect(await leadsWith({ ...LEADS_BODY, nextCursor: 'has space' })).toEqual(invalid);
    expect(await leadsWith({ ...LEADS_BODY, total: 1 })).toEqual(invalid);
  });

  it('counts the 500-character limit in characters, not UTF-16 units', async () => {
    const text = '😀'.repeat(500);
    const result = await leadWith({ recentMessages: [{ text, at: ISO }] });
    expect(result.ok && result.value.leads[0].recentMessages[0].text).toBe(text);
  });

  it('keeps line breaks but replaces control and bidi characters in customer text', async () => {
    const rlo = String.fromCharCode(0x202e);
    const bell = String.fromCharCode(7);
    const result = await leadWith({ recentMessages: [{ text: `dòng 1\ndòng 2${rlo}lmth.exe${bell}`, at: ISO }] });
    expect(result.ok && result.value.leads[0].recentMessages[0].text)
      .toBe(`dòng 1\ndòng 2${String.fromCharCode(0xfffd)}lmth.exe${String.fromCharCode(0xfffd)}`);
  });

  it('shows a name that could disguise text, or a blank one, as no name instead of dropping the lead', async () => {
    const disguised = await leadWith({ customerName: `An${String.fromCharCode(0x202e)}nA` });
    expect(disguised.ok && disguised.value.leads[0].customerName).toBeNull();
    const blank = await leadWith({ customerName: '   ' });
    expect(blank.ok && blank.value.leads[0].customerName).toBeNull();
    const none = await leadWith({ customerName: null });
    expect(none.ok && none.value.leads[0].customerName).toBeNull();
  });

  it('parses the inbox exactly and allows null without a live Page', async () => {
    const read = async (body: unknown) => client(json(body)).instance.getInbox(WORKSPACE);
    expect(await read({ success: true, workspaceId: WORKSPACE, inbox: null })).toEqual({ ok: true, value: null });
    const off = { enabled: false, subscribedAt: null, lastEventAt: null };
    expect(await read({ success: true, workspaceId: WORKSPACE, inbox: off })).toEqual({ ok: true, value: off });
    expect(await read({ success: true, workspaceId: WORKSPACE, inbox: { ...INBOX, pageToken: 'EAAB' } })).toEqual(invalid);
    expect(await read({ success: true, workspaceId: WORKSPACE, inbox: { ...INBOX, enabled: 'true' } })).toEqual(invalid);
    expect(await read({ success: true, workspaceId: WORKSPACE, inbox: { ...INBOX, lastEventAt: 'now' } })).toEqual(invalid);
    expect(await read({ success: true, workspaceId: OTHER_WORKSPACE, inbox: INBOX })).toEqual(invalid);
  });

  it('requires the toggle answer to report the requested state', async () => {
    const off = client(json({ success: true, workspaceId: WORKSPACE, inbox: INBOX }));
    expect(await off.instance.setInbox(WORKSPACE, false)).toEqual(invalid);
    const none = client(json({ success: true, workspaceId: WORKSPACE, inbox: null }));
    expect(await none.instance.setInbox(WORKSPACE, true)).toEqual(invalid);
  });
});

describe('CareFacebookClient Phase B1 failure mapping', () => {
  it.each([
    [403, { success: false, error: 'x', reason: 'forbidden' }, { ok: false, error: 'forbidden' }],
    [400, { success: false, error: 'x', reason: 'invalid_request' }, { ok: false, error: 'rejected', reason: 'invalid_request' }],
    [422, { success: false, error: 'x', reason: 'page_not_connected' }, { ok: false, error: 'rejected', reason: 'page_not_connected' }],
    [422, { success: false, error: 'x', reason: 'lead_not_found' }, { ok: false, error: 'rejected', reason: 'lead_not_found' }],
    [502, { success: false, error: 'x', reason: 'provider_rejected' }, { ok: false, error: 'rejected' }],
    [502, { success: false, error: 'x', reason: 'provider_unavailable' }, { ok: false, error: 'unavailable' }],
    [502, { success: false, error: 'x', reason: 'provider_timeout' }, { ok: false, error: 'unavailable' }],
    [502, { success: false, error: 'x', reason: 'invalid_response' }, { ok: false, error: 'unavailable' }],
    [503, { success: false, error: 'x', reason: 'not_configured' }, { ok: false, error: 'not_configured' }],
    [429, { success: false, error: 'Too Many Requests' }, { ok: false, error: 'unavailable' }],
    [404, { success: false, error: 'Not Found' }, { ok: false, error: 'unsupported' }],
  ])('maps HTTP %i %j to a bounded code on every B1 route', async (status, body, expected) => {
    expect(await client(json(body, status)).instance.setInbox(WORKSPACE, true)).toEqual(expected);
    expect(await client(json(body, status)).instance.getInbox(WORKSPACE)).toEqual(expected);
    expect(await client(json(body, status)).instance.listLeads(WORKSPACE)).toEqual(expected);
    expect(await client(json(body, status)).instance.setLeadStatus(WORKSPACE, LEAD_ID, 'closed')).toEqual(expected);
  });

  it('logs only the route label and status, never the workspace, phone or server text', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await client(json({ success: false, error: `phone ${PHONE}`, reason: 'lead_not_found' }, 422))
      .instance.setLeadStatus(WORKSPACE, LEAD_ID, 'closed');
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toBe('[CareFacebookClient] lead-status: status 422');
    expect(line).not.toContain(PHONE);
    expect(line).not.toContain(WORKSPACE);
  });
});
