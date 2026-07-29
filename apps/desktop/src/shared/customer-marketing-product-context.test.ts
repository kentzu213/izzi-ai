import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  canonicalCustomerProductMarketingContext,
  canonicalCustomerProductMarketingSource,
  parseCustomerProductMarketingContext,
  parseCustomerProductMarketingContextSaveInput,
  type CustomerProductMarketingContextSaveInput,
  type CustomerProductMarketingContextV1,
} from './customer-marketing-product-context';

function draft(): CustomerProductMarketingContextSaveInput {
  return {
    expectedRevision: 0,
    product: {
      productName: 'IzziAPI',
      category: {
        vi: 'Nền tảng API và AI automation',
        en: 'API and AI automation platform',
      },
      positioning: {
        vi: 'Một API thống nhất để đội ngũ nhỏ triển khai workflow AI.',
        en: 'One unified API for small teams to ship AI workflows.',
      },
      targetAudience: {
        vi: 'Nhà phát triển, startup và đội vận hành.',
        en: 'Developers, startups, and operations teams.',
      },
      valueProposition: {
        vi: 'Giảm thời gian tích hợp và giữ quyền kiểm soát vận hành.',
        en: 'Reduce integration time while retaining operational control.',
      },
      brandVoice: {
        vi: 'Rõ ràng, thực tế và dựa trên bằng chứng.',
        en: 'Clear, practical, and evidence-led.',
      },
      callToAction: {
        vi: 'Dùng thử workflow phù hợp với nhu cầu của bạn.',
        en: 'Try a workflow that fits your use case.',
      },
      proofClaims: [
        {
          id: 'proof-api-catalog',
          text: {
            vi: 'IzziAPI cung cấp catalog API cho nhiều workflow AI.',
            en: 'IzziAPI provides an API catalog for multiple AI workflows.',
          },
          sourceIds: ['source-site', 'source-repo'],
        },
      ],
      prohibitedClaims: [
        {
          id: 'no-guaranteed-results',
          text: {
            vi: 'Cam kết kết quả marketing hoặc doanh thu.',
            en: 'Guaranteed marketing or revenue outcomes.',
          },
          reason: {
            vi: 'Hiệu quả phụ thuộc dữ liệu, kênh, ngân sách và cách triển khai.',
            en: 'Outcomes depend on data, channels, budget, and execution.',
          },
        },
      ],
    },
    sources: [
      {
        id: 'source-site',
        title: 'IzziAPI product site',
        url: 'https://izziapi.com/',
        excerpt: 'Product and API capability overview used as marketing evidence.',
      },
      {
        id: 'source-repo',
        title: 'Izzi AI repository',
        url: 'https://github.com/kentzu213/izzi-ai',
        excerpt: 'Desktop Marketing Room implementation and release evidence.',
      },
    ],
  };
}

function persisted(
  input = draft(),
  overrides: Partial<CustomerProductMarketingContextV1> = {},
): CustomerProductMarketingContextV1 {
  const parsed = parseCustomerProductMarketingContextSaveInput(input);
  if (!parsed) throw new Error('Expected a valid context draft.');
  const sources = parsed.sources.map((source) => ({
    ...source,
    sha256: createHash('sha256')
      .update(canonicalCustomerProductMarketingSource(source), 'utf8')
      .digest('hex'),
  }));
  const unsigned = {
    schemaVersion: 1 as const,
    contextId: 'product-marketing-context' as const,
    revision: 1,
    locales: ['vi', 'en'] as const,
    product: parsed.product,
    sources,
    reviewer: {
      name: 'Nguyễn Nghĩa',
      reviewedAt: '2026-07-29T13:00:00.000Z',
    },
  };
  return {
    ...unsigned,
    sha256: createHash('sha256')
      .update(canonicalCustomerProductMarketingContext(unsigned), 'utf8')
      .digest('hex'),
    ...overrides,
  };
}

describe('Customer Product Marketing Context contract', () => {
  it('normalizes Vietnamese Unicode and set-like collections before hashing', () => {
    const first = draft();
    first.product.positioning.vi = 'Ne\u0302̀n tảng API cho đội ngũ nhỏ';
    first.product.proofClaims[0].sourceIds = ['source-site', 'source-repo'];
    first.sources.reverse();

    const second = draft();
    second.product.positioning.vi = 'Nền tảng API cho đội ngũ nhỏ';
    second.product.proofClaims[0].sourceIds = ['source-repo', 'source-site'];

    const parsedFirst = parseCustomerProductMarketingContextSaveInput(first);
    const parsedSecond = parseCustomerProductMarketingContextSaveInput(second);

    expect(parsedFirst).not.toBeNull();
    expect(parsedFirst).toEqual(parsedSecond);
    expect(parsedFirst?.sources.map((source) => source.id)).toEqual([
      'source-repo',
      'source-site',
    ]);
    expect(parsedFirst?.product.proofClaims[0].sourceIds).toEqual([
      'source-repo',
      'source-site',
    ]);
  });

  it('produces byte-identical canonical JSON for reordered object keys', () => {
    const context = persisted();
    const unsigned = {
      schemaVersion: context.schemaVersion,
      contextId: context.contextId,
      revision: context.revision,
      locales: context.locales,
      product: context.product,
      sources: context.sources,
      reviewer: context.reviewer,
    };
    const reordered = {
      reviewer: context.reviewer,
      sources: context.sources,
      product: context.product,
      locales: context.locales,
      revision: context.revision,
      contextId: context.contextId,
      schemaVersion: context.schemaVersion,
    };

    expect(canonicalCustomerProductMarketingContext(unsigned))
      .toBe(canonicalCustomerProductMarketingContext(reordered));
  });

  it('changes the canonical digest input when a proof claim changes', () => {
    const original = persisted();
    const changed = persisted({
      ...draft(),
      product: {
        ...draft().product,
        proofClaims: [{
          ...draft().product.proofClaims[0],
          text: {
            vi: 'Một claim khác có cùng nguồn bằng chứng.',
            en: 'A different claim using the same evidence source.',
          },
        }],
      },
    });

    expect(original.sha256).not.toBe(changed.sha256);
  });

  it('rejects renderer authority, digest, reviewer, and unknown nested keys', () => {
    const valid = draft();

    expect(parseCustomerProductMarketingContextSaveInput({
      ...valid,
      workspaceId: 'renderer-controlled',
    })).toBeNull();
    expect(parseCustomerProductMarketingContextSaveInput({
      ...valid,
      reviewer: 'renderer-controlled',
    })).toBeNull();
    expect(parseCustomerProductMarketingContextSaveInput({
      ...valid,
      sha256: 'a'.repeat(64),
    })).toBeNull();
    expect(parseCustomerProductMarketingContextSaveInput({
      ...valid,
      product: {
        ...valid.product,
        positioning: {
          ...valid.product.positioning,
          secret: 'renderer-controlled',
        },
      },
    })).toBeNull();
  });

  it('requires both locales, source excerpts, proof references, and prohibited claims', () => {
    const valid = draft();

    expect(parseCustomerProductMarketingContextSaveInput({
      ...valid,
      product: {
        ...valid.product,
        positioning: { vi: valid.product.positioning.vi },
      },
    })).toBeNull();
    expect(parseCustomerProductMarketingContextSaveInput({
      ...valid,
      product: { ...valid.product, prohibitedClaims: [] },
    })).toBeNull();
    expect(parseCustomerProductMarketingContextSaveInput({
      ...valid,
      sources: valid.sources.map((source) => ({ ...source, excerpt: '' })),
    })).toBeNull();
    expect(parseCustomerProductMarketingContextSaveInput({
      ...valid,
      product: {
        ...valid.product,
        proofClaims: [{
          ...valid.product.proofClaims[0],
          sourceIds: ['missing-source'],
        }],
      },
    })).toBeNull();
  });

  it('accepts only HTTPS evidence URLs without embedded credentials', () => {
    const valid = draft();

    expect(parseCustomerProductMarketingContextSaveInput({
      ...valid,
      sources: [{ ...valid.sources[0], url: 'http://izziapi.com/' }],
    })).toBeNull();
    expect(parseCustomerProductMarketingContextSaveInput({
      ...valid,
      sources: [{ ...valid.sources[0], url: 'https://user:pass@izziapi.com/' }],
    })).toBeNull();
  });

  it('parses only the exact persisted renderer-safe shape', () => {
    const context = persisted();

    expect(parseCustomerProductMarketingContext(context)).toEqual(context);
    expect(parseCustomerProductMarketingContext({
      ...context,
      reviewerHash: 'a'.repeat(64),
    })).toBeNull();
    expect(parseCustomerProductMarketingContext({
      ...context,
      locales: ['vi'],
    })).toBeNull();
    expect(parseCustomerProductMarketingContext({
      ...context,
      sources: context.sources.map((source) => ({
        ...source,
        localPath: 'C:\\secret\\evidence.txt',
      })),
    })).toBeNull();
  });
});
