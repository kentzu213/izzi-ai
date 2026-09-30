/**
 * AffiliateClient — HTTP layer for the desktop Affiliate surface. Lives in the
 * Electron MAIN process; the JWT never leaves main (same contract as GraphClient).
 *
 * Mirrors the izziapi.com web dashboard (`/dashboard/affiliate`), hitting the
 * shared backend `/api/affiliate/*` at IZZI_API_BASE. This is a MONEY flow
 * (commissions + withdrawals), so every call is fail-closed:
 *   - no token            → safe empty result, no backend call
 *   - 401 / non-OK / throw → safe empty result, never throws to the renderer
 *   - diagnostics log ONLY the op type + HTTP status, never the token or amounts
 */

import type { AuthManager } from '../auth/auth-manager';
import { IZZI_API_BASE, IZZI_WEB_BASE } from '../config/public-config';

// ── Public DTOs (mirrored from the web dashboard) ──────────────────────────

export interface AffiliateStats {
  code: string;
  referralLink: string;
  totalReferrals: number;
  pendingVnd: number;
  availableVnd: number;
  paidVnd: number;
  totalEarningsVnd: number;
}

export interface AffiliateCommission {
  id: string;
  referred_email: string;
  amount_vnd: number;
  commission_vnd: number;
  status: string;
  available_at: string;
  created_at: string;
}

export interface AffiliateWithdrawal {
  id: string;
  amount_vnd: number;
  method: string;
  status: string;
  created_at: string;
  admin_note?: string;
}

export interface WithdrawInput {
  amount: number;
  method: 'bank_transfer' | 'credit_convert';
  bankInfo?: { bank: string; accountNo: string; accountName: string };
}

export type MutationResult =
  | { success: true; creditsAdded?: number }
  | { success: false; error: string };

/** Minimum withdrawal, matching the web dashboard (500,000 VND). */
export const MIN_WITHDRAW_VND = 500000;

const WITHDRAW_METHODS: ReadonlySet<unknown> = new Set(['bank_transfer', 'credit_convert']);
const ACCOUNT_NO_PATTERN = /^\d{6,20}$/;
const MAX_BANK_TEXT = 100;

// ── Helpers (no prototype-chain reads; token-free diagnostics) ─────────────

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
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function str(raw: unknown, key: string): string {
  const v = ownValue(raw, key);
  return typeof v === 'string' ? v : '';
}

/**
 * Check bank transfer details before they leave the app.
 * Returns a user-facing error, or null when the trimmed fields are well-formed.
 */
export function bankInfoError(info: unknown): string | null {
  const bank = str(info, 'bank').trim();
  const accountNo = str(info, 'accountNo').trim();
  const accountName = str(info, 'accountName').trim();
  if (!bank || !accountNo || !accountName) return 'Vui lòng nhập đủ thông tin ngân hàng';
  if (!ACCOUNT_NO_PATTERN.test(accountNo)) return 'Số tài khoản chỉ gồm 6–20 chữ số';
  if (bank.length > MAX_BANK_TEXT || accountName.length > MAX_BANK_TEXT) {
    return 'Tên ngân hàng hoặc chủ tài khoản quá dài';
  }
  return null;
}

interface PostResult {
  status: number;
  raw: unknown;
}

const GENERIC_MUTATION_ERROR = 'Yêu cầu thất bại';
const REJECTED_STATUSES: ReadonlySet<number> = new Set([400, 409, 422]);

/** Fixed, user-facing text for a failed write. Chosen by HTTP status only, never by backend text. */
export function mutationErrorMessage(status: number): string {
  if (status === 401 || status === 403) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  if (status === 429) return 'Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại.';
  if (REJECTED_STATUSES.has(status)) {
    return 'Yêu cầu bị từ chối. Kiểm tra số tiền, số dư khả dụng và thông tin nhận tiền rồi thử lại.';
  }
  return GENERIC_MUTATION_ERROR;
}

/**
 * Log only the error class (ledger #25). `message` can carry backend text: `res.json()` on an
 * HTML error page throws a SyntaxError that quotes the body, and network errors quote hosts.
 */
export function shortError(err: unknown): string {
  return err instanceof Error ? (err.name || 'Error').slice(0, 50) : 'error';
}

export class AffiliateClient {
  constructor(private readonly auth: AuthManager) {}

  // ── Reads ────────────────────────────────────────────────────────────────

  /**
   * GET /api/affiliate/code + /stats → merged AffiliateStats.
   * Returns null on no-auth / error (renderer shows the empty state).
   */
  async getStats(): Promise<AffiliateStats | null> {
    const token = await this.auth.getAccessToken();
    if (token == null) return null;

    try {
      const [codeRaw, statsRaw] = await Promise.all([
        this.get(token, '/api/affiliate/code'),
        this.get(token, '/api/affiliate/stats'),
      ]);
      if (codeRaw == null || statsRaw == null) return null;
      if (ownValue(codeRaw, 'success') !== true || ownValue(statsRaw, 'success') !== true) return null;

      return {
        code: str(codeRaw, 'code'),
        referralLink: str(codeRaw, 'referralLink'),
        totalReferrals: num(statsRaw, 'totalReferrals'),
        pendingVnd: num(statsRaw, 'pendingVnd'),
        availableVnd: num(statsRaw, 'availableVnd'),
        paidVnd: num(statsRaw, 'paidVnd'),
        totalEarningsVnd: num(statsRaw, 'totalEarningsVnd'),
      };
    } catch (err) {
      this.logFailure('affiliate.getStats', undefined, shortError(err));
      return null;
    }
  }

  /** GET /api/affiliate/commissions → AffiliateCommission[] (empty on no-auth / error). */
  async listCommissions(): Promise<AffiliateCommission[]> {
    const token = await this.auth.getAccessToken();
    if (token == null) return [];

    try {
      const raw = await this.get(token, '/api/affiliate/commissions');
      return ownArray(raw, 'commissions').map((c) => ({
        id: str(c, 'id'),
        referred_email: str(c, 'referred_email'),
        amount_vnd: num(c, 'amount_vnd'),
        commission_vnd: num(c, 'commission_vnd'),
        status: str(c, 'status'),
        available_at: str(c, 'available_at'),
        created_at: str(c, 'created_at'),
      }));
    } catch (err) {
      this.logFailure('affiliate.listCommissions', undefined, shortError(err));
      return [];
    }
  }

  /** GET /api/affiliate/withdrawals → AffiliateWithdrawal[] (empty on no-auth / error). */
  async listWithdrawals(): Promise<AffiliateWithdrawal[]> {
    const token = await this.auth.getAccessToken();
    if (token == null) return [];

    try {
      const raw = await this.get(token, '/api/affiliate/withdrawals');
      return ownArray(raw, 'withdrawals').map((w) => ({
        id: str(w, 'id'),
        amount_vnd: num(w, 'amount_vnd'),
        method: str(w, 'method'),
        status: str(w, 'status'),
        created_at: str(w, 'created_at'),
        admin_note: str(w, 'admin_note') || undefined,
      }));
    } catch (err) {
      this.logFailure('affiliate.listWithdrawals', undefined, shortError(err));
      return [];
    }
  }

  // ── Writes (money flow — fail-closed, never throw) ─────────────────────────

  /** POST /api/affiliate/withdraw. Enforces the min amount before calling. */
  async withdraw(input: WithdrawInput): Promise<MutationResult> {
    // The IPC payload is only a compile-time cast; read it through own-property guards.
    const amount = ownValue(input, 'amount');
    const method = ownValue(input, 'method');
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount < MIN_WITHDRAW_VND) {
      return { success: false, error: `Tối thiểu ${MIN_WITHDRAW_VND.toLocaleString('vi-VN')} VND` };
    }
    if (!WITHDRAW_METHODS.has(method)) return { success: false, error: 'Phương thức không hợp lệ' };
    const bankInfo = ownValue(input, 'bankInfo');
    if (method === 'bank_transfer') {
      const bankError = bankInfoError(bankInfo);
      if (bankError) return { success: false, error: bankError };
    }
    const token = await this.auth.getAccessToken();
    if (token == null) return { success: false, error: 'Chưa đăng nhập' };

    try {
      const body: Record<string, unknown> = { amount, method };
      if (method === 'bank_transfer') {
        body.bankInfo = {
          bank: str(bankInfo, 'bank').trim(),
          accountNo: str(bankInfo, 'accountNo').trim(),
          accountName: str(bankInfo, 'accountName').trim(),
        };
      }
      return this.toMutationResult(await this.post(token, '/api/affiliate/withdraw', body));
    } catch (err) {
      this.logFailure('affiliate.withdraw', undefined, shortError(err));
      return { success: false, error: 'Yêu cầu thất bại' };
    }
  }

  /** POST /api/affiliate/convert-credit. Converts available VND to API credits. */
  async convertCredit(amount: number): Promise<MutationResult> {
    if (!Number.isFinite(amount) || amount < MIN_WITHDRAW_VND) {
      return { success: false, error: `Tối thiểu ${MIN_WITHDRAW_VND.toLocaleString('vi-VN')} VND` };
    }
    const token = await this.auth.getAccessToken();
    if (token == null) return { success: false, error: 'Chưa đăng nhập' };

    try {
      const response = await this.post(token, '/api/affiliate/convert-credit', { amount });
      const result = this.toMutationResult(response);
      if (result.success) {
        const added = ownValue(response.raw, 'creditsAdded');
        if (typeof added === 'number') result.creditsAdded = added;
      }
      return result;
    } catch (err) {
      this.logFailure('affiliate.convertCredit', undefined, shortError(err));
      return { success: false, error: 'Yêu cầu thất bại' };
    }
  }

  /** Open the full affiliate dashboard on the web (same account/data) in the browser. */
  affiliateWebUrl(): string {
    return `${IZZI_WEB_BASE}/dashboard/affiliate`;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async get(token: string, path: string): Promise<unknown> {
    const res = await fetch(`${IZZI_API_BASE}${path}`, { headers: this.authHeaders(token) });
    if (res.status === 401) return null; // fail-closed, no anonymous retry
    if (!res.ok) {
      this.logFailure(`GET ${path}`, res.status);
      return null;
    }
    return res.json();
  }

  private async post(token: string, path: string, body: unknown): Promise<PostResult> {
    const res = await fetch(`${IZZI_API_BASE}${path}`, {
      method: 'POST',
      headers: this.authHeaders(token),
      body: JSON.stringify(body),
    });
    // For writes we still read the body: the backend returns {success:true, ...} on success.
    let raw: unknown = null;
    try {
      raw = await res.json();
    } catch {
      raw = null;
    }
    // Log only op + status. The backend error text is never logged: it may echo amounts or bank info.
    if (!res.ok) this.logFailure(`POST ${path}`, res.status);
    return { status: res.status, raw };
  }

  /**
   * The backend `error` text is never passed to the renderer (ledger #25): it can carry stack
   * traces, HTML or internal detail. The UI gets a fixed message chosen by HTTP status only.
   */
  private toMutationResult({ status, raw }: PostResult): MutationResult {
    if (ownValue(raw, 'success') === true) return { success: true };
    return { success: false, error: mutationErrorMessage(status) };
  }

  /** Build request headers. The token lives only here, never crosses IPC. */
  private authHeaders(token: string): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  }

  /** Record a diagnostic — op type + HTTP status only, never token / amounts. */
  private logFailure(type: string, status?: number, message?: string): void {
    const detail = status !== undefined ? `request failed (status ${status})` : message ?? 'request failed';
    console.warn(`[AffiliateClient] ${type}: ${detail}`);
  }
}
