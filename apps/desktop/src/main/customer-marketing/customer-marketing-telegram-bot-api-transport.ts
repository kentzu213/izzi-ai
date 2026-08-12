import type { CustomerMarketingTelegramSandboxTransport } from './customer-marketing-telegram-sandbox-connector';

export interface CustomerMarketingTelegramBotApiResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type CustomerMarketingTelegramBotApiFetch = (
  url: string,
  init: {
    method: 'POST';
    headers: { 'content-type': 'application/json' };
    body: string;
    signal: AbortSignal;
  },
) => Promise<CustomerMarketingTelegramBotApiResponse>;

export interface CustomerMarketingTelegramBotApiTransportOptions {
  fetcher?: CustomerMarketingTelegramBotApiFetch;
  timeoutMs?: number;
}

const TOKEN_PATTERN = /^[1-9][0-9]{5,15}:[A-Za-z0-9_-]{30,128}$/;
const CHAT_ID_PATTERN = /^-100[1-9][0-9]{5,19}$/;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 64 * 1024;

export class CustomerMarketingTelegramBotApiTransport implements CustomerMarketingTelegramSandboxTransport {
  private readonly fetcher: CustomerMarketingTelegramBotApiFetch;
  private readonly timeoutMs: number;

  constructor(options: CustomerMarketingTelegramBotApiTransportOptions = {}) {
    this.fetcher = options.fetcher ?? (fetch as unknown as CustomerMarketingTelegramBotApiFetch);
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new Error('Invalid Telegram Bot API timeout.');
    }
    this.timeoutMs = timeoutMs;
  }

  async validateCredential(secret: string): Promise<{ ok: boolean }> {
    if (!TOKEN_PATTERN.test(secret)) return { ok: false };
    const response = await this.request(secret, 'getMe', {});
    if (!response) return { ok: false };
    const result = asRecord(response.result);
    return { ok: result?.is_bot === true && isSafeTelegramId(result.id) };
  }

  async sendPrivateMessage(
    secret: string,
    input: { chatId: string; text: string },
  ): Promise<{ ok: boolean }> {
    if (!TOKEN_PATTERN.test(secret)
      || !CHAT_ID_PATTERN.test(input.chatId)
      || input.text !== input.text.trim()
      || input.text.length < 1
      || input.text.length > 4_096
      || /[\u0000\u007f]/.test(input.text)) return { ok: false };

    const response = await this.request(secret, 'sendMessage', {
      chat_id: input.chatId,
      text: input.text,
    });
    if (!response) return { ok: false };
    const result = asRecord(response.result);
    return { ok: typeof result?.message_id === 'number' && Number.isSafeInteger(result.message_id) };
  }

  private async request(
    secret: string,
    method: 'getMe' | 'sendMessage',
    body: Record<string, string>,
  ): Promise<Record<string, unknown> | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(`https://api.telegram.org/bot${secret}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok || response.status < 200 || response.status >= 300) return null;
      const contentLength = response.headers.get('content-length');
      if (contentLength !== null) {
        const parsedLength = Number(contentLength);
        if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > MAX_RESPONSE_BYTES) return null;
      }
      const raw = await response.text();
      if (Buffer.byteLength(raw, 'utf8') > MAX_RESPONSE_BYTES) return null;
      const parsed = JSON.parse(raw) as unknown;
      const envelope = asRecord(parsed);
      return envelope?.ok === true ? envelope : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isSafeTelegramId(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
