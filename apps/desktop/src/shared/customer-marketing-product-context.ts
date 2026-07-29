export const CUSTOMER_PRODUCT_MARKETING_CONTEXT_SCHEMA_VERSION = 1 as const;
export const CUSTOMER_PRODUCT_MARKETING_CONTEXT_ID = 'product-marketing-context' as const;
export const CUSTOMER_PRODUCT_MARKETING_CONTEXT_LOCALES = ['vi', 'en'] as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const AUTHORITY_TOKEN_PATTERN = /^v1\.[a-f0-9]{64}$/;

export interface CustomerMarketingLocalizedText {
  vi: string;
  en: string;
}

export interface CustomerProductMarketingEvidenceSourceInput {
  id: string;
  title: string;
  url: string;
  excerpt: string;
}

export interface CustomerProductMarketingEvidenceSourceV1
  extends CustomerProductMarketingEvidenceSourceInput {
  sha256: string;
}

export interface CustomerProductMarketingProofClaimV1 {
  id: string;
  text: CustomerMarketingLocalizedText;
  sourceIds: string[];
}

export interface CustomerProductMarketingProhibitedClaimV1 {
  id: string;
  text: CustomerMarketingLocalizedText;
  reason: CustomerMarketingLocalizedText;
}

export interface CustomerProductMarketingProfileV1 {
  productName: string;
  category: CustomerMarketingLocalizedText;
  positioning: CustomerMarketingLocalizedText;
  targetAudience: CustomerMarketingLocalizedText;
  valueProposition: CustomerMarketingLocalizedText;
  brandVoice: CustomerMarketingLocalizedText;
  callToAction: CustomerMarketingLocalizedText;
  proofClaims: CustomerProductMarketingProofClaimV1[];
  prohibitedClaims: CustomerProductMarketingProhibitedClaimV1[];
}

export interface CustomerProductMarketingContextSaveInput {
  authorityToken: string;
  expectedRevision: number;
  product: CustomerProductMarketingProfileV1;
  sources: CustomerProductMarketingEvidenceSourceInput[];
}

export interface CustomerProductMarketingContextRef {
  contextId: typeof CUSTOMER_PRODUCT_MARKETING_CONTEXT_ID;
  revision: number;
  sha256: string;
}

export interface CustomerProductMarketingContextV1 {
  schemaVersion: typeof CUSTOMER_PRODUCT_MARKETING_CONTEXT_SCHEMA_VERSION;
  contextId: typeof CUSTOMER_PRODUCT_MARKETING_CONTEXT_ID;
  revision: number;
  locales: typeof CUSTOMER_PRODUCT_MARKETING_CONTEXT_LOCALES;
  product: CustomerProductMarketingProfileV1;
  sources: CustomerProductMarketingEvidenceSourceV1[];
  reviewer: {
    name: string;
    reviewedAt: string;
  };
  sha256: string;
}

export type CustomerProductMarketingContextUnsignedV1 =
  Omit<CustomerProductMarketingContextV1, 'sha256'>;

export function parseCustomerProductMarketingContextSaveInput(
  value: unknown,
): CustomerProductMarketingContextSaveInput | null {
  if (!isRecordWithExactKeys(value, ['authorityToken', 'expectedRevision', 'product', 'sources'])) {
    return null;
  }
  const authorityToken = typeof value.authorityToken === 'string'
    && AUTHORITY_TOKEN_PATTERN.test(value.authorityToken)
    ? value.authorityToken
    : null;
  const expectedRevision = nonNegativeInteger(value.expectedRevision);
  const product = parseProduct(value.product);
  const sources = parseSourceInputs(value.sources);
  if (!authorityToken || expectedRevision === null || !product || !sources) return null;
  if (!proofSourcesExist(product.proofClaims, sources)) return null;
  return { authorityToken, expectedRevision, product, sources };
}

export function parseCustomerProductMarketingContext(
  value: unknown,
): CustomerProductMarketingContextV1 | null {
  if (!isRecordWithExactKeys(value, [
    'schemaVersion',
    'contextId',
    'revision',
    'locales',
    'product',
    'sources',
    'reviewer',
    'sha256',
  ])) return null;
  if (
    value.schemaVersion !== CUSTOMER_PRODUCT_MARKETING_CONTEXT_SCHEMA_VERSION
    || value.contextId !== CUSTOMER_PRODUCT_MARKETING_CONTEXT_ID
    || !isExactLocales(value.locales)
  ) return null;
  const revision = positiveInteger(value.revision);
  const product = parseProduct(value.product);
  const sources = parsePersistedSources(value.sources);
  const reviewer = parseReviewer(value.reviewer);
  if (
    revision === null
    || !product
    || !sources
    || !reviewer
    || typeof value.sha256 !== 'string'
    || !SHA256_PATTERN.test(value.sha256)
    || !proofSourcesExist(product.proofClaims, sources)
  ) return null;
  return {
    schemaVersion: CUSTOMER_PRODUCT_MARKETING_CONTEXT_SCHEMA_VERSION,
    contextId: CUSTOMER_PRODUCT_MARKETING_CONTEXT_ID,
    revision,
    locales: CUSTOMER_PRODUCT_MARKETING_CONTEXT_LOCALES,
    product,
    sources,
    reviewer,
    sha256: value.sha256,
  };
}

export function parseCustomerProductMarketingContextRef(
  value: unknown,
): CustomerProductMarketingContextRef | null {
  if (!isRecordWithExactKeys(value, ['contextId', 'revision', 'sha256'])) return null;
  const revision = positiveInteger(value.revision);
  if (
    value.contextId !== CUSTOMER_PRODUCT_MARKETING_CONTEXT_ID
    || revision === null
    || typeof value.sha256 !== 'string'
    || !SHA256_PATTERN.test(value.sha256)
  ) return null;
  return {
    contextId: CUSTOMER_PRODUCT_MARKETING_CONTEXT_ID,
    revision,
    sha256: value.sha256,
  };
}

export function customerProductMarketingContextRef(
  context: CustomerProductMarketingContextV1,
): CustomerProductMarketingContextRef {
  return {
    contextId: CUSTOMER_PRODUCT_MARKETING_CONTEXT_ID,
    revision: context.revision,
    sha256: context.sha256,
  };
}

export function canonicalCustomerProductMarketingSource(
  value: CustomerProductMarketingEvidenceSourceInput,
): string {
  return canonicalJson(value);
}

export function canonicalCustomerProductMarketingContext(
  value: CustomerProductMarketingContextUnsignedV1 | Record<string, unknown>,
): string {
  return canonicalJson(value);
}

export function canonicalCustomerProductMarketingDraft(
  value: Pick<CustomerProductMarketingContextSaveInput, 'product' | 'sources'>,
): string {
  return canonicalJson({ product: value.product, sources: value.sources });
}

function parseProduct(value: unknown): CustomerProductMarketingProfileV1 | null {
  if (!isRecordWithExactKeys(value, [
    'productName',
    'category',
    'positioning',
    'targetAudience',
    'valueProposition',
    'brandVoice',
    'callToAction',
    'proofClaims',
    'prohibitedClaims',
  ])) return null;
  const productName = normalizedText(value.productName, 2, 160);
  const category = localizedText(value.category, 2, 500);
  const positioning = localizedText(value.positioning, 8, 2_000);
  const targetAudience = localizedText(value.targetAudience, 8, 2_000);
  const valueProposition = localizedText(value.valueProposition, 8, 2_000);
  const brandVoice = localizedText(value.brandVoice, 4, 1_000);
  const callToAction = localizedText(value.callToAction, 4, 1_000);
  const proofClaims = parseProofClaims(value.proofClaims);
  const prohibitedClaims = parseProhibitedClaims(value.prohibitedClaims);
  if (
    productName === null
    || !category
    || !positioning
    || !targetAudience
    || !valueProposition
    || !brandVoice
    || !callToAction
    || !proofClaims
    || !prohibitedClaims
  ) return null;
  return {
    productName,
    category,
    positioning,
    targetAudience,
    valueProposition,
    brandVoice,
    callToAction,
    proofClaims,
    prohibitedClaims,
  };
}

function parseProofClaims(value: unknown): CustomerProductMarketingProofClaimV1[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) return null;
  const claims: CustomerProductMarketingProofClaimV1[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!isRecordWithExactKeys(candidate, ['id', 'text', 'sourceIds'])) return null;
    const id = identifier(candidate.id);
    const text = localizedText(candidate.text, 4, 2_000);
    if (
      !id
      || ids.has(id)
      || !text
      || !Array.isArray(candidate.sourceIds)
      || candidate.sourceIds.length === 0
      || candidate.sourceIds.length > 8
    ) return null;
    const sourceIds = candidate.sourceIds.map(identifier);
    if (sourceIds.some((sourceId) => !sourceId)) return null;
    const normalizedSourceIds = sourceIds as string[];
    if (new Set(normalizedSourceIds).size !== normalizedSourceIds.length) return null;
    ids.add(id);
    claims.push({
      id,
      text,
      sourceIds: normalizedSourceIds.sort(compareText),
    });
  }
  return claims.sort((left, right) => compareText(left.id, right.id));
}

function parseProhibitedClaims(
  value: unknown,
): CustomerProductMarketingProhibitedClaimV1[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) return null;
  const claims: CustomerProductMarketingProhibitedClaimV1[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!isRecordWithExactKeys(candidate, ['id', 'text', 'reason'])) return null;
    const id = identifier(candidate.id);
    const text = localizedText(candidate.text, 4, 2_000);
    const reason = localizedText(candidate.reason, 4, 2_000);
    if (!id || ids.has(id) || !text || !reason) return null;
    ids.add(id);
    claims.push({ id, text, reason });
  }
  return claims.sort((left, right) => compareText(left.id, right.id));
}

function parseSourceInputs(
  value: unknown,
): CustomerProductMarketingEvidenceSourceInput[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) return null;
  const sources: CustomerProductMarketingEvidenceSourceInput[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    const source = parseSourceInput(candidate);
    if (!source || ids.has(source.id)) return null;
    ids.add(source.id);
    sources.push(source);
  }
  return sources.sort((left, right) => compareText(left.id, right.id));
}

function parseSourceInput(
  value: unknown,
): CustomerProductMarketingEvidenceSourceInput | null {
  if (!isRecordWithExactKeys(value, ['id', 'title', 'url', 'excerpt'])) return null;
  const id = identifier(value.id);
  const title = normalizedText(value.title, 2, 200);
  const url = evidenceUrl(value.url);
  const excerpt = normalizedText(value.excerpt, 10, 4_000);
  if (!id || title === null || !url || excerpt === null) return null;
  return { id, title, url, excerpt };
}

function parsePersistedSources(
  value: unknown,
): CustomerProductMarketingEvidenceSourceV1[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 30) return null;
  const sources: CustomerProductMarketingEvidenceSourceV1[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    if (!isRecordWithExactKeys(candidate, ['id', 'title', 'url', 'excerpt', 'sha256'])) {
      return null;
    }
    const source = parseSourceInput({
      id: candidate.id,
      title: candidate.title,
      url: candidate.url,
      excerpt: candidate.excerpt,
    });
    if (
      !source
      || ids.has(source.id)
      || typeof candidate.sha256 !== 'string'
      || !SHA256_PATTERN.test(candidate.sha256)
    ) return null;
    ids.add(source.id);
    sources.push({ ...source, sha256: candidate.sha256 });
  }
  return sources.sort((left, right) => compareText(left.id, right.id));
}

function parseReviewer(value: unknown): CustomerProductMarketingContextV1['reviewer'] | null {
  if (!isRecordWithExactKeys(value, ['name', 'reviewedAt'])) return null;
  const name = normalizedText(value.name, 2, 160);
  if (name === null || !isIsoDate(value.reviewedAt)) return null;
  return { name, reviewedAt: value.reviewedAt };
}

function proofSourcesExist(
  claims: readonly CustomerProductMarketingProofClaimV1[],
  sources: readonly Pick<CustomerProductMarketingEvidenceSourceInput, 'id'>[],
): boolean {
  const sourceIds = new Set(sources.map((source) => source.id));
  return claims.every((claim) => claim.sourceIds.every((sourceId) => sourceIds.has(sourceId)));
}

function localizedText(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): CustomerMarketingLocalizedText | null {
  if (!isRecordWithExactKeys(value, ['vi', 'en'])) return null;
  const vi = normalizedText(value.vi, minimumLength, maximumLength);
  const en = normalizedText(value.en, minimumLength, maximumLength);
  return vi === null || en === null ? null : { vi, en };
}

function normalizedText(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .trim();
  return normalized.length >= minimumLength && normalized.length <= maximumLength
    ? normalized
    : null;
}

function identifier(value: unknown): string | null {
  const normalized = normalizedText(value, 1, 64);
  return normalized && IDENTIFIER_PATTERN.test(normalized) ? normalized : null;
}

function evidenceUrl(value: unknown): string | null {
  const normalized = normalizedText(value, 8, 2_048);
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    if (
      parsed.protocol !== 'https:'
      || !parsed.hostname
      || parsed.username
      || parsed.password
    ) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = nonNegativeInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function isExactLocales(
  value: unknown,
): value is typeof CUSTOMER_PRODUCT_MARKETING_CONTEXT_LOCALES {
  return Array.isArray(value)
    && value.length === 2
    && value[0] === 'vi'
    && value[1] === 'en';
}

function isRecordWithExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Canonical JSON rejects non-finite numbers.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort(compareText)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  throw new TypeError('Canonical JSON accepts JSON values only.');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
