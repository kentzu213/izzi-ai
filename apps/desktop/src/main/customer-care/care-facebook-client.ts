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
  CUSTOMER_CARE_FACEBOOK_REJECT_REASONS,
  type CustomerCareFacebookPageChoice,
  type CustomerCareFacebookRejectReason,
} from '../../shared/customer-care-types';

export const CARE_FACEBOOK_ROOT = '/api/marketing/care/facebook';
export const CARE_FACEBOOK_MAX_PAGES = 25;
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
];

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
}

/** The surface `CustomerCareService` depends on; tests substitute an in-memory fake. */
export type CareFacebookGateway = Pick<
  CareFacebookClient,
  'startConnect' | 'completeCallback' | 'selectPage' | 'getStatus' | 'disconnect'
>;

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
    const result = await this.request('callback', '/callback', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, state, code }),
    });
    if (!result.ok) return result;
    const envelope = parseSuccessEnvelope(
      result.body,
      ['choiceId', 'expiresAt', 'grantedScopes', 'missingScopes', 'pages'],
      workspaceId,
    );
    if (!envelope || !isCareFacebookChoiceId(envelope.choiceId) || !isIso(envelope.expiresAt)) return INVALID_RESPONSE;
    const grantedScopes = parseScopes(envelope.grantedScopes);
    const missingScopes = parseScopes(envelope.missingScopes);
    const pages = parsePageChoices(envelope.pages);
    if (!grantedScopes || !missingScopes || !pages) return INVALID_RESPONSE;
    return {
      ok: true,
      value: {
        success: true,
        workspaceId,
        choiceId: envelope.choiceId,
        expiresAt: envelope.expiresAt,
        grantedScopes,
        missingScopes,
        pages,
      },
    };
  }

  /** POST /select — bind the chosen Page after backend verification. */
  async selectPage(
    workspaceId: string,
    choiceId: string,
    pageId: string,
  ): Promise<CareFacebookResult<CareFacebookConnection>> {
    if (!isCareFacebookChoiceId(workspaceId) || !isCareFacebookChoiceId(choiceId) || !isCareFacebookPageId(pageId)) {
      return INVALID_REQUEST;
    }
    const result = await this.request('select', '/select', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, choiceId, pageId }),
    });
    if (!result.ok) return result;
    const envelope = parseSuccessEnvelope(result.body, ['connection'], workspaceId);
    const connection = envelope ? parseCareFacebookConnection(envelope.connection) : null;
    return connection && connection.pageId === pageId ? { ok: true, value: connection } : INVALID_RESPONSE;
  }

  /** GET /status — the verified connection, or null. */
  async getStatus(workspaceId: string): Promise<CareFacebookResult<CareFacebookStatus>> {
    if (!isCareFacebookChoiceId(workspaceId)) return INVALID_REQUEST;
    const result = await this.request('status', `/status?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (!result.ok) return result;
    const envelope = parseSuccessEnvelope(result.body, ['requiredScopes', 'connection'], workspaceId);
    if (!envelope) return INVALID_RESPONSE;
    const requiredScopes = parseScopes(envelope.requiredScopes);
    const connection = envelope.connection === null ? null : parseCareFacebookConnection(envelope.connection);
    if (!requiredScopes || (envelope.connection !== null && !connection)) return INVALID_RESPONSE;
    return { ok: true, value: { success: true, workspaceId, requiredScopes, connection } };
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

  /**
   * One authed request. The token is attached here and nowhere else; only the parsed JSON body leaves
   * this method, and an error body is reduced to its bounded `reason` by `careFacebookFailure`.
   */
  private async request(label: string, path: string, init: RequestInit = {}): Promise<RequestOutcome> {
    if (!this.baseUrl) return { ok: false, error: 'not_configured' };
    const token = await this.auth.getAccessToken().catch(() => null);
    if (!token) return { ok: false, error: 'auth' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
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
