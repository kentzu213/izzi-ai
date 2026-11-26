/**
 * Live.md no-secret validator — the SECURITY GATE for the personal context kernel.
 *
 * Live.md is personal data that is stored in the shared graph, shown in the UI,
 * and exported to a file. Credential material must never enter it. A secret is
 * only ever representable as an OPAQUE REFERENCE (`env:NAME`, `secretRef:name`,
 * `keychain:name`, `vault:name`) plus a connection status.
 *
 * Guarantees this module makes (security-baseline A/D):
 *  - A finding NEVER carries the matched value. It carries a kind, a line number,
 *    a character count, and a preview of the line with the value already replaced
 *    by `«redacted»`. Nothing here can leak a credential into a log or a UI.
 *  - `block` findings are high-confidence key material; the service refuses the
 *    write. `warn` findings are suspicious shapes; the UI asks the user.
 *  - `redactSecrets` is applied to every export, so an export can never contain a
 *    credential even if one was somehow stored.
 *
 * @module shared/live-secrets
 */

/** `block` refuses the write; `warn` asks the user to confirm. */
export type SecretSeverity = 'block' | 'warn';

/** A detection. Deliberately contains NO raw secret characters. */
export interface SecretFinding {
  /** Stable machine name of the detector, e.g. `openai-key`. */
  kind: string;
  severity: SecretSeverity;
  /** 1-based line number in the scanned text. */
  line: number;
  /** Length of the matched value, for a "yes that's my key" sanity check. */
  length: number;
  /** The source line with every match replaced by `«redacted»`, capped at 160 chars. */
  preview: string;
  /** Localized guidance shown in the UI. */
  hint: string;
}

/** The placeholder written in place of a detected secret. */
export const REDACTION = '«redacted»';

/** Overall verdict for a document. */
export type SecretVerdict = 'clean' | 'warn' | 'block';

interface Detector {
  kind: string;
  severity: SecretSeverity;
  pattern: RegExp;
  hint: string;
  /** Optional extra test on the matched value; return false to discard the match. */
  accept?: (value: string) => boolean;
}

/** Opaque, non-secret reference forms that are explicitly allowed in Live.md. */
const OPAQUE_REFERENCE_RE = /^(env|secretref|keychain|vault|ref):[A-Za-z0-9._/-]+$/i;

/** True when `value` is an allowed opaque reference rather than a real credential. */
export function isOpaqueSecretReference(value: unknown): boolean {
  return typeof value === 'string' && OPAQUE_REFERENCE_RE.test(value.trim());
}

/** Shannon-ish cheap entropy proxy: how many distinct characters the token uses. */
function distinctChars(value: string): number {
  return new Set(value).size;
}

const KEY_HINT = 'Xoá key thật khỏi Live.md. Chỉ ghi tham chiếu, ví dụ `env:OPENAI_API_KEY`.';
const TOKEN_HINT = 'Xoá token khỏi Live.md. Chỉ ghi tham chiếu `secretRef:<tên>` + trạng thái kết nối.';

/**
 * Detectors, most specific first. Every pattern is anchored on a shape that does
 * not occur in ordinary prose, so false positives stay rare.
 */
const DETECTORS: readonly Detector[] = [
  {
    kind: 'private-key-block',
    severity: 'block',
    pattern: /-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----/g,
    hint: 'Private key không bao giờ được đặt trong Live.md.',
  },
  {
    kind: 'anthropic-key',
    severity: 'block',
    pattern: /sk-ant-[A-Za-z0-9_-]{16,}/g,
    hint: KEY_HINT,
  },
  {
    kind: 'openai-key',
    severity: 'block',
    pattern: /sk-(?:proj-|live-)?[A-Za-z0-9_-]{20,}/g,
    hint: KEY_HINT,
  },
  {
    kind: 'izzi-key',
    severity: 'block',
    pattern: /izzi-[A-Za-z0-9_-]{16,}/g,
    hint: KEY_HINT,
  },
  {
    kind: 'aws-access-key-id',
    severity: 'block',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    hint: KEY_HINT,
  },
  {
    kind: 'google-api-key',
    severity: 'block',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    hint: KEY_HINT,
  },
  {
    kind: 'github-token',
    severity: 'block',
    pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
    hint: TOKEN_HINT,
  },
  {
    kind: 'slack-token',
    severity: 'block',
    pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
    hint: TOKEN_HINT,
  },
  {
    kind: 'jwt',
    severity: 'block',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{5,}/g,
    hint: TOKEN_HINT,
  },
  {
    kind: 'bearer-token',
    severity: 'block',
    pattern: /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{20,}=*/g,
    hint: TOKEN_HINT,
  },
  {
    kind: 'oauth-refresh-token',
    severity: 'block',
    pattern: /\b1\/\/[A-Za-z0-9_-]{20,}/g,
    hint: TOKEN_HINT,
  },
  {
    kind: 'credential-assignment',
    severity: 'block',
    // `password: hunter2`, `api_key = abc…`, `client-secret="…"`.
    pattern:
      /\b(?:password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key)\b\s*[:=]\s*["']?([^\s"']{8,})["']?/gi,
    hint: KEY_HINT,
    // The captured value is what we judge — an opaque reference is fine.
    accept: (value) => !isOpaqueSecretReference(value),
  },
  {
    kind: 'high-entropy-blob',
    severity: 'warn',
    pattern: /\b[A-Za-z0-9+/_-]{40,}={0,2}\b/g,
    hint: 'Chuỗi trông giống key/token. Nếu đúng, hãy thay bằng tham chiếu.',
    accept: (value) => distinctChars(value) >= 16 && /[0-9]/.test(value) && /[A-Za-z]/.test(value),
  },
];

/** Build the masked preview for a line: every match replaced by the placeholder. */
function previewLine(line: string, matches: readonly string[]): string {
  let out = line;
  for (const match of matches) {
    if (match.length === 0) continue;
    out = out.split(match).join(REDACTION);
  }
  return out.length > 160 ? `${out.slice(0, 157)}…` : out;
}

/**
 * The value a detector judges: the capture group when it has one (so
 * `password: X` reports `X`, not the whole assignment), else the whole match.
 */
function judgedValue(match: RegExpExecArray): string {
  return typeof match[1] === 'string' ? match[1] : match[0];
}

/**
 * Scan text for credential material. Line-oriented so findings carry a useful
 * line number; a multi-line PEM block is reported on its BEGIN line.
 *
 * Never throws. Returns findings sorted by line then kind.
 */
export function scanForSecrets(text: string): SecretFinding[] {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  const findings: SecretFinding[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length === 0) continue;

    for (const detector of DETECTORS) {
      const re = new RegExp(detector.pattern.source, detector.pattern.flags);
      const values: string[] = [];
      let match: RegExpExecArray | null;
      while ((match = re.exec(line)) !== null) {
        if (match[0].length === 0) {
          re.lastIndex += 1; // guard against a zero-length match looping forever
          continue;
        }
        const value = judgedValue(match);
        if (detector.accept !== undefined && !detector.accept(value)) continue;
        values.push(value);
      }
      if (values.length === 0) continue;

      const longest = values.reduce((a, b) => (b.length > a.length ? b : a));
      findings.push({
        kind: detector.kind,
        severity: detector.severity,
        line: i + 1,
        length: longest.length,
        preview: previewLine(line, values),
        hint: detector.hint,
      });
    }
  }

  return findings.sort((a, b) => a.line - b.line || a.kind.localeCompare(b.kind));
}

/** Worst severity across findings. */
export function evaluateSecretPolicy(findings: readonly SecretFinding[]): SecretVerdict {
  if (!Array.isArray(findings) || findings.length === 0) return 'clean';
  return findings.some((f) => f.severity === 'block') ? 'block' : 'warn';
}

/**
 * Replace every detected secret with `«redacted»`. Applied to all exports so an
 * export can never carry credential material (Req 10). Warn-level matches are
 * redacted too — an export is a file that leaves the machine.
 */
export function redactSecrets(text: string): { text: string; findings: SecretFinding[] } {
  const src = String(text ?? '').replace(/\r\n?/g, '\n');
  const findings = scanForSecrets(src);
  if (findings.length === 0) return { text: src, findings };

  let out = src;
  for (const detector of DETECTORS) {
    const re = new RegExp(detector.pattern.source, detector.pattern.flags);
    out = out.replace(re, (whole: string, ...rest: unknown[]) => {
      const captured = typeof rest[0] === 'string' ? (rest[0] as string) : undefined;
      const value = captured ?? whole;
      if (detector.accept !== undefined && !detector.accept(value)) return whole;
      // Keep the label (`password:`) so the user can see WHAT was removed.
      return captured === undefined ? REDACTION : whole.split(captured).join(REDACTION);
    });
  }
  return { text: out, findings };
}

/** One-line summary safe for diagnostics: kinds + line numbers, never values. */
export function describeFindings(findings: readonly SecretFinding[]): string {
  if (!Array.isArray(findings) || findings.length === 0) return 'no secret findings';
  return findings.map((f) => `${f.kind}@L${f.line}(${f.severity})`).join(', ');
}
