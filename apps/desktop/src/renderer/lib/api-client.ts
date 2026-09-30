/**
 * OpenClaw API Client — Renderer-side HTTP client
 * Used in browser dev mode (no Electron) to call APIs directly
 * In Electron mode, IPC is preferred via window.electronAPI
 */

import { DEFAULT_MARKETPLACE_URL, normalizeMarketplaceUrl } from '../../shared/marketplace-url';

// Ledger #11: same default and normalisation as the main resolver. The renderer cannot read
// main's env overrides (OPENCLAW_MARKETPLACE_URL) without a new IPC/preload channel.
export const MARKETPLACE_API = normalizeMarketplaceUrl(DEFAULT_MARKETPLACE_URL);
// Owner decision pending: the official base (OPENCLAW_API_URL in main/config/public-config.ts) is
// main-only (fs + process.env), and the four methods below have no renderer callers, so it stays as is.
const IZZI_API = 'http://localhost:8787';

/**
 * Ledger #11: the backend `error` text can carry HTML, stack traces or echoed input, so the
 * renderer only ever shows fixed text picked by HTTP status (same pattern as affiliate #25).
 */
export function marketplaceErrorMessage(status: number): string {
  if (status === 401 || status === 403) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
  if (status === 429) return 'Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại.';
  if (status === 400 || status === 409 || status === 422) return 'Yêu cầu bị từ chối. Kiểm tra thông tin rồi thử lại.';
  if (status === 404) return 'Không tìm thấy dữ liệu.';
  return 'Yêu cầu thất bại';
}

class StorizziApiClient {
  private accessToken: string | null = null;

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  /**
   * The Authorization header from the same token the private `fetch` uses, without
   * Content-Type, so a multipart upload can send it too. Empty when no token is set.
   */
  authHeaders(): Record<string, string> {
    return this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {};
  }

  private async fetch(baseUrl: string, path: string, options: RequestInit = {}) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const res = await fetch(`${baseUrl}${path}`, { ...options, headers });

    if (!res.ok) {
      throw new Error(marketplaceErrorMessage(res.status));
    }

    return res.json();
  }

  // ── Marketplace API (port 8788) ──

  async getMarketplaceExtensions(params?: {
    search?: string;
    category?: string;
    page?: number;
    limit?: number;
    sort?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.search) query.set('q', params.search);
    if (params?.category) query.set('category', params.category);
    if (params?.page) query.set('page', String(params.page));
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.sort) query.set('sort', params.sort);
    const qs = query.toString();
    return this.fetch(MARKETPLACE_API, `/api/extensions${qs ? `?${qs}` : ''}`);
  }

  async getExtensionDetail(id: string) {
    return this.fetch(MARKETPLACE_API, `/api/extensions/${id}`);
  }

  async getCategories() {
    return this.fetch(MARKETPLACE_API, '/api/extensions/categories');
  }

  async installExtension(id: string) {
    return this.fetch(MARKETPLACE_API, `/api/extensions/${id}/install`, { method: 'POST' });
  }

  async getExtensionReviews(id: string) {
    return this.fetch(MARKETPLACE_API, `/api/extensions/${id}/reviews`);
  }

  async submitReview(extensionId: string, rating: number, comment: string) {
    return this.fetch(MARKETPLACE_API, `/api/extensions/${extensionId}/reviews`, {
      method: 'POST',
      body: JSON.stringify({ rating, comment }),
    });
  }

  // ── Developer APIs ──

  async registerDeveloper(data: { company_name: string; website?: string; bio?: string }) {
    return this.fetch(MARKETPLACE_API, '/api/developers/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getDeveloperDashboard() {
    return this.fetch(MARKETPLACE_API, '/api/developers/me');
  }

  async publishExtension(data: {
    name: string;
    display_name: string;
    description: string;
    version: string;
    category: string;
    icon_url?: string;
    price_monthly?: number;
    price_yearly?: number;
  }) {
    return this.fetch(MARKETPLACE_API, '/api/extensions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ── IzziAPI Backend (port 8787) ──

  async getProfile() {
    return this.fetch(IZZI_API, '/api/auth/me');
  }

  async getApiKeys() {
    return this.fetch(IZZI_API, '/api/keys');
  }

  async getUsage() {
    return this.fetch(IZZI_API, '/api/usage');
  }

  async getBilling() {
    return this.fetch(IZZI_API, '/api/billing');
  }

  // ── Health check ──

  async checkMarketplaceHealth(): Promise<boolean> {
    try {
      const res = await fetch(`${MARKETPLACE_API}/`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

export const apiClient = new StorizziApiClient();
