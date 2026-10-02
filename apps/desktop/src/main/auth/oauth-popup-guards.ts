/**
 * Pure guards for the Google OAuth popup in AuthManager.
 *
 * The popup used to resolve only on a token redirect or on window close, so a
 * blank/failed page left the login IPC pending forever and the Login form stuck
 * on "Đang xử lý...". These helpers give every failure path a terminal result.
 */

/** Give up on the popup after this long so the Login form never hangs. */
export const OAUTH_POPUP_TIMEOUT_MS = 3 * 60 * 1000;

export const OAUTH_POPUP_TIMEOUT_ERROR = 'Hết thời gian chờ đăng nhập Google, vui lòng thử lại';

/** Chromium's ERR_ABORTED: a navigation was superseded by a redirect — not a failure. */
const ERR_ABORTED = -3;

/**
 * Google refuses sign-in from embedded browsers it can identify by UA. Strip the
 * Electron and app product tokens so the popup presents as plain Chrome.
 */
export function chromeLikeUserAgent(userAgent: string): string {
  return userAgent
    .replace(/\s(?:Electron|izzi[^\s/]*(?: AI)?|@openclaw[^\s/]*)\/\S+/gi, '')
    .trim();
}

/**
 * Map a `did-fail-load` event to a user-facing error, or null when the event
 * should be ignored (sub-frame loads and aborted-by-redirect navigations).
 */
export function oauthLoadFailureMessage(
  errorCode: number,
  errorDescription: string,
  isMainFrame: boolean,
): string | null {
  if (!isMainFrame || errorCode === ERR_ABORTED) return null;
  const detail = errorDescription || `mã lỗi ${errorCode}`;
  return `Không tải được trang đăng nhập Google (${detail})`;
}

export type OAuthCallbackOutcome =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'error'; message: string };

const OAUTH_CALLBACK_PATH = '/auth/callback';

function parseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** True when `host` is `allowed` itself or one of its subdomains. */
function hostMatches(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

/**
 * Read the OAuth result from a popup URL. Only the izzi web callback (the apex
 * host or its www alias) is trusted — tokens appearing on any other page are
 * ignored. Returns null while the popup is still on its way to the callback.
 */
export function readOAuthCallback(url: string, webBase: string): OAuthCallbackOutcome | null {
  const parsed = parseUrl(url);
  const base = parseUrl(webBase);
  if (!parsed || !base || parsed.protocol !== base.protocol) return null;
  if (parsed.host !== base.host && parsed.host !== `www.${base.host}`) return null;
  if (parsed.pathname.replace(/\/+$/, '') !== OAUTH_CALLBACK_PATH) return null;

  const hash = new URLSearchParams(parsed.hash.slice(1));
  const read = (key: string) => hash.get(key) || parsed.searchParams.get(key);

  const error = read('error_description') || read('error');
  if (error) return { kind: 'error', message: `Google từ chối đăng nhập (${error})` };

  const accessToken = read('access_token');
  const refreshToken = read('refresh_token');
  if (!accessToken || !refreshToken) return null;
  return { kind: 'tokens', accessToken, refreshToken };
}

/** Popup-in-popup navigations are allowed only over https to the OAuth hosts. */
export function isAllowedOAuthPopupUrl(url: string, allowedHosts: string[]): boolean {
  const parsed = parseUrl(url);
  if (!parsed || parsed.protocol !== 'https:') return false;
  return allowedHosts.some((allowed) => hostMatches(parsed.hostname, allowed));
}
