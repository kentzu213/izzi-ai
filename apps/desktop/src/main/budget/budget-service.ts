import type { DatabaseManager } from '../db/database';

export interface BudgetLimits {
  daily: number;
  weekly: number;
  monthly: number;
}

export interface BudgetPeriod {
  used: number;
  limit: number;
  percent: number;
  exceeded: boolean;
}

export interface BudgetStatus {
  daily: BudgetPeriod;
  weekly: BudgetPeriod;
  monthly: BudgetPeriod;
  totalSpent: number;
  totalRequests: number;
  avgCostPerRequest: number;
  modelBreakdown: Record<string, { count: number; costUSD: number }>;
}

export interface BudgetAlert {
  period: keyof BudgetLimits;
  used: number;
  limit: number;
  percent: number;
  exceeded: boolean;
  timestamp: string;
}

export interface BudgetAdvice {
  tier: 'free' | 'pro' | 'max';
  reasonVi: string;
}

export interface BudgetUsageEntry {
  id: string;
  model: string;
  costUSD: number;
  timestamp: string;
}

export interface BudgetStore {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  getUserData(type: string): unknown[];
  cacheUserData(id: string, type: string, data: object): void;
  deleteUserData(id: string): void;
}

const LIMITS_KEY = 'budget:limits';
const ENTRY_TYPE = 'budget_entry';
const DEFAULT_LIMITS: BudgetLimits = { daily: 1, weekly: 5, monthly: 15 };

function finiteMoney(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value * 1_000_000) / 1_000_000
    : fallback;
}

function normalizeLimits(value: unknown): BudgetLimits {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    daily: finiteMoney(input.daily, DEFAULT_LIMITS.daily),
    weekly: finiteMoney(input.weekly, DEFAULT_LIMITS.weekly),
    monthly: finiteMoney(input.monthly, DEFAULT_LIMITS.monthly),
  };
}

function parseEntry(value: unknown): BudgetUsageEntry | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (typeof input.id !== 'string' || typeof input.model !== 'string' || typeof input.timestamp !== 'string') {
    return null;
  }
  const timestamp = Date.parse(input.timestamp);
  if (!Number.isFinite(timestamp)) return null;
  return {
    id: input.id,
    model: input.model.trim() || 'unknown',
    costUSD: finiteMoney(input.costUSD),
    timestamp: new Date(timestamp).toISOString(),
  };
}

function period(entries: BudgetUsageEntry[], limit: number, days: number, now: number): BudgetPeriod {
  const since = now - days * 24 * 60 * 60 * 1_000;
  const used = entries
    .filter((entry) => Date.parse(entry.timestamp) >= since)
    .reduce((total, entry) => total + entry.costUSD, 0);
  const roundedUsed = Math.round(used * 1_000_000) / 1_000_000;
  const percent = limit > 0 ? Math.round((roundedUsed / limit) * 100) : roundedUsed > 0 ? 100 : 0;
  return { used: roundedUsed, limit, percent, exceeded: roundedUsed > limit };
}

export class BudgetService {
  private readonly store: BudgetStore;

  constructor(store: BudgetStore | DatabaseManager) {
    this.store = store;
  }

  getLimits(): BudgetLimits {
    const raw = this.store.getSetting(LIMITS_KEY);
    if (!raw) return { ...DEFAULT_LIMITS };
    try {
      return normalizeLimits(JSON.parse(raw));
    } catch {
      return { ...DEFAULT_LIMITS };
    }
  }

  setLimits(input: Partial<BudgetLimits>): BudgetLimits {
    const current = this.getLimits();
    const next = normalizeLimits({ ...current, ...input });
    this.store.setSetting(LIMITS_KEY, JSON.stringify(next));
    return next;
  }

  getStatus(now = Date.now()): BudgetStatus {
    const entries = this.readEntries();
    const limits = this.getLimits();
    const modelBreakdown: BudgetStatus['modelBreakdown'] = {};
    for (const entry of entries) {
      const current = modelBreakdown[entry.model] ?? { count: 0, costUSD: 0 };
      current.count += 1;
      current.costUSD = Math.round((current.costUSD + entry.costUSD) * 1_000_000) / 1_000_000;
      modelBreakdown[entry.model] = current;
    }
    const totalSpent = Math.round(entries.reduce((sum, entry) => sum + entry.costUSD, 0) * 1_000_000) / 1_000_000;
    return {
      daily: period(entries, limits.daily, 1, now),
      weekly: period(entries, limits.weekly, 7, now),
      monthly: period(entries, limits.monthly, 30, now),
      totalSpent,
      totalRequests: entries.length,
      avgCostPerRequest: entries.length > 0 ? Math.round((totalSpent / entries.length) * 1_000_000) / 1_000_000 : 0,
      modelBreakdown,
    };
  }

  getAlerts(since?: number): BudgetAlert[] {
    const status = this.getStatus();
    const timestamp = new Date().toISOString();
    const alerts: BudgetAlert[] = (['daily', 'weekly', 'monthly'] as const)
      .map((periodName) => ({ period: periodName, ...status[periodName], timestamp }))
      .filter((alert) => alert.percent >= 80);
    return typeof since === 'number' ? alerts.filter((alert) => Date.parse(alert.timestamp) >= since) : alerts;
  }

  getAdvice(): BudgetAdvice {
    const monthlyPercent = this.getStatus().monthly.percent;
    if (monthlyPercent >= 80) {
      return { tier: 'max', reasonVi: 'Mức dùng tháng đang cao; nên nâng gói hoặc giảm model đắt.' };
    }
    if (monthlyPercent >= 40) {
      return { tier: 'pro', reasonVi: 'Mức dùng tháng trung bình; gói Pro có thể phù hợp hơn.' };
    }
    return { tier: 'free', reasonVi: 'Mức dùng hiện tại thấp; tiếp tục theo dõi trước khi nâng gói.' };
  }

  purge(keepDays = 30): { removed: number } {
    const boundedDays = Number.isFinite(keepDays) ? Math.max(1, Math.min(Math.floor(keepDays), 3650)) : 30;
    const cutoff = Date.now() - boundedDays * 24 * 60 * 60 * 1_000;
    let removed = 0;
    for (const entry of this.readEntries()) {
      if (Date.parse(entry.timestamp) < cutoff) {
        this.store.deleteUserData(entry.id);
        removed += 1;
      }
    }
    return { removed };
  }

  recordUsage(input: { model: string; costUSD: number; timestamp?: string }): BudgetUsageEntry {
    const entry: BudgetUsageEntry = {
      id: `budget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      model: input.model.trim() || 'unknown',
      costUSD: finiteMoney(input.costUSD),
      timestamp: input.timestamp && Number.isFinite(Date.parse(input.timestamp))
        ? new Date(input.timestamp).toISOString()
        : new Date().toISOString(),
    };
    this.store.cacheUserData(entry.id, ENTRY_TYPE, entry);
    return entry;
  }

  private readEntries(): BudgetUsageEntry[] {
    return this.store.getUserData(ENTRY_TYPE)
      .map((value) => parseEntry(value))
      .filter((entry): entry is BudgetUsageEntry => entry !== null);
  }
}
