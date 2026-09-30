import { describe, expect, it } from 'vitest';
import {
  detectBriefChannels,
  resolveEffectiveChannels,
  sanitizeRequestedChannels,
} from './customer-marketing-service';

describe('Agent Marketing brief channel resolution', () => {
  it('sanitizes explicit channels without changing their order', () => {
    expect(sanitizeRequestedChannels(['tiktok', 'invalid', 'facebook', 'tiktok'])).toEqual([
      'tiktok',
      'facebook',
    ]);
  });

  it('keeps explicit per-brief channels ahead of channels mentioned in the goal', () => {
    expect(resolveEffectiveChannels(
      ['tiktok'],
      'Chạy ads cho website và Facebook',
      ['email'],
    )).toEqual(['tiktok']);
  });

  it('detects channels from the goal only when no valid explicit channel was supplied', () => {
    expect(resolveEffectiveChannels(
      ['invalid'],
      'Lập kế hoạch cho Instagram và YouTube',
      ['email'],
    )).toEqual(['instagram', 'youtube']);
    expect(detectBriefChannels('Lập kế hoạch cho Instagram và YouTube')).toEqual([
      'instagram',
      'youtube',
    ]);
  });

  it('uses sanitized profile channels as the final fallback', () => {
    expect(resolveEffectiveChannels([], 'Mở chiến dịch mới', ['email', 'email', 'crm'])).toEqual([
      'email',
      'crm',
    ]);
  });
});
