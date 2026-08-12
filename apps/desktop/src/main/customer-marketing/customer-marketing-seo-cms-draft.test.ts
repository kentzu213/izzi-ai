import { describe, expect, it } from 'vitest';
import {
  buildCustomerMarketingSeoCmsDraft,
  parseCustomerMarketingSeoCmsDraftInput,
  renderCustomerMarketingSeoLocalPreview,
} from './customer-marketing-seo-cms-draft';

const SOURCE_DIGEST = 'a'.repeat(64);
const baseInput = {
  slug: 'marketing-automation-ai-2-trieu-thang',
  title: 'Marketing automation AI voi ngan sach 2 trieu moi thang',
  canonicalUrl: 'https://izziapi.com/blog/marketing-automation-ai-2-trieu-thang',
  metaDescription: 'Cach xay dung he thong marketing tu dong co kiem soat voi ngan sach nho.',
  body: '# Bat dau\n\nNoi dung huong dan thuc te.',
  sourceDigest: SOURCE_DIGEST,
  expectedRevision: 3,
  review: {
    reviewer: 'Nguyen Nghia',
    requestedAt: '2026-08-12T14:00:00.000Z',
    status: 'pending' as const,
  },
};

describe('Customer Marketing SEO/CMS draft pipeline', () => {
  it('parses an exact bounded draft input and supports an explicitly configured canonical host', () => {
    expect(parseCustomerMarketingSeoCmsDraftInput(baseInput)).toEqual(baseInput);
    expect(parseCustomerMarketingSeoCmsDraftInput({
      ...baseInput,
      canonicalUrl: `https://preview.izziapi.com/blog/${baseInput.slug}`,
    }, { allowedCanonicalHosts: ['preview.izziapi.com'] })).not.toBeNull();
  });

  it('rejects unsafe canonical URLs, invalid bounds and non-canonical source metadata', () => {
    const rejected = [
      { ...baseInput, canonicalUrl: `http://izziapi.com/blog/${baseInput.slug}` },
      { ...baseInput, canonicalUrl: `https://evil.example/blog/${baseInput.slug}` },
      { ...baseInput, canonicalUrl: `https://izziapi.com/blog/not-${baseInput.slug}` },
      { ...baseInput, canonicalUrl: `${baseInput.canonicalUrl}?publish=true` },
      { ...baseInput, slug: '../escape' },
      { ...baseInput, title: 'x'.repeat(121) },
      { ...baseInput, metaDescription: 'x'.repeat(321) },
      { ...baseInput, body: 'x'.repeat(200_001) },
      { ...baseInput, sourceDigest: SOURCE_DIGEST.toUpperCase() },
      { ...baseInput, expectedRevision: -1 },
      { ...baseInput, review: { ...baseInput.review, requestedAt: 'not-a-date' } },
    ];

    rejected.forEach((value) => {
      expect(parseCustomerMarketingSeoCmsDraftInput(value)).toBeNull();
    });
  });

  it('rejects unknown fields, raw secret fields, paths and workspace identifiers', () => {
    expect(parseCustomerMarketingSeoCmsDraftInput({ ...baseInput, secret: 'forbidden' })).toBeNull();
    expect(parseCustomerMarketingSeoCmsDraftInput({ ...baseInput, path: 'C:\\customer-data' })).toBeNull();
    expect(parseCustomerMarketingSeoCmsDraftInput({
      ...baseInput,
      workspaceId: '11111111-1111-4111-8111-111111111111',
    })).toBeNull();
    expect(parseCustomerMarketingSeoCmsDraftInput({
      ...baseInput,
      review: { ...baseInput.review, approvalId: 'forbidden' },
    })).toBeNull();
  });

  it('builds a deterministic draft-only package with a human approval gate', () => {
    const first = buildCustomerMarketingSeoCmsDraft(baseInput);
    const second = buildCustomerMarketingSeoCmsDraft({ ...baseInput });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      slug: baseInput.slug,
      cmsStatus: 'draft',
      publishStatus: 'not_published',
      publishGate: 'human_review_required',
      noindex: true,
      approvedForPublish: false,
      externalActionPerformed: false,
      expectedRevision: 3,
      review: baseInput.review,
    });
    expect(first.packageDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain('workspaceId');
    expect(JSON.stringify(first)).not.toContain('secret');
  });

  it('renders an escaped local preview with canonical and noindex metadata', () => {
    const input = {
      ...baseInput,
      title: '<script>alert(1)</script>',
      metaDescription: 'Safe & local "preview"',
      body: '<img src=x onerror=alert(1)>\n\nSecond paragraph',
    };
    const draft = buildCustomerMarketingSeoCmsDraft(input);
    const preview = renderCustomerMarketingSeoLocalPreview(draft);

    expect(preview.kind).toBe('local_html_preview');
    expect(preview.externalActionPerformed).toBe(false);
    expect(preview.html).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(preview.html).toContain(`<link rel="canonical" href="${baseInput.canonicalUrl}">`);
    expect(preview.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(preview.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(preview.html).not.toContain('<script>alert(1)</script>');
    expect(preview.html).not.toContain('<img src=x onerror=alert(1)>');
    expect(preview.previewDigest).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed instead of creating a package from untrusted input', () => {
    expect(() => buildCustomerMarketingSeoCmsDraft({
      ...baseInput,
      canonicalUrl: 'https://example.com/blog/marketing-automation-ai-2-trieu-thang',
    })).toThrow('Invalid SEO/CMS draft input.');
  });
});
