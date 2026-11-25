import { describe, expect, it, vi } from 'vitest';
import { MarketingAdsClient } from './marketing-ads-client';
import { MarketingAdsService } from './marketing-ads-service';
import { MarketingAdsOAuthCoordinator } from './marketing-ads-oauth';
import { routeMarketingOAuthCallback } from '../customer-care/care-facebook-oauth';
import type { NativeMarketingTokenProvider } from './native-marketing-client';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = 'act_1234567890';
const PAGE_ID = '105252511858057';
const TOKEN = 'test-supabase-token';

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('MarketingAdsClient & MarketingAdsService & OAuth', () => {
  it('rebuilds ads status and overview from allowlist and keeps token in Authorization header only', async () => {
    const statusBody = {
      success: true,
      workspaceId: WORKSPACE,
      providers: {
        facebook_ads: {
          provider: 'facebook_ads',
          label: 'Facebook Ads',
          connected: true,
          status: 'connected',
          connectedAt: '2026-11-25T08:00:00.000Z',
          tokenExpiresAt: null,
          scopes: ['ads_read'],
          adAccounts: [{
            id: ACCOUNT_ID,
            accountId: '1234567890',
            provider: 'facebook_ads',
            name: 'thái mai t6',
            accountStatus: 1,
            currency: 'VND',
            amountSpent: 5000000,
            timezoneName: 'Asia/Ho_Chi_Minh',
            businessName: null,
            enabled: true,
            defaultPageId: PAGE_ID,
            accessToken: 'EAAB-SECRET-LEAK',
          }],
        },
      },
      campaignPageMap: { '12345678': PAGE_ID },
    };

    const fetchImpl = vi.fn(async () => json(statusBody));
    const auth: NativeMarketingTokenProvider = { getAccessToken: async () => TOKEN };
    const client = new MarketingAdsClient(auth, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await client.getStatus(WORKSPACE);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(JSON.stringify(res.value)).not.toContain('EAAB-SECRET-LEAK');
      expect(res.value.providers.facebook_ads.adAccounts[0].name).toBe('thái mai t6');
      expect(res.value.providers.youtube_ads.status).toBe('ready_to_connect');
    }
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('rejects viewer mutations and validates saveMetaAccounts strictly in service', async () => {
    const client = {
      getStatus: vi.fn(),
      startMetaConnect: vi.fn(),
      completeMetaCallback: vi.fn(),
      saveMetaAccounts: vi.fn(),
      disconnectMetaAds: vi.fn(),
      getOverview: vi.fn(),
    };
    const viewerService = new MarketingAdsService({
      client,
      resolveAuthority: async () => ({ identityId: 'u1', workspaceId: WORKSPACE, role: 'viewer' }),
      currentIdentityId: () => 'u1',
    });
    expect(await viewerService.saveMetaAccounts({ accounts: [{ id: ACCOUNT_ID, enabled: true, defaultPageId: PAGE_ID }] }))
      .toEqual({ ok: false, error: 'forbidden' });
    expect(client.saveMetaAccounts).not.toHaveBeenCalled();

    const ownerService = new MarketingAdsService({
      client,
      resolveAuthority: async () => ({ identityId: 'u1', workspaceId: WORKSPACE, role: 'owner' }),
      currentIdentityId: () => 'u1',
    });
    expect(await ownerService.saveMetaAccounts({ accounts: [{ id: 'bad-id', enabled: true, defaultPageId: null }] }))
      .toEqual({ ok: false, error: 'invalid_input' });
    expect(await ownerService.saveMetaAccounts({ campaignPageMap: { 'camp-1': PAGE_ID } }))
      .toEqual({ ok: false, error: 'invalid_input' });
    expect(client.saveMetaAccounts).not.toHaveBeenCalled();

    const viewerOverview = await viewerService.getOverview({});
    expect(viewerOverview).toEqual({ ok: false, error: 'forbidden' });
    const editorService = new MarketingAdsService({
      client: {
        ...client,
        saveMetaAccounts: vi.fn(async () => ({ ok: true as const, value: {} as never })),
        getOverview: vi.fn(async () => ({ ok: true as const, value: {} as never })),
      },
      resolveAuthority: async () => ({ identityId: 'u1', workspaceId: WORKSPACE, role: 'editor' }),
      currentIdentityId: () => 'u1',
    });
    expect((await editorService.getOverview({})).ok).toBe(true);
    expect(await editorService.saveMetaAccounts({ accounts: [{ id: ACCOUNT_ID, enabled: true, defaultPageId: PAGE_ID }] }))
      .toEqual({ ok: false, error: 'forbidden' });
    expect((await editorService.saveMetaAccounts({ campaignPageMap: { '12345678': PAGE_ID } })).ok).toBe(true);
  });

  it('routes openclaw://marketing/oauth/callback to MarketingAds after Care', async () => {
    const state = 'ads-state-1234567890abcdef';
    const code = 'ads-code-1234567890abcdef';
    const notify = vi.fn();
    const coordinator = new MarketingAdsOAuthCoordinator({
      service: {
        beginMetaConnect: async () => ({
          ok: true,
          workspaceId: WORKSPACE,
          identityId: 'u1',
          state,
          expiresAt: '2099-01-01T00:00:00.000Z',
          authorizeUrl: `https://www.facebook.com/v20.0/dialog/oauth?state=${state}`,
        }),
        completeMetaConnect: async () => ({
          ok: true,
          workspaceId: WORKSPACE,
          adAccounts: [],
          scopes: ['ads_read'],
        }),
      },
      openExternal: async () => undefined,
      notify,
      currentIdentityId: () => 'u1',
    });

    expect(await coordinator.connect()).toEqual({ ok: true });
    const care = { handleCallbackUrl: () => false };
    const marketing = vi.fn();
    const route = routeMarketingOAuthCallback(
      `openclaw://marketing/oauth/callback?state=${state}&code=${code}&platform=facebook`,
      care,
      marketing,
      coordinator,
    );
    expect(route).toBe('marketing-ads');
    expect(marketing).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(coordinator.takeOAuthEvent()).toEqual({
      ok: true,
      workspaceId: WORKSPACE,
      adAccounts: [],
      scopes: ['ads_read'],
    });
    expect(coordinator.takeOAuthEvent()).toBeNull();
  });
});
