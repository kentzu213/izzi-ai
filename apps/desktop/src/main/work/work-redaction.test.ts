import { describe, expect, it } from 'vitest';
import { containsSecret, redactDeep, redactJson, redactText } from './work-redaction';

describe('work-redaction', () => {
  it('redacts token-shaped secrets by value', () => {
    const cases = [
      'izzi-abcdef0123456789ABCDEF',
      'sk-abcdefghijklmnopqrstuvwx',
      'ghp_abcdefghijklmnopqrstuvwxyz012345',
      'AKIAIOSFODNN7EXAMPLE',
      'eyJhbGciOiJIUzI1Nisdf.eyJzdWIiOiIxMjM0NTY.SflKxwRJSMeKKF2QT4',
    ];
    for (const secret of cases) {
      const { value } = redactText(`token=${secret} end`);
      expect(value).not.toContain(secret);
      expect(value).toContain('[redacted]');
    }
  });

  it('redacts Bearer credentials but keeps surrounding words', () => {
    const { value } = redactText('use Authorization: Bearer abcDEF123456ghiJKL as header');
    expect(value).toContain('use');
    expect(value).toContain('as header');
    expect(value).not.toContain('abcDEF123456ghiJKL');
  });

  it('does NOT redact a sha256 digest (audit provenance must survive)', () => {
    const digest = 'a'.repeat(64);
    const { value, kinds } = redactText(`sha256=${digest}`);
    expect(value).toContain(digest);
    expect(kinds).toHaveLength(0);
  });

  it('masks email and phone as PII, keeping domain context', () => {
    const email = redactText('reach nguyen@izziapi.com now');
    expect(email.value).toContain('@izziapi.com');
    expect(email.value).not.toContain('nguyen@izziapi.com');

    const phone = redactText('call +84 912 345 678 today');
    expect(phone.value).not.toContain('912 345 678');
    expect(phone.value).toContain('[phone:***78]');
  });

  it('redacts a value whose KEY names a credential, whatever the value looks like', () => {
    const { value } = redactDeep({ apiKey: 'plainlooking', nested: { password: 'hunter2' } });
    const record = value as { apiKey: string; nested: { password: string } };
    expect(record.apiKey).toBe('[redacted]');
    expect(record.nested.password).toBe('[redacted]');
  });

  it('drops prototype-polluting keys instead of copying them', () => {
    const hostile = JSON.parse('{"__proto__": {"polluted": true}, "safe": 1}');
    const { value } = redactDeep(hostile);
    expect((value as Record<string, unknown>).safe).toBe(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(value, '__proto__')).toBe(false);
  });

  it('tags which kinds fired when serialising a payload', () => {
    const { json, kinds } = redactJson({ note: 'key sk-abcdefghijklmnop0123', ok: true });
    expect(json).not.toContain('sk-abcdefghijklmnop0123');
    expect(kinds).toContain('openai-key');
  });

  it('containsSecret ignores PII but flags live credentials', () => {
    expect(containsSecret('email me at a@b.com')).toBe(false);
    expect(containsSecret('key izzi-abcdef0123456789abcd')).toBe(true);
  });
});
