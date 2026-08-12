import { describe, expect, it } from 'vitest';
import {
  parseCustomerMarketingConsentedMetric,
  parseCustomerMarketingUtmMapping,
  reconcileCustomerMarketingAttribution,
} from './customer-marketing-consented-attribution';

const EVIDENCE_DIGEST = 'a'.repeat(64);
const OUTCOME_DIGEST = 'b'.repeat(64);
const metric = {
  sourceRecordId: 'x-export-row-001',
  contentId: 'day29-thread',
  platform: 'x' as const,
  platformPostId: '1890123456789012345',
  observedAt: '2026-08-12T15:00:00.000Z',
  consent: {
    granted: true as const,
    scope: 'marketing_analytics' as const,
    recordedAt: '2026-08-12T14:55:00.000Z',
  },
  source: {
    kind: 'consented_api' as const,
    evidenceDigest: EVIDENCE_DIGEST,
  },
  utm: {
    source: 'twitter',
    medium: 'organic',
    campaign: 'izziapi_starizzi_2026_q3',
    content: 'developer_thread',
  },
  metrics: {
    impressions: 120,
    engagements: 12,
    clicks: 7,
    signups: null,
    demoRequests: null,
    spendVnd: 0,
  },
  outcomeEvidenceDigest: null,
};

const mapping = {
  id: 'developer_thread',
  platform: 'twitter' as const,
  baseUrl: 'https://izziapi.com/docs',
  source: 'twitter',
  medium: 'organic',
  campaign: 'izziapi_starizzi_2026_q3',
  content: 'developer_thread',
};

describe('Customer Marketing consented metrics and attribution', () => {
  it('parses exact source-bound metrics and canonical UTM mappings', () => {
    expect(parseCustomerMarketingConsentedMetric(metric)).toEqual(metric);
    expect(parseCustomerMarketingUtmMapping(mapping)).toEqual(mapping);
  });

  it('rejects missing consent, fake IDs, invalid numbers, secrets and unknown fields', () => {
    const rejected = [
      { ...metric, consent: { ...metric.consent, granted: false } },
      { ...metric, platformPostId: '' },
      { ...metric, platformPostId: 'synthetic-placeholder' },
      { ...metric, observedAt: 'not-a-date' },
      { ...metric, source: { ...metric.source, evidenceDigest: 'bad' } },
      { ...metric, metrics: { ...metric.metrics, clicks: -1 } },
      { ...metric, metrics: { ...metric.metrics, impressions: Number.NaN } },
      { ...metric, token: 'forbidden' },
      { ...metric, workspaceId: '11111111-1111-4111-8111-111111111111' },
      { ...metric, path: 'C:\\customer-data' },
    ];
    rejected.forEach((value) => expect(parseCustomerMarketingConsentedMetric(value)).toBeNull());
  });

  it('requires direct product/CRM evidence before accepting reported outcomes', () => {
    expect(parseCustomerMarketingConsentedMetric({
      ...metric,
      metrics: { ...metric.metrics, signups: 2 },
    })).toBeNull();

    const verified = {
      ...metric,
      sourceRecordId: 'product-event-001',
      source: { kind: 'product_analytics' as const, evidenceDigest: EVIDENCE_DIGEST },
      metrics: { ...metric.metrics, signups: 2 },
      outcomeEvidenceDigest: OUTCOME_DIGEST,
    };
    expect(parseCustomerMarketingConsentedMetric(verified)).toEqual(verified);
  });

  it('rejects unsafe, duplicate or ambiguous UTM mappings', () => {
    expect(parseCustomerMarketingUtmMapping({ ...mapping, baseUrl: 'http://izziapi.com/docs' })).toBeNull();
    expect(parseCustomerMarketingUtmMapping({ ...mapping, baseUrl: 'https://evil.example/docs' })).toBeNull();
    expect(parseCustomerMarketingUtmMapping({ ...mapping, secret: 'forbidden' })).toBeNull();

    const result = reconcileCustomerMarketingAttribution([metric], [mapping, { ...mapping, id: 'duplicate' }]);
    expect(result).toMatchObject({ accepted: 0, duplicates: 0, rejected: 1 });
    expect(result.receipts[0]).toMatchObject({ status: 'rejected', reason: 'ambiguous-utm-mapping' });
  });

  it('deduplicates source records and reconciles only exact UTM matches', () => {
    const unmatched = {
      ...metric,
      sourceRecordId: 'x-export-row-002',
      platformPostId: '1890123456789012346',
      utm: { ...metric.utm, content: 'unknown-content' },
    };
    const result = reconcileCustomerMarketingAttribution([metric, { ...metric }, unmatched], [mapping]);

    expect(result).toMatchObject({
      source: 'verified_external_metrics',
      accepted: 2,
      duplicates: 1,
      rejected: 0,
      externalActionPerformed: false,
    });
    expect(result.receipts.map((receipt) => receipt.status)).toEqual(['accepted', 'duplicate', 'accepted']);
    expect(result.attribution).toEqual([
      expect.objectContaining({ contentId: 'day29-thread', status: 'direct_utm', mappingId: 'developer_thread' }),
      expect.objectContaining({ contentId: 'day29-thread', status: 'unattributed', mappingId: null }),
    ]);
    expect(result.totals).toEqual({
      impressions: 240,
      engagements: 24,
      clicks: 14,
      signups: null,
      demoRequests: null,
      spendVnd: 0,
    });
  });

  it('preserves verified zero and non-zero outcomes without inferring missing values', () => {
    const productMetric = {
      ...metric,
      sourceRecordId: 'product-event-002',
      source: { kind: 'product_analytics' as const, evidenceDigest: EVIDENCE_DIGEST },
      metrics: { ...metric.metrics, impressions: null, engagements: null, clicks: null, signups: 2 },
      outcomeEvidenceDigest: OUTCOME_DIGEST,
    };
    const result = reconcileCustomerMarketingAttribution([productMetric], [mapping]);

    expect(result.totals).toEqual({
      impressions: null,
      engagements: null,
      clicks: null,
      signups: 2,
      demoRequests: null,
      spendVnd: 0,
    });
    expect(result.attribution[0]).toMatchObject({
      status: 'direct_utm',
      signups: 2,
      demoRequests: null,
      outcomeEvidenceDigest: OUTCOME_DIGEST,
    });
  });
});
