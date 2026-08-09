import { describe, expect, it, vi } from 'vitest';
import type {
  CustomerMarketingPageSpeedInput,
  CustomerMarketingPageSpeedReport,
} from '../../shared/customer-marketing-pagespeed';
import {
  formatCustomerMarketingPageSpeedSummary,
  parseCustomerMarketingPageSpeedPayload,
  runCustomerMarketingPageSpeedAudit,
  type CustomerMarketingPageSpeedDependencies,
} from './customer-marketing-pagespeed';

const input: CustomerMarketingPageSpeedInput = {
  url: 'https://izziapi.com/',
  strategy: 'mobile',
};

function psiPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    analysisUTCTimestamp: '2026-08-09T06:00:00.000Z',
    lighthouseResult: {
      requestedUrl: 'https://izziapi.com/',
      finalUrl: 'https://izziapi.com/',
      categories: { performance: { score: 0.72 } },
      audits: {
        'largest-contentful-paint': { displayValue: '2.8 s', score: 0.62 },
        'cumulative-layout-shift': { displayValue: '0.05', score: 0.95 },
        'total-blocking-time': { displayValue: '180 ms', score: 0.91 },
        'first-contentful-paint': { displayValue: '1.2 s', score: 0.94 },
        'speed-index': { displayValue: '3.1 s', score: 0.52 },
        'server-response-time': { displayValue: '220 ms', score: 0.87 },
      },
    },
    loadingExperience: {
      initial_url: 'https://izziapi.com/',
      id: 'https://izziapi.com/',
      overall_category: 'AVERAGE',
      metrics: {
        LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2_400, category: 'FAST' },
        CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5, category: 'FAST' },
        INTERACTION_TO_NEXT_PAINT: { percentile: 240, category: 'FAST' },
        EXPERIMENTAL_TIME_TO_FIRST_BYTE: { percentile: 800, category: 'AVERAGE' },
      },
    },
    ...overrides,
  };
}

function response(payload: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function dependencies(
  overrides: Partial<CustomerMarketingPageSpeedDependencies> = {},
): CustomerMarketingPageSpeedDependencies {
  return {
    resolveHostname: vi.fn(async () => ['93.184.216.34']),
    fetchImpl: vi.fn(async () => response(psiPayload())),
    ...overrides,
  };
}

describe('Customer Marketing PageSpeed URL and DNS boundary', () => {
  it.each([
    'http://localhost',
    'http://127.0.0.1',
    'http://169.254.169.254/latest/meta-data',
    'https://[::1]',
    'file:///etc/passwd',
    'https://user:pass@example.com',
    'https://example.com:8443',
    'https://intranet',
    'https://printer.local',
    'http://localhost.',
    'https://printer.local.',
  ])('rejects %s before DNS or Google egress', async (url) => {
    const deps = dependencies();
    const result = await runCustomerMarketingPageSpeedAudit({ ...input, url }, deps);

    expect(result).toMatchObject({ ok: false, reason: 'url_rejected' });
    expect(deps.resolveHostname).not.toHaveBeenCalled();
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects split-horizon and empty DNS answers before sending the URL to Google', async () => {
    for (const addresses of [
      ['93.184.216.34', '10.0.0.8'],
      ['127.0.0.1'],
      [],
    ]) {
      const deps = dependencies({ resolveHostname: vi.fn(async () => addresses) });
      const result = await runCustomerMarketingPageSpeedAudit(input, deps);

      expect(result).toMatchObject({ ok: false, reason: 'dns_rejected' });
      expect(deps.fetchImpl).not.toHaveBeenCalled();
    }
  });

  it.each([
    '0.0.0.0',
    '100.64.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.168.0.1',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '::ffff:10.0.0.1',
  ])('rejects non-public DNS address %s', async (address) => {
    const deps = dependencies({ resolveHostname: vi.fn(async () => [address]) });

    await expect(runCustomerMarketingPageSpeedAudit(input, deps)).resolves.toMatchObject({
      ok: false,
      reason: 'dns_rejected',
    });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed when DNS lookup throws', async () => {
    const deps = dependencies({
      resolveHostname: vi.fn(async () => { throw new Error('private resolver detail'); }),
    });

    await expect(runCustomerMarketingPageSpeedAudit(input, deps)).resolves.toEqual({
      ok: false,
      reason: 'dns_rejected',
      error: 'Không xác minh được tên miền công khai.',
    });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('times out without Google egress when DNS resolution stalls', async () => {
    const deps = dependencies({
      resolveHostname: vi.fn(() => new Promise<string[]>(() => undefined)),
      timeoutMs: 50,
    });

    await expect(runCustomerMarketingPageSpeedAudit(input, deps)).resolves.toMatchObject({
      ok: false,
      reason: 'timeout',
    });
    expect(deps.fetchImpl).not.toHaveBeenCalled();
  });

  it('allows public IPv4 and IPv6 literals without a redundant DNS lookup', async () => {
    for (const url of ['https://8.8.8.8/', 'https://[2606:4700:4700::1111]/']) {
      const deps = dependencies();
      const result = await runCustomerMarketingPageSpeedAudit({ ...input, url }, deps);

      expect(result.ok).toBe(true);
      expect(deps.resolveHostname).not.toHaveBeenCalled();
      expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    }
  });
});

describe('Customer Marketing PageSpeed fixed egress', () => {
  it('sends only the audited public URL to the fixed Google endpoint', async () => {
    const deps = dependencies({ apiKey: 'test-api-key-not-a-secret' });

    const result = await runCustomerMarketingPageSpeedAudit(input, deps);

    expect(result.ok).toBe(true);
    expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
    const [rawEndpoint, init] = vi.mocked(deps.fetchImpl).mock.calls[0];
    const endpoint = new URL(String(rawEndpoint));
    expect(endpoint.origin).toBe('https://www.googleapis.com');
    expect(endpoint.pathname).toBe('/pagespeedonline/v5/runPagespeed');
    expect(endpoint.searchParams.get('url')).toBe('https://izziapi.com/');
    expect(endpoint.searchParams.get('strategy')).toBe('mobile');
    expect(endpoint.searchParams.get('category')).toBe('performance');
    expect(endpoint.searchParams.get('key')).toBe('test-api-key-not-a-secret');
    expect(init).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(new Headers(init?.headers).has('authorization')).toBe(false);
    expect(new Headers(init?.headers).has('cookie')).toBe(false);
    expect(JSON.stringify(result)).not.toContain('test-api-key-not-a-secret');
  });

  it('does not add a key parameter when none is configured', async () => {
    const deps = dependencies();
    await runCustomerMarketingPageSpeedAudit(input, deps);

    const endpoint = new URL(String(vi.mocked(deps.fetchImpl).mock.calls[0][0]));
    expect(endpoint.searchParams.has('key')).toBe(false);
  });

  it('distinguishes rate limit, unreachable URL, timeout, and generic API errors', async () => {
    const cases = [
      [response({ error: { message: 'quota' } }, 429), 'rate_limited'],
      [response({ error: { message: 'Lighthouse was unable to load the page' } }, 400), 'url_unreachable'],
      [response({ error: { message: 'server detail' } }, 503), 'api_error'],
    ] as const;
    for (const [apiResponse, reason] of cases) {
      const deps = dependencies({ fetchImpl: vi.fn(async () => apiResponse) });
      await expect(runCustomerMarketingPageSpeedAudit(input, deps)).resolves.toMatchObject({
        ok: false,
        reason,
      });
    }

    const aborted = Object.assign(new Error('secret network detail'), { name: 'AbortError' });
    const timeoutDeps = dependencies({ fetchImpl: vi.fn(async () => { throw aborted; }) });
    await expect(runCustomerMarketingPageSpeedAudit(input, timeoutDeps)).resolves.toMatchObject({
      ok: false,
      reason: 'timeout',
    });
  });

  it('classifies a bare 429 response without trusting or reading its body', async () => {
    const deps = dependencies({
      fetchImpl: vi.fn(async () => new Response('upstream detail', { status: 429 })),
    });

    await expect(runCustomerMarketingPageSpeedAudit(input, deps)).resolves.toEqual({
      ok: false,
      reason: 'rate_limited',
      error: 'Google PageSpeed đang giới hạn số lần gọi.',
    });
  });

  it('times out while a successful response body is stalled', async () => {
    const deps = dependencies({
      timeoutMs: 50,
      fetchImpl: vi.fn(async () => new Response(new ReadableStream({
        start() {
          // Intentionally leave the body open to verify the whole-operation timeout.
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })),
    });

    await expect(runCustomerMarketingPageSpeedAudit(input, deps)).resolves.toMatchObject({
      ok: false,
      reason: 'timeout',
    });
  });

  it('treats a successful Lighthouse runtime error as unreachable, not as empty metrics', async () => {
    const payload = {
      lighthouseResult: {
        runtimeError: { code: 'ERRORED_DOCUMENT_REQUEST', message: 'private upstream detail' },
        categories: {},
        audits: {},
      },
    };
    const deps = dependencies({ fetchImpl: vi.fn(async () => response(payload)) });

    await expect(runCustomerMarketingPageSpeedAudit(input, deps)).resolves.toEqual({
      ok: false,
      reason: 'url_unreachable',
      error: 'Google không tải được trang công khai này.',
    });
  });

  it('rejects non-JSON and oversized responses without exposing upstream data', async () => {
    const wrongType = dependencies({
      fetchImpl: vi.fn(async () => new Response('<html>private</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })),
    });
    await expect(runCustomerMarketingPageSpeedAudit(input, wrongType)).resolves.toMatchObject({
      ok: false,
      reason: 'malformed_response',
    });

    const oversized = dependencies({
      fetchImpl: vi.fn(async () => response({}, 200, { 'content-length': '3000001' })),
    });
    await expect(runCustomerMarketingPageSpeedAudit(input, oversized)).resolves.toMatchObject({
      ok: false,
      reason: 'response_too_large',
    });
  });
});

describe('Customer Marketing PageSpeed payload parser', () => {
  it('returns bounded Lighthouse lab data and optional CrUX field data', () => {
    expect(parseCustomerMarketingPageSpeedPayload(
      psiPayload(),
      'https://izziapi.com/',
      'mobile',
    )).toEqual({
      ok: true,
      url: 'https://izziapi.com/',
      lighthouseRequestedUrl: 'https://izziapi.com/',
      finalUrl: 'https://izziapi.com/',
      strategy: 'mobile',
      measuredAt: '2026-08-09T06:00:00.000Z',
      performanceScore: 72,
      lab: {
        lcp: { display: '2.8 s', rating: 'needs-improvement' },
        cls: { display: '0.05', rating: 'good' },
        tbt: { display: '180 ms', rating: 'good' },
        fcp: { display: '1.2 s', rating: 'good' },
        speedIndex: { display: '3.1 s', rating: 'needs-improvement' },
        serverResponse: { display: '220 ms', rating: 'needs-improvement' },
      },
      field: {
        scope: 'url',
        initialUrl: 'https://izziapi.com/',
        id: 'https://izziapi.com/',
        overall: 'needs-improvement',
        lcp: { display: '2.40 s', rating: 'good' },
        cls: { display: '0.05', rating: 'good' },
        inp: { display: '0.24 s', rating: 'good' },
        ttfb: { display: '0.80 s', rating: 'needs-improvement' },
      },
    });
  });

  it('accepts missing CrUX data and rejects an empty or invalid Lighthouse result', () => {
    const noField = psiPayload({ loadingExperience: undefined });
    expect(parseCustomerMarketingPageSpeedPayload(noField, input.url, input.strategy))
      .toMatchObject({ ok: true, field: null });
    expect(parseCustomerMarketingPageSpeedPayload({}, input.url, input.strategy)).toBeNull();
    expect(parseCustomerMarketingPageSpeedPayload({
      lighthouseResult: { categories: {}, audits: {} },
    }, input.url, input.strategy)).toBeNull();
    expect(parseCustomerMarketingPageSpeedPayload(psiPayload({
      analysisUTCTimestamp: undefined,
    }), input.url, input.strategy)).toBeNull();
    expect(parseCustomerMarketingPageSpeedPayload(psiPayload({
      lighthouseResult: {
        categories: { performance: {} },
        audits: {},
      },
    }), input.url, input.strategy)).toBeNull();

    const missingLighthouseProvenance = psiPayload();
    delete (missingLighthouseProvenance.lighthouseResult as Record<string, unknown>).requestedUrl;
    expect(parseCustomerMarketingPageSpeedPayload(
      missingLighthouseProvenance,
      input.url,
      input.strategy,
    )).toBeNull();

    const missingCruxProvenance = psiPayload();
    delete (missingCruxProvenance.loadingExperience as Record<string, unknown>).initial_url;
    expect(parseCustomerMarketingPageSpeedPayload(
      missingCruxProvenance,
      input.url,
      input.strategy,
    )).toMatchObject({ ok: true, field: null });
  });

  it('preserves whether CrUX fell back from the URL to origin-level data', () => {
    const report = parseCustomerMarketingPageSpeedPayload(psiPayload({
      loadingExperience: {
        initial_url: 'https://izziapi.com/',
        id: 'https://izziapi.com/',
        origin_fallback: true,
        overall_category: 'AVERAGE',
        metrics: {
          LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2_400, category: 'FAST' },
        },
      },
    }), input.url, input.strategy);

    expect(report?.field).toMatchObject({
      scope: 'origin',
      initialUrl: 'https://izziapi.com/',
      id: 'https://izziapi.com/',
    });
  });

  it('preserves the requested URL and the final Lighthouse URL after a redirect', () => {
    const payload = psiPayload();
    const lighthouse = payload.lighthouseResult as Record<string, unknown>;
    lighthouse.finalUrl = 'https://www.izziapi.com/pricing';

    expect(parseCustomerMarketingPageSpeedPayload(payload, input.url, input.strategy))
      .toMatchObject({
        url: 'https://izziapi.com/',
        lighthouseRequestedUrl: 'https://izziapi.com/',
        finalUrl: 'https://www.izziapi.com/pricing',
      });
  });

  it('does not manufacture field data when CrUX reports NONE', () => {
    const report = parseCustomerMarketingPageSpeedPayload(psiPayload({
      loadingExperience: {
        initial_url: 'https://izziapi.com/',
        id: 'https://izziapi.com/',
        overall_category: 'NONE',
        metrics: {
          LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2_400, category: 'FAST' },
        },
      },
    }), input.url, input.strategy);

    expect(report?.field).toBeNull();
  });

  it('clamps malformed scores and strips control characters from display values', () => {
    const payload = psiPayload({
      lighthouseResult: {
        requestedUrl: 'https://izziapi.com/',
        finalUrl: 'https://izziapi.com/',
        categories: { performance: { score: 9 } },
        audits: {
          'largest-contentful-paint': {
            displayValue: `  2.4 s\u0000${'x'.repeat(200)}  `,
            score: -1,
          },
        },
      },
    });
    const result = parseCustomerMarketingPageSpeedPayload(payload, input.url, input.strategy);

    expect(result?.performanceScore).toBeNull();
    expect(result?.lab.lcp?.display).not.toContain('\u0000');
    expect(result?.lab.lcp?.display.length).toBeLessThanOrEqual(80);
    expect(result?.lab.lcp?.rating).toBe('unknown');
  });

  it('formats a report without inventing missing real-user metrics', () => {
    const report = parseCustomerMarketingPageSpeedPayload(
      psiPayload({ loadingExperience: undefined }),
      input.url,
      input.strategy,
    ) as CustomerMarketingPageSpeedReport;
    const summary = formatCustomerMarketingPageSpeedSummary(report);

    expect(summary).toContain('Điểm hiệu năng: 72/100');
    expect(summary).toContain('CrUX: chưa có dữ liệu người dùng thật');
    expect(summary).not.toContain('INP');
  });
});
