/**
 * Main-process Meta Ads OAuth coordinator. Mirrors `CareFacebookOAuthCoordinator`:
 * keeps pending OAuth states in main only, opens the Facebook dialog, claims matching
 * `openclaw://marketing/oauth/callback` deep links, and buffers/pushes the outcome once.
 *
 * @module main/marketing/marketing-ads-oauth
 */
import type {
  MarketingAdsConnectResult,
  MarketingAdsOAuthEvent,
} from '../../shared/marketing-ads-types';
import type { MarketingAdsService } from './marketing-ads-service';

export const MARKETING_ADS_PENDING_MAX_MS = 15 * 60_000;
export const MARKETING_ADS_PENDING_LIMIT = 4;
const FACEBOOK_DIALOG_ORIGIN = 'https://www.facebook.com/';

interface PendingAdsConnect {
  workspaceId: string;
  identityId: string;
  expiresAtMs: number;
}

interface BufferedAdsOutcome {
  event: MarketingAdsOAuthEvent;
  identityId: string;
  expiresAtMs: number;
}

export interface MarketingAdsOAuthCoordinatorOptions {
  service: Pick<MarketingAdsService, 'beginMetaConnect' | 'completeMetaConnect'>;
  openExternal: (url: string) => Promise<void>;
  notify: (event: MarketingAdsOAuthEvent) => void;
  currentIdentityId: () => string | null;
  now?: () => number;
}

export class MarketingAdsOAuthCoordinator {
  private readonly pending = new Map<string, PendingAdsConnect>();
  private readonly now: () => number;
  private buffered: BufferedAdsOutcome | null = null;

  constructor(private readonly options: MarketingAdsOAuthCoordinatorOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  async connect(): Promise<MarketingAdsConnectResult> {
    const result = await this.options.service.beginMetaConnect();
    if (!result.ok) return result;
    if (!result.authorizeUrl.startsWith(FACEBOOK_DIALOG_ORIGIN)) return { ok: false, error: 'invalid-response' };
    this.buffered = null;

    const now = this.now();
    const backendExpiry = Date.parse(result.expiresAt);
    const ceiling = now + MARKETING_ADS_PENDING_MAX_MS;
    this.prune(now);
    this.pending.set(result.state, {
      workspaceId: result.workspaceId,
      identityId: result.identityId,
      expiresAtMs: Number.isFinite(backendExpiry) ? Math.min(backendExpiry, ceiling) : ceiling,
    });
    while (this.pending.size > MARKETING_ADS_PENDING_LIMIT) {
      const oldest = this.pending.keys().next().value as string;
      this.pending.delete(oldest);
    }
    try {
      await this.options.openExternal(result.authorizeUrl);
      return { ok: true };
    } catch {
      this.pending.delete(result.state);
      return { ok: false, error: 'unavailable' };
    }
  }

  takeOAuthEvent(): MarketingAdsOAuthEvent | null {
    const entry = this.buffered;
    this.buffered = null;
    if (!entry || this.now() >= entry.expiresAtMs) return null;
    let identityId: string | null = null;
    try {
      identityId = this.options.currentIdentityId();
    } catch {
      identityId = null;
    }
    return identityId === entry.identityId ? entry.event : null;
  }

  handleCallbackUrl(url: string): boolean {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'openclaw:' || parsed.hostname !== 'marketing' || parsed.pathname !== '/oauth/callback') {
      return false;
    }
    const state = parsed.searchParams.get('state') ?? '';
    const pending = this.pending.get(state);
    if (!pending) return false;
    this.pending.delete(state);

    const emit = (event: MarketingAdsOAuthEvent) => this.emit(event, pending.identityId);
    if (this.now() >= pending.expiresAtMs) {
      emit({ ok: false, error: 'expired' });
      return true;
    }
    if (parsed.searchParams.has('error')) {
      emit({ ok: false, error: 'declined' });
      return true;
    }
    const platform = parsed.searchParams.get('platform');
    if (platform !== null && platform !== 'facebook' && platform !== 'meta_ads') {
      emit({ ok: false, error: 'rejected' });
      return true;
    }
    const code = parsed.searchParams.get('code') ?? '';
    void this.options.service
      .completeMetaConnect(state, code, { workspaceId: pending.workspaceId, identityId: pending.identityId })
      .then(emit, () => emit({ ok: false, error: 'unavailable' }));
    return true;
  }

  private prune(now: number): void {
    for (const [state, entry] of this.pending) {
      if (now >= entry.expiresAtMs) this.pending.delete(state);
    }
  }

  private emit(event: MarketingAdsOAuthEvent, identityId: string): void {
    const now = this.now();
    this.buffered = {
      event,
      identityId,
      expiresAtMs: now + MARKETING_ADS_PENDING_MAX_MS,
    };
    try {
      this.options.notify(event);
    } catch {
      // Closed window must never crash main.
    }
  }
}
