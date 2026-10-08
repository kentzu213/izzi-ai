import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerIzziAccountIpc } from './izzi-account-ipc';
import type { IzziAccountClient } from './izzi-account-client';
import { IZZI_WEB_BASE } from '../config/public-config';

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

function register() {
  const client = {
    getOverview: vi.fn().mockResolvedValue({ ok: true }),
    getRecentUsage: vi.fn().mockResolvedValue({ ok: true, rows: [], hasMore: false }),
    createKey: vi.fn().mockResolvedValue({ success: true }),
    revokeKey: vi.fn().mockResolvedValue({ success: true, wasInUse: false, wasManaged: false }),
  };
  registerIzziAccountIpc(client as unknown as IzziAccountClient);
  return client;
}

describe('registerIzziAccountIpc', () => {
  beforeEach(() => {
    handlers.clear();
    openExternal.mockReset();
  });

  it('delegates data channels to the client', async () => {
    const client = register();

    await handlers.get('izziAccount:overview')!({});
    await handlers.get('izziAccount:recentUsage')!({}, 40);
    await handlers.get('izziAccount:createKey')!({}, 'Desktop');
    await handlers.get('izziAccount:revokeKey')!({}, 'k-1');

    expect(client.getOverview).toHaveBeenCalledOnce();
    expect(client.getRecentUsage).toHaveBeenCalledWith(40);
    expect(client.createKey).toHaveBeenCalledWith('Desktop');
    expect(client.revokeKey).toHaveBeenCalledWith('k-1');
  });

  it('opens the dashboard and billing pages on the izzi web base', async () => {
    openExternal.mockResolvedValue(undefined);
    register();

    const dashboard = await handlers.get('izziAccount:openDashboard')!({});
    const topUp = await handlers.get('izziAccount:openTopUp')!({});

    expect(openExternal).toHaveBeenNthCalledWith(1, `${IZZI_WEB_BASE}/dashboard`);
    expect(openExternal).toHaveBeenNthCalledWith(2, `${IZZI_WEB_BASE}/dashboard/billing`);
    expect(dashboard).toEqual({ ok: true });
    expect(topUp).toEqual({ ok: true });
  });

  it('resolves { ok: false } and logs only the error class when the browser fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    openExternal.mockRejectedValue(new TypeError('RAW-OS-ERROR C:\\Users\\someone'));
    register();

    const result = await handlers.get('izziAccount:openTopUp')!({});

    expect(result).toEqual({ ok: false });
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('RAW-OS-ERROR');
  });
});
