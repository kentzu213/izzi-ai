/** Pure display helpers for Settings → API & Usage. Amounts are izzi credits (≈ USD). */

const DAY_MS = 24 * 60 * 60 * 1000;
const CHART_DAYS = 7;
const MIN_BAR_PERCENT = 2;

export function fmtCredits(n: number | null): string {
  return n === null ? '—' : `$${n.toFixed(2)}`;
}

export function fmtCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** The backend buckets usage by UTC day (`created_at` split on "T"); fill the gaps with zero. */
export function lastSevenDays(
  daily: ReadonlyArray<{ day: string; cost: number }>,
  today: Date,
): Array<{ day: string; cost: number }> {
  const byDay = new Map(daily.map((d) => [d.day, d.cost] as const));
  return Array.from({ length: CHART_DAYS }, (_, i) => {
    const day = new Date(today.getTime() - (CHART_DAYS - 1 - i) * DAY_MS).toISOString().split('T')[0];
    return { day, cost: byDay.get(day) ?? 0 };
  });
}

export function barPercent(cost: number, max: number): number {
  if (cost <= 0 || max <= 0) return 0;
  return Math.max(MIN_BAR_PERCENT, Math.round((cost / max) * 100));
}

export function defaultKeyName(now: Date): string {
  return `Izzi AI Desktop – ${now.toLocaleDateString('vi-VN')}`;
}

export function overviewHint(reason: IzziOverviewFailure | undefined): string | null {
  switch (reason) {
    case undefined:
      return null;
    case 'not-signed-in':
    case 'unauthorized':
      return 'Đăng nhập tài khoản izziapi.com trong app để xem số dư, key và lượt dùng.';
    case 'forbidden':
      return 'Tài khoản chưa xác minh email. Xác minh email trên izziapi.com rồi bấm Làm mới.';
    default:
      return 'Không kết nối được izziapi.com — số liệu bên dưới có thể chưa cập nhật.';
  }
}

/** After a network blip keep the last good value for each part the fresh overview could not load. */
export function mergeOverview(prev: IzziOverview | null, next: IzziOverview): IzziOverview {
  if (next.reason !== 'network' || !prev) return next;
  const balanceFresh = next.balance !== null;
  const keysFresh = next.keys !== null;
  return {
    ...next,
    balance: balanceFresh ? next.balance : prev.balance,
    plan: balanceFresh ? next.plan : prev.plan,
    stats: next.stats ?? prev.stats,
    keys: keysFresh ? next.keys : prev.keys,
    inUseKeyId: keysFresh ? next.inUseKeyId : prev.inUseKeyId,
    managedKeyId: keysFresh ? next.managedKeyId : prev.managedKeyId,
  };
}
