import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  OAUTH_POPUP_TIMEOUT_MS,
  chromeLikeUserAgent,
  oauthLoadFailureMessage,
} from './oauth-popup-guards';

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
});
