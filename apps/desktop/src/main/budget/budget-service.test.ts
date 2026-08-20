import { describe, expect, it } from 'vitest';
import { BudgetService, type BudgetStore } from './budget-service';

function createStore(): BudgetStore & { settings: Map<string, string>; rows: Map<string, object> } {
  const settings = new Map<string, string>();
  const rows = new Map<string, object>();
  return {
    settings,
    rows,
    getSetting: (key) => settings.get(key) ?? null,
    setSetting: (key, value) => settings.set(key, value),
    getUserData: () => [...rows.values()],
    cacheUserData: (id, _type, data) => rows.set(id, data),
    deleteUserData: (id) => rows.delete(id),
  };
}

describe('BudgetService', () => {
  it('persists limits and computes rolling status from local entries', () => {
    const store = createStore();
    const service = new BudgetService(store);
    const now = Date.parse('2026-08-21T12:00:00.000Z');
    service.setLimits({ daily: 1, weekly: 2, monthly: 10 });
    service.recordUsage({ model: 'gpt-5.6-sol', costUSD: 0.75, timestamp: '2026-08-21T10:00:00.000Z' });
    service.recordUsage({ model: 'gpt-5.6-sol', costUSD: 0.5, timestamp: '2026-08-20T10:00:00.000Z' });

    const status = service.getStatus(now);
    expect(status.daily).toEqual({ used: 0.75, limit: 1, percent: 75, exceeded: false });
    expect(status.weekly).toEqual({ used: 1.25, limit: 2, percent: 63, exceeded: false });
    expect(status.totalRequests).toBe(2);
    expect(status.modelBreakdown['gpt-5.6-sol']).toEqual({ count: 2, costUSD: 1.25 });
  });

  it('purges only entries older than the requested retention window', () => {
    const store = createStore();
    const service = new BudgetService(store);
    service.recordUsage({ model: 'old', costUSD: 1, timestamp: '2026-07-01T00:00:00.000Z' });
    service.recordUsage({ model: 'new', costUSD: 1, timestamp: '2026-08-20T00:00:00.000Z' });

    expect(service.purge(30)).toEqual({ removed: 1 });
    expect(service.getStatus(Date.parse('2026-08-21T00:00:00.000Z')).totalRequests).toBe(1);
  });
});
