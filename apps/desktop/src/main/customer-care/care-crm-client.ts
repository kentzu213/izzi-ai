/**
 * Care CRM S2 client over IzziAPI `GET /crm` and `POST /crm/profile`, under the Care Facebook router, plus the
 * Care CRM S3 identity routes `POST /crm/identity` and `POST /crm/identity/refresh`.
 *
 * Mirrors `CareFacebookClient`: the Supabase access token is read inside main and referenced only in the
 * Authorization header; the origin comes from `resolveNativeMarketingBaseUrl` (reviewed https only). Every
 * answer is rebuilt from an exact allowlist. It keeps its own request method because a 409
 * `profile_conflict` must hand back the current row, which the shared failure mapping drops. Answers are
 * returned to the caller only: never stored, and never logged beyond a route label and a status.
 *
 * @module main/customer-care/care-crm-client
 */
import {
  resolveNativeMarketingBaseUrl,
  type NativeMarketingClientOptions,
  type NativeMarketingTokenProvider,
} from '../marketing/native-marketing-client';
import type {
  CustomerCareCrmIdentityActionInput,
  CustomerCareCrmProfileInput,
  CustomerCareCrmSaveInput,
} from '../../shared/customer-care-types';
import {
  CARE_FACEBOOK_ROOT,
  careFacebookFailure,
  isCareFacebookChoiceId,
  isCareLeadsCursor,
  type CareFacebookFailure,
  type CareFacebookResult,
} from './care-facebook-client';
import {
  parseCareCrmConflictBody,
  parseCareCrmListBody,
  parseCareCrmSaveBody,
  type CareCrmGateway,
  type CareCrmListOptions,
  type CareCrmPage,
  type CareCrmSaveOutcome,
} from './care-crm';
import {
  CARE_CRM_IDENTITY_REFRESH_TIMEOUT_MS,
  careCrmIdentityFailure,
  careCrmIdentityRequestBody,
  parseCareCrmIdentityActionBody,
  parseCareCrmIdentityConflictBody,
  parseCareCrmIdentityRefreshBody,
  parseCareCrmRefreshTooSoonBody,
  type CareCrmIdentityOutcome,
  type CareCrmRefreshOutcome,
} from './care-crm-identity';

const INVALID_REQUEST: CareFacebookFailure = { ok: false, error: 'rejected', reason: 'invalid_request' };
const INVALID_RESPONSE: CareFacebookFailure = { ok: false, error: 'invalid-response' };
/** Over the shared Care budget (30 a minute per user): the screen skips its next refresh instead of retrying. */
const RATE_LIMITED: CareFacebookFailure = { ok: false, error: 'unavailable', reason: 'rate_limited' };
const OWNER_NOT_ELIGIBLE: CareFacebookFailure = { ok: false, error: 'rejected', reason: 'owner_not_eligible' };
const FORBIDDEN_STATUS = 403;
const CONFLICT_STATUS = 409;
const RATE_LIMIT_STATUS = 429;
/** Answers to `GET /crm?include=identity` that reading again without it would not change: no retry. */
const NO_RETRY_STATUSES = [401, 403, 404];
/**
 * After the identity read failed and the read without it worked, lists are read without it this long: a broken identity read (e.g. a backend
 * deployed before its migration) then costs one extra request every 5 minutes, not one per page, against the shared
 * 30-a-minute Care budget.
 */
const IDENTITY_BACKOFF_MS = 5 * 60_000;

type CrmResponse = { ok: true; status: number; body: unknown } | CareFacebookFailure;

/**
 * `raw`: every answer with a status comes back to the caller (an unreadable error body as null), which maps it
 * itself; the identity routes read 409 and 429 by `reason`. `timeoutMs` overrides the client's timeout.
 */
interface RequestOptions {
  raw?: boolean;
  timeoutMs?: number;
}

/** The 11 editable keys only: `updatedAt`, `updatedBy` or `detailsUnreadable` in a POST answer 400. */
function editableProfile(profile: CustomerCareCrmProfileInput): CustomerCareCrmProfileInput {
  return {
    stage: profile.stage,
    ownerUserId: profile.ownerUserId,
    addressForm: profile.addressForm,
    occasion: profile.occasion,
    neededBy: profile.neededBy,
    productFactIds: [...profile.productFactIds],
    nextStep: profile.nextStep,
    nextStepDueAt: profile.nextStepDueAt,
    lostReason: profile.lostReason,
    purchasedAt: profile.purchasedAt,
    note: profile.note,
  };
}

function rejectReasonOf(body: unknown): unknown {
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>).reason
    : undefined;
}

export class CareCrmClient implements CareCrmGateway {
  private readonly baseUrl: string | null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  /**
   * The identity read is paused for this account and workspace (`scope`) until `until`: set when it failed and the
   * read without it worked. Another scope starts afresh.
   */
  private identityBackoff: { scope: string; until: number } | null = null;

  constructor(
    private readonly auth: NativeMarketingTokenProvider,
    options: NativeMarketingClientOptions = {},
  ) {
    this.baseUrl = resolveNativeMarketingBaseUrl(options.baseUrl, options.allowLoopback);
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * GET /crm — one page of rows, newest phone first; `cursor` is the previous page's opaque `nextCursor`. Asks for
   * the Care CRM S3 identity block; a server without S3 ignores the parameter and answers without it. The identity
   * never takes the CRM down: when that read fails (any 4xx or 5xx except 401, 403, 404 and 429, which would not
   * change), the page is read once more without it and marked `identityUnavailable`. When that worked, the identity
   * read is paused for 5 minutes for this `scope` (account and workspace); "Làm mới" (`retryIdentity`) tries it anyway.
   */
  async listCrm(workspaceId: string, cursor: string | null, options: CareCrmListOptions = {}): Promise<CareFacebookResult<CareCrmPage>> {
    if (!isCareFacebookChoiceId(workspaceId) || (cursor !== null && !isCareLeadsCursor(cursor))) return INVALID_REQUEST;
    const path = `/crm?workspaceId=${encodeURIComponent(workspaceId)}`;
    const query = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
    const scope = options.scope ?? workspaceId;
    // A workspace or account switch starts afresh.
    if (this.identityBackoff !== null && this.identityBackoff.scope !== scope) this.identityBackoff = null;
    const paused = this.identityBackoff !== null && Date.now() < this.identityBackoff.until && options.retryIdentity !== true;
    let identityFailed = false;
    if (!paused) {
      const result = await this.request('crm', `${path}&include=identity${query}`, {}, { raw: true });
      if (!result.ok) return result;
      if (result.status >= 200 && result.status < 300) {
        const page = parseCareCrmListBody(result.body, workspaceId);
        if (!page) return INVALID_RESPONSE;
        this.identityBackoff = null;
        return { ok: true, value: page };
      }
      if (result.status === RATE_LIMIT_STATUS) return RATE_LIMITED;
      if (NO_RETRY_STATUSES.includes(result.status)) return careFacebookFailure(result.status, result.body);
      // The identity read failed: the CRM is read once more without it.
      identityFailed = true;
    }
    const result = await this.request('crm', `${path}${query}`);
    if (!result.ok) return result;
    if (result.status === CONFLICT_STATUS) return INVALID_RESPONSE;
    const page = parseCareCrmListBody(result.body, workspaceId);
    if (!page) return INVALID_RESPONSE;
    // Only a failure the read without identity got past pauses the identity read; any other failure is retried next time.
    if (identityFailed) this.identityBackoff = { scope, until: Date.now() + IDENTITY_BACKOFF_MS };
    return { ok: true, value: { ...page, identityUnavailable: true } };
  }

  /**
   * POST /crm/profile — a full replace of the editable fields, guarded by `expectedUpdatedAt`. The caller
   * has already parsed `input`. A 409 `profile_conflict` returns the current profile; nothing was overwritten.
   */
  async saveCrmProfile(
    workspaceId: string,
    input: CustomerCareCrmSaveInput,
  ): Promise<CareFacebookResult<CareCrmSaveOutcome>> {
    if (!isCareFacebookChoiceId(workspaceId) || !isCareFacebookChoiceId(input.leadId)) return INVALID_REQUEST;
    const { leadId } = input;
    const result = await this.request('crm-profile', '/crm/profile', {
      method: 'POST',
      body: JSON.stringify({
        workspaceId,
        leadId,
        expectedUpdatedAt: input.expectedUpdatedAt,
        profile: editableProfile(input.profile),
      }),
    });
    if (!result.ok) return result;
    if (result.status === CONFLICT_STATUS) {
      const current = parseCareCrmConflictBody(result.body, workspaceId, leadId);
      return current ? { ok: true, value: { kind: 'conflict', leadId, profile: current } } : INVALID_RESPONSE;
    }
    // Committed: a row that came back without its phone and messages is still a success.
    const saved = parseCareCrmSaveBody(result.body, workspaceId, leadId);
    return saved ? { ok: true, value: { kind: 'saved', leadId, profile: saved } } : INVALID_RESPONSE;
  }

  /**
   * POST /crm/identity — Care CRM S3 confirm, correct, reject, ask_consent or withdraw_consent. The caller has
   * already parsed `input`. A 409 `identity_conflict` returns the current identity; nothing was written.
   */
  async identityAction(
    workspaceId: string,
    input: CustomerCareCrmIdentityActionInput,
  ): Promise<CareFacebookResult<CareCrmIdentityOutcome>> {
    if (!isCareFacebookChoiceId(workspaceId) || !isCareFacebookChoiceId(input.leadId)) return INVALID_REQUEST;
    const { leadId } = input;
    const result = await this.request('crm-identity', '/crm/identity', {
      method: 'POST',
      body: JSON.stringify(careCrmIdentityRequestBody(workspaceId, input)),
    }, { raw: true });
    if (!result.ok) return result;
    if (result.status >= 200 && result.status < 300) {
      const identity = parseCareCrmIdentityActionBody(result.body, workspaceId, leadId);
      return identity ? { ok: true, value: { kind: 'applied', leadId, identity } } : INVALID_RESPONSE;
    }
    if (result.status === CONFLICT_STATUS && rejectReasonOf(result.body) === 'identity_conflict') {
      const identity = parseCareCrmIdentityConflictBody(result.body, workspaceId, leadId);
      return identity ? { ok: true, value: { kind: 'conflict', leadId, identity } } : INVALID_RESPONSE;
    }
    return careCrmIdentityFailure(result.status, result.body);
  }

  /**
   * POST /crm/identity/refresh — one identity run now. The server runs the model synchronously (about 30 s at
   * most), so this waits up to 45 s. A 429 `refresh_too_soon` carries when the next run may start.
   */
  async refreshIdentity(workspaceId: string, leadId: string): Promise<CareFacebookResult<CareCrmRefreshOutcome>> {
    if (!isCareFacebookChoiceId(workspaceId) || !isCareFacebookChoiceId(leadId)) return INVALID_REQUEST;
    const result = await this.request('crm-identity-refresh', '/crm/identity/refresh', {
      method: 'POST',
      body: JSON.stringify({ workspaceId, leadId }),
    }, { raw: true, timeoutMs: Math.max(this.timeoutMs, CARE_CRM_IDENTITY_REFRESH_TIMEOUT_MS) });
    if (!result.ok) return result;
    if (result.status >= 200 && result.status < 300) {
      const refreshed = parseCareCrmIdentityRefreshBody(result.body, workspaceId, leadId);
      return refreshed ? { ok: true, value: { kind: 'refreshed', leadId, ...refreshed } } : INVALID_RESPONSE;
    }
    if (result.status === RATE_LIMIT_STATUS && rejectReasonOf(result.body) === 'refresh_too_soon') {
      const retryAfterSec = parseCareCrmRefreshTooSoonBody(result.body);
      return retryAfterSec === null ? INVALID_RESPONSE : { ok: true, value: { kind: 'too_soon', leadId, retryAfterSec } };
    }
    return careCrmIdentityFailure(result.status, result.body);
  }

  /**
   * One authed request. The token is attached here and nowhere else. A 2xx or a 409 hands back the parsed
   * body for the caller's allowlist; any other status is reduced to a bounded failure, unless `raw`.
   */
  private async request(label: string, path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<CrmResponse> {
    if (!this.baseUrl) return { ok: false, error: 'not_configured' };
    const token = await this.auth.getAccessToken().catch(() => null);
    if (!token) return { ok: false, error: 'auth' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);
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
      if (!response.ok) logFailure(label, response.status);
      if (options.raw) {
        if (response.ok) return readable ? { ok: true, status: response.status, body } : INVALID_RESPONSE;
        return { ok: true, status: response.status, body: readable ? body : null };
      }
      // Read by status, so a 429 without `reason: "rate_limited"` is still the rate limit.
      if (response.status === RATE_LIMIT_STATUS) return RATE_LIMITED;
      // A chosen owner who left is a field to fix, not lost access (a viewer's 403 stays `forbidden`).
      if (response.status === FORBIDDEN_STATUS && rejectReasonOf(body) === 'owner_not_eligible') return OWNER_NOT_ELIGIBLE;
      // Failures are read by status and `reason`; the server's English `error` text is never used.
      if (!response.ok && response.status !== CONFLICT_STATUS) return careFacebookFailure(response.status, body);
      return readable ? { ok: true, status: response.status, body } : INVALID_RESPONSE;
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
    console.warn(`[CareCrmClient] ${label}: ${status === undefined ? 'unavailable' : `status ${status}`}`);
  } catch {
    // Diagnostics must never turn a fail-closed response into a main crash.
  }
}
