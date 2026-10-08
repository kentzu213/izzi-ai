import React, { useEffect, useState } from 'react';
import { defaultKeyName } from './apiUsageFormat';
import '../../styles/api-usage.css';

interface CreateIzziKeyFlowProps {
  open: boolean;
  onClose: () => void;
  /** Fired after the key is created; savedLocally is false when the app could not store it. */
  onCreated: (savedLocally: boolean) => void;
}

/**
 * Name → create → one-time reveal. The raw key lives only in this component's
 * state and is dropped on close; main has already stored it for the app.
 */
export function CreateIzziKeyFlow({ open, onClose, onCreated }: CreateIzziKeyFlowProps) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedLocally, setSavedLocally] = useState(true);

  useEffect(() => {
    if (!open) return;
    setName(defaultKeyName(new Date()));
    setError(null);
    setRevealedKey(null);
    setCopied(false);
    setSavedLocally(true);
  }, [open]);

  useEffect(() => {
    if (!open || busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(revealedKey && !savedLocally)) {
        setRevealedKey(null);
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, onClose, revealedKey, savedLocally]);

  if (!open) return null;

  function close() {
    setRevealedKey(null);
    onClose();
  }

  async function handleCreate() {
    const api = window.electronAPI?.izziAccount;
    if (!api) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.createKey(name);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSavedLocally(result.savedLocally);
      setRevealedKey(result.key);
      onCreated(result.savedLocally);
    } catch {
      setError('Không tạo được key. Thử lại sau.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!revealedKey) return;
    try {
      await navigator.clipboard.writeText(revealedKey);
      setCopied(true);
    } catch {
      /* clipboard blocked — the key is still selectable */
    }
  }

  return (
    <div className="api-usage__modal-overlay" role="dialog" aria-modal="true" aria-label="Tạo API key Izzi">
      <div className="api-usage__modal">
        <h3 className="card__title">{revealedKey ? 'Key mới đã sẵn sàng' : 'Tạo API key Izzi mới'}</h3>

        {revealedKey ? (
          <>
            <div className="settings-item__description">
              {savedLocally
                ? 'App đã tự lưu key này vào Custom Provider và bật lên. Đây là lần duy nhất key hiện đầy đủ — sao chép nếu bạn muốn dùng ở nơi khác.'
                : 'Không lưu được key vào app. Hãy sao chép và dán vào Custom Provider thủ công. Đây là lần duy nhất key hiện đầy đủ.'}
            </div>
            <div className="api-usage__key-reveal">{revealedKey}</div>
            <div className="action-row">
              <button className="btn btn--secondary" onClick={() => void handleCopy()}>
                {copied ? 'Đã sao chép' : 'Sao chép'}
              </button>
              <button className="btn btn--primary" onClick={close}>
                Xong
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="settings-item__description">
              Key được tạo trên tài khoản izziapi.com của bạn và dùng ngay trong app (Custom Provider). Key mới sẽ
              thay thế key và cấu hình Custom Provider hiện tại.
            </div>
            <input
              className="input"
              aria-label="Tên key"
              maxLength={64}
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
            {error && <div className="settings-item__description settings-error__summary">{error}</div>}
            <div className="action-row">
              <button className="btn btn--primary" disabled={busy || !name.trim()} onClick={() => void handleCreate()}>
                {busy ? 'Đang tạo…' : 'Tạo key'}
              </button>
              <button className="btn btn--ghost" disabled={busy} onClick={close}>
                Huỷ
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
