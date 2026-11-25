import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CustomerCareCrmAssignee,
  CustomerCareCrmIdentityActionInput,
  CustomerCareCrmIdentityActionResult,
  CustomerCareCrmIdentityRefreshInput,
  CustomerCareCrmIdentityRefreshResult,
  CustomerCareCrmListInput,
  CustomerCareCrmListResult,
  CustomerCareCrmPageSource,
  CustomerCareCrmProfileInput,
  CustomerCareCrmRow,
  CustomerCareCrmSaveInput,
  CustomerCareCrmSaveResult,
  CustomerCareCrmStage,
  CustomerCareLeadPurgeInput,
  CustomerCareLeadPurgeResult,
  CustomerCareSnapshot,
} from '../../shared/customer-care-types';
import { CRM_PERSONA_OPTIONS, type CrmMetaAudienceTarget } from '../../shared/customer-crm-enterprise';
import { usePanelVisible } from '../lib/panel-visibility';
import { careLeadsErrorMessage, leadDisplayName, purgeLeadConfirmText } from './customer-care-leads-flow';
import {
  CRM_CONFLICT_MESSAGE,
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
  crmFilterRows,
  crmPageOptions,
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
  CrmLoadSequence,
  loadCrmPages,
  normalizeCrmProfile,
  profileFromRow,
  resolveCrmPageLabel,
  snapshotPageFallback,
  type CrmFilter,
  type CrmPersonaFilter,
  type CrmProductOption,
  type CrmRowEdit,
} from './customer-crm-flow';
import { crmDraftProfiles, crmFreshAdsExport } from './customer-crm-ads-export';
import { crmOpenProfile, type CrmDisplay } from './customer-crm-graph';
import { crmIdentityActionView, crmIdentityRefreshView, crmRowsWithIdentity, type CrmIdentityOutcomeView } from './customer-crm-identity';
import type { CrmIdentityHandlers } from './CustomerCrmIdentity';
import { CrmSaveQueue } from './customer-crm-save-queue';
import { CustomerCrmDrawer, type CrmDrawerTab } from './CustomerCrmDrawer';
import { CustomerCrmGraphSlot } from './CustomerCrmGraphSlot';
import {
  CrmAdsWorkspace,
  CrmEnterpriseKpiStrip,
  CrmLifecycleWorkspace,
  CrmSalerWorkspace,
} from './CustomerCrmEnterpriseViews';
import { CustomerCrmRow } from './CustomerCrmRow';
import '../styles/v2/customer-crm.css';

const DISPLAYS: ReadonlyArray<{ id: CrmDisplay; label: string }> = [
  { id: 'table', label: 'Bảng' },
  { id: 'graph', label: 'Sơ đồ' },
  { id: 'saler', label: 'Saler' },
  { id: 'ads', label: 'Ads' },
  { id: 'lifecycle', label: 'Hậu mãi' },
];

/** "Bảng | Sơ đồ | Saler | Ads | Hậu mãi": unified Enterprise CRM mode switch. */
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
  /** Care CRM S3; absent on an older preload, which shows the identity without actions. */
  identityAction?: (input: CustomerCareCrmIdentityActionInput) => Promise<CustomerCareCrmIdentityActionResult>;
  refreshIdentity?: (input: CustomerCareCrmIdentityRefreshInput) => Promise<CustomerCareCrmIdentityRefreshResult>;
};

type Edits = Readonly<Record<string, CrmRowEdit>>;
type Phase = { state: 'loading' } | { state: 'blocked'; message: string } | { state: 'ready' };

interface CrmMeta {
  canDelete: boolean;
  assignees: CustomerCareCrmAssignee[];
  pageSources: CustomerCareCrmPageSource[];
  truncated: boolean;
  /** Care CRM S3: the AI profile is on for the workspace; null when the server sent no identity. */
  identityEnabled: boolean | null;
  /** Care CRM S3: the identity could not be loaded; the table is shown without it. */
  identityUnavailable: boolean;
  /** Care CRM S3: the exact consent question the server would send; null while asks are off. */
  consentAsk: string | null;
}

const GENERIC_LOAD_ERROR = 'Chưa tải được CRM. Thử lại sau ít phút.';
const GENERIC_SAVE_ERROR = 'Chưa lưu được. Thử lại sau ít phút.';
const REFRESH_RESTING_NOTE = 'Vừa tải xong. Có thể làm mới lại sau 15 giây.';
const NO_APP_MESSAGE = 'CRM chỉ chạy trong ứng dụng izzi.';
const NO_ASSIGNEES: CustomerCareCrmAssignee[] = [];
const NO_PAGE_SOURCES: CustomerCareCrmPageSource[] = [];
const INITIAL_FILTER: CrmFilter = {
  view: 'today',
  stage: 'any',
  pageId: 'any',
  persona: 'any',
  query: '',
};

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
 * MyGraph → CRM (Compact Enterprise CRM v3 + Care CRM S3 AI Identity):
 * Multi-Page lead attribution, 1-row KPI ribbon, unified command/filter bar, dense table + 420px slide-over drawer,
 * and 5 operational workspaces (Bảng, Sơ đồ, Saler, Ads, Hậu mãi). Rows, phones and notes live only in memory.
 */
export function CustomerCrmPanel() {
  const active = usePanelVisible();
  const documentVisible = useDocumentVisible();
  const [phase, setPhase] = useState<Phase>({ state: 'loading' });
  const [rows, setRows] = useState<CustomerCareCrmRow[]>([]);
  const [edits, setEdits] = useState<Edits>({});
  const [meta, setMeta] = useState<CrmMeta | null>(null);
  const [products, setProducts] = useState<CrmProductOption[]>([]);
  const [fallbackPage, setFallbackPage] = useState<CustomerCareCrmPageSource | null>(null);
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [filter, setFilter] = useState<CrmFilter>(INITIAL_FILTER);
  const [display, setDisplay] = useState<CrmDisplay>('table');
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<CrmDrawerTab>('profile');
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
  const displayRef = useRef<CrmDisplay>('table');
  const rowsRef = useRef<CustomerCareCrmRow[]>([]);
  const editsRef = useRef<Edits>({});
  /** The workspace the rows on screen belong to; null until the first answer. */
  const scopeRef = useRef<string | null>(null);
  /** Rows deleted here: a refresh that started before the delete must not bring them back. */
  const removedRef = useRef<Set<string>>(new Set());
  /** Which list read is current; an identity answer drops the reads in flight (Care CRM S3). */
  const sequenceRef = useRef(new CrmLoadSequence());
  /** When the last every-page load started, so reopening the tab does not reload every page again at once. */
  const lastFullLoadAtRef = useRef<number | null>(null);
  /** Refresh ticks to skip after a 429 or a 503, instead of adding load. */
  const skipTicksRef = useRef(0);
  const queueRef = useRef<CrmSaveQueue | null>(null);
  const loadRef = useRef<(mode: 'full' | 'page1', retryIdentity?: boolean) => Promise<void>>(async () => undefined);
  const restTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runSaveRef = useRef<(leadId: string, mode: 'auto' | 'explicit') => Promise<'done' | 'again'>>(
    async () => 'done',
  );

  const selectDisplay = useCallback((next: CrmDisplay) => {
    setDisplay(next);
  }, []);

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
    setFallbackPage(null);
    setDrawerId(null);
    setNotice('');
    setError('');
    setPhase({ state: 'blocked', message });
  }, [updateRows, updateEdits]);

  const removeRow = useCallback((leadId: string) => {
    queueRef.current?.cancel(leadId);
    removedRef.current.add(leadId);
    updateRows((current) => crmRowsOnRemove(current, leadId));
    updateEdits((current) => withoutKey(current, leadId));
    setDrawerId((current) => (current === leadId ? null : current));
  }, [updateRows, updateEdits]);

  const loadProducts = useCallback(async (api: CrmApi, workspaceId: string) => {
    try {
      const snapshot = await api.getSnapshot();
      if (!mountedRef.current || scopeRef.current !== workspaceId) return;
      // Facts and Page metadata saved for another workspace on this machine never leak here.
      if (snapshot.workspaceId === workspaceId) {
        setProducts(crmProductOptions(snapshot.setup?.facts, Date.now()));
        setFallbackPage(snapshotPageFallback(snapshot));
      } else {
        setProducts([]);
        setFallbackPage(null);
      }
    } catch {
      if (mountedRef.current) {
        setProducts([]);
        setFallbackPage(null);
      }
    }
  }, []);

  /**
   * `full` reads up to `CRM_MAX_PAGES` pages: when the tab opens, on "Làm mới", after a 409 and after a
   * workspace change. `page1` is the 60 s tick: it reads page 1 only and merges it by `leadId`. `retryIdentity`
   * ("Làm mới", "Thử lại"): main tries the identity read again even while it is paused after a failure.
   */
  const load = useCallback(async (requested: 'full' | 'page1', retryIdentity = false) => {
    const api = getCrmApi();
    if (!api) {
      setPhase({ state: 'blocked', message: NO_APP_MESSAGE });
      return;
    }
    // Nothing is loaded yet, so there is nothing for page 1 to merge into.
    const mode = scopeRef.current === null ? 'full' : requested;
    const seq = sequenceRef.current.start(mode);
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
      const result = await loadCrmPages((input) => api.listCrm(input), mode === 'full' ? CRM_MAX_PAGES : 1, {
        retryIdentity: retryIdentity && mode === 'full',
      });
      if (!mountedRef.current || !sequenceRef.current.isCurrent(seq)) return;
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
        setMeta(null);
        setProducts([]);
        setFallbackPage(null);
        setDrawerId(null);
        setFilter((current) => ({ ...current, pageId: 'any' }));
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
      setDrawerId((current) => (current !== null && present.has(current) ? current : null));
      setMeta((current) => ({
        canDelete: result.canDelete,
        assignees: result.assignees,
        pageSources: switched || mode === 'full'
          ? result.pageSources
          : (result.pageSources.length > 0 ? result.pageSources : (current?.pageSources ?? NO_PAGE_SOURCES)),
        // Only an every-page load knows whether more than 500 customers exist.
        truncated: mode === 'full' ? result.truncated : (current?.truncated ?? false),
        identityEnabled: result.identityEnabled,
        identityUnavailable: result.identityUnavailable,
        consentAsk: result.consentAsk?.text ?? null,
      }));
      setPhase({ state: 'ready' });
      setError('');
      if (switched) void loadProducts(api, result.workspaceId);
    } catch {
      if (!mountedRef.current || !sequenceRef.current.isCurrent(seq)) return;
      skipTicksRef.current = 1;
      if (scopeRef.current === null) setPhase({ state: 'blocked', message: GENERIC_LOAD_ERROR });
      else setError(GENERIC_LOAD_ERROR);
    } finally {
      // The spinner belongs to the latest full reload; one dropped and started again keeps it going.
      if (sequenceRef.current.finish(seq) && mountedRef.current) setRefreshing(false);
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
      if (displayRef.current !== 'table') setError(`${leadDisplayName(row)}: ${decision.message}`);
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
          setDrawerId((current) => current ?? leadId);
          setDrawerTab('profile');
          if (displayRef.current !== 'table') setError(`${leadDisplayName(merged)}: ${CRM_CONFLICT_MESSAGE}`);
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
      if (displayRef.current !== 'table') setError(`${leadDisplayName(row)}: ${view.message}`);
      if (reload && mountedRef.current) void loadRef.current(reload);
      return 'done';
    } catch {
      setRowError(leadId, GENERIC_SAVE_ERROR);
      if (displayRef.current !== 'table') setError(`${leadDisplayName(row)}: ${GENERIC_SAVE_ERROR}`);
      return 'done';
    } finally {
      markSaving(leadId, false);
    }
  };

  /**
   * An identity answer (Care CRM S3): the row takes the identity it returned (a 409 included), a customer who is
   * gone leaves, lost access drops every row, and a server problem rests the next tick. Requests are started by a
   * person only; nothing here polls.
   */
  const applyIdentityOutcome = useCallback((leadId: string, view: CrmIdentityOutcomeView) => {
    if (view.skipTick) skipTicksRef.current = 1;
    if (view.dropRows) {
      dropAll(view.message);
      return;
    }
    if (view.removeRow) {
      removeRow(leadId);
      setNotice(view.message);
      return;
    }
    const { identity } = view;
    if (identity && view.workspaceId === scopeRef.current) {
      // A list read still in flight may predate this answer: it is dropped, so it cannot put the older identity back.
      // A full reload ("Làm mới") caught that way is started again rather than lost.
      const rerunFull = sequenceRef.current.invalidate();
      updateRows((current) => crmRowsWithIdentity(current, leadId, identity));
      if (rerunFull && mountedRef.current) void loadRef.current('full');
    }
    // The customer's consent or the AI switch changed on the server: read page 1 again now, once.
    if (view.reloadList && mountedRef.current) void loadRef.current('page1');
  }, [dropAll, removeRow, updateRows]);

  const identityAct = useCallback(async (input: CustomerCareCrmIdentityActionInput): Promise<CrmIdentityOutcomeView> => {
    const api = getCrmApi();
    if (!api?.identityAction) return crmIdentityActionView(input.action, { ok: false, error: 'unsupported' });
    let view: CrmIdentityOutcomeView;
    try {
      view = crmIdentityActionView(input.action, await api.identityAction(input));
    } catch {
      view = crmIdentityActionView(input.action, { ok: false, error: 'unavailable' });
    }
    applyIdentityOutcome(input.leadId, view);
    return view;
  }, [applyIdentityOutcome]);

  /** "Cập nhật hồ sơ": main waits up to 45 s for the run, so the card shows its spinner that long at most. */
  const identityRefresh = useCallback(async (leadId: string): Promise<CrmIdentityOutcomeView> => {
    const api = getCrmApi();
    if (!api?.refreshIdentity) return crmIdentityRefreshView({ ok: false, error: 'unsupported' });
    let view: CrmIdentityOutcomeView;
    try {
      view = crmIdentityRefreshView(await api.refreshIdentity({ leadId }));
    } catch {
      view = crmIdentityRefreshView({ ok: false, error: 'unavailable' });
    }
    applyIdentityOutcome(leadId, view);
    return view;
  }, [applyIdentityOutcome]);

  const identityEnabled = meta?.identityEnabled ?? null;
  const consentAsk = meta?.consentAsk ?? null;
  const identityHandlers = useMemo<CrmIdentityHandlers | null>(() => {
    const api = getCrmApi();
    if (!api?.identityAction || !api.refreshIdentity) return null;
    return { enabled: identityEnabled, consentAsk, act: identityAct, refresh: identityRefresh };
  }, [identityEnabled, consentAsk, identityAct, identityRefresh]);
  // The Ads export and its counts fail closed on this (Care CRM S3): no export while the AI profile is off or unread.
  const identityUnavailable = meta?.identityUnavailable ?? false;
  const adsIdentityState = useMemo(
    () => ({ identityEnabled, identityUnavailable }),
    [identityEnabled, identityUnavailable],
  );
  // Unsaved drafts can only withhold a customer from the Ads preview and export (an unsaved "Không liên hệ").
  const adsDrafts = useMemo(() => crmDraftProfiles(edits), [edits]);
  // "Xuất CSV" never uses the rows on screen: pages 2–10 keep the identities of the last full load.
  const exportAds = useCallback(async (target: CrmMetaAudienceTarget) => {
    const api = getCrmApi();
    if (!api) return { ok: false as const, message: NO_APP_MESSAGE };
    return crmFreshAdsExport((input) => api.listCrm(input), target, {
      workspaceId: () => scopeRef.current,
      drafts: () => crmDraftProfiles(editsRef.current),
    });
  }, []);

  // The queue calls the latest save, so it always reads the current rows, edits and workspace.
  useEffect(() => {
    displayRef.current = display;
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
    (
      document.getElementById(`crm-drawer-stage-${revealId}`)
      ?? document.getElementById(`crm-stage-${revealId}`)
    )?.focus({ preventScroll: true });
    setRevealId(null);
  }, [display, revealId]);

  /** The card's "Mở hồ sơ": back to the table with that customer's slide-over drawer open. */
  const openProfile = (leadId: string) => {
    const next = crmOpenProfile(leadId);
    selectDisplay(next.display);
    setDrawerId(next.expandedId);
    setDrawerTab('profile');
    setRevealId(next.revealId);
  };

  const toggleDrawer = (leadId: string) => {
    setDrawerId((current) => (current === leadId ? null : leadId));
  };

  const change = (row: CustomerCareCrmRow, profile: CustomerCareCrmProfileInput) => {
    // Always resolve against the canonical saved row so baseUpdatedAt and save comparison stay exact.
    const baseRow = rowsRef.current.find((item) => item.leadId === row.leadId) ?? row;
    if (crmRowReadOnly(baseRow)) return;
    updateEdits((current) => ({ ...current, [baseRow.leadId]: crmEditOnChange(current[baseRow.leadId], profile, baseRow) }));
    setNotice('');
    queueRef.current?.changed(baseRow.leadId);
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

  const copyText = async (text: string, successNotice: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setError('');
      setNotice(successNotice);
    } catch {
      setError('Không sao chép được. Bạn vẫn có thể chọn và sao chép nội dung thủ công.');
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
  const pageSources = meta?.pageSources ?? NO_PAGE_SOURCES;
  const pageOptions = useMemo(
    () => crmPageOptions(rows, pageSources, fallbackPage),
    [rows, pageSources, fallbackPage],
  );
  const pageLabelOf = useCallback(
    (pageId: string) => resolveCrmPageLabel(pageId, pageSources, fallbackPage),
    [pageSources, fallbackPage],
  );

  const shown = crmVisibleRows(rows, filter, now, drawerId);
  const todayCount = crmCallTodayCount(rows, now);

  /**
   * Live rows with unsaved drafts overlaid, so Graph hubs and workspaces react immediately. The identity stays the
   * server's (Care CRM S3): the identity card shows it and its staff actions are sent against its version, so a
   * locally composed identity must never replace it.
   */
  const liveRows = useMemo(
    () => rows.map((row) => {
      const draft = edits[row.leadId]?.draft;
      return draft && !crmRowReadOnly(row)
        ? { ...row, profile: { ...row.profile, ...draft, productFactIds: [...draft.productFactIds] } }
        : row;
    }),
    [rows, edits],
  );

  const stageFilteredLiveRows = useMemo(
    () => crmFilterRows(liveRows, filter),
    [liveRows, filter],
  );

  const lifecycleLiveRows = useMemo(
    () => crmFilterRows(liveRows, filter, { ignoreStage: true }),
    [liveRows, filter],
  );

  const troubledRow = useMemo(
    () => rows.find((item) => Boolean(edits[item.leadId]?.rejected || edits[item.leadId]?.error)) ?? null,
    [rows, edits],
  );
  const troubledEdit = troubledRow ? edits[troubledRow.leadId] ?? null : null;

  const drawerRow = useMemo(
    () => (drawerId === null ? null : rows.find((item) => item.leadId === drawerId) ?? null),
    [rows, drawerId],
  );
  const drawerIndex = drawerRow ? shown.findIndex((item) => item.leadId === drawerRow.leadId) : -1;
  const hasPrev = drawerIndex > 0;
  const hasNext = drawerIndex >= 0 && drawerIndex < shown.length - 1;

  const hasActiveFilters = (filter.pageId ?? 'any') !== 'any'
    || filter.stage !== 'any'
    || (filter.persona ?? 'any') !== 'any'
    || (filter.query?.trim() ?? '') !== '';

  return (
    <section className="v2-crm" aria-labelledby="v2-crm-title">
      <header className="v2-crm__header">
        <div className="v2-crm__heading">
          <h2 id="v2-crm-title" className="v2-crm__title">Khách để lại số</h2>
          <p className="v2-crm__lead">
            CRM đa Page &amp; Nhận diện (AI) khi khách đồng ý — Saler, Ads SHA-256, Hậu mãi &amp; MyGraph.
          </p>
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
              onClick={() => { void load('full', true); }}
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
              onClick={() => { void load('full', true); }}
            >
              Thử lại
            </button>
          )}
        </div>
      )}

      {phase.state === 'ready' && (
        <>
          {error && <p className="v2-crm__error" role="alert">{error}</p>}
          {display !== 'table' && troubledRow && troubledEdit && (
            <div className="v2-crm__conflict" role="alert">
              <p>
                <strong>{`${leadDisplayName(troubledRow)}: ${troubledEdit.error || CRM_CONFLICT_MESSAGE}`}</strong>{' '}
                {troubledEdit.rejected
                  ? 'Có người vừa cập nhật hồ sơ khách này trên máy chủ.'
                  : 'Hồ sơ khách này chưa lưu được.'}
              </p>
              <div className="v2-crm__buttons">
                <button type="button" className="v2-button" onClick={() => openProfile(troubledRow.leadId)}>
                  Mở hồ sơ xử lý trong Bảng
                </button>
              </div>
            </div>
          )}
          {notice && <p className="v2-crm__notice" role="status">{notice}</p>}
          {meta?.identityUnavailable && <p className="v2-crm__hint" role="status">AI hồ sơ khách tạm không tải được.</p>}

          {rows.length > 0 && (
            <CrmEnterpriseKpiStrip
              rows={liveRows}
              savedRows={rows}
              products={products}
              nowMs={now}
              pageCount={pageOptions.length}
              identityState={adsIdentityState}
              display={display}
              onSelectDisplay={selectDisplay}
            />
          )}

          <div className="v2-crm__toolbar" role="search" aria-label="Thanh điều hướng và bộ lọc CRM">
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
                    {`Hôm nay (${todayCount})`}
                  </button>
                  <button
                    type="button"
                    className={`v2-tab${filter.view === 'all' ? ' is-active' : ''}`}
                    aria-pressed={filter.view === 'all'}
                    onClick={() => setFilter((current) => ({ ...current, view: 'all' }))}
                  >
                    {`Tất cả (${rows.length})`}
                  </button>
                </div>
              )}
            </div>

            {display !== 'ads' && (
              <div className="v2-crm__controls">
                {(display === 'table' || display === 'saler' || display === 'lifecycle') && (
                  <label className="v2-crm__inline-filter v2-crm__inline-filter--search" htmlFor="v2-crm-search">
                    <span className="v2-visually-hidden">Tìm khách theo tên, SĐT hoặc ghi chú</span>
                    <input
                      id="v2-crm-search"
                      type="search"
                      className="v2-field__input"
                      placeholder="Tìm tên, SĐT, ghi chú…"
                      value={filter.query ?? ''}
                      onChange={(event) => {
                        const query = event.currentTarget.value;
                        setFilter((current) => ({ ...current, query }));
                      }}
                    />
                  </label>
                )}

                {pageOptions.length > 0 && (
                  <label className="v2-crm__inline-filter" htmlFor="v2-crm-page-filter">
                    <span className="v2-visually-hidden">Nguồn Page</span>
                    <select
                      id="v2-crm-page-filter"
                      className="v2-field__select"
                      value={filter.pageId ?? 'any'}
                      onChange={(event) => {
                        const pageId = event.currentTarget.value;
                        setFilter((current) => ({ ...current, pageId }));
                      }}
                    >
                      <option value="any">{`Tất cả Page (${pageOptions.length})`}</option>
                      {pageOptions.map((opt) => (
                        <option key={opt.pageId} value={opt.pageId}>
                          {`${opt.label} (${opt.count})`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {(display === 'table' || display === 'graph' || display === 'saler') && (
                  <label className="v2-crm__inline-filter" htmlFor="v2-crm-stage-filter">
                    <span className="v2-visually-hidden">Giai đoạn</span>
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
                      {CRM_STAGE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                )}

                {(display === 'table' || display === 'saler' || display === 'lifecycle') && (
                  <label className="v2-crm__inline-filter" htmlFor="v2-crm-persona-filter">
                    <span className="v2-visually-hidden">Chân dung P1 đến P4</span>
                    <select
                      id="v2-crm-persona-filter"
                      className="v2-field__select"
                      value={filter.persona ?? 'any'}
                      onChange={(event) => {
                        const persona = event.currentTarget.value as CrmPersonaFilter;
                        setFilter((current) => ({ ...current, persona }));
                      }}
                    >
                      <option value="any">Mọi chân dung P1–P4</option>
                      {CRM_PERSONA_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{`${opt.value} · ${opt.shortLabel}`}</option>
                      ))}
                      <option value="unclassified">Chưa phân nhóm</option>
                    </select>
                  </label>
                )}

                {hasActiveFilters && (
                  <button
                    type="button"
                    className="v2-button v2-button--ghost"
                    onClick={() => setFilter((current) => ({
                      ...current,
                      stage: 'any',
                      pageId: 'any',
                      persona: 'any',
                      query: '',
                    }))}
                  >
                    Xoá lọc
                  </button>
                )}
              </div>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="v2-empty">
              <p>Chưa có khách nào để lại số. Khi khách gửi số điện thoại qua tin nhắn Page, khách sẽ hiện ở đây.</p>
            </div>
          ) : display === 'graph' ? (
            stageFilteredLiveRows.length === 0 ? (
              <div className="v2-empty">
                <p>Không có khách nào khớp bộ lọc.</p>
              </div>
            ) : (
              <CustomerCrmGraphSlot
                rows={stageFilteredLiveRows}
                products={products}
                assignees={meta?.assignees ?? NO_ASSIGNEES}
                nowMs={now}
                onCopy={(row) => { void copyPhone(row); }}
                onOpenProfile={openProfile}
                identityHandlers={identityHandlers}
                canDelete={canPurge}
                onPurge={(row) => { void purge(row); }}
              />
            )
          ) : display === 'saler' ? (
            stageFilteredLiveRows.length === 0 ? (
              <div className="v2-empty">
                <p>Không có khách nào khớp bộ lọc.</p>
              </div>
            ) : (
              <CrmSalerWorkspace
                rows={stageFilteredLiveRows}
                products={products}
                assignees={meta?.assignees ?? NO_ASSIGNEES}
                savingIds={savingIds}
                edits={edits}
                nowMs={now}
                identityEnabled={identityEnabled}
                resolvePageLabel={pageLabelOf}
                onChangeProfile={change}
                onCopyText={(text, msg) => { void copyText(text, msg); }}
                onOpenProfile={openProfile}
              />
            )
          ) : display === 'ads' ? (
            <CrmAdsWorkspace
              rows={rows}
              identityState={adsIdentityState}
              drafts={adsDrafts}
              onExport={exportAds}
              onNotify={(kind, msg) => {
                if (kind === 'error') {
                  setNotice('');
                  setError(msg);
                } else {
                  setError('');
                  setNotice(msg);
                }
              }}
            />
          ) : display === 'lifecycle' ? (
            <CrmLifecycleWorkspace
              rows={lifecycleLiveRows}
              products={products}
              nowMs={now}
              identityEnabled={identityEnabled}
              resolvePageLabel={pageLabelOf}
              onChangeProfile={change}
              onCopyText={(text, msg) => { void copyText(text, msg); }}
              onOpenProfile={openProfile}
            />
          ) : shown.length === 0 ? (
            <div className="v2-empty">
              <p>{filter.view === 'today' && !hasActiveFilters ? 'Hôm nay chưa có khách cần gọi.' : 'Không có khách nào khớp bộ lọc.'}</p>
            </div>
          ) : (
            <div className={`v2-crm__master-detail${drawerRow ? ' has-drawer' : ''}`}>
              <div className="v2-crm__table-wrap">
                <table className="v2-crm__table">
                  <caption className="v2-visually-hidden">
                    Khách để lại số: quá hạn trước, rồi đến hạn hôm nay, rồi theo giai đoạn.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Khách &amp; Page</th>
                      <th scope="col">Phân khúc</th>
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
                          expanded={false}
                          selected={drawerId === row.leadId}
                          pageLabel={pageLabelOf(row.pageId)}
                          showSegmentColumn
                          nowMs={now}
                          assignees={meta?.assignees ?? []}
                          products={products}
                          canDelete={canPurge}
                          purging={purgingId === row.leadId}
                          onChange={(profile) => change(row, profile)}
                          onToggle={() => toggleDrawer(row.leadId)}
                          onSave={() => queueRef.current?.saveNow(row.leadId)}
                          onCopy={() => { void copyPhone(row); }}
                          onPurge={() => { void purge(row); }}
                          onReapply={() => reapply(row)}
                          onDiscard={() => discard(row)}
                          identityHandlers={identityHandlers}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {drawerRow && (
                <CustomerCrmDrawer
                  row={drawerRow}
                  profile={edits[drawerRow.leadId]?.draft ?? profileFromRow(drawerRow)}
                  edit={edits[drawerRow.leadId] ?? null}
                  saving={savingIds.has(drawerRow.leadId)}
                  nowMs={now}
                  pageLabel={pageLabelOf(drawerRow.pageId)}
                  assignees={meta?.assignees ?? NO_ASSIGNEES}
                  products={products}
                  canDelete={canPurge}
                  purging={purgingId === drawerRow.leadId}
                  identityHandlers={identityHandlers}
                  tab={drawerTab}
                  onTabChange={setDrawerTab}
                  positionLabel={drawerIndex >= 0 ? `${drawerIndex + 1}/${shown.length}` : undefined}
                  hasPrev={hasPrev}
                  hasNext={hasNext}
                  onPrev={() => {
                    if (hasPrev) setDrawerId(shown[drawerIndex - 1]!.leadId);
                  }}
                  onNext={() => {
                    if (hasNext) setDrawerId(shown[drawerIndex + 1]!.leadId);
                  }}
                  onClose={() => setDrawerId(null)}
                  onChange={(profile) => change(drawerRow, profile)}
                  onSave={() => queueRef.current?.saveNow(drawerRow.leadId)}
                  onCopy={() => { void copyPhone(drawerRow); }}
                  onPurge={() => { void purge(drawerRow); }}
                  onReapply={() => reapply(drawerRow)}
                  onDiscard={() => discard(drawerRow)}
                />
              )}
            </div>
          )}

          {meta?.truncated && <p className="v2-crm__hint">Đang hiện 500 khách mới nhất.</p>}
        </>
      )}
    </section>
  );
}
