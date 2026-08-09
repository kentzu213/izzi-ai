import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  parseCustomerMarketingPageSpeedInput,
  type CustomerMarketingPageSpeedFailure,
  type CustomerMarketingPageSpeedFieldMetrics,
  type CustomerMarketingPageSpeedInput,
  type CustomerMarketingPageSpeedLabMetrics,
  type CustomerMarketingPageSpeedMetric,
  type CustomerMarketingPageSpeedRating,
  type CustomerMarketingPageSpeedReport,
  type CustomerMarketingPageSpeedResult,
  type CustomerMarketingPageSpeedStrategy,
} from '../../shared/customer-marketing-pagespeed';

const PAGESPEED_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_RESPONSE_BYTES = 3_000_000;
const DISPLAY_VALUE_LIMIT = 80;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/g;

export interface CustomerMarketingPageSpeedDependencies {
  resolveHostname: (hostname: string) => Promise<string[]>;
  fetchImpl: typeof fetch;
  apiKey?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
}

function failure(
  reason: CustomerMarketingPageSpeedFailure['reason'],
  error: string,
): CustomerMarketingPageSpeedFailure {
  return { ok: false, reason, error };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanDisplayValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(CONTROL_CHARACTER_PATTERN, '').trim().slice(0, DISPLAY_VALUE_LIMIT);
  return cleaned || null;
}

function cleanReportUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) return null;
  const cleaned = value.replace(CONTROL_CHARACTER_PATTERN, '').trim();
  if (cleaned !== value) return null;
  try {
    const parsed = new URL(cleaned);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || parsed.username
      || parsed.password
    ) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizedScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : null;
}

function ratingFromScore(value: unknown): CustomerMarketingPageSpeedRating {
  const score = normalizedScore(value);
  if (score === null) return 'unknown';
  if (score >= 0.9) return 'good';
  if (score >= 0.5) return 'needs-improvement';
  return 'poor';
}

function ratingFromCategory(value: unknown): CustomerMarketingPageSpeedRating {
  if (value === 'FAST') return 'good';
  if (value === 'AVERAGE') return 'needs-improvement';
  if (value === 'SLOW') return 'poor';
  return 'unknown';
}

function parseLabMetric(value: unknown): CustomerMarketingPageSpeedMetric | undefined {
  const metric = asRecord(value);
  if (!metric) return undefined;
  const display = cleanDisplayValue(metric.displayValue);
  if (!display) return undefined;
  return { display, rating: ratingFromScore(metric.score) };
}

function finitePercentile(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function parseFieldMetric(
  value: unknown,
  formatter: (percentile: number) => string,
): CustomerMarketingPageSpeedMetric | undefined {
  const metric = asRecord(value);
  if (!metric) return undefined;
  const percentile = finitePercentile(metric.percentile);
  if (percentile === null) return undefined;
  return {
    display: formatter(percentile),
    rating: ratingFromCategory(metric.category),
  };
}

function parseMeasuredAt(value: unknown): string | null {
  if (typeof value === 'string' && value.length <= 64) {
    const timestamp = new Date(value);
    if (!Number.isNaN(timestamp.getTime())) return timestamp.toISOString();
  }
  return null;
}

export function parseCustomerMarketingPageSpeedPayload(
  payload: unknown,
  url: string,
  strategy: CustomerMarketingPageSpeedStrategy,
): CustomerMarketingPageSpeedReport | null {
  const root = asRecord(payload);
  const lighthouse = asRecord(root?.lighthouseResult);
  const categories = asRecord(lighthouse?.categories);
  const performance = asRecord(categories?.performance);
  const audits = asRecord(lighthouse?.audits);
  if (!root || !lighthouse || !performance || !audits) return null;
  const lighthouseRequestedUrl = cleanReportUrl(lighthouse.requestedUrl);
  const finalUrl = cleanReportUrl(lighthouse.finalUrl);
  if (!lighthouseRequestedUrl || !finalUrl) return null;

  const rawPerformanceScore = normalizedScore(performance.score);
  const lab: CustomerMarketingPageSpeedLabMetrics = {};
  const labMappings = [
    ['lcp', 'largest-contentful-paint'],
    ['cls', 'cumulative-layout-shift'],
    ['tbt', 'total-blocking-time'],
    ['fcp', 'first-contentful-paint'],
    ['speedIndex', 'speed-index'],
    ['serverResponse', 'server-response-time'],
  ] as const;
  labMappings.forEach(([outputKey, auditKey]) => {
    const metric = parseLabMetric(audits[auditKey]);
    if (metric) lab[outputKey] = metric;
  });
  const measuredAt = parseMeasuredAt(root.analysisUTCTimestamp);
  if (!measuredAt || (rawPerformanceScore === null && Object.keys(lab).length === 0)) return null;

  let field: CustomerMarketingPageSpeedFieldMetrics | null = null;
  const loadingExperience = asRecord(root.loadingExperience);
  const fieldMetrics = asRecord(loadingExperience?.metrics);
  if (
    loadingExperience
    && fieldMetrics
    && loadingExperience.overall_category !== 'NONE'
  ) {
    const initialUrl = cleanReportUrl(loadingExperience.initial_url);
    const id = cleanReportUrl(loadingExperience.id);
    const lcp = parseFieldMetric(
      fieldMetrics.LARGEST_CONTENTFUL_PAINT_MS,
      (value) => `${(value / 1_000).toFixed(2)} s`,
    );
    const cls = parseFieldMetric(
      fieldMetrics.CUMULATIVE_LAYOUT_SHIFT_SCORE,
      (value) => (value / 100).toFixed(2),
    );
    const inp = parseFieldMetric(
      fieldMetrics.INTERACTION_TO_NEXT_PAINT,
      (value) => `${(value / 1_000).toFixed(2)} s`,
    );
    const ttfb = parseFieldMetric(
      fieldMetrics.EXPERIMENTAL_TIME_TO_FIRST_BYTE,
      (value) => `${(value / 1_000).toFixed(2)} s`,
    );
    if (initialUrl && id && (lcp || cls || inp || ttfb)) {
      field = {
        scope: loadingExperience.origin_fallback === true ? 'origin' : 'url',
        initialUrl,
        id,
        overall: ratingFromCategory(loadingExperience.overall_category),
        ...(lcp ? { lcp } : {}),
        ...(cls ? { cls } : {}),
        ...(inp ? { inp } : {}),
        ...(ttfb ? { ttfb } : {}),
      };
    }
  }

  return {
    ok: true,
    url,
    lighthouseRequestedUrl,
    finalUrl,
    strategy,
    measuredAt,
    performanceScore: rawPerformanceScore === null ? null : Math.round(rawPerformanceScore * 100),
    lab,
    field,
  };
}

function parseIpv4(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null;
}

function isPublicIpv4(address: string): boolean {
  const octets = parseIpv4(address);
  if (!octets) return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function parseIpv6(address: string): number[] | null {
  const normalized = address.toLowerCase();
  if (!normalized || normalized.includes('%') || normalized.split('::').length > 2) return null;
  let source = normalized;
  if (source.includes('.')) {
    const lastColon = source.lastIndexOf(':');
    const ipv4 = parseIpv4(source.slice(lastColon + 1));
    if (lastColon < 0 || !ipv4) return null;
    source = `${source.slice(0, lastColon)}:${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }
  const [leftRaw, rightRaw = ''] = source.split('::');
  const left = leftRaw ? leftRaw.split(':') : [];
  const right = rightRaw ? rightRaw.split(':') : [];
  const hasCompression = source.includes('::');
  if ((!hasCompression && left.length !== 8) || (hasCompression && left.length + right.length >= 8)) {
    return null;
  }
  const fill = hasCompression ? Array(8 - left.length - right.length).fill('0') : [];
  const groups = [...left, ...fill, ...right];
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return groups.flatMap((part) => {
    const value = Number.parseInt(part, 16);
    return [value >> 8, value & 0xff];
  });
}

function isPublicIpv6(address: string): boolean {
  const bytes = parseIpv6(address);
  if (!bytes) return false;
  const ipv4Mapped = bytes.slice(0, 10).every((value) => value === 0)
    && bytes[10] === 0xff
    && bytes[11] === 0xff;
  if (ipv4Mapped) return isPublicIpv4(bytes.slice(12).join('.'));
  if (bytes.slice(0, 15).every((value) => value === 0)) return false;
  if ((bytes[0] & 0xfe) === 0xfc) return false;
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return false;
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return false;
  if (bytes[0] === 0xff) return false;
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return false;
  return (bytes[0] & 0xe0) === 0x20;
}

function unbracketHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function isPublicIp(address: string): boolean {
  const normalized = unbracketHostname(address.trim());
  const family = isIP(normalized);
  if (family === 4) return isPublicIpv4(normalized);
  if (family === 6) return isPublicIpv6(normalized);
  return false;
}

function parsePublicTarget(rawUrl: string): URL | null {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return null;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return null;
  if (target.username || target.password) return null;
  if (target.port && target.port !== '80' && target.port !== '443') return null;
  const hostname = unbracketHostname(target.hostname).toLowerCase();
  if (!hostname || hostname.length > 253 || hostname.includes('%')) return null;
  if (isIP(hostname)) return isPublicIp(hostname) ? target : null;
  const canonicalHostname = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname;
  if (
    !canonicalHostname.includes('.')
    || canonicalHostname === 'localhost'
    || canonicalHostname.endsWith('.localhost')
    || canonicalHostname.endsWith('.local')
  ) return null;
  return target;
}

async function defaultResolveHostname(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

type BoundedJsonResult =
  | { ok: true; payload: unknown }
  | { ok: false; reason: 'malformed_response' | 'response_too_large' };

function abortError(): Error {
  return Object.assign(new Error('Operation aborted'), { name: 'AbortError' });
}

async function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError();
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => {
      cleanup();
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function readBoundedJson(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<BoundedJsonResult> {
  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const declaredLength = Number(contentLength);
    if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
      return { ok: false, reason: 'response_too_large' };
    }
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json') && !contentType.includes('+json')) {
    return { ok: false, reason: 'malformed_response' };
  }

  try {
    const reader = response.body?.getReader();
    if (!reader) return { ok: false, reason: 'malformed_response' };
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    while (true) {
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: 'response_too_large' };
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    chunks.forEach((chunk) => {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    });
    return { ok: true, payload: JSON.parse(new TextDecoder().decode(bytes)) as unknown };
  } catch {
    return { ok: false, reason: 'malformed_response' };
  }
}

function upstreamErrorMessage(payload: unknown): string {
  const root = asRecord(payload);
  const error = asRecord(root?.error);
  return typeof error?.message === 'string' ? error.message.toLowerCase().slice(0, 500) : '';
}

function hasLighthouseRuntimeError(payload: unknown): boolean {
  const root = asRecord(payload);
  const lighthouse = asRecord(root?.lighthouseResult);
  return asRecord(lighthouse?.runtimeError) !== null;
}

function defaultDependencies(): CustomerMarketingPageSpeedDependencies {
  const apiKey = process.env.PAGESPEED_API_KEY?.trim();
  return {
    resolveHostname: defaultResolveHostname,
    fetchImpl: fetch,
    ...(apiKey ? { apiKey } : {}),
  };
}

export async function runCustomerMarketingPageSpeedAudit(
  input: CustomerMarketingPageSpeedInput,
  dependencies: CustomerMarketingPageSpeedDependencies = defaultDependencies(),
): Promise<CustomerMarketingPageSpeedResult> {
  const parsedInput = parseCustomerMarketingPageSpeedInput(input);
  const target = parsedInput ? parsePublicTarget(parsedInput.url) : null;
  if (!parsedInput || !target) {
    return failure('url_rejected', 'Chỉ hỗ trợ URL HTTP(S) công khai trên cổng 80/443.');
  }

  const controller = new AbortController();
  const timeoutMs = Math.min(Math.max(dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS, 50), 120_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const hostname = unbracketHostname(target.hostname);
  if (!isIP(hostname)) {
    let addresses: string[];
    try {
      addresses = await abortable(dependencies.resolveHostname(hostname), controller.signal);
    } catch {
      clearTimeout(timeout);
      if (controller.signal.aborted) {
        return failure('timeout', 'Google PageSpeed phản hồi quá thời gian cho phép.');
      }
      return failure('dns_rejected', 'Không xác minh được tên miền công khai.');
    }
    if (addresses.length === 0 || addresses.some((address) => !isPublicIp(address))) {
      clearTimeout(timeout);
      return failure('dns_rejected', 'Tên miền không trỏ hoàn toàn tới địa chỉ IP công khai.');
    }
  }

  const endpoint = new URL(PAGESPEED_ENDPOINT);
  endpoint.searchParams.set('url', target.toString());
  endpoint.searchParams.set('strategy', parsedInput.strategy);
  endpoint.searchParams.set('category', 'performance');
  const apiKey = dependencies.apiKey?.trim();
  if (apiKey) endpoint.searchParams.set('key', apiKey.slice(0, 1_024));

  let response: Response;
  try {
    response = await dependencies.fetchImpl(endpoint, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: {
        accept: 'application/json',
        'cache-control': 'no-store',
      },
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timeout);
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      return failure('timeout', 'Google PageSpeed phản hồi quá thời gian cho phép.');
    }
    return failure('api_error', 'Không thể hoàn tất phép đo PageSpeed lúc này.');
  }

  if (response.status === 429) {
    clearTimeout(timeout);
    return failure('rate_limited', 'Google PageSpeed đang giới hạn số lần gọi.');
  }

  const maximumBytes = Math.min(
    Math.max(dependencies.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES, 1_024),
    DEFAULT_MAX_RESPONSE_BYTES,
  );
  const decoded = await readBoundedJson(response, maximumBytes, controller.signal);
  clearTimeout(timeout);
  if (controller.signal.aborted) {
    return failure('timeout', 'Google PageSpeed phản hồi quá thời gian cho phép.');
  }
  if (!decoded.ok) {
    return decoded.reason === 'response_too_large'
      ? failure('response_too_large', 'Phản hồi PageSpeed vượt quá giới hạn an toàn.')
      : failure('malformed_response', 'Google PageSpeed trả về dữ liệu không hợp lệ.');
  }

  if (!response.ok) {
    const message = upstreamErrorMessage(decoded.payload);
    if (
      response.status === 400
      && (message.includes('unable to load') || message.includes('lighthouse') || message.includes('fetch'))
    ) {
      return failure('url_unreachable', 'Google không tải được trang công khai này.');
    }
    return failure('api_error', 'Không thể hoàn tất phép đo PageSpeed lúc này.');
  }
  if (hasLighthouseRuntimeError(decoded.payload)) {
    return failure('url_unreachable', 'Google không tải được trang công khai này.');
  }

  const report = parseCustomerMarketingPageSpeedPayload(
    decoded.payload,
    target.toString(),
    parsedInput.strategy,
  );
  return report ?? failure('malformed_response', 'Google PageSpeed trả về dữ liệu không hợp lệ.');
}

export function formatCustomerMarketingPageSpeedSummary(
  report: CustomerMarketingPageSpeedReport,
): string {
  const labLabels: Array<[string, CustomerMarketingPageSpeedMetric | undefined]> = [
    ['LCP', report.lab.lcp],
    ['CLS', report.lab.cls],
    ['TBT', report.lab.tbt],
    ['FCP', report.lab.fcp],
    ['Speed Index', report.lab.speedIndex],
    ['Server response', report.lab.serverResponse],
  ];
  const lab = labLabels
    .filter((entry): entry is [string, CustomerMarketingPageSpeedMetric] => Boolean(entry[1]))
    .map(([label, metric]) => `${label}: ${metric.display} (${metric.rating})`)
    .join('; ');
  const field = report.field
    ? [
      ['LCP', report.field.lcp],
      ['CLS', report.field.cls],
      ['INP', report.field.inp],
      ['TTFB', report.field.ttfb],
    ]
      .filter((entry): entry is [string, CustomerMarketingPageSpeedMetric] => Boolean(entry[1]))
      .map(([label, metric]) => `${label}: ${metric.display} (${metric.rating})`)
      .join('; ')
    : '';
  return [
    `PageSpeed ${report.strategy}: ${report.url}`,
    `URL Lighthouse nhận: ${report.lighthouseRequestedUrl}`,
    `URL đã đo: ${report.finalUrl}`,
    `Điểm hiệu năng: ${report.performanceScore === null ? 'chưa có' : `${report.performanceScore}/100`}`,
    `Lab: ${lab || 'chưa có dữ liệu'}`,
    report.field
      ? `CrUX ${report.field.scope} ${report.field.initialUrl} -> ${report.field.id} (${report.field.overall}): ${field || 'chưa có metric chi tiết'}`
      : 'CrUX: chưa có dữ liệu người dùng thật',
  ].join('\n');
}
