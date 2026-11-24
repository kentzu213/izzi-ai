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
  type CustomerCareCrmListInput,
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

export const CARE_CRM_PAGE_SIZE = 50;
export const CARE_CRM_MAX_PRODUCTS = 8;
export const CARE_CRM_MAX_NEXT_STEP = 200;
export const CARE_CRM_MAX_NOTE = 1_000;
export const CARE_CRM_MAX_ASSIGNEES = 200;
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_WINDOW_YEARS = 2;
// Control characters and bidi overrides; a note keeps only its line breaks.
const UNSAFE_LINE = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/;
const UNSAFE_NOTE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/;
const PROFILE_INPUT_KEYS = [
  'stage', 'ownerUserId', 'addressForm', 'occasion', 'neededBy', 'productFactIds',
  'nextStep', 'nextStepDueAt', 'lostReason', 'purchasedAt', 'note',
] as const;
const PURCHASE_STAGES: readonly CustomerCareCrmStage[] = ['deposit', 'delivered'];

/** One page of CRM rows, newest phone first, with the people a row may be assigned to. */
export interface CareCrmPage {
  role: CustomerCareCrmRole;
  canDelete: boolean;
  rows: CustomerCareCrmRow[];
  nextCursor: string | null;
  assignees: CustomerCareCrmAssignee[];
}

/** A save either stored the profile, or lost to a newer save and carries the current row. */
export type CareCrmSaveOutcome =
  | { kind: 'saved'; row: CustomerCareCrmRow }
  | { kind: 'conflict'; row: CustomerCareCrmRow };

/** The two CRM routes `CustomerCareService` depends on; tests substitute an in-memory fake. */
export interface CareCrmGateway {
  listCrm(workspaceId: string, cursor: string | null): Promise<CareFacebookResult<CareCrmPage>>;
  saveCrmProfile(workspaceId: string, input: CustomerCareCrmSaveInput): Promise<CareFacebookResult<CareCrmSaveOutcome>>;
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

/** Trimmed text within `max`, or null when the value is not acceptable. */
function boundedText(value: unknown, max: number, unsafe: RegExp): string | null {
  if (typeof value !== 'string' || value.length > max * 4) return null;
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > max || unsafe.test(trimmed)) return null;
  return trimmed;
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

/** `{ cursor }`: null for the first page, otherwise the opaque `nextCursor` main handed out. */
export function parseCareCrmListInput(input: unknown): CustomerCareCrmListInput | null {
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
  if (nextStepDueAt !== null && !(isIso(nextStepDueAt) && timeInWindow(nextStepDueAt, now))) return null;
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
  if (record.expectedUpdatedAt !== null && !isIso(record.expectedUpdatedAt)) return null;
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
  const profile = exactRecord(value, [...PROFILE_INPUT_KEYS, 'updatedAt', 'updatedBy']);
  if (!profile) return null;
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

/** One CRM row, rebuilt from the exact contract fields. The phone must be a normalized Vietnamese mobile. */
export function parseCareCrmRow(value: unknown): CustomerCareCrmRow | null {
  const row = exactRecord(value, [
    'leadId', 'pageId', 'customerName', 'phone', 'zaloMentioned', 'leadStatus',
    'phoneCapturedAt', 'lastMessageAt', 'recentMessages', 'profile',
  ]);
  if (!row || !isCareFacebookChoiceId(row.leadId) || !isCareFacebookPageId(row.pageId)) return null;
  if (typeof row.phone !== 'string' || !CARE_LEAD_PHONE_PATTERN.test(row.phone)) return null;
  if (typeof row.zaloMentioned !== 'boolean' || !isCareLeadStatus(row.leadStatus)) return null;
  if (!isIso(row.phoneCapturedAt) || !isIso(row.lastMessageAt)) return null;
  const customerName = parseCustomerName(row.customerName);
  const recentMessages = parseMessages(row.recentMessages);
  const profile = parseCareCrmProfile(row.profile);
  if (customerName === undefined || !recentMessages || !profile) return null;
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
    assignees.push({ userId: assignee.userId, label });
  }
  return assignees;
}

/** `GET /crm` envelope for `workspaceId`; any extra field, a duplicate or one invalid row rejects the page. */
export function parseCareCrmListBody(body: unknown, workspaceId: string): CareCrmPage | null {
  const envelope = exactRecord(body, ['success', 'workspaceId', 'role', 'canDelete', 'rows', 'nextCursor', 'assignees']);
  if (!envelope || envelope.success !== true || envelope.workspaceId !== workspaceId) return null;
  if (!oneOf(CUSTOMER_CARE_CRM_ROLES, envelope.role) || typeof envelope.canDelete !== 'boolean') return null;
  if (envelope.nextCursor !== null && !isCareLeadsCursor(envelope.nextCursor)) return null;
  if (!Array.isArray(envelope.rows) || envelope.rows.length > CARE_CRM_PAGE_SIZE) return null;
  const rows: CustomerCareCrmRow[] = [];
  const seen = new Set<string>();
  for (const raw of envelope.rows as unknown[]) {
    const row = parseCareCrmRow(raw);
    if (!row || seen.has(row.leadId)) return null;
    seen.add(row.leadId);
    rows.push(row);
  }
  const assignees = parseAssignees(envelope.assignees);
  if (!assignees) return null;
  return { role: envelope.role, canDelete: envelope.canDelete, rows, nextCursor: envelope.nextCursor, assignees };
}

/** `POST /crm/profile` success envelope: the saved row for exactly that workspace and lead. */
export function parseCareCrmSaveBody(body: unknown, workspaceId: string, leadId: string): CustomerCareCrmRow | null {
  const envelope = exactRecord(body, ['success', 'workspaceId', 'row']);
  if (!envelope || envelope.success !== true || envelope.workspaceId !== workspaceId) return null;
  const row = parseCareCrmRow(envelope.row);
  return row && row.leadId === leadId ? row : null;
}

/**
 * The 409 `profile_conflict` error envelope carries the current row. The shared error envelope is
 * `{ success:false, error, reason }`; `workspaceId` is accepted when present and must then match.
 */
export function parseCareCrmConflictBody(body: unknown, workspaceId: string, leadId: string): CustomerCareCrmRow | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const allowed = ['success', 'error', 'reason', 'row', 'workspaceId'];
  if (!Object.keys(body).every((key) => allowed.includes(key))) return null;
  const envelope = body as Record<string, unknown>;
  if (envelope.success !== false || envelope.reason !== 'profile_conflict') return null;
  if ('workspaceId' in envelope && envelope.workspaceId !== workspaceId) return null;
  const row = parseCareCrmRow(envelope.row);
  return row && row.leadId === leadId ? row : null;
}

/** A fresh copy, so the object handed to IPC shares nothing with the client's parse result. */
export function copyCareCrmRow(row: CustomerCareCrmRow): CustomerCareCrmRow {
  return {
    ...row,
    recentMessages: row.recentMessages.map((message) => ({ ...message })),
    profile: { ...row.profile, productFactIds: [...row.profile.productFactIds] },
  };
}
