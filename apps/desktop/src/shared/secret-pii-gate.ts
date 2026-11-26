/**
 * Secret & PII Gate — shared egress/capture security gate matching the Obsidian
 * `project-memory` (`memory_store.py`) quality bar on top of `live-secrets.ts`.
 *
 * Covers:
 *  - All credential detectors from `live-secrets.ts` (PEM private keys, sk-ant,
 *    sk-, izzi-, AKIA/ASIA, AIza, GitHub tokens, Slack tokens, JWT, Bearer,
 *    OAuth refresh tokens, `key=value` credential assignments, high-entropy blobs)
 *  - Email addresses (`email-address`)
 *  - Payment card numbers validated by Luhn checksum (`payment-card`, 13–19 digits)
 *  - Credential-bearing source URIs (`.env`, `.env.*`, `auth.json`, `credential`
 *    path segments, URL userinfo `user:pass@`, sensitive query keys)
 *
 * Security (security-baseline A/C/D):
 *  - Findings NEVER expose raw matched values (kinds/lines/lengths/redacted previews only).
 *  - Own-property traversal only (no prototype-chain access).
 *  - Pure, deterministic, never throws.
 *
 * @module shared/secret-pii-gate
 */

import {
  REDACTION,
  evaluateSecretPolicy,
  redactSecrets,
  scanForSecrets,
  type SecretFinding,
  type SecretVerdict,
} from './live-secrets';

export { REDACTION, type SecretFinding, type SecretVerdict };

const TELEGRAM_TOKEN_RE = /(?<!\d)\d{6,12}:[A-Za-z0-9_-]{30,}/g;
const FACEBOOK_TOKEN_RE = /\bEAA[A-Za-z0-9]{20,}/g;
const ZALO_LINK_RE = /zalo\.me\/\S+/gi;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// Vietnamese phone numbers (aligned with PR #73 memory-redact rules): keeps date/price
// ranges like "01.11.2026 - 05.11.2026" and "0-500.000.000đ" untouched.
const VN_PHONE_PRIMARY_RE = /(?<![\d+])\(?(?:\+?84|0(?=[1-9]))\)?(?:[\s.()-]{0,2}\d){8,9}\d?(?!\d)/g;
const VN_PHONE_SPACED_ZERO_RE =
  /(?<![\d+])\(?0\)?[\s.()-]{1,2}(?=[1-9]\d)(?:[\s.()-]{0,2}\d){9}\d?(?!\d)(?!\s?(?:đ|₫|vnđ|vnd))/gi;
const CARD_CANDIDATE_RE = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;
// Recognized payment-card IIN prefixes + lengths (Visa, Mastercard, Amex, Diners,
// Discover, JCB, UnionPay, Maestro, and Vietnam Napas 9704) so 13-digit Unix ms
// timestamps (16xxxxxxxxxxx–19xxxxxxxxxxx) never false-positive on Luhn 1-in-10.
const PAYMENT_CARD_IIN_RE =
  /^(?:4\d{12}(?:\d{3}|\d{6})?|5[1-5]\d{14}|2(?:22[1-9]|2[3-9]\d|[3-6]\d{2}|7[01]\d|720)\d{12}|3[47]\d{13}|3(?:0[0-5]|[68]\d)\d{11}|6(?:011|5\d{2}|4[4-9]\d)\d{12}|(?:2131|1800|35\d{3})\d{11}|62\d{14,17}|(?:50|5[6-9]|6\d)\d{11,17}|9704\d{12,15})$/;

const SENSITIVE_QUERY_KEYS = new Set([
  'api_key',
  'apikey',
  'access_token',
  'token',
  'password',
  'secret',
  'credential',
]);

/** Pure Luhn checksum validator for 13–19 digit payment card candidates. */
export function isValidLuhn(digits: string): boolean {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let total = 0;
  const parity = digits.length % 2;
  for (let i = 0; i < digits.length; i += 1) {
    let d = digits.charCodeAt(i) - 48;
    if (i % 2 === parity) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    total += d;
  }
  return total % 10 === 0;
}

/** True only when digits match a recognized card network IIN/length AND pass Luhn. */
export function isLikelyPaymentCard(digits: string): boolean {
  return PAYMENT_CARD_IIN_RE.test(digits) && isValidLuhn(digits);
}

function previewMasked(line: string, matches: readonly string[]): string {
  let out = line;
  for (const m of matches) {
    if (m.length > 0) out = out.split(m).join(REDACTION);
  }
  return out.length > 160 ? `${out.slice(0, 157)}…` : out;
}

/**
 * Scan text for secrets AND PII (email + Luhn payment cards).
 * Never returns matched raw characters. Never throws.
 */
export function scanSensitiveContent(text: string): SecretFinding[] {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const findings: SecretFinding[] = [...scanForSecrets(src)];
  const lines = src.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length === 0) continue;

    const collectRegex = (re: RegExp, kind: string, hint: string): void => {
      const matches: string[] = [];
      const localRe = new RegExp(re.source, re.flags);
      let m: RegExpExecArray | null;
      while ((m = localRe.exec(line)) !== null) {
        matches.push(m[0]);
      }
      if (matches.length > 0) {
        const longest = matches.reduce((a, b) => (b.length > a.length ? b : a));
        findings.push({
          kind,
          severity: 'block',
          line: i + 1,
          length: longest.length,
          preview: previewMasked(line, matches),
          hint,
        });
      }
    };

    // Telegram & Facebook tokens, Zalo links
    collectRegex(TELEGRAM_TOKEN_RE, 'telegram-bot-token', 'Không lưu Telegram bot token vào bộ nhớ hay đồ thị.');
    collectRegex(FACEBOOK_TOKEN_RE, 'facebook-token', 'Không lưu Facebook access token vào bộ nhớ hay đồ thị.');
    collectRegex(ZALO_LINK_RE, 'zalo-link', 'Không lưu liên kết Zalo cá nhân vào tri thức chia sẻ.');

    // Email addresses
    collectRegex(EMAIL_RE, 'email-address', 'Không lưu trực tiếp địa chỉ email cá nhân vào tri thức chia sẻ.');

    // Vietnamese phone numbers (strip zalo.me links first so phone inside URL isn't double-counted)
    const lineNoZalo = line.replace(new RegExp(ZALO_LINK_RE.source, ZALO_LINK_RE.flags), ' ');
    const phones: string[] = [];
    for (const phoneRe of [VN_PHONE_PRIMARY_RE, VN_PHONE_SPACED_ZERO_RE]) {
      const localRe = new RegExp(phoneRe.source, phoneRe.flags);
      let pm: RegExpExecArray | null;
      while ((pm = localRe.exec(lineNoZalo)) !== null) {
        phones.push(pm[0]);
      }
    }
    if (phones.length > 0) {
      const longest = phones.reduce((a, b) => (b.length > a.length ? b : a));
      findings.push({
        kind: 'vn-phone',
        severity: 'block',
        line: i + 1,
        length: longest.length,
        preview: previewMasked(line, phones),
        hint: 'Không lưu số điện thoại cá nhân vào tri thức chia sẻ.',
      });
    }

    // Luhn-valid payment cards (network IIN + Luhn to prevent Unix ms timestamp false positives)
    const cards: string[] = [];
    const cardRe = new RegExp(CARD_CANDIDATE_RE.source, CARD_CANDIDATE_RE.flags);
    let m: RegExpExecArray | null;
    while ((m = cardRe.exec(line)) !== null) {
      const digits = m[0].replace(/\D/g, '');
      if (isLikelyPaymentCard(digits)) cards.push(m[0].trim());
    }
    if (cards.length > 0) {
      const longest = cards.reduce((a, b) => (b.length > a.length ? b : a));
      findings.push({
        kind: 'payment-card',
        severity: 'block',
        line: i + 1,
        length: longest.length,
        preview: previewMasked(line, cards),
        hint: 'Không lưu số thẻ thanh toán vào bộ nhớ hay đồ thị.',
      });
    }
  }

  return findings.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
}

/** Worst verdict across secret + PII findings (`clean` | `warn` | `block`). */
export function evaluateSensitivePolicy(findings: readonly SecretFinding[]): SecretVerdict {
  return evaluateSecretPolicy(findings);
}

/**
 * Redact all secrets AND PII (email, Luhn cards) from free text, returning the
 * sanitized text plus token-free findings metadata. Never throws.
 */
export function redactSensitiveText(text: string): {
  text: string;
  findings: SecretFinding[];
  redactedCount: number;
} {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const findings = scanSensitiveContent(src);
  if (findings.length === 0) {
    return { text: src, findings: [], redactedCount: 0 };
  }

  // 1. Secret patterns via live-secrets (preserves key labels like `password:`).
  let out = redactSecrets(src).text;

  // 2. Platform tokens & Zalo links (whole tokens/links before phone regex).
  out = out.replace(new RegExp(TELEGRAM_TOKEN_RE.source, TELEGRAM_TOKEN_RE.flags), REDACTION);
  out = out.replace(new RegExp(FACEBOOK_TOKEN_RE.source, FACEBOOK_TOKEN_RE.flags), REDACTION);
  out = out.replace(new RegExp(ZALO_LINK_RE.source, ZALO_LINK_RE.flags), REDACTION);

  // 3. Email addresses.
  out = out.replace(new RegExp(EMAIL_RE.source, EMAIL_RE.flags), REDACTION);

  // 4. Vietnamese phone numbers.
  out = out.replace(new RegExp(VN_PHONE_PRIMARY_RE.source, VN_PHONE_PRIMARY_RE.flags), REDACTION);
  out = out.replace(new RegExp(VN_PHONE_SPACED_ZERO_RE.source, VN_PHONE_SPACED_ZERO_RE.flags), REDACTION);

  // 5. Luhn-valid card numbers.
  out = out.replace(new RegExp(CARD_CANDIDATE_RE.source, CARD_CANDIDATE_RE.flags), (raw) => {
    const digits = raw.replace(/\D/g, '');
    return isLikelyPaymentCard(digits) ? REDACTION : raw;
  });

  return { text: out, findings, redactedCount: findings.length };
}

/**
 * Validate that a source path / URI does not reference a credential file or
 * embed credentials in userinfo/query parameters (mirrors `memory_store.py`).
 */
export function validateSourceUri(uri: string): { ok: true } | { ok: false; reason: string } {
  const raw = String(uri ?? '').trim();
  if (raw.length === 0) return { ok: false, reason: 'empty source URI' };

  const normalized = raw.replace(/\\/g, '/').toLowerCase();
  const pathPart = normalized.split(/[?#]/, 1)[0];
  const segments = pathPart.split('/').filter(Boolean);
  for (const seg of segments) {
    if (
      seg === '.env' ||
      seg.startsWith('.env.') ||
      seg === 'auth.json' ||
      seg === '.izzi-memory-key' ||
      seg.includes('credential')
    ) {
      return { ok: false, reason: 'blocked credential evidence path' };
    }
  }

  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
      const parsed = new URL(raw);
      if (parsed.username || parsed.password) {
        return { ok: false, reason: 'credential-bearing source URI is prohibited' };
      }
      for (const [key, value] of parsed.searchParams.entries()) {
        if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) && value.length > 0) {
          return { ok: false, reason: 'credential-bearing source URI is prohibited' };
        }
      }
    }
  } catch {
    // Non-URL file path — already checked segment rules above.
  }

  return { ok: true };
}

/**
 * Recursively check whether an arbitrary payload contains block-level secrets
 * or PII (own-property traversal only; skips `sha256` hash fields).
 */
export function containsSensitiveMaterial(value: unknown, key = ''): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') {
    if (key.toLowerCase() === 'sha256' || key.toLowerCase() === 'source_sha256') return false;
    return evaluateSensitivePolicy(scanSensitiveContent(value)) === 'block';
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsSensitiveMaterial(item, key));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj)) {
      if (Object.hasOwn(obj, k) && containsSensitiveMaterial(obj[k], k)) return true;
    }
  }
  return false;
}
