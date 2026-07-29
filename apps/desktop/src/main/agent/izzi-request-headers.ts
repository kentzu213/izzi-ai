import { hasAsciiControlCharacter } from '../../shared/model-gateway';

const IZZI_API_HOSTS = new Set(['api.izziapi.com', 'izziapi.com']);

export function isOfficialIzziApiUrl(value: string): boolean {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || hasAsciiControlCharacter(value)
    || value.includes('\\')
  ) {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:'
      && url.port === ''
      && url.username === ''
      && url.password === ''
      && url.search === ''
      && url.hash === ''
      && IZZI_API_HOSTS.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export function buildIzziSourceHeaders(value: string): Record<string, string> {
  return isOfficialIzziApiUrl(value) ? { 'X-Source-Platform': 'starizzi' } : {};
}

export function buildIzziRequestHeaders(
  value: string,
  idempotencyKey?: string,
): Record<string, string> {
  if (!isOfficialIzziApiUrl(value)) return {};
  return {
    'X-Source-Platform': 'starizzi',
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };
}

export function modelSupportsTools(model: string): boolean {
  return model.trim().replace(/^izzi\//, '') !== 'gpt-5.6-sol';
}
