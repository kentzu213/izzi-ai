/**
 * Loopback receiver for Google sign-in in the system browser (RFC 8252).
 *
 * Google blocks sign-in inside embedded Electron windows ("This browser or app
 * may not be secure"), so the OAuth page opens in the user's real browser and
 * redirects back to a one-shot HTTP server on 127.0.0.1. Supabase allows any
 * http://127.0.0.1 redirect. The server only ever sees a PKCE code, which is
 * useless without the verifier held in this process.
 */

import { randomBytes } from 'crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type { AddressInfo } from 'net';

/** Give up waiting for the browser after this long so the Login form never hangs. */
export const GOOGLE_LOGIN_TIMEOUT_MS = 3 * 60 * 1000;

export const GOOGLE_LOGIN_TIMEOUT_ERROR = 'Hết thời gian chờ đăng nhập Google, vui lòng thử lại';

export const GOOGLE_LOGIN_CANCELLED_ERROR = 'Đăng nhập Google đã bị huỷ';

/** Each receiver adds a random segment so other local pages cannot guess and consume it. */
const CALLBACK_PREFIX = '/auth/callback/';

export type LoopbackOutcome =
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string };

export interface LoopbackReceiver {
  /** The redirect_to URL to hand Supabase, e.g. http://127.0.0.1:53124/auth/callback/<random>. */
  redirectUrl: string;
  /** Settles once: callback received, timeout, or close(). Never rejects. */
  result: Promise<LoopbackOutcome>;
  /** Stop listening; a still-pending result settles as cancelled. */
  close: () => void;
}

/** Read the OAuth result from a request path, or null when it is not the callback. */
export function readLoopbackCallback(requestUrl: string, callbackPath: string): LoopbackOutcome | null {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl, 'http://127.0.0.1');
  } catch {
    return null;
  }
  if (parsed.pathname !== callbackPath) return null;

  const error = parsed.searchParams.get('error_description') || parsed.searchParams.get('error');
  if (error) return { kind: 'error', message: `Google từ chối đăng nhập (${error})` };

  const code = parsed.searchParams.get('code');
  return code ? { kind: 'code', code } : null;
}

function resultPage(ok: boolean): string {
  const title = ok ? 'Đã nhận đăng nhập Google' : 'Đăng nhập Google chưa thành công';
  const body = ok
    ? 'Bạn có thể đóng tab này và quay lại Izzi AI.'
    : 'Quay lại Izzi AI và thử đăng nhập lại.';
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${title}</title></head>`
    + `<body style="font-family:system-ui,sans-serif;text-align:center;padding:64px 24px">`
    + `<h2>${title}</h2><p>${body}</p></body></html>`;
}

/** Start a one-shot callback server on a random 127.0.0.1 port. */
export function startLoopbackReceiver(timeoutMs = GOOGLE_LOGIN_TIMEOUT_MS): Promise<LoopbackReceiver> {
  let settle!: (outcome: LoopbackOutcome) => void;
  const result = new Promise<LoopbackOutcome>((resolve) => { settle = resolve; });
  let settled = false;
  const callbackPath = CALLBACK_PREFIX + randomBytes(16).toString('hex');

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const outcome = req.method === 'GET' && !settled ? readLoopbackCallback(req.url || '', callbackPath) : null;
    if (!outcome) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
    res.end(resultPage(outcome.kind === 'code'));
    finish(outcome);
  });

  const timer = setTimeout(() => finish({ kind: 'error', message: GOOGLE_LOGIN_TIMEOUT_ERROR }), timeoutMs);

  function finish(outcome: LoopbackOutcome) {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    server.close();
    settle(outcome);
  }

  return new Promise((resolve, reject) => {
    // Keep listening for errors after startup so a late socket error cannot crash the app.
    server.on('error', (err) => {
      if (settled) return;
      finish({ kind: 'error', message: err.message });
      reject(err);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        redirectUrl: `http://127.0.0.1:${port}${callbackPath}`,
        result,
        close: () => finish({ kind: 'error', message: GOOGLE_LOGIN_CANCELLED_ERROR }),
      });
    });
  });
}
