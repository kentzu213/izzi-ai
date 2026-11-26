import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ADS_HEALTH_META,
  CustomerAdsHubPanel,
  formatAdsCurrency,
  formatAdsMetricCost,
  formatCampaignEffectiveStatus,
  formatMetaAccountStatus,
  formatOriginalSpendSummary,
  sortAdAccountsForModal,
  splitActivePages,
} from './CustomerAdsHubPanel';

describe('CustomerAdsHubPanel', () => {
  it('renders the redesigned command header, channel filters and connect CTA without em-dashes', () => {
    const html = renderToStaticMarkup(
      createElement(CustomerAdsHubPanel, {
        workspaceId: '11111111-1111-4111-8111-111111111111',
        role: 'owner',
      }),
    );

    expect(html).toContain('Quảng cáo Ads &amp; Đối soát SĐT CRM');
    expect(html).toContain('Chỉ đọc');
    expect(html).toContain('Tất cả');
    expect(html).toContain('Facebook Ads');
    expect(html).toContain('YouTube Ads');
    expect(html).toContain('TikTok Ads');
    expect(html).toContain('Kết nối Facebook Ads');
    expect(html).toContain('Tất cả TKQC');
    expect(html).toContain('Tất cả Page');
    expect(html).not.toContain('—');
  });

  it('hides Meta Ads connect button for read-only editor/viewer roles', () => {
    const html = renderToStaticMarkup(
      createElement(CustomerAdsHubPanel, {
        workspaceId: '11111111-1111-4111-8111-111111111111',
        role: 'editor',
      }),
    );

    expect(html).not.toContain('Kết nối Facebook Ads');
  });

  it('formats VND/USD currency, FX original summary, and null cost safely without NaN or em-dashes', () => {
    expect(formatAdsCurrency(1_250_000, 'VND')).toContain('1.250.000');
    expect(formatAdsCurrency(94.23, 'USD')).toBe('$94,23 USD');
    expect(formatAdsMetricCost(null, 'VND')).toBe('-');
    expect(formatAdsMetricCost(Number.NaN, 'VND')).toBe('-');
    expect(formatOriginalSpendSummary({ USD: 94.23, VND: 3_600_000 }, 'VND')).toBe('Gồm $94,23 USD');
    expect(formatOriginalSpendSummary({ VND: 3_600_000 }, 'VND')).toBeNull();
    expect(ADS_HEALTH_META.good.label).toBe('Ổn định');
    expect(ADS_HEALTH_META.learning.label).toBe('Đang học máy');
    expect(ADS_HEALTH_META.high_frequency.label).toBe('Tần suất cao');
    expect(ADS_HEALTH_META.high_cost.label).toBe('Giá cao');
  });

  it('splits active vs zero-activity Pages and sorts modal ad accounts cleanly', () => {
    const { active, inactive } = splitActivePages([
      {
        pageId: '1',
        pageName: 'Active Page',
        spend: 3_000_000,
        impressions: 10_000,
        clicks: 200,
        messagingConversations: 50,
        costPerMessagingConversation: 60_000,
        crmPhoneLeads: 14,
        costPerPhoneLead: 214_286,
        phoneCaptureRate: 28,
        crmDeposits: 0,
        costPerDeposit: null,
        campaignsCount: 4,
      },
      {
        pageId: '2',
        pageName: 'Idle Page',
        spend: 0,
        impressions: 0,
        clicks: 0,
        messagingConversations: 0,
        costPerMessagingConversation: null,
        crmPhoneLeads: 0,
        costPerPhoneLead: null,
        phoneCaptureRate: null,
        crmDeposits: 0,
        costPerDeposit: null,
        campaignsCount: 2,
      },
    ]);
    expect(active.map((p) => p.pageId)).toEqual(['1']);
    expect(inactive.map((p) => p.pageId)).toEqual(['2']);

    expect(formatMetaAccountStatus(1).label).toBe('Hoạt động');
    expect(formatMetaAccountStatus(3).label).toBe('Nợ cước');
    expect(formatCampaignEffectiveStatus('ACTIVE').label).toBe('Đang chạy');
    expect(formatCampaignEffectiveStatus('PAUSED').label).toBe('Tạm dừng');

    const sorted = sortAdAccountsForModal([
      {
        id: 'act_2',
        accountId: '2',
        provider: 'facebook_ads',
        name: 'Paused High Spend',
        accountStatus: 3,
        currency: 'VND',
        amountSpent: 500_000,
        timezoneName: null,
        businessName: null,
        enabled: false,
        defaultPageId: null,
      },
      {
        id: 'act_1',
        accountId: '1',
        provider: 'facebook_ads',
        name: 'Enabled Account',
        accountStatus: 1,
        currency: 'USD',
        amountSpent: 94,
        timezoneName: null,
        businessName: null,
        enabled: true,
        defaultPageId: null,
      },
    ]);
    expect(sorted.map((a) => a.id)).toEqual(['act_1', 'act_2']);
  });

  it('keeps Ads Hub strictly read-only without ad-delivery or budget mutation controls and zero em-dashes', () => {
    const source = readFileSync(fileURLToPath(new URL('./CustomerAdsHubPanel.tsx', import.meta.url)), 'utf8');
    expect(source).toContain("import '../styles/v2/customer-ads.css';");
    expect(source).toContain('ads_read');
    expect(source).not.toContain('—');
    expect(source).not.toMatch(/CUSTOMER_MARKETING_ACTION_GATE_EXECUTOR_ENABLED\s*=\s*true/);
    expect(source).not.toMatch(/pauseCampaign|updateBudget|createCampaign/);
  });
});
