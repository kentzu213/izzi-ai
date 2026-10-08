/**
 * Izzi account client — API keys, balance and usage from izziapi.com, for the
 * Settings → "API & Usage" tab. Lives in the Electron MAIN process.
 *
 * Security: the Supabase token and the stored provider key never leave this
 * module. The raw key of a newly created key crosses IPC exactly once, in the
 * `createKey` result. Logs carry only the operation and HTTP status; backend
 * error text is never logged or shown.
 */

import type { AuthManager } from '../auth/auth-manager';
import type { SecretStore } from '../agent/secret-store';
import {
  validateCustomConfig,
  type CustomProviderConfig,
  type ProviderSettingsStore,
} from '../agent/provider-settings-store';
import { IZZI_API_BASE } from '../config/public-config';
import { shortError } from '../affiliate/affiliate-client';

export type OverviewFailure = 'not-signed-in' | 'unauthorized' | 'forbidden' | 'network';

export interface IzziApiKey {
  id: string;
  name: string;
  prefix: string;
  status: string;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface IzziUsageStats {
  totalCost: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  daily: Array<{ day: string; cost: number }>;
  byModel: Array<{ model: string; cost: number; requests: number }>;
}

export interface IzziOverview {
  ok: boolean;
  reason?: OverviewFailure;
  balance: number | null;
  plan: string | null;
  stats: IzziUsageStats | null;
  keys: IzziApiKey[] | null;
  /** Id of the key the app's Custom Provider uses; never the key itself. */
  inUseKeyId: string | null;
  /** Id of the key the app minted for its own chat (desktop key); never the key itself. */
  managedKeyId: string | null;
}

export interface IzziUsageRow {
  id: string;
  createdAt: string;
  model: string;
  keyName: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  durationMs: number;
  statusCode: number;
}

export interface IzziUsagePage {
  ok: boolean;
  reason?: OverviewFailure;
  rows: IzziUsageRow[];
  hasMore: boolean;
}

export type CreateKeyResult =
  | { success: true; key: string; id: string; name: string; savedLocally: boolean }
  | { success: false; error: string };

export type RevokeKeyResult =
  | { success: true; wasInUse: boolean; wasManaged: boolean }
  | { success: false; error: string };

export const USAGE_PAGE_SIZE = 20;
const MAX_KEY_NAME = 64;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Printable ASCII only, so the key is safe to send as a header. */
const RAW_KEY_PATTERN = /^[\x21-\x7e]{8,256}$/;
const IN_USE_SUFFIX_LENGTH = 6;
const DEFAULT_MODEL = 'izzi-smart';
const MAX_USAGE_OFFSET = 10_000;
const REQUEST_TIMEOUT_MS = 15_000;

const SIGN_IN_ERROR = 'Vui lòng đăng nhập Izzi để quản lý API key.';
const SESSION_EXPIRED_ERROR = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
const RATE_LIMIT_ERROR = 'Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại.';
const NETWORK_ERROR = 'Không kết nối được izziapi.com. Vui lòng thử lại.';
const GENERIC_ERROR = 'Yêu cầu thất bại. Vui lòng thử lại.';

// ── Helpers (no prototype-chain reads) ─────────────────────────────────────

function ownValue(raw: unknown, key: string): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function ownArray(raw: unknown, key: string): unknown[] {
  const value = ownValue(raw, key);
  return Array.isArray(value) ? value : [];
}

function num(raw: unknown, key: string): number {
  const v = ownValue(raw, key);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  // Postgres numeric columns arrive as strings.
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

function str(raw: unknown, key: string): string {
  const v = ownValue(raw, key);
  return typeof v === 'string' ? v : '';
}

function isOk(status: number): boolean {
  return status >= 200 && status < 300;
}

/** Fixed, user-facing text for a failed write. Chosen by HTTP status only. */
function writeErrorMessage(status: number): string {
  if (status === 0) return NETWORK_ERROR;
  if (status === 401 || status === 403) return SESSION_EXPIRED_ERROR;
  if (status === 429) return RATE_LIMIT_ERROR;
  return GENERIC_ERROR;
}

/** The most actionable reason among failed statuses (0 = request threw). */
function failureReason(statuses: number[]): OverviewFailure | undefined {
  if (statuses.includes(401)) return 'unauthorized';
  if (statuses.includes(403)) return 'forbidden';
  if (statuses.some((s) => !isOk(s))) return 'network';
  return undefined;
}

function parseKeys(raw: unknown): IzziApiKey[] {
  return ownArray(raw, 'keys').map((k) => ({
    id: str(k, 'id'),
    name: str(k, 'name'),
    prefix: str(k, 'key_prefix'),
    status: str(k, 'status'),
    lastUsedAt: str(k, 'last_used_at') || null,
    createdAt: str(k, 'created_at'),
  }));
}

function parseStats(raw: unknown): IzziUsageStats {
  const summary = ownValue(raw, 'summary');
  return {
    totalCost: num(summary, 'totalCost'),
    totalRequests: num(summary, 'totalRequests'),
    totalInputTokens: num(summary, 'totalInputTokens'),
    totalOutputTokens: num(summary, 'totalOutputTokens'),
    daily: ownArray(raw, 'daily').map((d) => ({ day: str(d, 'day'), cost: num(d, 'cost') })),
    byModel: ownArray(raw, 'byModel').map((m) => ({
      model: str(m, 'model'),
      cost: num(m, 'cost'),
      requests: num(m, 'requests'),
    })),
  };
}

function parseUsageRow(raw: unknown, keyNames: Map<string, string>): IzziUsageRow {
  return {
    id: str(raw, 'id'),
    createdAt: str(raw, 'created_at'),
    model: str(raw, 'model'),
    keyName: keyNames.get(str(raw, 'key_id')) ?? '',
    inputTokens: num(raw, 'input_tokens'),
    outputTokens: num(raw, 'output_tokens'),
    cost: num(raw, 'cost'),
    durationMs: num(raw, 'duration_ms'),
    statusCode: num(raw, 'status_code'),
  };
}

interface Reply {
  /** HTTP status, or 0 when the request threw. */
  status: number;
  raw: unknown;
}

/**
 * One signed-in operation. Holds the token for its requests and refreshes it at
 * most once: AuthManager.refreshAccessToken clears the session on failure, so
 * parallel 401s must share a single refresh.
 */
class Session {
  private refreshing: Promise<string | null> | null = null;

  constructor(
    private readonly auth: AuthManager,
    private token: string,
  ) {}

  async request(op: string, method: string, path: string, body?: unknown): Promise<Reply> {
    const first = await this.send(op, method, path, this.token, body);
    if (first.status !== 401) return first;
    const fresh = await this.refreshOnce();
    if (!fresh) return first;
    return this.send(op, method, path, fresh, body);
  }

  private refreshOnce(): Promise<string | null> {
    this.refreshing ??= (async () => {
      const ok = await this.auth.refreshAccessToken();
      const next = ok ? await this.auth.getAccessToken() : null;
      if (next) this.token = next;
      return next;
    })();
    return this.refreshing;
  }

  private async send(op: string, method: string, path: string, token: string, body?: unknown): Promise<Reply> {
    try {
      const res = await fetch(`${IZZI_API_BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!isOk(res.status)) {
        if (res.status !== 401) console.warn(`[IzziAccountClient] ${op}: request failed (status ${res.status})`);
        return { status: res.status, raw: null };
      }
      return { status: res.status, raw: await res.json() };
    } catch (err) {
      console.warn(`[IzziAccountClient] ${op}: ${shortError(err)}`);
      return { status: 0, raw: null };
    }
  }
}

/** Local cleanup after a server-side change: log and continue so one failure does not hide the rest. */
function bestEffort(step: string, fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch (err) {
    console.warn(`[IzziAccountClient] ${step} failed: ${shortError(err)}`);
    return false;
  }
}

interface ProviderSnapshot {
  key: string | null;
  config: CustomProviderConfig | null;
  enabled: boolean;
}

export class IzziAccountClient {
  constructor(
    private readonly auth: AuthManager,
    private readonly secrets: SecretStore,
    private readonly settings: ProviderSettingsStore,
  ) {}

  async getOverview(): Promise<IzziOverview> {
    const empty: IzziOverview = {
      ok: false,
      balance: null,
      plan: null,
      stats: null,
      keys: null,
      inUseKeyId: null,
      managedKeyId: null,
    };
    const session = await this.openSession();
    if (!session) return { ...empty, reason: 'not-signed-in' };

    const [balance, stats, keys] = await Promise.all([
      session.request('balance', 'GET', '/api/billing/balance'),
      session.request('stats', 'GET', '/api/usage/stats'),
      session.request('keys', 'GET', '/api/keys'),
    ]);
    const reason = failureReason([balance.status, stats.status, keys.status]);
    const parsedKeys = isOk(keys.status) ? parseKeys(keys.raw) : null;
    return {
      ok: reason === undefined,
      ...(reason ? { reason } : {}),
      balance: isOk(balance.status) ? num(balance.raw, 'balance') : null,
      plan: isOk(balance.status) ? str(balance.raw, 'plan') || null : null,
      stats: isOk(stats.status) ? parseStats(stats.raw) : null,
      keys: parsedKeys,
      inUseKeyId: parsedKeys ? matchKeyId(parsedKeys, this.secrets.getKey()) : null,
      managedKeyId: parsedKeys ? matchKeyId(parsedKeys, this.auth.peekDesktopApiKey()) : null,
    };
  }

  async getRecentUsage(offset: number): Promise<IzziUsagePage> {
    const session = await this.openSession();
    if (!session) return { ok: false, reason: 'not-signed-in', rows: [], hasMore: false };

    const safeOffset = Number.isSafeInteger(offset) && offset > 0 ? Math.min(offset, MAX_USAGE_OFFSET) : 0;
    const [usage, keys] = await Promise.all([
      session.request('usage', 'GET', `/api/usage?limit=${USAGE_PAGE_SIZE}&offset=${safeOffset}`),
      session.request('keys', 'GET', '/api/keys'),
    ]);
    if (!isOk(usage.status)) {
      return { ok: false, reason: failureReason([usage.status]), rows: [], hasMore: false };
    }
    const keyNames = new Map(isOk(keys.status) ? parseKeys(keys.raw).map((k) => [k.id, k.name] as const) : []);
    const rows = ownArray(usage.raw, 'usage').map((row) => parseUsageRow(row, keyNames));
    return { ok: true, rows, hasMore: rows.length === USAGE_PAGE_SIZE && safeOffset + rows.length < MAX_USAGE_OFFSET };
  }

  /**
   * Create a key and make it the app's Custom Provider key (izziapi, x-api-key),
   * keeping the user's current model. The raw key is returned once for copying.
   */
  async createKey(name: string): Promise<CreateKeyResult> {
    const trimmed = typeof name === 'string' ? name.trim() : '';
    if (!trimmed || trimmed.length > MAX_KEY_NAME) {
      return { success: false, error: `Tên key phải có 1–${MAX_KEY_NAME} ký tự.` };
    }
    const config = this.izziProviderConfig();
    if (!validateCustomConfig(config).ok) return { success: false, error: GENERIC_ERROR };

    const session = await this.openSession();
    if (!session) return { success: false, error: SIGN_IN_ERROR };

    const res = await session.request('createKey', 'POST', '/api/keys', { name: trimmed });
    const key = ownValue(res.raw, 'key');
    const id = str(res.raw, 'id');
    if (!isOk(res.status)) return { success: false, error: writeErrorMessage(res.status) };
    if (typeof key !== 'string' || !RAW_KEY_PATTERN.test(key) || !id) {
      console.warn('[IzziAccountClient] createKey: malformed response');
      return { success: false, error: GENERIC_ERROR };
    }

    let savedLocally = true;
    let previous: ProviderSnapshot | null = null;
    try {
      previous = {
        key: this.secrets.getKey(),
        config: this.settings.getConfig(),
        enabled: this.settings.isCustomEnabled(),
      };
      this.secrets.setKey(key);
      this.settings.saveConfig(config);
      this.settings.setEnabled(true);
    } catch (err) {
      savedLocally = false;
      console.warn(`[IzziAccountClient] createKey: could not save key locally: ${shortError(err)}`);
      if (previous) this.restoreProvider(previous);
    }
    return { success: true, key, id, name: str(res.raw, 'name') || trimmed, savedLocally };
  }

  /** Revoke a key. Revoking the app's own key also disconnects the Custom Provider. */
  async revokeKey(id: string): Promise<RevokeKeyResult> {
    if (typeof id !== 'string' || !KEY_ID_PATTERN.test(id)) return { success: false, error: GENERIC_ERROR };

    const session = await this.openSession();
    if (!session) return { success: false, error: SIGN_IN_ERROR };

    // Decide "in use" before revoking; if that is unknown, do not revoke at all.
    const keys = await session.request('keys', 'GET', '/api/keys');
    if (!isOk(keys.status)) return { success: false, error: writeErrorMessage(keys.status) };
    const listed = parseKeys(keys.raw);
    const wasInUse = matchKeyId(listed, this.secrets.getKey()) === id;
    const wasManaged = matchKeyId(listed, this.auth.peekDesktopApiKey()) === id;

    const res = await session.request('revokeKey', 'DELETE', `/api/keys/${encodeURIComponent(id)}`);
    if (!isOk(res.status)) return { success: false, error: writeErrorMessage(res.status) };

    if (wasInUse) {
      bestEffort('delete stored key', () => this.secrets.deleteKey());
      bestEffort('disable custom provider', () => this.settings.setEnabled(false));
    }
    if (wasManaged) this.auth.forgetDesktopApiKey();
    return { success: true, wasInUse, wasManaged };
  }

  private async openSession(): Promise<Session | null> {
    const token = await this.auth.getAccessToken();
    return token ? new Session(this.auth, token) : null;
  }

  /** Put back the provider a failed save half-replaced; leave it off unless both parts came back. */
  private restoreProvider(previous: ProviderSnapshot): void {
    const restored = [
      bestEffort('restore key', () =>
        previous.key ? this.secrets.setKey(previous.key) : this.secrets.deleteKey(),
      ),
      bestEffort('restore config', () =>
        previous.config ? this.settings.saveConfig(previous.config) : this.settings.clearConfig(),
      ),
    ].every(Boolean);
    bestEffort('restore enabled', () => this.settings.setEnabled(restored && previous.enabled));
  }

  private izziProviderConfig(): CustomProviderConfig {
    const existing = this.settings.getConfig();
    const keep = existing?.baseUrl?.startsWith(IZZI_API_BASE) ? existing : undefined;
    const config: CustomProviderConfig = {
      baseUrl: `${IZZI_API_BASE}/v1`,
      authType: 'x-api-key',
      selectedModel: keep?.selectedModel?.trim() || DEFAULT_MODEL,
    };
    if (keep?.reasoningEffort) config.reasoningEffort = keep.reasoningEffort;
    return config;
  }
}

/** Keys are listed as `izzi-...<last6>`; match that against a raw key the app holds. */
function matchKeyId(keys: IzziApiKey[], rawKey: string | null | undefined): string | null {
  if (!rawKey || rawKey.length < IN_USE_SUFFIX_LENGTH) return null;
  const suffix = rawKey.slice(-IN_USE_SUFFIX_LENGTH);
  return keys.find((k) => k.status !== 'revoked' && k.prefix.endsWith(suffix))?.id ?? null;
}
