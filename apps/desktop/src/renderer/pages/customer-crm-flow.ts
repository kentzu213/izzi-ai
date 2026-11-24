/**
 * Pure decisions for MyGraph → CRM (Care CRM S2). `CustomerCrmPanel` keeps the React state and IPC calls;
 * the call list, sort order, field rules, save decisions, conflict handling, paging and error text live here
 * so they test without a DOM. Rows are only ever held in component memory; nothing here stores or logs them.
 */
import type {
  CustomerCareCrmAddressForm,
  CustomerCareCrmAssignee,
  CustomerCareCrmListInput,
  CustomerCareCrmListResult,
  CustomerCareCrmLostReason,
  CustomerCareCrmOccasion,
  CustomerCareCrmProfileInput,
  CustomerCareCrmRole,
  CustomerCareCrmRow,
  CustomerCareCrmSaveInput,
  CustomerCareCrmSaveResult,
  CustomerCareCrmStage,
  CustomerCareFacebookFailure,
  CustomerCareFact,
} from '../../shared/customer-care-types';

/** The CRM tab asks for fresh rows this often while it is on screen. */
export const CRM_REFRESH_MS = 60_000;
/** 10 pages of 50: the newest 500 customers. */
export const CRM_MAX_PAGES = 10;
/** The server allows 30 requests a minute per user, so a save waits for a pause in typing. */
export const CRM_SAVE_DEBOUNCE_MS = 1_500;
export const CRM_MAX_PRODUCTS = 8;
export const CRM_MAX_NEXT_STEP = 200;
export const CRM_MAX_NOTE = 1_000;
const PRODUCT_LABEL_MAX = 80;
const PRODUCT_TOPICS: readonly CustomerCareFact['topic'][] = ['catalog', 'price'];
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;

export const CRM_FORBIDDEN_MESSAGE = 'Bạn không có quyền xem CRM của dự án này.';
export const CRM_CONFLICT_MESSAGE = 'Có người vừa cập nhật khách này.';
const DATE_RANGE_MESSAGE = 'Ngày phải nằm trong khoảng 2 năm trước và 2 năm tới.';

export const CRM_STAGE_OPTIONS: ReadonlyArray<{ value: CustomerCareCrmStage; label: string }> = [
  { value: 'has_phone', label: 'Có số' },
  { value: 'consulting', label: 'Đang tư vấn' },
  { value: 'deposit', label: 'Đã cọc' },
  { value: 'delivered', label: 'Đã giao' },
  { value: 'lost', label: 'Không mua' },
  { value: 'do_not_contact', label: 'Không liên hệ' },
];

export const CRM_ADDRESS_FORM_OPTIONS: ReadonlyArray<{ value: CustomerCareCrmAddressForm; label: string }> = [
  { value: 'anh', label: 'Anh' },
  { value: 'chi', label: 'Chị' },
  { value: 'co', label: 'Cô' },
  { value: 'chu', label: 'Chú' },
  { value: 'ban', label: 'Bạn' },
];

export const CRM_OCCASION_OPTIONS: ReadonlyArray<{ value: CustomerCareCrmOccasion; label: string }> = [
  { value: 'new_home', label: 'Nhà mới' },
  { value: 'tet', label: 'Tết' },
  { value: 'anniversary', label: 'Giỗ, kỷ niệm' },
  { value: 'gift', label: 'Làm quà' },
  { value: 'replacement', label: 'Thay đồ cũ' },
  { value: 'other', label: 'Khác' },
];

export const CRM_LOST_REASON_OPTIONS: ReadonlyArray<{ value: CustomerCareCrmLostReason; label: string }> = [
  { value: 'price', label: 'Giá cao' },
  { value: 'bought_elsewhere', label: 'Mua nơi khác' },
  { value: 'no_reply', label: 'Không trả lời' },
  { value: 'not_needed', label: 'Không cần nữa' },
  { value: 'other', label: 'Khác' },
];

const STAGE_PRIORITY: Record<CustomerCareCrmStage, number> = {
  has_phone: 0,
  consulting: 1,
  deposit: 2,
  delivered: 3,
  lost: 4,
  do_not_contact: 4,
};

function optionLabel<T extends string>(options: ReadonlyArray<{ value: T; label: string }>, value: T | null): string {
  return options.find((option) => option.value === value)?.label ?? '';
}

export function crmStageLabel(stage: CustomerCareCrmStage): string {
  return optionLabel(CRM_STAGE_OPTIONS, stage);
}

export function crmAssigneeLabel(assignees: readonly CustomerCareCrmAssignee[], userId: string | null): string {
  if (userId === null) return 'Chưa giao';
  const assignee = assignees.find((item) => item.userId === userId);
  if (!assignee) return 'Người đã rời dự án';
  return assignee.label ?? 'Thành viên chưa có tên';
}

// ---------------------------------------------------------------------------
// Dates and times (local calendar, the way staff read them)
// ---------------------------------------------------------------------------

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Local `YYYY-MM-DD` of an instant. */
export function localDateKey(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftLocalYears(ms: number, years: number, days = 0): number {
  const date = new Date(ms);
  date.setFullYear(date.getFullYear() + years);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

/** Bounds for the date pickers, one day inside the server's ±2 years so an edge day never fails there. */
export function crmDateBounds(nowMs: number): { min: string; max: string } {
  return { min: localDateKey(shiftLocalYears(nowMs, -2, 1)), max: localDateKey(shiftLocalYears(nowMs, 2, -1)) };
}

/** An ISO instant as the value of a local `datetime-local` input. */
export function isoToLocalInput(iso: string | null): string {
  if (iso === null) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  return `${localDateKey(ms)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function localInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** "09:30 25/11" for a due time. */
export function formatCrmDue(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())} ${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}

/** "20/12/2026" for a `YYYY-MM-DD` day. */
export function formatCrmDay(day: string | null): string {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const [year, month, date] = day.split('-');
  return `${date}/${month}/${year}`;
}

// ---------------------------------------------------------------------------
// Call list
// ---------------------------------------------------------------------------

export type CrmDue = 'overdue' | 'today' | 'later' | 'none';
export type CrmView = 'today' | 'all';
export interface CrmFilter {
  view: CrmView;
  stage: CustomerCareCrmStage | 'any';
}

type DueFields = Pick<CustomerCareCrmProfileInput, 'stage' | 'nextStep' | 'nextStepDueAt'>;

/** A customer who asked not to be contacted is never due, whatever date is left on the row. */
export function crmDue(profile: DueFields, nowMs: number): CrmDue {
  if (profile.stage === 'do_not_contact' || profile.nextStepDueAt === null) return 'none';
  const due = Date.parse(profile.nextStepDueAt);
  if (!Number.isFinite(due)) return 'none';
  if (due < nowMs) return 'overdue';
  return localDateKey(due) === localDateKey(nowMs) ? 'today' : 'later';
}

/** "Cần gọi hôm nay": a next step due today or overdue, or a new number with no next step yet. */
export function isCallToday(profile: DueFields, nowMs: number): boolean {
  const due = crmDue(profile, nowMs);
  if (due === 'overdue' || due === 'today') return true;
  return profile.stage === 'has_phone' && profile.nextStep === null && profile.nextStepDueAt === null;
}

function dueRank(due: CrmDue): number {
  return due === 'overdue' ? 0 : due === 'today' ? 1 : 2;
}

/** Overdue first, then due today, then stage (has_phone … delivered, lost/do_not_contact last), then newest phone. */
export function sortCrmRows(rows: readonly CustomerCareCrmRow[], nowMs: number): CustomerCareCrmRow[] {
  return [...rows].sort((a, b) => (
    dueRank(crmDue(a.profile, nowMs)) - dueRank(crmDue(b.profile, nowMs))
    || STAGE_PRIORITY[a.profile.stage] - STAGE_PRIORITY[b.profile.stage]
    || Date.parse(b.phoneCapturedAt) - Date.parse(a.phoneCapturedAt)
  ));
}

/**
 * The rows on screen, sorted. Filters read the saved values, so a row does not jump while it is typed in;
 * `pinnedId` (the row open for editing) stays on screen even after a save moves it out of the view.
 */
export function crmVisibleRows(
  rows: readonly CustomerCareCrmRow[],
  filter: CrmFilter,
  nowMs: number,
  pinnedId: string | null = null,
): CustomerCareCrmRow[] {
  return sortCrmRows(rows.filter((row) => row.leadId === pinnedId || (
    (filter.view === 'all' || isCallToday(row.profile, nowMs))
    && (filter.stage === 'any' || row.profile.stage === filter.stage)
  )), nowMs);
}

export function crmCallTodayCount(rows: readonly CustomerCareCrmRow[], nowMs: number): number {
  return rows.filter((row) => isCallToday(row.profile, nowMs)).length;
}

// ---------------------------------------------------------------------------
// Fields and profiles
// ---------------------------------------------------------------------------

export function crmFieldVisibility(stage: CustomerCareCrmStage): { lostReason: boolean; purchasedAt: boolean } {
  return { lostReason: stage === 'lost', purchasedAt: stage === 'deposit' || stage === 'delivered' };
}

export function profileFromRow(row: CustomerCareCrmRow): CustomerCareCrmProfileInput {
  const { updatedAt: _updatedAt, updatedBy: _updatedBy, detailsUnreadable: _unreadable, ...profile } = row.profile;
  return { ...profile, productFactIds: [...profile.productFactIds] };
}

/**
 * The server could not open this profile's sealed details. The row shows its plain fields only and is
 * never saved: a full replace would wipe details nobody can see, and the server answers 503 anyway.
 */
export function crmRowReadOnly(row: CustomerCareCrmRow): boolean {
  return row.profile.detailsUnreadable === true;
}

// Control characters (and bidi overrides) become spaces; the server rejects them.
const LINE_UNSAFE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;
const NOTE_UNSAFE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

function cleanText(value: string | null, unsafe: RegExp): string | null {
  if (value === null) return null;
  const cleaned = value.replace(/\r\n?/g, '\n').replace(unsafe, ' ').trim();
  return cleaned === '' ? null : cleaned;
}

/** What a save sends: hidden-by-stage fields cleared, text trimmed (empty → null), products de-duplicated. */
export function normalizeCrmProfile(draft: CustomerCareCrmProfileInput): CustomerCareCrmProfileInput {
  const visible = crmFieldVisibility(draft.stage);
  return {
    ...draft,
    productFactIds: [...new Set(draft.productFactIds)],
    nextStep: cleanText(draft.nextStep, LINE_UNSAFE),
    note: cleanText(draft.note, NOTE_UNSAFE),
    lostReason: visible.lostReason ? draft.lostReason : null,
    purchasedAt: visible.purchasedAt ? draft.purchasedAt : null,
  };
}

/** A message for the first rule the profile breaks, or null. Mirrors the server so no request is wasted. */
export function validateCrmProfile(profile: CustomerCareCrmProfileInput, nowMs: number): string | null {
  const bounds = crmDateBounds(nowMs);
  for (const day of [profile.neededBy, profile.purchasedAt]) {
    if (day !== null && (day < bounds.min || day > bounds.max)) return DATE_RANGE_MESSAGE;
  }
  if (profile.nextStepDueAt !== null) {
    const due = Date.parse(profile.nextStepDueAt);
    if (!Number.isFinite(due) || due < shiftLocalYears(nowMs, -2, 1) || due > shiftLocalYears(nowMs, 2, -1)) {
      return DATE_RANGE_MESSAGE;
    }
  }
  // Counted in characters like the server: an emoji is one.
  if (profile.nextStep !== null && Array.from(profile.nextStep).length > CRM_MAX_NEXT_STEP) {
    return `Việc tiếp theo tối đa ${CRM_MAX_NEXT_STEP} ký tự.`;
  }
  if (profile.note !== null && Array.from(profile.note).length > CRM_MAX_NOTE) {
    return `Ghi chú tối đa ${CRM_MAX_NOTE} ký tự.`;
  }
  if (profile.productFactIds.length > CRM_MAX_PRODUCTS) return `Chọn tối đa ${CRM_MAX_PRODUCTS} sản phẩm.`;
  return null;
}

export function crmProfilesEqual(a: CustomerCareCrmProfileInput, b: CustomerCareCrmProfileInput): boolean {
  return a.stage === b.stage && a.ownerUserId === b.ownerUserId && a.addressForm === b.addressForm
    && a.occasion === b.occasion && a.neededBy === b.neededBy && a.nextStep === b.nextStep
    && a.nextStepDueAt === b.nextStepDueAt && a.lostReason === b.lostReason && a.purchasedAt === b.purchasedAt
    && a.note === b.note && a.productFactIds.length === b.productFactIds.length
    && a.productFactIds.every((id, index) => id === b.productFactIds[index]);
}

export interface CrmProductOption {
  id: string;
  label: string;
}

/** The shop's active product and price facts on this machine; their text is only a picker label. */
export function crmProductOptions(facts: readonly CustomerCareFact[] | undefined, nowMs: number): CrmProductOption[] {
  if (!facts) return [];
  return facts
    .filter((fact) => PRODUCT_TOPICS.includes(fact.topic) && PRODUCT_ID_PATTERN.test(fact.id))
    .filter((fact) => Date.parse(fact.approvedAt) <= nowMs
      && (fact.expiresAt === undefined || Date.parse(fact.expiresAt) > nowMs))
    .map((fact) => ({
      id: fact.id,
      label: fact.text.length > PRODUCT_LABEL_MAX ? `${fact.text.slice(0, PRODUCT_LABEL_MAX - 1)}…` : fact.text,
    }));
}

/** The unsaved values that differ from the server, as "label: value" lines for the conflict box. */
export function crmChangedFields(
  mine: CustomerCareCrmProfileInput,
  server: CustomerCareCrmProfileInput,
  assignees: readonly CustomerCareCrmAssignee[],
  products: readonly CrmProductOption[],
): Array<{ label: string; value: string }> {
  const productText = (ids: readonly string[]) => ids
    .map((id) => products.find((product) => product.id === id)?.label ?? 'Sản phẩm khác').join(', ');
  // A field the user's own stage hides is never sent, so it is not a difference worth showing.
  const visible = crmFieldVisibility(mine.stage);
  const fields: Array<{ label: string; same: boolean; value: string }> = [
    { label: 'Giai đoạn', same: mine.stage === server.stage, value: crmStageLabel(mine.stage) },
    { label: 'Người phụ trách', same: mine.ownerUserId === server.ownerUserId, value: crmAssigneeLabel(assignees, mine.ownerUserId) },
    { label: 'Xưng hô', same: mine.addressForm === server.addressForm, value: optionLabel(CRM_ADDRESS_FORM_OPTIONS, mine.addressForm) },
    { label: 'Dịp mua', same: mine.occasion === server.occasion, value: optionLabel(CRM_OCCASION_OPTIONS, mine.occasion) },
    { label: 'Cần trước ngày', same: mine.neededBy === server.neededBy, value: formatCrmDay(mine.neededBy) },
    {
      label: 'Sản phẩm quan tâm',
      same: mine.productFactIds.join('\n') === server.productFactIds.join('\n'),
      value: productText(mine.productFactIds),
    },
    { label: 'Việc tiếp theo', same: mine.nextStep === server.nextStep, value: mine.nextStep ?? '' },
    { label: 'Hạn', same: mine.nextStepDueAt === server.nextStepDueAt, value: mine.nextStepDueAt ? formatCrmDue(mine.nextStepDueAt) : '' },
    {
      label: 'Lý do không mua',
      same: !visible.lostReason || mine.lostReason === server.lostReason,
      value: optionLabel(CRM_LOST_REASON_OPTIONS, mine.lostReason),
    },
    {
      label: 'Ngày mua',
      same: !visible.purchasedAt || mine.purchasedAt === server.purchasedAt,
      value: formatCrmDay(mine.purchasedAt),
    },
    { label: 'Ghi chú', same: mine.note === server.note, value: mine.note ?? '' },
  ];
  return fields.filter((field) => !field.same).map(({ label, value }) => ({ label, value: value || '(trống)' }));
}

// ---------------------------------------------------------------------------
// Row edits: the draft on screen, the values a conflict rejected, and the row's message
// ---------------------------------------------------------------------------

export interface CrmRowEdit {
  draft: CustomerCareCrmProfileInput;
  /** The user's unsaved values after a conflict, kept visible until re-applied or dropped. */
  rejected: CustomerCareCrmProfileInput | null;
  error: string;
}

export type CrmSaveDecision =
  | { kind: 'skip' }
  | { kind: 'invalid'; message: string }
  | { kind: 'save'; input: CustomerCareCrmSaveInput };

export function crmEditOnChange(edit: CrmRowEdit | undefined, draft: CustomerCareCrmProfileInput): CrmRowEdit {
  return { draft, rejected: edit?.rejected ?? null, error: '' };
}

/** Whether to send, and what: the normalized draft against the `updatedAt` the user was looking at. */
export function crmSaveDecision(edit: CrmRowEdit | undefined, row: CustomerCareCrmRow, nowMs: number): CrmSaveDecision {
  if (!edit || crmRowReadOnly(row)) return { kind: 'skip' };
  const profile = normalizeCrmProfile(edit.draft);
  if (crmProfilesEqual(profile, profileFromRow(row))) return { kind: 'skip' };
  const problem = validateCrmProfile(profile, nowMs);
  if (problem) return { kind: 'invalid', message: problem };
  return { kind: 'save', input: { leadId: row.leadId, expectedUpdatedAt: row.profile.updatedAt, profile } };
}

/** After a save: the edit is done unless the user typed more meanwhile or still has values to re-apply. */
export function crmEditAfterSaved(edit: CrmRowEdit | undefined, saved: CustomerCareCrmRow): CrmRowEdit | null {
  if (!edit) return null;
  if (!edit.rejected && crmProfilesEqual(normalizeCrmProfile(edit.draft), profileFromRow(saved))) return null;
  return { draft: edit.draft, rejected: edit.rejected, error: '' };
}

/** Someone saved first: show their row and keep what this user typed, without saving it again by itself. */
export function crmEditOnConflict(edit: CrmRowEdit | undefined, server: CustomerCareCrmRow): CrmRowEdit {
  return { draft: profileFromRow(server), rejected: edit?.draft ?? null, error: CRM_CONFLICT_MESSAGE };
}

export function crmEditOnReapply(edit: CrmRowEdit): CrmRowEdit {
  return { draft: edit.rejected ?? edit.draft, rejected: null, error: '' };
}

export function crmEditOnDiscard(edit: CrmRowEdit, row: CustomerCareCrmRow): CrmRowEdit | null {
  if (crmProfilesEqual(normalizeCrmProfile(edit.draft), profileFromRow(row))) return null;
  return { ...edit, rejected: null, error: '' };
}

// ---------------------------------------------------------------------------
// Rows in memory
// ---------------------------------------------------------------------------

function isNewer(a: string | null, b: string | null): boolean {
  if (a === null) return false;
  if (b === null) return true;
  return Date.parse(a) > Date.parse(b);
}

/**
 * A refresh follows the server's rows and order, but never brings back a row deleted here and never undoes
 * a save that finished after the refresh started (a newer local `updatedAt` wins).
 */
export function crmRowsOnRefresh(
  current: readonly CustomerCareCrmRow[],
  fresh: readonly CustomerCareCrmRow[],
  removed: ReadonlySet<string>,
): CustomerCareCrmRow[] {
  const local = new Map(current.map((row) => [row.leadId, row]));
  return fresh
    .filter((row) => !removed.has(row.leadId))
    .map((row) => {
      const mine = local.get(row.leadId);
      return mine && isNewer(mine.profile.updatedAt, row.profile.updatedAt) ? mine : row;
    });
}

/**
 * The periodic refresh reads page 1 only (newest phone first) and merges it by `leadId`. Rows older than
 * page 1 stay as loaded; a row inside page 1's window that page 1 no longer holds was deleted, so it goes.
 * A complete page 1 (no cursor) is the whole list.
 */
export function crmRowsOnFirstPage(
  current: readonly CustomerCareCrmRow[],
  page: readonly CustomerCareCrmRow[],
  complete: boolean,
  removed: ReadonlySet<string>,
): CustomerCareCrmRow[] {
  const fresh = crmRowsOnRefresh(current, page, removed);
  if (complete) return fresh;
  const onPage = new Set(page.map((row) => row.leadId));
  const oldest = Math.min(...page.map((row) => Date.parse(row.phoneCapturedAt)));
  const rest = current.filter((row) => !onPage.has(row.leadId) && !removed.has(row.leadId)
    // Equal times may sit on page 2, so only strictly newer rows count as gone.
    && !(page.length > 0 && Date.parse(row.phoneCapturedAt) > oldest));
  return [...fresh, ...rest];
}

export function crmRowsOnSaved(rows: readonly CustomerCareCrmRow[], saved: CustomerCareCrmRow): CustomerCareCrmRow[] {
  return rows.map((row) => (row.leadId === saved.leadId ? saved : row));
}

export function crmRowsOnRemove(rows: readonly CustomerCareCrmRow[], leadId: string): CustomerCareCrmRow[] {
  return rows.filter((row) => row.leadId !== leadId);
}

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

export type CrmLoadResult =
  | {
    ok: true;
    workspaceId: string;
    role: CustomerCareCrmRole;
    canDelete: boolean;
    rows: CustomerCareCrmRow[];
    assignees: CustomerCareCrmAssignee[];
    /** Pages read by this load. */
    pages: number;
    /** The last page was reached (no cursor left). */
    complete: boolean;
    /** More than `CRM_MAX_PAGES` pages exist; only the newest are shown. */
    truncated: boolean;
  }
  | CustomerCareFacebookFailure;

/** Reads up to `maxPages` pages; one failed page, or a page for another workspace, fails the whole load. */
export async function loadCrmPages(
  list: (input: CustomerCareCrmListInput) => Promise<CustomerCareCrmListResult>,
  maxPages: number = CRM_MAX_PAGES,
): Promise<CrmLoadResult> {
  let cursor: string | null = null;
  let first: Extract<CustomerCareCrmListResult, { ok: true }> | null = null;
  let pages = 0;
  const rows: CustomerCareCrmRow[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    const result = await list({ cursor });
    if (!result.ok) return result;
    pages += 1;
    if (first && result.workspaceId !== first.workspaceId) return { ok: false, error: 'access_changed' };
    first ??= result;
    for (const row of result.rows) {
      if (seen.has(row.leadId)) continue;
      seen.add(row.leadId);
      rows.push(row);
    }
    cursor = result.nextCursor;
    if (cursor === null) break;
  }
  if (!first) return { ok: false, error: 'invalid-response' };
  return {
    ok: true,
    workspaceId: first.workspaceId,
    role: first.role,
    canDelete: first.canDelete,
    rows,
    assignees: first.assignees,
    pages,
    complete: cursor === null,
    truncated: cursor !== null && pages >= CRM_MAX_PAGES,
  };
}

// Load budget: GET /crm has no ETag, each page costs several DB queries plus sealed messages, and every Care
// route shares 30 requests a minute per user. The 60 s tick reads page 1 only; every page is read again only
// when the tab opens (at most once per refresh period), on "Làm mới", and after a 409.

/** Opening the tab reloads every page, unless the last full load is less than one refresh period old. */
export function crmShouldLoadOnShow(lastFullLoadMs: number | null, nowMs: number): boolean {
  return lastFullLoadMs === null || nowMs - lastFullLoadMs >= CRM_REFRESH_MS;
}

/** What a save answer asks of the list: every page after a 409, page 1 after a 403 (access check), else nothing. */
export function crmReloadAfterSave(result: CustomerCareCrmSaveResult): 'full' | 'page1' | null {
  if (result.ok) return null;
  if (result.error === 'profile_conflict') return 'full';
  return result.error === 'forbidden' ? 'page1' : null;
}

/** A 429, a 503 or another server-side failure: skip the next tick instead of adding load. */
export function crmShouldSkipNextTick(failure: CustomerCareFacebookFailure): boolean {
  return failure.error === 'unavailable' || failure.error === 'not_configured';
}

// ---------------------------------------------------------------------------
// Failure text
// ---------------------------------------------------------------------------

const FAILURE_MESSAGES: Partial<Record<CustomerCareFacebookFailure['error'], string>> = {
  forbidden: CRM_FORBIDDEN_MESSAGE,
  auth: 'Hãy đăng nhập và chọn dự án để xem CRM.',
  access_changed: 'Tài khoản hoặc dự án vừa đổi. Danh sách sẽ được tải lại.',
  unsupported: 'Máy chủ izzi chưa bật CRM.',
  not_configured: 'Máy chủ izzi chưa sẵn sàng cho CRM. Hãy liên hệ hỗ trợ izzi.',
  unavailable: 'Chưa kết nối được máy chủ izzi. Thử lại sau ít phút.',
  invalid_input: 'Yêu cầu không hợp lệ. Hãy tải lại.',
  'invalid-response': 'Phản hồi từ máy chủ không hợp lệ. Thử lại sau.',
};

/** Fixed text for a bounded failure; `dropRows` when this account may no longer see the rows. */
export function crmFailureView(failure: CustomerCareFacebookFailure): { message: string; dropRows: boolean } {
  const dropRows = failure.error === 'forbidden' || failure.error === 'auth' || failure.error === 'access_changed';
  // Read by `reason`; the server's own text (e.g. a 422 saying "No Facebook Page available") is never shown.
  if (failure.reason === 'lead_not_found') return { message: 'Khách này không còn trong danh sách.', dropRows };
  if (failure.reason === 'rate_limited') {
    return { message: 'Đang có nhiều yêu cầu. CRM sẽ tự tải lại sau ít phút.', dropRows };
  }
  if (failure.error === 'rejected' && failure.reason === 'invalid_request') {
    return { message: FAILURE_MESSAGES.invalid_input!, dropRows };
  }
  return { message: FAILURE_MESSAGES[failure.error] ?? 'Chưa tải được CRM. Thử lại sau ít phút.', dropRows };
}

/** A save refused with 403 may be an owner who left the project rather than lost access. */
export const CRM_SAVE_FORBIDDEN_MESSAGE = 'Chưa lưu được. Người phụ trách phải còn trong dự án; hãy chọn người khác.';
