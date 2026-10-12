import { afterEach, describe, expect, it } from 'vitest';
import {
  GOOGLE_LOGIN_CANCELLED_ERROR,
  GOOGLE_LOGIN_TIMEOUT_ERROR,
  readLoopbackCallback,
  startLoopbackReceiver,
  type LoopbackReceiver,
} from './oauth-loopback';

const CB = '/auth/callback/abc123';

describe('readLoopbackCallback', () => {
  it('returns the PKCE code from the callback path', () => {
    expect(readLoopbackCallback(`${CB}?code=abc`, CB)).toEqual({ kind: 'code', code: 'abc' });
  });

  it('reports a provider error in preference to a code', () => {
    expect(readLoopbackCallback(`${CB}?error=access_denied&error_description=denied&code=abc`, CB))
      .toEqual({ kind: 'error', message: 'Google từ chối đăng nhập (denied)' });
  });

  it('ignores other paths, a guessed segment and callbacks without code or error', () => {
    expect(readLoopbackCallback('/favicon.ico', CB)).toBeNull();
    expect(readLoopbackCallback(CB, CB)).toBeNull();
    expect(readLoopbackCallback('/auth/callback?code=abc', CB)).toBeNull();
    expect(readLoopbackCallback('/auth/callback/guess?code=abc', CB)).toBeNull();
  });
});

describe('startLoopbackReceiver', () => {
  let receiver: LoopbackReceiver | null = null;

  afterEach(() => {
    receiver?.close();
    receiver = null;
  });

  it('listens on 127.0.0.1 and resolves with the code from the browser redirect', async () => {
    receiver = await startLoopbackReceiver();
    expect(receiver.redirectUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/auth\/callback\/[0-9a-f]{32}$/);

    const res = await fetch(`${receiver.redirectUrl}?code=pkce-code`);

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('quay lại Izzi AI');
    await expect(receiver.result).resolves.toEqual({ kind: 'code', code: 'pkce-code' });
  });

  it('answers 404 to unrelated requests and keeps waiting for the callback', async () => {
    receiver = await startLoopbackReceiver();
    const origin = new URL(receiver.redirectUrl).origin;

    expect((await fetch(`${origin}/favicon.ico`)).status).toBe(404);
    expect((await fetch(`${origin}/auth/callback?code=guess`)).status).toBe(404);
    await fetch(`${receiver.redirectUrl}?code=late-code`);

    await expect(receiver.result).resolves.toEqual({ kind: 'code', code: 'late-code' });
  });

  it('stops listening after the first callback', async () => {
    receiver = await startLoopbackReceiver();
    await fetch(`${receiver.redirectUrl}?code=first`);
    await receiver.result;

    await expect(fetch(`${receiver.redirectUrl}?code=second`)).rejects.toThrow();
  });

  it('resolves with a timeout error when the browser never comes back', async () => {
    receiver = await startLoopbackReceiver(20);

    await expect(receiver.result).resolves.toEqual({ kind: 'error', message: GOOGLE_LOGIN_TIMEOUT_ERROR });
  });

  it('resolves as cancelled when closed early', async () => {
    receiver = await startLoopbackReceiver();
    receiver.close();

    await expect(receiver.result).resolves.toEqual({ kind: 'error', message: GOOGLE_LOGIN_CANCELLED_ERROR });
  });
});
