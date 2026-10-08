import { describe, expect, it } from 'vitest';
import {
  barPercent,
  defaultKeyName,
  fmtCost,
  fmtCredits,
  fmtTokens,
  lastSevenDays,
  mergeOverview,
  overviewHint,
} from './apiUsageFormat';

describe('apiUsageFormat', () => {
  it('formats balance as dollars with two decimals and a dash when unknown', () => {
    expect(fmtCredits(12.345)).toBe('$12.35');
    expect(fmtCredits(0)).toBe('$0.00');
    expect(fmtCredits(null)).toBe('—');
  });

  it('formats per-request cost with four decimals', () => {
    expect(fmtCost(0.00123)).toBe('$0.0012');
  });

  it('compacts token counts', () => {
    expect(fmtTokens(950)).toBe('950');
    expect(fmtTokens(12_340)).toBe('12.3K');
    expect(fmtTokens(2_500_000)).toBe('2.5M');
  });

  it('fills the seven UTC days ending today, zeroing days without usage', () => {
    const today = new Date('2026-10-07T03:00:00Z');

    const days = lastSevenDays([{ day: '2026-10-05', cost: 0.5 }, { day: '2026-09-01', cost: 9 }], today);

    expect(days.map((d) => d.day)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
    ]);
    expect(days.find((d) => d.day === '2026-10-05')?.cost).toBe(0.5);
    expect(days.filter((d) => d.cost === 0)).toHaveLength(6);
  });

  it('scales bars to the max, keeping a visible sliver for tiny non-zero costs', () => {
    expect(barPercent(5, 10)).toBe(50);
    expect(barPercent(0.0001, 10)).toBe(2);
    expect(barPercent(0, 10)).toBe(0);
    expect(barPercent(0, 0)).toBe(0);
  });

  it('names a new key after the app and the date', () => {
    expect(defaultKeyName(new Date('2026-10-07T03:00:00Z'))).toMatch(/^Izzi AI Desktop – .*2026/);
  });

  it('explains each overview failure in Vietnamese and stays silent on success', () => {
    expect(overviewHint(undefined)).toBeNull();
    expect(overviewHint('not-signed-in')).toContain('Đăng nhập');
    expect(overviewHint('unauthorized')).toContain('Đăng nhập');
    expect(overviewHint('forbidden')).toContain('email');
    expect(overviewHint('network')).toContain('chưa cập nhật');
  });
});

describe('mergeOverview', () => {
  const oldKey = { id: 'k-a' } as IzziApiKey;
  const good: IzziOverview = {
    ok: true,
    balance: 12,
    plan: 'pro',
    stats: null,
    keys: [oldKey],
    inUseKeyId: 'k-a',
    managedKeyId: 'k-m',
  };
  const empty: IzziOverview = {
    ok: false,
    balance: null,
    plan: null,
    stats: null,
    keys: null,
    inUseKeyId: null,
    managedKeyId: null,
  };

  it('returns the fresh overview on first load or when the failure is not a network one', () => {
    const network: IzziOverview = { ...empty, reason: 'network' };
    const unauthorized: IzziOverview = { ...empty, reason: 'unauthorized' };

    expect(mergeOverview(null, network)).toBe(network);
    expect(mergeOverview(good, unauthorized)).toBe(unauthorized);
  });

  it('shows fresh keys after a revoke even when the balance call hit a network error', () => {
    const next: IzziOverview = { ...empty, reason: 'network', keys: [], inUseKeyId: null, managedKeyId: null };

    const merged = mergeOverview(good, next);

    expect(merged.keys).toEqual([]);
    expect(merged.inUseKeyId).toBeNull();
    expect(merged.managedKeyId).toBeNull();
    expect(merged.balance).toBe(12);
    expect(merged.plan).toBe('pro');
    expect(merged.reason).toBe('network');
  });

  it('keeps the last good keys when only the keys call hit a network error', () => {
    const next: IzziOverview = { ...empty, reason: 'network', balance: 9, plan: 'free' };

    const merged = mergeOverview(good, next);

    expect(merged.balance).toBe(9);
    expect(merged.plan).toBe('free');
    expect(merged.keys).toEqual([oldKey]);
    expect(merged.inUseKeyId).toBe('k-a');
    expect(merged.managedKeyId).toBe('k-m');
  });
});
