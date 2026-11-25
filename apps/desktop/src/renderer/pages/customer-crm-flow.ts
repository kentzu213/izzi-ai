/**
 * Pure decisions for MyGraph → CRM (Care CRM S2). `CustomerCrmPanel` keeps the React state and IPC calls;
 * the call list, sort order, field rules, save decisions, conflict handling, paging and error text live here
 * so they test without a DOM. Rows are only ever held in component memory; nothing here stores or logs them.
 */
import type {
  CustomerCareCrmAddressForm,
  CustomerCareCrmAssignee,
  CustomerCareCrmConsentAsk,
  CustomerCareCrmListInput,
  CustomerCareCrmListResult,
  CustomerCareCrmLostReason,
  CustomerCareCrmOccasion,
  CustomerCareCrmPageSource,
  CustomerCareCrmPersona,
  CustomerCareCrmProfile,
  CustomerCareCrmProfileInput,
  CustomerCareCrmRole,
  CustomerCareCrmRow,
  CustomerCareCrmSaveInput,
  CustomerCareCrmSaveResult,
  CustomerCareCrmStage,
  CustomerCareFacebookFailure,
  CustomerCareFact,
  CustomerCareSnapshot,
} from '../../shared/customer-care-types';
import {
  crmConsentedPersona,
  extractEditableFreeNote,
  normalizeCrmNoteTags,
} from '../../shared/customer-crm-enterprise';

/** The CRM tab asks for fresh rows this often while it is on screen. */
export const CRM_REFRESH_MS = 60_000;
/** 50 pages of up to 100: the newest 5,000 customers. */
export const CRM_MAX_PAGES = 50;
/** Default DOM batch size in table and card lists so 5,000 loaded customers render at 60fps. */
export const PAGE_RENDER_STEP = 100;
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

// The shops are in Vietnam: "today", "overdue", the date pickers and due times use Asia/Ho_Chi_Minh whatever
// zone this PC is set to. Vietnam is UTC+7 all year (no daylight saving), so a fixed offset is exact.
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The Vietnamese wall clock of an instant, read through the UTC getters. */
function vietnamClock(ms: number): Date {
  return new Date(ms + VIETNAM_OFFSET_MS);
}

/** Vietnamese `YYYY-MM-DD` of an instant. */
export function vietnamDateKey(ms: number): string {
  return vietnamClock(ms).toISOString().slice(0, 10);
}

function shiftYears(ms: number, years: number, days = 0): number {
  const date = new Date(ms);
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.getTime() + days * DAY_MS;
}

/** Bounds for the date pickers, one day inside the server's ±2 years so an edge day never fails there. */
export function crmDateBounds(nowMs: number): { min: string; max: string } {
  return { min: vietnamDateKey(shiftYears(nowMs, -2, 1)), max: vietnamDateKey(shiftYears(nowMs, 2, -1)) };
}

/** An ISO instant as the value of the `datetime-local` input, in Vietnamese time. */
export function isoToLocalInput(iso: string | null): string {
  if (iso === null) return '';
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? vietnamClock(ms).toISOString().slice(0, 16) : '';
}

/** The `datetime-local` value, read as Vietnamese time. */
export function localInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = Date.parse(`${value}:00+07:00`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** "09:30 25/11" for a due time, in Vietnamese time. */
export function formatCrmDue(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const clock = vietnamClock(ms).toISOString();
  return `${clock.slice(11, 16)} ${clock.slice(8, 10)}/${clock.slice(5, 7)}`;
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
export type CrmPersonaFilter = CustomerCareCrmPersona | 'any' | 'unclassified';

export interface CrmFilter {
  view: CrmView;
  stage: CustomerCareCrmStage | 'any';
  pageId?: string | 'any';
  persona?: CrmPersonaFilter;
  query?: string;
}

export interface CrmPageOption {
  pageId: string;
  label: string;
  count: number;
}

export function crmPageShortId(pageId: string): string {
  return pageId.length > 6 ? `…${pageId.slice(-6)}` : pageId;
}

/** Merges Page sources across `GET /crm` pages, previous loads and the workspace snapshot, upgrading null names. */
export function mergeCrmPageSources(
  ...lists: ReadonlyArray<readonly CustomerCareCrmPageSource[] | undefined>
): CustomerCareCrmPageSource[] {
  const byId = new Map<string, string | null>();
  const order: string[] = [];
  for (const list of lists) {
    if (!list) continue;
    for (const item of list) {
      const pageId = item.pageId.trim();
      if (!pageId) continue;
      const cleanName = item.pageName?.trim() || null;
      if (!byId.has(pageId)) {
        order.push(pageId);
        byId.set(pageId, cleanName);
      } else if (byId.get(pageId) === null && cleanName !== null) {
        byId.set(pageId, cleanName);
      }
    }
  }
  return order.map((pageId) => ({ pageId, pageName: byId.get(pageId) ?? null }));
}

/** All verified Page sources (primary + secondary CRM-synced Pages) known from the workspace snapshot. */
export function snapshotPageSources(
  snapshot: (Pick<CustomerCareSnapshot, 'setup' | 'pageConnection'> & Partial<Pick<CustomerCareSnapshot, 'crmPages'>>) | null | undefined,
): CustomerCareCrmPageSource[] {
  if (!snapshot) return [];
  const raw: CustomerCareCrmPageSource[] = [];
  if (snapshot.pageConnection.state === 'connected') {
    const connName = snapshot.pageConnection.pageName?.trim() || null;
    const setupMatch = snapshot.setup?.pageId === snapshot.pageConnection.pageId
      ? snapshot.setup.pageName.trim() || null
      : null;
    raw.push({
      pageId: snapshot.pageConnection.pageId,
      pageName: connName ?? setupMatch,
    });
    if (snapshot.pageConnection.crmPages) {
      for (const page of snapshot.pageConnection.crmPages) {
        raw.push({ pageId: page.pageId, pageName: page.pageName?.trim() || null });
      }
    }
  }
  if (snapshot.crmPages) {
    for (const page of snapshot.crmPages) {
      raw.push({ pageId: page.pageId, pageName: page.pageName?.trim() || null });
    }
  }
  if (raw.length === 0) {
    const setupPageId = snapshot.setup?.pageId.trim() ?? '';
    if (setupPageId) {
      raw.push({
        pageId: setupPageId,
        pageName: snapshot.setup?.pageName.trim() || null,
      });
    }
  }
  return mergeCrmPageSources(raw);
}

/** Fallback Page source derived from the workspace snapshot when `GET /crm` did not return `pages`. */
export function snapshotPageFallback(
  snapshot: (Pick<CustomerCareSnapshot, 'setup' | 'pageConnection'> & Partial<Pick<CustomerCareSnapshot, 'crmPages'>>) | null | undefined,
): CustomerCareCrmPageSource | null {
  return snapshotPageSources(snapshot)[0] ?? null;
}

/** Resolves a human-friendly Page label (`Đồng Thờ Hồng Hưng`, `Xưởng tranh đồng Đại Long`, or `Page …58057`). */
export function resolveCrmPageLabel(
  pageId: string,
  sources: readonly CustomerCareCrmPageSource[],
  fallback?: CustomerCareCrmPageSource | null,
): string {
  const matched = sources.find((item) => item.pageId === pageId);
  if (matched?.pageName && matched.pageName.trim() !== '') {
    return matched.pageName.trim();
  }
  if (fallback && fallback.pageId === pageId && fallback.pageName && fallback.pageName.trim() !== '') {
    return fallback.pageName.trim();
  }
  return `Page ${crmPageShortId(pageId)}`;
}

/** Builds Page filter options from loaded rows, `GET /crm?include=identity,pages` sources, and workspace snapshot Pages. */
export function crmPageOptions(
  rows: readonly CustomerCareCrmRow[],
  sources: readonly CustomerCareCrmPageSource[],
  fallback?: CustomerCareCrmPageSource | null,
): CrmPageOption[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.pageId, (counts.get(row.pageId) ?? 0) + 1);
  }
  const orderedIds: string[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    if (!seen.has(source.pageId)) {
      seen.add(source.pageId);
      orderedIds.push(source.pageId);
    }
  }
  for (const pageId of counts.keys()) {
    if (!seen.has(pageId)) {
      seen.add(pageId);
      orderedIds.push(pageId);
    }
  }
  if (fallback && !seen.has(fallback.pageId) && orderedIds.length > 0) {
    seen.add(fallback.pageId);
    orderedIds.push(fallback.pageId);
  }
  return orderedIds.map((pageId) => ({
    pageId,
    label: resolveCrmPageLabel(pageId, sources, fallback),
    count: counts.get(pageId) ?? 0,
  }));
}

/** Bounded DOM slice count (>= `PAGE_RENDER_STEP`), automatically expanded if a Drawer-pinned row sits past the limit. */
export function effectiveCrmRenderLimit(
  totalCount: number,
  renderLimit: number,
  pinnedIndex = -1,
): number {
  if (totalCount <= 0) return 0;
  const base = Math.max(PAGE_RENDER_STEP, renderLimit);
  const requiredForPinned = pinnedIndex >= 0
    ? Math.ceil((pinnedIndex + 1) / PAGE_RENDER_STEP) * PAGE_RENDER_STEP
    : base;
  return Math.min(totalCount, Math.max(base, requiredForPinned));
}

function foldCrmSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase();
}

export function crmMatchesQuery(row: CustomerCareCrmRow, query: string | undefined): boolean {
  const raw = query?.trim() ?? '';
  if (raw === '') return true;
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 2 && row.phone.includes(digits)) return true;
  const needle = foldCrmSearch(raw);
  if (needle === '') return false;
  const freeNote = extractEditableFreeNote(row.profile.note);
  const haystack = [
    row.customerName ?? '',
    row.phone,
    freeNote,
    row.profile.nextStep ?? '',
    ...row.recentMessages.map((msg) => msg.text),
  ].map(foldCrmSearch).join(' \n ');
  return haystack.includes(needle);
}

/** Consented server persona (`P1..P4`) only; never inferred without customer consent (Care CRM S3). */
export function crmRowPersona(row: CustomerCareCrmRow): CustomerCareCrmPersona | null {
  return crmConsentedPersona(row);
}

export function crmFilterRows<T extends CustomerCareCrmRow>(
  rows: readonly T[],
  filter: Pick<CrmFilter, 'stage' | 'pageId' | 'persona' | 'query'>,
  options: { ignoreStage?: boolean } = {},
): T[] {
  const pageFilter = filter.pageId ?? 'any';
  const personaFilter = filter.persona ?? 'any';
  const stageFilter = options.ignoreStage ? 'any' : filter.stage;
  return rows.filter((row) => {
    if (pageFilter !== 'any' && row.pageId !== pageFilter) return false;
    if (stageFilter !== 'any' && row.profile.stage !== stageFilter) return false;
    if (personaFilter !== 'any') {
      const persona = crmRowPersona(row);
      if (personaFilter === 'unclassified' ? persona !== null : persona !== personaFilter) return false;
    }
    return crmMatchesQuery(row, filter.query);
  });
}

type DueFields = Pick<CustomerCareCrmProfileInput, 'stage' | 'nextStep' | 'nextStepDueAt'>;

/** Customers no one should call: they did not buy, or asked not to be contacted. A delivery still gets follow-ups. */
const NEVER_DUE_STAGES: readonly CustomerCareCrmStage[] = ['lost', 'do_not_contact'];

/** Due on the Vietnamese calendar. A lost or do-not-contact customer is never due, whatever date is left. */
export function crmDue(profile: DueFields, nowMs: number): CrmDue {
  if (NEVER_DUE_STAGES.includes(profile.stage) || profile.nextStepDueAt === null) return 'none';
  const due = Date.parse(profile.nextStepDueAt);
  if (!Number.isFinite(due)) return 'none';
  if (due < nowMs) return 'overdue';
  return vietnamDateKey(due) === vietnamDateKey(nowMs) ? 'today' : 'later';
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
 * `pinnedId` (the row open in the drawer/editor) stays on screen even after a save moves it out of the view.
 */
export function crmVisibleRows(
  rows: readonly CustomerCareCrmRow[],
  filter: CrmFilter,
  nowMs: number,
  pinnedId: string | null = null,
): CustomerCareCrmRow[] {
  const pageFilter = filter.pageId ?? 'any';
  const personaFilter = filter.persona ?? 'any';
  return sortCrmRows(rows.filter((row) => {
    if (row.leadId === pinnedId) return true;
    if (filter.view !== 'all' && !isCallToday(row.profile, nowMs)) return false;
    if (filter.stage !== 'any' && row.profile.stage !== filter.stage) return false;
    if (pageFilter !== 'any' && row.pageId !== pageFilter) return false;
    if (personaFilter !== 'any') {
      const persona = crmRowPersona(row);
      if (personaFilter === 'unclassified' ? persona !== null : persona !== personaFilter) return false;
    }
    return crmMatchesQuery(row, filter.query);
  }), nowMs);
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

// The server refuses control characters (a note keeps line breaks), every format character (Cf) except the
// zero-width joiner, and the line and paragraph separators. Typed text is cleaned so a save never gets a 400.
const LINE_UNSAFE = /[\u0000-\u001f\u007f-\u009f]/g;
const NOTE_UNSAFE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g;
const FORMAT_EXCEPT_JOINER = /(?!\u200D)\p{Cf}/gu;
const SEPARATORS = /[\u2028\u2029]/g;

function cleanText(value: string | null, unsafe: RegExp): string | null {
  if (value === null) return null;
  const cleaned = value
    .replace(/\r\n?/g, '\n')
    .replace(SEPARATORS, '\n')
    .replace(FORMAT_EXCEPT_JOINER, '')
    .replace(unsafe, ' ')
    .trim();
  return cleaned === '' ? null : cleaned;
}

/** What a save sends: hidden-by-stage fields cleared, text trimmed (empty → null), products de-duplicated. */
export function normalizeCrmProfile(draft: CustomerCareCrmProfileInput): CustomerCareCrmProfileInput {
  const visible = crmFieldVisibility(draft.stage);
  return {
    ...draft,
    productFactIds: [...new Set(draft.productFactIds)],
    nextStep: cleanText(draft.nextStep, LINE_UNSAFE),
    // Through the codec on every save: a tag beta.121 left in the note loses its profile-layer keys (Care CRM S3).
    note: normalizeCrmNoteTags(cleanText(draft.note, NOTE_UNSAFE)),
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
    if (!Number.isFinite(due) || due < shiftYears(nowMs, -2, 1) || due > shiftYears(nowMs, 2, -1)) {
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

/** Notes compare as the codec writes them: a row is never saved only to clean an old tag, but is once it changes. */
export function crmProfilesEqual(a: CustomerCareCrmProfileInput, b: CustomerCareCrmProfileInput): boolean {
  return a.stage === b.stage && a.ownerUserId === b.ownerUserId && a.addressForm === b.addressForm
    && a.occasion === b.occasion && a.neededBy === b.neededBy && a.nextStep === b.nextStep
    && a.nextStepDueAt === b.nextStepDueAt && a.lostReason === b.lostReason && a.purchasedAt === b.purchasedAt
    && normalizeCrmNoteTags(a.note) === normalizeCrmNoteTags(b.note) && a.productFactIds.length === b.productFactIds.length
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
  /**
   * The `updatedAt` of the version this draft was made from, fixed when the edit starts. A save always sends
   * it, so a refresh that swaps in someone else's newer row cannot turn this draft into a silent overwrite.
   */
  baseUpdatedAt: string | null;
}

export type CrmSaveDecision =
  | { kind: 'skip' }
  | { kind: 'invalid'; message: string }
  | { kind: 'save'; input: CustomerCareCrmSaveInput };

/** A change: a new edit starts from the row on screen; an ongoing edit keeps the version it started from. */
export function crmEditOnChange(
  edit: CrmRowEdit | undefined,
  draft: CustomerCareCrmProfileInput,
  row: CustomerCareCrmRow,
): CrmRowEdit {
  return {
    draft,
    rejected: edit?.rejected ?? null,
    error: '',
    baseUpdatedAt: edit ? edit.baseUpdatedAt : row.profile.updatedAt,
  };
}

/** Whether to send, and what: the normalized draft against the version the edit started from. */
export function crmSaveDecision(edit: CrmRowEdit | undefined, row: CustomerCareCrmRow, nowMs: number): CrmSaveDecision {
  if (!edit || crmRowReadOnly(row)) return { kind: 'skip' };
  const profile = normalizeCrmProfile(edit.draft);
  if (crmProfilesEqual(profile, profileFromRow(row))) return { kind: 'skip' };
  const problem = validateCrmProfile(profile, nowMs);
  if (problem) return { kind: 'invalid', message: problem };
  return { kind: 'save', input: { leadId: row.leadId, expectedUpdatedAt: edit.baseUpdatedAt, profile } };
}

/**
 * After a save: the edit is done unless the user typed more meanwhile or still has values to re-apply. What is
 * left now builds on the version this save just wrote.
 */
export function crmEditAfterSaved(edit: CrmRowEdit | undefined, saved: CustomerCareCrmRow): CrmRowEdit | null {
  if (!edit) return null;
  if (!edit.rejected && crmProfilesEqual(normalizeCrmProfile(edit.draft), profileFromRow(saved))) return null;
  return { draft: edit.draft, rejected: edit.rejected, error: '', baseUpdatedAt: saved.profile.updatedAt };
}

/** Someone saved first: show their row and keep what this user typed, without saving it again by itself. */
export function crmEditOnConflict(edit: CrmRowEdit | undefined, server: CustomerCareCrmRow): CrmRowEdit {
  return {
    draft: profileFromRow(server),
    rejected: edit?.draft ?? null,
    error: CRM_CONFLICT_MESSAGE,
    baseUpdatedAt: server.profile.updatedAt,
  };
}

/** Re-applying builds on the version the conflict showed; a newer change by someone else gets another 409. */
export function crmEditOnReapply(edit: CrmRowEdit): CrmRowEdit {
  return { draft: edit.rejected ?? edit.draft, rejected: null, error: '', baseUpdatedAt: edit.baseUpdatedAt };
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

type CrmIdentity = NonNullable<CustomerCareCrmRow['identity']>;

/** The customer refused, withdrew, or asked for their data to be erased: the AI identity is already wiped. */
function refusedOrErasing(identity: CrmIdentity): boolean {
  const consent = identity.consent;
  return consent?.state === 'declined' || consent?.state === 'withdrawn' || (consent?.eraseRequestedAt ?? null) !== null;
}

/**
 * Care CRM S3: the identity has its own version (`identity_updated_at`, which staff and AI writes move forward, to the
 * millisecond). A refresh does not put an older identity over a newer one on screen. The server's answer always wins
 * when it has no version (a wipe can delete the identity row) or carries a refusal or an erase request, so those show
 * at once; reads that predate a staff action never get here, because the action's answer drops them
 * (`CrmLoadSequence.invalidate`). An equal or newer identity follows the server (a consent change keeps the version),
 * and so does none at all (the list was read without identity).
 */
function newerIdentity(mine: CrmIdentity | undefined, fresh: CrmIdentity | undefined): CrmIdentity | undefined {
  if (!fresh || !mine || mine.version === null) return fresh;
  if (fresh.version === null || refusedOrErasing(fresh)) return fresh;
  return Date.parse(mine.version) > Date.parse(fresh.version) ? mine : fresh;
}

function rowWithIdentity(row: CustomerCareCrmRow, identity: CrmIdentity | undefined, unavailable: boolean): CustomerCareCrmRow {
  const { identity: _identity, identityUnavailable: _unavailable, ...rest } = row;
  if (identity) return { ...rest, identity };
  return unavailable ? { ...rest, identityUnavailable: true } : rest;
}

/**
 * A refresh follows the server's rows and order, but never brings back a row deleted here and never undoes
 * a save that finished after the refresh started (a newer local `updatedAt` wins). The identity is merged on its
 * own version, apart from the profile.
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
      if (!mine) return row;
      const base = isNewer(mine.profile.updatedAt, row.profile.updatedAt) ? mine : row;
      const identity = newerIdentity(mine.identity, row.identity);
      const unavailable = identity === undefined && row.identityUnavailable === true;
      if (identity === base.identity && unavailable === (base.identityUnavailable === true)) return base;
      return rowWithIdentity(base, identity, unavailable);
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

/**
 * True when a periodic `page1` read has `nextCursor !== null` (`!complete`) and does not overlap `current` at all
 * (e.g. a multi-Page backfill just imported >100 leads), so pages 2..N must be loaded to avoid a gap.
 */
export function crmPage1NeedsFullReload(
  current: readonly CustomerCareCrmRow[],
  page1Rows: readonly CustomerCareCrmRow[],
  complete: boolean,
): boolean {
  if (complete || page1Rows.length === 0) return false;
  if (current.length === 0) return true;
  const known = new Set(current.map((row) => row.leadId));
  return page1Rows.every((row) => !known.has(row.leadId));
}

export function crmRowsOnSaved(rows: readonly CustomerCareCrmRow[], saved: CustomerCareCrmRow): CustomerCareCrmRow[] {
  return rows.map((row) => (row.leadId === saved.leadId ? saved : row));
}

/**
 * A save answer carries the stored profile only (the server may not present the lead after it commits): the
 * row on screen keeps its name, phone, messages and times, and takes the profile.
 */
export function crmRowWithProfile(row: CustomerCareCrmRow, profile: CustomerCareCrmProfile): CustomerCareCrmRow {
  return { ...row, profile: { ...profile, productFactIds: [...profile.productFactIds] } };
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
    pageSources: CustomerCareCrmPageSource[];
    /** Pages read by this load. */
    pages: number;
    /** The last page was reached (no cursor left). */
    complete: boolean;
    /** The page cap of this load was hit with pages left, or a later page failed transiently; for a full load, at most 5,000 are shown. */
    truncated: boolean;
    /** Set when page 1 succeeded and a later page (`page > 0`) hit a transient failure; rows already loaded are preserved. */
    partialFailure?: CustomerCareFacebookFailure;
    /** Care CRM S3, from the first page: the AI profile is on; null when the server sent no identity. */
    identityEnabled: boolean | null;
    /** Care CRM S3: some page was read without its identity (the identity read failed). */
    identityUnavailable: boolean;
    /** Care CRM S3, from the first page: the exact consent question; null while asks are off. */
    consentAsk: CustomerCareCrmConsentAsk | null;
  }
  | CustomerCareFacebookFailure;

/**
 * Reads up to `maxPages` pages (`50 * 100 = 5,000` customers). Page 1 failure, lost access (`auth` / `forbidden` /
 * `access_changed`), or a page for another workspace fails the whole load. When `strictAllPages` is not set, a
 * transient failure on `page > 0` keeps the rows already loaded and marks `truncated: true` + `partialFailure`.
 * `retryIdentity` ("Làm mới"): main tries the identity read again on the first page even while it is paused.
 */
export async function loadCrmPages(
  list: (input: CustomerCareCrmListInput) => Promise<CustomerCareCrmListResult>,
  maxPages: number = CRM_MAX_PAGES,
  options: { retryIdentity?: boolean; strictAllPages?: boolean } = {},
): Promise<CrmLoadResult> {
  let cursor: string | null = null;
  let first: Extract<CustomerCareCrmListResult, { ok: true }> | null = null;
  let pages = 0;
  let identityUnavailable = false;
  let partialFailure: CustomerCareFacebookFailure | undefined;
  const rows: CustomerCareCrmRow[] = [];
  const seen = new Set<string>();
  const pageSources: CustomerCareCrmPageSource[] = [];
  const seenPages = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    const result = await list(page === 0 && options.retryIdentity ? { cursor: null, retryIdentity: true } : { cursor });
    if (!result.ok) {
      const accessLost = result.error === 'auth' || result.error === 'forbidden' || result.error === 'access_changed';
      if (page === 0 || accessLost || options.strictAllPages === true) return result;
      partialFailure = result;
      break;
    }
    pages += 1;
    identityUnavailable ||= result.identityUnavailable;
    if (first && result.workspaceId !== first.workspaceId) return { ok: false, error: 'access_changed' };
    first ??= result;
    if (result.pages) {
      for (const source of result.pages) {
        if (!seenPages.has(source.pageId)) {
          seenPages.add(source.pageId);
          pageSources.push(source);
        }
      }
    }
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
    pageSources,
    pages,
    complete: cursor === null && !partialFailure,
    truncated: Boolean(partialFailure) || (cursor !== null && pages >= maxPages),
    ...(partialFailure ? { partialFailure } : {}),
    identityEnabled: first.identityEnabled,
    identityUnavailable,
    consentAsk: first.consentAsk,
  };
}

/**
 * Which list read is current. Each read gets a number and an answer that is no longer the latest is dropped. An
 * identity answer (Care CRM S3) makes every read in flight stale, since it may predate the staff action; a full
 * reload ("Làm mới", the tab opening) caught that way is started again instead of being lost.
 */
export class CrmLoadSequence {
  private latest = 0;
  /** The full reload the "Làm mới" spinner shows, while it runs. */
  private full: number | null = null;

  start(mode: 'full' | 'page1'): number {
    this.latest += 1;
    if (mode === 'full') this.full = this.latest;
    return this.latest;
  }

  isCurrent(seq: number): boolean {
    return seq === this.latest;
  }

  /** A read ended; true when it was the full reload the spinner shows, which then stops. */
  finish(seq: number): boolean {
    if (this.full !== seq) return false;
    this.full = null;
    return true;
  }

  /** Drops every read in flight; true when a full reload was among them, so the caller starts it again. */
  invalidate(): boolean {
    this.latest += 1;
    return this.full !== null;
  }
}

/** "Làm mới" rests this long after a full reload, so repeated clicks cannot pile up every-page reads. */
export const CRM_REFRESH_COOLDOWN_MS = 15_000;

export function crmRefreshCooldownLeft(lastFullLoadMs: number | null, nowMs: number): number {
  if (lastFullLoadMs === null) return 0;
  return Math.max(0, CRM_REFRESH_COOLDOWN_MS - (nowMs - lastFullLoadMs));
}

// Load budget: GET /crm has no ETag, each page costs several DB queries plus sealed messages, and every Care
// route shares 30 requests a minute per user. The 60 s tick reads page 1 only; every page is read again only
// when the tab opens (at most once per refresh period), on "Làm mới", and after a 409.

/** Opening the tab reloads every page, unless the last full load is less than one refresh period old. */
export function crmShouldLoadOnShow(lastFullLoadMs: number | null, nowMs: number): boolean {
  return lastFullLoadMs === null || nowMs - lastFullLoadMs >= CRM_REFRESH_MS;
}

/**
 * What a save answer asks of the list: every page after a 409; page 1 after `owner_not_eligible`, so the
 * assignee list is current; otherwise nothing.
 */
export function crmReloadAfterSave(result: CustomerCareCrmSaveResult): 'full' | 'page1' | null {
  if (result.ok) return null;
  if (result.error === 'profile_conflict') return 'full';
  return result.reason === 'owner_not_eligible' ? 'page1' : null;
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

export const CRM_OWNER_NOT_ELIGIBLE_MESSAGE = 'Người phụ trách này không còn trong dự án.';
export const CRM_SAVE_INVALID_MESSAGE = 'Chưa lưu được: có nội dung không hợp lệ. Hãy sửa rồi bấm Lưu.';
const SAVE_RATE_LIMITED_MESSAGE = 'Đang có nhiều yêu cầu. Chờ ít phút rồi bấm Lưu.';

/**
 * Fixed text for a failed save. Only lost access drops the rows; anything else leaves the row editable with
 * its draft, so a 400, 429 or 503 never locks it.
 */
export function crmSaveFailureView(failure: CustomerCareFacebookFailure): { message: string; dropRows: boolean } {
  if (failure.reason === 'owner_not_eligible') return { message: CRM_OWNER_NOT_ELIGIBLE_MESSAGE, dropRows: false };
  if (failure.reason === 'rate_limited') return { message: SAVE_RATE_LIMITED_MESSAGE, dropRows: false };
  if (failure.error === 'invalid_input' || (failure.error === 'rejected' && failure.reason === 'invalid_request')) {
    return { message: CRM_SAVE_INVALID_MESSAGE, dropRows: false };
  }
  return crmFailureView(failure);
}
