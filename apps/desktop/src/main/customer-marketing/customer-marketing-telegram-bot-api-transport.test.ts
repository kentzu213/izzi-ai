import { describe, expect, it, vi } from 'vitest';
import {
  CustomerMarketingTelegramBotApiTransport,
  type CustomerMarketingTelegramBotApiFetch,
  type CustomerMarketingTelegramBotApiResponse,
} from './customer-marketing-telegram-bot-api-transport';

const TOKEN = '123456789:abcdefghijklmnopqrstuvwxyz_ABCD123456';
const CHAT_ID = '-1001234567890';
const TEXT = 'IzziAPI private sandbox message';

function response(
  body: unknown,
  overrides: Partial<CustomerMarketingTelegramBotApiResponse> = {},
): CustomerMarketingTelegramBotApiResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: true,
    status: 200,
    headers: { get: () => String(Buffer.byteLength(text, 'utf8')) },
    text: async () => text,
    ...overrides,
  };
}

describe('Customer Marketing Telegram Bot API transport', () => {
  it('validates a bot token through getMe and returns only a boolean result', async () => {
    const calls: Array<{ url: string; init: Parameters<CustomerMarketingTelegramBotApiFetch>[1] }> = [];
    const fetcher: CustomerMarketingTelegramBotApiFetch = async (url, init) => {
      calls.push({ url, init });
      return response({ ok: true, result: { id: 123456789, is_bot: true } });
    };
    const transport = new CustomerMarketingTelegramBotApiTransport({ fetcher });

    const result = await transport.validateCredential(TOKEN);

    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/getMe`);
    expect(calls[0].init).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('sends JSON to sendMessage without parse mode or optional paid features', async () => {
    const calls: Array<{ url: string; init: Parameters<CustomerMarketingTelegramBotApiFetch>[1] }> = [];
    const fetcher: CustomerMarketingTelegramBotApiFetch = async (url, init) => {
      calls.push({ url, init });
      return response({ ok: true, result: { message_id: 42 } });
    };
    const transport = new CustomerMarketingTelegramBotApiTransport({ fetcher });

    const result = await transport.sendPrivateMessage(TOKEN, { chatId: CHAT_ID, text: TEXT });

    expect(result).toEqual({ ok: true });
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(JSON.parse(calls[0].init.body)).toEqual({ chat_id: CHAT_ID, text: TEXT });
    expect(JSON.parse(calls[0].init.body)).not.toHaveProperty('parse_mode');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(CHAT_ID);
    expect(JSON.stringify(result)).not.toContain(TEXT);
  });

  it('rejects malformed credentials and messages before making a request', async () => {
    const fetcher = vi.fn<CustomerMarketingTelegramBotApiFetch>();
    const transport = new CustomerMarketingTelegramBotApiTransport({ fetcher });

    await expect(transport.validateCredential('bad-token')).resolves.toEqual({ ok: false });
    await expect(transport.sendPrivateMessage(TOKEN, { chatId: 'public-channel', text: TEXT }))
      .resolves.toEqual({ ok: false });
    await expect(transport.sendPrivateMessage(TOKEN, { chatId: CHAT_ID, text: '' }))
      .resolves.toEqual({ ok: false });
    await expect(transport.sendPrivateMessage(TOKEN, { chatId: CHAT_ID, text: 'x'.repeat(4_097) }))
      .resolves.toEqual({ ok: false });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ['HTTP failure', response({ ok: false }, { ok: false, status: 429 })],
    ['API failure', response({ ok: false, description: 'rate limited' })],
    ['invalid JSON', response('not-json')],
    ['wrong getMe result', response({ ok: true, result: { id: 123, is_bot: false } })],
  ])('fails closed for %s without exposing response details', async (_label, apiResponse) => {
    const transport = new CustomerMarketingTelegramBotApiTransport({
      fetcher: async () => apiResponse,
    });

    await expect(transport.validateCredential(TOKEN)).resolves.toEqual({ ok: false });
  });

  it('rejects oversized responses before reading their body', async () => {
    const read = vi.fn(async () => JSON.stringify({ ok: true, result: { id: 1, is_bot: true } }));
    const transport = new CustomerMarketingTelegramBotApiTransport({
      fetcher: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => String(70 * 1024) },
        text: read,
      }),
    });

    await expect(transport.validateCredential(TOKEN)).resolves.toEqual({ ok: false });
    expect(read).not.toHaveBeenCalled();
  });

  it('aborts a stalled request at the configured timeout and returns a redacted failure', async () => {
    vi.useFakeTimers();
    try {
      const fetcher: CustomerMarketingTelegramBotApiFetch = async (_url, init) => (
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
        })
      );
      const transport = new CustomerMarketingTelegramBotApiTransport({ fetcher, timeoutMs: 1_000 });
      const pending = transport.validateCredential(TOKEN);

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(pending).resolves.toEqual({ ok: false });
      expect(JSON.stringify(await pending)).not.toContain(TOKEN);
    } finally {
      vi.useRealTimers();
    }
  });
});
