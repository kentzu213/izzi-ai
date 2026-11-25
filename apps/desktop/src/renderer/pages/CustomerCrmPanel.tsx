import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CustomerCareCrmAssignee,
  CustomerCareCrmListInput,
  CustomerCareCrmListResult,
  CustomerCareCrmProfileInput,
  CustomerCareCrmRow,
  CustomerCareCrmSaveInput,
  CustomerCareCrmSaveResult,
  CustomerCareCrmStage,
  CustomerCareLeadPurgeInput,
  CustomerCareLeadPurgeResult,
  CustomerCareSnapshot,
} from '../../shared/customer-care-types';
import { usePanelVisible } from '../lib/panel-visibility';
import { careLeadsErrorMessage, leadDisplayName, purgeLeadConfirmText } from './customer-care-leads-flow';
import {
  CRM_FORBIDDEN_MESSAGE,
  CRM_MAX_PAGES,
  CRM_REFRESH_MS,
  CRM_STAGE_OPTIONS,
  crmCallTodayCount,
  crmEditAfterSaved,
  crmEditOnChange,
  crmEditOnConflict,
  crmEditOnDiscard,
  crmEditOnReapply,
  crmFailureView,
  crmRefreshCooldownLeft,
  crmProductOptions,
  crmProfilesEqual,
  crmReloadAfterSave,
  crmRowReadOnly,
  crmRowsOnFirstPage,
  crmRowsOnRefresh,
  crmRowsOnRemove,
  crmRowWithProfile,
  crmRowsOnSaved,
  crmSaveDecision,
  crmSaveFailureView,
  crmShouldLoadOnShow,
  crmShouldSkipNextTick,
  crmVisibleRows,
  loadCrmPages,
  normalizeCrmProfile,
  profileFromRow,
  type CrmFilter,
  type CrmProductOption,
  type CrmRowEdit,
} from './customer-crm-flow';
import { crmGraphRows, crmOpenProfile, type CrmDisplay } from './customer-crm-graph';
import { CrmSaveQueue } from './customer-crm-save-queue';
import { CustomerCrmGraphSlot } from './CustomerCrmGraphSlot';
import { CustomerCrmRow } from './CustomerCrmRow';
import '../styles/v2/customer-crm.css';

const DISPLAYS: ReadonlyArray<{ id: CrmDisplay; label: string }> = [
  { id: 'table', label: 'Bảng' },
  { id: 'graph', label: 'Sơ đồ' },
];

/** "Bảng | Sơ đồ": the same rows as a call list or as a graph. */
export function CustomerCrmDisplaySwitch({ display, onChange }: { display: CrmDisplay; onChange: (display: CrmDisplay) => void }) {
  return (
    <div className="v2-project-tabs" role="group" aria-label="Kiểu xem">
      {DISPLAYS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`v2-tab${display === item.id ? ' is-active' : ''}`}
          aria-pressed={display === item.id}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

type CrmApi = {
  getSnapshot: () => Promise<CustomerCareSnapshot>;
  listCrm: (input: CustomerCareCrmListInput) => Promise<CustomerCareCrmListResult>;
  saveCrmProfile: (input: CustomerCareCrmSaveInput) => Promise<CustomerCareCrmSaveResult>;
  /** Absent on an older preload, which hides the purge action. */
  purgeLead?: (input: CustomerCareLeadPurgeInput) => Promise<CustomerCareLeadPurgeResult>;
};

type Edits = Readonly<Record<string, CrmRowEdit>>;
type Phase = { state: 'loading' } | { state: 'blocked'; message: string } | { state: 'ready' };

interface CrmMeta {
  canDelete: boolean;
  assignees: CustomerCareCrmAssignee[];
  truncated: boolean;
}

const GENERIC_LOAD_ERROR = 'Chưa tải được CRM. Thử lại sau ít phút.';
const GENERIC_SAVE_ERROR = 'Chưa lưu được. Thử lại sau ít phút.';
const REFRESH_RESTING_NOTE = 'Vừa tải xong. Có thể làm mới lại sau 15 giây.';
const NO_APP_MESSAGE = 'CRM chỉ chạy trong ứng dụng izzi.';
const NO_ASSIGNEES: CustomerCareCrmAssignee[] = [];

function getCrmApi(): CrmApi | null {
  if (typeof window === 'undefined') return null;
  const api = (window.electronAPI as typeof window.electronAPI & { customerCare?: Partial<CrmApi> }).customerCare;
  if (!api?.getSnapshot || !api.listCrm || !api.saveCrmProfile) return null;
  return api as CrmApi;
}

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

function withoutKey(edits: Edits, leadId: string): Edits {
  if (!(leadId in edits)) return edits;
  const { [leadId]: _removed, ...rest } = edits;
  return rest;
}

/**
 * MyGraph → CRM (Care CRM S2): Care leads as a call list that staff fill in by hand. The workspace and role
 * come from main's live marketing-workspace authority, exactly as for the Care leads panel. Rows, phones and
 * notes live only in this component's memory; edits are saved per row after a pause in typing or on "Lưu".
 */
export function CustomerCrmPanel() {
  const active = usePanelVisible();
  const documentVisible = useDocumentVisible();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  const [rows, setRows] = useState<CustomerCareCrmRow[]>([]);
  const [edits, setEdits] = useState<Edits>({});
  const [meta, setMeta] = useState<CrmMeta | null>(null);
  const [products, setProducts] = useState<CrmProductOption[]>([]);
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [filter, setFilter] = useState<CrmFilter>({ view: 'today', stage: 'any' });
  const [display, setDisplay] = useState<CrmDisplay>('table');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** The row "Mở hồ sơ" opened: scrolled into view and focused once the table shows it. */
  const [revealId, setRevealId] = useState<string | null>(null);
  const [purgingId, setPurgingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** "Làm mới" rests for 15 s after a full reload. */
  const [refreshResting, setRefreshResting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const mountedRef = useRef(true);
  const rowsRef = useRef<CustomerCareCrmRow[]>([]);
  const editsRef = useRef<Edits>({});
  /** The workspace the rows on screen belong to; null until the first answer. */
  const scopeRef = useRef<string | null>(null);
  /** Rows deleted here: a refresh that started before the delete must not bring them back. */
  const removedRef = useRef<Set<string>>(new Set());
  const loadSeqRef = useRef(0);
  /** When the last every-page load started, so reopening the tab does not reload every page again at once. */
  const lastFullLoadAtRef = useRef<number | null>(null);
  /** Refresh ticks to skip after a 429 or a 503, instead of adding load. */
  const skipTicksRef = useRef(0);
  const queueRef = useRef<CrmSaveQueue | null>(null);
  const loadRef = useRef<(mode: 'full' | 'page1') => Promise<void>>(async () => undefined);
  const restTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runSaveRef = useRef<(leadId: string, mode: 'auto' | 'explicit') => Promise<'done' | 'again'>>(
    async () => 'done',
  );

  const updateRows = useCallback((change: (current: CustomerCareCrmRow[]) => CustomerCareCrmRow[]) => {
    rowsRef.current = change(rowsRef.current);
    setRows(rowsRef.current);
  }, []);

  const updateEdits = useCallback((change: (current: Edits) => Edits) => {
    editsRef.current = change(editsRef.current);
    setEdits(editsRef.current);
  }, []);

  const markSaving = useCallback((leadId: string, saving: boolean) => {
    setSavingIds((current) => {
      const next = new Set(current);
      if (saving) next.add(leadId);
      else next.delete(leadId);
      return next;
    });
  }, []);

  /** Forget every row, phone and note held for display, e.g. after sign-out or a lost role. */
  const dropAll = useCallback((message: string) => {
    for (const leadId of Object.keys(editsRef.current)) queueRef.current?.cancel(leadId);
    scopeRef.current = null;
    removedRef.current = new Set();
    updateRows(() => []);
    updateEdits(() => ({}));
    setMeta(null);
    setProducts([]);
    setExpandedId(null);
    setNotice('');
    setError('');
    setPhase({ state: 'blocked', message });
  }, [updateRows, updateEdits]);

  const removeRow = useCallback((leadId: string) => {
    queueRef.current?.cancel(leadId);
    removedRef.current.add(leadId);
    updateRows((current) => crmRowsOnRemove(current, leadId));
    updateEdits((current) => withoutKey(current, leadId));
    setExpandedId((current) => (current === leadId ? null : current));
  }, [updateRows, updateEdits]);

  const loadProducts = useCallback(async (api: CrmApi, workspaceId: string) => {
    try {
      const snapshot = await api.getSnapshot();
      if (!mountedRef.current || scopeRef.current !== workspaceId) return;
      // Facts saved for another workspace on this machine never become this workspace's products.
      setProducts(snapshot.workspaceId === workspaceId ? crmProductOptions(snapshot.setup?.facts, Date.now()) : []);
    } catch {
      if (mountedRef.current) setProducts([]);
    }
  }, []);

  /**
   * `full` reads up to `CRM_MAX_PAGES` pages: when the tab opens, on "Làm mới", after a 409 and after a
   * workspace change. `page1` is the 60 s tick: it reads page 1 only and merges it by `leadId`.
   */
  const load = useCallback(async (requested: 'full' | 'page1') => {
    const api = getCrmApi();
    if (!api) {
      setPhase({ state: 'blocked', message: NO_APP_MESSAGE });
      return;
    }
    // Nothing is loaded yet, so there is nothing for page 1 to merge into.
    const mode = scopeRef.current === null ? 'full' : requested;
    const seq = ++loadSeqRef.current;
    if (mode === 'full') {
      lastFullLoadAtRef.current = Date.now();
      setRefreshing(true);
      setRefreshResting(true);
      if (restTimerRef.current !== null) clearTimeout(restTimerRef.current);
      restTimerRef.current = setTimeout(() => {
        restTimerRef.current = null;
        if (mountedRef.current) setRefreshResting(false);
      }, crmRefreshCooldownLeft(lastFullLoadAtRef.current, Date.now()));
    }
    try {
      const result = await loadCrmPages((input) => api.listCrm(input), mode === 'full' ? CRM_MAX_PAGES : 1);
      if (!mountedRef.current || seq !== loadSeqRef.current) return;
      setNow(Date.now());
      if (!result.ok) {
        const view = crmFailureView(result);
        if (crmShouldSkipNextTick(result)) skipTicksRef.current = 1;
        if (view.dropRows) dropAll(view.message);
        else if (scopeRef.current === null) setPhase({ state: 'blocked', message: view.message });
        else setError(view.message);
        return;
      }
      const switched = scopeRef.current !== result.workspaceId;
      if (switched && scopeRef.current !== null) {
        // Another workspace is active now: nothing from the previous one stays on screen.
        for (const leadId of Object.keys(editsRef.current)) queueRef.current?.cancel(leadId);
        removedRef.current = new Set();
        updateRows(() => []);
        updateEdits(() => ({}));
        setExpandedId(null);
        if (mode === 'page1') {
          // Page 1 of another workspace is not enough: read all of it.
          scopeRef.current = null;
          void loadRef.current('full');
          return;
        }
      }
      scopeRef.current = result.workspaceId;
      updateRows((current) => (mode === 'full'
        ? crmRowsOnRefresh(current, result.rows, removedRef.current)
        : crmRowsOnFirstPage(current, result.rows, result.complete, removedRef.current)));
      const present = new Set(rowsRef.current.map((row) => row.leadId));
      for (const leadId of Object.keys(editsRef.current)) {
        if (!present.has(leadId)) queueRef.current?.cancel(leadId);
      }
      updateEdits((current) => Object.fromEntries(Object.entries(current).filter(([leadId]) => present.has(leadId))));
      setExpandedId((current) => (current !== null && present.has(current) ? current : null));
      setMeta((current) => ({
        canDelete: result.canDelete,
        assignees: result.assignees,
        // Only an every-page load knows whether more than 500 customers exist.
        truncated: mode === 'full' ? result.truncated : (current?.truncated ?? false),
      }));
      setPhase({ state: 'ready' });
      setError('');
      if (switched) void loadProducts(api, result.workspaceId);
    } catch {
      if (!mountedRef.current || seq !== loadSeqRef.current) return;
      skipTicksRef.current = 1;
      if (scopeRef.current === null) setPhase({ state: 'blocked', message: GENERIC_LOAD_ERROR });
      else setError(GENERIC_LOAD_ERROR);
    } finally {
      if (mountedRef.current && mode === 'full') setRefreshing(false);
    }
  }, [dropAll, loadProducts, updateEdits, updateRows]);

  const setRowError = useCallback((leadId: string, message: string) => {
    updateEdits((current) => (current[leadId] ? { ...current, [leadId]: { ...current[leadId], error: message } } : current));
  }, [updateEdits]);

  /** One save for one row; the queue guarantees it is the only one in flight for that row. */
  const runSave = async (leadId: string, mode: 'auto' | 'explicit'): Promise<'done' | 'again'> => {
    const api = getCrmApi();
    const row = rowsRef.current.find((item) => item.leadId === leadId);
    const edit = editsRef.current[leadId];
    if (!api || !row || !edit) return 'done';
    const decision = crmSaveDecision(edit, row, Date.now());
    if (decision.kind === 'skip') {
      if (!edit.rejected) updateEdits((current) => withoutKey(current, leadId));
      return 'done';
    }
    if (decision.kind === 'invalid') {
      setRowError(leadId, decision.message);
      return 'done';
    }
    markSaving(leadId, true);
    try {
      const result = await api.saveCrmProfile(decision.input);
      // Rows and edits are updated even after the panel closed, so a final save on close builds on this one.
      // Only requests (reloads) wait for a mounted panel.
      const reload = crmReloadAfterSave(result);
      if (result.ok || result.error === 'profile_conflict') {
        if (result.workspaceId !== scopeRef.current) return 'done';
        const known = rowsRef.current.find((item) => item.leadId === leadId);
        if (!known) return 'done';
        // The answer carries the stored profile only; the row keeps the phone, messages and times it shows.
        const merged = crmRowWithProfile(known, result.profile);
        updateRows((current) => crmRowsOnSaved(current, merged));
        if (!result.ok) {
          updateEdits((current) => ({ ...current, [leadId]: crmEditOnConflict(current[leadId], merged) }));
          setExpandedId((current) => current ?? leadId);
          // Someone else is editing: read every page again so other rows they changed show too.
          if (reload && mountedRef.current) void loadRef.current(reload);
          return 'done';
        }
        const next = crmEditAfterSaved(editsRef.current[leadId], merged);
        updateEdits((current) => (next ? { ...current, [leadId]: next } : withoutKey(current, leadId)));
        if (mode === 'explicit') setNotice(`Đã lưu hồ sơ của ${leadDisplayName(merged)}.`);
        const pending = next !== null && !crmProfilesEqual(normalizeCrmProfile(next.draft), profileFromRow(merged));
        return pending ? 'again' : 'done';
      }
      if (result.reason === 'lead_not_found') {
        removeRow(leadId);
        setNotice('Khách này không còn trong danh sách.');
        return 'done';
      }
      // A 429 or a 503 is never retried by itself: the row waits for the user, and the next tick is skipped.
      if (crmShouldSkipNextTick(result)) skipTicksRef.current = 1;
      const view = crmSaveFailureView(result);
      if (view.dropRows) {
        dropAll(view.message);
        return 'done';
      }
      // The draft stays and the row stays editable; owner_not_eligible also re-reads page 1 for the assignees.
      setRowError(leadId, view.message);
      if (reload && mountedRef.current) void loadRef.current(reload);
      return 'done';
    } catch {
      setRowError(leadId, GENERIC_SAVE_ERROR);
      return 'done';
    } finally {
      markSaving(leadId, false);
    }
  };

  // The queue calls the latest save, so it always reads the current rows, edits and workspace.
  useEffect(() => {
    runSaveRef.current = runSave;
  });

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  useEffect(() => {
    mountedRef.current = true;
    const queue = new CrmSaveQueue((leadId, mode) => runSaveRef.current(leadId, mode));
    queueRef.current = queue;
    return () => {
      mountedRef.current = false;
      // Leaving MyGraph: send what is still waiting, plus one final save for a row changed mid-save.
      queue.close();
      if (queueRef.current === queue) queueRef.current = null;
      // The "Làm mới" rest timer is left to run: it only touches state while mounted, and a development
      // re-mount (StrictMode) must not leave the button resting for good.
    };
  }, []);

  const visible = active && documentVisible;
  // Opening the tab reloads every page (at most once per refresh period); while it stays on screen the 60 s
  // tick reads page 1 only. A tick after a 429 or a 503 is skipped.
  useEffect(() => {
    if (!visible) return undefined;
    if (crmShouldLoadOnShow(lastFullLoadAtRef.current, Date.now())) void load('full');
    const timer = setInterval(() => {
      if (skipTicksRef.current > 0) {
        skipTicksRef.current -= 1;
        return;
      }
      void load('page1');
    }, CRM_REFRESH_MS);
    return () => clearInterval(timer);
  }, [visible, load]);

  useEffect(() => {
    if (display !== 'table' || revealId === null) return;
    // 'nearest' scrolls only the CRM panel; 'center' would also shift the shell's overflow-hidden frames.
    document.getElementById(`crm-editor-${revealId}`)?.scrollIntoView({ block: 'nearest' });
    document.getElementById(`crm-stage-${revealId}`)?.focus({ preventScroll: true });
    setRevealId(null);
  }, [display, revealId]);

  /** The card's "Mở hồ sơ": back to the table with that customer's editor open. */
  const openProfile = (leadId: string) => {
    const next = crmOpenProfile(leadId);
    setDisplay(next.display);
    setExpandedId(next.expandedId);
    setRevealId(next.revealId);
  };

  const change = (row: CustomerCareCrmRow, profile: CustomerCareCrmProfileInput) => {
    // A row whose details could not be opened is never saved, so it takes no edits either.
    if (crmRowReadOnly(row)) return;
    updateEdits((current) => ({ ...current, [row.leadId]: crmEditOnChange(current[row.leadId], profile, row) }));
    setNotice('');
    queueRef.current?.changed(row.leadId);
  };

  const reapply = (row: CustomerCareCrmRow) => {
    const edit = editsRef.current[row.leadId];
    if (!edit) return;
    updateEdits((current) => ({ ...current, [row.leadId]: crmEditOnReapply(edit) }));
    queueRef.current?.changed(row.leadId);
  };

  /** Drops only the values the conflict rejected; anything typed since still saves as usual. */
  const discard = (row: CustomerCareCrmRow) => {
    const edit = editsRef.current[row.leadId];
    if (!edit) return;
    const next = crmEditOnDiscard(edit, row);
    updateEdits((current) => (next ? { ...current, [row.leadId]: next } : withoutKey(current, row.leadId)));
  };

  const copyPhone = async (row: CustomerCareCrmRow) => {
    try {
      await navigator.clipboard.writeText(row.phone);
      setError('');
      setNotice(`Đã sao chép số của ${leadDisplayName(row)}.`);
    } catch {
      setError('Không sao chép được. Bạn vẫn có thể chọn và sao chép số thủ công.');
    }
  };

  /** The existing B1b purge: owner/manager delete the customer's lead, messages and (by cascade) profile. */
  const purge = async (row: CustomerCareCrmRow) => {
    const api = getCrmApi();
    if (!api?.purgeLead || !meta?.canDelete || purgingId !== null) return;
    if (!window.confirm(purgeLeadConfirmText(row))) return;
    setPurgingId(row.leadId);
    setError('');
    setNotice('');
    try {
      const result = await api.purgeLead({ leadId: row.leadId });
      if (!mountedRef.current) return;
      if (!result.ok) {
        const view = crmFailureView(result);
        if (crmShouldSkipNextTick(result)) skipTicksRef.current = 1;
        if (view.dropRows && result.error !== 'forbidden') dropAll(view.message);
        else setError(careLeadsErrorMessage(result, 'purge'));
        if (result.reason === 'lead_not_found') removeRow(row.leadId);
        return;
      }
      if (result.workspaceId !== scopeRef.current) return;
      removeRow(result.leadId);
      setNotice(`Đã xoá dữ liệu của ${leadDisplayName(row)}.`);
    } catch {
      if (mountedRef.current) setError('Chưa xoá được dữ liệu khách. Thử lại sau ít phút.');
    } finally {
      if (mountedRef.current) setPurgingId(null);
    }
  };

  const canPurge = Boolean(meta?.canDelete && getCrmApi()?.purgeLead);
  const shown = crmVisibleRows(rows, filter, now, expandedId);
  const todayCount = crmCallTodayCount(rows, now);
  const graphRows = useMemo(() => (display === 'graph' ? crmGraphRows(rows, filter.stage) : []), [display, rows, filter.stage]);

  return (
    <section className="v2-crm" aria-labelledby="v2-crm-title">
      <header className="v2-crm__header">
        <div>
          <h2 id="v2-crm-title" className="v2-crm__title">Khách để lại số</h2>
          <p className="v2-crm__lead">Hồ sơ do nhân viên ghi tay. Chỉ hiện ở đây, không đưa vào Memory và không lưu trên máy.</p>
        </div>
        {phase.state === 'ready' && (
          <div className="v2-crm__refresh">
            {refreshResting && !refreshing && <span className="v2-crm__meta" id="v2-crm-refresh-note">Vừa tải xong</span>}
            <button
              type="button"
              className="v2-button v2-button--ghost"
              disabled={refreshing || refreshResting}
              title={refreshResting && !refreshing ? REFRESH_RESTING_NOTE : undefined}
              aria-describedby={refreshResting && !refreshing ? 'v2-crm-refresh-note' : undefined}
              onClick={() => { void load('full'); }}
            >
              {refreshing ? 'Đang tải…' : 'Làm mới'}
            </button>
          </div>
        )}
      </header>

      {phase.state === 'loading' && <p className="v2-crm__hint" role="status">Đang tải CRM…</p>}

      {phase.state === 'blocked' && (
        <div className="v2-empty">
          <p role="alert">{phase.message}</p>
          {phase.message !== CRM_FORBIDDEN_MESSAGE && phase.message !== NO_APP_MESSAGE && (
            <button
              type="button"
              className="v2-button"
              disabled={refreshing || refreshResting}
              title={refreshResting && !refreshing ? REFRESH_RESTING_NOTE : undefined}
              onClick={() => { void load('full'); }}
            >
              Thử lại
            </button>
          )}
        </div>
      )}

      {phase.state === 'ready' && (
        <>
          {error && <p className="v2-crm__error" role="alert">{error}</p>}
          {notice && <p className="v2-crm__notice" role="status">{notice}</p>}

          <div className="v2-crm__toolbar">
            <div className="v2-crm__views">
              <CustomerCrmDisplaySwitch display={display} onChange={setDisplay} />
              {display === 'table' && (
                <div className="v2-project-tabs" role="group" aria-label="Danh sách">
                  <button
                    type="button"
                    className={`v2-tab${filter.view === 'today' ? ' is-active' : ''}`}
                    aria-pressed={filter.view === 'today'}
                    onClick={() => setFilter((current) => ({ ...current, view: 'today' }))}
                  >
                    Cần gọi hôm nay ({todayCount})
                  </button>
                  <button
                    type="button"
                    className={`v2-tab${filter.view === 'all' ? ' is-active' : ''}`}
                    aria-pressed={filter.view === 'all'}
                    onClick={() => setFilter((current) => ({ ...current, view: 'all' }))}
                  >
                    Tất cả ({rows.length})
                  </button>
                </div>
              )}
            </div>
            <label className="v2-crm__filter" htmlFor="v2-crm-stage-filter">
              <span className="v2-field__label">Giai đoạn</span>
              <select
                id="v2-crm-stage-filter"
                className="v2-field__select"
                value={filter.stage}
                onChange={(event) => {
                  const stage = event.currentTarget.value as CustomerCareCrmStage | 'any';
                  setFilter((current) => ({ ...current, stage }));
                }}
              >
                <option value="any">Tất cả giai đoạn</option>
                {CRM_STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>

          {rows.length === 0 ? (
            <div className="v2-empty">
              <p>Chưa có khách nào để lại số. Khi khách gửi số điện thoại qua tin nhắn Page, khách sẽ hiện ở đây.</p>
            </div>
          ) : display === 'graph' ? (
            graphRows.length === 0 ? (
              <div className="v2-empty">
                <p>Không có khách nào khớp bộ lọc.</p>
              </div>
            ) : (
              <CustomerCrmGraphSlot
                rows={graphRows}
                products={products}
                assignees={meta?.assignees ?? NO_ASSIGNEES}
                nowMs={now}
                onCopy={(row) => { void copyPhone(row); }}
                onOpenProfile={openProfile}
              />
            )
          ) : shown.length === 0 ? (
            <div className="v2-empty">
              <p>{filter.view === 'today' && filter.stage === 'any' ? 'Hôm nay chưa có khách cần gọi.' : 'Không có khách nào khớp bộ lọc.'}</p>
            </div>
          ) : (
            <div className="v2-crm__table-wrap">
              <table className="v2-crm__table">
                <caption className="v2-visually-hidden">
                  Khách để lại số: quá hạn trước, rồi đến hạn hôm nay, rồi theo giai đoạn.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Khách</th>
                    <th scope="col">Giai đoạn</th>
                    <th scope="col">Phụ trách</th>
                    <th scope="col">Việc tiếp theo</th>
                    <th scope="col"><span className="v2-visually-hidden">Trạng thái lưu</span></th>
                    <th scope="col"><span className="v2-visually-hidden">Thao tác</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => {
                    const edit = edits[row.leadId] ?? null;
                    return (
                      <CustomerCrmRow
                        key={row.leadId}
                        row={row}
                        profile={edit?.draft ?? profileFromRow(row)}
                        edit={edit}
                        saving={savingIds.has(row.leadId)}
                        expanded={expandedId === row.leadId}
                        nowMs={now}
                        assignees={meta?.assignees ?? []}
                        products={products}
                        canDelete={canPurge}
                        purging={purgingId === row.leadId}
                        onChange={(profile) => change(row, profile)}
                        onToggle={() => setExpandedId((current) => (current === row.leadId ? null : row.leadId))}
                        onSave={() => queueRef.current?.saveNow(row.leadId)}
                        onCopy={() => { void copyPhone(row); }}
                        onPurge={() => { void purge(row); }}
                        onReapply={() => reapply(row)}
                        onDiscard={() => discard(row)}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {meta?.truncated && <p className="v2-crm__hint">Đang hiện 500 khách mới nhất.</p>}
        </>
      )}
    </section>
  );
}
