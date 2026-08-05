/**
 * LiveProfilePanel — CMR-224 Slice 2.
 *
 * The MyGraph page is where the operator looks at what the app remembers, so it
 * is where their own memory file belongs. This panel is the local anchor on that
 * page: it reads, edits and reveals Live.md through `window.electronAPI.liveProfile`,
 * which never leaves the machine (`live_profile` egress is forbidden). It is
 * deliberately NOT a graph node — creating one would push the operator's private
 * words to the shared backend.
 *
 * Collapsed by default so it never covers the graph. All state logic lives in
 * `lib/live-profile-view` so it can be tested without a DOM.
 */
import React, { useCallback, useState } from 'react';
import '../styles/live-profile-panel.css';
import {
  describeLiveProfile,
  describeLiveProfileWrite,
  type LiveProfileViewModel,
} from '../lib/live-profile-view';

type Notice = { readonly tone: 'normal' | 'warning'; readonly message: string } | null;

export function LiveProfilePanel(): React.ReactElement | null {
  const api = window.electronAPI?.liveProfile;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<LiveProfileViewModel | null>(null);
  const [filePath, setFilePath] = useState('');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    setNotice(null);
    try {
      const result = await api.read();
      const next = describeLiveProfile(result);
      setView(next);
      setFilePath(result.filePath);
      setDraft(next.body);
    } finally {
      setBusy(false);
    }
  }, [api]);

  const save = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try {
      const result = await api.write(draft);
      setNotice(describeLiveProfileWrite(result));
      if (result.status === 'ok') {
        const next = describeLiveProfile({
          status: 'ok',
          profile: result.profile,
          filePath,
        });
        setView(next);
        // Keep the operator's draft as-is; only the revision label moved.
      }
    } finally {
      setBusy(false);
    }
  }, [api, draft, filePath]);

  // Feature-detect: an older main process has no liveProfile channels, and a
  // dead button is worse than no button.
  if (!api) return null;

  if (!open) {
    return (
      <button
        type="button"
        className="lp-launcher"
        onClick={() => {
          setOpen(true);
          void load();
        }}
        title="Live.md — file ký ức bạn tự viết, chỉ nằm trên máy này"
      >
        Live.md
      </button>
    );
  }

  return (
    <section className="lp-panel" aria-label="Live.md">
      <header className="lp-panel__head">
        <div>
          <h2 className="lp-panel__title">{view?.headline ?? 'Live.md'}</h2>
          {view?.revisionLabel ? (
            <span className="lp-panel__revision">{view.revisionLabel}</span>
          ) : null}
        </div>
        <button
          type="button"
          className="lp-btn lp-btn--ghost"
          onClick={() => setOpen(false)}
          aria-label="Đóng Live.md"
        >
          Đóng
        </button>
      </header>

      <p className={`lp-panel__hint ${view?.tone === 'warning' ? 'lp-panel__hint--warning' : ''}`}>
        {view?.hint ?? 'Đang đọc…'}
      </p>

      <label className="lp-panel__label" htmlFor="lp-body">
        Nội dung
      </label>
      <textarea
        id="lp-body"
        className="lp-panel__editor"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        disabled={!view?.canEdit || busy}
        spellCheck={false}
        rows={14}
      />

      {notice ? (
        <p
          className={`lp-panel__notice ${notice.tone === 'warning' ? 'lp-panel__notice--warning' : ''}`}
          role="status"
        >
          {notice.message}
        </p>
      ) : null}

      <footer className="lp-panel__foot">
        <button
          type="button"
          className="lp-btn"
          onClick={() => void save()}
          disabled={!view?.canEdit || busy}
        >
          {busy ? 'Đang lưu…' : 'Lưu'}
        </button>
        <button
          type="button"
          className="lp-btn lp-btn--ghost"
          onClick={() => void api.reveal()}
          title="Mở thư mục chứa Live.md để sửa bằng editor bạn thích"
        >
          Mở thư mục
        </button>
        <code className="lp-panel__path" title={filePath}>
          {filePath}
        </code>
      </footer>
    </section>
  );
}
