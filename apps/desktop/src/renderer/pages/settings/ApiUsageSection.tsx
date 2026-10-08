import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CreateIzziKeyFlow } from './CreateIzziKeyFlow';
import {
  barPercent,
  fmtCost,
  fmtCredits,
  fmtDateTime,
  fmtTokens,
  lastSevenDays,
  mergeOverview,
  overviewHint,
} from './apiUsageFormat';
import '../../styles/api-usage.css';

/** Settings → API & Usage: balance, 7-day spend, keys and recent requests from izziapi.com. */
export function ApiUsageSection() {
  const [overview, setOverview] = useState<IzziOverview | null>(null);
  const [usage, setUsage] = useState<IzziUsageRow[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const refreshSeq = useRef(0);
  const loadingMore = useRef(false);

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.izziAccount;
    if (!api) return;
    const seq = ++refreshSeq.current;
    setLoading(true);
    try {
      const nextOverview = await api.overview();
      if (seq !== refreshSeq.current) return;
      // A network blip keeps the last good part of each value; the hint banner explains why.
      setOverview((prev) => mergeOverview(prev, nextOverview));
      const page = await api.recentUsage(0);
      if (seq !== refreshSeq.current) return;
      if (page.ok) {
        setUsage(page.rows);
        setHasMore(page.hasMore);
        setError(null);
      } else if (nextOverview.ok) {
        setError('Không tải được danh sách request gần đây.');
      }
    } catch {
      if (seq === refreshSeq.current) setError('Không tải được dữ liệu API & Usage. Thử lại sau.');
    } finally {
      if (seq === refreshSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function loadMore() {
    const api = window.electronAPI?.izziAccount;
    if (!api || loadingMore.current) return;
    loadingMore.current = true;
    const seq = refreshSeq.current;
    try {
      const page = await api.recentUsage(usage.length);
      // A refresh replaced the list while this page was loading.
      if (seq !== refreshSeq.current) return;
      if (!page.ok) {
        setError('Không tải thêm được request. Thử lại sau.');
        return;
      }
      const rows = page.rows;
      setUsage((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...rows.filter((r) => !seen.has(r.id))];
      });
      setHasMore(page.hasMore);
      setError(null);
    } catch {
      if (seq === refreshSeq.current) setError('Không tải thêm được request. Thử lại sau.');
    } finally {
      loadingMore.current = false;
    }
  }

  async function revoke(key: IzziApiKey) {
    const api = window.electronAPI?.izziAccount;
    if (!api || revokingId) return;
    const isManaged = key.id === overview?.managedKeyId;
    const question = isManaged
      ? `Thu hồi key "${key.name}"? Đây là key app dùng để chat. Sau khi thu hồi, app sẽ tự tạo key mới ở lần chat tiếp theo.`
      : `Thu hồi key "${key.name}"? Mọi nơi đang dùng key này sẽ ngừng hoạt động.`;
    if (!window.confirm(question)) return;
    setError(null);
    setNotice(null);
    setRevokingId(key.id);
    try {
      const result = await api.revokeKey(key.id);
      if (!result.success) {
        setError(result.error);
        return;
      }
      if (result.wasInUse) {
        setNotice('Đã thu hồi key. Đây là key app đang dùng nên Custom Provider đã được ngắt — tạo key mới để dùng tiếp.');
      } else if (result.wasManaged) {
        setNotice('Đã thu hồi key chat của app. App sẽ tự tạo key mới ở lần chat tiếp theo.');
      } else {
        setNotice('Đã thu hồi key.');
      }
      await refresh();
    } catch {
      setError('Không thu hồi được key. Thử lại sau.');
    } finally {
      setRevokingId(null);
    }
  }

  const api = window.electronAPI?.izziAccount;
  const hint = overviewHint(overview?.reason);
  const stats = overview?.stats ?? null;

  return (
    <div className="api-usage">
      <div className="card glass-card">
        <div className="card__header">
          <h3 className="card__title">API & Usage</h3>
        </div>
        <div className="action-row">
          <button className="btn btn--primary" onClick={() => setCreating(true)} disabled={!overview?.ok || !!overview?.reason}>
            Tạo key mới
          </button>
          <button className="btn btn--secondary" onClick={() => void api?.openTopUp()}>
            Nạp tiền
          </button>
          <button className="btn btn--ghost" onClick={() => void api?.openDashboard()}>
            Mở dashboard
          </button>
          <button className="btn btn--ghost" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Đang tải…' : 'Làm mới'}
          </button>
        </div>
        {hint && <div className="api-usage__notice">{hint}</div>}
        {notice && <div className="api-usage__notice api-usage__notice--ok">{notice}</div>}
        {error && <div className="api-usage__notice api-usage__notice--err">{error}</div>}
      </div>

      <div className="stats-grid">
        <StatCard label="Số dư" value={fmtCredits(overview?.balance ?? null)} />
        <StatCard label="Chi phí 7 ngày" value={stats ? fmtCredits(stats.totalCost) : '—'} />
        <StatCard label="Requests 7 ngày" value={stats ? String(stats.totalRequests) : '—'} />
        <StatCard
          label="Tokens 7 ngày (vào / ra)"
          value={stats ? `${fmtTokens(stats.totalInputTokens)} / ${fmtTokens(stats.totalOutputTokens)}` : '—'}
        />
      </div>

      {stats && <SpendChart stats={stats} />}
      {stats && stats.byModel.length > 0 && <ByModelTable rows={stats.byModel} />}
      {overview?.keys && (
        <KeysTable
          keys={overview.keys}
          inUseKeyId={overview.inUseKeyId}
          managedKeyId={overview.managedKeyId}
          revokingId={revokingId}
          onRevoke={revoke}
        />
      )}
      <RecentUsageTable rows={usage} hasMore={hasMore} disabled={loading} onLoadMore={() => void loadMore()} />

      <CreateIzziKeyFlow
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(savedLocally) => {
          setNotice(
            savedLocally
              ? 'Đã tạo key mới và gắn vào Custom Provider.'
              : 'Đã tạo key mới nhưng không lưu được vào app — dán key vào Custom Provider thủ công.',
          );
          void refresh();
        }}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-card glass-card">
      <div className="stat-card__value">{value}</div>
      <div className="stat-card__label">{label}</div>
    </div>
  );
}

function SpendChart({ stats }: { stats: IzziUsageStats }) {
  const days = lastSevenDays(stats.daily, new Date());
  const max = Math.max(...days.map((d) => d.cost));
  return (
    <div className="card glass-card">
      <div className="card__header">
        <h3 className="card__title">Chi phí 7 ngày qua</h3>
      </div>
      <div className="api-usage__chart">
        {days.map((d) => (
          <div key={d.day} className="api-usage__bar-col" title={`${d.day}: ${fmtCost(d.cost)}`}>
            <div className="api-usage__bar" style={{ height: `${barPercent(d.cost, max)}%` }} />
            <span>{d.day.slice(5)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ByModelTable({ rows }: { rows: IzziUsageStats['byModel'] }) {
  return (
    <div className="card glass-card">
      <div className="card__header">
        <h3 className="card__title">Theo model</h3>
      </div>
      <table className="api-usage__table">
        <thead>
          <tr>
            <th>Model</th>
            <th className="api-usage__num">Requests</th>
            <th className="api-usage__num">Chi phí</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.model}>
              <td className="api-usage__mono">{r.model}</td>
              <td className="api-usage__num">{r.requests}</td>
              <td className="api-usage__num">{fmtCost(r.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface KeysTableProps {
  keys: IzziApiKey[];
  inUseKeyId: string | null;
  managedKeyId: string | null;
  revokingId: string | null;
  onRevoke: (key: IzziApiKey) => void;
}

function KeysTable({ keys, inUseKeyId, managedKeyId, revokingId, onRevoke }: KeysTableProps) {
  return (
    <div className="card glass-card">
      <div className="card__header">
        <h3 className="card__title">API keys</h3>
      </div>
      {keys.length === 0 ? (
        <div className="api-usage__empty">Chưa có key nào. Bấm “Tạo key mới” để bắt đầu.</div>
      ) : (
        <table className="api-usage__table">
          <thead>
            <tr>
              <th>Tên</th>
              <th>Key</th>
              <th>Trạng thái</th>
              <th>Dùng lần cuối</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const isActive = k.status === 'active';
              return (
                <tr key={k.id}>
                  <td>
                    {k.name}{' '}
                    {k.id === inUseKeyId && (
                      <span className="api-usage__badge api-usage__badge--accent">Đang dùng trong app</span>
                    )}
                    {k.id === managedKeyId && (
                      <span className="api-usage__badge api-usage__badge--accent">Key app dùng cho chat</span>
                    )}
                  </td>
                  <td className="api-usage__mono">{k.prefix}…</td>
                  <td>
                    <span className={`api-usage__badge ${isActive ? 'api-usage__badge--ok' : 'api-usage__badge--err'}`}>
                      {isActive ? 'Hoạt động' : k.status === 'revoked' ? 'Đã thu hồi' : k.status}
                    </span>
                  </td>
                  <td>{k.lastUsedAt ? fmtDateTime(k.lastUsedAt) : 'Chưa dùng'}</td>
                  <td className="api-usage__num">
                    {isActive && (
                      <button
                        className="btn btn--danger btn--sm"
                        disabled={revokingId === k.id}
                        onClick={() => onRevoke(k)}
                      >
                        Thu hồi
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface RecentUsageTableProps {
  rows: IzziUsageRow[];
  hasMore: boolean;
  disabled: boolean;
  onLoadMore: () => void;
}

function RecentUsageTable({ rows, hasMore, disabled, onLoadMore }: RecentUsageTableProps) {
  return (
    <div className="card glass-card">
      <div className="card__header">
        <h3 className="card__title">Requests gần đây</h3>
      </div>
      {rows.length === 0 ? (
        <div className="api-usage__empty">Chưa có request nào.</div>
      ) : (
        <table className="api-usage__table">
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Model</th>
              <th>Key</th>
              <th className="api-usage__num">Tokens (vào / ra)</th>
              <th className="api-usage__num">Chi phí</th>
              <th className="api-usage__num">Thời lượng</th>
              <th className="api-usage__num">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{fmtDateTime(r.createdAt)}</td>
                <td className="api-usage__mono">{r.model}</td>
                <td>{r.keyName}</td>
                <td className="api-usage__num">
                  {fmtTokens(r.inputTokens)} / {fmtTokens(r.outputTokens)}
                </td>
                <td className="api-usage__num">{fmtCost(r.cost)}</td>
                <td className="api-usage__num">{(r.durationMs / 1000).toFixed(1)}s</td>
                <td className="api-usage__num">
                  <span className={`api-usage__badge ${r.statusCode < 400 ? 'api-usage__badge--ok' : 'api-usage__badge--err'}`}>
                    {r.statusCode}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {hasMore && (
        <div className="action-row">
          <button className="btn btn--ghost btn--sm" disabled={disabled} onClick={onLoadMore}>
            Xem thêm
          </button>
        </div>
      )}
    </div>
  );
}
