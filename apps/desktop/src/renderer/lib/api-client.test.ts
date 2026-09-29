import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MARKETPLACE_URL, normalizeMarketplaceUrl } from '../../shared/marketplace-url';
import { apiClient, marketplaceErrorMessage } from './api-client';

function okResponse(body: unknown = {}): Response {
  return { ok: true, status: 200, statusText: 'OK', json: async () => body } as Response;
}

describe('renderer Marketplace URL (ledger #11)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls the shared default base with a single slash before /api', async () => {
    await apiClient.getMarketplaceExtensions({ search: 'seo' });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe(`${DEFAULT_MARKETPLACE_URL}/api/extensions?q=seo`);
    expect(url).not.toContain('//api');
  });

  it('builds the detail URL from the same base', async () => {
    await apiClient.getExtensionDetail('ext-1');

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8788/api/extensions/ext-1');
  });

  it('probes health at the base root with exactly one trailing slash', async () => {
    const healthy = await apiClient.checkMarketplaceHealth();

    expect(healthy).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8788/');
  });

  it('keeps the literal URL only in the shared contract (source check, not runtime evidence)', () => {
    const source = readFileSync(fileURLToPath(new URL('./api-client.ts', import.meta.url)), 'utf8');

    expect(source).not.toContain("'http://localhost:8788'");
    expect(source).toContain("from '../../shared/marketplace-url'");
  });

  it.each([401, 403, 429, 400, 409, 422, 404, 500, 502])(
    'maps HTTP %i to fixed text and never forwards the backend error',
    async (status) => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status,
        statusText: 'RAW-STATUS',
        json: async () => ({ error: 'RAW-BACKEND <b>stack</b>' }),
      } as Response);

      const err = await apiClient.getExtensionDetail('ext-1').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe(marketplaceErrorMessage(status));
      expect((err as Error).message).not.toMatch(/RAW-/);
    },
  );

  it('uses the generic message for unmapped statuses', () => {
    expect(marketplaceErrorMessage(500)).toBe('Yêu cầu thất bại');
    expect(marketplaceErrorMessage(0)).toBe('Yêu cầu thất bại');
  });

  it('DeveloperUpload uses the shared base and fixed errors (source check, not runtime evidence)', () => {
    const source = readFileSync(fileURLToPath(new URL('../pages/DeveloperUpload.tsx', import.meta.url)), 'utf8');

    expect(source).not.toContain('localhost:8788');
    expect(source).not.toContain('data.error?.message');
    expect(source).toContain('${MARKETPLACE_API}/api/extensions/');
    expect(source).toContain('marketplaceErrorMessage(res.status)');
  });
});

describe('apiClient.authHeaders (DeveloperUpload auth)', () => {
  afterEach(() => {
    apiClient.setAccessToken(null);
  });

  it('returns only the bearer header when a token is set', () => {
    apiClient.setAccessToken('tok-1');

    expect(apiClient.authHeaders()).toEqual({ Authorization: 'Bearer tok-1' });
  });

  it('returns no header when the token is unset', () => {
    expect(apiClient.authHeaders()).toEqual({});
  });

  it('DeveloperUpload sends the header and clears the timer on every path (source check, not runtime evidence)', () => {
    const source = readFileSync(fileURLToPath(new URL('../pages/DeveloperUpload.tsx', import.meta.url)), 'utf8');

    expect(source).toContain('headers: apiClient.authHeaders(),');
    expect(source).not.toMatch(/'Content-Type'/);
    expect(source).toMatch(/\} finally \{\s*\/\/[^\n]*\n\s*clearInterval\(progressTimer\);/);
  });
});

describe('normalizeMarketplaceUrl', () => {
  it('drops trailing slashes and surrounding whitespace', () => {
    expect(normalizeMarketplaceUrl(' https://market.example/base// ')).toBe('https://market.example/base');
    expect(normalizeMarketplaceUrl('http://localhost:8788/')).toBe(DEFAULT_MARKETPLACE_URL);
  });

  it('treats blank, slash-only and missing values as unset', () => {
    expect(normalizeMarketplaceUrl('   ')).toBe('');
    expect(normalizeMarketplaceUrl('//')).toBe('');
    expect(normalizeMarketplaceUrl(undefined)).toBe('');
  });

  it('keeps only absolute http(s) URLs, including localhost for dev', () => {
    for (const bad of ['javascript:alert(1)', 'file:///c:/x', 'ftp://market.example', 'market.example', 'not a url']) {
      expect(normalizeMarketplaceUrl(bad)).toBe('');
    }
    expect(normalizeMarketplaceUrl('http://localhost:9999/')).toBe('http://localhost:9999');
    expect(normalizeMarketplaceUrl('HTTPS://Market.example')).toBe('HTTPS://Market.example');
  });

  it('keeps the shipped default already normalised', () => {
    expect(normalizeMarketplaceUrl(DEFAULT_MARKETPLACE_URL)).toBe(DEFAULT_MARKETPLACE_URL);
  });
});
