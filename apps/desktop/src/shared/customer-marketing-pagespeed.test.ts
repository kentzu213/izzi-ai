import { describe, expect, it } from 'vitest';
import { parseCustomerMarketingPageSpeedInput } from './customer-marketing-pagespeed';

describe('parseCustomerMarketingPageSpeedInput', () => {
  it('accepts the exact bounded audit contract', () => {
    expect(parseCustomerMarketingPageSpeedInput({
      url: '  https://izziapi.com/pricing  ',
      strategy: 'mobile',
    })).toEqual({
      url: 'https://izziapi.com/pricing',
      strategy: 'mobile',
    });
    expect(parseCustomerMarketingPageSpeedInput({
      url: 'https://izziapi.com',
      strategy: 'desktop',
    })).toEqual({
      url: 'https://izziapi.com',
      strategy: 'desktop',
    });
  });

  it.each([
    null,
    undefined,
    'https://izziapi.com',
    {},
    { url: '', strategy: 'mobile' },
    { url: 'https://izziapi.com', strategy: 'tablet' },
    { url: 'https://izziapi.com', strategy: 'mobile', token: 'renderer-secret' },
    { url: 'https://izziapi.com', strategy: 'mobile', workspaceId: 'renderer-workspace' },
    { url: `https://example.com/${'a'.repeat(2_100)}`, strategy: 'mobile' },
  ])('rejects malformed or expanded renderer input %#', (value) => {
    expect(parseCustomerMarketingPageSpeedInput(value)).toBeNull();
  });
});
