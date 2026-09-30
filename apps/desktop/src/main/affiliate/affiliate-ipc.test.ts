import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAffiliateIpc } from './affiliate-ipc';
import type { AffiliateClient } from './affiliate-client';

const handlers = new Map<string, (...args: any[]) => unknown>();
const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
  shell: { openExternal },
}));

const WEB_URL = 'https://izziapi.com/dashboard/affiliate';

function register(): void {
  const client = { affiliateWebUrl: () => WEB_URL } as unknown as AffiliateClient;
  registerAffiliateIpc(client);
}

describe('affiliate:openWeb (ledger #25)', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    handlers.clear();
    openExternal.mockReset();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('returns ok with the main-built url when the browser opens', async () => {
    openExternal.mockResolvedValue(undefined);
    register();

    const result = await handlers.get('affiliate:openWeb')!();

    expect(openExternal).toHaveBeenCalledWith(WEB_URL);
    expect(result).toEqual({ ok: true, url: WEB_URL });
    expect(warn).not.toHaveBeenCalled();
  });

  it('resolves { ok: false } instead of rejecting when openExternal fails', async () => {
    openExternal.mockRejectedValue(new TypeError('RAW-OS-ERROR C:\\Users\\someone'));
    register();

    const result = await handlers.get('affiliate:openWeb')!();

    expect(result).toEqual({ ok: false });
  });

  it('logs only the error class, never the message', async () => {
    openExternal.mockRejectedValue(new TypeError('RAW-OS-ERROR C:\\Users\\someone'));
    register();

    await handlers.get('affiliate:openWeb')!();

    const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toBe('[AffiliateIpc] openWeb: TypeError');
    expect(logged).not.toContain('RAW-OS-ERROR');
  });

  it('handles a non-Error rejection without leaking it', async () => {
    openExternal.mockRejectedValue('RAW-STRING');
    register();

    const result = await handlers.get('affiliate:openWeb')!();

    expect(result).toEqual({ ok: false });
    const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toBe('[AffiliateIpc] openWeb: error');
  });
});
