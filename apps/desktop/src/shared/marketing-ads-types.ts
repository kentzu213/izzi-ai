/**
 * Shared Unified Multi-Platform Ads Hub contract (`GET/POST /api/marketing/ads/*`).
 * Read-only `ads_read` + campaign-to-Page attribution mapping only; never executes budget or
 * ad-delivery mutations (`CUSTOMER_MARKETING_ACTION_GATE_EXECUTOR_ENABLED = false`).
 */

export const AD_ACCOUNT_ID_PATTERN = /^act_[0-9]{5,30}$/;

export const ADS_DATE_PRESETS = [
  'today',
  'yesterday',
  'last_7d',
  'last_14d',
  'last_30d',
  'this_month',
  'last_90d',
] as const;

export type AdsDatePreset = (typeof ADS_DATE_PRESETS)[number];

export const ADS_DATE_PRESET_LABELS: Record<AdsDatePreset, string> = {
  today: 'Hôm nay',
  yesterday: 'Hôm qua',
  last_7d: '7 ngày',
  last_14d: '14 ngày',
  last_30d: '30 ngày',
  this_month: 'Tháng này',
  last_90d: '90 ngày',
};

export const ADS_PROVIDERS = [
  'facebook_ads',
  'youtube_ads',
  'tiktok_ads',
] as const;

export type AdsProvider = (typeof ADS_PROVIDERS)[number];

export const ADS_PROVIDER_LABELS: Record<AdsProvider, string> = {
  facebook_ads: 'Facebook Ads',
  youtube_ads: 'YouTube Ads',
  tiktok_ads: 'TikTok Ads',
};

export const ADS_HEALTH_STATUSES = [
  'good',
  'high_frequency',
  'high_cost',
  'paused',
  'learning',
] as const;

export type AdsHealthStatus = (typeof ADS_HEALTH_STATUSES)[number];

export interface UnifiedAdAccount {
  id: string;
  accountId: string;
  provider: AdsProvider;
  name: string;
  accountStatus: number;
  currency: string;
  amountSpent: number;
  timezoneName: string | null;
  businessName: string | null;
  enabled: boolean;
  defaultPageId: string | null;
}

export interface UnifiedAdCampaign {
  id: string;
  adAccountId: string;
  adAccountName: string;
  provider: AdsProvider;
  name: string;
  status: string;
  effectiveStatus: string;
  objective: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  pageId: string | null;
  pageName: string | null;
  currency?: string;
  originalSpend?: number;
  originalCostPerMessagingConversation?: number | null;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  ctr: number;
  cpc: number;
  cpm: number;
  frequency: number;
  messagingConversations: number;
  costPerMessagingConversation: number | null;
  health: AdsHealthStatus;
  healthReasons: string[];
}

export interface UnifiedChannelRollup {
  provider: AdsProvider;
  label: string;
  status: 'connected' | 'ready_to_connect' | 'error';
  adAccountsCount: number;
  activeCampaignsCount: number;
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  ctr: number;
  cpc: number;
  cpm: number;
  messagingConversations: number;
  costPerMessagingConversation: number | null;
  crmPhoneLeads: number | null;
  costPerPhoneLead: number | null;
}

export interface AdsPageBreakdown {
  pageId: string;
  pageName: string | null;
  spend: number;
  originalSpendByCurrency?: Record<string, number>;
  impressions: number;
  clicks: number;
  messagingConversations: number;
  costPerMessagingConversation: number | null;
  crmPhoneLeads: number;
  costPerPhoneLead: number | null;
  /** Percentage 0–100 (crmPhoneLeads / messagingConversations * 100), null when messagingConversations === 0. */
  phoneCaptureRate: number | null;
  crmDeposits: number;
  costPerDeposit: number | null;
  campaignsCount: number;
}

export interface AdsDailyPoint {
  date: string;
  spend: number;
  impressions: number;
  clicks: number;
  messagingConversations: number;
  crmPhoneLeads: number;
}

export interface AdsBlendedKpis {
  spend: number;
  impressions: number;
  clicks: number;
  reach: number;
  ctr: number;
  cpc: number;
  cpm: number;
  messagingConversations: number;
  costPerMessagingConversation: number | null;
  crmPhoneLeads: number;
  costPerPhoneLead: number | null;
  phoneCaptureRate: number | null;
  attributedCrmPhoneLeads?: number;
  unattributedCrmPhoneLeads?: number;
  attributedCostPerPhoneLead?: number | null;
  attributedPhoneCaptureRate?: number | null;
  crmDeposits: number;
  costPerDeposit: number | null;
}

export interface AdsOverviewPayload {
  workspaceId: string;
  datePreset: AdsDatePreset;
  platform: AdsProvider | 'all';
  accountId: string | null;
  pageId: string | null;
  reportingCurrency?: string;
  fxRates?: Record<string, number>;
  hasMixedCurrencies?: boolean;
  syncedAt: string;
  cached: boolean;
  connectedProviders: AdsProvider[];
  blended: AdsBlendedKpis;
  channels: UnifiedChannelRollup[];
  accounts: UnifiedAdAccount[];
  pages: AdsPageBreakdown[];
  campaigns: UnifiedAdCampaign[];
  daily: AdsDailyPoint[];
}

export interface AdsProviderConnectionStatus {
  provider: AdsProvider;
  label: string;
  connected: boolean;
  status: 'connected' | 'ready_to_connect' | 'needs_reauth';
  connectedAt: string | null;
  tokenExpiresAt: string | null;
  scopes: string[];
  adAccounts: UnifiedAdAccount[];
}

export interface AdsStatusPayload {
  workspaceId: string;
  providers: Record<AdsProvider, AdsProviderConnectionStatus>;
  campaignPageMap: Record<string, string>;
}

export type MarketingAdsErrorCode =
  | 'auth'
  | 'forbidden'
  | 'access_changed'
  | 'invalid_input'
  | 'declined'
  | 'expired'
  | 'unsupported'
  | 'unavailable'
  | 'not_configured'
  | 'rejected'
  | 'invalid-response';

export interface MarketingAdsFailure {
  ok: false;
  error: MarketingAdsErrorCode;
  reason?: string;
}

export type MarketingAdsStatusResult =
  | { ok: true; status: AdsStatusPayload }
  | MarketingAdsFailure;

export type MarketingAdsConnectResult =
  | { ok: true }
  | MarketingAdsFailure;

export type MarketingAdsOAuthEvent =
  | {
    ok: true;
    workspaceId: string;
    adAccounts: UnifiedAdAccount[];
    scopes: string[];
  }
  | MarketingAdsFailure;

export interface MarketingAdsSaveMetaAccountInput {
  id: string;
  enabled: boolean;
  defaultPageId: string | null;
}

export interface MarketingAdsSaveMetaAccountsInput {
  accounts?: MarketingAdsSaveMetaAccountInput[];
  campaignPageMap?: Record<string, string | null>;
}

export type MarketingAdsSaveMetaAccountsResult =
  | { ok: true; status: AdsStatusPayload }
  | MarketingAdsFailure;

export type MarketingAdsDisconnectResult =
  | { ok: true; status?: AdsStatusPayload }
  | MarketingAdsFailure;

export interface MarketingAdsOverviewInput {
  datePreset?: AdsDatePreset;
  platform?: AdsProvider | 'all';
  accountId?: string | null;
  pageId?: string | null;
  refresh?: boolean;
}

export type MarketingAdsOverviewResult =
  | { ok: true; overview: AdsOverviewPayload }
  | MarketingAdsFailure;
