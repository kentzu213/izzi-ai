import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  CustomerMarketingAnalyticsReport,
  CustomerMarketingContentResource,
  CustomerMarketingSnapshot,
  CustomerOnboardingInput,
} from '../../shared/customer-marketing-types';
import type { CustomerMarketingPageSpeedReport } from '../../shared/customer-marketing-pagespeed';
import {
  analyticsWindowFromDates,
  buildAnalyticsInsights,
  buildCreativeBriefBody,
  CustomerMarketingCapabilityWorkbench,
  currentMonthAnalyticsRange,
  PageSpeedReportView,
  pageSpeedReportAfterResult,
  pageSpeedStrategyForKey,
  scanBrandContent,
} from './CustomerMarketingCapabilityWorkbenches';

const form: CustomerOnboardingInput = {
  business: {
    name: 'IzziAPI',
    industry: 'Developer tools',
    website: 'https://izziapi.com',
    offer: 'Unified AI API',
    region: 'Global',
  },
  brand: {
    logoUrl: '',
    primaryColor: '#18c7b5',
    accentColor: '#f0b35b',
    font: 'Inter',
    tone: 'Clear and practical',
    guidelines: 'Use verified claims only.',
    wordsToUse: ['verified'],
    wordsToAvoid: ['guaranteed'],
  },
  audience: {
    segments: 'Automation developers',
    needs: '',
    painPoints: '',
    behaviors: '',
    market: 'Vietnam and global',
  },
  objectives: ['traffic'],
  channels: ['website'],
  resources: [],
  automationMode: 'copilot',
  completedSteps: [],
};

function contentResource(body: string): CustomerMarketingContentResource {
  return {
    id: 'content-1',
    workspaceId: 'workspace-1',
    kind: 'content',
    status: 'draft',
    revision: 1,
    title: 'IzziAPI launch',
    body,
    channel: 'website',
    scheduledAt: null,
    campaignId: null,
    metadata: {},
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function analyticsReport(
  overrides: Partial<CustomerMarketingAnalyticsReport> = {},
): CustomerMarketingAnalyticsReport {
  return {
    source: 'marketing_resources',
    generatedAt: '2026-07-20T00:00:00.000Z',
    window: {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-31T23:59:59.999Z',
      timeZone: 'UTC',
      activityBasis: 'resource_updated_at',
      scheduleBasis: 'content_scheduled_at',
    },
    inventory: {
      total: 2,
      campaigns: 1,
      content: 1,
      assets: 0,
      knowledge: 0,
    },
    activity: {
      updatedInWindow: 2,
      byKind: { campaign: 1, content: 1, asset: 0, knowledge: 0 },
      byStatus: {
        draft: 1,
        inReview: 0,
        approved: 1,
        rejected: 0,
        archived: 0,
      },
    },
    schedule: {
      contentScheduledInWindow: 1,
      byChannel: [{ channel: 'website', count: 1 }],
      byStatus: {
        draft: 1,
        inReview: 0,
        approved: 0,
        rejected: 0,
        archived: 0,
      },
    },
    attribution: {
      model: 'direct_campaign_id',
      basis: 'content_updated_at',
      contentConsidered: 1,
      attributedContent: 1,
      unattributedContent: 0,
      unresolvedCampaignLinks: 0,
      campaigns: [{
        campaignId: 'campaign-1',
        title: 'Launch',
        contentCount: 1,
        scheduledContentCount: 1,
      }],
    },
    dataAvailability: {
      performanceMetrics: {
        status: 'unavailable',
        reason: 'No verified provider source.',
        omittedMetrics: [
          'impressions',
          'reach',
          'clicks',
          'conversions',
          'revenue',
        ],
      },
    },
    ...overrides,
  };
}

describe('Customer Marketing capability workbench helpers', () => {
  it.each([
    ['seo-workspace', 'Google PageSpeed'],
    ['creative-studio', 'Create a content brief'],
    ['analytics-copilot', 'Verified workspace report'],
    ['brand-guardian', 'Current Brand Center'],
    ['automation-builder', 'Prepare a local dry-run'],
  ] as const)('renders %s as a real workbench surface', (id, marker) => {
    const html = renderToStaticMarkup(createElement(
      CustomerMarketingCapabilityWorkbench,
      {
        id,
        snapshot: {
          workspace: { role: 'owner' },
          approvals: [],
        } as unknown as CustomerMarketingSnapshot,
        form,
        onBack: () => undefined,
        onOpen: () => undefined,
        onDirector: async () => undefined,
      },
    ));

    expect(html).toContain(marker);
  });

  it('prefills SEO Workspace from Brand Center and keeps the audit explicitly read-only', () => {
    const html = renderToStaticMarkup(createElement(
      CustomerMarketingCapabilityWorkbench,
      {
        id: 'seo-workspace',
        snapshot: {
          workspace: { role: 'owner' },
          approvals: [],
        } as unknown as CustomerMarketingSnapshot,
        form,
        onBack: () => undefined,
        onOpen: () => undefined,
        onDirector: async () => undefined,
      },
    ));

    expect(html).toContain('value="https://izziapi.com"');
    expect(html).toContain('URL công khai sẽ được gửi tới Google PageSpeed');
    expect(html).toContain('Đo tốc độ');
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html).toContain('aria-checked="true"');
    expect(html).not.toContain('Xuất bản');
    expect(html).not.toContain('Chi tiêu');
  });

  it.each([
    ['mobile', 'ArrowRight', 'desktop'],
    ['desktop', 'ArrowRight', 'mobile'],
    ['desktop', 'ArrowLeft', 'mobile'],
    ['mobile', 'End', 'desktop'],
    ['desktop', 'Home', 'mobile'],
    ['mobile', 'Enter', null],
  ] as const)('maps PageSpeed keyboard navigation from %s with %s', (current, key, expected) => {
    expect(pageSpeedStrategyForKey(current, key)).toBe(expected);
  });

  it('renders requested/final URLs and the exact CrUX source provenance', () => {
    const report: CustomerMarketingPageSpeedReport = {
      ok: true,
      url: 'https://izziapi.com/start',
      lighthouseRequestedUrl: 'https://izziapi.com/start',
      finalUrl: 'https://izziapi.com/',
      strategy: 'mobile',
      measuredAt: '2026-08-09T06:00:00.000Z',
      performanceScore: 92,
      lab: { lcp: { display: '2.1 s', rating: 'good' } },
      field: {
        scope: 'origin',
        initialUrl: 'https://izziapi.com/start',
        id: 'https://izziapi.com/',
        overall: 'needs-improvement',
        lcp: { display: '2.20 s', rating: 'good' },
      },
    };
    const html = renderToStaticMarkup(createElement(PageSpeedReportView, { report }));

    expect(html).toContain('URL gửi tới Google');
    expect(html).toContain('https://izziapi.com/start');
    expect(html).toContain('URL Lighthouse nhận');
    expect(html).toContain('URL cuối Lighthouse');
    expect(html).toContain('URL CrUX yêu cầu');
    expect(html).toContain('Dataset CrUX');
    expect(html).toContain('Origin tổng hợp');
    expect(html).toContain('cmr-pill--warning');
    expect(html.match(/https:\/\/izziapi.com\//g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the last good PageSpeed report when a retry fails', () => {
    const report: CustomerMarketingPageSpeedReport = {
      ok: true,
      url: 'https://izziapi.com/',
      lighthouseRequestedUrl: 'https://izziapi.com/',
      finalUrl: 'https://izziapi.com/',
      strategy: 'mobile',
      measuredAt: '2026-08-09T06:00:00.000Z',
      performanceScore: 92,
      lab: {},
      field: null,
    };
    const failure = {
      ok: false,
      reason: 'rate_limited',
      error: 'Google PageSpeed đang giới hạn số lần gọi.',
    } as const;

    expect(pageSpeedReportAfterResult(report, failure)).toBe(report);
    expect(pageSpeedReportAfterResult(null, failure)).toBeNull();
  });

  it('builds a persisted creative brief from user input and Brand Center data', () => {
    const body = buildCreativeBriefBody({
      title: 'Explainer',
      concept: 'One API key for AI models',
      audience: '',
      channel: 'website',
      format: 'Short video',
      cta: 'Open the demo',
    }, form);

    expect(body).toContain('Concept: One API key for AI models');
    expect(body).toContain('Audience: Automation developers');
    expect(body).toContain('Brand tone: Clear and practical');
    expect(body).not.toContain('publish');
  });

  it('creates a deterministic current-month date range', () => {
    expect(currentMonthAnalyticsRange(new Date(2026, 6, 15))).toEqual({
      fromDate: '2026-07-01',
      toDate: '2026-07-31',
    });
  });

  it('accepts at most 366 calendar days and rejects malformed ranges', () => {
    expect(analyticsWindowFromDates({
      fromDate: '2024-01-01',
      toDate: '2024-12-31',
    })).toEqual({
      from: '2024-01-01T00:00:00.000Z',
      to: '2024-12-31T23:59:59.999Z',
    });
    expect(analyticsWindowFromDates({
      fromDate: '2024-01-01',
      toDate: '2025-01-01',
    })).toBeNull();
    expect(analyticsWindowFromDates({
      fromDate: '2026-02-30',
      toDate: '2026-03-01',
    })).toBeNull();
    expect(analyticsWindowFromDates({
      fromDate: '2026-03-02',
      toDate: '2026-03-01',
    })).toBeNull();
  });

  it('derives insights only from fields in the verified report', () => {
    expect(buildAnalyticsInsights(analyticsReport())).toEqual([
      'Inventory, activity, schedule, and direct attribution are consistent.',
    ]);

    const report = analyticsReport();
    report.schedule.contentScheduledInWindow = 0;
    report.attribution.unattributedContent = 1;
    report.activity.byStatus.inReview = 1;
    expect(buildAnalyticsInsights(report)).toEqual([
      '1 content item(s) are not linked to a campaign.',
      'Content exists but none is scheduled in this window.',
      '1 resource(s) are waiting for review.',
    ]);
  });

  it('blocks avoided terms but does not make an approval decision', () => {
    const blocked = scanBrandContent(
      contentResource('A guaranteed result for every team.'),
      form.brand,
    );
    expect(blocked.level).toBe('block');
    expect(blocked.avoidMatches).toEqual(['guaranteed']);
    expect(blocked.findings.some((finding) => finding.level === 'block')).toBe(true);

    const passing = scanBrandContent(
      contentResource('A verified API workflow for automation teams.'),
      form.brand,
    );
    expect(passing.level).toBe('pass');
  });
});

