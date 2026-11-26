import { describe, it, expect } from 'vitest';
import {
  REDACTION,
  containsSensitiveMaterial,
  evaluateSensitivePolicy,
  isValidLuhn,
  redactSensitiveText,
  scanSensitiveContent,
  validateSourceUri,
} from './secret-pii-gate';

describe('secret-pii-gate', () => {
  it('blocks API keys, JWTs, emails, and Luhn-valid cards without leaking raw values in findings', () => {
    const sample = [
      'key=sk-proj-1234567890abcdefghijklmno',
      'izzi-0123456789abcdef0123456789abcdef',
      'contact: founder@example.com',
      'card: 4532 0151 1283 0366',
    ].join('\n');

    const findings = scanSensitiveContent(sample);
    expect(evaluateSensitivePolicy(findings)).toBe('block');
    const kinds = new Set(findings.map((f) => f.kind));
    expect(kinds.has('openai-key')).toBe(true);
    expect(kinds.has('izzi-key')).toBe(true);
    expect(kinds.has('email-address')).toBe(true);
    expect(kinds.has('payment-card')).toBe(true);

    // Findings metadata must never carry any raw sensitive token.
    const serialized = JSON.stringify(findings);
    expect(serialized).not.toContain('sk-proj-1234567890');
    expect(serialized).not.toContain('izzi-0123456789abcdef');
    expect(serialized).not.toContain('founder@example.com');
    expect(serialized).not.toContain('4532 0151 1283 0366');
  });

  it('redacts secrets and PII while keeping ordinary prose and non-Luhn numbers intact', () => {
    const input = 'User user@company.vn used izzi-aabbccddeeff001122334455 on order 12345678901234';
    expect(isValidLuhn('12345678901234')).toBe(false);

    const { text, redactedCount } = redactSensitiveText(input);
    expect(redactedCount).toBeGreaterThanOrEqual(2);
    expect(text).not.toContain('user@company.vn');
    expect(text).not.toContain('izzi-aabbccddeeff001122334455');
    expect(text).toContain(REDACTION);
    expect(text).toContain('12345678901234');
  });

  it('allows opaque secret references and clean prose', () => {
    const clean = 'Use env:OPENAI_API_KEY and secretRef:izzi_token for authentication.';
    expect(scanSensitiveContent(clean)).toEqual([]);
    expect(containsSensitiveMaterial({ note: clean, sha256: 'a'.repeat(64) })).toBe(false);
  });

  it('blocks credential file paths and credential-bearing URLs', () => {
    expect(validateSourceUri('/repo/.env').ok).toBe(false);
    expect(validateSourceUri('F:\\proj\\.env.production').ok).toBe(false);
    expect(validateSourceUri('/home/user/.codex/auth.json').ok).toBe(false);
    expect(validateSourceUri('/tmp/my-credentials.json').ok).toBe(false);
    expect(validateSourceUri('https://user:pass@api.example.com/v1').ok).toBe(false);
    expect(validateSourceUri('https://api.example.com/v1?api_key=secret123').ok).toBe(false);

    expect(validateSourceUri('apps/desktop/src/main/graph/graph-client.ts').ok).toBe(true);
    expect(validateSourceUri('https://izziapi.com/docs?page=2').ok).toBe(true);
  });

  it('blocks and redacts Vietnamese phone numbers, Zalo links, Telegram & Facebook tokens while keeping date/price ranges intact', () => {
    const sensitive = [
      'Gọi 0912 345 678 hoặc +84 987 654 321 hoặc (0) 912 345 678',
      'Liên hệ https://zalo.me/0912345678',
      'Bot 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw',
      'FB EAABsbCS1iHgBO1234567890abcdef123456',
    ].join('\n');

    const findings = scanSensitiveContent(sensitive);
    const kinds = new Set(findings.map((f) => f.kind));
    expect(kinds.has('vn-phone')).toBe(true);
    expect(kinds.has('zalo-link')).toBe(true);
    expect(kinds.has('telegram-bot-token')).toBe(true);
    expect(kinds.has('facebook-token')).toBe(true);

    const { text } = redactSensitiveText(sensitive);
    expect(text).not.toContain('0912 345 678');
    expect(text).not.toContain('987 654 321');
    expect(text).not.toContain('zalo.me');
    expect(text).not.toContain('123456789:AAHdq');
    expect(text).not.toContain('EAABsbCS1iHg');

    const benign = 'Khoảng ngày 01.11.2026 - 05.11.2026, ngân sách 0-500.000.000đ, mức 0 15 30 45 60.';
    expect(scanSensitiveContent(benign)).toEqual([]);
    expect(redactSensitiveText(benign).text).toBe(benign);
  });
});
