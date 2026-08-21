/**
 * Native Marketing REST client (native-marketing, Phase 1).
 *
 * The first main-process surface that talks to the IzziAPI `/api/marketing`
 * contract DIRECTLY with the user's existing izzi/Supabase session — no Auto
 * Post extension backend, no loopback service, no second login. It is the
 * native replacement path for the extension-hosted Auto Post bridge; the
 * existing `autopost:*` IPC keeps working untouched while this slice lands.
 *
 * security-baseline B:
 *   - The Supabase access token is read from AuthManager inside main and is
 *     referenced by value ONLY in the Authorization header. It is never logged,
 *     never cached here and never crosses the main/renderer boundary.
 *   - The base URL defaults to the PUBLIC IzziAPI origin from `public-config`
 *     and otherwise accepts only a reviewed https origin. Anything else (http,
 *     127.0.0.1/localhost, credentials in the URL, a path/query) yields NO base
 *     URL, so every call fails closed with `configuration-required`.
 *   - Every renderer-facing value is rebuilt field-by-field from an explicit
 *     allowlist, so an unexpected or hostile response body can never smuggle a
 *     token, cookie or unbounded string through IPC.
 *   - Failures are bounded kebab-case codes derived from the HTTP status only;
 *     server-supplied error text is never forwarded.
 *
 * Scope of this slice: workspaces (list/create), accounts (read), posts (read),
 * OAuth state (issue) and draft posts (create). Provider OAuth exchange,
 * publishing and scheduling are deliberately NOT implemented here.
 *
 * @module main/marketing/native-marketing-client
 */
import { IZZI_API_BASE } from '../config/public-config';

/** Minimal view of AuthManager: the izzi/Supabase access token, or null. */
export interface NativeMarketingTokenProvider {
  getAccessToken(): Promise<string | null>;
}

export interface NativeMarketingClientOptions {
  /** Reviewed https origin override; an unreviewed value disables the client. */
  baseUrl?: string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

/** Social destinations this native slice is allowed to name. */
export const NATIVE_MARKETING_PLATFORMS = [
  'facebook',
  'instagram',
  'threads',
  'youtube',
  'tiktok',
  'linkedin',
  'x',
] as const;
export type NativeMarketingPlatform = (typeof NATIVE_MARKETING_PLATFORMS)[number];

export const NATIVE_MARKETING_POST_STATUSES = [
  'draft',
  'scheduled',
  'publishing',
  'published',
  'failed',
  'cancelled',
] as const;
export type NativeMarketingPostStatus = (typeof NATIVE_MARKETING_POST_STATUSES)[number];

export const NATIVE_MARKETING_OPERATING_MODES = [
  'copilot',
  'semi_autonomous',
  'guarded_autonomous',
] as const;
export type NativeMarketingOperatingMode = (typeof NATIVE_MARKETING_OPERATING_MODES)[number];

export const NATIVE_MARKETING_ROLES = [
  'owner',
  'manager',
  'editor',
  'reviewer',
  'viewer',
] as const;
export type NativeMarketingRole = (typeof NATIVE_MARKETING_ROLES)[number];

export const NATIVE_MARKETING_PLANS = ['free', 'starter', 'pro', 'max', 'ultra'] as const;
export type NativeMarketingPlan = (typeof NATIVE_MARKETING_PLANS)[number];

export const NATIVE_MARKETING_ACCOUNT_STATUSES = [
  'connected',
  'pending',
  'expired',
  'needs_reauth',
  'revoked',
  'error',
  'disconnected',
] as const;
export type NativeMarketingAccountStatus = (typeof NATIVE_MARKETING_ACCOUNT_STATUSES)[number];

/** Every failure the renderer can observe. Bounded on purpose. */
export type NativeMarketingErrorCode =
  | 'configuration-required'
  | 'not-signed-in'
  | 'invalid-workspace-id'
  | 'invalid-workspace-name'
  | 'invalid-operating-mode'
  | 'unsupported-platform'
  | 'invalid-post-status'
  | 'invalid-draft'
  | 'invalid-response'
  | 'auth-required'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'rate-limited'
  | 'server-error'
  | 'request-rejected'
  | 'network-error';

export interface NativeMarketingWorkspaceSummary {
  id: string;
  name: string;
  role: NativeMarketingRole;
  plan: NativeMarketingPlan;
  creditsLimit: number | null;
  creditsUsed: number | null;
}

export interface NativeMarketingAccountSummary {
  id: string;
  platform: NativeMarketingPlatform;
  name: string;
  status: NativeMarketingAccountStatus;
  active: boolean;
}

export interface NativeMarketingPostSummary {
  id: string;
  title: string;
  status: NativeMarketingPostStatus;
  excerpt: string;
  scheduledAt: string | null;
  updatedAt: string | null;
}

export interface NativeMarketingDraftInput {
  platform: NativeMarketingPlatform;
  content: string;
  title?: string;
}

export interface NativeMarketingWorkspaceCreateInput {
  name: string;
  slug?: string;
  operatingMode?: NativeMarketingOperatingMode;
}

export interface NativeMarketingFailure {
  ok: false;
  error: NativeMarketingErrorCode;
}

export type NativeMarketingWorkspaceListResult =
  | { ok: true; workspaces: NativeMarketingWorkspaceSummary[] }
  | NativeMarketingFailure;

export type NativeMarketingWorkspaceResult =
  | { ok: true; workspace: NativeMarketingWorkspaceSummary }
  | NativeMarketingFailure;

export type NativeMarketingAccountListResult =
  | { ok: true; accounts: NativeMarketingAccountSummary[] }
  | NativeMarketingFailure;

export type NativeMarketingPostListResult =
  | { ok: true; posts: NativeMarketingPostSummary[] }
  | NativeMarketingFailure;

export type NativeMarketingPostResult =
  | { ok: true; post: NativeMarketingPostSummary }
  | NativeMarketingFailure;

/**
 * The OAuth handshake value for the NEXT provider step — and nothing else. No
 * authorization URL, client id, verifier or redirect target is surfaced here.
 */
export type NativeMarketingOAuthStateResult =
  | { ok: true; platform: NativeMarketingPlatform; state: string }
  | NativeMarketingFailure;

const MARKETING_ROOT = '/api/marketing';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OAUTH_STATE_PATTERN = /^[A-Za-z0-9._~-]{16,512}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Origins a reviewer has signed off for native Marketing traffic. The public
 * production origin plus the reviewed Customer Marketing staging origin — the
 * same allowlist style `CustomerMarketingWorkspaceClient` already uses. No
 * loopback / extension backend is (or may be) listed here.
 */
export const REVIEWED_NATIVE_MARKETING_ORIGINS: readonly string[] = [
  'https://api.izziapi.com',
  'https://marketing-staging.izziapi.com',
];

const MAX_WORKSPACES = 50;
const MAX_ACCOUNTS = 200;
const MAX_POSTS = 200;
const MAX_TITLE_LENGTH = 200;
const MAX_EXCERPT_LENGTH = 280;
const MAX_CONTENT_LENGTH = 20_000;

/**
 * Resolve the origin this client may call: the public IzziAPI origin by
 * default, or a reviewed https origin override. Returns null (→ every call
 * fails closed) for an unreviewed origin, http, loopback, embedded
 * credentials, or a URL carrying a path/query/fragment. Pure.
 */
export function resolveNativeMarketingBaseUrl(override?: string | null): string | null {
  const candidate = typeof override === 'string' && override.trim()
    ? override.trim()
    : IZZI_API_BASE;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (url.pathname !== '/' || url.search || url.hash) return null;
  return REVIEWED_NATIVE_MARKETING_ORIGINS.includes(url.origin) ? url.origin : null;
}

/** Map an HTTP status (or a transport failure) to a bounded error code. Pure. */
export function nativeMarketingFailureCode(status?: number): NativeMarketingErrorCode {
  if (status === undefined) return 'network-error';
  if (status === 401) return 'auth-required';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate-limited';
  return status >= 500 ? 'server-error' : 'request-rejected';
}

export function isNativeMarketingPlatform(value: unknown): value is NativeMarketingPlatform {
  return typeof value === 'string'
    && (NATIVE_MARKETING_PLATFORMS as readonly string[]).includes(value);
}

export function isNativeMarketingPostStatus(value: unknown): value is NativeMarketingPostStatus {
  return typeof value === 'string'
    && (NATIVE_MARKETING_POST_STATUSES as readonly string[]).includes(value);
}

export function isNativeMarketingOperatingMode(value: unknown): value is NativeMarketingOperatingMode {
  return typeof value === 'string'
    && (NATIVE_MARKETING_OPERATING_MODES as readonly string[]).includes(value);
}

function recordValue(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
}

/** A trimmed, length-bounded string, or null when absent/blank/oversized. */
function boundedText(raw: unknown, maxLength: number): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function boundedSlug(raw: unknown): string | null {
  const slug = boundedText(raw, 63)?.toLowerCase() ?? null;
  return slug && /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug) ? slug : null;
}

function slugifyWorkspaceName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return slug || 'marketing-workspace';
}

function safeCount(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
}

function nullableIso(raw: unknown): string | null {
  return typeof raw === 'string' && ISO_PATTERN.test(raw) && !Number.isNaN(Date.parse(raw))
    ? raw
    : null;
}

/**
 * Allowlist ONE `{ workspace, membership, quota }` envelope — the shape the
 * `/api/marketing/workspaces` contract already returns. Pure.
 */
export function parseNativeMarketingWorkspace(raw: unknown): NativeMarketingWorkspaceSummary | null {
  const envelope = recordValue(raw);
  const workspace = envelope && recordValue(envelope.workspace)
    ? recordValue(envelope.workspace)
    : envelope;
  if (!envelope || !workspace) return null;

  const id = typeof workspace.id === 'string' ? workspace.id : '';
  const name = boundedText(workspace.name, 160);
  const membership = envelope ? recordValue(envelope.membership) : null;
  const role = typeof membership?.role === 'string' ? membership.role : 'owner';
  const plan = typeof workspace.plan === 'string' && workspace.plan ? workspace.plan : 'free';
  if (
    !UUID_PATTERN.test(id)
    || !name
    || !(NATIVE_MARKETING_ROLES as readonly string[]).includes(role)
    || !(NATIVE_MARKETING_PLANS as readonly string[]).includes(plan)
  ) return null;

  const quota = recordValue(envelope.quota);
  return {
    id,
    name,
    role: role as NativeMarketingRole,
    plan: plan as NativeMarketingPlan,
    creditsLimit: quota ? safeCount(quota.credits_limit) : null,
    creditsUsed: quota ? safeCount(quota.credits_used) : null,
  };
}

/** Allowlist `{ workspaces: [...] }`. Any malformed row fails the whole read. Pure. */
export function parseNativeMarketingWorkspaceList(raw: unknown): NativeMarketingWorkspaceSummary[] | null {
  const envelope = recordValue(raw);
  const rows = envelope ? envelope.workspaces : null;
  if (!Array.isArray(rows) || rows.length > MAX_WORKSPACES) return null;
  const workspaces = rows.map(parseNativeMarketingWorkspace);
  return workspaces.some((workspace) => workspace === null)
    ? null
    : workspaces as NativeMarketingWorkspaceSummary[];
}

function parseNativeMarketingAccount(raw: unknown): NativeMarketingAccountSummary | null {
  const account = recordValue(raw);
  if (!account) return null;
  const id = typeof account.id === 'string' ? account.id : '';
  const platform = typeof account.platform === 'string' ? account.platform.toLowerCase() : '';
  const status = typeof account.status === 'string' ? account.status.toLowerCase() : '';
  if (
    !UUID_PATTERN.test(id)
    || !isNativeMarketingPlatform(platform)
    || !(NATIVE_MARKETING_ACCOUNT_STATUSES as readonly string[]).includes(status)
  ) return null;
  if (account.active !== undefined && typeof account.active !== 'boolean') return null;
  return {
    id,
    platform,
    name: boundedText(account.displayName, 160) ?? boundedText(account.name, 160) ?? platform,
    status: status as NativeMarketingAccountStatus,
    active: typeof account.active === 'boolean' ? account.active : status === 'connected',
  };
}

/** Allowlist `{ workspaceId, accounts: [...] }` for one workspace. Pure. */
export function parseNativeMarketingAccountList(
  raw: unknown,
  expectedWorkspaceId: string,
): NativeMarketingAccountSummary[] | null {
  const envelope = recordValue(raw);
  if (!envelope || envelope.workspaceId !== expectedWorkspaceId) return null;
  const rows = envelope.accounts;
  if (!Array.isArray(rows) || rows.length > MAX_ACCOUNTS) return null;
  const accounts = rows.map(parseNativeMarketingAccount);
  return accounts.some((account) => account === null)
    ? null
    : accounts as NativeMarketingAccountSummary[];
}

/** Allowlist one post record down to display-safe, length-bounded fields. Pure. */
export function parseNativeMarketingPost(raw: unknown): NativeMarketingPostSummary | null {
  const post = recordValue(raw);
  if (!post) return null;
  const id = typeof post.id === 'string' ? post.id : '';
  const status = typeof post.status === 'string' ? post.status.toLowerCase() : '';
  if (!UUID_PATTERN.test(id) || !isNativeMarketingPostStatus(status)) return null;
  const contentValue = post.content ?? post.body;
  const scheduledValue = post.scheduledAt ?? post.scheduled_at;
  const updatedValue = post.updatedAt ?? post.updated_at ?? post.created_at;
  if (contentValue !== undefined && typeof contentValue !== 'string') return null;
  if (scheduledValue !== undefined && scheduledValue !== null && nullableIso(scheduledValue) === null) {
    return null;
  }
  const content = typeof contentValue === 'string' ? contentValue.trim() : '';
  return {
    id,
    title: boundedText(post.title, MAX_TITLE_LENGTH) ?? '',
    status,
    excerpt: content.slice(0, MAX_EXCERPT_LENGTH),
    scheduledAt: nullableIso(scheduledValue),
    updatedAt: nullableIso(updatedValue),
  };
}

/** Allowlist `{ workspaceId, posts: [...] }` for one workspace. Pure. */
export function parseNativeMarketingPostList(
  raw: unknown,
  expectedWorkspaceId: string,
): NativeMarketingPostSummary[] | null {
  const envelope = recordValue(raw);
  if (!envelope || envelope.workspaceId !== expectedWorkspaceId) return null;
  const rows = envelope.posts;
  if (!Array.isArray(rows) || rows.length > MAX_POSTS) return null;
  const posts = rows.map(parseNativeMarketingPost);
  return posts.some((post) => post === null) ? null : posts as NativeMarketingPostSummary[];
}

/**
 * Allowlist `{ workspaceId, platform, state }` down to the opaque state value.
 * Any extra provider material in the body is dropped, never forwarded. Pure.
 */
export function parseNativeMarketingOAuthState(
  raw: unknown,
  expectedWorkspaceId: string,
  expectedPlatform: NativeMarketingPlatform,
): string | null {
  const envelope = recordValue(raw);
  if (!envelope || envelope.workspaceId !== expectedWorkspaceId) return null;
  if (envelope.platform !== expectedPlatform) return null;
  const state = typeof envelope.state === 'string' ? envelope.state : '';
  return OAUTH_STATE_PATTERN.test(state) ? state : null;
}

/** Normalize a caller-supplied draft, or null when it is not postable. Pure. */
export function parseNativeMarketingDraftInput(raw: unknown): NativeMarketingDraftInput | null {
  const input = recordValue(raw);
  if (!input) return null;
  if (!isNativeMarketingPlatform(input.platform)) return null;
  const content = boundedText(input.content, MAX_CONTENT_LENGTH);
  if (!content) return null;
  if (input.title !== undefined && typeof input.title !== 'string') return null;
  const title = boundedText(input.title, MAX_TITLE_LENGTH);
  return title ? { platform: input.platform, content, title } : { platform: input.platform, content };
}

type RequestOutcome =
  | { ok: true; body: unknown }
  | { ok: false; error: NativeMarketingErrorCode };

/**
 * JWT-authed client over the IzziAPI `/api/marketing` contract. One instance is
 * created in main and shared by the `nativeMarketing:*` IPC handlers.
 */
export class NativeMarketingClient {
  private readonly baseUrl: string | null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly auth: NativeMarketingTokenProvider,
    options: NativeMarketingClientOptions = {},
  ) {
    this.baseUrl = resolveNativeMarketingBaseUrl(options.baseUrl);
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** The reviewed origin in use, or null when the client is disabled. */
  getBaseUrl(): string | null {
    return this.baseUrl;
  }

  isConfigured(): boolean {
    return this.baseUrl !== null;
  }

  /** GET /api/marketing/workspaces — the caller's native Marketing workspaces. */
  async listWorkspaces(): Promise<NativeMarketingWorkspaceListResult> {
    const result = await this.request(`${MARKETING_ROOT}/workspaces`);
    if (!result.ok) return result;
    const workspaces = parseNativeMarketingWorkspaceList(result.body);
    return workspaces ? { ok: true, workspaces } : { ok: false, error: 'invalid-response' };
  }

  /** POST /api/marketing/workspaces — create the native workspace. */
  async createWorkspace(input: NativeMarketingWorkspaceCreateInput): Promise<NativeMarketingWorkspaceResult> {
    const name = boundedText(input?.name, 160);
    if (!name) return { ok: false, error: 'invalid-workspace-name' };
    const slug = boundedSlug(input?.slug) ?? slugifyWorkspaceName(name);
    if (!slug) return { ok: false, error: 'invalid-workspace-name' };
    const result = await this.request(`${MARKETING_ROOT}/workspaces`, {
      method: 'POST',
      body: JSON.stringify({ name, slug }),
    });
    if (!result.ok) return result;
    const envelope = recordValue(result.body);
    const workspace = envelope ? parseNativeMarketingWorkspace(envelope.workspace) : null;
    return workspace ? { ok: true, workspace } : { ok: false, error: 'invalid-response' };
  }

  /** GET /api/marketing/accounts?workspaceId=:id — connected channels (read-only). */
  async listAccounts(workspaceId: string): Promise<NativeMarketingAccountListResult> {
    if (!UUID_PATTERN.test(workspaceId)) return { ok: false, error: 'invalid-workspace-id' };
    const result = await this.request(`${MARKETING_ROOT}/accounts?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (!result.ok) return result;
    const accounts = parseNativeMarketingAccountList(result.body, workspaceId);
    return accounts ? { ok: true, accounts } : { ok: false, error: 'invalid-response' };
  }

  /**
   * POST /api/marketing/oauth/state — ask IzziAPI to mint
   * the CSRF state for a provider connect. This slice returns only that state;
   * exchanging a provider code is a separate, later step.
   */
  async createOAuthState(
    workspaceId: string,
    platform: NativeMarketingPlatform,
  ): Promise<NativeMarketingOAuthStateResult> {
    if (!UUID_PATTERN.test(workspaceId)) return { ok: false, error: 'invalid-workspace-id' };
    if (!isNativeMarketingPlatform(platform)) return { ok: false, error: 'unsupported-platform' };
    const result = await this.request(
      `${MARKETING_ROOT}/oauth/state`,
      { method: 'POST', body: JSON.stringify({ workspaceId, platform }) },
    );
    if (!result.ok) return result;
    const state = parseNativeMarketingOAuthState(result.body, workspaceId, platform);
    return state ? { ok: true, platform, state } : { ok: false, error: 'invalid-response' };
  }

  /** GET /api/marketing/posts?workspaceId=:id — posts, optionally by status. */
  async listPosts(workspaceId: string, status?: string): Promise<NativeMarketingPostListResult> {
    if (!UUID_PATTERN.test(workspaceId)) return { ok: false, error: 'invalid-workspace-id' };
    if (status !== undefined && !isNativeMarketingPostStatus(status)) {
      return { ok: false, error: 'invalid-post-status' };
    }
    const query = status ? `&status=${encodeURIComponent(status)}` : '';
    const result = await this.request(`${MARKETING_ROOT}/posts?workspaceId=${encodeURIComponent(workspaceId)}${query}`);
    if (!result.ok) return result;
    const posts = parseNativeMarketingPostList(result.body, workspaceId);
    return posts ? { ok: true, posts } : { ok: false, error: 'invalid-response' };
  }

  /**
   * POST /api/marketing/posts — content only, `status: 'draft'`,
   * no accounts and no schedule, so the post can never publish. A response that
   * comes back as anything other than a draft fails closed.
   */
  async createDraftPost(
    workspaceId: string,
    input: NativeMarketingDraftInput,
  ): Promise<NativeMarketingPostResult> {
    if (!UUID_PATTERN.test(workspaceId)) return { ok: false, error: 'invalid-workspace-id' };
    const draft = parseNativeMarketingDraftInput(input);
    if (!draft) return { ok: false, error: 'invalid-draft' };
    const result = await this.request(`${MARKETING_ROOT}/posts`, {
      method: 'POST',
      body: JSON.stringify({
        workspaceId,
        platform: draft.platform,
        body: draft.content,
        status: 'draft',
      }),
    });
    if (!result.ok) return result;
    const envelope = recordValue(result.body);
    const post = envelope && (!envelope.workspaceId || envelope.workspaceId === workspaceId)
      ? parseNativeMarketingPost(envelope.post)
      : null;
    return post && post.status === 'draft'
      ? { ok: true, post }
      : { ok: false, error: 'invalid-response' };
  }

  /**
   * One authed request. The token is attached here and nowhere else; only the
   * parsed JSON body (never headers, never error text) leaves this method.
   */
  private async request(path: string, init: RequestInit = {}): Promise<RequestOutcome> {
    if (!this.baseUrl) return { ok: false, error: 'configuration-required' };
    const token = await this.auth.getAccessToken().catch(() => null);
    if (!token) return { ok: false, error: 'not-signed-in' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        this.logFailure(path, response.status);
        return { ok: false, error: nativeMarketingFailureCode(response.status) };
      }
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        return { ok: false, error: 'invalid-response' };
      }
      return { ok: true, body };
    } catch {
      this.logFailure(path);
      return { ok: false, error: 'network-error' };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Path + status only — never the token, the body or the server's message. */
  private logFailure(path: string, status?: number): void {
    const detail = status === undefined ? 'unavailable' : `status ${status}`;
    try {
      console.warn(`[NativeMarketingClient] ${path}: ${detail}`);
    } catch {
      // Diagnostics must never turn a fail-closed response into a main crash.
    }
  }
}
