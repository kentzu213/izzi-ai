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
  CUSTOMER_CARE_CRM_CARE_STEPS,
  CUSTOMER_CARE_CRM_LOST_REASONS,
  CUSTOMER_CARE_CRM_OCCASIONS,
  CUSTOMER_CARE_CRM_ROLES,
  CUSTOMER_CARE_CRM_SALER_COLORS,
  CUSTOMER_CARE_CRM_SALER_ROUTING_MODES,
  CUSTOMER_CARE_CRM_STAGES,
  type CustomerCareCrmAssignee,
  type CustomerCareCrmBulkAssignInput,
  type CustomerCareCrmBulkAssignUpdatedItem,
  type CustomerCareCrmBulkAssignmentItem,
  type CustomerCareCrmCareStep,
  type CustomerCareCrmConsentAsk,
  type CustomerCareCrmIdentityActionInput,
  type CustomerCareCrmListInput,
  type CustomerCareCrmPageSource,
  type CustomerCareCrmProfile,
  type CustomerCareCrmProfileInput,
  type CustomerCareCrmRole,
  type CustomerCareCrmRow,
  type CustomerCareCrmSalerMember,
  type CustomerCareCrmSalerRoutingConfig,
  type CustomerCareCrmSaveInput,
  type CustomerCareCrmStage,
  type CustomerCareCrmTeamSaveInput,
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
export const CARE_CRM_REQUEST_PAGE_SIZE = 100;
export const CARE_CRM_MAX_PAGE_SIZE = 100;
export const CARE_CRM_MAX_PRODUCTS = 8;
export const CARE_CRM_MAX_NEXT_STEP = 200;
export const CARE_CRM_MAX_NOTE = 1_000;
export const CARE_CRM_MAX_ASSIGNEES = 200;
export const CARE_CRM_MAX_SALERS = 50;
export const CARE_CRM_MAX_SALER_NAME = 40;
export const CARE_CRM_MAX_SALER_PAGES = 50;
export const CARE_CRM_BULK_ASSIGN_CHUNK = 500;
export const CARE_CRM_MAX_BULK_ASSIGN = 5_000;
export const CARE_CRM_MAX_CALL_TRIES = 9;
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const SALER_ID_PATTERN = /^[a-z0-9_-]{2,36}$/;
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
const PROFILE_INPUT_KEYS_11 = [
  'stage', 'ownerUserId', 'addressForm', 'occasion', 'neededBy', 'productFactIds',
  'nextStep', 'nextStepDueAt', 'lostReason', 'purchasedAt', 'note',
] as const;
const PROFILE_SALER_KEYS = ['salerId', 'careStep', 'callTries'] as const;
const PROFILE_INPUT_KEYS_14 = [...PROFILE_INPUT_KEYS_11, ...PROFILE_SALER_KEYS] as const;
const PURCHASE_STAGES: readonly CustomerCareCrmStage[] = ['deposit', 'delivered'];

/** One page of CRM rows, newest phone first, with the people a row may be assigned to and optional source Pages. */
export interface CareCrmPage {
  role: CustomerCareCrmRole;
  canDelete: boolean;
  rows: CustomerCareCrmRow[];
  nextCursor: string | null;
  assignees: CustomerCareCrmAssignee[];
  pages?: CustomerCareCrmPageSource[];
  salers?: CustomerCareCrmSalerMember[];
  salerRouting?: CustomerCareCrmSalerRoutingConfig;
  salerTeamRevision?: number;
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

export type CareCrmTeamSaveOutcome =
  | { kind: 'saved'; revision: number; salers: CustomerCareCrmSalerMember[]; routing: CustomerCareCrmSalerRoutingConfig }
  | { kind: 'conflict'; revision?: number; salers?: CustomerCareCrmSalerMember[]; routing?: CustomerCareCrmSalerRoutingConfig };

export interface CareCrmBulkAssignOutcome {
  assignedCount: number;
  conflictCount: number;
  skippedCount: number;
  updated: CustomerCareCrmBulkAssignUpdatedItem[];
}

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
  saveTeam?(workspaceId: string, input: CustomerCareCrmTeamSaveInput): Promise<CareFacebookResult<CareCrmTeamSaveOutcome>>;
  bulkAssign?(workspaceId: string, input: CustomerCareCrmBulkAssignInput): Promise<CareFacebookResult<CareCrmBulkAssignOutcome>>;
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

function isSalerId(value: unknown): value is string {
  return typeof value === 'string' && SALER_ID_PATTERN.test(value);
}

function isSalerIdOrNull(value: unknown): value is string | null {
  return value === null || isSalerId(value);
}

function isCallTries(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= CARE_CRM_MAX_CALL_TRIES;
}

function isNonNegInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * One full profile, checked against every contract rule: known values only, real calendar dates within two
 * years of `now`, bounded text without control characters (a note keeps line breaks), at most 8 unique
 * product ids, a lost reason only when lost and a purchase date only for a deposit or a delivery.
 * Accepts both the 11-key legacy shape and the 14-key shape with `salerId`, `careStep`, `callTries`.
 */
export function parseCareCrmProfileInput(value: unknown, now: Date): CustomerCareCrmProfileInput | null {
  const hasSalerFields = PROFILE_SALER_KEYS.some((key) => hasOwn(value, key));
  const profile = exactRecord(value, hasSalerFields ? PROFILE_INPUT_KEYS_14 : PROFILE_INPUT_KEYS_11);
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
  if (hasSalerFields) {
    if (!isSalerIdOrNull(profile.salerId)) return null;
    if (!nullableOneOf(CUSTOMER_CARE_CRM_CARE_STEPS, profile.careStep)) return null;
    if (!isCallTries(profile.callTries)) return null;
  }
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
    ...(hasSalerFields
      ? {
        salerId: profile.salerId as string | null,
        careStep: profile.careStep as CustomerCareCrmCareStep | null,
        callTries: profile.callTries as number,
      }
      : {}),
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

function parseSalerMember(raw: unknown): CustomerCareCrmSalerMember | null {
  const item = exactRecord(raw, ['id', 'name', 'color', 'active', 'assignedPageIds', 'memberUserId']);
  if (!item || !isSalerId(item.id)) return null;
  const name = boundedText(item.name, CARE_CRM_MAX_SALER_NAME, UNSAFE_LINE);
  if (!name) return null;
  if (!oneOf(CUSTOMER_CARE_CRM_SALER_COLORS, item.color)) return null;
  if (typeof item.active !== 'boolean') return null;
  if (!Array.isArray(item.assignedPageIds) || item.assignedPageIds.length > CARE_CRM_MAX_SALER_PAGES) return null;
  const pageIds: string[] = [];
  const seenPages = new Set<string>();
  for (const pid of item.assignedPageIds as unknown[]) {
    if (!isCareFacebookPageId(pid) || seenPages.has(pid)) return null;
    seenPages.add(pid);
    pageIds.push(pid);
  }
  if (!isUuidOrNull(item.memberUserId)) return null;
  return {
    id: item.id,
    name,
    color: item.color,
    active: item.active,
    assignedPageIds: pageIds,
    memberUserId: item.memberUserId,
  };
}

function parseSalers(value: unknown): CustomerCareCrmSalerMember[] | null {
  if (!Array.isArray(value) || value.length > CARE_CRM_MAX_SALERS) return null;
  const salers: CustomerCareCrmSalerMember[] = [];
  const seen = new Set<string>();
  for (const raw of value as unknown[]) {
    const member = parseSalerMember(raw);
    if (!member || seen.has(member.id)) return null;
    seen.add(member.id);
    salers.push(member);
  }
  return salers;
}

function parseSalerRouting(value: unknown): CustomerCareCrmSalerRoutingConfig | null {
  const record = exactRecord(value, ['mode', 'protectZaloAndWon']);
  if (!record) return null;
  if (!oneOf(CUSTOMER_CARE_CRM_SALER_ROUTING_MODES, record.mode)) return null;
  if (typeof record.protectZaloAndWon !== 'boolean') return null;
  return { mode: record.mode, protectZaloAndWon: record.protectZaloAndWon };
}

/** IPC argument guard for `POST /crm/team`: `{ expectedRevision, salers, routing }`. */
export function parseCareCrmTeamSaveInput(input: unknown): CustomerCareCrmTeamSaveInput | null {
  const record = exactRecord(input, ['expectedRevision', 'salers', 'routing']);
  if (!record || !isNonNegInt(record.expectedRevision)) return null;
  const salers = parseSalers(record.salers);
  const routing = parseSalerRouting(record.routing);
  if (!salers || !routing) return null;
  return { expectedRevision: record.expectedRevision, salers, routing };
}

/** IPC argument guard for `POST /crm/bulk-assign`: `{ assignments: [{ leadId, expectedUpdatedAt, salerId, ownerUserId }] }`. */
export function parseCareCrmBulkAssignInput(input: unknown): CustomerCareCrmBulkAssignInput | null {
  const record = exactRecord(input, ['assignments']);
  if (!record || !Array.isArray(record.assignments)) return null;
  if (record.assignments.length < 1 || record.assignments.length > CARE_CRM_MAX_BULK_ASSIGN) return null;
  const assignments: CustomerCareCrmBulkAssignmentItem[] = [];
  const seenLeads = new Set<string>();
  for (const raw of record.assignments as unknown[]) {
    const item = exactRecord(raw, ['leadId', 'expectedUpdatedAt', 'salerId', 'ownerUserId']);
    if (!item || !isCareFacebookChoiceId(item.leadId) || seenLeads.has(item.leadId)) return null;
    if (item.expectedUpdatedAt !== null && !isRequestTimestamp(item.expectedUpdatedAt)) return null;
    if (!isSalerIdOrNull(item.salerId) || !isUuidOrNull(item.ownerUserId)) return null;
    seenLeads.add(item.leadId);
    assignments.push({
      leadId: item.leadId,
      expectedUpdatedAt: item.expectedUpdatedAt,
      salerId: item.salerId,
      ownerUserId: item.ownerUserId,
    });
  }
  return { assignments };
}

// ---------------------------------------------------------------------------
// Route answers
// ---------------------------------------------------------------------------

/**
 * A stored profile. Accepts both the 13-key legacy shape and the 16-key shape carrying
 * `salerId`, `careStep`, `callTries` (defaulting missing saler fields to `null, null, 0`).
 */
function parseCareCrmProfile(value: unknown): CustomerCareCrmProfile | null {
  // `detailsUnreadable` is the only optional flag key, and the server sends it only as `true`.
  const hasSalerFields = PROFILE_SALER_KEYS.some((key) => hasOwn(value, key));
  const baseKeys = [...(hasSalerFields ? PROFILE_INPUT_KEYS_14 : PROFILE_INPUT_KEYS_11), 'updatedAt', 'updatedBy'];
  const flagged = typeof value === 'object' && value !== null && Object.prototype.hasOwnProperty.call(value, 'detailsUnreadable');
  const profile = exactRecord(value, flagged ? [...baseKeys, 'detailsUnreadable'] : baseKeys);
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
  if (hasSalerFields) {
    if (!isSalerIdOrNull(profile.salerId)) return null;
    if (!nullableOneOf(CUSTOMER_CARE_CRM_CARE_STEPS, profile.careStep)) return null;
    if (!isCallTries(profile.callTries)) return null;
  }
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
    salerId: hasSalerFields ? (profile.salerId as string | null) : null,
    careStep: hasSalerFields ? (profile.careStep as CustomerCareCrmCareStep | null) : null,
    callTries: hasSalerFields ? (profile.callTries as number) : 0,
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
/** Care CRM S3 + Multi-Page + Saler team keys: optional in the envelope. */
const OPTIONAL_ENVELOPE_KEYS = ['identityEnabled', 'consentAsk', 'pages', 'salers', 'salerRouting', 'salerTeamRevision'];

/**
 * `GET /crm` envelope for `workspaceId`; any extra field, a duplicate or one invalid row rejects the page. The Care
 * CRM S3 parts, `pages`, and `salers`/`salerRouting`/`salerTeamRevision` are optional.
 */
export function parseCareCrmListBody(body: unknown, workspaceId: string): CareCrmPage | null {
  const envelope = exactRecord(body, [...ENVELOPE_KEYS, ...OPTIONAL_ENVELOPE_KEYS.filter((key) => hasOwn(body, key))]);
  if (!envelope || envelope.success !== true || envelope.workspaceId !== workspaceId) return null;
  if (!oneOf(CUSTOMER_CARE_CRM_ROLES, envelope.role) || typeof envelope.canDelete !== 'boolean') return null;
  if (envelope.nextCursor !== null && !isCareLeadsCursor(envelope.nextCursor)) return null;
  if (!Array.isArray(envelope.rows) || envelope.rows.length > CARE_CRM_MAX_PAGE_SIZE) return null;
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
  const hasSalers = 'salers' in envelope;
  const salers = hasSalers ? parseSalers(envelope.salers) : undefined;
  if (hasSalers && !salers) return null;
  const hasRouting = 'salerRouting' in envelope;
  const salerRouting = hasRouting ? parseSalerRouting(envelope.salerRouting) : undefined;
  if (hasRouting && !salerRouting) return null;
  const hasRevision = 'salerTeamRevision' in envelope;
  const salerTeamRevision = hasRevision ? (isNonNegInt(envelope.salerTeamRevision) ? envelope.salerTeamRevision : null) : undefined;
  if (hasRevision && salerTeamRevision === null) return null;
  const unreadable = !withIdentity
    && ('identityEnabled' in envelope || (envelope.rows as unknown[]).some((raw) => hasOwn(raw, 'identity')));
  return {
    role: envelope.role,
    canDelete: envelope.canDelete,
    rows,
    nextCursor: envelope.nextCursor,
    assignees,
    ...(pages ? { pages } : {}),
    ...(salers ? { salers } : {}),
    ...(salerRouting ? { salerRouting } : {}),
    ...(salerTeamRevision !== undefined && salerTeamRevision !== null ? { salerTeamRevision } : {}),
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

/** `POST /crm/team` 200 success envelope: exact 5 keys `{ success, workspaceId, revision, salers, routing }`. */
export function parseCareCrmTeamSaveBody(
  body: unknown,
  workspaceId: string,
): { revision: number; salers: CustomerCareCrmSalerMember[]; routing: CustomerCareCrmSalerRoutingConfig } | null {
  const envelope = exactRecord(body, ['success', 'workspaceId', 'revision', 'salers', 'routing']);
  if (!envelope || envelope.success !== true || envelope.workspaceId !== workspaceId) return null;
  if (!isNonNegInt(envelope.revision)) return null;
  const salers = parseSalers(envelope.salers);
  const routing = parseSalerRouting(envelope.routing);
  if (!salers || !routing) return null;
  return { revision: envelope.revision, salers, routing };
}

/** `POST /crm/team` 409 `team_conflict` envelope: carries optional current `revision`, `salers`, `routing`. */
export function parseCareCrmTeamConflictBody(
  body: unknown,
  workspaceId: string,
): { revision?: number; salers?: CustomerCareCrmSalerMember[]; routing?: CustomerCareCrmSalerRoutingConfig } | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const allowed = ['success', 'error', 'reason', 'workspaceId', 'revision', 'salers', 'routing'];
  if (!Object.keys(body).every((key) => allowed.includes(key))) return null;
  const envelope = body as Record<string, unknown>;
  if (envelope.success !== false || envelope.reason !== 'team_conflict') return null;
  if ('workspaceId' in envelope && envelope.workspaceId !== workspaceId) return null;
  const revision = 'revision' in envelope ? (isNonNegInt(envelope.revision) ? envelope.revision : null) : undefined;
  if ('revision' in envelope && revision === null) return null;
  const salers = 'salers' in envelope ? parseSalers(envelope.salers) : undefined;
  if ('salers' in envelope && !salers) return null;
  const routing = 'routing' in envelope ? parseSalerRouting(envelope.routing) : undefined;
  if ('routing' in envelope && !routing) return null;
  return {
    ...(revision !== undefined && revision !== null ? { revision } : {}),
    ...(salers ? { salers } : {}),
    ...(routing ? { routing } : {}),
  };
}

/** `POST /crm/bulk-assign` 200 success envelope: exact 6 keys. */
export function parseCareCrmBulkAssignBody(body: unknown, workspaceId: string): CareCrmBulkAssignOutcome | null {
  const envelope = exactRecord(body, ['success', 'workspaceId', 'assignedCount', 'conflictCount', 'skippedCount', 'updated']);
  if (!envelope || envelope.success !== true || envelope.workspaceId !== workspaceId) return null;
  if (!isNonNegInt(envelope.assignedCount) || !isNonNegInt(envelope.conflictCount) || !isNonNegInt(envelope.skippedCount)) {
    return null;
  }
  if (!Array.isArray(envelope.updated) || envelope.updated.length > CARE_CRM_BULK_ASSIGN_CHUNK) return null;
  const updated: CustomerCareCrmBulkAssignUpdatedItem[] = [];
  const seen = new Set<string>();
  for (const raw of envelope.updated as unknown[]) {
    const item = exactRecord(raw, ['leadId', 'salerId', 'ownerUserId', 'careStep', 'updatedAt', 'updatedBy']);
    if (!item || !isCareFacebookChoiceId(item.leadId) || seen.has(item.leadId)) return null;
    if (!isSalerIdOrNull(item.salerId) || !isUuidOrNull(item.ownerUserId)) return null;
    if (!nullableOneOf(CUSTOMER_CARE_CRM_CARE_STEPS, item.careStep)) return null;
    if (!isIso(item.updatedAt) || !isUuidOrNull(item.updatedBy)) return null;
    seen.add(item.leadId);
    updated.push({
      leadId: item.leadId,
      salerId: item.salerId,
      ownerUserId: item.ownerUserId,
      careStep: item.careStep,
      updatedAt: item.updatedAt,
      updatedBy: item.updatedBy,
    });
  }
  return {
    assignedCount: envelope.assignedCount,
    conflictCount: envelope.conflictCount,
    skippedCount: envelope.skippedCount,
    updated,
  };
}

/** A fresh copy of a Saler member for IPC. */
export function copyCareCrmSaler(saler: CustomerCareCrmSalerMember): CustomerCareCrmSalerMember {
  return { ...saler, assignedPageIds: [...saler.assignedPageIds] };
}

/** A fresh copy of a Saler routing config for IPC. */
export function copyCareCrmSalerRouting(routing: CustomerCareCrmSalerRoutingConfig): CustomerCareCrmSalerRoutingConfig {
  return { ...routing };
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
