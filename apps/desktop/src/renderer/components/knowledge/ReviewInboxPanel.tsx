/**
 * ReviewInboxPanel — Local-First Vault control strip + Obsidian-grade Candidate
 * Review Inbox + Offline FTS5 Search mounted alongside Live.md on MyGraph.
 *
 * Keeps the graph canvas uncluttered (collapsed launcher by default) while giving
 * one-click access to:
 *  - Sync Local Vault (`~/IzziVault/`) ↔ Cloud MyGraph (`api.izziapi.com`)
 *  - Open Vault folder directly in Explorer/Finder/Obsidian
 *  - Controlled one-way import from Obsidian `.md` folder or Codex exports
 *  - Approve (`local` or `shareable`) / Reject candidate records extracted from sessions
 *  - Instant offline FTS5 search & Quick Capture form
 *
 * @module renderer/components/knowledge/ReviewInboxPanel
 */

import React, { useCallback, useEffect, useState } from 'react';
import '../../styles/review-inbox-panel.css';
import type { KnowledgeKind, KnowledgeRecord, KnowledgeStats } from '../../../shared/knowledge-types';
import type { VaultSearchHit, VaultSyncStatus } from '../../../shared/vault-sync-types';

type TabKey = 'inbox' | 'search' | 'capture';

export interface ReviewInboxPanelProps {
  /** When true, renders expanded inline without the floating launcher button (used in Mini-Window). */
  embedded?: boolean;
}

export function ReviewInboxPanel({ embedded = false }: ReviewInboxPanelProps): React.ReactElement | null {
  const knowledgeApi = window.electronAPI?.knowledge;
  const vaultApi = window.electronAPI?.vault;

  const [open, setOpen] = useState(embedded);
  const [tab, setTab] = useState<TabKey>('inbox');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; warn?: boolean } | null>(null);

  const [status, setStatus] = useState<VaultSyncStatus | null>(null);
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [candidates, setCandidates] = useState<KnowledgeRecord[]>([]);

  const [query, setQuery] = useState('');
  const [searchHits, setSearchHits] = useState<VaultSearchHit[]>([]);

  const [capTitle, setCapTitle] = useState('');
  const [capSummary, setCapSummary] = useState('');
  const [capKind, setCapKind] = useState<KnowledgeKind>('decision');
  const [capTopic, setCapTopic] = useState('');
  const [capShare, setCapShare] = useState(false);

  const refresh = useCallback(async () => {
    if (!knowledgeApi && !vaultApi) return;
    try {
      const [st, ks, cands] = await Promise.all([
        vaultApi?.status ? vaultApi.status() : Promise.resolve(null),
        knowledgeApi?.stats ? knowledgeApi.stats() : Promise.resolve(null),
        knowledgeApi?.list ? knowledgeApi.list({ state: 'candidate', limit: 40 }) : Promise.resolve([]),
      ]);
      if (st) setStatus(st);
      if (ks) setStats(ks);
      if (Array.isArray(cands)) setCandidates(cands);
    } catch {
      // best-effort UI refresh
    }
  }, [knowledgeApi, vaultApi]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keep Hộp duyệt & Vault stats fresh whenever the user opens the drawer,
  // switches back to the Inbox tab, or refocuses the window after using Mini-Window / Agent chat.
  useEffect(() => {
    if (open) {
      void refresh();
    }
  }, [open, tab, refresh]);

  useEffect(() => {
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  useEffect(() => {
    if (!open || tab !== 'search' || !vaultApi?.search) return;
    const trimmed = query.trim();
    if (!trimmed) {
      setSearchHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void vaultApi.search(trimmed, 25).then((hits) => setSearchHits(Array.isArray(hits) ? hits : []));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [open, tab, query, vaultApi]);

  if (!knowledgeApi && !vaultApi) return null;

  const pendingCount = stats?.candidate ?? status?.pendingCandidates ?? candidates.length;

  async function handleSync() {
    if (!vaultApi?.sync) return;
    setBusy(true);
    setNotice(null);
    try {
      const next = await vaultApi.sync();
      setStatus(next);
      await refresh();
      if (next.lastError) {
        setNotice({ text: `Đồng bộ gặp lỗi: ${next.lastError}`, warn: true });
      } else if (next.conflicts.length > 0 || next.blockedSecrets.length > 0) {
        setNotice({
          text: `Đã đồng bộ (${next.localNodes} nodes). Xung đột: ${next.conflicts.length}, chặn bí mật: ${next.blockedSecrets.length}.`,
          warn: true,
        });
      } else {
        setNotice({ text: `Đã đồng bộ xong (${next.localNodes} nodes · ${next.activeKnowledge} tri thức active).` });
      }
    } finally {
      setBusy(false);
    }
  }

  async function handlePromote(id: string, sensitivity: 'local' | 'shareable') {
    if (!knowledgeApi?.promote) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await knowledgeApi.promote({
        id,
        reviewer: 'user',
        basis: 'user_approval',
        sensitivity,
      });
      if (!res.ok) {
        setNotice({ text: res.error || 'Không duyệt được bản ghi', warn: true });
      } else {
        setNotice({
          text:
            sensitivity === 'shareable'
              ? 'Đã duyệt & xếp hàng đồng bộ lên Cloud MyGraph.'
              : 'Đã duyệt lưu cục bộ vào Local Vault.',
        });
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRetract(id: string) {
    if (!knowledgeApi?.retract) return;
    setBusy(true);
    try {
      await knowledgeApi.retract({ id, actor: 'user', reason: 'Rejected in Review Inbox' });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleCapture(e: React.FormEvent) {
    e.preventDefault();
    if (!knowledgeApi?.capture || !capTitle.trim() || !capSummary.trim()) return;
    setBusy(true);
    setNotice(null);
    try {
      const created = await knowledgeApi.capture({
        scope: 'project',
        workspaceId: 'default',
        kind: capKind,
        title: capTitle.trim(),
        summary: capSummary.trim(),
        topicKey: (capTopic.trim() || capTitle.trim()).toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 64) || 'general',
        source: { type: 'user', uri: `user://quick-capture/${new Date().toISOString()}` },
        author: 'user',
        evidence: 'direct',
        confidence: 1,
        sensitivity: capShare ? 'shareable' : 'local',
      });
      if (!created.ok || !created.record) {
        setNotice({ text: created.error || 'Bị chặn bởi bộ lọc bí mật/PII.', warn: true });
        return;
      }
      // User-authored direct capture is immediately promoted with explicit user approval.
      const promoted = await knowledgeApi.promote?.({
        id: created.record.id,
        reviewer: 'user',
        basis: 'user_approval',
        sensitivity: capShare ? 'shareable' : 'local',
      });
      if (promoted && !promoted.ok) {
        setNotice({ text: promoted.error || 'Đã lưu nháp nhưng không duyệt được bản ghi.', warn: true });
        await refresh();
        return;
      }
      setCapTitle('');
      setCapSummary('');
      setCapTopic('');
      setNotice({
        text: capShare
          ? 'Đã lưu vào Local Vault & đồng bộ lên Cloud MyGraph.'
          : 'Đã lưu vào Local Vault (chỉ trên máy này).',
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(kind: 'obsidian' | 'codex') {
    const fn = kind === 'obsidian' ? vaultApi?.importMarkdownFolder : vaultApi?.importCodexExports;
    if (!fn) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fn();
      if (res.ok) {
        setNotice({
          text: `Đã nhập ${res.imported} mục vào Hộp duyệt (bỏ qua ${res.skipped}, chặn bí mật ${res.blockedSecrets}).`,
          warn: res.blockedSecrets > 0,
        });
        await refresh();
        setTab('inbox');
      } else if (res.errors[0] && res.errors[0] !== 'Đã hủy') {
        setNotice({ text: res.errors[0], warn: true });
      }
    } finally {
      setBusy(false);
    }
  }

  if (!open && !embedded) {
    return (
      <button
        type="button"
        className="ri-launcher"
        onClick={() => {
          setOpen(true);
          void refresh();
        }}
        title="Local Vault (Obsidian) & Hộp duyệt tri thức MyGraph"
      >
        <span>Vault &amp; Lọc</span>
        {pendingCount > 0 && <span className="ri-badge">{pendingCount}</span>}
      </button>
    );
  }

  return (
    <section
      className={embedded ? '' : 'ri-panel'}
      style={embedded ? { display: 'flex', flexDirection: 'column', gap: 10, padding: 14, color: '#e6e8ee' } : undefined}
      aria-label="Local Vault và Hộp duyệt tri thức"
    >
      <header className="ri-head">
        <div>
          <h2 className="ri-title">Local Vault &amp; Bộ lọc chuẩn Obsidian</h2>
          <p className="ri-sub">
            {status?.vaultDir || '~/IzziVault'} · {status?.localNodes ?? 0} nodes ·{' '}
            {stats?.active ?? 0} active ({stats?.shareable ?? 0} cloud)
          </p>
        </div>
        {!embedded && (
          <button type="button" className="ri-btn" onClick={() => setOpen(false)}>
            Đóng
          </button>
        )}
      </header>

      <div className="ri-toolbar">
        <button type="button" className="ri-btn ri-btn--accent" disabled={busy} onClick={() => void handleSync()}>
          {busy ? 'Đang chạy…' : '↻ Đồng bộ Cloud'}
        </button>
        <button type="button" className="ri-btn" onClick={() => void vaultApi?.openFolder?.()}>
          📁 Mở thư mục Vault
        </button>
        <button type="button" className="ri-btn" onClick={() => void vaultApi?.chooseFolder?.().then(() => refresh())}>
          Đổi thư mục
        </button>
        <button type="button" className="ri-btn" disabled={busy} onClick={() => void handleImport('obsidian')}>
          Nhập Obsidian
        </button>
        <button type="button" className="ri-btn" disabled={busy} onClick={() => void handleImport('codex')}>
          Nhập Codex
        </button>
      </div>

      {notice && (
        <p className={`ri-notice ${notice.warn ? 'ri-notice--warn' : ''}`} role="status">
          {notice.text}
        </p>
      )}

      {status && status.conflicts.length > 0 && (
        <p className="ri-notice ri-notice--warn">
          Có {status.conflicts.length} file xung đột (.conflict-*.md) đã được giữ bản sao an toàn trong thư mục Vault.
        </p>
      )}

      <div className="ri-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'inbox'}
          className={`ri-tab ${tab === 'inbox' ? 'is-active' : ''}`}
          onClick={() => setTab('inbox')}
        >
          Hộp duyệt ({pendingCount})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'search'}
          className={`ri-tab ${tab === 'search' ? 'is-active' : ''}`}
          onClick={() => setTab('search')}
        >
          Tìm offline (FTS5)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'capture'}
          className={`ri-tab ${tab === 'capture' ? 'is-active' : ''}`}
          onClick={() => setTab('capture')}
        >
          + Ghi nhanh chuẩn lọc
        </button>
      </div>

      {tab === 'inbox' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {candidates.length === 0 ? (
            <div className="ri-empty">
              Không có mục chờ duyệt. Khi bạn chat với Agent hoặc nhập Obsidian, các quyết định/bài học mới sẽ xuất hiện tại đây trước khi vào đồ thị.
            </div>
          ) : (
            candidates.map((rec) => (
              <article key={rec.id} className="ri-card">
                <div className="ri-card__meta">
                  <span>{rec.kind}</span>
                  <span>scope: {rec.scope}</span>
                  <span>topic: {rec.topicKey}</span>
                  <span>tin cậy: {Math.round(rec.confidence * 100)}%</span>
                </div>
                <h3 className="ri-card__title">{rec.title}</h3>
                <p className="ri-card__body">{rec.summary}</p>
                <div className="ri-card__actions">
                  <button
                    type="button"
                    className="ri-btn ri-btn--primary"
                    disabled={busy}
                    onClick={() => void handlePromote(rec.id, 'shareable')}
                  >
                    Duyệt + Lên Cloud
                  </button>
                  <button
                    type="button"
                    className="ri-btn"
                    disabled={busy}
                    onClick={() => void handlePromote(rec.id, 'local')}
                  >
                    Duyệt (Chỉ máy này)
                  </button>
                  <button
                    type="button"
                    className="ri-btn ri-btn--danger"
                    disabled={busy}
                    onClick={() => void handleRetract(rec.id)}
                  >
                    Loại bỏ
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      )}

      {tab === 'search' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input
            type="search"
            className="ri-input"
            placeholder="Tìm toàn văn body MyGraph & Local Vault (chạy cả khi mất mạng)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          {query.trim() && searchHits.length === 0 && (
            <div className="ri-empty">Không tìm thấy kết quả trong Local Vault.</div>
          )}
          {searchHits.map((hit) => (
            <article key={`${hit.source}-${hit.id}`} className="ri-card">
              <div className="ri-card__meta">
                <span>{hit.source === 'knowledge' ? 'Tri thức chuẩn lọc' : 'MyGraph cache'}</span>
                <span>{hit.nodeType}</span>
              </div>
              <h3 className="ri-card__title">{hit.title}</h3>
              <p className="ri-card__body">{hit.snippet}</p>
            </article>
          ))}
        </div>
      )}

      {tab === 'capture' && (
        <form onSubmit={(e) => void handleCapture(e)} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <select
              className="ri-select"
              style={{ width: 150 }}
              value={capKind}
              onChange={(e) => setCapKind(e.target.value as KnowledgeKind)}
            >
              <option value="decision">Quyết định</option>
              <option value="lesson">Bài học</option>
              <option value="procedure">Quy trình</option>
              <option value="fact">Sự kiện/Fact</option>
              <option value="pitfall">Bẫy cần tránh</option>
              <option value="preference">Thói quen</option>
              <option value="question">Câu hỏi mở</option>
            </select>
            <input
              type="text"
              className="ri-input"
              placeholder="Topic key (vd: mygraph-sync)"
              value={capTopic}
              onChange={(e) => setCapTopic(e.target.value)}
            />
          </div>
          <input
            type="text"
            className="ri-input"
            placeholder="Tiêu đề ngắn gọn (≤ 160 ký tự)"
            value={capTitle}
            onChange={(e) => setCapTitle(e.target.value)}
            required
          />
          <textarea
            className="ri-textarea"
            rows={4}
            placeholder="Nội dung tri thức (tự chặn API key, SĐT, email, thẻ thanh toán)…"
            value={capSummary}
            onChange={(e) => setCapSummary(e.target.value)}
            required
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#c7cdd8' }}>
            <input type="checkbox" checked={capShare} onChange={(e) => setCapShare(e.target.checked)} />
            Cho phép đồng bộ lên Cloud MyGraph — bỏ chọn để chỉ giữ trên máy này
          </label>
          <button type="submit" className="ri-btn ri-btn--primary" disabled={busy || !capTitle.trim() || !capSummary.trim()}>
            Lưu tri thức chuẩn lọc
          </button>
        </form>
      )}
    </section>
  );
}
