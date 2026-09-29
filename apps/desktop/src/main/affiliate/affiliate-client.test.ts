import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AffiliateClient, MIN_WITHDRAW_VND, bankInfoError, mutationErrorMessage, type WithdrawInput,
} from './affiliate-client';
import type { AuthManager } from '../auth/auth-manager';
import { IZZI_API_BASE } from '../config/public-config';

/**
 * AffiliateClient — main-process money flow. `fetch` is stubbed and AuthManager
 * is faked, so no request leaves the test and no real withdrawal is sent.
 */

const TOKEN = 'test-jwt-SUPERSECRET-do-not-leak-abc123';
const BANK = { bank: 'Vietcombank', accountNo: '0123456789', accountName: 'NGUYEN VAN A' };
const MIN_ERROR = `Tối thiểu ${MIN_WITHDRAW_VND.toLocaleString('vi-VN')} VND`;

function fakeAuth(token: string | null): AuthManager {
  return { getAccessToken: vi.fn().mockResolvedValue(token) } as unknown as AuthManager;
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function stubFetch(impl: (url: string) => unknown = () => jsonResponse(200, { success: true })) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => impl(url));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof stubFetch>): unknown {
  const init = fetchMock.mock.calls[0][1] as unknown as RequestInit;
  return JSON.parse(String(init.body));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('bankInfoError', () => {
  it('accepts well-formed bank details, trimming whitespace', () => {
    expect(bankInfoError(BANK)).toBeNull();
    expect(bankInfoError({ bank: ' VCB ', accountNo: ' 123456 ', accountName: ' A ' })).toBeNull();
  });

  it('rejects missing, blank or non-string fields', () => {
    expect(bankInfoError(undefined)).toBe('Vui lòng nhập đủ thông tin ngân hàng');
    expect(bankInfoError(null)).toBe('Vui lòng nhập đủ thông tin ngân hàng');
    expect(bankInfoError({ ...BANK, bank: '   ' })).toBe('Vui lòng nhập đủ thông tin ngân hàng');
    expect(bankInfoError({ ...BANK, accountNo: 123456789 })).toBe('Vui lòng nhập đủ thông tin ngân hàng');
  });

  it('requires the account number to be 6 to 20 digits', () => {
    expect(bankInfoError({ ...BANK, accountNo: '12345' })).toBe('Số tài khoản chỉ gồm 6–20 chữ số');
    expect(bankInfoError({ ...BANK, accountNo: '1'.repeat(21) })).toBe('Số tài khoản chỉ gồm 6–20 chữ số');
    expect(bankInfoError({ ...BANK, accountNo: '0123-456789' })).toBe('Số tài khoản chỉ gồm 6–20 chữ số');
    expect(bankInfoError({ ...BANK, accountNo: '1'.repeat(20) })).toBeNull();
  });

  it('caps the bank and account holder names at 100 characters', () => {
    expect(bankInfoError({ ...BANK, bank: 'x'.repeat(101) })).toBe('Tên ngân hàng hoặc chủ tài khoản quá dài');
    expect(bankInfoError({ ...BANK, accountName: 'x'.repeat(101) })).toBe('Tên ngân hàng hoặc chủ tài khoản quá dài');
    expect(bankInfoError({ ...BANK, accountName: 'x'.repeat(100) })).toBeNull();
  });

  it('ignores inherited properties', () => {
    expect(bankInfoError(Object.create(BANK))).toBe('Vui lòng nhập đủ thông tin ngân hàng');
  });
});

describe('AffiliateClient.withdraw', () => {
  it.each<[string, unknown, string]>([
    ['a null payload', null, MIN_ERROR],
    ['an amount below the minimum', { amount: MIN_WITHDRAW_VND - 1, method: 'credit_convert' }, MIN_ERROR],
    ['a NaN amount', { amount: Number.NaN, method: 'credit_convert' }, MIN_ERROR],
    ['a string amount', { amount: '900000', method: 'credit_convert' }, MIN_ERROR],
    ['an unknown method', { amount: MIN_WITHDRAW_VND, method: 'crypto' }, 'Phương thức không hợp lệ'],
    ['a bank transfer without bank details', { amount: MIN_WITHDRAW_VND, method: 'bank_transfer' },
      'Vui lòng nhập đủ thông tin ngân hàng'],
    ['a malformed account number', { amount: MIN_WITHDRAW_VND, method: 'bank_transfer',
      bankInfo: { ...BANK, accountNo: 'abc123' } }, 'Số tài khoản chỉ gồm 6–20 chữ số'],
  ])('rejects %s before any token read or network call', async (_label, input, error) => {
    const fetchMock = stubFetch();
    const auth = fakeAuth(TOKEN);

    const result = await new AffiliateClient(auth).withdraw(input as WithdrawInput);

    expect(result).toEqual({ success: false, error });
    expect(auth.getAccessToken).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not call the backend without a token', async () => {
    const fetchMock = stubFetch();

    const result = await new AffiliateClient(fakeAuth(null)).withdraw({
      amount: MIN_WITHDRAW_VND, method: 'bank_transfer', bankInfo: BANK,
    });

    expect(result).toEqual({ success: false, error: 'Chưa đăng nhập' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts a bank transfer with trimmed bank details and a bearer token', async () => {
    const fetchMock = stubFetch();

    const result = await new AffiliateClient(fakeAuth(TOKEN)).withdraw({
      amount: 600000,
      method: 'bank_transfer',
      bankInfo: { bank: ' Vietcombank ', accountNo: ' 0123456789 ', accountName: ' NGUYEN VAN A ' },
    });

    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${IZZI_API_BASE}/api/affiliate/withdraw`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` });
    expect(sentBody(fetchMock)).toEqual({ amount: 600000, method: 'bank_transfer', bankInfo: BANK });
  });

  it('sends no bank details for a credit conversion withdrawal', async () => {
    const fetchMock = stubFetch();

    await new AffiliateClient(fakeAuth(TOKEN)).withdraw({
      amount: MIN_WITHDRAW_VND, method: 'credit_convert', bankInfo: BANK,
    });

    expect(sentBody(fetchMock)).toEqual({ amount: MIN_WITHDRAW_VND, method: 'credit_convert' });
  });

  it('maps a backend rejection to fixed text instead of the backend error (ledger #25)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch(() => jsonResponse(400, { success: false, error: 'Số dư không đủ' }));

    const result = await new AffiliateClient(fakeAuth(TOKEN)).withdraw({
      amount: MIN_WITHDRAW_VND, method: 'bank_transfer', bankInfo: BANK,
    });

    expect(result).toEqual({ success: false, error: mutationErrorMessage(400) });
    expect(result.success ? '' : result.error).not.toContain('Số dư không đủ');
  });

  it('never forwards or logs raw backend error text (HTML, stack, echoed bank data)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const leaky = `<html>TypeError: boom\n    at withdraw (/srv/app.js:42) ${BANK.accountNo} ${'x'.repeat(5000)}</html>`;
    stubFetch(() => jsonResponse(500, { success: false, error: leaky }));

    const result = await new AffiliateClient(fakeAuth(TOKEN)).withdraw({
      amount: MIN_WITHDRAW_VND, method: 'bank_transfer', bankInfo: BANK,
    });

    expect(result).toEqual({ success: false, error: 'Yêu cầu thất bại' });
    const logged = warn.mock.calls.flat().join('\n');
    expect(logged).toContain('POST /api/affiliate/withdraw');
    expect(logged).toContain('status 500');
    for (const secret of ['<html>', 'TypeError', '/srv/app.js', BANK.accountNo, TOKEN]) {
      expect(logged).not.toContain(secret);
    }
  });

  it('maps session and rate-limit statuses to their own fixed messages', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const input: WithdrawInput = { amount: MIN_WITHDRAW_VND, method: 'bank_transfer', bankInfo: BANK };

    for (const status of [401, 403, 429]) {
      stubFetch(() => jsonResponse(status, { success: false, error: `backend ${status}` }));
      expect(await new AffiliateClient(fakeAuth(TOKEN)).withdraw(input))
        .toEqual({ success: false, error: mutationErrorMessage(status) });
    }
    expect(mutationErrorMessage(401)).toBe(mutationErrorMessage(403));
    expect(new Set([mutationErrorMessage(401), mutationErrorMessage(429), mutationErrorMessage(400),
      mutationErrorMessage(500)]).size).toBe(4);
    expect(mutationErrorMessage(404)).toBe('Yêu cầu thất bại');
  });

  it('fails closed when the response has no body or the request throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const input: WithdrawInput = { amount: MIN_WITHDRAW_VND, method: 'bank_transfer', bankInfo: BANK };

    stubFetch(() => ({ ok: false, status: 502, json: async () => { throw new Error('bad json'); } }));
    expect(await new AffiliateClient(fakeAuth(TOKEN)).withdraw(input))
      .toEqual({ success: false, error: 'Yêu cầu thất bại' });

    stubFetch(() => { throw new Error('network down'); });
    expect(await new AffiliateClient(fakeAuth(TOKEN)).withdraw(input))
      .toEqual({ success: false, error: 'Yêu cầu thất bại' });

    const logged = warn.mock.calls.flat().join('\n');
    expect(logged).toContain('status 502');
    expect(logged).not.toContain(TOKEN);
    expect(logged).not.toContain(BANK.accountNo);
    expect(logged).not.toContain('network down');
    expect(logged).not.toContain('bad json');
  });
});

describe('AffiliateClient.convertCredit', () => {
  it('rejects an amount below the minimum without a network call', async () => {
    const fetchMock = stubFetch();

    expect(await new AffiliateClient(fakeAuth(TOKEN)).convertCredit(MIN_WITHDRAW_VND - 1))
      .toEqual({ success: false, error: MIN_ERROR });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the amount and copies a numeric creditsAdded', async () => {
    const fetchMock = stubFetch(() => jsonResponse(200, { success: true, creditsAdded: 25 }));

    const result = await new AffiliateClient(fakeAuth(TOKEN)).convertCredit(MIN_WITHDRAW_VND);

    expect(result).toEqual({ success: true, creditsAdded: 25 });
    expect(fetchMock.mock.calls[0][0]).toBe(`${IZZI_API_BASE}/api/affiliate/convert-credit`);
    expect(sentBody(fetchMock)).toEqual({ amount: MIN_WITHDRAW_VND });
  });

  it('ignores a non-numeric creditsAdded', async () => {
    stubFetch(() => jsonResponse(200, { success: true, creditsAdded: '25' }));

    expect(await new AffiliateClient(fakeAuth(TOKEN)).convertCredit(MIN_WITHDRAW_VND)).toEqual({ success: true });
  });
});

describe('AffiliateClient reads', () => {
  const code = { success: true, code: 'IZZI42', referralLink: 'https://izziapi.com/r/IZZI42' };
  const stats = { success: true, totalReferrals: 3, pendingVnd: 100000, availableVnd: 600000,
    paidVnd: 0, totalEarningsVnd: 'x' };
  const byPath = (codeBody: unknown, statsBody: unknown) => (url: string) =>
    jsonResponse(200, url.endsWith('/code') ? codeBody : statsBody);

  it('merges code and stats, zeroing non-numeric amounts', async () => {
    stubFetch(byPath(code, stats));

    expect(await new AffiliateClient(fakeAuth(TOKEN)).getStats()).toEqual({
      code: 'IZZI42',
      referralLink: 'https://izziapi.com/r/IZZI42',
      totalReferrals: 3,
      pendingVnd: 100000,
      availableVnd: 600000,
      paidVnd: 0,
      totalEarningsVnd: 0,
    });
  });

  it('returns null stats when either endpoint does not report success', async () => {
    stubFetch(byPath({ ...code, success: false }, stats));
    expect(await new AffiliateClient(fakeAuth(TOKEN)).getStats()).toBeNull();

    stubFetch(byPath(code, { ...stats, success: 'true' }));
    expect(await new AffiliateClient(fakeAuth(TOKEN)).getStats()).toBeNull();
  });

  it('returns empty results without a token and on 401', async () => {
    const fetchMock = stubFetch();
    const anon = new AffiliateClient(fakeAuth(null));
    expect(await anon.getStats()).toBeNull();
    expect(await anon.listCommissions()).toEqual([]);
    expect(await anon.listWithdrawals()).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();

    stubFetch(() => jsonResponse(401, { error: 'unauthorized' }));
    const client = new AffiliateClient(fakeAuth(TOKEN));
    expect(await client.getStats()).toBeNull();
    expect(await client.listCommissions()).toEqual([]);
    expect(await client.listWithdrawals()).toEqual([]);
  });

  it('maps commission and withdrawal rows defensively', async () => {
    stubFetch((url) => jsonResponse(200, url.endsWith('/commissions')
      ? { commissions: [{ id: 'c1', referred_email: 'a@example.com', amount_vnd: 1000000,
        commission_vnd: '200000', status: 'available', created_at: '2026-09-01' }] }
      : { withdrawals: [
        { id: 'w1', amount_vnd: 600000, method: 'bank_transfer', status: 'pending', created_at: '', admin_note: '' },
        { id: 'w2', amount_vnd: 500000, method: 'credit_convert', status: 'rejected', created_at: '', admin_note: 'Sai' },
      ] }));
    const client = new AffiliateClient(fakeAuth(TOKEN));

    expect(await client.listCommissions()).toEqual([{ id: 'c1', referred_email: 'a@example.com',
      amount_vnd: 1000000, commission_vnd: 0, status: 'available', available_at: '', created_at: '2026-09-01' }]);
    const withdrawals = await client.listWithdrawals();
    expect(withdrawals[0].admin_note).toBeUndefined();
    expect(withdrawals[1].admin_note).toBe('Sai');
  });

  it('logs only the op and status on a server error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch(() => jsonResponse(500, {}));

    expect(await new AffiliateClient(fakeAuth(TOKEN)).listCommissions()).toEqual([]);

    const logged = warn.mock.calls.flat().join('\n');
    expect(logged).toBe('[AffiliateClient] GET /api/affiliate/commissions: request failed (status 500)');
    expect(logged).not.toContain(TOKEN);
  });

  it('never logs a raw backend body when a 200 response is not JSON (ledger #25)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const SENTINEL = 'BACKEND-INTERNAL-TRACE-xyz789';
    stubFetch(() => ({ ok: true, status: 200, json: async () => JSON.parse(`<!DOCTYPE html>${SENTINEL}`) }));
    const client = new AffiliateClient(fakeAuth(TOKEN));

    expect(await client.getStats()).toBeNull();
    expect(await client.listCommissions()).toEqual([]);
    expect(await client.listWithdrawals()).toEqual([]);

    const logged = warn.mock.calls.flat().join('\n');
    expect(logged).toContain('SyntaxError');
    expect(logged).not.toContain(SENTINEL);
    expect(logged).not.toContain('DOCTYPE');
    expect(logged).not.toContain(TOKEN);
  });

  it('logs only the error name when the request itself throws (ledger #25)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubFetch(() => { throw new TypeError(`connect ECONNREFUSED ${IZZI_API_BASE} secret-detail`); });

    expect(await new AffiliateClient(fakeAuth(TOKEN)).getStats()).toBeNull();

    const logged = warn.mock.calls.flat().join('\n');
    expect(logged).toBe('[AffiliateClient] affiliate.getStats: TypeError');
    expect(logged).not.toContain('secret-detail');
  });
});

describe('mutationErrorMessage (ledger #25)', () => {
  const SESSION = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  const RATE = 'Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại.';
  const REJECTED = 'Yêu cầu bị từ chối. Kiểm tra số tiền, số dư khả dụng và thông tin nhận tiền rồi thử lại.';

  it.each<[number, string]>([
    [401, SESSION], [403, SESSION], [429, RATE],
    [400, REJECTED], [409, REJECTED], [422, REJECTED],
    [404, 'Yêu cầu thất bại'], [500, 'Yêu cầu thất bại'], [502, 'Yêu cầu thất bại'], [0, 'Yêu cầu thất bại'],
  ])('maps status %i to a fixed Vietnamese message', (status, message) => {
    expect(mutationErrorMessage(status)).toBe(message);
  });

  it('never echoes the backend error text to the renderer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const input: WithdrawInput = { amount: MIN_WITHDRAW_VND, method: 'bank_transfer', bankInfo: BANK };

    for (const status of [400, 409, 422, 500]) {
      stubFetch(() => jsonResponse(status, { success: false, error: `RAW-BACKEND-${status} sql: select *` }));
      const result = await new AffiliateClient(fakeAuth(TOKEN)).withdraw(input);
      expect(result).toEqual({ success: false, error: mutationErrorMessage(status) });
      expect(JSON.stringify(result)).not.toContain('RAW-BACKEND');
    }
  });
});
