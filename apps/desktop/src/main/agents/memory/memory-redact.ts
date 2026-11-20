/**
 * Personal-data and secret filter for agent memory (docs/MYGRAPH-AGENT-MEMORY.md, the redaction
 * allowlist the memory-sync spec asks for). Applied to every line before it reaches the distil
 * model, and used again on what the model returns: a profile that still matches is dropped.
 *
 * Pure. Order matters: whole tokens and links go first so a later pattern never splits them.
 *
 * @module main/agents/memory/memory-redact
 */

export const REDACTED = '[đã ẩn]';

interface Rule {
  pattern: RegExp;
  /** Extra check on a match; a match it rejects is left as it is. */
  keep?: (match: string) => boolean;
}

const RULES: readonly Rule[] = [
  // JSON Web Tokens.
  { pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // Bearer credentials.
  { pattern: /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi },
  // Telegram bot tokens: numeric bot id, colon, secret.
  { pattern: /(?<!\d)\d{6,12}:[A-Za-z0-9_-]{30,}/g },
  // Facebook access tokens, Google API keys, GitHub tokens.
  { pattern: /\bEAA[A-Za-z0-9]{20,}/g },
  { pattern: /\bAIza[0-9A-Za-z_-]{30,}/g },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  // API keys of the forms izzi and its providers use.
  { pattern: /\b(?:sk|izzi)-[A-Za-z0-9_-]{12,}/g },
  // Any other long random key: 32+ letters and digits mixed.
  { pattern: /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g, keep: (match) => /\d/.test(match) && /[A-Za-z]/.test(match) },
  // Zalo links (before phones: a link often carries the phone).
  { pattern: /zalo\.me\/\S+/gi },
  // Email addresses.
  { pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // Vietnamese phone numbers: 0 (followed directly by 1-9) / 84 / +84, optionally in brackets, then 8-10
  // digits with up to 2 spaces, line breaks, dots, dashes or brackets between digits. The 2-character limit
  // keeps " - " out, so date and price ranges ("01.11.2026 - 05.11.2026", "0 - 100.000đ") stay readable.
  // A 10th digit only counts when it touches the 9th, so the leading 0 of a next number is never taken.
  { pattern: /(?<![\d+])\(?(?:\+?84|0(?=[1-9]))\)?(?:[\s.()-]{0,2}\d){8,9}\d?(?!\d)/g },
  // The same with a separator right after the 0 ("0 912 345 678", "(0) 912…"): 9-10 digits after the 0 like
  // a real number, a first group of 2+ digits and no currency after it, so lists and prices that start with 0
  // ("0 15 30 45 60", "Size 0 2 4 6 8 10…", "0-500.000.000đ") stay readable.
  { pattern: /(?<![\d+])\(?0\)?[\s.()-]{1,2}(?=[1-9]\d)(?:[\s.()-]{0,2}\d){9}\d?(?!\d)(?!\s?(?:đ|₫|vnđ|vnd))/gi },
  // Card numbers, spaced or dashed.
  { pattern: /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g },
  // Long digit runs: Facebook PSIDs, account or order ids.
  { pattern: /(?<!\d)\d{9,}(?!\d)/g },
];

/** Replaces phones, emails, Zalo links, long ids, card numbers and secrets with a fixed marker. */
export function redactPersonalData(text: string): string {
  let result = typeof text === 'string' ? text : '';
  for (const rule of RULES) {
    result = result.replace(rule.pattern, (match) => (rule.keep && !rule.keep(match) ? match : REDACTED));
  }
  return result;
}

/** True when the text holds anything `redactPersonalData` would hide. */
export function hasPersonalData(text: string): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  return RULES.some((rule) => {
    const matches = text.match(new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`));
    return (matches ?? []).some((match) => !rule.keep || rule.keep(match));
  });
}
