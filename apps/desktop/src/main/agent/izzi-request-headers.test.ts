import { describe, expect, it } from 'vitest';
import {
  buildIzziRequestHeaders,
  buildIzziSourceHeaders,
  isOfficialIzziApiUrl,
  modelSupportsTools,
} from './izzi-request-headers';

describe('buildIzziSourceHeaders', () => {
  it.each([
    'https://api.izziapi.com/v1/chat/completions',
    'https://izziapi.com/v1/models',
  ])('attributes official Izzi HTTPS requests: %s', (url: string) => {
    expect(buildIzziSourceHeaders(url)).toEqual({ 'X-Source-Platform': 'starizzi' });
  });

  it.each([
    'https://custom.example.dev/v1/chat/completions',
    'https://api.izziapi.com.evil.test/v1/chat/completions',
    'http://api.izziapi.com/v1/chat/completions',
    'https://user:secret@api.izziapi.com/v1/chat/completions',
    'https://api.izziapi.com:444/v1/chat/completions',
    'https://api.izziapi.com/v1/chat/completions?api_key=secret',
    'https://api.izziapi.com/v1/chat/completions#fragment',
    'not-a-url',
  ])('does not leak the platform header to non-official endpoints: %s', (url: string) => {
    expect(buildIzziSourceHeaders(url)).toEqual({});
    expect(buildIzziRequestHeaders(url, 'request-id')).toEqual({});
    expect(isOfficialIzziApiUrl(url)).toBe(false);
  });

  it('adds one request identity only to a strict official URL', () => {
    expect(
      buildIzziRequestHeaders(
        'https://api.izziapi.com/v1/chat/completions',
        'request-id',
      ),
    ).toEqual({
      'X-Source-Platform': 'starizzi',
      'Idempotency-Key': 'request-id',
    });
  });
});

describe('modelSupportsTools', () => {
  it('disables tools only for direct Sol while keeping SmartRouter and Grok capable', () => {
    expect(modelSupportsTools('gpt-5.6-sol')).toBe(false);
    expect(modelSupportsTools('izzi/gpt-5.6-sol')).toBe(false);
    expect(modelSupportsTools('izzi-smart')).toBe(true);
    expect(modelSupportsTools('grok-4.5-high')).toBe(true);
  });
});
