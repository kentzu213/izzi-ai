import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  REDACTION,
  describeFindings,
  evaluateSecretPolicy,
  isOpaqueSecretReference,
  redactSecrets,
  scanForSecrets,
} from './live-secrets';

/**
 * Synthetic, structurally-valid-looking credentials. None of these is a real
 * credential — they exist only to exercise the detectors.
 */
const FAKES = {
  'private-key-block': '-----BEGIN RSA PRIVATE KEY-----',
  'anthropic-key': 'sk-ant-0000000000000000abcd',
  'openai-key': 'sk-000000000000000000000000abcd',
  'izzi-key': 'izzi-0000000000000000abcd',
  'aws-access-key-id': 'AKIA0000000000000000',
  'google-api-key': 'AIza00000000000000000000000000000000abc',
  'github-token': 'ghp_000000000000000000000000000000000000',
  'slack-token': 'xoxb-0000000000-abcdefghij',
  jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdef',
  'bearer-token': 'Bearer abcdefghij0123456789ABCDEF',
  'oauth-refresh-token': '1//0abcdefghij0123456789xyz',
} as const;

describe('live-secrets — no-secret validator (SECURITY GATE A/D)', () => {
  it('blocks every known credential shape', () => {
    for (const [kind, sample] of Object.entries(FAKES)) {
      const findings = scanForSecrets(`- token: ${sample}`);
      expect(findings.some((f) => f.kind === kind), `${kind} not detected`).toBe(true);
      expect(evaluateSecretPolicy(findings)).toBe('block');
    }
  });

  it('blocks a credential assignment with a literal value', () => {
    const findings = scanForSecrets('- password: hunter2hunter2');
    expect(findings.map((f) => f.kind)).toContain('credential-assignment');
    expect(evaluateSecretPolicy(findings)).toBe('block');
  });

  it('allows opaque references — the only permitted representation', () => {
    const md = [
      '## Tools and integrations',
      '',
      '- Gmail: `secretRef:gmail-oauth` — đã kết nối',
      '- OpenAI: api_key = env:OPENAI_API_KEY',
      '- Vault entry: vault:izzi/prod',
      '- Keychain: keychain:starizzi-signing',
    ].join('\n');
    expect(scanForSecrets(md)).toEqual([]);
    expect(evaluateSecretPolicy(scanForSecrets(md))).toBe('clean');
  });

  it('recognizes the allowed reference forms and rejects raw values', () => {
    expect(isOpaqueSecretReference('env:OPENAI_API_KEY')).toBe(true);
    expect(isOpaqueSecretReference('secretRef:gmail-oauth')).toBe(true);
    expect(isOpaqueSecretReference(' vault:izzi/prod ')).toBe(true);
    expect(isOpaqueSecretReference('sk-0000000000000000000000')).toBe(false);
    expect(isOpaqueSecretReference(42)).toBe(false);
  });

  it('reports the correct 1-based line number', () => {
    const findings = scanForSecrets(`line one\nline two\n- key: ${FAKES['openai-key']}`);
    expect(findings[0].line).toBe(3);
  });

  it('warns (not blocks) on a high-entropy blob', () => {
    const blob = 'Zm9vYmFyMTIzNDU2Nzg5MHF3ZXJ0eXVpb3Bhc2RmZ2hqa2w';
    const findings = scanForSecrets(`- checksum ${blob}`);
    expect(findings.map((f) => f.severity)).toEqual(['warn']);
    expect(evaluateSecretPolicy(findings)).toBe('warn');
  });

  it('leaves ordinary prose and starter templates clean', () => {
    expect(scanForSecrets('- Trả lời ngắn gọn, không dùng emoji, ưu tiên tiếng Việt.')).toEqual([]);
    expect(scanForSecrets('# Live.md\n\n## Sở thích\n- Ghi ngắn gọn, có dẫn chứng.\n')).toEqual([]);
  });

  it('treats an empty document as clean', () => {
    expect(evaluateSecretPolicy(scanForSecrets(''))).toBe('clean');
  });
});

describe('live-secrets — findings never leak the value (Property)', () => {
  it('Property 1: no finding field ever contains the matched secret', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...Object.values(FAKES)),
        fc.string({ maxLength: 20 }).filter((s) => !s.includes('`')),
        (secret, noise) => {
          for (const finding of scanForSecrets(`- ${noise} ${secret}`)) {
            const serialized = JSON.stringify(finding);
            expect(serialized).not.toContain(secret);
            expect(finding.preview).not.toContain(secret);
          }
        },
      ),
      { numRuns: 150 },
    );
  });

  it('replaces the value with the placeholder in the preview', () => {
    const finding = scanForSecrets(`- my key is ${FAKES['izzi-key']} ok`).find(
      (f) => f.kind === 'izzi-key',
    );
    expect(finding?.preview).toBe(`- my key is ${REDACTION} ok`);
    expect(finding?.length).toBe(FAKES['izzi-key'].length);
  });

  it('describeFindings emits kinds and lines only', () => {
    const findings = scanForSecrets(`- k: ${FAKES['openai-key']}`);
    const summary = describeFindings(findings);
    expect(summary).toContain('@L1');
    expect(summary).not.toContain(FAKES['openai-key']);
    expect(describeFindings([])).toBe('no secret findings');
  });
});

describe('live-secrets — redaction for export (Req 10)', () => {
  it('Property 2: a redacted export never contains the secret', () => {
    fc.assert(
      fc.property(fc.constantFrom(...Object.values(FAKES)), (secret) => {
        const { text } = redactSecrets(`## Tools and integrations\n\n- token: ${secret}\n`);
        expect(text).not.toContain(secret);
        expect(text).toContain(REDACTION);
      }),
      { numRuns: 150 },
    );
  });

  it('Property 3: redacting twice is stable (idempotent)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...Object.values(FAKES)), (secret) => {
        const once = redactSecrets(`- token: ${secret}\n`).text;
        expect(redactSecrets(once).text).toBe(once);
      }),
      { numRuns: 100 },
    );
  });

  it('keeps the surrounding label so the user sees what was removed', () => {
    const { text } = redactSecrets('- password: hunter2hunter2\n');
    expect(text).toBe(`- password: ${REDACTION}\n`);
  });

  it('leaves clean text byte-identical apart from EOL normalization', () => {
    const clean = '## Communication\r\n\r\n- ngắn gọn\r\n';
    expect(redactSecrets(clean).text).toBe('## Communication\n\n- ngắn gọn\n');
    expect(redactSecrets(clean).findings).toEqual([]);
  });
});
