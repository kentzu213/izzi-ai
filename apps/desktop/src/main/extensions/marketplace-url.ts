/**
 * Single source for the Marketplace API base URL in the main process (ledger #11).
 *
 * `OPENCLAW_MARKETPLACE_URL` is canonical (same prefix as the other OPENCLAW_* endpoints).
 * `MARKETPLACE_API_URL` is still read as a legacy fallback. Blank values count as unset.
 * Trailing slashes are dropped because callers append `/api/...`.
 */

import { DEFAULT_MARKETPLACE_URL, normalizeMarketplaceUrl as normalize } from '../../shared/marketplace-url';

export { DEFAULT_MARKETPLACE_URL };

export function resolveMarketplaceUrl(env: NodeJS.ProcessEnv = process.env): string {
  return normalize(env.OPENCLAW_MARKETPLACE_URL) || normalize(env.MARKETPLACE_API_URL) || DEFAULT_MARKETPLACE_URL;
}
