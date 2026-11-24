import { useCallback, useEffect, useRef, useState } from 'react';
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
  CRM_SAVE_FORBIDDEN_MESSAGE,
  CRM_STAGE_OPTIONS,
  crmCallTodayCount,
  crmEditAfterSaved,
  crmEditOnChange,
  crmEditOnConflict,
  crmEditOnDiscard,
  crmEditOnReapply,
  crmFailureView,
  crmProductOptions,
  crmProfilesEqual,
  crmRowsOnRefresh,
  crmRowsOnRemove,
  crmRowsOnSaved,
  crmSaveDecision,
  crmVisibleRows,
  loadCrmPages,
  normalizeCrmProfile,
  profileFromRow,
  type CrmFilter,
  type CrmProductOption,
  type CrmRowEdit,
} from './customer-crm-flow';
import { CrmSaveQueue } from './customer-crm-save-queue';
import { CustomerCrmRow } from './CustomerCrmRow';
import '../styles/v2/customer-crm.css';

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
const NO_APP_MESSAGE = 'CRM chỉ chạy trong ứng dụng izzi.';

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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [purgingId, setPurgingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
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
  const queueRef = useRef<CrmSaveQueue | null>(null);
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

  const load = useCallback(async (quiet: boolean) => {
    const api = getCrmApi();
    if (!api) {
      setPhase({ state: 'blocked', message: NO_APP_MESSAGE });
      return;
    }
    const seq = ++loadSeqRef.current;
    if (!quiet) setRefreshing(true);
    try {
      const result = await loadCrmPages((input) => api.listCrm(input), CRM_MAX_PAGES);
      if (!mountedRef.current || seq !== loadSeqRef.current) return;
      setNow(Date.now());
      if (!result.ok) {
        const view = crmFailureView(result);
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
        updateEdits(() => ({}));
        setExpandedId(null);
      }
      scopeRef.current = result.workspaceId;
      updateRows((current) => crmRowsOnRefresh(switched ? [] : current, result.rows, removedRef.current));
      const present = new Set(rowsRef.current.map((row) => row.leadId));
      for (const leadId of Object.keys(editsRef.current)) {
        if (!present.has(leadId)) queueRef.current?.cancel(leadId);
      }
      updateEdits((current) => Object.fromEntries(Object.entries(current).filter(([leadId]) => present.has(leadId))));
      setExpandedId((current) => (current !== null && present.has(current) ? current : null));
      setMeta({ canDelete: result.canDelete, assignees: result.assignees, truncated: result.truncated });
      setPhase({ state: 'ready' });
      setError('');
      if (switched) void loadProducts(api, result.workspaceId);
    } catch {
      if (!mountedRef.current || seq !== loadSeqRef.current) return;
      if (scopeRef.current === null) setPhase({ state: 'blocked', message: GENERIC_LOAD_ERROR });
      else setError(GENERIC_LOAD_ERROR);
    } finally {
      if (mountedRef.current && !quiet) setRefreshing(false);
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
      if (!mountedRef.current) return 'done';
      if (result.ok) {
        if (result.workspaceId !== scopeRef.current) return 'done';
        updateRows((current) => crmRowsOnSaved(current, result.row));
        const next = crmEditAfterSaved(editsRef.current[leadId], result.row);
        updateEdits((current) => (next ? { ...current, [leadId]: next } : withoutKey(current, leadId)));
        if (mode === 'explicit') setNotice(`Đã lưu hồ sơ của ${leadDisplayName(result.row)}.`);
        const pending = next !== null && !crmProfilesEqual(normalizeCrmProfile(next.draft), profileFromRow(result.row));
        return pending ? 'again' : 'done';
      }
      if (result.error === 'profile_conflict') {
        if (result.workspaceId !== scopeRef.current) return 'done';
        updateRows((current) => crmRowsOnSaved(current, result.row));
        updateEdits((current) => ({ ...current, [leadId]: crmEditOnConflict(current[leadId], result.row) }));
        setExpandedId((current) => current ?? leadId);
        return 'done';
      }
      if (result.reason === 'lead_not_found') {
        removeRow(leadId);
        setNotice('Khách này không còn trong danh sách.');
        return 'done';
      }
      if (result.error === 'forbidden') {
        // Either the chosen owner left the project or this account lost access; a refresh tells which.
        setRowError(leadId, CRM_SAVE_FORBIDDEN_MESSAGE);
        void load(true);
        return 'done';
      }
      const view = crmFailureView(result);
      if (view.dropRows) dropAll(view.message);
      else setRowError(leadId, view.message);
      return 'done';
    } catch {
      if (mountedRef.current) setRowError(leadId, GENERIC_SAVE_ERROR);
      return 'done';
    } finally {
      if (mountedRef.current) markSaving(leadId, false);
    }
  };

  // The queue calls the latest save, so it always reads the current rows, edits and workspace.
  useEffect(() => {
    runSaveRef.current = runSave;
  });

  useEffect(() => {
    mountedRef.current = true;
    const queue = new CrmSaveQueue((leadId, mode) => runSaveRef.current(leadId, mode));
    queueRef.current = queue;
    return () => {
      mountedRef.current = false;
      // Leaving MyGraph: send what is still waiting rather than lose it, then stop.
      queue.flushAll();
      queue.dispose();
      if (queueRef.current === queue) queueRef.current = null;
    };
  }, []);

  const visible = active && documentVisible;
  // Rows load when the CRM comes on screen, then refresh every 60 s while it stays there.
  useEffect(() => {
    if (!visible) return undefined;
    void load(scopeRef.current !== null);
    const timer = setInterval(() => { void load(true); }, CRM_REFRESH_MS);
    return () => clearInterval(timer);
  }, [visible, load]);

  const change = (row: CustomerCareCrmRow, profile: CustomerCareCrmProfileInput) => {
    updateEdits((current) => ({ ...current, [row.leadId]: crmEditOnChange(current[row.leadId], profile) }));
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

  return (
    <section className="v2-crm" aria-labelledby="v2-crm-title">
      <header className="v2-crm__header">
        <div>
          <h2 id="v2-crm-title" className="v2-crm__title">Khách để lại số</h2>
          <p className="v2-crm__lead">Hồ sơ do nhân viên ghi tay. Chỉ hiện ở đây, không đưa vào Memory và không lưu trên máy.</p>
        </div>
        {phase.state === 'ready' && (
          <button type="button" className="v2-button v2-button--ghost" disabled={refreshing} onClick={() => { void load(false); }}>
            {refreshing ? 'Đang tải…' : 'Tải lại'}
          </button>
        )}
      </header>

      {phase.state === 'loading' && <p className="v2-crm__hint" role="status">Đang tải CRM…</p>}

      {phase.state === 'blocked' && (
        <div className="v2-empty">
          <p role="alert">{phase.message}</p>
          {phase.message !== CRM_FORBIDDEN_MESSAGE && phase.message !== NO_APP_MESSAGE && (
            <button type="button" className="v2-button" disabled={refreshing} onClick={() => { void load(false); }}>Thử lại</button>
          )}
        </div>
      )}

      {phase.state === 'ready' && (
        <>
          {error && <p className="v2-crm__error" role="alert">{error}</p>}
          {notice && <p className="v2-crm__notice" role="status">{notice}</p>}

          <div className="v2-crm__toolbar">
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
