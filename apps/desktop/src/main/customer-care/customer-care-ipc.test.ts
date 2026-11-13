import { beforeEach, describe, expect, it, vi } from 'vitest';
const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
const trusted = vi.hoisted(() => vi.fn(() => true));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn((name, handler) => handlers.set(name, handler)) } }));
vi.mock('../marketing/marketing-ipc', () => ({ isTrustedMarketingSender: trusted }));
import { registerCustomerCareIpc } from './customer-care-ipc';

describe('customer care IPC boundary', () => {
  const service = {
    getSnapshot: vi.fn(), saveSetup: vi.fn(), assist: vi.fn(),
  };
  beforeEach(() => {
    handlers.clear(); vi.clearAllMocks(); trusted.mockReturnValue(true);
    registerCustomerCareIpc(service);
  });
  it('rejects untrusted senders on every channel before accessing data', async () => {
    trusted.mockReturnValue(false);
    for (const method of ['getSnapshot', 'saveSetup', 'assist'] as const) {
      await expect(handlers.get(`customerCare:${method}`)!({})).rejects.toThrow('Không thể truy cập');
      expect(service[method]).not.toHaveBeenCalled();
    }
    expect(handlers.size).toBe(3);
  });
  it('passes opaque inputs to the main service parser', async () => {
    const payload = { workspaceId: 'injected' };
    service.saveSetup.mockResolvedValue({ ok: false, error: 'invalid' });
    expect(await handlers.get('customerCare:saveSetup')!({}, payload)).toEqual({ ok: false, error: 'invalid' });
    expect(service.saveSetup).toHaveBeenCalledWith(payload);
  });
  it('redacts rejected service errors on all channels', async () => {
    for (const method of ['getSnapshot', 'saveSetup', 'assist'] as const) {
      service[method].mockRejectedValue(new Error('private database or provider details'));
      await expect(handlers.get(`customerCare:${method}`)!({})).rejects.toThrow(/^Không thể truy cập/);
    }
  });
});
