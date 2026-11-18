import { useCallback, useEffect, useRef, useState } from 'react';
import type { CustomerCareAutoReplyInput, CustomerCareAutoReplyResult } from '../../shared/customer-care-types';
import {
  CARE_AUTO_REPLY_ENABLE_CONFIRM,
  CARE_AUTO_REPLY_REFRESH_MS,
  CARE_AUTO_REPLY_RULES,
  autoReplyErrorMessage,
  autoReplyStatusLines,
  autoReplyViewFromResult,
  canToggleAutoReply,
  type CareAutoReplyView,
} from './customer-care-auto-reply-flow';
import { usePanelVisible } from '../lib/panel-visibility';

type CareAutoReplyApi = {
  getAutoReply: () => Promise<CustomerCareAutoReplyResult>;
  setAutoReply: (input: CustomerCareAutoReplyInput) => Promise<CustomerCareAutoReplyResult>;
};

const GENERIC_ERROR = 'Chưa tải được trạng thái trả lời tự động. Thử lại sau ít phút.';

function getAutoReplyApi(): CareAutoReplyApi | null {
  const api = (window.electronAPI as typeof window.electronAPI & { customerCare?: Partial<CareAutoReplyApi> }).customerCare;
  if (!api?.getAutoReply || !api.setAutoReply) return null;
  return api as CareAutoReplyApi;
}

export interface CustomerCareAutoReplyPanelProps {
  /** The workspace on screen; answers for any other workspace are dropped. */
  scopeKey: string;
  /** Bumped by the workspace after a setup save, so the uploaded-facts time is read again. */
  refreshKey: number;
  /** Tells the workspace header whether izzi currently answers customers by itself. */
  onEnabledChange: (enabled: boolean) => void;
}

/**
 * Phase C "Tự động trả lời khách": the owner/manager switch and what the izzi server sent. The server
 * composes and sends every reply; nothing about a customer is shown here, only counts and fixed text.
 */
export function CustomerCareAutoReplyPanel({ scopeKey, refreshKey, onEnabledChange }: CustomerCareAutoReplyPanelProps) {
  const active = usePanelVisible();
  const [view, setView] = useState<CareAutoReplyView>({ state: 'loading' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [toggling, setToggling] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const mountedRef = useRef(true);
  // Bumped by every switch change: a read that started before it must not undo it on screen.
  const sequenceRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const enabled = view.state === 'ready' && view.autoReply.enabled;
  useEffect(() => {
    onEnabledChange(enabled);
  }, [enabled, onEnabledChange]);
  // Off screen (Page gone, workspace switched): the header stops claiming automatic replies.
  useEffect(() => () => onEnabledChange(false), [onEnabledChange]);

  const load = useCallback(async (quiet: boolean) => {
    const api = getAutoReplyApi();
    if (!api) {
      setView({ state: 'hidden' });
      return;
    }
    const sequence = sequenceRef.current;
    try {
      const result = await api.getAutoReply();
      if (!mountedRef.current || sequence !== sequenceRef.current) return;
      setNow(Date.now());
      const next = autoReplyViewFromResult(result, scopeKey);
      // A background refresh keeps the last good state through a transient failure.
      if (quiet && next.state === 'error') return;
      setView(next);
    } catch {
      if (mountedRef.current && !quiet) setView({ state: 'error', message: GENERIC_ERROR });
    }
  }, [scopeKey]);

  useEffect(() => {
    void load(refreshKey > 0);
  }, [load, refreshKey]);

  const sectionReady = view.state === 'ready';
  // Read again whenever the tab comes back on screen, then every minute while it stays there.
  useEffect(() => {
    if (!sectionReady || !active) return undefined;
    void load(true);
    const timer = setInterval(() => { void load(true); }, CARE_AUTO_REPLY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [sectionReady, active, load]);

  const toggle = async () => {
    const api = getAutoReplyApi();
    if (!api || view.state !== 'ready' || !canToggleAutoReply(view) || toggling) return;
    const enable = !view.autoReply.enabled;
    if (enable && !window.confirm(CARE_AUTO_REPLY_ENABLE_CONFIRM)) return;
    sequenceRef.current += 1;
    setToggling(true);
    setError('');
    setNotice('');
    try {
      const result = await api.setAutoReply({ enabled: enable });
      if (!mountedRef.current) return;
      if (!result.ok) {
        setError(autoReplyErrorMessage(result));
        // The server may have switched before the answer was discarded: show what it says now.
        if (result.error === 'access_changed' || result.error === 'unavailable') void load(false);
        return;
      }
      if (result.workspaceId !== scopeKey || !result.autoReply) {
        void load(false);
        return;
      }
      setNow(Date.now());
      setView({ state: 'ready', autoReply: result.autoReply, canManage: result.canManage });
      setNotice(enable
        ? 'Đã bật trả lời tự động. izzi sẽ tự trả lời khách nhắn Page từ bây giờ.'
        : 'Đã tắt trả lời tự động. izzi không gửi thêm tin nào cho khách.');
    } catch {
      if (mountedRef.current) setError(autoReplyErrorMessage({ ok: false, error: 'unavailable' }));
    } finally {
      if (mountedRef.current) setToggling(false);
    }
  };

  if (view.state === 'loading' || view.state === 'hidden') return null;

  return (
    <section className="ccw__section ccw__auto-reply" aria-labelledby="ccw-auto-reply-title">
      <div className="ccw__section-heading">
        <div>
          <span className="cmr-eyebrow">Tin nhắn Page · Gửi tự động</span>
          <h3 id="ccw-auto-reply-title">Tự động trả lời khách</h3>
        </div>
      </div>

      {view.state === 'error' ? (
        <div className="ccw__leads-retry">
          <p className="ccw__hint" role="alert">{view.message}</p>
          <button type="button" className="cmr-button" onClick={() => { void load(false); }}>Thử lại</button>
        </div>
      ) : (
        <>
          <div className="ccw__inbox">
            <div className="ccw__inbox-text">
              <strong id="ccw-auto-reply-label">Trả lời và xin SĐT/Zalo</strong>
              {autoReplyStatusLines(view.autoReply, now).map((line) => <span key={line}>{line}</span>)}
            </div>
            {view.canManage ? (
              <button
                type="button"
                role="switch"
                className="ccw__switch"
                aria-checked={view.autoReply.enabled}
                aria-labelledby="ccw-auto-reply-label"
                disabled={toggling || !canToggleAutoReply(view)}
                onClick={() => { void toggle(); }}
              >
                <span className="ccw__switch-track" aria-hidden="true"><span className="ccw__switch-thumb" /></span>
                <span>{toggling ? 'Đang lưu…' : view.autoReply.enabled ? 'Đang bật' : 'Đang tắt'}</span>
              </button>
            ) : (
              <span className="ccw__inbox-state">{view.autoReply.enabled ? 'Đang bật' : 'Đang tắt'}</span>
            )}
          </div>
          <p className="ccw__hint">{CARE_AUTO_REPLY_RULES}</p>
          <p className="ccw__hint">
            Nếu Page đang bật Trả lời nhanh của Facebook hoặc lời chào tự động của Pancake, khách sẽ nhận hai lời chào;
            nên tắt chúng khi dùng tính năng này.
          </p>
          {!view.canManage && (
            <p className="ccw__hint">Chỉ chủ sở hữu và quản lý workspace được bật hoặc tắt trả lời tự động.</p>
          )}
          {error && <div className="cmr-alert cmr-alert--error" role="alert">{error}</div>}
          {notice && <div className="cmr-alert cmr-alert--success" role="status">{notice}</div>}
        </>
      )}
    </section>
  );
}
