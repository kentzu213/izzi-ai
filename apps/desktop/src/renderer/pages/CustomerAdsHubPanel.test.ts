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
} from './CustomerAdsHubPanel';

describe('CustomerAdsHubPanel', () => {
  it('renders the pyramid header, channel filters and connect button for manager/owner', () => {
    const html = renderToStaticMarkup(
      createElement(CustomerAdsHubPanel, {
        workspaceId: '11111111-1111-4111-8111-111111111111',
        role: 'owner',
      }),
    );

    expect(html).toContain('Quảng cáo Ads &amp; Đối soát SĐT CRM');
    expect(html).toContain('Tổng hợp đa kênh');
    expect(html).toContain('Facebook Ads');
    expect(html).toContain('YouTube Ads');
    expect(html).toContain('TikTok Ads');
    expect(html).toContain('Kết nối Facebook Ads');
    expect(html).toContain('Tất cả TKQC');
    expect(html).toContain('Tất cả Page');
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

  it('formats VND currency and null cost safely without NaN', () => {
    expect(formatAdsCurrency(1_250_000, 'VND')).toContain('1.250.000');
    expect(formatAdsMetricCost(null, 'VND')).toBe('—');
    expect(formatAdsMetricCost(Number.NaN, 'VND')).toBe('—');
    expect(ADS_HEALTH_META.high_frequency.label).toBe('Tần suất cao');
    expect(ADS_HEALTH_META.high_cost.label).toBe('Giá cao');
  });

  it('keeps Ads Hub strictly read-only without ad-delivery or budget mutation controls', () => {
    const source = readFileSync(fileURLToPath(new URL('./CustomerAdsHubPanel.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('ads_read');
    expect(source).not.toMatch(/CUSTOMER_MARKETING_ACTION_GATE_EXECUTOR_ENABLED\s*=\s*true/);
    expect(source).not.toMatch(/pauseCampaign|updateBudget|createCampaign/);
  });
});
