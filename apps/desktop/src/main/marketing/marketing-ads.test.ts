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

  it('parses mixed-currency FX metadata, attributed CRM metrics, and native USD campaign spend from overview payload', async () => {
    const overviewBody = {
      success: true,
      workspaceId: WORKSPACE,
      datePreset: 'last_7d',
      platform: 'all',
      accountId: null,
      pageId: null,
      reportingCurrency: 'VND',
      fxRates: { USD: 25450 },
      hasMixedCurrencies: true,
      syncedAt: '2026-11-26T08:00:00.000Z',
      cached: false,
      connectedProviders: ['facebook_ads'],
      blended: {
        spend: 6_299_678,
        impressions: 50_000,
        clicks: 1130,
        reach: 28_000,
        ctr: 2.26,
        cpc: 5575,
        cpm: 125_994,
        messagingConversations: 129,
        costPerMessagingConversation: 48_835,
        crmPhoneLeads: 137,
        costPerPhoneLead: 45_983,
        phoneCaptureRate: 106.2,
        attributedCrmPhoneLeads: 37,
        unattributedCrmPhoneLeads: 100,
        attributedCostPerPhoneLead: 170_262,
        attributedPhoneCaptureRate: 28.68,
        crmDeposits: 0,
        costPerDeposit: null,
      },
      channels: [],
      accounts: [],
      pages: [{
        pageId: PAGE_ID,
        pageName: 'Xưởng Tranh Đồng',
        spend: 2_362_778,
        originalSpendByCurrency: { USD: 92.84 },
        impressions: 10_000,
        clicks: 230,
        messagingConversations: 73,
        costPerMessagingConversation: 32_367,
        crmPhoneLeads: 25,
        costPerPhoneLead: 94_511,
        phoneCaptureRate: 34.25,
        crmDeposits: 0,
        costPerDeposit: null,
        campaignsCount: 1,
      }],
      campaigns: [{
        id: '120252025788250425',
        adAccountId: ACCOUNT_ID,
        adAccountName: 'Đồng DL',
        provider: 'facebook_ads',
        name: 'Camp USD',
        status: 'ACTIVE',
        effectiveStatus: 'ACTIVE',
        objective: 'OUTCOME_ENGAGEMENT',
        dailyBudget: 20,
        lifetimeBudget: null,
        pageId: PAGE_ID,
        pageName: 'Xưởng Tranh Đồng',
        currency: 'USD',
        originalSpend: 92.84,
        originalCostPerMessagingConversation: 1.27,
        spend: 2_362_778,
        impressions: 10_000,
        clicks: 230,
        reach: 5_500,
        ctr: 2.3,
        cpc: 10_180,
        cpm: 236_278,
        frequency: 1.82,
        messagingConversations: 73,
        costPerMessagingConversation: 32_367,
        health: 'good',
        healthReasons: [],
      }],
      daily: [{ date: '2026-11-24', spend: 2_362_778, impressions: 10_000, clicks: 230, messagingConversations: 73, crmPhoneLeads: 12 }],
    };
    const fetchImpl = vi.fn(async () => json(overviewBody));
    const client = new MarketingAdsClient({ getAccessToken: async () => TOKEN }, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await client.getOverview(WORKSPACE, {});
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.hasMixedCurrencies).toBe(true);
    expect(res.value.fxRates).toEqual({ USD: 25450 });
    expect(res.value.blended.attributedCrmPhoneLeads).toBe(37);
    expect(res.value.blended.unattributedCrmPhoneLeads).toBe(100);
    expect(res.value.campaigns[0]?.currency).toBe('USD');
    expect(res.value.campaigns[0]?.originalSpend).toBe(92.84);
    expect(res.value.pages[0]?.originalSpendByCurrency).toEqual({ USD: 92.84 });
  });
});
