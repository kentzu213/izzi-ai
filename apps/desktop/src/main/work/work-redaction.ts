/**
 * Redaction for everything the unified work model persists.
 *
 * Loop 03 security gate (surfaces C/D): a run's event payloads, artifacts,
 * approval inputs and checkpoint cursors are long-lived rows in the local
 * SQLite file. They are produced by models, tools and external bridges, so they
 * must be scrubbed of credential *values* and of customer PII BEFORE they are
 * written — never after, and never "on read".
 *
 * Two rules shape this module:
 * - Secrets are referenced by shape, not by name: we match the token formats we
 *   actually mint/consume (izzi-, sk-, Bearer, JWT, gh*_, AKIA) plus any key
 *   whose NAME says it holds a credential.
 * - Object walking is own-property only and drops prototype-polluting keys.
 *   An untrusted key is data, never a selector (bài học `__proto__`).
 *
 * Pure module: no node builtins, no Electron — importable from main, renderer
 * and tests alike.
 *
 * @module shared/work-redaction
 */

export const REDACTED = '[redacted]';

/** Kinds of redaction that happened, so a run stays auditable without the value. */
export type RedactionKind =
  | 'secret-key-name'
  | 'jwt'
  | 'openai-key'
  | 'izzi-key'
  | 'bearer'
  | 'github-token'
  | 'aws-access-key'
  | 'private-key-block'
  | 'email'
  | 'phone';

/** Keys whose NAME means the value is a credential, whatever the value looks like. */
const SECRET_KEY_NAME =
  /(^|[^a-z])(pass(word|phrase)?|secret|token|api[-_ ]?key|apikey|authorization|auth[-_ ]?header|cookie|credential|private[-_ ]?key|client[-_ ]?secret|refresh[-_ ]?token|access[-_ ]?token|session[-_ ]?token|bearer|signature)([^a-z]|$)/i;

/** Keys that must never be copied onto a result object (prototype pollution). */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

interface ValuePattern {
  kind: RedactionKind;
  pattern: RegExp;
  replace?: (match: string) => string;
}

/**
 * Value-shaped secrets. Deliberately NOT matching bare long hex: we store
 * sha256 digests on purpose (artifact + action-hash provenance), and redacting
 * those would destroy the audit chain.
 */
const VALUE_PATTERNS: ValuePattern[] = [
  {
    kind: 'private-key-block',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  { kind: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\b/g },
  { kind: 'openai-key', pattern: /\bsk-[A-Za-z0-9_-]{12,}\b/g },
  { kind: 'izzi-key', pattern: /\bizzi-[A-Za-z0-9_-]{12,}\b/g },
  { kind: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g },
  { kind: 'aws-access-key', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{12,}\b/g },
  { kind: 'bearer', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}/gi },
  {
    kind: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replace: maskEmail,
  },
  {
    // Phone-like: 9+ digits, optionally grouped. Keeps the last 2 so a human can
    // still recognise "their" number in an approval preview.
    kind: 'phone',
    pattern: /(?<![\w.])\+?\d(?:[\d\s().-]{7,}\d)(?![\w.])/g,
    replace: maskPhone,
  },
];

/** `nguyen@izziapi.com` → `n***@izziapi.com`. Keeps the domain: it is business context, not identity. */
function maskEmail(value: string): string {
  const at = value.lastIndexOf('@');
  if (at <= 0) return REDACTED;
  const local = value.slice(0, at);
  const domain = value.slice(at);
  return `${local.slice(0, 1)}***${domain}`;
}

/** `+84 912 345 678` → `[phone:***78]`. */
function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 9) return value;
  return `[phone:***${digits.slice(-2)}]`;
}

/** Redact a single string. Returns the scrubbed text plus which kinds fired. */
export function redactText(input: string): { value: string; kinds: RedactionKind[] } {
  if (!input) return { value: input, kinds: [] };
  const kinds = new Set<RedactionKind>();
  let value = input;

  for (const { kind, pattern, replace } of VALUE_PATTERNS) {
    // Fresh regex per call: the module-level ones carry /g state.
    const re = new RegExp(pattern.source, pattern.flags);
    value = value.replace(re, (match) => {
      kinds.add(kind);
      return replace ? replace(match) : `${REDACTED}:${kind}`;
    });
  }

  return { value, kinds: [...kinds] };
}

export interface RedactionResult<T> {
  value: T;
  kinds: RedactionKind[];
}

const MAX_DEPTH = 12;
const MAX_STRING_LENGTH = 20_000;

/**
 * Deep-redact any JSON-shaped value. Structure is preserved so a run's payload
 * stays readable; only credential values and PII are replaced.
 *
 * A key whose NAME says "credential" has its whole value replaced, even if the
 * value shape looks innocent — that is the case the shape patterns cannot catch.
 */
export function redactDeep<T>(input: T): RedactionResult<T> {
  const kinds = new Set<RedactionKind>();
  const value = walk(input, 0, kinds, false) as T;
  return { value, kinds: [...kinds] };
}

function walk(
  input: unknown,
  depth: number,
  kinds: Set<RedactionKind>,
  parentKeyIsSecret: boolean,
): unknown {
  if (parentKeyIsSecret) {
    // The key already told us this is a credential. Never inspect the value.
    if (input === null || input === undefined) return input;
    kinds.add('secret-key-name');
    return REDACTED;
  }

  if (input === null || input === undefined) return input;

  if (typeof input === 'string') {
    const clipped = input.length > MAX_STRING_LENGTH ? input.slice(0, MAX_STRING_LENGTH) : input;
    const result = redactText(clipped);
    result.kinds.forEach((kind) => kinds.add(kind));
    return result.value;
  }

  if (typeof input === 'number' || typeof input === 'boolean') return input;
  if (typeof input === 'bigint') return input.toString();
  if (typeof input === 'function' || typeof input === 'symbol') return undefined;

  if (depth >= MAX_DEPTH) return '[truncated]';

  if (Array.isArray(input)) {
    return input.map((item) => walk(item, depth + 1, kinds, false));
  }

  if (input instanceof Date) return input.toISOString();

  if (typeof input === 'object') {
    const out: Record<string, unknown> = {};
    // Own enumerable keys only — inherited keys are not this object's data.
    for (const key of Object.keys(input as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(key)) {
        // Not an error: an untrusted key is data we decline to carry.
        continue;
      }
      const child = (input as Record<string, unknown>)[key];
      const next = walk(child, depth + 1, kinds, SECRET_KEY_NAME.test(key));
      if (next !== undefined) out[key] = next;
    }
    return out;
  }

  return undefined;
}

/**
 * Redact then serialise. This is the single door every persisted JSON payload
 * goes through, so "was it scrubbed?" has one answer instead of one per caller.
 */
export function redactJson(input: unknown): { json: string; kinds: RedactionKind[] } {
  const { value, kinds } = redactDeep(input);
  let json: string;
  try {
    json = JSON.stringify(value ?? null);
  } catch {
    // Cyclic or otherwise unserialisable: persist the shape note, not the value.
    json = JSON.stringify({ error: 'unserializable-payload' });
  }
  return { json: json ?? 'null', kinds };
}

/** True when the text still carries something that looks like a live credential. */
export function containsSecret(input: string): boolean {
  return redactText(input).kinds.some((kind) => kind !== 'email' && kind !== 'phone');
}
