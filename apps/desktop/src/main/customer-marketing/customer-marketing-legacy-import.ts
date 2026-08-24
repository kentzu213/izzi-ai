import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CUSTOMER_MARKETING_LEGACY_COLLECTIONS,
  type CustomerMarketingLegacyCollection,
  type CustomerMarketingLegacyImportPreview,
} from '../../shared/customer-marketing-legacy-import-types';

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_RECORDS_PER_COLLECTION = 10_000;
const MAX_SHORT_STRING = 512;
const MAX_CONTENT_STRING = 100_000;
const SELECTION_TTL_MS = 15 * 60 * 1000;
const SUPPORTED_PLATFORMS = new Set(['facebook', 'youtube']);

const RECORD_COLLECTIONS = CUSTOMER_MARKETING_LEGACY_COLLECTIONS;
type CollectionName = CustomerMarketingLegacyCollection;
type JsonObject = Record<string, unknown>;

interface ParsedManifest {
  source: {
    application: '@auto-post/api';
    appVersion: string;
    exportedAt: string;
    workspaceName: string;
  };
  records: Record<CollectionName, JsonObject[]>;
}

interface StoredSelection {
  filePath: string;
  manifestDigest: string;
  expiresAt: number;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: JsonObject, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isString(value: unknown, maxLength = MAX_SHORT_STRING): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isNullableString(value: unknown, maxLength = MAX_SHORT_STRING): value is string | null {
  return value === null || isString(value, maxLength);
}

function isTimestamp(value: unknown): value is string {
  return isString(value, 64) && Number.isFinite(Date.parse(value));
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isUuid(value: unknown): value is string {
  return isString(value, 64)
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isNullableUuid(value: unknown): value is string | null {
  return value === null || isUuid(value);
}

function isSafeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isStringArray(value: unknown, maxItems = 64): value is string[] {
  return Array.isArray(value)
    && value.length <= maxItems
    && value.every((item) => isString(item));
}

function parseCollection(
  records: JsonObject,
  name: CollectionName,
  validate: (record: JsonObject) => boolean,
): JsonObject[] | null {
  const value = records[name];
  if (!Array.isArray(value) || value.length > MAX_RECORDS_PER_COLLECTION) return null;
  if (!value.every((record) => isObject(record) && validate(record))) return null;
  return value as JsonObject[];
}

const recordValidators: Record<CollectionName, (record: JsonObject) => boolean> = {
  socialAccounts: (record) => hasExactKeys(record, [
    'id', 'platform', 'platformAccountId', 'displayName', 'username', 'status', 'tokenExpiresAt',
  ])
    && isUuid(record.id)
    && isString(record.platform)
    && isString(record.platformAccountId)
    && isString(record.displayName)
    && isNullableString(record.username)
    && isString(record.status)
    && isNullableTimestamp(record.tokenExpiresAt),
  campaigns: (record) => hasExactKeys(record, [
    'id', 'name', 'description', 'kpiTarget', 'createdAt', 'updatedAt',
  ])
    && isUuid(record.id)
    && isString(record.name)
    && isNullableString(record.description, MAX_CONTENT_STRING)
    && isNullableString(record.kpiTarget, MAX_CONTENT_STRING)
    && isTimestamp(record.createdAt)
    && isTimestamp(record.updatedAt),
  posts: (record) => hasExactKeys(record, [
    'id', 'campaignId', 'title', 'content', 'contentType', 'status', 'scheduledAt', 'createdAt', 'updatedAt',
  ])
    && isUuid(record.id)
    && isNullableUuid(record.campaignId)
    && isNullableString(record.title)
    && isString(record.content, MAX_CONTENT_STRING)
    && isString(record.contentType)
    && isString(record.status)
    && isNullableTimestamp(record.scheduledAt)
    && isTimestamp(record.createdAt)
    && isTimestamp(record.updatedAt),
  schedules: (record) => hasExactKeys(record, [
    'id', 'postId', 'socialAccountId', 'platform', 'scheduledAt', 'status', 'publishedPostId',
    'publishedUrl', 'retryCount', 'createdAt', 'updatedAt',
  ])
    && isUuid(record.id)
    && isUuid(record.postId)
    && isUuid(record.socialAccountId)
    && isString(record.platform)
    && isTimestamp(record.scheduledAt)
    && isString(record.status)
    && isNullableString(record.publishedPostId)
    && isNullableString(record.publishedUrl, 2_048)
    && isSafeInteger(record.retryCount)
    && isTimestamp(record.createdAt)
    && isTimestamp(record.updatedAt),
  mediaAssets: (record) => hasExactKeys(record, [
    'id', 'postId', 'type', 'mimeType', 'sizeBytes', 'createdAt',
  ])
    && isUuid(record.id)
    && isNullableUuid(record.postId)
    && isString(record.type)
    && isString(record.mimeType)
    && isSafeInteger(record.sizeBytes)
    && isTimestamp(record.createdAt),
  templates: (record) => hasExactKeys(record, [
    'id', 'name', 'content', 'platforms', 'contentType',
  ])
    && isUuid(record.id)
    && isString(record.name)
    && isString(record.content, MAX_CONTENT_STRING)
    && isStringArray(record.platforms)
    && isString(record.contentType),
  hashtagSets: (record) => hasExactKeys(record, ['id', 'name', 'hashtags'])
    && isUuid(record.id)
    && isString(record.name)
    && isStringArray(record.hashtags, 256),
  rssSources: (record) => hasExactKeys(record, [
    'id', 'url', 'name', 'autoPost', 'platforms', 'lastFetched', 'isActive',
  ])
    && isUuid(record.id)
    && isString(record.url, 2_048)
    && isString(record.name)
    && typeof record.autoPost === 'boolean'
    && isStringArray(record.platforms)
    && isNullableTimestamp(record.lastFetched)
    && typeof record.isActive === 'boolean',
  analytics: (record) => hasExactKeys(record, [
    'scheduleId', 'reach', 'impressions', 'engagement', 'views', 'watchTime', 'clicks', 'shares',
    'comments', 'likes', 'saves',
  ])
    && isUuid(record.scheduleId)
    && ['reach', 'impressions', 'engagement', 'views', 'watchTime', 'clicks', 'shares', 'comments', 'likes', 'saves']
      .every((key) => isSafeNumber(record[key])),
};

function parseManifest(value: unknown): ParsedManifest | null {
  if (!isObject(value) || !hasExactKeys(value, ['schema', 'version', 'source', 'records'])) return null;
  if (value.schema !== 'izzi-auto-post-migration' || value.version !== 1) return null;
  if (!isObject(value.source) || !hasExactKeys(value.source, [
    'application', 'appVersion', 'exportedAt', 'workspace',
  ])) return null;
  if (value.source.application !== '@auto-post/api'
    || !isString(value.source.appVersion)
    || !isTimestamp(value.source.exportedAt)
    || !isObject(value.source.workspace)
    || !hasExactKeys(value.source.workspace, ['id', 'name'])
    || !isUuid(value.source.workspace.id)
    || !isString(value.source.workspace.name)) return null;
  if (!isObject(value.records) || !hasExactKeys(value.records, RECORD_COLLECTIONS)) return null;

  const parsedRecords = {} as Record<CollectionName, JsonObject[]>;
  for (const name of RECORD_COLLECTIONS) {
    const collection = parseCollection(value.records, name, recordValidators[name]);
    if (!collection) return null;
    parsedRecords[name] = collection;
  }

  return {
    source: {
      application: '@auto-post/api',
      appVersion: value.source.appVersion,
      exportedAt: value.source.exportedAt,
      workspaceName: value.source.workspace.name,
    },
    records: parsedRecords,
  };
}

function countDuplicateIds(records: Record<CollectionName, JsonObject[]>): number {
  let duplicates = 0;
  for (const name of RECORD_COLLECTIONS.filter((candidate) => candidate !== 'analytics')) {
    const ids = new Set<string>();
    for (const record of records[name]) {
      const id = record.id as string;
      if (ids.has(id)) duplicates += 1;
      ids.add(id);
    }
  }
  return duplicates;
}

function buildPreview(
  parsed: ParsedManifest,
  fileName: string,
  manifestDigest: string,
  selectionId: string,
): CustomerMarketingLegacyImportPreview {
  const { records } = parsed;
  const campaignIds = new Set(records.campaigns.map((record) => record.id as string));
  const postIds = new Set(records.posts.map((record) => record.id as string));
  const scheduleIds = new Set(records.schedules.map((record) => record.id as string));
  const accountById = new Map(records.socialAccounts.map((record) => [record.id as string, record]));

  let brokenReferences = 0;
  let platformMismatches = 0;
  let unsupportedPlatforms = 0;
  let migratableSchedules = 0;

  for (const post of records.posts) {
    if (post.campaignId !== null && !campaignIds.has(post.campaignId as string)) brokenReferences += 1;
  }
  for (const media of records.mediaAssets) {
    if (media.postId !== null && !postIds.has(media.postId as string)) brokenReferences += 1;
  }
  for (const analytic of records.analytics) {
    if (!scheduleIds.has(analytic.scheduleId as string)) brokenReferences += 1;
  }
  for (const schedule of records.schedules) {
    const postExists = postIds.has(schedule.postId as string);
    const account = accountById.get(schedule.socialAccountId as string);
    const referencesValid = postExists && Boolean(account);
    if (!referencesValid) brokenReferences += 1;

    const platform = (schedule.platform as string).toLowerCase();
    const supported = SUPPORTED_PLATFORMS.has(platform);
    if (!supported) unsupportedPlatforms += 1;

    const matchesAccount = !account || (account.platform as string).toLowerCase() === platform;
    if (!matchesAccount) platformMismatches += 1;
    if (referencesValid && matchesAccount && supported) migratableSchedules += 1;
  }

  const duplicateIds = countDuplicateIds(records);
  const issues: CustomerMarketingLegacyImportPreview['issues'] = [];
  if (duplicateIds > 0) issues.push({ code: 'duplicate_id', count: duplicateIds });
  if (brokenReferences > 0) issues.push({ code: 'broken_reference', count: brokenReferences });
  if (platformMismatches > 0) issues.push({ code: 'platform_mismatch', count: platformMismatches });
  if (unsupportedPlatforms > 0) issues.push({ code: 'unsupported_platform', count: unsupportedPlatforms });

  const reviewRecords = records.templates.length
    + records.hashtagSets.length
    + records.rssSources.length
    + records.analytics.length
    + (records.schedules.length - migratableSchedules);

  return {
    selectionId,
    fileName,
    manifestDigest,
    source: parsed.source,
    counts: {
      socialAccounts: records.socialAccounts.length,
      campaigns: records.campaigns.length,
      posts: records.posts.length,
      schedules: records.schedules.length,
      mediaAssets: records.mediaAssets.length,
      templates: records.templates.length,
      hashtagSets: records.hashtagSets.length,
      rssSources: records.rssSources.length,
      analytics: records.analytics.length,
    },
    plan: {
      migrate: {
        campaigns: records.campaigns.length,
        content: records.posts.length,
        schedules: migratableSchedules,
      },
      reconnect: { accounts: records.socialAccounts.length },
      reupload: { media: records.mediaAssets.length },
      review: { records: reviewRecords },
    },
    ready: duplicateIds === 0 && brokenReferences === 0 && platformMismatches === 0,
    issues,
  };
}

export class CustomerMarketingLegacyImportRegistry {
  private readonly selections = new Map<string, StoredSelection>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly selectionTtlMs = SELECTION_TTL_MS,
  ) {}

  async preview(filePath: string): Promise<CustomerMarketingLegacyImportPreview | null> {
    try {
      this.pruneExpired();
      if (!path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.json') return null;
      const before = await lstat(filePath);
      if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > MAX_MANIFEST_BYTES) return null;

      const bytes = await readFile(filePath);
      const after = await lstat(filePath);
      if (!after.isFile()
        || after.isSymbolicLink()
        || after.size !== before.size
        || after.mtimeMs !== before.mtimeMs
        || bytes.byteLength !== before.size) return null;

      const parsed = parseManifest(JSON.parse(bytes.toString('utf8')));
      if (!parsed) return null;

      const manifestDigest = createHash('sha256').update(bytes).digest('hex');
      const selectionId = randomUUID();
      this.selections.set(selectionId, {
        filePath,
        manifestDigest,
        expiresAt: this.now() + this.selectionTtlMs,
      });
      return buildPreview(parsed, path.basename(filePath), manifestDigest, selectionId);
    } catch {
      return null;
    }
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [selectionId, selection] of this.selections) {
      if (selection.expiresAt <= now) this.selections.delete(selectionId);
    }
  }
}
