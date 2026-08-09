export type CustomerMarketingPageSpeedStrategy = 'mobile' | 'desktop';

export type CustomerMarketingPageSpeedRating =
  | 'good'
  | 'needs-improvement'
  | 'poor'
  | 'unknown';

export interface CustomerMarketingPageSpeedInput {
  url: string;
  strategy: CustomerMarketingPageSpeedStrategy;
}

export interface CustomerMarketingPageSpeedMetric {
  display: string;
  rating: CustomerMarketingPageSpeedRating;
}

export interface CustomerMarketingPageSpeedLabMetrics {
  lcp?: CustomerMarketingPageSpeedMetric;
  cls?: CustomerMarketingPageSpeedMetric;
  tbt?: CustomerMarketingPageSpeedMetric;
  fcp?: CustomerMarketingPageSpeedMetric;
  speedIndex?: CustomerMarketingPageSpeedMetric;
  serverResponse?: CustomerMarketingPageSpeedMetric;
}

export interface CustomerMarketingPageSpeedFieldMetrics {
  scope: 'url' | 'origin';
  initialUrl: string;
  id: string;
  overall: CustomerMarketingPageSpeedRating;
  lcp?: CustomerMarketingPageSpeedMetric;
  cls?: CustomerMarketingPageSpeedMetric;
  inp?: CustomerMarketingPageSpeedMetric;
  ttfb?: CustomerMarketingPageSpeedMetric;
}

export interface CustomerMarketingPageSpeedReport {
  ok: true;
  url: string;
  lighthouseRequestedUrl: string;
  finalUrl: string;
  strategy: CustomerMarketingPageSpeedStrategy;
  measuredAt: string;
  performanceScore: number | null;
  lab: CustomerMarketingPageSpeedLabMetrics;
  field: CustomerMarketingPageSpeedFieldMetrics | null;
}

export type CustomerMarketingPageSpeedFailureReason =
  | 'url_rejected'
  | 'dns_rejected'
  | 'rate_limited'
  | 'url_unreachable'
  | 'timeout'
  | 'api_error'
  | 'malformed_response'
  | 'response_too_large'
  | 'forbidden'
  | 'unavailable';

export interface CustomerMarketingPageSpeedFailure {
  ok: false;
  reason: CustomerMarketingPageSpeedFailureReason;
  error: string;
}

export type CustomerMarketingPageSpeedResult =
  | CustomerMarketingPageSpeedReport
  | CustomerMarketingPageSpeedFailure;

const INPUT_KEYS = new Set(['url', 'strategy']);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

export function parseCustomerMarketingPageSpeedInput(
  value: unknown,
): CustomerMarketingPageSpeedInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length !== INPUT_KEYS.size || !keys.every((key) => INPUT_KEYS.has(key))) return null;
  if (typeof input.url !== 'string') return null;
  if (input.strategy !== 'mobile' && input.strategy !== 'desktop') return null;

  const url = input.url.trim();
  if (
    url.length === 0
    || url.length > 2_048
    || input.url.length > 4_096
    || CONTROL_CHARACTER_PATTERN.test(url)
  ) return null;

  return { url, strategy: input.strategy };
}
