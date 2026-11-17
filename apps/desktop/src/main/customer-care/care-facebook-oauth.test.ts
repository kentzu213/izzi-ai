import { describe, expect, it, vi } from 'vitest';
import type { CustomerCareFacebookChoicesEvent } from '../../shared/customer-care-types';
import type { CustomerCareFacebookBeginResult } from './customer-care-service';
import {
  CARE_FACEBOOK_PENDING_LIMIT,
  CARE_FACEBOOK_PENDING_MAX_MS,
  CareFacebookOAuthCoordinator,
  routeMarketingOAuthCallback,
} from './care-facebook-oauth';

const NOW = Date.parse('2026-11-17T00:00:00.000Z');
const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const IDENTITY = 'user-aaaa-1111';
const STATE = 'care-state-0123456789abcdef';
const CODE = 'provider-code-0123456789';
const AUTHORIZE_URL = `https://www.facebook.com/v26.0/dialog/oauth?state=${STATE}`;
const CHOICES: CustomerCareFacebookChoicesEvent = {
  ok: true,
  choiceId: '33333333-3333-4333-8333-333333333333',
  expiresAt: '2026-11-17T00:15:00.000Z',
  pages: [],
  missingScopes: [],
};

function begun(state = STATE, expiresAt = '2026-11-17T00:10:00.000Z'): CustomerCareFacebookBeginResult {
  return {
    ok: true,
    workspaceId: WORKSPACE,
    identityId: IDENTITY,
    state,
    expiresAt,
    authorizeUrl: `https://www.facebook.com/v26.0/dialog/oauth?state=${state}`,
  };
}

function callbackUrl(params: Record<string, string>): string {
  return `openclaw://marketing/oauth/callback?${new URLSearchParams(params).toString()}`;
}

function fixture(begin: CustomerCareFacebookBeginResult = begun()) {
  const clock = { now: NOW, identity: IDENTITY as string | null };
  const service = {
    beginFacebookConnect: vi.fn(async () => begin),
    completeFacebookConnect: vi.fn(async () => CHOICES),
  };
  const openExternal = vi.fn(async (_url: string) => {});
  const notify = vi.fn((_event: CustomerCareFacebookChoicesEvent) => {});
  const coordinator = new CareFacebookOAuthCoordinator({
    service,
    openExternal,
    notify,
    now: () => clock.now,
    currentIdentityId: () => clock.identity,
  });
  return { coordinator, service, openExternal, notify, clock };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('CareFacebookOAuthCoordinator connect', () => {
  it('opens the Facebook dialog and tells the renderer only that it started', async () => {
    const { coordinator, openExternal } = fixture();
    const result = await coordinator.connect();
    expect(result).toEqual({ ok: true });
    expect(openExternal).toHaveBeenCalledWith(AUTHORIZE_URL);
    expect(JSON.stringify(result)).not.toContain(STATE);
  });

  it('passes a refused connect through without opening anything', async () => {
    const { coordinator, openExternal } = fixture({ ok: false, error: 'forbidden' });
    expect(await coordinator.connect()).toEqual({ ok: false, error: 'forbidden' });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('never opens a URL outside the Facebook dialog origin', async () => {
    const { coordinator, openExternal } = fixture({ ...begun(), authorizeUrl: 'https://evil.example.com/?x' } as CustomerCareFacebookBeginResult);
    expect(await coordinator.connect()).toEqual({ ok: false, error: 'invalid-response' });
    expect(openExternal).not.toHaveBeenCalled();
    expect(coordinator.handleCallbackUrl(callbackUrl({ state: STATE, code: CODE }))).toBe(false);
  });

  it('forgets the pending state when the browser cannot be opened', async () => {
    const { coordinator, openExternal, service } = fixture();
    openExternal.mockRejectedValueOnce(new Error('no browser'));
    expect(await coordinator.connect()).toEqual({ ok: false, error: 'unavailable' });
    expect(coordinator.handleCallbackUrl(callbackUrl({ state: STATE, code: CODE }))).toBe(false);
    expect(service.completeFacebookConnect).not.toHaveBeenCalled();
  });

  it('keeps a bounded number of pending connects, dropping the oldest', async () => {
    const { coordinator, service } = fixture();
    const states = Array.from({ length: CARE_FACEBOOK_PENDING_LIMIT + 1 }, (_, index) => `care-state-${index}-0123456789abcdef`);
    for (const state of states) {
      service.beginFacebookConnect.mockResolvedValueOnce(begun(state));
      await coordinator.connect();
    }
    expect(coordinator.handleCallbackUrl(callbackUrl({ state: states[0], code: CODE }))).toBe(false);
    expect(coordinator.handleCallbackUrl(callbackUrl({ state: states[states.length - 1], code: CODE }))).toBe(true);
  });
});

describe('CareFacebookOAuthCoordinator deep link', () => {
  it('completes a Care state with the binding it was minted under and pushes the choices', async () => {
    const { coordinator, service, notify } = fixture();
    await coordinator.connect();

    expect(coordinator.handleCallbackUrl(callbackUrl({ platform: 'facebook', state: STATE, code: CODE }))).toBe(true);
    await flush();

    expect(service.completeFacebookConnect).toHaveBeenCalledWith(STATE, CODE, { workspaceId: WORKSPACE, identityId: IDENTITY });
    expect(notify).toHaveBeenCalledWith(CHOICES);
  });

  it('consumes a Care state once; a replay is not handled', async () => {
    const { coordinator, service } = fixture();
    await coordinator.connect();
    expect(coordinator.handleCallbackUrl(callbackUrl({ state: STATE, code: CODE }))).toBe(true);
    expect(coordinator.handleCallbackUrl(callbackUrl({ state: STATE, code: CODE }))).toBe(false);
    await flush();
    expect(service.completeFacebookConnect).toHaveBeenCalledTimes(1);
  });

  it('leaves unknown states and other links to the caller', async () => {
    const { coordinator, service, notify } = fixture();
    await coordinator.connect();
    expect(coordinator.handleCallbackUrl(callbackUrl({ state: 'marketing-state-0123456789', code: CODE }))).toBe(false);
    expect(coordinator.handleCallbackUrl(`openclaw://auth/callback?state=${STATE}&code=${CODE}`)).toBe(false);
    expect(coordinator.handleCallbackUrl(`openclaw://marketing/other?state=${STATE}&code=${CODE}`)).toBe(false);
    expect(coordinator.handleCallbackUrl('not a url')).toBe(false);
    expect(service.completeFacebookConnect).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(coordinator.handleCallbackUrl(callbackUrl({ state: STATE, code: CODE }))).toBe(true);
  });

  it('reports an expired pending state without calling the backend', async () => {
    const { coordinator, service, notify, clock } = fixture();
    await coordinator.connect();
    clock.now = Date.parse('2026-11-17T00:10:00.000Z');
    expect(coordinator.handleCallbackUrl(callbackUrl({ state: STATE, code: CODE }))).toBe(true);
    expect(notify).toHaveBeenCalledWith({ ok: false, error: 'expired' });
    expect(service.completeFacebookConnect).not.toHaveBeenCalled();
  });

  it('caps a far-future backend expiry at the local maximum', async () => {
    const { coordinator, notify, clock } = fixture(begun(STATE, '2027-01-01T00:00:00.000Z'));
    await coordinator.connect();
    clock.now = NOW + CARE_FACEBOOK_PENDING_MAX_MS;
    expect(coordinator.handleCallbackUrl(callbackUrl({ state: STATE, code: CODE }))).toBe(true);
    expect(notify).toHaveBeenCalledWith({ ok: false, error: 'expired' });
  });

  it('treats a provider error parameter as a decline', async () => {
    const { coordinator, service, notify } = fixture();
    await coordinator.connect();
    expect(coordinator.handleCallbackUrl(callbackUrl({ state: STATE, error: 'access_denied', code: CODE }))).toBe(true);
    expect(notify).toHaveBeenCalledWith({ ok: false, error: 'declined' });
    expect(service.completeFacebookConnect).not.toHaveBeenCalled();
  });

  it('rejects a Care state relayed for another platform', async () => {
    const { coordinator, service, notify } = fixture();
    await coordinator.connect();
    expect(coordinator.handleCallbackUrl(callbackUrl({ platform: 'youtube', state: STATE, code: CODE }))).toBe(true);
    expect(notify).toHaveBeenCalledWith({ ok: false, error: 'rejected' });
    expect(service.completeFacebookConnect).not.toHaveBeenCalled();
  });

  it('reports unavailable when completing throws', async () => {
    const { coordinator, service, notify } = fixture();
    service.completeFacebookConnect.mockRejectedValueOnce(new Error('private'));
    await coordinator.connect();
    coordinator.handleCallbackUrl(callbackUrl({ state: STATE, code: CODE }));
    await flush();
    expect(notify).toHaveBeenCalledWith({ ok: false, error: 'unavailable' });
  });
});

describe('CareFacebookOAuthCoordinator outcome buffer', () => {
  async function completed(params: Record<string, string> = { state: STATE, code: CODE }) {
    const context = fixture();
    await context.coordinator.connect();
    context.coordinator.handleCallbackUrl(callbackUrl(params));
    await flush();
    return context;
  }

  it('keeps the latest outcome for a Care page opened later and hands it out once', async () => {
    const { coordinator, notify } = await completed();
    expect(notify).toHaveBeenCalledWith(CHOICES);
    expect(coordinator.takeChoices()).toEqual(CHOICES);
    expect(coordinator.takeChoices()).toBeNull();
  });

  it('is empty before any deep link', () => {
    expect(fixture().coordinator.takeChoices()).toBeNull();
  });

  it('overwrites an older outcome with a newer one', async () => {
    const { coordinator, service } = fixture();
    const first = 'care-state-first-0123456789';
    const second = 'care-state-second-0123456789';
    service.beginFacebookConnect.mockResolvedValueOnce(begun(first)).mockResolvedValueOnce(begun(second));
    await coordinator.connect();
    await coordinator.connect();
    coordinator.handleCallbackUrl(callbackUrl({ state: first, error: 'access_denied' }));
    coordinator.handleCallbackUrl(callbackUrl({ state: second, code: CODE }));
    await flush();
    expect(coordinator.takeChoices()).toEqual(CHOICES);
  });

  it('expires a Page list at its choice expiry', async () => {
    const { coordinator, clock } = await completed();
    clock.now = Date.parse(CHOICES.ok ? CHOICES.expiresAt : '') - 1;
    expect(coordinator.takeChoices()).toEqual(CHOICES);

    const later = await completed();
    later.clock.now = Date.parse(CHOICES.ok ? CHOICES.expiresAt : '');
    expect(later.coordinator.takeChoices()).toBeNull();
  });

  it('expires a failure outcome after 15 minutes', async () => {
    const declined = { ok: false, error: 'declined' };
    const kept = await completed({ state: STATE, error: 'access_denied' });
    kept.clock.now = NOW + CARE_FACEBOOK_PENDING_MAX_MS - 1;
    expect(kept.coordinator.takeChoices()).toEqual(declined);

    const stale = await completed({ state: STATE, error: 'access_denied' });
    stale.clock.now = NOW + CARE_FACEBOOK_PENDING_MAX_MS;
    expect(stale.coordinator.takeChoices()).toBeNull();
  });

  it('never hands an outcome to a different or signed-out account', async () => {
    const switched = await completed();
    switched.clock.identity = 'user-bbbb-2222';
    expect(switched.coordinator.takeChoices()).toBeNull();
    switched.clock.identity = IDENTITY;
    expect(switched.coordinator.takeChoices()).toBeNull();

    const signedOut = await completed();
    signedOut.clock.identity = null;
    expect(signedOut.coordinator.takeChoices()).toBeNull();
  });

  it('discards a buffered outcome when a new connect starts', async () => {
    const { coordinator } = await completed();
    await coordinator.connect();
    expect(coordinator.takeChoices()).toBeNull();
  });
});

describe('routeMarketingOAuthCallback', () => {
  it('routes a Care state to Care and everything else to Native Marketing', async () => {
    const { coordinator } = fixture();
    await coordinator.connect();
    const marketing = vi.fn();

    expect(routeMarketingOAuthCallback(callbackUrl({ state: STATE, code: CODE }), coordinator, marketing)).toBe('care');
    expect(marketing).not.toHaveBeenCalled();

    const marketingUrl = callbackUrl({ state: 'marketing-state-0123456789', code: CODE });
    expect(routeMarketingOAuthCallback(marketingUrl, coordinator, marketing)).toBe('marketing');
    expect(marketing).toHaveBeenCalledWith(marketingUrl);

    expect(routeMarketingOAuthCallback(marketingUrl, null, marketing)).toBe('marketing');
    expect(marketing).toHaveBeenCalledTimes(2);
  });
});
