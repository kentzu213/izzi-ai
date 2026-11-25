/**
 * Main-process Unified Multi-Platform Ads Hub service.
 * Derives workspace + role strictly from live authority (`resolveAuthority`), never from renderer input.
 * Validates every renderer payload strictly before forwarding to `MarketingAdsClient`.
 *
 * @module main/marketing/marketing-ads-service
 */
import type { CustomerCareAuthority, CustomerCareAuthorityLookup, CustomerCareRole } from '../../shared/customer-care-types';
import {
  AD_ACCOUNT_ID_PATTERN,
  ADS_DATE_PRESETS,
  ADS_PROVIDERS,
  type AdsDatePreset,
  type AdsProvider,
  type MarketingAdsConnectResult,
  type MarketingAdsDisconnectResult,
  type MarketingAdsFailure,
  type MarketingAdsOAuthEvent,
  type MarketingAdsOverviewInput,
  type MarketingAdsOverviewResult,
  type MarketingAdsSaveMetaAccountsInput,
  type MarketingAdsSaveMetaAccountsResult,
  type MarketingAdsStatusResult,
} from '../../shared/marketing-ads-types';
import { OAUTH_CODE_PATTERN, OAUTH_STATE_PATTERN } from './native-marketing-client';
import { CARE_FACEBOOK_PAGE_ID_PATTERN } from '../customer-care/care-facebook-client';
import type { MarketingAdsClient, MarketingAdsClientFailure, MarketingAdsClientResult } from './marketing-ads-client';

const ADS_READ_ROLES: readonly CustomerCareRole[] = ['owner', 'manager', 'editor'];
const ADS_MANAGE_ROLES: readonly CustomerCareRole[] = ['owner', 'manager'];
const CAMPAIGN_ID_PATTERN = /^[0-9]{5,30}$/;

export interface MarketingAdsBeginConnectResult {
  ok: true;
  workspaceId: string;
  identityId: string;
  state: string;
  expiresAt: string;
  authorizeUrl: string;
}

export interface MarketingAdsServiceOptions {
  client: Pick<
    MarketingAdsClient,
    'getStatus' | 'startMetaConnect' | 'completeMetaCallback' | 'saveMetaAccounts' | 'disconnectMetaAds' | 'getOverview'
  >;
  resolveAuthority: () => Promise<CustomerCareAuthorityLookup>;
  currentIdentityId: () => string | null;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function parseOverviewInput(raw: unknown): MarketingAdsOverviewInput | null {
  if (raw === undefined || raw === null) return {};
  if (!isPlainRecord(raw)) return null;
  const allowed = new Set(['datePreset', 'platform', 'accountId', 'pageId', 'refresh']);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) return null;
  }
  const out: MarketingAdsOverviewInput = {};
  if (raw.datePreset !== undefined) {
    if (typeof raw.datePreset !== 'string' || !(ADS_DATE_PRESETS as readonly string[]).includes(raw.datePreset)) {
      return null;
    }
    out.datePreset = raw.datePreset as AdsDatePreset;
  }
  if (raw.platform !== undefined) {
    if (
      raw.platform !== 'all'
      && (typeof raw.platform !== 'string' || !(ADS_PROVIDERS as readonly string[]).includes(raw.platform))
    ) {
      return null;
    }
    out.platform = raw.platform as AdsProvider | 'all';
  }
  if (raw.accountId !== undefined && raw.accountId !== null) {
    if (typeof raw.accountId !== 'string' || !AD_ACCOUNT_ID_PATTERN.test(raw.accountId)) return null;
    out.accountId = raw.accountId;
  } else if (raw.accountId === null) {
    out.accountId = null;
  }
  if (raw.pageId !== undefined && raw.pageId !== null) {
    if (typeof raw.pageId !== 'string' || !CARE_FACEBOOK_PAGE_ID_PATTERN.test(raw.pageId)) return null;
    out.pageId = raw.pageId;
  } else if (raw.pageId === null) {
    out.pageId = null;
  }
  if (raw.refresh !== undefined) {
    if (typeof raw.refresh !== 'boolean') return null;
    out.refresh = raw.refresh;
  }
  return out;
}

function parseSaveMetaAccountsInput(raw: unknown): MarketingAdsSaveMetaAccountsInput | null {
  if (!isPlainRecord(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length === 0 || keys.some((k) => k !== 'accounts' && k !== 'campaignPageMap')) return null;
  const out: MarketingAdsSaveMetaAccountsInput = {};
  if (raw.accounts !== undefined) {
    if (!Array.isArray(raw.accounts) || raw.accounts.length > 100) return null;
    const seen = new Set<string>();
    const accounts = [];
    for (const item of raw.accounts) {
      if (!isPlainRecord(item)) return null;
      const itemKeys = Object.keys(item);
      if (itemKeys.length !== 3 || !('id' in item) || !('enabled' in item) || !('defaultPageId' in item)) {
        return null;
      }
      if (typeof item.id !== 'string' || !AD_ACCOUNT_ID_PATTERN.test(item.id)) return null;
      if (seen.has(item.id) || typeof item.enabled !== 'boolean') return null;
      if (
        item.defaultPageId !== null
        && (typeof item.defaultPageId !== 'string' || !CARE_FACEBOOK_PAGE_ID_PATTERN.test(item.defaultPageId))
      ) {
        return null;
      }
      seen.add(item.id);
      accounts.push({
        id: item.id,
        enabled: item.enabled,
        defaultPageId: item.defaultPageId,
      });
    }
    out.accounts = accounts;
  }
  if (raw.campaignPageMap !== undefined) {
    if (!isPlainRecord(raw.campaignPageMap)) return null;
    const entries = Object.entries(raw.campaignPageMap);
    if (entries.length > 500) return null;
    const map: Record<string, string | null> = {};
    for (const [campaignId, pageId] of entries) {
      if (!CAMPAIGN_ID_PATTERN.test(campaignId)) return null;
      if (pageId !== null && (typeof pageId !== 'string' || !CARE_FACEBOOK_PAGE_ID_PATTERN.test(pageId))) {
        return null;
      }
      map[campaignId] = pageId;
    }
    out.campaignPageMap = map;
  }
  return out;
}

export class MarketingAdsService {
  constructor(private readonly options: MarketingAdsServiceOptions) {}

  private async gate(
    roles: readonly CustomerCareRole[],
  ): Promise<{ ok: true; authority: CustomerCareAuthority } | MarketingAdsFailure> {
    let authority: CustomerCareAuthorityLookup;
    try {
      authority = await this.options.resolveAuthority();
    } catch {
      return { ok: false, error: 'unavailable' };
    }
    if (authority === 'unavailable') return { ok: false, error: 'unavailable' };
    if (!authority) return { ok: false, error: 'auth' };
    const currentId = this.options.currentIdentityId();
    if (!currentId || authority.identityId !== currentId) {
      return { ok: false, error: 'access_changed' };
    }
    if (!roles.includes(authority.role)) return { ok: false, error: 'forbidden' };
    return { ok: true, authority };
  }

  private async runCall<T>(
    authority: CustomerCareAuthority,
    fn: () => Promise<MarketingAdsClientResult<T>>,
  ): Promise<MarketingAdsClientResult<T> | MarketingAdsFailure> {
    const result = await fn();
    const after = await this.options.resolveAuthority().catch(() => 'unavailable' as const);
    if (after === 'unavailable' || !after) {
      return result.ok ? { ok: false, error: 'access_changed' } : result;
    }
    if (after.identityId !== authority.identityId || after.workspaceId !== authority.workspaceId) {
      return { ok: false, error: 'access_changed' };
    }
    return result as MarketingAdsClientResult<T> | MarketingAdsClientFailure;
  }

  async getStatus(): Promise<MarketingAdsStatusResult> {
    const g = await this.gate(ADS_READ_ROLES);
    if (!g.ok) return g;
    const res = await this.runCall(g.authority, () => this.options.client.getStatus(g.authority.workspaceId));
    if (!res.ok) return res;
    return { ok: true, status: res.value };
  }

  async beginMetaConnect(): Promise<MarketingAdsBeginConnectResult | MarketingAdsFailure> {
    const g = await this.gate(ADS_MANAGE_ROLES);
    if (!g.ok) return g;
    const res = await this.runCall(g.authority, () => this.options.client.startMetaConnect(g.authority.workspaceId));
    if (!res.ok) return res;
    return {
      ok: true,
      workspaceId: g.authority.workspaceId,
      identityId: g.authority.identityId,
      state: res.value.state,
      expiresAt: res.value.expiresAt,
      authorizeUrl: res.value.authorizeUrl,
    };
  }

  async completeMetaConnect(
    state: string,
    code: string,
    pending: { workspaceId: string; identityId: string },
  ): Promise<MarketingAdsOAuthEvent> {
    if (
      typeof state !== 'string' || !OAUTH_STATE_PATTERN.test(state)
      || typeof code !== 'string' || !OAUTH_CODE_PATTERN.test(code)
    ) {
      return { ok: false, error: 'invalid_input' };
    }
    const g = await this.gate(ADS_MANAGE_ROLES);
    if (!g.ok) return g;
    if (g.authority.workspaceId !== pending.workspaceId || g.authority.identityId !== pending.identityId) {
      return { ok: false, error: 'access_changed' };
    }
    const res = await this.runCall(
      g.authority,
      () => this.options.client.completeMetaCallback(g.authority.workspaceId, state, code),
    );
    if (!res.ok) return res;
    return {
      ok: true,
      workspaceId: res.value.workspaceId,
      adAccounts: res.value.adAccounts,
      scopes: res.value.scopes,
    };
  }

  async saveMetaAccounts(input: unknown): Promise<MarketingAdsSaveMetaAccountsResult> {
    const parsed = parseSaveMetaAccountsInput(input);
    if (!parsed) return { ok: false, error: 'invalid_input' };
    const roles = parsed.accounts === undefined && parsed.campaignPageMap !== undefined
      ? (['owner', 'manager', 'editor'] as const)
      : ADS_MANAGE_ROLES;
    const g = await this.gate(roles);
    if (!g.ok) return g;
    const res = await this.runCall(
      g.authority,
      () => this.options.client.saveMetaAccounts(g.authority.workspaceId, parsed),
    );
    if (!res.ok) return res;
    return { ok: true, status: res.value };
  }

  async disconnectMetaAds(): Promise<MarketingAdsDisconnectResult> {
    const g = await this.gate(ADS_MANAGE_ROLES);
    if (!g.ok) return g;
    const res = await this.runCall(g.authority, () => this.options.client.disconnectMetaAds(g.authority.workspaceId));
    if (!res.ok) return res;
    return res.value ? { ok: true, status: res.value } : { ok: true };
  }

  async getOverview(input: unknown): Promise<MarketingAdsOverviewResult> {
    const parsed = parseOverviewInput(input);
    if (!parsed) return { ok: false, error: 'invalid_input' };
    const g = await this.gate(ADS_READ_ROLES);
    if (!g.ok) return g;
    const res = await this.runCall(
      g.authority,
      () => this.options.client.getOverview(g.authority.workspaceId, parsed),
    );
    if (!res.ok) return res;
    return { ok: true, overview: res.value };
  }
}

export type { MarketingAdsConnectResult };
