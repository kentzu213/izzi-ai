import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerBudgetIpc } from './budget-ipc';

const handlers = new Map<string, (...args: any[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));

describe('budget IPC bridge', () => {
  beforeEach(() => {
    handlers.clear();
  });

  it('registers every renderer budget channel', () => {
    const service = {
      getStatus: vi.fn(),
      getLimits: vi.fn(),
      setLimits: vi.fn(),
      getAlerts: vi.fn(),
      getAdvice: vi.fn(),
      purge: vi.fn(),
    };

    registerBudgetIpc(service);

    expect([...handlers.keys()]).toEqual([
      'budget:getStatus',
      'budget:getLimits',
      'budget:setLimits',
      'budget:getAlerts',
      'budget:getAdvice',
      'budget:purge',
    ]);
  });

  it('delegates calls without exposing the service to the renderer', async () => {
    const service = {
      getStatus: vi.fn().mockResolvedValue({ totalSpent: 0 }),
      getLimits: vi.fn().mockResolvedValue({ daily: 1, weekly: 5, monthly: 15 }),
      setLimits: vi.fn().mockResolvedValue({ daily: 2, weekly: 8, monthly: 20 }),
      getAlerts: vi.fn().mockResolvedValue([]),
      getAdvice: vi.fn().mockResolvedValue({ tier: 'free', reasonVi: 'ok' }),
      purge: vi.fn().mockResolvedValue({ removed: 2 }),
    };

    registerBudgetIpc(service);
    const event = {};

    await expect(handlers.get('budget:getStatus')!(event)).resolves.toEqual({ totalSpent: 0 });
    await expect(handlers.get('budget:getLimits')!(event)).resolves.toEqual({ daily: 1, weekly: 5, monthly: 15 });
    await expect(handlers.get('budget:setLimits')!(event, { daily: 2 })).resolves.toEqual({ daily: 2, weekly: 8, monthly: 20 });
    await expect(handlers.get('budget:getAlerts')!(event, 123)).resolves.toEqual([]);
    await expect(handlers.get('budget:getAdvice')!(event)).resolves.toEqual({ tier: 'free', reasonVi: 'ok' });
    await expect(handlers.get('budget:purge')!(event, 30)).resolves.toEqual({ removed: 2 });

    expect(service.setLimits).toHaveBeenCalledWith({ daily: 2 });
    expect(service.getAlerts).toHaveBeenCalledWith(123);
    expect(service.purge).toHaveBeenCalledWith(30);
  });
});
