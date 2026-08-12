import { createHash } from 'node:crypto';

export type CustomerMarketingMetricPlatform = 'facebook' | 'telegram' | 'x' | 'youtube' | 'tiktok' | 'seo';
export type CustomerMarketingMetricSourceKind = 'consented_api' | 'verified_export' | 'product_analytics' | 'crm';

export interface CustomerMarketingMetricValues {
  impressions: number | null;
  engagements: number | null;
  clicks: number | null;
  signups: number | null;
  demoRequests: number | null;
  spendVnd: number | null;
}

export interface CustomerMarketingConsentedMetric {
  sourceRecordId: string;
  contentId: string;
  platform: CustomerMarketingMetricPlatform;
  platformPostId: string;
  observedAt: string;
  consent: {
    granted: true;
    scope: 'marketing_analytics';
    recordedAt: string;
  };
  source: {
    kind: CustomerMarketingMetricSourceKind;
    evidenceDigest: string;
  };
  utm: {
    source: string;
    medium: string;
    campaign: string;
    content: string;
  } | null;
  metrics: CustomerMarketingMetricValues;
  outcomeEvidenceDigest: string | null;
}

export interface CustomerMarketingUtmMapping {
  id: string;
  platform: CustomerMarketingMetricPlatform | 'twitter';
  baseUrl: string;
  source: string;
  medium: string;
  campaign: string;
  content: string;
}

export interface CustomerMarketingMetricReceipt {
  sourceRecordId: string;
  status: 'accepted' | 'duplicate' | 'rejected';
  reason: 'verified' | 'duplicate-source-record' | 'invalid-metric' | 'ambiguous-utm-mapping';
  receiptDigest: string;
}

export interface CustomerMarketingAttributionRow {
  contentId: string;
  platform: CustomerMarketingMetricPlatform;
  platformPostId: string;
  status: 'direct_utm' | 'unattributed';
  mappingId: string | null;
  signups: number | null;
  demoRequests: number | null;
  outcomeEvidenceDigest: string | null;
}

export interface CustomerMarketingAttributionReconciliation {
  source: 'verified_external_metrics';
  accepted: number;
  duplicates: number;
  rejected: number;
  externalActionPerformed: false;
  receipts: CustomerMarketingMetricReceipt[];
  attribution: CustomerMarketingAttributionRow[];
  totals: CustomerMarketingMetricValues;
  reconciliationDigest: string;
}

const METRIC_KEYS = [
  'sourceRecordId', 'contentId', 'platform', 'platformPostId', 'observedAt',
  'consent', 'source', 'utm', 'metrics', 'outcomeEvidenceDigest',
] as const;
const CONSENT_KEYS = ['granted', 'scope', 'recordedAt'] as const;
const SOURCE_KEYS = ['kind', 'evidenceDigest'] as const;
const UTM_KEYS = ['source', 'medium', 'campaign', 'content'] as const;
const VALUE_KEYS = ['impressions', 'engagements', 'clicks', 'signups', 'demoRequests', 'spendVnd'] as const;
const MAPPING_KEYS = ['id', 'platform', 'baseUrl', 'source', 'medium', 'campaign', 'content'] as const;
const PLATFORMS = ['facebook', 'telegram', 'x', 'youtube', 'tiktok', 'seo'] as const;
const SOURCE_KINDS = ['consented_api', 'verified_export', 'product_analytics', 'crm'] as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,255}$/;
const UTM_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PLATFORM_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{4,255}$/;
const PLACEHOLDER_PATTERN = /^(?:synthetic|placeholder|unknown|pending|none|n\/a)(?:[-_.:].*)?$/i;

export function parseCustomerMarketingConsentedMetric(
  value: unknown,
): CustomerMarketingConsentedMetric | null {
  if (!isExactPlainRecord(value, METRIC_KEYS)
    || !isExactPlainRecord(value.consent, CONSENT_KEYS)
    || !isExactPlainRecord(value.source, SOURCE_KEYS)
    || (value.utm !== null && !isExactPlainRecord(value.utm, UTM_KEYS))
    || !isExactPlainRecord(value.metrics, VALUE_KEYS)) return null;

  if (!isIdentifier(value.sourceRecordId)
    || !isIdentifier(value.contentId)
    || !isPlatform(value.platform)
    || typeof value.platformPostId !== 'string'
    || !PLATFORM_ID_PATTERN.test(value.platformPostId)
    || PLACEHOLDER_PATTERN.test(value.platformPostId)
    || !isCanonicalIsoTimestamp(value.observedAt)
    || value.consent.granted !== true
    || value.consent.scope !== 'marketing_analytics'
    || !isCanonicalIsoTimestamp(value.consent.recordedAt)
    || Date.parse(value.consent.recordedAt) > Date.parse(value.observedAt)
    || !isSourceKind(value.source.kind)
    || typeof value.source.evidenceDigest !== 'string'
    || !SHA256_PATTERN.test(value.source.evidenceDigest)
    || (value.utm !== null && !isUtm(value.utm))
    || !isMetricValues(value.metrics)
    || (value.outcomeEvidenceDigest !== null
      && (typeof value.outcomeEvidenceDigest !== 'string'
        || !SHA256_PATTERN.test(value.outcomeEvidenceDigest)))) return null;

  const hasOutcomes = value.metrics.signups !== null || value.metrics.demoRequests !== null;
  const verifiedOutcomeSource = value.source.kind === 'product_analytics' || value.source.kind === 'crm';
  if (hasOutcomes && (!verifiedOutcomeSource || value.outcomeEvidenceDigest === null)) return null;
  if (!hasOutcomes && value.outcomeEvidenceDigest !== null) return null;

  return value as unknown as CustomerMarketingConsentedMetric;
}

export function parseCustomerMarketingUtmMapping(
  value: unknown,
): CustomerMarketingUtmMapping | null {
  if (!isExactPlainRecord(value, MAPPING_KEYS)
    || !isIdentifier(value.id)
    || !isMappingPlatform(value.platform)
    || typeof value.baseUrl !== 'string'
    || !isCanonicalIzziApiUrl(value.baseUrl)
    || !isUtm({
      source: value.source,
      medium: value.medium,
      campaign: value.campaign,
      content: value.content,
    })) return null;

  return value as unknown as CustomerMarketingUtmMapping;
}

export function reconcileCustomerMarketingAttribution(
  metricValues: readonly unknown[],
  mappingValues: readonly unknown[],
): CustomerMarketingAttributionReconciliation {
  const mappings = mappingValues
    .map(parseCustomerMarketingUtmMapping)
    .filter((value): value is CustomerMarketingUtmMapping => value !== null);
  const seen = new Set<string>();
  const receipts: CustomerMarketingMetricReceipt[] = [];
  const attribution: CustomerMarketingAttributionRow[] = [];
  const acceptedMetrics: CustomerMarketingConsentedMetric[] = [];
  let duplicates = 0;
  let rejected = 0;

  for (const raw of metricValues) {
    const metric = parseCustomerMarketingConsentedMetric(raw);
    if (!metric) {
      rejected += 1;
      receipts.push(receipt(rawSourceRecordId(raw), 'rejected', 'invalid-metric'));
      continue;
    }
    const dedupeKey = `${metric.source.kind}:${metric.sourceRecordId}`;
    if (seen.has(dedupeKey)) {
      duplicates += 1;
      receipts.push(receipt(metric.sourceRecordId, 'duplicate', 'duplicate-source-record'));
      continue;
    }
    seen.add(dedupeKey);

    const matches = matchingMappings(metric, mappings);
    if (matches.length > 1) {
      rejected += 1;
      receipts.push(receipt(metric.sourceRecordId, 'rejected', 'ambiguous-utm-mapping'));
      continue;
    }

    acceptedMetrics.push(metric);
    receipts.push(receipt(metric.sourceRecordId, 'accepted', 'verified'));
    attribution.push({
      contentId: metric.contentId,
      platform: metric.platform,
      platformPostId: metric.platformPostId,
      status: matches.length === 1 ? 'direct_utm' : 'unattributed',
      mappingId: matches[0]?.id ?? null,
      signups: metric.metrics.signups,
      demoRequests: metric.metrics.demoRequests,
      outcomeEvidenceDigest: metric.outcomeEvidenceDigest,
    });
  }

  const canonical = {
    source: 'verified_external_metrics' as const,
    accepted: acceptedMetrics.length,
    duplicates,
    rejected,
    externalActionPerformed: false as const,
    receipts,
    attribution,
    totals: sumMetrics(acceptedMetrics.map((item) => item.metrics)),
  };
  return {
    ...canonical,
    reconciliationDigest: sha256(JSON.stringify(canonical)),
  };
}

function matchingMappings(
  metric: CustomerMarketingConsentedMetric,
  mappings: readonly CustomerMarketingUtmMapping[],
): CustomerMarketingUtmMapping[] {
  if (!metric.utm) return [];
  return mappings.filter((mapping) => normalizedPlatform(mapping.platform) === metric.platform
    && mapping.source === metric.utm?.source
    && mapping.medium === metric.utm.medium
    && mapping.campaign === metric.utm.campaign
    && mapping.content === metric.utm.content);
}

function sumMetrics(values: readonly CustomerMarketingMetricValues[]): CustomerMarketingMetricValues {
  return {
    impressions: nullableSum(values.map((value) => value.impressions)),
    engagements: nullableSum(values.map((value) => value.engagements)),
    clicks: nullableSum(values.map((value) => value.clicks)),
    signups: nullableSum(values.map((value) => value.signups)),
    demoRequests: nullableSum(values.map((value) => value.demoRequests)),
    spendVnd: nullableSum(values.map((value) => value.spendVnd)),
  };
}

function nullableSum(values: readonly (number | null)[]): number | null {
  const observed = values.filter((value): value is number => value !== null);
  return observed.length === 0 ? null : observed.reduce((total, value) => total + value, 0);
}

function receipt(
  sourceRecordId: string,
  status: CustomerMarketingMetricReceipt['status'],
  reason: CustomerMarketingMetricReceipt['reason'],
): CustomerMarketingMetricReceipt {
  const canonical = { sourceRecordId, status, reason };
  return { ...canonical, receiptDigest: sha256(JSON.stringify(canonical)) };
}

function rawSourceRecordId(value: unknown): string {
  if (isPlainRecord(value) && typeof value.sourceRecordId === 'string' && value.sourceRecordId.length <= 256) {
    return value.sourceRecordId;
  }
  return 'invalid-source-record';
}

function isMetricValues(value: Record<string, unknown>): boolean {
  return VALUE_KEYS.every((key) => isNullableNonNegativeInteger(value[key]));
}

function isNullableNonNegativeInteger(value: unknown): boolean {
  return value === null
    || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

function isUtm(value: Record<string, unknown>): boolean {
  return UTM_KEYS.every((key) => typeof value[key] === 'string' && UTM_VALUE_PATTERN.test(value[key]));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER_PATTERN.test(value);
}

function isPlatform(value: unknown): value is CustomerMarketingMetricPlatform {
  return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value);
}

function isMappingPlatform(value: unknown): value is CustomerMarketingUtmMapping['platform'] {
  return value === 'twitter' || isPlatform(value);
}

function isSourceKind(value: unknown): value is CustomerMarketingMetricSourceKind {
  return typeof value === 'string' && (SOURCE_KINDS as readonly string[]).includes(value);
}

function normalizedPlatform(value: CustomerMarketingUtmMapping['platform']): CustomerMarketingMetricPlatform {
  return value === 'twitter' ? 'x' : value;
}

function isCanonicalIzziApiUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.port === ''
      && (url.hostname === 'izziapi.com' || url.hostname === 'www.izziapi.com')
      && url.search === ''
      && url.hash === ''
      && url.toString() === value;
  } catch {
    return false;
  }
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isExactPlainRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
