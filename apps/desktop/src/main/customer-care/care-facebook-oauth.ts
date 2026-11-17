/**
 * Main-process Care Facebook Login coordinator. Keeps the pending OAuth states (never sent to the
 * renderer), opens the Facebook dialog and claims `openclaw://marketing/oauth/callback` deep links whose
 * state it minted; every other state is left to the Native Marketing handler. The latest outcome is
 * also buffered, so a Care page opened after Facebook Login finished can still take it (once).
 *
 * @module main/customer-care/care-facebook-oauth
 */
import type {
  CustomerCareFacebookChoicesEvent,
  CustomerCareFacebookConnectResult,
} from '../../shared/customer-care-types';
import type { CustomerCareService } from './customer-care-service';

/** Local ceiling for a pending connect and a buffered outcome, whatever expiry the backend reports. */
export const CARE_FACEBOOK_PENDING_MAX_MS = 15 * 60_000;
export const CARE_FACEBOOK_PENDING_LIMIT = 4;
const FACEBOOK_DIALOG_ORIGIN = 'https://www.facebook.com/';

interface PendingCareConnect {
  workspaceId: string;
  identityId: string;
  expiresAtMs: number;
}

interface BufferedOutcome {
  event: CustomerCareFacebookChoicesEvent;
  /** The account the connect was started under; another account never receives it. */
  identityId: string;
  expiresAtMs: number;
}

export interface CareFacebookOAuthCoordinatorOptions {
  service: Pick<CustomerCareService, 'beginFacebookConnect' | 'completeFacebookConnect'>;
  openExternal: (url: string) => Promise<void>;
  /** Pushes the deep-link outcome to the renderer (`customerCare:facebookPageChoices`). */
  notify: (event: CustomerCareFacebookChoicesEvent) => void;
  /** The signed-in identity; a buffered outcome is only handed to the account that started the connect. */
  currentIdentityId: () => string | null;
  now?: () => number;
}

export class CareFacebookOAuthCoordinator {
  private readonly pending = new Map<string, PendingCareConnect>();
  private readonly now: () => number;
  private buffered: BufferedOutcome | null = null;

  constructor(private readonly options: CareFacebookOAuthCoordinatorOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  /** Starts Facebook Login in the system browser. The renderer learns only whether it started. */
  async connect(): Promise<CustomerCareFacebookConnectResult> {
    const result = await this.options.service.beginFacebookConnect();
    if (!result.ok) return result;
    if (!result.authorizeUrl.startsWith(FACEBOOK_DIALOG_ORIGIN)) return { ok: false, error: 'invalid-response' };
    // A new attempt supersedes any outcome still waiting from an earlier one.
    this.buffered = null;

    const now = this.now();
    const backendExpiry = Date.parse(result.expiresAt);
    const ceiling = now + CARE_FACEBOOK_PENDING_MAX_MS;
    this.prune(now);
    this.pending.set(result.state, {
      workspaceId: result.workspaceId,
      identityId: result.identityId,
      expiresAtMs: Number.isFinite(backendExpiry) ? Math.min(backendExpiry, ceiling) : ceiling,
    });
    while (this.pending.size > CARE_FACEBOOK_PENDING_LIMIT) {
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

  /**
   * Hands out the buffered outcome once and clears it. Expired outcomes, and outcomes of a connect
   * started by another (or no) signed-in account, are dropped instead.
   */
  takeChoices(): CustomerCareFacebookChoicesEvent | null {
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

  /**
   * Returns true when the link carried a Care state (consumed here, outcome pushed via `notify`);
   * false leaves the link untouched for the Native Marketing handler.
   */
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

    const emit = (event: CustomerCareFacebookChoicesEvent) => this.emit(event, pending.identityId);
    if (this.now() >= pending.expiresAtMs) {
      emit({ ok: false, error: 'expired' });
      return true;
    }
    if (parsed.searchParams.has('error')) {
      emit({ ok: false, error: 'declined' });
      return true;
    }
    const platform = parsed.searchParams.get('platform');
    if (platform !== null && platform !== 'facebook') {
      emit({ ok: false, error: 'rejected' });
      return true;
    }
    const code = parsed.searchParams.get('code') ?? '';
    void this.options.service
      .completeFacebookConnect(state, code, { workspaceId: pending.workspaceId, identityId: pending.identityId })
      .then(emit, () => emit({ ok: false, error: 'unavailable' }));
    return true;
  }

  private prune(now: number): void {
    for (const [state, entry] of this.pending) {
      if (now >= entry.expiresAtMs) this.pending.delete(state);
    }
  }

  /** Buffers the outcome (a Page list until its choice expiry, a failure for 15 minutes), then pushes it live. */
  private emit(event: CustomerCareFacebookChoicesEvent, identityId: string): void {
    const now = this.now();
    const ceiling = now + CARE_FACEBOOK_PENDING_MAX_MS;
    const choiceExpiry = event.ok ? Date.parse(event.expiresAt) : Number.NaN;
    this.buffered = {
      event,
      identityId,
      expiresAtMs: Number.isFinite(choiceExpiry) ? Math.min(choiceExpiry, ceiling) : ceiling,
    };
    try {
      this.options.notify(event);
    } catch {
      // A closed window must not turn a deep link into a main-process crash.
    }
  }
}

/** Care claims the shared Marketing OAuth deep link first when the state is its own. */
export function routeMarketingOAuthCallback(
  url: string,
  care: Pick<CareFacebookOAuthCoordinator, 'handleCallbackUrl'> | null,
  marketing: (url: string) => void,
): 'care' | 'marketing' {
  if (care?.handleCallbackUrl(url)) return 'care';
  marketing(url);
  return 'marketing';
}
