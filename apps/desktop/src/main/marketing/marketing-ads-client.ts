/**
 * Unified Multi-Platform Ads Hub REST client over IzziAPI `/api/marketing/ads/*`.
 *
 * Security invariants:
 *   - Supabase access token is read in main and attached only in Authorization header.
 *   - Origin comes strictly from `resolveNativeMarketingBaseUrl`.
 *   - Every response is rebuilt from an explicit allowlist; Meta/Google/TikTok tokens
 *     never reach main/renderer responses.
 *   - Read-only `ads_read` + campaign-to-Page attribution mapping only.
 *
 * @module main/marketing/marketing-ads-client
 */
import {
  ISO_PATTERN,
  OAUTH_CODE_PATTERN,
  OAUTH_STATE_PATTERN,
  UUID_PATTERN,
  resolveNativeMarketingBaseUrl,
  type NativeMarketingClientOptions,
  type NativeMarketingTokenProvider,
} from './native-marketing-client';
import {
  AD_ACCOUNT_ID_PATTERN,
  ADS_DATE_PRESETS,
  ADS_HEALTH_STATUSES,
  ADS_PROVIDERS,
  ADS_PROVIDER_LABELS,
  type AdsBlendedKpis,
  type AdsDailyPoint,
  type AdsDatePreset,
  type AdsHealthStatus,
  type AdsOverviewPayload,
  type AdsPageBreakdown,
  type AdsProvider,
  type AdsProviderConnectionStatus,
  type AdsStatusPayload,
  type MarketingAdsErrorCode,
  type MarketingAdsOverviewInput,
  type MarketingAdsSaveMetaAccountInput,
  type MarketingAdsSaveMetaAccountsInput,
  type UnifiedAdAccount,
  type UnifiedAdCampaign,
  type UnifiedChannelRollup,
} from '../../shared/marketing-ads-types';
import { CARE_FACEBOOK_PAGE_ID_PATTERN } from '../customer-care/care-facebook-client';

export const MARKETING_ADS_ROOT = '/api/marketing/ads';
export const MARKETING_ADS_TIMEOUT_MS = 15_000;
export const MARKETING_ADS_SYNC_TIMEOUT_MS = 30_000;
const MAX_AUTHORIZE_URL = 4_096;
const FACEBOOK_DIALOG_PATH = /^\/(?:v\d{1,3}\.\d{1,2}\/)?dialog\/oauth\/?$/;
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const MAX_ACCOUNTS = 100;
const MAX_CAMPAIGNS = 2000;
const MAX_PAGES = 100;
const MAX_DAILY_POINTS = 120;
const MAX_SCOPES = 32;
const SCOPE_PATTERN = /^[a-z_]{3,64}$/;
const CAMPAIGN_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const AD_ACCOUNT_DIGITS_PATTERN = /^[0-9]{5,30}$/;

export type MarketingAdsClientFailure = {
  ok: false;
  error: MarketingAdsErrorCode;
  reason?: string;
};

export type MarketingAdsClientResult<T> = { ok: true; value: T } | MarketingAdsClientFailure;

export interface MarketingAdsConnectStart {
  workspaceId: string;
  state: string;
  expiresAt: string;
  authorizeUrl: string;
}

export interface MarketingAdsMetaCallbackResult {
  workspaceId: string;
  adAccounts: UnifiedAdAccount[];
  scopes: string[];
}

const INVALID_REQUEST: MarketingAdsClientFailure = { ok: false, error: 'invalid_input' };
const INVALID_RESPONSE: MarketingAdsClientFailure = { ok: false, error: 'invalid-response' };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return null;
  return value as Record<string, unknown>;
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && ISO_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function isIsoOrNull(value: unknown): value is string | null {
  return value === null || isIso(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function sanitizeText(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(UNSAFE_TEXT, ' ').trim().slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : null;
}

function sanitizeOptionalText(value: unknown, maxLen: number): string | null | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(UNSAFE_TEXT, ' ').trim().slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : null;
}

function parseScopes(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_SCOPES) return null;
  if (!value.every((item) => typeof item === 'string' && SCOPE_PATTERN.test(item))) return null;
  return [...value];
}

function parseProvider(value: unknown): AdsProvider | null {
  return typeof value === 'string' && (ADS_PROVIDERS as readonly string[]).includes(value)
    ? value as AdsProvider
    : null;
}

function parseDatePreset(value: unknown): AdsDatePreset | null {
  return typeof value === 'string' && (ADS_DATE_PRESETS as readonly string[]).includes(value)
    ? value as AdsDatePreset
    : null;
}

function parseHealthStatus(value: unknown): AdsHealthStatus | null {
  return typeof value === 'string' && (ADS_HEALTH_STATUSES as readonly string[]).includes(value)
    ? value as AdsHealthStatus
    : null;
}

function parseAuthorizeUrl(value: unknown, state: string): string | null {
  if (typeof value !== 'string' || value.length > MAX_AUTHORIZE_URL) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (url.hostname !== 'www.facebook.com' || !FACEBOOK_DIALOG_PATH.test(url.pathname)) return null;
  return url.searchParams.get('state') === state ? url.toString() : null;
}

function parseAdAccount(raw: unknown): UnifiedAdAccount | null {
  const item = asRecord(raw);
  if (!item) return null;
  const id = typeof item.id === 'string' && AD_ACCOUNT_ID_PATTERN.test(item.id)
    ? item.id
    : null;
  const accountId = typeof item.accountId === 'string' && AD_ACCOUNT_DIGITS_PATTERN.test(item.accountId)
    ? item.accountId
    : null;
  const provider = parseProvider(item.provider);
  const name = sanitizeText(item.name, 200);
  const currency = sanitizeText(item.currency, 12);
  const timezoneName = sanitizeOptionalText(item.timezoneName, 80);
  const businessName = sanitizeOptionalText(item.businessName, 200);
  const defaultPageId = item.defaultPageId === null || item.defaultPageId === undefined
    ? null
    : (typeof item.defaultPageId === 'string' && CARE_FACEBOOK_PAGE_ID_PATTERN.test(item.defaultPageId)
      ? item.defaultPageId
      : undefined);
  if (
    !id || !accountId || !provider || !name || !currency
    || !isFiniteNumber(item.accountStatus) || !isFiniteNumber(item.amountSpent)
    || typeof item.enabled !== 'boolean'
    || timezoneName === undefined || businessName === undefined || defaultPageId === undefined
  ) {
    return null;
  }
  return {
    id,
    accountId,
    provider,
    name,
    accountStatus: item.accountStatus,
    currency,
    amountSpent: item.amountSpent,
    timezoneName,
    businessName,
    enabled: item.enabled,
    defaultPageId,
  };
}

function parseAdAccounts(value: unknown): UnifiedAdAccount[] | null {
  if (!Array.isArray(value) || value.length > MAX_ACCOUNTS) return null;
  const out: UnifiedAdAccount[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const account = parseAdAccount(raw);
    if (!account || seen.has(account.accountId)) return null;
    seen.add(account.accountId);
    out.push(account);
  }
  return out;
}

function defaultProviderStatus(provider: AdsProvider): AdsProviderConnectionStatus {
  return {
    provider,
    label: ADS_PROVIDER_LABELS[provider],
    connected: false,
    status: 'ready_to_connect',
    connectedAt: null,
    tokenExpiresAt: null,
    scopes: [],
    adAccounts: [],
  };
}

function parseProviderConnectionStatus(provider: AdsProvider, raw: unknown): AdsProviderConnectionStatus | null {
  const item = asRecord(raw);
  if (!item) return null;
  const parsedProvider = parseProvider(item.provider) ?? provider;
  if (parsedProvider !== provider) return null;
  const label = sanitizeText(item.label, 80) ?? ADS_PROVIDER_LABELS[provider];
  if (typeof item.connected !== 'boolean') return null;
  if (item.status !== 'connected' && item.status !== 'ready_to_connect' && item.status !== 'needs_reauth') return null;
  if (!isIsoOrNull(item.connectedAt ?? null) || !isIsoOrNull(item.tokenExpiresAt ?? null)) return null;
  const scopes = item.scopes === undefined ? [] : parseScopes(item.scopes);
  const adAccounts = item.adAccounts === undefined ? [] : parseAdAccounts(item.adAccounts);
  if (!scopes || !adAccounts) return null;
  return {
    provider,
    label,
    connected: item.connected,
    status: item.status,
    connectedAt: (item.connectedAt as string | null | undefined) ?? null,
    tokenExpiresAt: (item.tokenExpiresAt as string | null | undefined) ?? null,
    scopes,
    adAccounts,
  };
}

function parseCampaignPageMap(value: unknown): Record<string, string> | null {
  if (value === undefined || value === null) return {};
  const record = asRecord(value);
  if (!record) return null;
  const entries = Object.entries(record);
  if (entries.length > MAX_CAMPAIGNS) return null;
  const out: Record<string, string> = {};
  for (const [campaignId, pageId] of entries) {
    if (!CAMPAIGN_ID_PATTERN.test(campaignId)) return null;
    if (typeof pageId !== 'string' || !CARE_FACEBOOK_PAGE_ID_PATTERN.test(pageId)) return null;
    out[campaignId] = pageId;
  }
  return out;
}

function parseStatusPayload(body: unknown, workspaceId: string): AdsStatusPayload | null {
  const envelope = asRecord(body);
  if (!envelope || envelope.success !== true || envelope.workspaceId !== workspaceId) return null;
  const rawProviders = asRecord(envelope.providers);
  if (!rawProviders) return null;
  const providers = {} as Record<AdsProvider, AdsProviderConnectionStatus>;
  for (const provider of ADS_PROVIDERS) {
    if (rawProviders[provider] === undefined) {
      providers[provider] = defaultProviderStatus(provider);
    } else {
      const parsed = parseProviderConnectionStatus(provider, rawProviders[provider]);
      if (!parsed) return null;
      providers[provider] = parsed;
    }
  }
  const campaignPageMap = parseCampaignPageMap(envelope.campaignPageMap);
  if (!campaignPageMap) return null;
  return { workspaceId, providers, campaignPageMap };
}

function parseChannelRollup(raw: unknown): UnifiedChannelRollup | null {
  const item = asRecord(raw);
  if (!item) return null;
  const provider = parseProvider(item.provider);
  if (!provider) return null;
  const label = sanitizeText(item.label, 80) ?? ADS_PROVIDER_LABELS[provider];
  if (item.status !== 'connected' && item.status !== 'ready_to_connect' && item.status !== 'error') return null;
  if (
    !isCount(item.adAccountsCount)
    || !isCount(item.activeCampaignsCount)
    || !isFiniteNumber(item.spend)
    || !isFiniteNumber(item.impressions)
    || !isFiniteNumber(item.clicks)
    || !isFiniteNumber(item.reach)
    || !isFiniteNumber(item.ctr)
    || !isFiniteNumber(item.cpc)
    || !isFiniteNumber(item.cpm)
    || !isFiniteNumber(item.messagingConversations)
    || !(item.costPerMessagingConversation === null || isFiniteNumber(item.costPerMessagingConversation))
    || !(item.crmPhoneLeads === null || isFiniteNumber(item.crmPhoneLeads))
    || !(item.costPerPhoneLead === null || isFiniteNumber(item.costPerPhoneLead))
  ) {
    return null;
  }
  return {
    provider,
    label,
    status: item.status,
    adAccountsCount: item.adAccountsCount,
    activeCampaignsCount: item.activeCampaignsCount,
    spend: item.spend,
    impressions: item.impressions,
    clicks: item.clicks,
    reach: item.reach,
    ctr: item.ctr,
    cpc: item.cpc,
    cpm: item.cpm,
    messagingConversations: item.messagingConversations,
    costPerMessagingConversation: item.costPerMessagingConversation,
    crmPhoneLeads: item.crmPhoneLeads,
    costPerPhoneLead: item.costPerPhoneLead,
  };
}

const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

function parseCurrencyAmountMap(raw: unknown): Record<string, number> | undefined {
  if (raw === undefined || raw === null) return undefined;
  const record = asRecord(raw);
  if (!record) return undefined;
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(record)) {
    const code = key.trim().toUpperCase();
    if (!CURRENCY_CODE_PATTERN.test(code) || !isFiniteNumber(val)) continue;
    out[code] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parsePageBreakdown(raw: unknown): AdsPageBreakdown | null {
  const item = asRecord(raw);
  if (!item) return null;
  if (typeof item.pageId !== 'string' || !CARE_FACEBOOK_PAGE_ID_PATTERN.test(item.pageId)) return null;
  const pageName = sanitizeOptionalText(item.pageName, 200);
  if (
    pageName === undefined
    || !isFiniteNumber(item.spend)
    || !isFiniteNumber(item.impressions)
    || !isFiniteNumber(item.clicks)
    || !isFiniteNumber(item.messagingConversations)
    || !(item.costPerMessagingConversation === null || isFiniteNumber(item.costPerMessagingConversation))
    || !isFiniteNumber(item.crmPhoneLeads)
    || !(item.costPerPhoneLead === null || isFiniteNumber(item.costPerPhoneLead))
    || !(item.phoneCaptureRate === null || isFiniteNumber(item.phoneCaptureRate))
    || !isFiniteNumber(item.crmDeposits)
    || !(item.costPerDeposit === null || isFiniteNumber(item.costPerDeposit))
    || !isCount(item.campaignsCount)
  ) {
    return null;
  }
  const originalSpendByCurrency = parseCurrencyAmountMap(item.originalSpendByCurrency);
  return {
    pageId: item.pageId,
    pageName,
    spend: item.spend,
    ...(originalSpendByCurrency ? { originalSpendByCurrency } : {}),
    impressions: item.impressions,
    clicks: item.clicks,
    messagingConversations: item.messagingConversations,
    costPerMessagingConversation: item.costPerMessagingConversation,
    crmPhoneLeads: item.crmPhoneLeads,
    costPerPhoneLead: item.costPerPhoneLead,
    phoneCaptureRate: item.phoneCaptureRate,
    crmDeposits: item.crmDeposits,
    costPerDeposit: item.costPerDeposit,
    campaignsCount: item.campaignsCount,
  };
}

function parseCampaign(raw: unknown): UnifiedAdCampaign | null {
  const item = asRecord(raw);
  if (!item) return null;
  const id = typeof item.id === 'string' && CAMPAIGN_ID_PATTERN.test(item.id) ? item.id : null;
  const adAccountId = typeof item.adAccountId === 'string' && AD_ACCOUNT_ID_PATTERN.test(item.adAccountId)
    ? item.adAccountId
    : null;
  const adAccountName = sanitizeText(item.adAccountName, 200);
  const provider = parseProvider(item.provider);
  const name = sanitizeText(item.name, 240);
  const status = sanitizeText(item.status, 64);
  const effectiveStatus = sanitizeText(item.effectiveStatus, 64);
  const objective = sanitizeOptionalText(item.objective, 120);
  const pageId = item.pageId === null || item.pageId === undefined
    ? null
    : (typeof item.pageId === 'string' && CARE_FACEBOOK_PAGE_ID_PATTERN.test(item.pageId) ? item.pageId : undefined);
  const pageName = sanitizeOptionalText(item.pageName, 200);
  const health = parseHealthStatus(item.health);
  if (
    !id || !adAccountId || !adAccountName || !provider || !name || !status || !effectiveStatus
    || objective === undefined || pageId === undefined || pageName === undefined || !health
    || !(item.dailyBudget === null || isFiniteNumber(item.dailyBudget))
    || !(item.lifetimeBudget === null || isFiniteNumber(item.lifetimeBudget))
    || !isFiniteNumber(item.spend)
    || !isFiniteNumber(item.impressions)
    || !isFiniteNumber(item.clicks)
    || !isFiniteNumber(item.reach)
    || !isFiniteNumber(item.ctr)
    || !isFiniteNumber(item.cpc)
    || !isFiniteNumber(item.cpm)
    || !isFiniteNumber(item.frequency)
    || !isFiniteNumber(item.messagingConversations)
    || !(item.costPerMessagingConversation === null || isFiniteNumber(item.costPerMessagingConversation))
    || !Array.isArray(item.healthReasons) || item.healthReasons.length > 12
  ) {
    return null;
  }
  const healthReasons: string[] = [];
  for (const reason of item.healthReasons) {
    const clean = sanitizeText(reason, 64);
    if (!clean) return null;
    healthReasons.push(clean);
  }
  const currency = typeof item.currency === 'string' && CURRENCY_CODE_PATTERN.test(item.currency.trim().toUpperCase())
    ? item.currency.trim().toUpperCase()
    : undefined;
  const originalSpend = isFiniteNumber(item.originalSpend) ? item.originalSpend : undefined;
  const originalCostPerMessagingConversation =
    item.originalCostPerMessagingConversation === null || isFiniteNumber(item.originalCostPerMessagingConversation)
      ? item.originalCostPerMessagingConversation
      : undefined;
  return {
    id,
    adAccountId,
    adAccountName,
    provider,
    name,
    status,
    effectiveStatus,
    objective,
    dailyBudget: item.dailyBudget,
    lifetimeBudget: item.lifetimeBudget,
    pageId,
    pageName,
    ...(currency ? { currency } : {}),
    ...(originalSpend !== undefined ? { originalSpend } : {}),
    ...(originalCostPerMessagingConversation !== undefined ? { originalCostPerMessagingConversation } : {}),
    spend: item.spend,
    impressions: item.impressions,
    clicks: item.clicks,
    reach: item.reach,
    ctr: item.ctr,
    cpc: item.cpc,
    cpm: item.cpm,
    frequency: item.frequency,
    messagingConversations: item.messagingConversations,
    costPerMessagingConversation: item.costPerMessagingConversation,
    health,
    healthReasons,
  };
}

function parseDailyPoint(raw: unknown): AdsDailyPoint | null {
  const item = asRecord(raw);
  if (!item) return null;
  if (typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) return null;
  if (
    !isFiniteNumber(item.spend)
    || !isFiniteNumber(item.impressions)
    || !isFiniteNumber(item.clicks)
    || !isFiniteNumber(item.messagingConversations)
    || !isFiniteNumber(item.crmPhoneLeads)
  ) {
    return null;
  }
  return {
    date: item.date,
    spend: item.spend,
    impressions: item.impressions,
    clicks: item.clicks,
    messagingConversations: item.messagingConversations,
    crmPhoneLeads: item.crmPhoneLeads,
  };
}

function parseBlended(raw: unknown): AdsBlendedKpis | null {
  const item = asRecord(raw);
  if (!item) return null;
  if (
    !isFiniteNumber(item.spend)
    || !isFiniteNumber(item.impressions)
    || !isFiniteNumber(item.clicks)
    || !isFiniteNumber(item.reach)
    || !isFiniteNumber(item.ctr)
    || !isFiniteNumber(item.cpc)
    || !isFiniteNumber(item.cpm)
    || !isFiniteNumber(item.messagingConversations)
    || !(item.costPerMessagingConversation === null || isFiniteNumber(item.costPerMessagingConversation))
    || !isFiniteNumber(item.crmPhoneLeads)
    || !(item.costPerPhoneLead === null || isFiniteNumber(item.costPerPhoneLead))
    || !(item.phoneCaptureRate === null || isFiniteNumber(item.phoneCaptureRate))
    || !isFiniteNumber(item.crmDeposits)
    || !(item.costPerDeposit === null || isFiniteNumber(item.costPerDeposit))
  ) {
    return null;
  }
  return {
    spend: item.spend,
    impressions: item.impressions,
    clicks: item.clicks,
    reach: item.reach,
    ctr: item.ctr,
    cpc: item.cpc,
    cpm: item.cpm,
    messagingConversations: item.messagingConversations,
    costPerMessagingConversation: item.costPerMessagingConversation,
    crmPhoneLeads: item.crmPhoneLeads,
    costPerPhoneLead: item.costPerPhoneLead,
    phoneCaptureRate: item.phoneCaptureRate,
    ...(isFiniteNumber(item.attributedCrmPhoneLeads)
      ? { attributedCrmPhoneLeads: item.attributedCrmPhoneLeads }
      : {}),
    ...(isFiniteNumber(item.unattributedCrmPhoneLeads)
      ? { unattributedCrmPhoneLeads: item.unattributedCrmPhoneLeads }
      : {}),
    ...(item.attributedCostPerPhoneLead === null || isFiniteNumber(item.attributedCostPerPhoneLead)
      ? { attributedCostPerPhoneLead: item.attributedCostPerPhoneLead }
      : {}),
    ...(item.attributedPhoneCaptureRate === null || isFiniteNumber(item.attributedPhoneCaptureRate)
      ? { attributedPhoneCaptureRate: item.attributedPhoneCaptureRate }
      : {}),
    crmDeposits: item.crmDeposits,
    costPerDeposit: item.costPerDeposit,
  };
}

function parseOverviewPayload(body: unknown, workspaceId: string): AdsOverviewPayload | null {
  const envelope = asRecord(body);
  if (!envelope || envelope.success !== true || envelope.workspaceId !== workspaceId) return null;
  const datePreset = parseDatePreset(envelope.datePreset);
  const platform = envelope.platform === 'all' ? 'all' : parseProvider(envelope.platform);
  const accountId = envelope.accountId === null || envelope.accountId === undefined
    ? null
    : (typeof envelope.accountId === 'string' && AD_ACCOUNT_ID_PATTERN.test(envelope.accountId)
      ? envelope.accountId
      : undefined);
  const pageId = envelope.pageId === null || envelope.pageId === undefined
    ? null
    : (typeof envelope.pageId === 'string' && CARE_FACEBOOK_PAGE_ID_PATTERN.test(envelope.pageId)
      ? envelope.pageId
      : undefined);
  if (!datePreset || !platform || accountId === undefined || pageId === undefined) return null;
  if (!isIso(envelope.syncedAt) || typeof envelope.cached !== 'boolean') return null;
  if (!Array.isArray(envelope.connectedProviders) || envelope.connectedProviders.length > ADS_PROVIDERS.length) {
    return null;
  }
  const connectedProviders: AdsProvider[] = [];
  for (const item of envelope.connectedProviders) {
    const p = parseProvider(item);
    if (!p) return null;
    connectedProviders.push(p);
  }
  const blended = parseBlended(envelope.blended);
  const accounts = parseAdAccounts(envelope.accounts);
  if (!blended || !accounts) return null;
  if (
    !Array.isArray(envelope.channels) || envelope.channels.length > ADS_PROVIDERS.length
    || !Array.isArray(envelope.pages) || envelope.pages.length > MAX_PAGES
    || !Array.isArray(envelope.campaigns) || envelope.campaigns.length > MAX_CAMPAIGNS
    || !Array.isArray(envelope.daily) || envelope.daily.length > MAX_DAILY_POINTS
  ) {
    return null;
  }
  const channels: UnifiedChannelRollup[] = [];
  for (const raw of envelope.channels) {
    const c = parseChannelRollup(raw);
    if (!c) return null;
    channels.push(c);
  }
  const pages: AdsPageBreakdown[] = [];
  for (const raw of envelope.pages) {
    const p = parsePageBreakdown(raw);
    if (!p) return null;
    pages.push(p);
  }
  const campaigns: UnifiedAdCampaign[] = [];
  for (const raw of envelope.campaigns) {
    const c = parseCampaign(raw);
    if (!c) return null;
    campaigns.push(c);
  }
  const daily: AdsDailyPoint[] = [];
  for (const raw of envelope.daily) {
    const d = parseDailyPoint(raw);
    if (!d) return null;
    daily.push(d);
  }
  const reportingCurrency =
    typeof envelope.reportingCurrency === 'string' && CURRENCY_CODE_PATTERN.test(envelope.reportingCurrency.trim().toUpperCase())
      ? envelope.reportingCurrency.trim().toUpperCase()
      : 'VND';
  const fxRates = parseCurrencyAmountMap(envelope.fxRates);
  const hasMixedCurrencies = typeof envelope.hasMixedCurrencies === 'boolean' ? envelope.hasMixedCurrencies : undefined;
  return {
    workspaceId,
    datePreset,
    platform,
    accountId,
    pageId,
    reportingCurrency,
    ...(fxRates ? { fxRates } : {}),
    ...(hasMixedCurrencies !== undefined ? { hasMixedCurrencies } : {}),
    syncedAt: envelope.syncedAt,
    cached: envelope.cached,
    connectedProviders,
    blended,
    channels,
    accounts,
    pages,
    campaigns,
    daily,
  };
}

function mapHttpFailure(status: number, body: unknown): MarketingAdsClientFailure {
  const record = asRecord(body);
  const reason = typeof record?.reason === 'string' && record.reason.length <= 64 ? record.reason : undefined;
  if (status === 404) return { ok: false, error: 'unsupported' };
  if (status === 401) return { ok: false, error: 'auth' };
  if (status === 403) return { ok: false, error: 'forbidden' };
  if (status === 503 && reason === 'not_configured') return { ok: false, error: 'not_configured' };
  if (status >= 500 || status === 429) return { ok: false, error: 'unavailable', ...(reason ? { reason } : {}) };
  return { ok: false, error: 'rejected', ...(reason ? { reason } : {}) };
}

function logFailure(label: string, status?: number): void {
  try {
    console.warn(`[MarketingAdsClient] ${label}: ${status === undefined ? 'unavailable' : `status ${status}`}`);
  } catch {
    // Diagnostics must never throw.
  }
}

export class MarketingAdsClient {
  private readonly baseUrl: string | null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly auth: NativeMarketingTokenProvider,
    options: NativeMarketingClientOptions = {},
  ) {
    this.baseUrl = resolveNativeMarketingBaseUrl(options.baseUrl, options.allowLoopback);
    this.timeoutMs = options.timeoutMs ?? MARKETING_ADS_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getStatus(workspaceId: string): Promise<MarketingAdsClientResult<AdsStatusPayload>> {
    if (!UUID_PATTERN.test(workspaceId)) return INVALID_REQUEST;
    const res = await this.request('status', `/status?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (!res.ok) return res;
    const parsed = parseStatusPayload(res.body, workspaceId);
    return parsed ? { ok: true, value: parsed } : INVALID_RESPONSE;
  }

  async startMetaConnect(workspaceId: string): Promise<MarketingAdsClientResult<MarketingAdsConnectStart>> {
    if (!UUID_PATTERN.test(workspaceId)) return INVALID_REQUEST;
    const res = await this.request('meta-connect', '/meta/connect', {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    });
    if (!res.ok) return res;
    const envelope = asRecord(res.body);
    if (
      !envelope
      || envelope.success !== true
      || envelope.workspaceId !== workspaceId
      || typeof envelope.state !== 'string'
      || !OAUTH_STATE_PATTERN.test(envelope.state)
      || !isIso(envelope.expiresAt)
    ) {
      return INVALID_RESPONSE;
    }
    const authorizeUrl = parseAuthorizeUrl(envelope.authorizeUrl, envelope.state);
    if (!authorizeUrl) return INVALID_RESPONSE;
    return {
      ok: true,
      value: {
        workspaceId,
        state: envelope.state,
        expiresAt: envelope.expiresAt,
        authorizeUrl,
      },
    };
  }

  async completeMetaCallback(
    workspaceId: string,
    state: string,
    code: string,
  ): Promise<MarketingAdsClientResult<MarketingAdsMetaCallbackResult>> {
    if (!UUID_PATTERN.test(workspaceId) || !OAUTH_STATE_PATTERN.test(state) || !OAUTH_CODE_PATTERN.test(code)) {
      return INVALID_REQUEST;
    }
    const res = await this.request(
      'meta-callback',
      '/meta/callback',
      { method: 'POST', body: JSON.stringify({ workspaceId, state, code }) },
      Math.max(this.timeoutMs, MARKETING_ADS_SYNC_TIMEOUT_MS),
    );
    if (!res.ok) return res;
    const envelope = asRecord(res.body);
    if (!envelope || envelope.success !== true) return INVALID_RESPONSE;
    if (envelope.workspaceId !== undefined && envelope.workspaceId !== workspaceId) return INVALID_RESPONSE;
    const adAccounts = parseAdAccounts(envelope.adAccounts);
    const scopes = envelope.scopes === undefined ? [] : parseScopes(envelope.scopes);
    if (!adAccounts || !scopes) return INVALID_RESPONSE;
    return { ok: true, value: { workspaceId, adAccounts, scopes } };
  }

  async saveMetaAccounts(
    workspaceId: string,
    input: MarketingAdsSaveMetaAccountsInput,
  ): Promise<MarketingAdsClientResult<AdsStatusPayload>> {
    if (!UUID_PATTERN.test(workspaceId)) return INVALID_REQUEST;
    const body: {
      workspaceId: string;
      accounts?: MarketingAdsSaveMetaAccountInput[];
      campaignPageMap?: Record<string, string | null>;
    } = { workspaceId };
    if (input.accounts !== undefined) {
      body.accounts = input.accounts.map((acc) => ({
        id: acc.id,
        enabled: acc.enabled,
        defaultPageId: acc.defaultPageId,
      }));
    }
    if (input.campaignPageMap !== undefined) {
      body.campaignPageMap = { ...input.campaignPageMap };
    }
    const res = await this.request('meta-accounts', '/meta/accounts', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) return res;
    const parsed = parseStatusPayload(res.body, workspaceId);
    if (parsed) return { ok: true, value: parsed };
    // Fallback if backend returned `{ success: true, workspaceId }` or `{ adAccounts, campaignPageMap }` without full providers.
    const raw = asRecord(res.body);
    if (raw && raw.success === true && raw.workspaceId === workspaceId) {
      return this.getStatus(workspaceId);
    }
    return INVALID_RESPONSE;
  }

  async disconnectMetaAds(workspaceId: string): Promise<MarketingAdsClientResult<AdsStatusPayload | null>> {
    if (!UUID_PATTERN.test(workspaceId)) return INVALID_REQUEST;
    const res = await this.request('meta-disconnect', `/meta?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) return res;
    const parsed = parseStatusPayload(res.body, workspaceId);
    if (parsed) return { ok: true, value: parsed };
    const raw = asRecord(res.body);
    if (raw && raw.success === true && (raw.workspaceId === undefined || raw.workspaceId === workspaceId)) {
      return { ok: true, value: null };
    }
    return INVALID_RESPONSE;
  }

  async getOverview(
    workspaceId: string,
    input: MarketingAdsOverviewInput = {},
  ): Promise<MarketingAdsClientResult<AdsOverviewPayload>> {
    if (!UUID_PATTERN.test(workspaceId)) return INVALID_REQUEST;
    const params = new URLSearchParams({ workspaceId });
    if (input.datePreset) params.set('datePreset', input.datePreset);
    if (input.platform) params.set('platform', input.platform);
    if (input.accountId) params.set('accountId', input.accountId);
    if (input.pageId) params.set('pageId', input.pageId);
    if (input.refresh) params.set('refresh', '1');
    const timeout = input.refresh
      ? Math.max(this.timeoutMs, MARKETING_ADS_SYNC_TIMEOUT_MS)
      : this.timeoutMs;
    const res = await this.request('overview', `/overview?${params.toString()}`, {}, timeout);
    if (!res.ok) return res;
    const parsed = parseOverviewPayload(res.body, workspaceId);
    return parsed ? { ok: true, value: parsed } : INVALID_RESPONSE;
  }

  private async request(
    label: string,
    path: string,
    init: RequestInit = {},
    timeoutMs: number = this.timeoutMs,
  ): Promise<{ ok: true; body: unknown } | MarketingAdsClientFailure> {
    if (!this.baseUrl) return { ok: false, error: 'not_configured' };
    const token = await this.auth.getAccessToken().catch(() => null);
    if (!token) return { ok: false, error: 'auth' };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${MARKETING_ADS_ROOT}${path}`, {
        ...init,
        redirect: 'error',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      let body: unknown = null;
      let readable = true;
      try {
        body = await response.json();
      } catch {
        readable = false;
      }
      if (!response.ok) {
        logFailure(label, response.status);
        return mapHttpFailure(response.status, body);
      }
      return readable ? { ok: true, body } : INVALID_RESPONSE;
    } catch {
      logFailure(label);
      return { ok: false, error: 'unavailable' };
    } finally {
      clearTimeout(timer);
    }
  }
}
