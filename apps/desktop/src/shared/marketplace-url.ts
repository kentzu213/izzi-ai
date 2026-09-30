/**
 * Marketplace base-URL contract shared by main and renderer (ledger #11).
 * Node-free on purpose: the renderer imports it, and only main can read env
 * (see `main/extensions/marketplace-url.ts`).
 */

export const DEFAULT_MARKETPLACE_URL = 'http://localhost:8788';

/**
 * Trims and drops trailing slashes, because callers append `/api/...`. Blank → ''.
 * Only absolute `http:` / `https:` URLs are kept; anything else (`file:`, `javascript:`, `ftp:`,
 * unparsable text) → '' so the resolver falls through. No host allow-list (owner decision), so
 * `http://localhost` stays valid for dev.
 */
export function normalizeMarketplaceUrl(value: string | undefined): string {
  const trimmed = value?.trim().replace(/\/+$/, '') ?? '';
  if (!trimmed) return '';
  try {
    const { protocol } = new URL(trimmed);
    return protocol === 'http:' || protocol === 'https:' ? trimmed : '';
  } catch {
    return '';
  }
}
