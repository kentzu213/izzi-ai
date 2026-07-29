import { describe, expect, it } from 'vitest';
import { redactRuntimeText } from './redaction';

describe('runtime redaction', () => {
  it('redacts bearer, cookie and named credential values while preserving context', () => {
    const input = [
      'Authorization: Bearer abcDEF123456ghiJKL',
      'Cookie: sid=browser-cookie',
      'Set-Cookie: session=browser-session; HttpOnly',
      'password=hunter2',
      '"apiKey":"plain-looking-key"',
    ].join('\n');
    const output = redactRuntimeText(input);
    for (const secret of [
      'abcDEF123456ghiJKL',
      'browser-cookie',
      'browser-session',
      'hunter2',
      'plain-looking-key',
    ]) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('Authorization: [redacted]');
    expect(output).toContain('password=[redacted]');
  });

  it('redacts resolved secret values even when they have no recognizable shape', () => {
    expect(redactRuntimeText('adapter failed with opaque-value', ['opaque-value']))
      .toBe('adapter failed with [redacted]');
  });
});
