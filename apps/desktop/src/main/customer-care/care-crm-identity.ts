/**
 * Care CRM S3, main side: the customer identity card (backend bae6259). Strict parsing of the identity block that
 * `GET /crm?include=identity` adds to each row, of the two identity routes' answers, and of the renderer's staff
 * actions (the IPC argument guard), plus the mapping of every identity error reason.
 *
 * The identity is kept in memory for display, like every CRM row: this module never persists, logs or reports it,
 * and nothing here writes graph nodes or SQLite. There is no gender, religion or health field anywhere.
 *
 * @module main/customer-care/care-crm-identity
 */
import { ISO_PATTERN } from '../marketing/native-marketing-client';
import {
  CUSTOMER_CARE_CRM_ADDRESS_FORMS,
  CUSTOMER_CARE_CRM_AGE_BANDS,
  CUSTOMER_CARE_CRM_BUDGET_BANDS,
  CUSTOMER_CARE_CRM_CONSENT_STATES,
  CUSTOMER_CARE_CRM_EVIDENCE_SOURCES,
  CUSTOMER_CARE_CRM_ID_CONFIDENCES,
  CUSTOMER_CARE_CRM_ID_KINDS,
  CUSTOMER_CARE_CRM_ID_SOURCES,
  CUSTOMER_CARE_CRM_ID_STATUSES,
  CUSTOMER_CARE_CRM_IDENTITY_ACTIONS,
  CUSTOMER_CARE_CRM_IDENTITY_FIELDS,
  CUSTOMER_CARE_CRM_OCCASIONS,
  CUSTOMER_CARE_CRM_PERSONAS,
  CUSTOMER_CARE_CRM_RECIPIENTS,
  CUSTOMER_CARE_CRM_TIMELINES,
  type CustomerCareCrmAgeBand,
  type CustomerCareCrmConsent,
  type CustomerCareCrmEvidence,
  type CustomerCareCrmIdField,
  type CustomerCareCrmIdentity,
  type CustomerCareCrmIdentityActionInput,
  type CustomerCareCrmIdentityField,
  type CustomerCareCrmIdentityRefreshInput,
  type CustomerCareCrmSharedLink,
} from '../../shared/customer-care-types';
import { careFacebookFailure, isCareFacebookChoiceId, type CareFacebookFailure } from './care-facebook-client';

/** The refresh runs the model synchronously for up to ~30 s on the server, so main waits longer than that. */
export const CARE_CRM_IDENTITY_REFRESH_TIMEOUT_MS = 45_000;
const MAX_EVIDENCE = 2;
const MAX_QUOTE = 80;
const MAX_PRODUCT_FACT_IDS = 6;
const MAX_SHARED_LINKS = 3;
const MAX_LINK_TITLE = 120;
const MAX_AD_TITLE = 300;
const MAX_SUMMARY = 200;
const MAX_RETRY_AFTER_SEC = 86_400;
const PRODUCT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
// The server's text rule for stored identity text: no control, format (bidi, zero-width) or separator character.
const UNSAFE_TEXT = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
// What the server accepts as `expectedVersion`: seconds required, at most 6 fractional digits, a zone.
const VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const FIELD_KEYS = ['value', 'confidence', 'kind', 'source', 'status', 'updatedAt', 'evidence'] as const;
const IDENTITY_KEYS = [
  'version', 'lastRunAt', 'consent', 'occasion', 'timeline', 'productFactIds', 'addressForm', 'ageBand', 'family',
  'interests', 'persona',
] as const;
const CONSENT_ACTIONS = ['ask_consent', 'withdraw_consent'] as const;
/** 422 reasons of the identity routes that the screen explains; any other 422 is a plain rejection. */
const IDENTITY_422_REASONS = [
  'lead_not_found', 'consent_required', 'outside_window', 'ask_limit', 'page_not_connected', 'permission_missing',
] as const;
const IDENTITY_502_UNAVAILABLE = ['ai_unavailable', 'provider_timeout', 'provider_unavailable'] as const;

/** A staff action either applied, or lost to a newer identity and carries the current one. */
export interface CareCrmIdentityOutcome {
  kind: 'applied' | 'conflict';
  leadId: string;
  identity: CustomerCareCrmIdentity;
}

/** A refresh ran (and changed the identity or not), or came too soon after the last one for this customer. */
export type CareCrmRefreshOutcome =
  | { kind: 'refreshed'; leadId: string; identity: CustomerCareCrmIdentity; outcome: 'updated' | 'no_change' }
  | { kind: 'too_soon'; leadId: string; retryAfterSec: number };

// ---------------------------------------------------------------------------
// Primitive checks (kept local: care-crm.ts imports this module)
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function plainRecord(value: unknown): Json | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null ? value as Json : null;
}

function exactRecord(value: unknown, keys: readonly string[]): Json | null {
  const record = plainRecord(value);
  if (!record) return null;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))) return null;
  return record;
}

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && ISO_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

/** Non-empty text of at most `max` characters (code points), already trimmed, without unsafe characters. */
function isSafeText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max * 2 && Array.from(value).length <= max
    && !UNSAFE_TEXT.test(value) && value.trim() === value;
}

function isDomain(value: unknown): value is string {
  return typeof value === 'string' && DOMAIN_PATTERN.test(value);
}

function reasonOf(body: unknown): string | undefined {
  const reason = plainRecord(body)?.reason;
  return typeof reason === 'string' && reason.length <= 64 ? reason : undefined;
}

// ---------------------------------------------------------------------------
// Field values: one check per field, each returning a fresh copy or null
// ---------------------------------------------------------------------------

type ValueCopy<T> = (value: unknown) => T | null;

const enumValue = <T extends string>(list: readonly T[]): ValueCopy<T> => (value) => (oneOf(list, value) ? value : null);

function productIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PRODUCT_FACT_IDS) return null;
  if (!value.every((id) => typeof id === 'string' && PRODUCT_ID_PATTERN.test(id)) || new Set(value).size !== value.length) return null;
  return [...value] as string[];
}

/** One band, or two adjacent ones, youngest first. */
function ageBands(value: unknown): CustomerCareCrmAgeBand[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) return null;
  if (!value.every((band) => oneOf(CUSTOMER_CARE_CRM_AGE_BANDS, band))) return null;
  const bands = value as CustomerCareCrmAgeBand[];
  if (bands.length === 2 && CUSTOMER_CARE_CRM_AGE_BANDS.indexOf(bands[1]) !== CUSTOMER_CARE_CRM_AGE_BANDS.indexOf(bands[0]) + 1) return null;
  return [...bands];
}

function familyValue(value: unknown): { recipient: (typeof CUSTOMER_CARE_CRM_RECIPIENTS)[number] } | null {
  const record = exactRecord(value, ['recipient']);
  return record && oneOf(CUSTOMER_CARE_CRM_RECIPIENTS, record.recipient) ? { recipient: record.recipient } : null;
}

function sharedLinkValue(value: unknown): CustomerCareCrmSharedLink | null {
  const record = exactRecord(value, ['title', 'domain']);
  if (!record || !isDomain(record.domain)) return null;
  if (record.title !== null && !isSafeText(record.title, MAX_LINK_TITLE)) return null;
  return { title: record.title, domain: record.domain };
}

const adTitleValue: ValueCopy<string> = (value) => (isSafeText(value, MAX_AD_TITLE) ? value : null);

/** The value check of each field a staff action names (the same rules as the server's `correct`). */
const ACTION_VALUES: { readonly [F in CustomerCareCrmIdentityField]: ValueCopy<unknown> } = {
  occasion: enumValue(CUSTOMER_CARE_CRM_OCCASIONS),
  timeline: enumValue(CUSTOMER_CARE_CRM_TIMELINES),
  productFactIds: productIds,
  addressForm: enumValue(CUSTOMER_CARE_CRM_ADDRESS_FORMS),
  ageBand: ageBands,
  family: familyValue,
  persona: enumValue(CUSTOMER_CARE_CRM_PERSONAS),
  budgetBand: enumValue(CUSTOMER_CARE_CRM_BUDGET_BANDS),
  sharedLink: sharedLinkValue,
};

// ---------------------------------------------------------------------------
// The identity block
// ---------------------------------------------------------------------------

function parseEvidence(value: unknown): CustomerCareCrmEvidence | null {
  const evidence = exactRecord(value, ['source', 'at', 'quote']);
  if (!evidence || !oneOf(CUSTOMER_CARE_CRM_EVIDENCE_SOURCES, evidence.source) || !isIso(evidence.at)) return null;
  if (evidence.quote !== null && !isSafeText(evidence.quote, MAX_QUOTE)) return null;
  return { source: evidence.source, at: evidence.at, quote: evidence.quote };
}

/** One IdField with its exact envelope; `extraKeys` are the persona's `summary`. */
function parseField<T>(value: unknown, copyValue: ValueCopy<T>, extraKeys: readonly string[] = []): CustomerCareCrmIdField<T> | null {
  const field = exactRecord(value, [...FIELD_KEYS, ...extraKeys]);
  if (!field) return null;
  const copied = copyValue(field.value);
  if (copied === null) return null;
  if (!oneOf(CUSTOMER_CARE_CRM_ID_CONFIDENCES, field.confidence) || !oneOf(CUSTOMER_CARE_CRM_ID_KINDS, field.kind)) return null;
  if (!oneOf(CUSTOMER_CARE_CRM_ID_SOURCES, field.source) || !oneOf(CUSTOMER_CARE_CRM_ID_STATUSES, field.status)) return null;
  if (!isIso(field.updatedAt) || !Array.isArray(field.evidence) || field.evidence.length > MAX_EVIDENCE) return null;
  const evidence: CustomerCareCrmEvidence[] = [];
  for (const raw of field.evidence as unknown[]) {
    const item = parseEvidence(raw);
    if (!item) return null;
    evidence.push(item);
  }
  return {
    value: copied,
    confidence: field.confidence,
    kind: field.kind,
    source: field.source,
    status: field.status,
    updatedAt: field.updatedAt,
    evidence,
  };
}

const INVALID = Symbol('invalid');

function nullableField<T>(value: unknown, copyValue: ValueCopy<T>): CustomerCareCrmIdField<T> | null | typeof INVALID {
  if (value === null) return null;
  return parseField(value, copyValue) ?? INVALID;
}

function parseConsent(value: unknown): CustomerCareCrmConsent | null {
  const consent = exactRecord(value, ['state', 'at', 'noMarketing', 'canAsk']);
  if (!consent || !oneOf(CUSTOMER_CARE_CRM_CONSENT_STATES, consent.state)) return null;
  if ((consent.at !== null && !isIso(consent.at)) || typeof consent.noMarketing !== 'boolean' || typeof consent.canAsk !== 'boolean') {
    return null;
  }
  return { state: consent.state, at: consent.at, noMarketing: consent.noMarketing, canAsk: consent.canAsk };
}

function parsePersona(value: unknown): CustomerCareCrmIdentity['persona'] | typeof INVALID {
  if (value === null) return null;
  const persona = parseField(value, enumValue(CUSTOMER_CARE_CRM_PERSONAS), ['summary']);
  const summary = plainRecord(value)?.summary;
  if (!persona || typeof summary !== 'string' || Array.from(summary).length > MAX_SUMMARY || UNSAFE_TEXT.test(summary)) return INVALID;
  return { ...persona, summary };
}

function parseInterests(value: unknown): CustomerCareCrmIdentity['interests'] | null {
  const interests = exactRecord(value, ['adTitle', 'sharedLinks', 'budgetBand']);
  if (!interests || !Array.isArray(interests.sharedLinks) || interests.sharedLinks.length > MAX_SHARED_LINKS) return null;
  const adTitle = nullableField(interests.adTitle, adTitleValue);
  const budgetBand = nullableField(interests.budgetBand, enumValue(CUSTOMER_CARE_CRM_BUDGET_BANDS));
  if (adTitle === INVALID || budgetBand === INVALID) return null;
  const sharedLinks: CustomerCareCrmIdField<CustomerCareCrmSharedLink>[] = [];
  for (const raw of interests.sharedLinks as unknown[]) {
    const link = parseField(raw, sharedLinkValue);
    if (!link) return null;
    sharedLinks.push(link);
  }
  return { adTitle, sharedLinks, budgetBand };
}

/** The identity of one row, rebuilt from the exact contract fields, or null when any part is outside it. */
export function parseCareCrmIdentity(value: unknown): CustomerCareCrmIdentity | null {
  const identity = exactRecord(value, IDENTITY_KEYS);
  if (!identity) return null;
  if ((identity.version !== null && !isIso(identity.version)) || (identity.lastRunAt !== null && !isIso(identity.lastRunAt))) return null;
  const consent = parseConsent(identity.consent);
  const interests = parseInterests(identity.interests);
  const persona = parsePersona(identity.persona);
  const occasion = nullableField(identity.occasion, enumValue(CUSTOMER_CARE_CRM_OCCASIONS));
  const timeline = nullableField(identity.timeline, enumValue(CUSTOMER_CARE_CRM_TIMELINES));
  const productFactIds = nullableField(identity.productFactIds, productIds);
  const addressForm = nullableField(identity.addressForm, enumValue(CUSTOMER_CARE_CRM_ADDRESS_FORMS));
  const ageBand = nullableField(identity.ageBand, ageBands);
  const family = nullableField(identity.family, familyValue);
  if (!consent || !interests || persona === INVALID || occasion === INVALID || timeline === INVALID) return null;
  if (productFactIds === INVALID || addressForm === INVALID || ageBand === INVALID || family === INVALID) return null;
  return {
    version: identity.version,
    lastRunAt: identity.lastRunAt,
    consent,
    occasion,
    timeline,
    productFactIds,
    addressForm,
    ageBand,
    family,
    interests,
    persona,
  };
}

function copyField<T>(field: CustomerCareCrmIdField<T>, copyValue: (value: T) => T): CustomerCareCrmIdField<T> {
  return { ...field, value: copyValue(field.value), evidence: field.evidence.map((item) => ({ ...item })) };
}

function copyNullable<T>(field: CustomerCareCrmIdField<T> | null, copyValue: (value: T) => T = (value) => value) {
  return field === null ? null : copyField(field, copyValue);
}

/** A fresh copy for IPC, sharing nothing with the parse result. */
export function copyCareCrmIdentity(identity: CustomerCareCrmIdentity): CustomerCareCrmIdentity {
  const interests = identity.interests;
  return {
    version: identity.version,
    lastRunAt: identity.lastRunAt,
    consent: identity.consent === null ? null : { ...identity.consent },
    occasion: copyNullable(identity.occasion),
    timeline: copyNullable(identity.timeline),
    productFactIds: copyNullable(identity.productFactIds, (ids) => [...ids]),
    addressForm: copyNullable(identity.addressForm),
    ageBand: copyNullable(identity.ageBand, (bands) => [...bands]),
    family: copyNullable(identity.family, (family) => ({ ...family })),
    interests: interests === null ? null : {
      adTitle: copyNullable(interests.adTitle),
      sharedLinks: interests.sharedLinks.map((link) => copyField(link, (value) => ({ ...value }))),
      budgetBand: copyNullable(interests.budgetBand),
    },
    persona: identity.persona === null ? null : { ...copyField(identity.persona, (value) => value), summary: identity.persona.summary },
  };
}

// ---------------------------------------------------------------------------
// Renderer input (the IPC argument guard)
// ---------------------------------------------------------------------------

function isVersion(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && VERSION_PATTERN.test(value) && Number.isFinite(Date.parse(value)));
}

/**
 * One staff action, with exactly the keys of its action: ask_consent / withdraw_consent `{ leadId, action }`;
 * confirm / reject `{ leadId, action, field, expectedVersion }`; correct adds `value` (checked against the field's
 * type); a shared link adds `index` (0–2). The version is passed on exactly as the server returned it.
 */
export function parseCareCrmIdentityActionInput(input: unknown): CustomerCareCrmIdentityActionInput | null {
  const record = plainRecord(input);
  if (!record || !isCareFacebookChoiceId(record.leadId) || !oneOf(CUSTOMER_CARE_CRM_IDENTITY_ACTIONS, record.action)) return null;
  const { leadId, action } = record;
  if (oneOf(CONSENT_ACTIONS, action)) return exactRecord(record, ['leadId', 'action']) ? { leadId, action } : null;
  if (!oneOf(CUSTOMER_CARE_CRM_IDENTITY_FIELDS, record.field)) return null;
  const field = record.field;
  const keys = ['leadId', 'action', 'field', 'expectedVersion'];
  if (action === 'correct') keys.push('value');
  if (field === 'sharedLink') keys.push('index');
  if (!exactRecord(record, keys) || !isVersion(record.expectedVersion)) return null;
  const parsed: CustomerCareCrmIdentityActionInput = { leadId, action, field, expectedVersion: record.expectedVersion };
  if (field === 'sharedLink') {
    if (!Number.isInteger(record.index) || (record.index as number) < 0 || (record.index as number) >= MAX_SHARED_LINKS) return null;
    parsed.index = record.index as number;
  }
  if (action === 'correct') {
    const value = ACTION_VALUES[field](record.value);
    if (value === null) return null;
    parsed.value = value;
  }
  return parsed;
}

/** `{ leadId }` only. */
export function parseCareCrmIdentityRefreshInput(input: unknown): CustomerCareCrmIdentityRefreshInput | null {
  const record = exactRecord(input, ['leadId']);
  return record && isCareFacebookChoiceId(record.leadId) ? { leadId: record.leadId } : null;
}

/** The `POST /crm/identity` body: the live workspace plus exactly the keys the server expects for the action. */
export function careCrmIdentityRequestBody(workspaceId: string, input: CustomerCareCrmIdentityActionInput): Json {
  const { leadId, action } = input;
  if (oneOf(CONSENT_ACTIONS, action)) return { workspaceId, leadId, action };
  const body: Json = { workspaceId, leadId, action, expectedVersion: input.expectedVersion ?? null, field: input.field };
  if (action === 'correct') body.value = input.value;
  if (input.field === 'sharedLink') body.index = input.index;
  return body;
}

// ---------------------------------------------------------------------------
// Route answers
// ---------------------------------------------------------------------------

/** `POST /crm/identity` 200: the identity after the action, for exactly that workspace and lead. */
export function parseCareCrmIdentityActionBody(body: unknown, workspaceId: string, leadId: string): CustomerCareCrmIdentity | null {
  const envelope = exactRecord(body, ['success', 'workspaceId', 'leadId', 'identity']);
  if (!envelope || envelope.success !== true || envelope.workspaceId !== workspaceId || envelope.leadId !== leadId) return null;
  return parseCareCrmIdentity(envelope.identity);
}

/**
 * The 409 `identity_conflict` envelope `{ success:false, error, reason, identity }` carries the current identity;
 * `workspaceId` and `leadId` are accepted when present and must then match.
 */
export function parseCareCrmIdentityConflictBody(body: unknown, workspaceId: string, leadId: string): CustomerCareCrmIdentity | null {
  const envelope = plainRecord(body);
  const allowed = ['success', 'error', 'reason', 'identity', 'workspaceId', 'leadId'];
  if (!envelope || !Object.keys(envelope).every((key) => allowed.includes(key))) return null;
  if (envelope.success !== false || envelope.reason !== 'identity_conflict') return null;
  if (('workspaceId' in envelope && envelope.workspaceId !== workspaceId) || ('leadId' in envelope && envelope.leadId !== leadId)) return null;
  return parseCareCrmIdentity(envelope.identity);
}

/** `POST /crm/identity/refresh` 200: the identity after the run and whether it changed. */
export function parseCareCrmIdentityRefreshBody(
  body: unknown,
  workspaceId: string,
  leadId: string,
): { identity: CustomerCareCrmIdentity; outcome: 'updated' | 'no_change' } | null {
  const envelope = exactRecord(body, ['success', 'workspaceId', 'leadId', 'identity', 'outcome']);
  if (!envelope || envelope.success !== true || envelope.workspaceId !== workspaceId || envelope.leadId !== leadId) return null;
  if (envelope.outcome !== 'updated' && envelope.outcome !== 'no_change') return null;
  const identity = parseCareCrmIdentity(envelope.identity);
  return identity ? { identity, outcome: envelope.outcome } : null;
}

/** A 429 `refresh_too_soon` answer's `retryAfterSec` (whole seconds), or null. */
export function parseCareCrmRefreshTooSoonBody(body: unknown): number | null {
  const envelope = exactRecord(body, ['success', 'error', 'reason', 'retryAfterSec']);
  if (!envelope || envelope.success !== false || envelope.reason !== 'refresh_too_soon') return null;
  const seconds = envelope.retryAfterSec;
  return Number.isInteger(seconds) && (seconds as number) >= 0 && (seconds as number) <= MAX_RETRY_AFTER_SEC ? seconds as number : null;
}

/**
 * A non-2xx identity answer, read by status and `reason` (the server's English `error` text is never used).
 * Passing problems (rate limit, the model or Facebook not answering) are `unavailable`; answers that will not
 * change by retrying at once are `rejected` with their reason. Anything else follows the shared Care mapping.
 */
export function careCrmIdentityFailure(status: number, body: unknown): CareFacebookFailure {
  const reason = reasonOf(body);
  if (status === 429) {
    return reason === 'daily_cap' ? { ok: false, error: 'rejected', reason } : { ok: false, error: 'unavailable', reason: 'rate_limited' };
  }
  if (status === 503 && reason === 'profile_ai_off') return { ok: false, error: 'rejected', reason };
  if (status === 502 && reason === 'provider_rejected') return { ok: false, error: 'rejected', reason };
  if (status === 502 && oneOf(IDENTITY_502_UNAVAILABLE, reason)) return { ok: false, error: 'unavailable', reason };
  if (status === 409 && reason === 'identity_running') return { ok: false, error: 'rejected', reason };
  if (status === 422 && oneOf(IDENTITY_422_REASONS, reason)) return { ok: false, error: 'rejected', reason };
  if (status === 422) return { ok: false, error: 'rejected' };
  return careFacebookFailure(status, body);
}
