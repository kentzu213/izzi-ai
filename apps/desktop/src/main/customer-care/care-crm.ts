/**
 * Care CRM S2 rules: who may use the CRM, strict parsing of renderer input (the IPC argument guard) and of
 * the two CRM route answers. Rows hold phones, names and staff notes, so they stay in memory for display:
 * this module never persists, logs or reports them, and nothing here writes graph nodes or SQLite.
 *
 * @module main/customer-care/care-crm
 */
import { ISO_PATTERN } from '../marketing/native-marketing-client';
import {
  CUSTOMER_CARE_CRM_ADDRESS_FORMS,
  CUSTOMER_CARE_CRM_LOST_REASONS,
  CUSTOMER_CARE_CRM_OCCASIONS,
  CUSTOMER_CARE_CRM_ROLES,
  CUSTOMER_CARE_CRM_STAGES,
  type CustomerCareCrmAssignee,
  type CustomerCareCrmConsentAsk,
  type CustomerCareCrmIdentityActionInput,
  type CustomerCareCrmListInput,
  type CustomerCareCrmPageSource,
  type CustomerCareCrmProfile,
  type CustomerCareCrmProfileInput,
  type CustomerCareCrmRole,
  type CustomerCareCrmRow,
  type CustomerCareCrmSaveInput,
  type CustomerCareCrmStage,
  type CustomerCareLeadMessage,
  type CustomerCareRole,
} from '../../shared/customer-care-types';
import {
  CARE_LEAD_MAX_MESSAGES,
  CARE_LEAD_PHONE_PATTERN,
  isCareFacebookChoiceId,
  isCareFacebookPageId,
  isCareLeadStatus,
  isCareLeadsCursor,
  parseCustomerName,
  parseLeadMessage,
  type CareFacebookResult,
} from './care-facebook-client';
import {
  copyCareCrmIdentity,
  parseCareCrmConsentAsk,
  parseCareCrmIdentity,
  type CareCrmIdentityOutcome,
  type CareCrmRefreshOutcome,
} from './care-crm-identity';

export const CARE_CRM_PAGE_SIZE = 50;
export const CARE_CRM_MAX_PRODUCTS = 8;
export const CARE_CRM_MAX_NEXT_STEP = 200;
export const CARE_CRM_MAX_NOTE = 1_000;
export const CARE_CRM_MAX_ASSIGNEES = 200;
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_WINDOW_YEARS = 2;
// The server's text rule (backend 58d8ea0), checked before trimming: no control character (a note keeps its
// line breaks), no format character (Cf: bidi controls, zero-width marks, U+FEFF, ...) except the zero-width
// joiner that multi-part emoji need, no line or paragraph separator, and no half of a surrogate pair.
const UNSAFE_LINE = /[\u0000-\u001f\u007f-\u009f]/;
const UNSAFE_NOTE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;
const FORMAT_OR_SEPARATOR = /(?!\u200D)[\p{Cf}\u2028\u2029]/u;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
// What the server accepts in a request: a zone is required, at most 6 fractional digits.
const REQUEST_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const PROFILE_INPUT_KEYS = [
  'stage', 'ownerUserId', 'addressForm', 'occasion', 'neededBy', 'productFactIds',
  'nextStep', 'nextStepDueAt', 'lostReason', 'purchasedAt', 'note',
] as const;
const PURCHASE_STAGES: readonly CustomerCareCrmStage[] = ['deposit', 'delivered'];

/** One page of CRM rows, newest phone first, with the people a row may be assigned to and optional source Pages. */
export interface CareCrmPage {
  role: CustomerCareCrmRole;
  canDelete: boolean;
  rows: CustomerCareCrmRow[];
  nextCursor: string | null;
  assignees: CustomerCareCrmAssignee[];
  pages?: CustomerCareCrmPageSource[];
  /** Care CRM S3: the server's `identityEnabled`; null when it answered without identity (no S3 there). */
  identityEnabled: boolean | null;
  /** Care CRM S3: the identity could not be loaded for this page; the rows are shown without it. */
  identityUnavailable: boolean;
  /** Care CRM S3: the exact consent question the server would send; null while asks are off. */
  consentAsk: CustomerCareCrmConsentAsk | null;
}

/**
 * A save either stored the profile, or lost to a newer save and carries the current profile. Only the profile
 * is kept: the server may answer without the lead's phone and messages after the database step committed.
 */
export type CareCrmSaveOutcome =
  | { kind: 'saved'; leadId: string; profile: CustomerCareCrmProfile }
  | { kind: 'conflict'; leadId: string; profile: CustomerCareCrmProfile };

/**
 * Care CRM S3, how a list read treats the identity: `scope` names the live account and workspace (the identity pause
 * after a failed read belongs to it, so a switch starts afresh); `retryIdentity` ("Làm mới") tries the identity read
 * again even while it is paused.
 */
export interface CareCrmListOptions {
  scope?: string;
  retryIdentity?: boolean;
}

/** The CRM routes `CustomerCareService` depends on; tests substitute an in-memory fake. */
export interface CareCrmGateway {
  listCrm(workspaceId: string, cursor: string | null, options?: CareCrmListOptions): Promise<CareFacebookResult<CareCrmPage>>;
  saveCrmProfile(workspaceId: string, input: CustomerCareCrmSaveInput): Promise<CareFacebookResult<CareCrmSaveOutcome>>;
  /** Care CRM S3: a staff action on the identity card; the caller has already parsed `input`. */
  identityAction(workspaceId: string, input: CustomerCareCrmIdentityActionInput): Promise<CareFacebookResult<CareCrmIdentityOutcome>>;
  /** Care CRM S3: one identity run now, waited for up to 45 s. */
  refreshIdentity(workspaceId: string, leadId: string): Promise<CareFacebookResult<CareCrmRefreshOutcome>>;
}

/** Mirrors the backend: owner, manager and editor read and edit profiles; a viewer or reviewer never does. */
export function canUseCareCrm(role: CustomerCareRole): boolean {
  return (CUSTOMER_CARE_CRM_ROLES as readonly string[]).includes(role);
}

// ---------------------------------------------------------------------------
// Primitive checks
// ---------------------------------------------------------------------------

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return null;
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    return null;
  }
  return value as Record<string, unknown>;
}

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function nullableOneOf<T extends string>(list: readonly T[], value: unknown): value is T | null {
  return value === null || oneOf(list, value);
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && ISO_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

/** A timestamp the server accepts in a request; sent on exactly as given. */
function isRequestTimestamp(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function isUuidOrNull(value: unknown): value is string | null {
  return value === null || isCareFacebookChoiceId(value);
}

/** `YYYY-MM-DD` naming a real calendar day. */
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function shiftYears(now: Date, years: number): Date {
  const shifted = new Date(now.getTime());
  shifted.setUTCFullYear(shifted.getUTCFullYear() + years);
  return shifted;
}

/** A day inside the contract window: from the day two years ago through two years from now. */
function dayInWindow(value: string, now: Date): boolean {
  const lower = shiftYears(now, -DATE_WINDOW_YEARS);
  const lowerDay = Date.UTC(lower.getUTCFullYear(), lower.getUTCMonth(), lower.getUTCDate());
  const dayMs = Date.parse(`${value}T00:00:00.000Z`);
  return dayMs >= lowerDay && dayMs <= shiftYears(now, DATE_WINDOW_YEARS).getTime();
}

function timeInWindow(value: string, now: Date): boolean {
  const time = Date.parse(value);
  return time >= shiftYears(now, -DATE_WINDOW_YEARS).getTime() && time <= shiftYears(now, DATE_WINDOW_YEARS).getTime();
}

/**
 * Trimmed text of 1..`max` characters (code points, so an emoji counts as one), or null when unacceptable.
 * Like the server, the characters are checked on the value as given, before trimming.
 */
function boundedText(value: unknown, max: number, unsafe: RegExp): string | null {
  if (typeof value !== 'string' || value.length > max * 4) return null;
  if (unsafe.test(value) || FORMAT_OR_SEPARATOR.test(value) || LONE_SURROGATE.test(value)) return null;
  const trimmed = value.trim();
  const length = Array.from(trimmed).length;
  return length >= 1 && length <= max ? trimmed : null;
}

/** `undefined` marks an invalid value; null stays null. */
function nullableText(value: unknown, max: number, unsafe: RegExp): string | null | undefined {
  if (value === null) return null;
  return boundedText(value, max, unsafe) ?? undefined;
}

function parseProductIds(value: unknown, unique: boolean): string[] | null {
  if (!Array.isArray(value) || value.length > CARE_CRM_MAX_PRODUCTS) return null;
  if (!value.every((id) => typeof id === 'string' && PRODUCT_ID_PATTERN.test(id))) return null;
  if (unique && new Set(value).size !== value.length) return null;
  return [...value] as string[];
}

// ---------------------------------------------------------------------------
// Renderer input (the IPC argument guard)
// ---------------------------------------------------------------------------

/**
 * `{ cursor }`: null for the first page, otherwise the opaque `nextCursor` main handed out. Care CRM S3: the first
 * page of "Làm mới" may add `retryIdentity: true` (and only `true`).
 */
export function parseCareCrmListInput(input: unknown): CustomerCareCrmListInput | null {
  if (hasOwn(input, 'retryIdentity')) {
    const retry = exactRecord(input, ['cursor', 'retryIdentity']);
    return retry && retry.cursor === null && retry.retryIdentity === true ? { cursor: null, retryIdentity: true } : null;
  }
  const record = exactRecord(input, ['cursor']);
  if (!record) return null;
  if (record.cursor === null) return { cursor: null };
  return isCareLeadsCursor(record.cursor) ? { cursor: record.cursor } : null;
}

/**
 * One full profile, checked against every contract rule: known values only, real calendar dates within two
 * years of `now`, bounded text without control characters (a note keeps line breaks), at most 8 unique
 * product ids, a lost reason only when lost and a purchase date only for a deposit or a delivery.
 */
export function parseCareCrmProfileInput(value: unknown, now: Date): CustomerCareCrmProfileInput | null {
  const profile = exactRecord(value, PROFILE_INPUT_KEYS);
  if (!profile) return null;
  const { stage, ownerUserId, addressForm, occasion, neededBy, nextStepDueAt, lostReason, purchasedAt } = profile;
  if (!oneOf(CUSTOMER_CARE_CRM_STAGES, stage) || !isUuidOrNull(ownerUserId)) return null;
  if (!nullableOneOf(CUSTOMER_CARE_CRM_ADDRESS_FORMS, addressForm)) return null;
  if (!nullableOneOf(CUSTOMER_CARE_CRM_OCCASIONS, occasion)) return null;
  if (!nullableOneOf(CUSTOMER_CARE_CRM_LOST_REASONS, lostReason)) return null;
  if (neededBy !== null && !(isCalendarDate(neededBy) && dayInWindow(neededBy, now))) return null;
  if (purchasedAt !== null && !(isCalendarDate(purchasedAt) && dayInWindow(purchasedAt, now))) return null;
  if (nextStepDueAt !== null && !(isRequestTimestamp(nextStepDueAt) && timeInWindow(nextStepDueAt, now))) return null;
  if (lostReason !== null && stage !== 'lost') return null;
  if (purchasedAt !== null && !PURCHASE_STAGES.includes(stage)) return null;
  const productFactIds = parseProductIds(profile.productFactIds, true);
  const nextStep = nullableText(profile.nextStep, CARE_CRM_MAX_NEXT_STEP, UNSAFE_LINE);
  const note = nullableText(profile.note, CARE_CRM_MAX_NOTE, UNSAFE_NOTE);
  if (!productFactIds || nextStep === undefined || note === undefined) return null;
  return {
    stage,
    ownerUserId,
    addressForm,
    occasion,
    neededBy: neededBy as string | null,
    productFactIds,
    nextStep,
    nextStepDueAt: nextStepDueAt as string | null,
    lostReason,
    purchasedAt: purchasedAt as string | null,
    note,
  };
}

/** `{ leadId, expectedUpdatedAt, profile }` only; the workspace always comes from main's live authority. */
export function parseCareCrmSaveInput(input: unknown, now: Date): CustomerCareCrmSaveInput | null {
  const record = exactRecord(input, ['leadId', 'expectedUpdatedAt', 'profile']);
  if (!record || !isCareFacebookChoiceId(record.leadId)) return null;
  // Echoed exactly as the server returned it; never re-formatted here.
  if (record.expectedUpdatedAt !== null && !isRequestTimestamp(record.expectedUpdatedAt)) return null;
  const profile = parseCareCrmProfileInput(record.profile, now);
  return profile ? { leadId: record.leadId, expectedUpdatedAt: record.expectedUpdatedAt, profile } : null;
}

// ---------------------------------------------------------------------------
// Route answers
// ---------------------------------------------------------------------------

/**
 * A stored profile. The server checked the cross-field and date-window rules when it was saved, so only the
 * shape is checked here; the renderer re-applies the stage rules before the next save.
 */
function parseCareCrmProfile(value: unknown): CustomerCareCrmProfile | null {
  // `detailsUnreadable` is the only optional key, and the server sends it only as `true`.
  const keys = [...PROFILE_INPUT_KEYS, 'updatedAt', 'updatedBy'];
  const flagged = typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, 'detailsUnreadable');
  const profile = exactRecord(value, flagged ? [...keys, 'detailsUnreadable'] : keys);
  if (!profile || (flagged && profile.detailsUnreadable !== true)) return null;
  const { stage, ownerUserId, addressForm, occasion, neededBy, nextStepDueAt, lostReason, purchasedAt } = profile;
  if (!oneOf(CUSTOMER_CARE_CRM_STAGES, stage) || !isUuidOrNull(ownerUserId)) return null;
  if (!nullableOneOf(CUSTOMER_CARE_CRM_ADDRESS_FORMS, addressForm)) return null;
  if (!nullableOneOf(CUSTOMER_CARE_CRM_OCCASIONS, occasion)) return null;
  if (!nullableOneOf(CUSTOMER_CARE_CRM_LOST_REASONS, lostReason)) return null;
  if (neededBy !== null && !isCalendarDate(neededBy)) return null;
  if (purchasedAt !== null && !isCalendarDate(purchasedAt)) return null;
  if (nextStepDueAt !== null && !isIso(nextStepDueAt)) return null;
  if (profile.updatedAt !== null && !isIso(profile.updatedAt)) return null;
  if (!isUuidOrNull(profile.updatedBy)) return null;
  const productFactIds = parseProductIds(profile.productFactIds, false);
  const nextStep = nullableText(profile.nextStep, CARE_CRM_MAX_NEXT_STEP, UNSAFE_LINE);
  const note = nullableText(profile.note, CARE_CRM_MAX_NOTE, UNSAFE_NOTE);
  if (!productFactIds || nextStep === undefined || note === undefined) return null;
  // Stored text is already trimmed; a value that changes when trimmed is not what the server stored.
  if ((nextStep !== null && nextStep !== profile.nextStep) || (note !== null && note !== profile.note)) return null;
  return {
    stage,
    ownerUserId,
    addressForm,
    occasion,
    neededBy: neededBy as string | null,
    productFactIds,
    nextStep,
    nextStepDueAt: nextStepDueAt as string | null,
    lostReason,
    purchasedAt: purchasedAt as string | null,
    note,
    updatedAt: profile.updatedAt as string | null,
    updatedBy: profile.updatedBy,
    ...(profile.detailsUnreadable === true ? { detailsUnreadable: true as const } : {}),
  };
}

function parseMessages(value: unknown): CustomerCareLeadMessage[] | null {
  if (!Array.isArray(value) || value.length > CARE_LEAD_MAX_MESSAGES) return null;
  const messages: CustomerCareLeadMessage[] = [];
  for (const raw of value as unknown[]) {
    const message = parseLeadMessage(raw);
    if (!message) return null;
    messages.push(message);
  }
  return messages;
}

const ROW_KEYS = [
  'leadId', 'pageId', 'customerName', 'phone', 'zaloMentioned', 'leadStatus',
  'phoneCapturedAt', 'lastMessageAt', 'recentMessages', 'profile',
];

function hasOwn(value: unknown, key: string): boolean {
  return typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, key);
}

/**
 * One CRM row, rebuilt from the exact contract fields. The phone must be a normalized Vietnamese mobile. The Care
 * CRM S3 `identity` key is optional and never fails the row: with `withIdentity` (the envelope carried a valid
 * `identityEnabled`) an identity that is missing or does not parse is dropped and the row marked
 * `identityUnavailable`; without it any identity is ignored.
 */
export function parseCareCrmRow(value: unknown, withIdentity = false): CustomerCareCrmRow | null {
  const row = exactRecord(value, hasOwn(value, 'identity') ? [...ROW_KEYS, 'identity'] : ROW_KEYS);
  if (!row || !isCareFacebookChoiceId(row.leadId) || !isCareFacebookPageId(row.pageId)) return null;
  if (typeof row.phone !== 'string' || !CARE_LEAD_PHONE_PATTERN.test(row.phone)) return null;
  if (typeof row.zaloMentioned !== 'boolean' || !isCareLeadStatus(row.leadStatus)) return null;
  if (!isIso(row.phoneCapturedAt) || !isIso(row.lastMessageAt)) return null;
  const customerName = parseCustomerName(row.customerName);
  const recentMessages = parseMessages(row.recentMessages);
  const profile = parseCareCrmProfile(row.profile);
  if (customerName === undefined || !recentMessages || !profile) return null;
  const identity = withIdentity && 'identity' in row ? parseCareCrmIdentity(row.identity) : null;
  return {
    leadId: row.leadId,
    pageId: row.pageId,
    customerName,
    phone: row.phone,
    zaloMentioned: row.zaloMentioned,
    leadStatus: row.leadStatus,
    phoneCapturedAt: row.phoneCapturedAt,
    lastMessageAt: row.lastMessageAt,
    recentMessages,
    profile,
    ...(identity ? { identity } : withIdentity ? { identityUnavailable: true as const } : {}),
  };
}

function parseAssignees(value: unknown): CustomerCareCrmAssignee[] | null {
  if (!Array.isArray(value) || value.length > CARE_CRM_MAX_ASSIGNEES) return null;
  const assignees: CustomerCareCrmAssignee[] = [];
  const seen = new Set<string>();
  for (const raw of value as unknown[]) {
    const assignee = exactRecord(raw, ['userId', 'label']);
    if (!assignee || !isCareFacebookChoiceId(assignee.userId) || seen.has(assignee.userId)) return null;
    // A label that could disguise text, or a blank one, is kept as "no label" rather than hiding the member.
    const label = parseCustomerName(assignee.label);
    if (label === undefined) return null;
    seen.add(assignee.userId);
    // The server never sends an email; anything that looks like one is not shown.
    assignees.push({ userId: assignee.userId, label: label !== null && label.includes('@') ? null : label });
  }
  return assignees;
}

function parsePageSources(value: unknown): CustomerCareCrmPageSource[] | null {
  if (!Array.isArray(value) || value.length > CARE_CRM_MAX_ASSIGNEES) return null;
  const pages: CustomerCareCrmPageSource[] = [];
  const seen = new Set<string>();
  for (const raw of value as unknown[]) {
    const item = exactRecord(raw, ['pageId', 'pageName']);
    if (!item || !isCareFacebookPageId(item.pageId) || seen.has(item.pageId)) return null;
    const pageName = parseCustomerName(item.pageName);
    if (pageName === undefined) return null;
    seen.add(item.pageId);
    pages.push({ pageId: item.pageId, pageName });
  }
  return pages;
}

const ENVELOPE_KEYS = ['success', 'workspaceId', 'role', 'canDelete', 'rows', 'nextCursor', 'assignees'];
/** Care CRM S3 + Multi-Page source keys: optional in the envelope. */
const OPTIONAL_ENVELOPE_KEYS = ['identityEnabled', 'consentAsk', 'pages'];

/**
 * `GET /crm` envelope for `workspaceId`; any extra field, a duplicate or one invalid row rejects the page. The Care
 * CRM S3 parts and `pages` (`include=identity,pages`) are optional: a server without S3 sends none of them; an unreadable
 * `identityEnabled` (or row identities without it) shows the table without identity (`identityUnavailable`); an
 * unreadable row identity drops only that identity; an unreadable `consentAsk` is null (asking stays off).
 */
export function parseCareCrmListBody(body: unknown, workspaceId: string): CareCrmPage | null {
  const envelope = exactRecord(body, [...ENVELOPE_KEYS, ...OPTIONAL_ENVELOPE_KEYS.filter((key) => hasOwn(body, key))]);
  if (!envelope || envelope.success !== true || envelope.workspaceId !== workspaceId) return null;
  if (!oneOf(CUSTOMER_CARE_CRM_ROLES, envelope.role) || typeof envelope.canDelete !== 'boolean') return null;
  if (envelope.nextCursor !== null && !isCareLeadsCursor(envelope.nextCursor)) return null;
  if (!Array.isArray(envelope.rows) || envelope.rows.length > CARE_CRM_PAGE_SIZE) return null;
  const withIdentity = typeof envelope.identityEnabled === 'boolean';
  const rows: CustomerCareCrmRow[] = [];
  const seen = new Set<string>();
  for (const raw of envelope.rows as unknown[]) {
    const row = parseCareCrmRow(raw, withIdentity);
    if (!row || seen.has(row.leadId)) return null;
    seen.add(row.leadId);
    rows.push(row);
  }
  const assignees = parseAssignees(envelope.assignees);
  if (!assignees) return null;
  const hasPages = 'pages' in envelope;
  const pages = hasPages ? parsePageSources(envelope.pages) : undefined;
  if (hasPages && !pages) return null;
  const unreadable = !withIdentity
    && ('identityEnabled' in envelope || (envelope.rows as unknown[]).some((raw) => hasOwn(raw, 'identity')));
  return {
    role: envelope.role,
    canDelete: envelope.canDelete,
    rows,
    nextCursor: envelope.nextCursor,
    assignees,
    ...(pages ? { pages } : {}),
    identityEnabled: withIdentity ? envelope.identityEnabled as boolean : null,
    identityUnavailable: unreadable,
    consentAsk: withIdentity ? parseCareCrmConsentAsk(envelope.consentAsk) : null,
  };
}

/**
 * The profile of a row in a save answer (200 or 409). After the database step the server may fail to present
 * the lead and answer with `phone: ""`, empty times and no messages, or leave presentation fields out. Only
 * this path is relaxed: the row may carry contract keys only, its lead must match and its profile is checked
 * strictly. The presentation fields are dropped unread; the screen keeps the ones it already shows.
 */
function parseSavedRowProfile(value: unknown, leadId: string): CustomerCareCrmProfile | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (!Object.keys(value).every((key) => ROW_KEYS.includes(key))) return null;
  const row = value as Record<string, unknown>;
  if (row.leadId !== leadId) return null;
  return parseCareCrmProfile(row.profile);
}

/** `POST /crm/profile` success envelope: the saved profile for exactly that workspace and lead. */
export function parseCareCrmSaveBody(body: unknown, workspaceId: string, leadId: string): CustomerCareCrmProfile | null {
  const envelope = exactRecord(body, ['success', 'workspaceId', 'row']);
  if (!envelope || envelope.success !== true || envelope.workspaceId !== workspaceId) return null;
  return parseSavedRowProfile(envelope.row, leadId);
}

/**
 * The 409 `profile_conflict` error envelope carries the current row. The shared error envelope is
 * `{ success:false, error, reason }`; `workspaceId` is accepted when present and must then match.
 */
export function parseCareCrmConflictBody(body: unknown, workspaceId: string, leadId: string): CustomerCareCrmProfile | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const allowed = ['success', 'error', 'reason', 'row', 'workspaceId'];
  if (!Object.keys(body).every((key) => allowed.includes(key))) return null;
  const envelope = body as Record<string, unknown>;
  if (envelope.success !== false || envelope.reason !== 'profile_conflict') return null;
  if ('workspaceId' in envelope && envelope.workspaceId !== workspaceId) return null;
  return parseSavedRowProfile(envelope.row, leadId);
}

/** A fresh copy of a profile for IPC. */
export function copyCareCrmProfile(profile: CustomerCareCrmProfile): CustomerCareCrmProfile {
  return { ...profile, productFactIds: [...profile.productFactIds] };
}

/** A fresh copy, so the object handed to IPC shares nothing with the client's parse result. */
export function copyCareCrmRow(row: CustomerCareCrmRow): CustomerCareCrmRow {
  return {
    ...row,
    recentMessages: row.recentMessages.map((message) => ({ ...message })),
    profile: copyCareCrmProfile(row.profile),
    ...(row.identity ? { identity: copyCareCrmIdentity(row.identity) } : {}),
  };
}
