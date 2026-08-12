import { createHash } from 'node:crypto';

export type CustomerMarketingSeoReviewStatus = 'pending';

export interface CustomerMarketingSeoReviewMetadata {
  reviewer: string;
  requestedAt: string;
  status: CustomerMarketingSeoReviewStatus;
}

export interface CustomerMarketingSeoCmsDraftInput {
  slug: string;
  title: string;
  canonicalUrl: string;
  metaDescription: string;
  body: string;
  sourceDigest: string;
  expectedRevision: number;
  review: CustomerMarketingSeoReviewMetadata;
}

export interface CustomerMarketingSeoCmsDraftPackage extends CustomerMarketingSeoCmsDraftInput {
  cmsStatus: 'draft';
  publishStatus: 'not_published';
  publishGate: 'human_review_required';
  noindex: true;
  approvedForPublish: false;
  externalActionPerformed: false;
  packageDigest: string;
}

export interface CustomerMarketingSeoLocalPreview {
  kind: 'local_html_preview';
  canonicalUrl: string;
  noindex: true;
  externalActionPerformed: false;
  html: string;
  previewDigest: string;
}

export interface CustomerMarketingSeoCmsDraftParseOptions {
  allowedCanonicalHosts?: readonly string[];
}

const INPUT_KEYS = [
  'slug',
  'title',
  'canonicalUrl',
  'metaDescription',
  'body',
  'sourceDigest',
  'expectedRevision',
  'review',
] as const;
const REVIEW_KEYS = ['reviewer', 'requestedAt', 'status'] as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const UNSAFE_BODY_CHARACTER_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function parseCustomerMarketingSeoCmsDraftInput(
  value: unknown,
  options: CustomerMarketingSeoCmsDraftParseOptions = {},
): CustomerMarketingSeoCmsDraftInput | null {
  if (!isExactPlainRecord(value, INPUT_KEYS) || !isExactPlainRecord(value.review, REVIEW_KEYS)) {
    return null;
  }

  const {
    slug,
    title,
    canonicalUrl,
    metaDescription,
    body,
    sourceDigest,
    expectedRevision,
    review,
  } = value;

  if (!isBoundedTrimmedString(slug, 1, 120)
    || !SLUG_PATTERN.test(slug)
    || !isBoundedTrimmedString(title, 1, 120)
    || !isBoundedTrimmedString(canonicalUrl, 1, 2_048)
    || !isBoundedTrimmedString(metaDescription, 1, 320)
    || !isBoundedBody(body)
    || typeof sourceDigest !== 'string'
    || !SHA256_PATTERN.test(sourceDigest)
    || typeof expectedRevision !== 'number'
    || !Number.isSafeInteger(expectedRevision)
    || expectedRevision < 0
    || !isBoundedTrimmedString(review.reviewer, 1, 120)
    || !isCanonicalIsoTimestamp(review.requestedAt)
    || review.status !== 'pending'
    || !isAllowedCanonicalUrl(canonicalUrl, slug, options.allowedCanonicalHosts)) {
    return null;
  }

  return {
    slug,
    title,
    canonicalUrl,
    metaDescription,
    body,
    sourceDigest,
    expectedRevision,
    review: {
      reviewer: review.reviewer,
      requestedAt: review.requestedAt,
      status: review.status,
    },
  };
}

export function buildCustomerMarketingSeoCmsDraft(
  value: unknown,
  options: CustomerMarketingSeoCmsDraftParseOptions = {},
): CustomerMarketingSeoCmsDraftPackage {
  const input = parseCustomerMarketingSeoCmsDraftInput(value, options);
  if (!input) {
    throw new Error('Invalid SEO/CMS draft input.');
  }

  const canonicalPackage = {
    ...input,
    cmsStatus: 'draft' as const,
    publishStatus: 'not_published' as const,
    publishGate: 'human_review_required' as const,
    noindex: true as const,
    approvedForPublish: false as const,
    externalActionPerformed: false as const,
  };

  return {
    ...canonicalPackage,
    packageDigest: sha256(JSON.stringify(canonicalPackage)),
  };
}

export function renderCustomerMarketingSeoLocalPreview(
  draft: CustomerMarketingSeoCmsDraftPackage,
): CustomerMarketingSeoLocalPreview {
  const title = escapeHtml(draft.title);
  const description = escapeHtml(draft.metaDescription);
  const canonicalUrl = escapeHtml(draft.canonicalUrl);
  const body = draft.body
    .split(/\r?\n\r?\n/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\r?\n/g, '<br>')}</p>`)
    .join('\n');
  const html = [
    '<!doctype html>',
    '<html lang="vi">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    '<meta name="robots" content="noindex,nofollow">',
    `<link rel="canonical" href="${canonicalUrl}">`,
    '</head>',
    '<body>',
    '<main>',
    `<h1>${title}</h1>`,
    body,
    '</main>',
    '</body>',
    '</html>',
  ].join('\n');

  return {
    kind: 'local_html_preview',
    canonicalUrl: draft.canonicalUrl,
    noindex: true,
    externalActionPerformed: false,
    html,
    previewDigest: sha256(html),
  };
}

function isAllowedCanonicalUrl(
  value: string,
  slug: string,
  configuredHosts: readonly string[] | undefined,
): boolean {
  const allowedHosts = new Set(['izziapi.com']);
  for (const host of configuredHosts ?? []) {
    const normalized = host.trim().toLowerCase();
    if (!HOST_PATTERN.test(normalized)) return false;
    allowedHosts.add(normalized);
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.port === ''
      && allowedHosts.has(url.hostname.toLowerCase())
      && url.pathname === `/blog/${slug}`
      && url.search === ''
      && url.hash === ''
      && url.toString() === value;
  } catch {
    return false;
  }
}

function isExactPlainRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isBoundedTrimmedString(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length >= minimumLength
    && value.length <= maximumLength
    && !CONTROL_CHARACTER_PATTERN.test(value);
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value).toISOString() === value;
}

function isBoundedBody(value: unknown): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length >= 1
    && value.length <= 200_000
    && !UNSAFE_BODY_CHARACTER_PATTERN.test(value);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
