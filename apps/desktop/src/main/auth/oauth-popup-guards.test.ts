import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OAUTH_POPUP_TIMEOUT_MS,
  chromeLikeUserAgent,
  isAllowedOAuthPopupUrl,
  oauthLoadFailureMessage,
  readOAuthCallback,
} from './oauth-popup-guards';

const WEB_BASE = 'https://izziapi.com';

describe('chromeLikeUserAgent', () => {
  it('strips the Electron and app product tokens so Google sees a plain Chrome UA', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) izzi-ai/1.14.0-beta.76 Chrome/142.0.7444.59 Electron/39.8.10 Safari/537.36';

    const result = chromeLikeUserAgent(ua);

    expect(result).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.59 Safari/537.36',
    );
  });

  it('strips the packaged product name even though it contains a space', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Izzi AI/1.14.0-beta.79 Chrome/142.0.7444.59 Electron/39.8.10 Safari/537.36';

    expect(chromeLikeUserAgent(ua)).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.59 Safari/537.36',
    );
  });

  it('leaves a plain Chrome UA untouched', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

    expect(chromeLikeUserAgent(ua)).toBe(ua);
  });
});

describe('oauthLoadFailureMessage', () => {
  it('reports a main-frame load failure with the network reason', () => {
    expect(oauthLoadFailureMessage(-106, 'ERR_INTERNET_DISCONNECTED', true)).toBe(
      'Không tải được trang đăng nhập Google (ERR_INTERNET_DISCONNECTED)',
    );
  });

  it('ignores navigations aborted by a redirect', () => {
    expect(oauthLoadFailureMessage(-3, 'ERR_ABORTED', true)).toBeNull();
  });

  it('ignores sub-frame failures', () => {
    expect(oauthLoadFailureMessage(-105, 'ERR_NAME_NOT_RESOLVED', false)).toBeNull();
  });

  it('falls back to the error code when the description is empty', () => {
    expect(oauthLoadFailureMessage(-2, '', true)).toBe('Không tải được trang đăng nhập Google (mã lỗi -2)');
  });
});

describe('readOAuthCallback', () => {
  it('accepts tokens from the hash of the izzi callback URL', () => {
    const url = `${WEB_BASE}/auth/callback#access_token=a1&refresh_token=r1&token_type=bearer`;

    expect(readOAuthCallback(url, WEB_BASE)).toEqual({ kind: 'tokens', accessToken: 'a1', refreshToken: 'r1' });
  });

  it('accepts tokens from the query and from the www host with a trailing slash', () => {
    const url = 'https://www.izziapi.com/auth/callback/?access_token=a2&refresh_token=r2';

    expect(readOAuthCallback(url, WEB_BASE)).toEqual({ kind: 'tokens', accessToken: 'a2', refreshToken: 'r2' });
  });

  it('ignores tokens on a foreign origin, another path or plain http', () => {
    const tokens = '#access_token=a&refresh_token=r';

    expect(readOAuthCallback(`https://evil.example/auth/callback${tokens}`, WEB_BASE)).toBeNull();
    expect(readOAuthCallback(`https://izziapi.com.evil.example/auth/callback${tokens}`, WEB_BASE)).toBeNull();
    expect(readOAuthCallback(`${WEB_BASE}/other${tokens}`, WEB_BASE)).toBeNull();
    expect(readOAuthCallback(`http://izziapi.com/auth/callback${tokens}`, WEB_BASE)).toBeNull();
  });

  it('returns null on the callback URL while tokens are still missing', () => {
    expect(readOAuthCallback(`${WEB_BASE}/auth/callback#access_token=only`, WEB_BASE)).toBeNull();
    expect(readOAuthCallback('not a url', WEB_BASE)).toBeNull();
  });

  it('turns an OAuth error on the callback into a terminal error', () => {
    const url = `${WEB_BASE}/auth/callback?error=access_denied&error_description=User+cancelled`;

    expect(readOAuthCallback(url, WEB_BASE)).toEqual({
      kind: 'error',
      message: 'Google từ chối đăng nhập (User cancelled)',
    });
    expect(readOAuthCallback(`${WEB_BASE}/auth/callback#error=server_error`, WEB_BASE)).toEqual({
      kind: 'error',
      message: 'Google từ chối đăng nhập (server_error)',
    });
  });
});

describe('isAllowedOAuthPopupUrl', () => {
  const hosts = ['google.com', 'qdtfaebdgyyujygxnvqi.supabase.co', 'izziapi.com'];

  it('allows https URLs on an allowed host or its subdomain', () => {
    expect(isAllowedOAuthPopupUrl('https://accounts.google.com/o/oauth2/v2/auth', hosts)).toBe(true);
    expect(isAllowedOAuthPopupUrl('https://qdtfaebdgyyujygxnvqi.supabase.co/auth/v1/callback', hosts)).toBe(true);
    expect(isAllowedOAuthPopupUrl('https://izziapi.com/auth/callback', hosts)).toBe(true);
  });

  it('denies http, unknown hosts, look-alike hosts and non-URLs', () => {
    expect(isAllowedOAuthPopupUrl('http://accounts.google.com/', hosts)).toBe(false);
    expect(isAllowedOAuthPopupUrl('https://evil.example/', hosts)).toBe(false);
    expect(isAllowedOAuthPopupUrl('https://notgoogle.com/', hosts)).toBe(false);
    expect(isAllowedOAuthPopupUrl('javascript:alert(1)', hosts)).toBe(false);
    expect(isAllowedOAuthPopupUrl('garbage', hosts)).toBe(false);
  });
});

describe('AuthManager OAuth popup wiring', () => {
  const source = fs.readFileSync(path.join(__dirname, 'auth-manager.ts'), 'utf8');

  it('always settles the popup: load failure, crash, timeout and loadURL rejection', () => {
    expect(source).toMatch(/'did-fail-load'/);
    expect(source).toMatch(/'render-process-gone'/);
    expect(source).toMatch(/OAUTH_POPUP_TIMEOUT_MS/);
    expect(source).toMatch(/clearTimeout\(timeout\)/);
    expect(source).toMatch(/loadURL\(authUrl\)\.catch/);
    expect(OAUTH_POPUP_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('presents a Chrome-like UA and keeps OAuth popups inside the same window', () => {
    expect(source).toMatch(/setUserAgent\(chromeLikeUserAgent\(/);
    expect(source).toMatch(/setWindowOpenHandler/);
    expect(source).toMatch(/'did-navigate-in-page'/);
  });

  it('only trusts the izzi callback URL and allow-listed popup hosts', () => {
    expect(source).toMatch(/readOAuthCallback\(url, IZZI_WEB_BASE\)/);
    expect(source).toMatch(/isAllowedOAuthPopupUrl\(url, OAUTH_POPUP_HOSTS\)/);
    expect(source).toMatch(/partition: 'persist:oauth-google'/);
  });
});
