import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CustomerCareInboxInput,
  CustomerCareInboxResult,
  CustomerCareLead,
  CustomerCareLeadListInput,
  CustomerCareLeadListResult,
  CustomerCareLeadPurgeInput,
  CustomerCareLeadPurgeResult,
  CustomerCareLeadStatus,
  CustomerCareLeadStatusInput,
  CustomerCareLeadStatusResult,
  CustomerCareSyncRecentResult,
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
  formatLeadClockTime,
  formatLeadPhone,
  formatLeadTime,
  inboxStatusLine,
  inboxViewFromResult,
  keepsLeadsInMemory,
  latestCustomerText,
  leadDisplayName,
  leadListOnFirstPage,
  leadListOnMore,
  leadListOnPurge,
  leadListOnStatus,
  purgeLeadConfirmText,
  resolveLeadPageLabel,
  shouldPollLeads,
  type CareInboxView,
  type CareLeadListState,
} from './customer-care-leads-flow';
import { CRM_BACKFILL_UPDATED_EVENT } from './customer-care-page-flow';
import { usePanelVisible } from '../lib/panel-visibility';

type CareLeadsApi = {
  getFacebookInbox: () => Promise<CustomerCareInboxResult>;
  setFacebookInbox: (input: CustomerCareInboxInput) => Promise<CustomerCareInboxResult>;
  listLeads: (input: CustomerCareLeadListInput) => Promise<CustomerCareLeadListResult>;
  setLeadStatus: (input: CustomerCareLeadStatusInput) => Promise<CustomerCareLeadStatusResult>;
  /** B1b; absent on an older preload, which simply hides the purge action. */
  purgeLead?: (input: CustomerCareLeadPurgeInput) => Promise<CustomerCareLeadPurgeResult>;
  /** Multi-page delta sync; absent on an older preload. */
  syncRecentLeads?: () => Promise<CustomerCareSyncRecentResult>;
};

const GENERIC_ERROR = 'Chưa tải được khách để lại số. Thử lại sau ít phút.';

function getCareLeadsApi(): CareLeadsApi | null {
  const api = (window.electronAPI as typeof window.electronAPI & { customerCare?: Partial<CareLeadsApi> }).customerCare;
  if (!api?.getFacebookInbox || !api.setFacebookInbox || !api.listLeads || !api.setLeadStatus) return null;
  return api as CareLeadsApi;
}

function dispatchCrmUpdated(): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new CustomEvent(CRM_BACKFILL_UPDATED_EVENT));
  }
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
  /** Opens the CRM Khách hàng tab inside Agent Marketing. */
  onOpenCrm?: () => void;
  /** Map of connected/CRM Page IDs to display names. */
  pageNames?: Readonly<Record<string, string>>;
}

/**
 * Phase B1 "Khách để lại số": compact 2-column Pancake-style view with continuous multi-page sync.
 * Phones and messages live only in this component's state; they are rendered as plain text.
 */
export function CustomerCareLeadsPanel({ scopeKey, onCompose, onOpenCrm, pageNames }: CustomerCareLeadsPanelProps) {
  const active = usePanelVisible();
  const [view, setView] = useState<CareInboxView>({ state: 'loading' });
  const [list, setList] = useState<CareLeadListState>(EMPTY_LEAD_LIST);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [leadsLoaded, setLeadsLoaded] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [toggling, setToggling] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [purgeBusyId, setPurgeBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const documentVisible = useDocumentVisible();
  const mountedRef = useRef(true);
  const seenLeadIdsRef = useRef<Set<string> | null>(null);
  // Bumped by every status change or purge: a refresh that started before it must not undo it on screen.
  const mutationRef = useRef(0);
  const hasCrmOnlyPages = Boolean(pageNames && Object.keys(pageNames).length > 0);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /** Forget every phone and message held for display. */
  const dropLeads = useCallback(() => {
    setList(EMPTY_LEAD_LIST);
    setSelectedLeadId(null);
    setLeadsLoaded(false);
    seenLeadIdsRef.current = null;
  }, []);

  // A section that turned hidden (role lowered, Page gone) or failed keeps no phones in memory.
  const keepLeads = keepsLeadsInMemory(view) || (view.state === 'hidden' && hasCrmOnlyPages);
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
      const tickMs = Date.now();
      setNow(tickMs);
      if (!result.ok) {
        if (failureDropsLeads(result)) dropLeads();
        setError(careLeadsErrorMessage(result, 'leads'));
        return;
      }
      if (result.workspaceId !== scopeKey || mutation !== mutationRef.current) return;
      const previousSeen = seenLeadIdsRef.current;
      const nextIds = new Set(result.leads.map((item) => item.id));
      const hasNewLead = previousSeen !== null && result.leads.some((item) => !previousSeen.has(item.id));
      seenLeadIdsRef.current = nextIds;

      setList((current) => leadListOnFirstPage(current, result));
      setLeadsLoaded(true);
      setLastSyncedAt(tickMs);
      setError('');
      if (hasNewLead) dispatchCrmUpdated();
    } catch {
      if (mountedRef.current) setError(GENERIC_ERROR);
    }
  }, [scopeKey, dropLeads]);

  useEffect(() => {
    void loadInbox(false);
  }, [loadInbox]);

  const sectionReady = view.state === 'ready' || (view.state === 'hidden' && hasCrmOnlyPages);
  const inboxEnabled = view.state === 'ready' && view.inbox.enabled;
  const visible = active && documentVisible;
  const polling = shouldPollLeads({
    active,
    documentVisible,
    inboxEnabled,
    hasConnectedPage: view.state === 'ready' || hasCrmOnlyPages,
  });

  // Leads load whenever the section comes on screen; new ones are polled every 60s across connected Pages.
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

  const syncNow = async () => {
    const api = getCareLeadsApi();
    if (!api || syncing) return;
    setSyncing(true);
    setError('');
    setNotice('');
    try {
      if (api.syncRecentLeads) {
        const res = await api.syncRecentLeads();
        if (!mountedRef.current) return;
        if (!res.ok) {
          if (res.error === 'refresh_too_soon') {
            setNotice(`Vừa quét tin mới, thử lại sau ${res.retryAfterSec} giây.`);
          } else {
            setError(careLeadsErrorMessage(res, 'leads'));
          }
        } else if (res.workspaceId === scopeKey) {
          setNotice(
            res.leadsImported > 0
              ? `Đã quét ${res.pagesProcessed} Page: cập nhật ${res.leadsImported} khách có SĐT.`
              : `Đã quét ${res.pagesProcessed} Page (${res.conversationsScanned} hội thoại): chưa có SĐT mới.`,
          );
        }
      }
      await refreshLeads();
      if (mountedRef.current) dispatchCrmUpdated();
    } catch {
      if (mountedRef.current) setError(GENERIC_ERROR);
    } finally {
      if (mountedRef.current) setSyncing(false);
    }
  };

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
        ? 'Đã bật nhận tin nhắn từ Page. izzi chỉ gửi tin cho khách khi bật “Tự động trả lời khách”.'
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
    if (!api || status === lead.status || statusBusyId !== null || purgeBusyId !== null) return;
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

  /** B1b: owner/manager delete one customer's phone and messages after an explicit confirm. */
  const purgeLead = async (lead: CustomerCareLead) => {
    const api = getCareLeadsApi();
    if (!api?.purgeLead || view.state !== 'ready' || !view.canManage) return;
    if (statusBusyId !== null || purgeBusyId !== null) return;
    if (!window.confirm(purgeLeadConfirmText(lead))) return;
    mutationRef.current += 1;
    setPurgeBusyId(lead.id);
    setError('');
    setNotice('');
    try {
      const result = await api.purgeLead({ leadId: lead.id });
      if (!mountedRef.current) return;
      if (!result.ok) {
        if (failureDropsLeads(result)) dropLeads();
        setError(careLeadsErrorMessage(result, 'purge'));
        if (result.reason === 'lead_not_found') void refreshLeads();
        return;
      }
      if (result.workspaceId !== scopeKey) return;
      mutationRef.current += 1;
      setList((current) => leadListOnPurge(current, result.leadId));
      setNotice(`Đã xoá dữ liệu của ${leadDisplayName(lead)}.`);
    } catch {
      if (mountedRef.current) setError('Chưa xoá được dữ liệu khách. Thử lại sau ít phút.');
    } finally {
      if (mountedRef.current) setPurgeBusyId(null);
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

  const selectedLead = useMemo(() => {
    if (list.leads.length === 0) return null;
    if (selectedLeadId) {
      const match = list.leads.find((item) => item.id === selectedLeadId);
      if (match) return match;
    }
    return list.leads[0];
  }, [list.leads, selectedLeadId]);

  if (view.state === 'loading' || (!sectionReady && view.state === 'hidden')) return null;

  const canPurge = view.state === 'ready' && view.canManage && Boolean(getCareLeadsApi()?.purgeLead);
  const rowsLocked = statusBusyId !== null || purgeBusyId !== null;
  const hasSyncRecent = Boolean(getCareLeadsApi()?.syncRecentLeads);

  return (
    <section className="ccw__section ccw__leads" aria-labelledby="ccw-leads-title">
      <div className="ccw__section-heading ccw__leads-topbar">
        <div>
          <span className="cmr-eyebrow">Tin nhắn Page · Chỉ đọc</span>
          <h3 id="ccw-leads-title">Khách để lại số ({list.leads.length}{list.nextCursor ? '+' : ''})</h3>
        </div>
        <div className="ccw__sync-bar">
          <span className="ccw__sync-pill">
            <span className="ccw__sync-dot" aria-hidden="true">●</span> Tự động đồng bộ 60s · đa Page
          </span>
          {lastSyncedAt !== null && (
            <span className="ccw__sync-time">Cập nhật {formatLeadClockTime(lastSyncedAt)}</span>
          )}
          <button
            type="button"
            className="cmr-button"
            disabled={syncing || !hasSyncRecent}
            title={hasSyncRecent ? undefined : 'Cần cập nhật ứng dụng để quét tin mới ngay'}
            onClick={() => { void syncNow(); }}
          >
            {syncing ? 'Đang quét…' : 'Quét tin mới ngay'}
          </button>
        </div>
      </div>

      {view.state === 'error' ? (
        <div className="ccw__leads-retry">
          <p className="ccw__hint" role="alert">{view.message}</p>
          <button type="button" className="cmr-button" onClick={() => { void loadInbox(false); }}>Thử lại</button>
        </div>
      ) : (
        <>
          {view.state === 'ready' && (
            <div className="ccw__inbox ccw__inbox--compact">
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
          )}

          {error && <div className="cmr-alert cmr-alert--error" role="alert">{error}</div>}
          {notice && <div className="cmr-alert cmr-alert--success" role="status">{notice}</div>}

          {!leadsLoaded ? (
            !error && <p className="ccw__hint" role="status">Đang tải danh sách khách…</p>
          ) : list.leads.length === 0 ? (
            <div className="ccw__empty">
              {view.state === 'ready'
                ? emptyLeadsMessage(view.inbox, view.canManage)
                : 'Chưa có khách để lại số từ các Page đã kết nối.'}
            </div>
          ) : (
            <div className="ccw__pancake" role="region" aria-label="Danh sách khách để lại số 2 cột">
              <div className="ccw__pancake-list">
                <ul className="ccw__lead-compact-list" aria-label="Khách để lại số, mới nhất ở trên">
                  {list.leads.map((lead) => {
                    const activeRow = selectedLead?.id === lead.id;
                    const name = leadDisplayName(lead);
                    const pageLabel = resolveLeadPageLabel(lead.pageId, pageNames);
                    return (
                      <li key={lead.id}>
                        <button
                          type="button"
                          className={`ccw__lead-row${activeRow ? ' is-selected' : ''}`}
                          aria-pressed={activeRow}
                          onClick={() => setSelectedLeadId(lead.id)}
                        >
                          <span className={`ccw__lead-dot ccw__lead-dot--${lead.status}`} aria-hidden="true" />
                          <span className="ccw__lead-row-body">
                            <span className="ccw__lead-row-top">
                              <strong className="ccw__lead-row-name">{name}</strong>
                              {lead.zaloMentioned && <span className="ccw__lead-row-zalo">Zalo</span>}
                              <time dateTime={lead.phoneCapturedAt}>{formatLeadTime(lead.phoneCapturedAt, now)}</time>
                            </span>
                            <span className="ccw__lead-row-sub">
                              <span className="ccw__lead-row-phone">{formatLeadPhone(lead.phone)}</span>
                              <span className="ccw__lead-row-page">{pageLabel}</span>
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {list.nextCursor !== null && (
                  <div className="ccw__pancake-more">
                    <button type="button" className="cmr-button" disabled={loadingMore} onClick={() => { void loadMore(); }}>
                      {loadingMore ? 'Đang tải…' : 'Xem thêm'}
                    </button>
                  </div>
                )}
              </div>

              {selectedLead && (
                <CareLeadDetailPane
                  lead={selectedLead}
                  pageLabel={resolveLeadPageLabel(selectedLead.pageId, pageNames)}
                  now={now}
                  busy={statusBusyId === selectedLead.id}
                  locked={rowsLocked}
                  canPurge={canPurge}
                  purging={purgeBusyId === selectedLead.id}
                  onCopy={() => { void copyPhone(selectedLead); }}
                  onCompose={() => compose(selectedLead)}
                  onOpenCrm={onOpenCrm}
                  onStatus={(status) => { void changeStatus(selectedLead, status); }}
                  onPurge={() => { void purgeLead(selectedLead); }}
                />
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

interface CareLeadDetailPaneProps {
  lead: CustomerCareLead;
  pageLabel: string;
  now: number;
  busy: boolean;
  locked: boolean;
  canPurge: boolean;
  purging: boolean;
  onCopy: () => void;
  onCompose: () => void;
  onOpenCrm?: () => void;
  onStatus: (status: CustomerCareLeadStatus) => void;
  onPurge: () => void;
}

function CareLeadDetailPane({
  lead,
  pageLabel,
  now,
  busy,
  locked,
  canPurge,
  purging,
  onCopy,
  onCompose,
  onOpenCrm,
  onStatus,
  onPurge,
}: CareLeadDetailPaneProps) {
  const name = leadDisplayName(lead);
  const canCompose = latestCustomerText(lead) !== null;
  const statusId = `ccw-lead-status-${lead.id}`;

  return (
    <div className={`ccw__pancake-detail ccw__lead--${lead.status}`}>
      <div className="ccw__lead-head">
        <div className="ccw__lead-who">
          <strong>{name}</strong>
          <span className="ccw__connected-chip ccw__connected-chip--crm">{pageLabel}</span>
          {lead.zaloMentioned && <span className="ccw__badge">Có nhắc Zalo</span>}
          <time dateTime={lead.phoneCapturedAt} title={formatLeadAbsoluteTime(lead.phoneCapturedAt)}>
            Để lại số: {formatLeadTime(lead.phoneCapturedAt, now)} ({formatLeadAbsoluteTime(lead.phoneCapturedAt)})
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

      {lead.recentMessages.length > 0 ? (
        <ol className="ccw__lead-messages" aria-label={`Tin gần nhất của ${name}`}>
          {lead.recentMessages.map((message, index) => (
            <li key={`${message.at}-${index}`}>
              <p>{message.text}</p>
              <time dateTime={message.at}>{formatLeadTime(message.at, now)}</time>
            </li>
          ))}
        </ol>
      ) : (
        <p className="ccw__hint">Chưa có nội dung tin nhắn gần nhất.</p>
      )}

      <div className="ccw__lead-actions">
        <button
          type="button"
          className="cmr-button"
          disabled={!canCompose}
          title={canCompose ? undefined : 'Tin gần nhất chỉ có tệp đính kèm.'}
          onClick={onCompose}
        >
          Soạn trả lời nháp
        </button>
        {onOpenCrm && (
          <button type="button" className="cmr-button cmr-button--primary" onClick={onOpenCrm}>
            Mở trong CRM Khách hàng →
          </button>
        )}
        {canPurge && (
          <button
            type="button"
            className="cmr-button cmr-button--danger"
            disabled={locked}
            aria-busy={purging || undefined}
            aria-label={`Xoá dữ liệu khách ${name}`}
            onClick={onPurge}
          >
            {purging ? 'Đang xoá…' : 'Xoá dữ liệu khách'}
          </button>
        )}
      </div>
    </div>
  );
}
