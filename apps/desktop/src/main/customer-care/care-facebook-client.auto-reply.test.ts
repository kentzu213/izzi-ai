/**
 * Offline tests for the Phase C automatic reply routes of the Care Facebook client. `fetch` is injected.
 * Invariants: contract paths and bodies, the state rebuilt from an exact allowlist, unknown problem codes
 * reduced to `unknown`, and failures collapsed to bounded codes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CareFacebookClient, type CareAutoReplyScript } from './care-facebook-client';
import type { NativeMarketingTokenProvider } from '../marketing/native-marketing-client';

const ROOT = 'https://api.izziapi.com/api/marketing/care/facebook';
const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'test-supabase-access-token';
const ISO = '2026-11-18T10:00:00.000Z';

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

const STATE = {
  enabled: true,
  enabledAt: ISO,
  available: true,
  scriptUpdatedAt: ISO,
  factCount: 2,
  sentLast24h: 3,
  lastSentAt: ISO,
  stoppedLast24h: 1,
  lastProblem: { reason: 'standby', at: ISO },
};
const SCRIPT: CareAutoReplyScript = {
  facts: [{ id: 'gia', topic: 'price', text: 'Giá 12.500.000đ', approvedAt: ISO, expiresAt: null }],
};

afterEach(() => vi.restoreAllMocks());

describe('CareFacebookClient Phase C requests', () => {
  it('reads the state for the workspace, or null without a Page', async () => {
    const read = client(json({ success: true, workspaceId: WORKSPACE, autoReply: STATE }));
    expect(await read.instance.getAutoReply(WORKSPACE)).toEqual({ ok: true, value: STATE });
    expect(call(read.fetchImpl)[0]).toBe(`${ROOT}/auto-reply?workspaceId=${WORKSPACE}`);

    const none = client(json({ success: true, workspaceId: WORKSPACE, autoReply: null }));
    expect(await none.instance.getAutoReply(WORKSPACE)).toEqual({ ok: true, value: null });
  });

  it('turns it on with the script in the body and the token in the header only', async () => {
    const write = client(json({ success: true, workspaceId: WORKSPACE, autoReply: STATE }));
    expect(await write.instance.setAutoReply(WORKSPACE, true, SCRIPT)).toEqual({ ok: true, value: STATE });
    const [url, init] = call(write.fetchImpl);
    expect(url).toBe(`${ROOT}/auto-reply`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ workspaceId: WORKSPACE, enabled: true, script: SCRIPT });
    expect(String(init.body)).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('turns it off without a script, and the answer must match the request', async () => {
    const off = client(json({ success: true, workspaceId: WORKSPACE, autoReply: { ...STATE, enabled: false, enabledAt: null } }));
    expect((await off.instance.setAutoReply(WORKSPACE, false, null)).ok).toBe(true);
    expect(JSON.parse(String(call(off.fetchImpl)[1].body))).toEqual({ workspaceId: WORKSPACE, enabled: false });

    const mismatch = client(json({ success: true, workspaceId: WORKSPACE, autoReply: STATE }));
    expect(await mismatch.instance.setAutoReply(WORKSPACE, false, null)).toEqual({ ok: false, error: 'invalid-response' });
  });

  it('refuses invalid input without calling the server', async () => {
    const { instance, fetchImpl } = client(json({}));
    expect((await instance.getAutoReply('nope')).ok).toBe(false);
    expect((await instance.setAutoReply(WORKSPACE, true, null)).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps an unknown problem code as unknown instead of rejecting the state', async () => {
    const odd = client(json({ success: true, workspaceId: WORKSPACE, autoReply: { ...STATE, lastProblem: { reason: 'new_meta_code', at: ISO } } }));
    expect(await odd.instance.getAutoReply(WORKSPACE)).toEqual({
      ok: true,
      value: { ...STATE, lastProblem: { reason: 'unknown', at: ISO } },
    });
  });

  it.each([
    ['another workspace', { success: true, workspaceId: OTHER_WORKSPACE, autoReply: STATE }],
    ['an extra field', { success: true, workspaceId: WORKSPACE, autoReply: { ...STATE, pageAccessToken: 'x' } }],
    ['a negative count', { success: true, workspaceId: WORKSPACE, autoReply: { ...STATE, sentLast24h: -1 } }],
    ['a non-ISO time', { success: true, workspaceId: WORKSPACE, autoReply: { ...STATE, enabledAt: 'yesterday' } }],
    ['a missing field', { success: true, workspaceId: WORKSPACE, autoReply: { enabled: true } }],
  ])('rejects an answer with %s', async (_label, body) => {
    expect(await client(json(body)).instance.getAutoReply(WORKSPACE)).toEqual({ ok: false, error: 'invalid-response' });
  });

  it('passes the bounded Phase C refusal reasons through', async () => {
    for (const reason of ['inbox_off', 'permission_missing', 'page_not_connected']) {
      const refused = client(json({ success: false, error: 'No Facebook Page available', reason }, 422));
      expect(await refused.instance.setAutoReply(WORKSPACE, true, SCRIPT)).toEqual({ ok: false, error: 'rejected', reason });
    }
  });
});
