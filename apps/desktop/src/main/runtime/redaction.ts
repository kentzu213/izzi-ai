import { redactText } from '../work/work-redaction';

const HEADER_SECRET =
  /\b(authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]+/gi;
const NAMED_SECRET =
  /(["']?\b(?:pass(?:word|code|phrase)?|secret|token|api[_ -]?key|client[_ -]?secret|refresh[_ -]?token|access[_ -]?token)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi;

export function redactRuntimeText(text: string, resolvedSecrets: readonly string[] = []): string {
  let value = String(text);
  for (const secret of resolvedSecrets) {
    if (secret) value = value.split(secret).join('[redacted]');
  }
  value = redactText(value).value;
  value = value.replace(HEADER_SECRET, (header) => {
    const name = header.slice(0, header.indexOf(':'));
    return `${name}: [redacted]`;
  });
  return value.replace(NAMED_SECRET, '$1[redacted]');
}
