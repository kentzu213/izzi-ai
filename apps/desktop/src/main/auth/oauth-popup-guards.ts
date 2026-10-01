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
