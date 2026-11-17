import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CustomerCareInboxInput,
  CustomerCareInboxResult,
  CustomerCareLead,
  CustomerCareLeadListInput,
  CustomerCareLeadListResult,
  CustomerCareLeadStatus,
  CustomerCareLeadStatusInput,
  CustomerCareLeadStatusResult,
} from '../../shared/customer-care-types';
import {
  CARE_INBOX_ENABLE_CONFIRM,
  CARE_LEADS_REFRESH_MS,
  CARE_LEAD_STATUS_OPTIONS,
  EMPTY_LEAD_LIST,
  careLeadsErrorMessage,
  composeTranscript,
  emptyLeadsMessage,
  failureDropsLeads,
  formatLeadAbsoluteTime,
  formatLeadPhone,
  formatLeadTime,
  inboxStatusLine,
  inboxViewFromResult,
  keepsLeadsInMemory,
  latestCustomerText,
  leadDisplayName,
  leadListOnFirstPage,
  leadListOnMore,
  leadListOnStatus,
  shouldPollLeads,
  type CareInboxView,
  type CareLeadListState,
} from './customer-care-leads-flow';
import { usePanelVisible } from '../lib/panel-visibility';

type CareLeadsApi = {
  getFacebookInbox: () => Promise<CustomerCareInboxResult>;
  setFacebookInbox: (input: CustomerCareInboxInput) => Promise<CustomerCareInboxResult>;
  listLeads: (input: CustomerCareLeadListInput) => Promise<CustomerCareLeadListResult>;
  setLeadStatus: (input: CustomerCareLeadStatusInput) => Promise<CustomerCareLeadStatusResult>;
};

const GENERIC_ERROR = 'Chưa tải được khách để lại số. Thử lại sau ít phút.';

function getCareLeadsApi(): CareLeadsApi | null {
  const api = (window.electronAPI as typeof window.electronAPI & { customerCare?: Partial<CareLeadsApi> }).customerCare;
  if (!api?.getFacebookInbox || !api.setFacebookInbox || !api.listLeads || !api.setLeadStatus) return null;
  return api as CareLeadsApi;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

export interface CustomerCareLeadsPanelProps {
  /** The workspace on screen; answers for any other workspace are dropped. */
  scopeKey: string;
  /** Puts a transcript into the existing draft panel. Nothing is sent to the customer. */
  onCompose: (transcript: string) => void;
}

/**
 * Phase B1 "Khách để lại số": the Page inbox switch and the list of customers who left a phone number.
 * Phones and messages live only in this component's state; they are rendered as plain text. Leads are
 * refreshed only while the Care tab is the visible tab and the window is not hidden.
 */
export function CustomerCareLeadsPanel({ scopeKey, onCompose }: CustomerCareLeadsPanelProps) {
  const active = usePanelVisible();
  const [view, setView] = useState<CareInboxView>({ state: 'loading' });
  const [list, setList] = useState<CareLeadListState>(EMPTY_LEAD_LIST);
  const [leadsLoaded, setLeadsLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [toggling, setToggling] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const documentVisible = useDocumentVisible();
  const mountedRef = useRef(true);
  // Bumped by every status change: a refresh that started before it must not undo it on screen.
  const mutationRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /** Forget every phone and message held for display. */
  const dropLeads = useCallback(() => {
    setList(EMPTY_LEAD_LIST);
    setLeadsLoaded(false);
  }, []);

  // A section that turned hidden (role lowered, Page gone) or failed keeps no phones in memory.
  const keepLeads = keepsLeadsInMemory(view);
  useEffect(() => {
    if (!keepLeads) dropLeads();
  }, [keepLeads, dropLeads]);

  const loadInbox = useCallback(async (quiet: boolean) => {
    const api = getCareLeadsApi();
    if (!api) {
      setView({ state: 'hidden' });
      return;
    }
    try {
      const result = await api.getFacebookInbox();
      if (!mountedRef.current) return;
      const next = inboxViewFromResult(result, scopeKey);
      // A background refresh keeps the last good state through a transient failure.
      if (quiet && next.state === 'error') return;
      setView(next);
    } catch {
      if (mountedRef.current && !quiet) setView({ state: 'error', message: GENERIC_ERROR });
    }
  }, [scopeKey]);

  const refreshLeads = useCallback(async () => {
    const api = getCareLeadsApi();
    if (!api) return;
    const mutation = mutationRef.current;
    try {
      const result = await api.listLeads({ cursor: null });
      if (!mountedRef.current) return;
      setNow(Date.now());
      if (!result.ok) {
        if (failureDropsLeads(result)) dropLeads();
        setError(careLeadsErrorMessage(result, 'leads'));
        return;
      }
      if (result.workspaceId !== scopeKey || mutation !== mutationRef.current) return;
      setList((current) => leadListOnFirstPage(current, result));
      setLeadsLoaded(true);
      setError('');
    } catch {
      if (mountedRef.current) setError(GENERIC_ERROR);
    }
  }, [scopeKey, dropLeads]);

  useEffect(() => {
    void loadInbox(false);
  }, [loadInbox]);

  const sectionReady = view.state === 'ready';
  const inboxEnabled = view.state === 'ready' && view.inbox.enabled;
  const visible = active && documentVisible;
  const polling = shouldPollLeads({ active, documentVisible, inboxEnabled });

  // Leads load whenever the section comes on screen; new ones are asked for every 30 s while it stays there.
  useEffect(() => {
    if (!sectionReady || !visible) return undefined;
    void refreshLeads();
    if (!polling) return undefined;
    const timer = setInterval(() => {
      void loadInbox(true);
      void refreshLeads();
    }, CARE_LEADS_REFRESH_MS);
    return () => clearInterval(timer);
  }, [sectionReady, visible, polling, loadInbox, refreshLeads]);

  const toggleInbox = async () => {
    const api = getCareLeadsApi();
    if (!api || view.state !== 'ready' || !view.canManage || toggling) return;
    const enable = !view.inbox.enabled;
    if (enable && !window.confirm(CARE_INBOX_ENABLE_CONFIRM)) return;
    setToggling(true);
    setError('');
    setNotice('');
    try {
      const result = await api.setFacebookInbox({ enabled: enable });
      if (!mountedRef.current) return;
      if (!result.ok) {
        setError(careLeadsErrorMessage(result, 'inbox'));
        return;
      }
      if (result.workspaceId !== scopeKey || !result.inbox) return;
      setView({ state: 'ready', inbox: result.inbox, canManage: result.canManage });
      setNotice(enable
        ? 'Đã bật nhận tin nhắn từ Page. izzi chỉ đọc, không gửi gì cho khách.'
        : 'Đã tắt nhận tin nhắn từ Page.');
    } catch {
      if (mountedRef.current) setError(careLeadsErrorMessage({ ok: false, error: 'unavailable' }, 'inbox'));
    } finally {
      if (mountedRef.current) setToggling(false);
    }
  };

  const loadMore = async () => {
    const api = getCareLeadsApi();
    const cursor = list.nextCursor;
    if (!api || cursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await api.listLeads({ cursor });
      if (!mountedRef.current) return;
      if (!result.ok) {
        if (failureDropsLeads(result)) dropLeads();
        setError(careLeadsErrorMessage(result, 'leads'));
        return;
      }
      if (result.workspaceId !== scopeKey) return;
      setList((current) => leadListOnMore(current, result));
      setError('');
    } catch {
      if (mountedRef.current) setError(GENERIC_ERROR);
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
  };

  const changeStatus = async (lead: CustomerCareLead, status: CustomerCareLeadStatus) => {
    const api = getCareLeadsApi();
    if (!api || status === lead.status || statusBusyId !== null) return;
    mutationRef.current += 1;
    setStatusBusyId(lead.id);
    setError('');
    setNotice('');
    try {
      const result = await api.setLeadStatus({ leadId: lead.id, status });
      if (!mountedRef.current) return;
      if (!result.ok) {
        if (failureDropsLeads(result)) dropLeads();
        setError(careLeadsErrorMessage(result, 'leads'));
        if (result.reason === 'lead_not_found') void refreshLeads();
        return;
      }
      if (result.workspaceId !== scopeKey) return;
      setList((current) => leadListOnStatus(current, result.lead));
    } catch {
      if (mountedRef.current) setError('Chưa đổi được trạng thái. Thử lại sau ít phút.');
    } finally {
      if (mountedRef.current) setStatusBusyId(null);
    }
  };

  const copyPhone = async (lead: CustomerCareLead) => {
    try {
      await navigator.clipboard.writeText(lead.phone);
      setError('');
      setNotice(`Đã sao chép số của ${leadDisplayName(lead)}.`);
    } catch {
      setError('Không sao chép được. Bạn vẫn có thể chọn và sao chép số thủ công.');
    }
  };

  const compose = (lead: CustomerCareLead) => {
    const text = latestCustomerText(lead);
    if (text) onCompose(composeTranscript(text));
  };

  if (view.state === 'loading' || view.state === 'hidden') return null;

  return (
    <section className="ccw__section ccw__leads" aria-labelledby="ccw-leads-title">
      <div className="ccw__section-heading">
        <div>
          <span className="cmr-eyebrow">Tin nhắn Page · Chỉ đọc</span>
          <h3 id="ccw-leads-title">Khách để lại số</h3>
        </div>
      </div>

      {view.state === 'error' ? (
        <div className="ccw__leads-retry">
          <p className="ccw__hint" role="alert">{view.message}</p>
          <button type="button" className="cmr-button" onClick={() => { void loadInbox(false); }}>Thử lại</button>
        </div>
      ) : (
        <>
          <div className="ccw__inbox">
            <div className="ccw__inbox-text">
              <strong id="ccw-inbox-label">Nhận tin nhắn từ Page</strong>
              <span>{inboxStatusLine(view.inbox, now)}</span>
            </div>
            {view.canManage ? (
              <button
                type="button"
                role="switch"
                className="ccw__switch"
                aria-checked={view.inbox.enabled}
                aria-labelledby="ccw-inbox-label"
                disabled={toggling}
                onClick={() => { void toggleInbox(); }}
              >
                <span className="ccw__switch-track" aria-hidden="true"><span className="ccw__switch-thumb" /></span>
                <span>{toggling ? 'Đang lưu…' : view.inbox.enabled ? 'Đang bật' : 'Đang tắt'}</span>
              </button>
            ) : (
              <span className="ccw__inbox-state">{view.inbox.enabled ? 'Đang bật' : 'Đang tắt'}</span>
            )}
          </div>
          {!view.canManage && (
            <p className="ccw__hint">Chỉ chủ sở hữu và quản lý workspace được bật hoặc tắt nhận tin nhắn từ Page.</p>
          )}

          {error && <div className="cmr-alert cmr-alert--error" role="alert">{error}</div>}
          {notice && <div className="cmr-alert cmr-alert--success" role="status">{notice}</div>}

          {!leadsLoaded ? (
            !error && <p className="ccw__hint" role="status">Đang tải danh sách khách…</p>
          ) : list.leads.length === 0 ? (
            <div className="ccw__empty">{emptyLeadsMessage(view.inbox, view.canManage)}</div>
          ) : (
            <ul className="ccw__lead-list" aria-label="Khách để lại số, mới nhất ở trên">
              {list.leads.map((lead) => (
                <CareLeadRow
                  key={lead.id}
                  lead={lead}
                  now={now}
                  busy={statusBusyId === lead.id}
                  locked={statusBusyId !== null}
                  onCopy={() => { void copyPhone(lead); }}
                  onCompose={() => compose(lead)}
                  onStatus={(status) => { void changeStatus(lead, status); }}
                />
              ))}
            </ul>
          )}

          {list.nextCursor !== null && leadsLoaded && (
            <div className="ccw__actions ccw__actions--center">
              <button type="button" className="cmr-button" disabled={loadingMore} onClick={() => { void loadMore(); }}>
                {loadingMore ? 'Đang tải…' : 'Xem thêm'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

interface CareLeadRowProps {
  lead: CustomerCareLead;
  now: number;
  busy: boolean;
  locked: boolean;
  onCopy: () => void;
  onCompose: () => void;
  onStatus: (status: CustomerCareLeadStatus) => void;
}

function CareLeadRow({ lead, now, busy, locked, onCopy, onCompose, onStatus }: CareLeadRowProps) {
  const name = leadDisplayName(lead);
  const canCompose = latestCustomerText(lead) !== null;
  const statusId = `ccw-lead-status-${lead.id}`;
  return (
    <li className={`ccw__lead ccw__lead--${lead.status}`}>
      <div className="ccw__lead-head">
        <div className="ccw__lead-who">
          <strong>{name}</strong>
          {lead.zaloMentioned && <span className="ccw__badge">Có nhắc Zalo</span>}
          <time dateTime={lead.phoneCapturedAt} title={formatLeadAbsoluteTime(lead.phoneCapturedAt)}>
            Để lại số: {formatLeadTime(lead.phoneCapturedAt, now)}
          </time>
        </div>
        <label className="ccw__lead-status" htmlFor={statusId}>
          <span>Trạng thái</span>
          <select
            id={statusId}
            value={lead.status}
            disabled={locked}
            aria-busy={busy || undefined}
            onChange={(event) => onStatus(event.currentTarget.value as CustomerCareLeadStatus)}
          >
            {CARE_LEAD_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="ccw__lead-phone">
        <span className="ccw__phone">{formatLeadPhone(lead.phone)}</span>
        <button type="button" className="cmr-button" aria-label={`Sao chép số của ${name}`} onClick={onCopy}>
          Sao chép
        </button>
      </div>

      {lead.recentMessages.length > 0 && (
        <ol className="ccw__lead-messages" aria-label={`Tin gần nhất của ${name}`}>
          {lead.recentMessages.map((message, index) => (
            <li key={`${message.at}-${index}`}>
              <p>{message.text}</p>
              <time dateTime={message.at}>{formatLeadTime(message.at, now)}</time>
            </li>
          ))}
        </ol>
      )}

      <div className="ccw__lead-actions">
        <button
          type="button"
          className="cmr-button"
          disabled={!canCompose}
          title={canCompose ? undefined : 'Tin gần nhất chỉ có tệp đính kèm.'}
          onClick={onCompose}
        >
          Soạn trả lời
        </button>
      </div>
    </li>
  );
}
