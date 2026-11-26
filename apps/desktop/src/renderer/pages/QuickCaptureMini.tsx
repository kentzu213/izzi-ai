/**
 * QuickCaptureMiniPage — the lightweight PC/Mac "mini-app" surface hosted inside
 * the single Izzi AI App binary (opened via `Ctrl/Cmd+Shift+I` or System Tray).
 *
 * Renders the full Local Vault + Review Inbox + Offline FTS5 Search + Quick Capture
 * experience cleanly in a 580×480 frameless window with Escape-to-hide.
 *
 * @module renderer/pages/QuickCaptureMini
 */

import React, { useEffect } from 'react';
import { ReviewInboxPanel } from '../components/knowledge/ReviewInboxPanel';

export function QuickCaptureMiniPage(): React.ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void window.electronAPI?.quickCapture?.hide?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#11141a',
        color: '#e6e8ee',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          borderBottom: '1px solid #242934',
          WebkitAppRegion: 'drag',
        } as React.CSSProperties}
      >
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.02em' }}>
          Izzi AI · Quick Capture &amp; Local Vault
        </span>
        <div style={{ display: 'flex', gap: 6, WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            type="button"
            className="ri-btn"
            onClick={() => void window.electronAPI?.quickCapture?.openMain?.()}
          >
            Mở app chính
          </button>
          <button
            type="button"
            className="ri-btn"
            onClick={() => void window.electronAPI?.quickCapture?.hide?.()}
            title="Ẩn (Esc)"
          >
            ✕
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <ReviewInboxPanel embedded />
      </div>
    </div>
  );
}
