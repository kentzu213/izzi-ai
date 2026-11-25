/**
 * Care Facebook Page client over IzziAPI `/api/marketing/care/facebook/*`.
 *
 * Mirrors `NativeMarketingClient`: the Supabase access token is read inside main and referenced only in
 * the Authorization header; the origin comes from `resolveNativeMarketingBaseUrl` (reviewed https only).
 * Every response is rebuilt from an exact allowlist, so provider tokens or unexpected fields can never
 * reach the service, IPC or renderer. Failures are bounded codes; server error text is never forwarded.
 *
 * @module main/customer-care/care-facebook-client
 */
import {
  ISO_PATTERN,
  OAUTH_CODE_PATTERN,
  OAUTH_STATE_PATTERN,
  UUID_PATTERN,
  resolveNativeMarketingBaseUrl,
  type NativeMarketingClientOptions,
  type NativeMarketingTokenProvider,
} from '../marketing/native-marketing-client';
import {
  CUSTOMER_CARE_AUTO_REPLY_PROBLEMS,
  CUSTOMER_CARE_BACKFILL_JOB_STATUSES,
  CUSTOMER_CARE_BACKFILL_SKIP_REASONS,
  CUSTOMER_CARE_FACEBOOK_REJECT_REASONS,
  CUSTOMER_CARE_LEAD_STATUSES,
  type CustomerCareAutoReplyProblem,
  type CustomerCareAutoReplyState,
  type CustomerCareBackfillJobSnapshot,
  type CustomerCareBackfillJobStatus,
  type CustomerCareBackfillSkipReason,
  type CustomerCareBackfillSkippedPage,
  type CustomerCareBackfillSummary,
  type CustomerCareCrmSyncedPage,
  type CustomerCareFactTopic,
  type CustomerCareFacebookPageChoice,
  type CustomerCareFacebookRejectReason,
  type CustomerCareInboxState,
  type CustomerCareLead,
  type CustomerCareLeadMessage,
  type CustomerCareLeadStatus,
  type CustomerCareSyncRecentSummary,
} from '../../shared/customer-care-types';

export const CARE_FACEBOOK_ROOT = '/api/marketing/care/facebook';
// Same bound as the backend: merchants often manage dozens of Pages across
// their own account and Business portfolios.
export const CARE_FACEBOOK_MAX_PAGES = 100;
// The callback exchanges the code twice and reads every Graph page of the
// merchant's Pages (up to 100) before answering, so it gets a longer budget.
export const CARE_FACEBOOK_CALLBACK_TIMEOUT_MS = 30_000;
export const CARE_FACEBOOK_PAGE_ID_PATTERN = /^[0-9]{5,30}$/;
const SCOPE_PATTERN = /^[a-z_]{3,64}$/;
const MAX_SCOPES = 32;
const MAX_PAGE_NAME = 200;
const MAX_AUTHORIZE_URL = 4_096;
const FACEBOOK_DIALOG_PATH = /^\/(?:v\d{1,3}\.\d{1,2}\/)?dialog\/oauth\/?$/;
const UNSAFE_TEXT_PATTERN = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const CHOICE_REASONS: readonly CustomerCareFacebookPageChoice['reason'][] = [
  'eligible',
  'missing_moderate_task',
  'missing_page_token',
  'missing_messaging_scope',
];
// Phase B1 bounds, from the backend contract.
export const CARE_LEADS_PAGE_SIZE = 50;
export const CARE_LEAD_MAX_MESSAGES = 3;
export const CARE_LEAD_MAX_MESSAGE_LENGTH = 500;
export const CARE_LEAD_PHONE_PATTERN = /^0[35789]\d{8}$/;
/** Opaque pagination cursor: printable ASCII without spaces, bounded. */
export const CARE_LEADS_CURSOR_PATTERN = /^[\x21-\x7e]{1,512}$/;
// Customer-written text keeps tabs and line breaks; other control characters and bidi overrides
// are replaced, so one crafted message can neither disguise text nor hide every other lead.
const UNSAFE_CUSTOMER_TEXT = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202A-\u202E\u2066-\u2069]/g;
const REPLACEMENT_CHARACTER = '\uFFFD';

export type CareFacebookClientError =
  | 'unsupported'
  | 'auth'
  | 'forbidden'
  | 'unavailable'
  | 'not_configured'
  | 'rejected'
  | 'page_bound_elsewhere'
  | 'no_pages'
  | 'invalid-response';

export type CareFacebookFailure = {
  ok: false;
  error: CareFacebookClientError;
  reason?: CustomerCareFacebookRejectReason;
};

export type CareFacebookResult<T> = { ok: true; value: T } | CareFacebookFailure;

export interface CareFacebookConnection {
  pageId: string;
  pageName: string | null;
  status: 'active' | 'needs_reauth';
  grantedScopes: string[];
  missingScopes: string[];
  verifiedAt: string;
  tokenExpiresAt: string | null;
}

export interface CareFacebookConnectStart {
  success: true;
  workspaceId: string;
  state: string;
  expiresAt: string;
  authorizeUrl: string;
}

export interface CareFacebookCallbackResult {
  success: true;
  workspaceId: string;
  choiceId: string;
  expiresAt: string;
  grantedScopes: string[];
  missingScopes: string[];
  pages: CustomerCareFacebookPageChoice[];
}

export interface CareFacebookStatus {
  success: true;
  workspaceId: string;
  requiredScopes: string[];
  connection: CareFacebookConnection | null;
  crmPages?: CustomerCareCrmSyncedPage[];
}

/** One page of leads, newest `phoneCapturedAt` first. */
export interface CareLeadPage {
  leads: CustomerCareLead[];
  nextCursor: string | null;
}

export interface CareFacebookSelectOptions {
  backfillPageIds?: string[];
  importOnly?: boolean;
}

export interface CareFacebookSelectWithBackfill {
  connection: CareFacebookConnection | null;
  backfill: CustomerCareBackfillSummary;
  crmPages?: CustomerCareCrmSyncedPage[];
  backfillJob?: CustomerCareBackfillJobSnapshot;
}

export type CareFacebookBackfillResult = CustomerCareBackfillSummary & {
  crmPages?: CustomerCareCrmSyncedPage[];
  backfillJob?: CustomerCareBackfillJobSnapshot;
};

/** The surface `CustomerCareService` depends on; tests substitute an in-memory fake. */
export type CareFacebookGateway = Pick<
  CareFacebookClient,
  'startConnect' | 'completeCallback' | 'selectPage' | 'getStatus' | 'disconnect'
> & Partial<Pick<CareFacebookClient, 'backfillBoundPage' | 'getBackfillStatus'>>;

/** What the backend deleted for one customer (B1b). */
export interface CareLeadPurge {
  leadId: string;
  deletedMessages: number;
}

export type CareSyncRecentOutcome =
  | { kind: 'synced'; summary: CustomerCareSyncRecentSummary }
  | { kind: 'too_soon'; retryAfterSec: number };

/** Phase B1 inbox and lead routes, plus the B1b customer purge; nothing is ever sent to a customer. */
export type CareLeadsGateway = Pick<
  CareFacebookClient,
  'getInbox' | 'setInbox' | 'listLeads' | 'setLeadStatus' | 'purgeLead'
> & Partial<Pick<CareFacebookClient, 'syncRecentLeads'>>;

/** One approved fact as the server answers with it (Phase C). Only `text` ever reaches a customer. */
export interface CareAutoReplyScriptFact {
  id: string;
  topic: CustomerCareFactTopic;
  text: string;
  approvedAt: string;
  expiresAt: string | null;
}

export interface CareAutoReplyScript {
  facts: CareAutoReplyScriptFact[];
}

/** Phase C automatic reply routes: the server sends; this app only switches and uploads approved facts. */
export type CareAutoReplyGateway = Pick<CareFacebookClient, 'getAutoReply' | 'setAutoReply'>;

type RequestOutcome =
  | { ok: true; body: unknown }
  | CareFacebookFailure;

const INVALID_REQUEST: CareFacebookFailure = { ok: false, error: 'rejected', reason: 'invalid_request' };
const INVALID_RESPONSE: CareFacebookFailure = { ok: false, error: 'invalid-response' };

// ---------------------------------------------------------------------------
// Pure parsing helpers
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

function isIso(value: unknown): value is string {
  return typeof value === 'string' && ISO_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

export function isCareFacebookPageId(value: unknown): value is string {
  return typeof value === 'string' && CARE_FACEBOOK_PAGE_ID_PATTERN.test(value);
}

export function isCareFacebookChoiceId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function parseScopes(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_SCOPES) return null;
  return value.every((scope) => typeof scope === 'string' && SCOPE_PATTERN.test(scope)) ? [...value] as string[] : null;
}

/** A display name, or null when absent/blank. Undefined signals an invalid value. */
function parseName(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > MAX_PAGE_NAME || UNSAFE_TEXT_PATTERN.test(value)) return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function parseSuccessEnvelope(
  body: unknown,
  keys: readonly string[],
  workspaceId: string,
): Record<string, unknown> | null {
  const envelope = exactRecord(body, ['success', 'workspaceId', ...keys]);
  if (!envelope || envelope.success !== true || envelope.workspaceId !== workspaceId) return null;
  return envelope;
}

function parseAuthorizeUrl(value: unknown, state: string): string | null {
  if (typeof value !== 'string' || value.length > MAX_AUTHORIZE_URL) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'www.facebook.com'
    || url.port !== ''
    || url.username
    || url.password
    || url.hash
    || !FACEBOOK_DIALOG_PATH.test(url.pathname)
    || url.searchParams.get('state') !== state
    || url.searchParams.has('client_secret')
    || url.searchParams.has('clientSecret')
  ) return null;
  return value;
}

function parsePageChoice(value: unknown): CustomerCareFacebookPageChoice | null {
  const page = exactRecord(value, ['pageId', 'name', 'eligible', 'reason']);
  if (!page || !isCareFacebookPageId(page.pageId) || typeof page.eligible !== 'boolean') return null;
  const reason = page.reason;
  if (typeof reason !== 'string' || !(CHOICE_REASONS as readonly string[]).includes(reason)) return null;
  if (page.eligible !== (reason === 'eligible')) return null;
  const name = parseName(page.name);
  if (name === undefined) return null;
  return { pageId: page.pageId, name, eligible: page.eligible, reason: reason as CustomerCareFacebookPageChoice['reason'] };
}

function parsePageChoices(value: unknown): CustomerCareFacebookPageChoice[] | null {
  if (!Array.isArray(value) || value.length > CARE_FACEBOOK_MAX_PAGES) return null;
  const pages: CustomerCareFacebookPageChoice[] = [];
  const seen = new Set<string>();
  for (const raw of value as unknown[]) {
    const page = parsePageChoice(raw);
    if (!page || seen.has(page.pageId)) return null;
    seen.add(page.pageId);
    pages.push(page);
  }
  return pages;
}

export function parseCareFacebookConnection(value: unknown): CareFacebookConnection | null {
  const connection = exactRecord(value, [
    'pageId', 'pageName', 'status', 'grantedScopes', 'missingScopes', 'verifiedAt', 'tokenExpiresAt',
  ]);
  if (!connection || !isCareFacebookPageId(connection.pageId)) return null;
  if (connection.status !== 'active' && connection.status !== 'needs_reauth') return null;
  const pageName = parseName(connection.pageName);
  const grantedScopes = parseScopes(connection.grantedScopes);
  const missingScopes = parseScopes(connection.missingScopes);
  if (pageName === undefined || !grantedScopes || !missingScopes || !isIso(connection.verifiedAt)) return null;
  if (connection.tokenExpiresAt !== null && !isIso(connection.tokenExpiresAt)) return null;
  return {
    pageId: connection.pageId,
    pageName,
    status: connection.status,
    grantedScopes,
    missingScopes,
    verifiedAt: connection.verifiedAt,
    tokenExpiresAt: connection.tokenExpiresAt,
  };
}

export function isCareLeadsCursor(value: unknown): value is string {
  return typeof value === 'string' && CARE_LEADS_CURSOR_PATTERN.test(value);
}

export function isCareLeadStatus(value: unknown): value is CustomerCareLeadStatus {
  return typeof value === 'string' && (CUSTOMER_CARE_LEAD_STATUSES as readonly string[]).includes(value);
}

function isIsoOrNull(value: unknown): value is string | null {
  return value === null || isIso(value);
}

export function parseCareInboxState(value: unknown): CustomerCareInboxState | null {
  const inbox = exactRecord(value, ['enabled', 'subscribedAt', 'lastEventAt']);
  if (!inbox || typeof inbox.enabled !== 'boolean') return null;
  if (!isIsoOrNull(inbox.subscribedAt) || !isIsoOrNull(inbox.lastEventAt)) return null;
  return { enabled: inbox.enabled, subscribedAt: inbox.subscribedAt, lastEventAt: inbox.lastEventAt };
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export const CARE_FACEBOOK_MAX_BACKFILL_PAGES = 10;

export function parseBackfillPageIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > CARE_FACEBOOK_MAX_BACKFILL_PAGES) return null;
  if (!value.every((pageId) => isCareFacebookPageId(pageId))) return null;
  if (new Set(value).size !== value.length) return null;
  return [...value] as string[];
}

function hasOwn(value: unknown, key: string): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, key);
}

export function parseCrmSyncedPages(value: unknown): CustomerCareCrmSyncedPage[] | null {
  if (!Array.isArray(value) || value.length > CARE_FACEBOOK_MAX_PAGES) return null;
  const pages: CustomerCareCrmSyncedPage[] = [];
  const seen = new Set<string>();
  for (const raw of value as unknown[]) {
    const item = exactRecord(raw, ['pageId', 'pageName', 'verifiedAt']);
    if (!item || !isCareFacebookPageId(item.pageId) || seen.has(item.pageId) || !isIso(item.verifiedAt)) {
      return null;
    }
    const pageName = parseName(item.pageName);
    if (pageName === undefined) return null;
    seen.add(item.pageId);
    pages.push({ pageId: item.pageId, pageName, verifiedAt: item.verifiedAt });
  }
  return pages;
}

function parseSkippedPages(value: unknown): CustomerCareBackfillSkippedPage[] | null {
  if (!Array.isArray(value) || value.length > CARE_FACEBOOK_MAX_PAGES) return null;
  const skipped: CustomerCareBackfillSkippedPage[] = [];
  const seen = new Set<string>();
  for (const raw of value as unknown[]) {
    const item = exactRecord(raw, ['pageId', 'pageName', 'reason']);
    if (!item || !isCareFacebookPageId(item.pageId) || seen.has(item.pageId)) return null;
    if (
      typeof item.reason !== 'string'
      || !(CUSTOMER_CARE_BACKFILL_SKIP_REASONS as readonly string[]).includes(item.reason)
    ) {
      return null;
    }
    const pageName = parseName(item.pageName);
    if (pageName === undefined) return null;
    seen.add(item.pageId);
    skipped.push({
      pageId: item.pageId,
      pageName,
      reason: item.reason as CustomerCareBackfillSkipReason,
    });
  }
  return skipped;
}

export function parseCareBackfillSummary(value: unknown): CustomerCareBackfillSummary | null {
  const baseKeys = ['pagesProcessed', 'conversationsScanned', 'leadsImported', 'messagesStored', 'namesSealed'] as const;
  const withSkipped = hasOwn(value, 'skippedPages');
  const summary = exactRecord(value, withSkipped ? [...baseKeys, 'skippedPages'] : baseKeys);
  if (
    !summary
    || !isCount(summary.pagesProcessed)
    || !isCount(summary.conversationsScanned)
    || !isCount(summary.leadsImported)
    || !isCount(summary.messagesStored)
    || !isCount(summary.namesSealed)
  ) return null;
  const skippedPages = withSkipped ? parseSkippedPages(summary.skippedPages) : undefined;
  if (withSkipped && !skippedPages) return null;
  return {
    pagesProcessed: summary.pagesProcessed,
    conversationsScanned: summary.conversationsScanned,
    leadsImported: summary.leadsImported,
    messagesStored: summary.messagesStored,
    namesSealed: summary.namesSealed,
    ...(skippedPages ? { skippedPages } : {}),
  };
}

const BACKFILL_JOB_KEYS = [
  'status',
  'startedAt',
  'updatedAt',
  'completedAt',
  'pagesTotal',
  'pagesProcessed',
  'conversationsScanned',
  'leadsImported',
  'messagesStored',
  'namesSealed',
  'skippedPages',
] as const;

export function parseCareBackfillJobSnapshot(value: unknown): CustomerCareBackfillJobSnapshot | null {
  const job = exactRecord(value, BACKFILL_JOB_KEYS);
  if (!job) return null;
  if (
    typeof job.status !== 'string'
    || !(CUSTOMER_CARE_BACKFILL_JOB_STATUSES as readonly string[]).includes(job.status)
  ) {
    return null;
  }
  if (!isIsoOrNull(job.startedAt) || !isIsoOrNull(job.updatedAt) || !isIsoOrNull(job.completedAt)) {
    return null;
  }
  if (
    !isCount(job.pagesTotal)
    || !isCount(job.pagesProcessed)
    || !isCount(job.conversationsScanned)
    || !isCount(job.leadsImported)
    || !isCount(job.messagesStored)
    || !isCount(job.namesSealed)
  ) {
    return null;
  }
  const skippedPages = parseSkippedPages(job.skippedPages);
  if (!skippedPages) return null;
  return {
    status: job.status as CustomerCareBackfillJobStatus,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    pagesTotal: job.pagesTotal,
    pagesProcessed: job.pagesProcessed,
    conversationsScanned: job.conversationsScanned,
    leadsImported: job.leadsImported,
    messagesStored: job.messagesStored,
    namesSealed: job.namesSealed,
    skippedPages,
  };
}

function parseCallbackBody(body: unknown, workspaceId: string): CareFacebookCallbackResult | null {
  const hasWorkspace = hasOwn(body, 'workspaceId');
  const hasGrantedScopes = hasOwn(body, 'grantedScopes');
  const expectedKeys = [
    'success',
    ...(hasWorkspace ? ['workspaceId'] : []),
    'choiceId',
    'expiresAt',
    ...(hasGrantedScopes ? ['grantedScopes'] : []),
    'missingScopes',
    'pages',
  ];
  const envelope = exactRecord(body, expectedKeys);
  if (!envelope || envelope.success !== true) return null;
  if (hasWorkspace && envelope.workspaceId !== workspaceId) return null;
  if (!isCareFacebookChoiceId(envelope.choiceId) || !isIso(envelope.expiresAt)) return null;
  const grantedScopes = hasGrantedScopes ? parseScopes(envelope.grantedScopes) : [];
  const missingScopes = parseScopes(envelope.missingScopes);
  const pages = parsePageChoices(envelope.pages);
  if (!grantedScopes || !missingScopes || !pages) return null;
  return {
    success: true,
    workspaceId,
    choiceId: envelope.choiceId,
    expiresAt: envelope.expiresAt,
    grantedScopes,
    missingScopes,
    pages,
  };
}

function parseStatusBody(body: unknown, workspaceId: string, allowCrmPages = true): CareFacebookStatus | null {
  const withCrmPages = allowCrmPages && hasOwn(body, 'crmPages');
  const envelope = parseSuccessEnvelope(
    body,
    withCrmPages ? ['requiredScopes', 'connection', 'crmPages'] : ['requiredScopes', 'connection'],
    workspaceId,
  );
  if (!envelope) return null;
  const requiredScopes = parseScopes(envelope.requiredScopes);
  const connection = envelope.connection === null ? null : parseCareFacebookConnection(envelope.connection);
  if (!requiredScopes || (envelope.connection !== null && !connection)) return null;
  const crmPages = withCrmPages ? parseCrmSyncedPages(envelope.crmPages) : [];
  if (!crmPages) return null;
  return { success: true, workspaceId, requiredScopes, connection, crmPages };
}

/** Phase C state, rebuilt from an exact allowlist; an unknown problem code is kept as `unknown`. */
export function parseCareAutoReplyState(value: unknown): CustomerCareAutoReplyState | null {
  const state = exactRecord(value, [
    'enabled', 'enabledAt', 'available', 'scriptUpdatedAt', 'factCount',
    'sentLast24h', 'lastSentAt', 'stoppedLast24h', 'lastProblem',
  ]);
  if (!state || typeof state.enabled !== 'boolean' || typeof state.available !== 'boolean') return null;
  if (!isIsoOrNull(state.enabledAt) || !isIsoOrNull(state.scriptUpdatedAt) || !isIsoOrNull(state.lastSentAt)) return null;
  if (!isCount(state.factCount) || !isCount(state.sentLast24h) || !isCount(state.stoppedLast24h)) return null;
  let lastProblem: CustomerCareAutoReplyState['lastProblem'] = null;
  if (state.lastProblem !== null) {
    const problem = exactRecord(state.lastProblem, ['reason', 'at']);
    if (!problem || typeof problem.reason !== 'string' || !isIso(problem.at)) return null;
    const reason = (CUSTOMER_CARE_AUTO_REPLY_PROBLEMS as readonly string[]).includes(problem.reason)
      ? problem.reason as CustomerCareAutoReplyProblem
      : 'unknown';
    lastProblem = { reason, at: problem.at };
  }
  return {
    enabled: state.enabled,
    enabledAt: state.enabledAt,
    available: state.available,
    scriptUpdatedAt: state.scriptUpdatedAt,
    factCount: state.factCount,
    sentLast24h: state.sentLast24h,
    lastSentAt: state.lastSentAt,
    stoppedLast24h: state.stoppedLast24h,
    lastProblem,
  };
}

/** Facebook's display name; a name that could disguise text degrades to "no name" instead of hiding the lead. */
export function parseCustomerName(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return parseName(value) ?? null;
}

export function parseLeadMessage(value: unknown): CustomerCareLeadMessage | null {
  const message = exactRecord(value, ['text', 'at']);
  if (!message || typeof message.text !== 'string' || !isIso(message.at)) return null;
  // Counted in code points: an emoji-heavy 500-character message is still within the contract.
  if (Array.from(message.text).length > CARE_LEAD_MAX_MESSAGE_LENGTH) return null;
  return { text: message.text.replace(UNSAFE_CUSTOMER_TEXT, REPLACEMENT_CHARACTER), at: message.at };
}

/** One lead, rebuilt from the exact contract fields. The phone must be a normalized Vietnamese mobile. */
export function parseCareLead(value: unknown): CustomerCareLead | null {
  const lead = exactRecord(value, [
    'id', 'pageId', 'customerName', 'phone', 'zaloMentioned', 'status',
    'phoneCapturedAt', 'lastMessageAt', 'statusChangedAt', 'recentMessages',
  ]);
  if (!lead || !isCareFacebookChoiceId(lead.id) || !isCareFacebookPageId(lead.pageId)) return null;
  if (typeof lead.phone !== 'string' || !CARE_LEAD_PHONE_PATTERN.test(lead.phone)) return null;
  if (typeof lead.zaloMentioned !== 'boolean' || !isCareLeadStatus(lead.status)) return null;
  if (!isIso(lead.phoneCapturedAt) || !isIso(lead.lastMessageAt) || !isIsoOrNull(lead.statusChangedAt)) return null;
  const customerName = parseCustomerName(lead.customerName);
  if (customerName === undefined) return null;
  if (!Array.isArray(lead.recentMessages) || lead.recentMessages.length > CARE_LEAD_MAX_MESSAGES) return null;
  const recentMessages: CustomerCareLeadMessage[] = [];
  for (const raw of lead.recentMessages as unknown[]) {
    const message = parseLeadMessage(raw);
    if (!message) return null;
    recentMessages.push(message);
  }
  return {
    id: lead.id,
    pageId: lead.pageId,
    customerName,
    phone: lead.phone,
    zaloMentioned: lead.zaloMentioned,
    status: lead.status,
    phoneCapturedAt: lead.phoneCapturedAt,
    lastMessageAt: lead.lastMessageAt,
    statusChangedAt: lead.statusChangedAt,
    recentMessages,
  };
}

function parseCareLeadPage(leadsValue: unknown, cursorValue: unknown): CareLeadPage | null {
  if (!Array.isArray(leadsValue) || leadsValue.length > CARE_LEADS_PAGE_SIZE) return null;
  if (cursorValue !== null && !isCareLeadsCursor(cursorValue)) return null;
  const leads: CustomerCareLead[] = [];
  const seen = new Set<string>();
  for (const raw of leadsValue as unknown[]) {
    const lead = parseCareLead(raw);
    if (!lead || seen.has(lead.id)) return null;
    seen.add(lead.id);
    leads.push(lead);
  }
  return { leads, nextCursor: cursorValue };
}

function rejectReason(body: unknown): CustomerCareFacebookRejectReason | string | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const reason = (body as Record<string, unknown>).reason;
  return typeof reason === 'string' && reason.length <= 64 ? reason : undefined;
}

/** Map a non-2xx status plus the envelope's `reason` to a bounded failure. Pure. */
export function careFacebookFailure(status: number, body: unknown): CareFacebookFailure {
  const reason = rejectReason(body);
  if (status === 404) return { ok: false, error: 'unsupported' };
  if (status === 401) return { ok: false, error: 'auth' };
  if (status === 403) return { ok: false, error: 'forbidden' };
  if (status === 503 && (reason === 'not_configured' || reason === 'redirect_relay_incompatible')) {
    return { ok: false, error: 'not_configured' };
  }
  if (status === 502 && (reason === 'token_invalid' || reason === 'token_app_mismatch' || reason === 'token_page_mismatch')) {
    return { ok: false, error: 'rejected', reason };
  }
  // Facebook refused the grant: a retry later will not help, so this is not reported as unavailable.
  if (status === 502 && reason === 'provider_rejected') return { ok: false, error: 'rejected' };
  if (status >= 500 || status === 429) return { ok: false, error: 'unavailable' };
  if (status === 409 && reason === 'page_bound_elsewhere') return { ok: false, error: 'page_bound_elsewhere' };
  if (status === 422 && reason === 'no_pages') return { ok: false, error: 'no_pages' };
  if (reason && (CUSTOMER_CARE_FACEBOOK_REJECT_REASONS as readonly string[]).includes(reason)) {
    return { ok: false, error: 'rejected', reason: reason as CustomerCareFacebookRejectReason };
  }
  return { ok: false, error: 'rejected' };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class CareFacebookClient {
  private readonly baseUrl: string | null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly auth: NativeMarketingTokenProvider,
    options: NativeMarketingClientOptions = {},
  ) {
    this.baseUrl = resolveNativeMarketingBaseUrl(options.baseUrl, options.allowLoopback);
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** POST /connect — mint a Care OAuth state and the Facebook dialog URL. */
  async startConnect(workspaceId: string): Promise<CareFacebookResult<CareFacebookConnectStart>> {
    if (!isCareFacebookChoiceId(workspaceId)) return INVALID_REQUEST;
    const result = await this.request('connect', '/connect', { method: 'POST', body: JSON.stringify({ workspaceId }) });
    if (!result.ok) return result;
    const envelope = parseSuccessEnvelope(result.body, ['state', 'expiresAt', 'authorizeUrl'], workspaceId);
    if (!envelope || typeof envelope.state !== 'string' || !OAUTH_STATE_PATTERN.test(envelope.state)) {
      return INVALID_RESPONSE;
    }
    const authorizeUrl = parseAuthorizeUrl(envelope.authorizeUrl, envelope.state);
    if (!authorizeUrl || !isIso(envelope.expiresAt)) return INVALID_RESPONSE;
    return {
      ok: true,
      value: { success: true, workspaceId, state: envelope.state, expiresAt: envelope.expiresAt, authorizeUrl },
    };
  }

  /** POST /callback — exchange the provider code; returns the Page choices (never tokens). */
  async completeCallback(
    workspaceId: string,
    state: string,
    code: string,
  ): Promise<CareFacebookResult<CareFacebookCallbackResult>> {
    if (!isCareFacebookChoiceId(workspaceId) || !OAUTH_STATE_PATTERN.test(state) || !OAUTH_CODE_PATTERN.test(code)) {
      return INVALID_REQUEST;
    }
    const result = await this.request(
      'callback',
      '/callback',
      { method: 'POST', body: JSON.stringify({ workspaceId, code, state, clientVersion: 2 }) },
      Math.max(this.timeoutMs, CARE_FACEBOOK_CALLBACK_TIMEOUT_MS),
    );
    if (!result.ok) return result;
    const parsed = parseCallbackBody(result.body, workspaceId);
    return parsed ? { ok: true, value: parsed } : INVALID_RESPONSE;
  }

  /** POST /select — bind the chosen Page (and/or backfill multi-Page history into CRM) after backend verification. */
  async selectPage(
    workspaceId: string,
    choiceId: string,
    pageId: string,
  ): Promise<CareFacebookResult<CareFacebookConnection>>;
  async selectPage(
    workspaceId: string,
    choiceId: string,
    pageId: string,
    options?: CareFacebookSelectOptions,
  ): Promise<CareFacebookResult<CareFacebookConnection | CareFacebookSelectWithBackfill>>;
  async selectPage(
    workspaceId: string,
    choiceId: string,
    pageId: string,
    options?: CareFacebookSelectOptions,
  ): Promise<CareFacebookResult<CareFacebookConnection | CareFacebookSelectWithBackfill>> {
    if (!isCareFacebookChoiceId(workspaceId) || !isCareFacebookChoiceId(choiceId) || !isCareFacebookPageId(pageId)) {
      return INVALID_REQUEST;
    }
    if (options?.importOnly !== undefined && typeof options.importOnly !== 'boolean') return INVALID_REQUEST;
    const hasBackfillIds = options?.backfillPageIds !== undefined;
    const backfillPageIds = hasBackfillIds ? parseBackfillPageIds(options.backfillPageIds) : undefined;
    if (hasBackfillIds && !backfillPageIds) return INVALID_REQUEST;
    const importOnly = options?.importOnly === true;

    if (!hasBackfillIds && !importOnly) {
      const result = await this.request('select', '/select', {
        method: 'POST',
        body: JSON.stringify({ workspaceId, choiceId, pageId }),
      });
      if (!result.ok) return result;
      const envelope = parseSuccessEnvelope(result.body, ['connection'], workspaceId);
      const connection = envelope ? parseCareFacebookConnection(envelope.connection) : null;
      return connection && connection.pageId === pageId ? { ok: true, value: connection } : INVALID_RESPONSE;
    }

    const basePayload = {
      workspaceId,
      choiceId,
      pageId,
      ...(backfillPageIds ? { backfillPageIds } : {}),
      ...(importOnly ? { importOnly: true } : {}),
      includeCrmPages: true,
    };
    const backfillTimeoutMs = Math.max(this.timeoutMs, CARE_FACEBOOK_CALLBACK_TIMEOUT_MS);
    let result = await this.request(
      'select',
      '/select',
      {
        method: 'POST',
        body: JSON.stringify({ ...basePayload, async: true }),
      },
      backfillTimeoutMs,
    );
    if (!result.ok && result.error === 'rejected' && result.reason === 'invalid_request') {
      result = await this.request(
        'select',
        '/select',
        { method: 'POST', body: JSON.stringify(basePayload) },
        backfillTimeoutMs,
      );
    }
    if (!result.ok) return result;
    const withCrmPages = hasOwn(result.body, 'crmPages');
    const withBackfillJob = hasOwn(result.body, 'backfillJob');
    const envelopeKeys = [
      'connection',
      'backfill',
      ...(withCrmPages ? ['crmPages'] : []),
      ...(withBackfillJob ? ['backfillJob'] : []),
    ];
    const envelope = parseSuccessEnvelope(result.body, envelopeKeys, workspaceId);
    if (!envelope) return INVALID_RESPONSE;
    const backfill = parseCareBackfillSummary(envelope.backfill);
    if (!backfill) return INVALID_RESPONSE;
    const crmPages = withCrmPages ? parseCrmSyncedPages(envelope.crmPages) : undefined;
    if (withCrmPages && !crmPages) return INVALID_RESPONSE;
    const backfillJob = withBackfillJob ? parseCareBackfillJobSnapshot(envelope.backfillJob) : undefined;
    if (withBackfillJob && !backfillJob) return INVALID_RESPONSE;
    if (importOnly) {
      const connection = envelope.connection === null ? null : parseCareFacebookConnection(envelope.connection);
      if (envelope.connection !== null && !connection) return INVALID_RESPONSE;
      return {
        ok: true,
        value: {
          connection,
          backfill,
          ...(crmPages ? { crmPages } : {}),
          ...(backfillJob ? { backfillJob } : {}),
        },
      };
    }
    const connection = parseCareFacebookConnection(envelope.connection);
    return connection && connection.pageId === pageId
      ? {
        ok: true,
        value: {
          connection,
          backfill,
          ...(crmPages ? { crmPages } : {}),
          ...(backfillJob ? { backfillJob } : {}),
        },
      }
      : INVALID_RESPONSE;
  }

  /** POST /backfill — scan 90-day Messenger history of the workspace's bound & CRM Pages into CRM. */
  async backfillBoundPage(workspaceId: string): Promise<CareFacebookResult<CareFacebookBackfillResult>> {
    if (!isCareFacebookChoiceId(workspaceId)) return INVALID_REQUEST;
    const backfillTimeoutMs = Math.max(this.timeoutMs, CARE_FACEBOOK_CALLBACK_TIMEOUT_MS);
    let result = await this.request(
      'backfill',
      '/backfill',
      { method: 'POST', body: JSON.stringify({ workspaceId, includeCrmPages: true, async: true }) },
      backfillTimeoutMs,
    );
    if (!result.ok && result.error === 'rejected' && result.reason === 'invalid_request') {
      result = await this.request(
        'backfill',
        '/backfill',
        { method: 'POST', body: JSON.stringify({ workspaceId, includeCrmPages: true }) },
        backfillTimeoutMs,
      );
    }
    if (!result.ok) return result;
    const withCrmPages = hasOwn(result.body, 'crmPages');
    const withBackfillJob = hasOwn(result.body, 'backfillJob');
    const envelopeKeys = [
      'backfill',
      ...(withCrmPages ? ['crmPages'] : []),
      ...(withBackfillJob ? ['backfillJob'] : []),
    ];
    const envelope = parseSuccessEnvelope(result.body, envelopeKeys, workspaceId);
    if (!envelope) return INVALID_RESPONSE;
    const backfill = parseCareBackfillSummary(envelope.backfill);
    if (!backfill) return INVALID_RESPONSE;
    const crmPages = withCrmPages ? parseCrmSyncedPages(envelope.crmPages) : undefined;
    if (withCrmPages && !crmPages) return INVALID_RESPONSE;
    const backfillJob = withBackfillJob ? parseCareBackfillJobSnapshot(envelope.backfillJob) : undefined;
    if (withBackfillJob && !backfillJob) return INVALID_RESPONSE;
    return {
      ok: true,
      value: {
        ...backfill,
        ...(crmPages ? { crmPages } : {}),
        ...(backfillJob ? { backfillJob } : {}),
      },
    };
  }

  /** GET /backfill — poll the workspace's async 90-day Messenger backfill job status (exact 3-key envelope). */
  async getBackfillStatus(workspaceId: string): Promise<CareFacebookResult<CustomerCareBackfillJobSnapshot>> {
    if (!isCareFacebookChoiceId(workspaceId)) return INVALID_REQUEST;
    const result = await this.request('backfill-status', `/backfill?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (!result.ok) return result;
    const envelope = parseSuccessEnvelope(result.body, ['job'], workspaceId);
    const job = envelope ? parseCareBackfillJobSnapshot(envelope.job) : null;
    return job ? { ok: true, value: job } : INVALID_RESPONSE;
  }

  /** GET /status — the verified connection, plus CRM-synced Pages (falling back cleanly on older servers). */
  async getStatus(workspaceId: string): Promise<CareFacebookResult<CareFacebookStatus>> {
    if (!isCareFacebookChoiceId(workspaceId)) return INVALID_REQUEST;
    const encoded = encodeURIComponent(workspaceId);
    const first = await this.request('status', `/status?workspaceId=${encoded}&include=crmPages`);
    if (first.ok) {
      const parsed = parseStatusBody(first.body, workspaceId, true);
      if (parsed) return { ok: true, value: parsed };
      if (!hasOwn(first.body, 'crmPages')) return INVALID_RESPONSE;
    } else if (
      first.error !== 'invalid-response'
      && !(first.error === 'rejected' && (first.reason === undefined || first.reason === 'invalid_request'))
    ) {
      return first;
    }
    const retry = await this.request('status', `/status?workspaceId=${encoded}`);
    if (!retry.ok) return retry;
    const fallback = parseStatusBody(retry.body, workspaceId, false);
    return fallback ? { ok: true, value: fallback } : INVALID_RESPONSE;
  }

  /** DELETE / — disconnect the Page; the backend clears the stored token. */
  async disconnect(workspaceId: string): Promise<CareFacebookResult<null>> {
    if (!isCareFacebookChoiceId(workspaceId)) return INVALID_REQUEST;
    const result = await this.request('disconnect', `?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: 'DELETE',
    });
    if (!result.ok) return result;
    const envelope = parseSuccessEnvelope(result.body, ['connection'], workspaceId);
    return envelope && envelope.connection === null ? { ok: true, value: null } : INVALID_RESPONSE;
  }

  /** GET /inbox — the Page's message subscription, or null without a live Page binding. */
  async getInbox(workspaceId: string): Promise<CareFacebookResult<CustomerCareInboxState | null>> {
    if (!isCareFacebookChoiceId(workspaceId)) return INVALID_REQUEST;
    const result = await this.request('inbox', `/inbox?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (!result.ok) return result;
    const envelope = parseSuccessEnvelope(result.body, ['inbox'], workspaceId);
    if (!envelope) return INVALID_RESPONSE;
    if (envelope.inbox === null) return { ok: true, value: null };
    const inbox = parseCareInboxState(envelope.inbox);
    return inbox ? { ok: true, value: inbox } : INVALID_RESPONSE;
  }

  /** POST /inbox — subscribe or unsubscribe the Page's messages; the answer must match the request. */
  async setInbox(workspaceId: string, enabled: boolean): Promise<CareFacebookResult<CustomerCareInboxState>> {
    if (!isCareFacebookChoiceId(workspaceId) || typeof enabled !== 'boolean') return INVALID_REQUEST;
    const result = await this.request('inbox-set', '/inbox', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, enabled }),
    });
    if (!result.ok) return result;
    const envelope = parseSuccessEnvelope(result.body, ['inbox'], workspaceId);
    const inbox = envelope ? parseCareInboxState(envelope.inbox) : null;
    return inbox && inbox.enabled === enabled ? { ok: true, value: inbox } : INVALID_RESPONSE;
  }

  /** GET /leads — one page of leads; `cursor` is the previous page's opaque `nextCursor`. */
  async listLeads(workspaceId: string, cursor: string | null = null): Promise<CareFacebookResult<CareLeadPage>> {
    if (!isCareFacebookChoiceId(workspaceId) || (cursor !== null && !isCareLeadsCursor(cursor))) return INVALID_REQUEST;
    const query = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
    const result = await this.request('leads', `/leads?workspaceId=${encodeURIComponent(workspaceId)}${query}`);
    if (!result.ok) return result;
    const envelope = parseSuccessEnvelope(result.body, ['leads', 'nextCursor'], workspaceId);
    const page = envelope ? parseCareLeadPage(envelope.leads, envelope.nextCursor) : null;
    return page ? { ok: true, value: page } : INVALID_RESPONSE;
  }

  /** POST /leads/status — records who moved the lead; the answer must be that lead in that status. */
  async setLeadStatus(
    workspaceId: string,
    leadId: string,
    status: CustomerCareLeadStatus,
  ): Promise<CareFacebookResult<CustomerCareLead>> {
    if (!isCareFacebookChoiceId(workspaceId) || !isCareFacebookChoiceId(leadId) || !isCareLeadStatus(status)) {
      return INVALID_REQUEST;
    }
    const result = await this.request('lead-status', '/leads/status', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, leadId, status }),
    });
    if (!result.ok) return result;
    const envelope = parseSuccessEnvelope(result.body, ['lead'], workspaceId);
    const lead = envelope ? parseCareLead(envelope.lead) : null;
    return lead && lead.id === leadId && lead.status === status ? { ok: true, value: lead } : INVALID_RESPONSE;
  }

  /** POST /leads/purge — owner/manager delete one customer's lead and messages; the answer must name that lead. */
  async purgeLead(workspaceId: string, leadId: string): Promise<CareFacebookResult<CareLeadPurge>> {
    if (!isCareFacebookChoiceId(workspaceId) || !isCareFacebookChoiceId(leadId)) return INVALID_REQUEST;
    const result = await this.request('lead-purge', '/leads/purge', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, leadId }),
    });
    if (!result.ok) return result;
    const envelope = parseSuccessEnvelope(result.body, ['leadId', 'deletedMessages'], workspaceId);
    const deletedMessages = envelope?.deletedMessages;
    if (!envelope || envelope.leadId !== leadId || typeof deletedMessages !== 'number'
      || !Number.isSafeInteger(deletedMessages) || deletedMessages < 0) {
      return INVALID_RESPONSE;
    }
    return { ok: true, value: { leadId, deletedMessages } };
  }

  /** GET /auto-reply — Phase C state, or null without a live Page binding. */
  async getAutoReply(workspaceId: string): Promise<CareFacebookResult<CustomerCareAutoReplyState | null>> {
    if (!isCareFacebookChoiceId(workspaceId)) return INVALID_REQUEST;
    const result = await this.request('auto-reply', `/auto-reply?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (!result.ok) return result;
    const envelope = parseSuccessEnvelope(result.body, ['autoReply'], workspaceId);
    if (!envelope) return INVALID_RESPONSE;
    if (envelope.autoReply === null) return { ok: true, value: null };
    const state = parseCareAutoReplyState(envelope.autoReply);
    return state ? { ok: true, value: state } : INVALID_RESPONSE;
  }

  /**
   * POST /auto-reply — turn automatic replies on (uploading the approved facts) or off. The answer must
   * report the requested switch position.
   */
  async setAutoReply(
    workspaceId: string,
    enabled: boolean,
    script: CareAutoReplyScript | null,
  ): Promise<CareFacebookResult<CustomerCareAutoReplyState>> {
    if (!isCareFacebookChoiceId(workspaceId) || typeof enabled !== 'boolean' || (enabled && script === null)) {
      return INVALID_REQUEST;
    }
    const result = await this.request('auto-reply-set', '/auto-reply', {
      method: 'POST',
      body: JSON.stringify(enabled ? { workspaceId, enabled, script } : { workspaceId, enabled }),
    });
    if (!result.ok) return result;
    const envelope = parseSuccessEnvelope(result.body, ['autoReply'], workspaceId);
    const state = envelope ? parseCareAutoReplyState(envelope.autoReply) : null;
    return state && state.enabled === enabled ? { ok: true, value: state } : INVALID_RESPONSE;
  }

  /** POST /sync-recent — trigger an immediate multi-Page incremental delta sync for this workspace. */
  async syncRecentLeads(workspaceId: string): Promise<CareFacebookResult<CareSyncRecentOutcome>> {
    if (!isCareFacebookChoiceId(workspaceId)) return INVALID_REQUEST;
    const syncTimeoutMs = Math.max(this.timeoutMs, CARE_FACEBOOK_CALLBACK_TIMEOUT_MS);
    const result = await this.request(
      'sync-recent',
      '/sync-recent',
      { method: 'POST', body: JSON.stringify({ workspaceId }) },
      syncTimeoutMs,
      (status, body) => {
        if (status !== 429) return null;
        const envelope = exactRecord(body, ['success', 'error', 'reason', 'retryAfterSec']);
        if (!envelope || envelope.success !== false || envelope.reason !== 'refresh_too_soon') return null;
        const retryAfterSec = envelope.retryAfterSec;
        if (typeof retryAfterSec !== 'number' || !Number.isSafeInteger(retryAfterSec) || retryAfterSec < 0) return null;
        return { ok: true, body: { __tooSoon: true, retryAfterSec } };
      },
    );
    if (!result.ok) return result;
    const tooSoon = exactRecord(result.body, ['__tooSoon', 'retryAfterSec']);
    if (tooSoon && tooSoon.__tooSoon === true && typeof tooSoon.retryAfterSec === 'number') {
      return { ok: true, value: { kind: 'too_soon', retryAfterSec: tooSoon.retryAfterSec } };
    }
    const envelope = parseSuccessEnvelope(
      result.body,
      [
        'cooldownSeconds',
        'syncedAt',
        'pagesProcessed',
        'conversationsScanned',
        'leadsImported',
        'messagesStored',
        'namesSealed',
        'skippedPages',
      ],
      workspaceId,
    );
    if (
      !envelope
      || !isCount(envelope.cooldownSeconds)
      || !isIso(envelope.syncedAt)
      || !isCount(envelope.pagesProcessed)
      || !isCount(envelope.conversationsScanned)
      || !isCount(envelope.leadsImported)
      || !isCount(envelope.messagesStored)
      || !isCount(envelope.namesSealed)
    ) {
      return INVALID_RESPONSE;
    }
    const skippedPages = parseSkippedPages(envelope.skippedPages);
    if (!skippedPages) return INVALID_RESPONSE;
    return {
      ok: true,
      value: {
        kind: 'synced',
        summary: {
          workspaceId,
          cooldownSeconds: envelope.cooldownSeconds,
          syncedAt: envelope.syncedAt,
          pagesProcessed: envelope.pagesProcessed,
          conversationsScanned: envelope.conversationsScanned,
          leadsImported: envelope.leadsImported,
          messagesStored: envelope.messagesStored,
          namesSealed: envelope.namesSealed,
          skippedPages,
        },
      },
    };
  }

  /**
   * One authed request. The token is attached here and nowhere else; only the parsed JSON body leaves
   * this method, and an error body is reduced to its bounded `reason` by `careFacebookFailure`.
   */
  private async request(
    label: string,
    path: string,
    init: RequestInit = {},
    timeoutMs: number = this.timeoutMs,
    onFailure?: (status: number, body: unknown) => RequestOutcome | null,
  ): Promise<RequestOutcome> {
    if (!this.baseUrl) return { ok: false, error: 'not_configured' };
    const token = await this.auth.getAccessToken().catch(() => null);
    if (!token) return { ok: false, error: 'auth' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${CARE_FACEBOOK_ROOT}${path}`, {
        ...init,
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      let body: unknown = null;
      let readable = true;
      try {
        body = await response.json();
      } catch {
        readable = false;
      }
      if (!response.ok) {
        logFailure(label, response.status);
        const handled = onFailure?.(response.status, body);
        if (handled) return handled;
        return careFacebookFailure(response.status, body);
      }
      return readable ? { ok: true, body } : INVALID_RESPONSE;
    } catch {
      logFailure(label);
      return { ok: false, error: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Route label + status only — never the token, the workspace, the body or the server's message. */
function logFailure(label: string, status?: number): void {
  try {
    console.warn(`[CareFacebookClient] ${label}: ${status === undefined ? 'unavailable' : `status ${status}`}`);
  } catch {
    // Diagnostics must never turn a fail-closed response into a main crash.
  }
}
