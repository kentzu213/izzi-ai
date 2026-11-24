/**
 * Care CRM S2 client over IzziAPI `GET /crm` and `POST /crm/profile`, under the Care Facebook router.
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
import type { CustomerCareCrmProfileInput, CustomerCareCrmSaveInput } from '../../shared/customer-care-types';
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
  type CareCrmPage,
  type CareCrmSaveOutcome,
} from './care-crm';

const INVALID_REQUEST: CareFacebookFailure = { ok: false, error: 'rejected', reason: 'invalid_request' };
const INVALID_RESPONSE: CareFacebookFailure = { ok: false, error: 'invalid-response' };
/** Over the shared Care budget (30 a minute per user): the screen skips its next refresh instead of retrying. */
const RATE_LIMITED: CareFacebookFailure = { ok: false, error: 'unavailable', reason: 'rate_limited' };
const OWNER_NOT_ELIGIBLE: CareFacebookFailure = { ok: false, error: 'rejected', reason: 'owner_not_eligible' };
const FORBIDDEN_STATUS = 403;
const CONFLICT_STATUS = 409;
const RATE_LIMIT_STATUS = 429;

type CrmResponse = { ok: true; status: number; body: unknown } | CareFacebookFailure;

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

  constructor(
    private readonly auth: NativeMarketingTokenProvider,
    options: NativeMarketingClientOptions = {},
  ) {
    this.baseUrl = resolveNativeMarketingBaseUrl(options.baseUrl, options.allowLoopback);
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** GET /crm — one page of rows, newest phone first; `cursor` is the previous page's opaque `nextCursor`. */
  async listCrm(workspaceId: string, cursor: string | null): Promise<CareFacebookResult<CareCrmPage>> {
    if (!isCareFacebookChoiceId(workspaceId) || (cursor !== null && !isCareLeadsCursor(cursor))) return INVALID_REQUEST;
    const query = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`;
    const result = await this.request('crm', `/crm?workspaceId=${encodeURIComponent(workspaceId)}${query}`);
    if (!result.ok) return result;
    if (result.status === CONFLICT_STATUS) return INVALID_RESPONSE;
    const page = parseCareCrmListBody(result.body, workspaceId);
    return page ? { ok: true, value: page } : INVALID_RESPONSE;
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
   * One authed request. The token is attached here and nowhere else. A 2xx or a 409 hands back the parsed
   * body for the caller's allowlist; any other status is reduced to a bounded failure.
   */
  private async request(label: string, path: string, init: RequestInit = {}): Promise<CrmResponse> {
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
      if (!response.ok) logFailure(label, response.status);
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
