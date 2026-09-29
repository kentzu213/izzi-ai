import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MARKETPLACE_URL, resolveMarketplaceUrl } from './marketplace-url';

describe('resolveMarketplaceUrl (ledger #11)', () => {
  it('uses OPENCLAW_MARKETPLACE_URL when both variables are set', () => {
    const env = { OPENCLAW_MARKETPLACE_URL: 'https://market.example', MARKETPLACE_API_URL: 'https://legacy.example' };

    expect(resolveMarketplaceUrl(env)).toBe('https://market.example');
  });

  it('falls back to the legacy MARKETPLACE_API_URL', () => {
    expect(resolveMarketplaceUrl({ MARKETPLACE_API_URL: 'https://legacy.example' })).toBe('https://legacy.example');
  });

  it('returns the local default when neither variable is set', () => {
    expect(resolveMarketplaceUrl({})).toBe(DEFAULT_MARKETPLACE_URL);
    expect(DEFAULT_MARKETPLACE_URL).toBe('http://localhost:8788');
  });

  it('treats blank values as unset and trims the chosen value', () => {
    expect(resolveMarketplaceUrl({ OPENCLAW_MARKETPLACE_URL: '   ', MARKETPLACE_API_URL: ' https://legacy.example ' }))
      .toBe('https://legacy.example');
    expect(resolveMarketplaceUrl({ OPENCLAW_MARKETPLACE_URL: '', MARKETPLACE_API_URL: '' })).toBe(DEFAULT_MARKETPLACE_URL);
  });

  it('drops trailing slashes so callers never build `//api/...`', () => {
    expect(resolveMarketplaceUrl({ OPENCLAW_MARKETPLACE_URL: 'https://market.example/' })).toBe('https://market.example');
    expect(resolveMarketplaceUrl({ MARKETPLACE_API_URL: 'https://legacy.example/base// ' })).toBe('https://legacy.example/base');
    expect(resolveMarketplaceUrl({ OPENCLAW_MARKETPLACE_URL: '//', MARKETPLACE_API_URL: 'https://legacy.example' }))
      .toBe('https://legacy.example');
  });

  it('ignores values that are not absolute http(s) URLs and keeps localhost for dev', () => {
    expect(resolveMarketplaceUrl({ OPENCLAW_MARKETPLACE_URL: 'ftp://market.example', MARKETPLACE_API_URL: 'https://legacy.example' }))
      .toBe('https://legacy.example');
    for (const bad of ['javascript:alert(1)', 'file:///c:/x', 'not a url', 'market.example']) {
      expect(resolveMarketplaceUrl({ OPENCLAW_MARKETPLACE_URL: bad })).toBe(DEFAULT_MARKETPLACE_URL);
    }
    expect(resolveMarketplaceUrl({ OPENCLAW_MARKETPLACE_URL: 'http://localhost:9999' })).toBe('http://localhost:9999');
  });

  it.each(['manager.ts', 'marketplace-download.ts', 'update-checker.ts'])(
    '%s reads the URL only through the resolver',
    (file) => {
      const source = fs.readFileSync(path.join(__dirname, file), 'utf8');

      expect(source).not.toMatch(/process\.env\.\w*MARKETPLACE\w*/);
      expect(source).toMatch(/const MARKETPLACE_API = resolveMarketplaceUrl\(\);/);
    },
  );
});
