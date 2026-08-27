import { createHash } from 'node:crypto';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CustomerMarketingLegacyImportRegistry } from './customer-marketing-legacy-import';

const roots: string[] = [];
const EXPORTED_AT = '2026-08-24T03:00:00.000Z';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const CAMPAIGN_ID = '22222222-2222-4222-8222-222222222222';
const POST_ID = '33333333-3333-4333-8333-333333333333';
const SECOND_POST_ID = '44444444-4444-4444-8444-444444444444';
const FACEBOOK_ACCOUNT_ID = '55555555-5555-4555-8555-555555555555';
const YOUTUBE_ACCOUNT_ID = '66666666-6666-4666-8666-666666666666';
const TIKTOK_ACCOUNT_ID = '77777777-7777-4777-8777-777777777777';

function validManifest() {
  return {
    schema: 'izzi-auto-post-migration',
    version: 1,
    source: {
      application: '@auto-post/api',
      appVersion: '1.1.1',
      exportedAt: EXPORTED_AT,
      workspace: { id: WORKSPACE_ID, name: 'Legacy Growth Room' },
    },
    records: {
      socialAccounts: [
        {
          id: FACEBOOK_ACCOUNT_ID,
          platform: 'facebook',
          platformAccountId: 'page-101',
          displayName: 'IzziAPI Facebook',
          username: 'izziapi',
          status: 'active',
          tokenExpiresAt: null,
        },
        {
          id: YOUTUBE_ACCOUNT_ID,
          platform: 'youtube',
          platformAccountId: 'channel-202',
          displayName: 'IzziAPI YouTube',
          username: '@izziapi',
          status: 'expired',
          tokenExpiresAt: EXPORTED_AT,
        },
        {
          id: TIKTOK_ACCOUNT_ID,
          platform: 'tiktok',
          platformAccountId: 'creator-303',
          displayName: 'IzziAPI TikTok',
          username: '@izziapi',
          status: 'disconnected',
          tokenExpiresAt: null,
        },
      ],
      campaigns: [{
        id: CAMPAIGN_ID,
        name: 'Launch Vietnam',
        description: 'Launch campaign',
        kpiTarget: '100 qualified visits',
        createdAt: EXPORTED_AT,
        updatedAt: EXPORTED_AT,
      }],
      posts: [
        {
          id: POST_ID,
          campaignId: CAMPAIGN_ID,
          title: 'Launch post',
          content: 'Private launch body that must not enter the preview.',
          contentType: 'feed',
          status: 'scheduled',
          scheduledAt: EXPORTED_AT,
          createdAt: EXPORTED_AT,
          updatedAt: EXPORTED_AT,
        },
        {
          id: SECOND_POST_ID,
          campaignId: null,
          title: null,
          content: 'Second private body.',
          contentType: 'shorts',
          status: 'draft',
          scheduledAt: null,
          createdAt: EXPORTED_AT,
          updatedAt: EXPORTED_AT,
        },
      ],
      schedules: [
        {
          id: '88888888-8888-4888-8888-888888888888',
          postId: POST_ID,
          socialAccountId: FACEBOOK_ACCOUNT_ID,
          platform: 'facebook',
          scheduledAt: EXPORTED_AT,
          status: 'scheduled',
          publishedPostId: null,
          publishedUrl: null,
          retryCount: 0,
          createdAt: EXPORTED_AT,
          updatedAt: EXPORTED_AT,
        },
        {
          id: '99999999-9999-4999-8999-999999999999',
          postId: SECOND_POST_ID,
          socialAccountId: TIKTOK_ACCOUNT_ID,
          platform: 'tiktok',
          scheduledAt: EXPORTED_AT,
          status: 'scheduled',
          publishedPostId: null,
          publishedUrl: null,
          retryCount: 0,
          createdAt: EXPORTED_AT,
          updatedAt: EXPORTED_AT,
        },
      ],
      mediaAssets: [{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        postId: POST_ID,
        type: 'video',
        mimeType: 'video/mp4',
        sizeBytes: 2048,
        createdAt: EXPORTED_AT,
      }],
      templates: [{
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        name: 'Product launch',
        content: 'Template body',
        platforms: ['facebook', 'youtube'],
        contentType: 'feed',
      }],
      hashtagSets: [{
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        name: 'Launch tags',
        hashtags: ['#izziapi', '#launch'],
      }],
      rssSources: [{
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        url: 'https://izziapi.com/feed.xml',
        name: 'IzziAPI',
        autoPost: false,
        platforms: ['facebook'],
        lastFetched: null,
        isActive: true,
      }],
      analytics: [{
        scheduleId: '88888888-8888-4888-8888-888888888888',
        reach: 10,
        impressions: 20,
        engagement: 3,
        views: 5,
        watchTime: 1.5,
        clicks: 2,
        shares: 1,
        comments: 1,
        likes: 2,
        saves: 0,
      }],
    },
  };
}

async function fixture(manifest: unknown, name = 'auto-post-export.json') {
  const root = await mkdtemp(path.join(tmpdir(), 'izzi-auto-post-import-'));
  roots.push(root);
  const filePath = path.join(root, name);
  const bytes = Buffer.from(JSON.stringify(manifest), 'utf8');
  await writeFile(filePath, bytes);
  return { filePath, bytes };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('CustomerMarketingLegacyImportRegistry', () => {
  it('returns a redacted reconciliation preview with native migration actions', async () => {
    const { filePath, bytes } = await fixture(validManifest());
    const registry = new CustomerMarketingLegacyImportRegistry();

    const preview = await registry.preview(filePath);

    expect(preview).toMatchObject({
      fileName: 'auto-post-export.json',
      manifestDigest: createHash('sha256').update(bytes).digest('hex'),
      source: {
        application: '@auto-post/api',
        appVersion: '1.1.1',
        exportedAt: EXPORTED_AT,
        workspaceName: 'Legacy Growth Room',
      },
      counts: {
        socialAccounts: 3,
        campaigns: 1,
        posts: 2,
        schedules: 2,
        mediaAssets: 1,
        templates: 1,
        hashtagSets: 1,
        rssSources: 1,
        analytics: 1,
      },
      plan: {
        migrate: { campaigns: 1, content: 2, schedules: 1 },
        reconnect: { accounts: 3 },
        reupload: { media: 1 },
        review: { records: 5 },
      },
      ready: true,
      issues: [{ code: 'unsupported_platform', count: 1 }],
    });
    expect(preview?.selectionId).toMatch(/^[0-9a-f-]{36}$/i);
    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain(filePath);
    expect(serialized).not.toContain(WORKSPACE_ID);
    expect(serialized).not.toContain(FACEBOOK_ACCOUNT_ID);
    expect(serialized).not.toContain('Private launch body');
    expect(serialized).not.toContain('platformAccountId');
  });

  it('rejects credential-bearing or expanded export records', async () => {
    const manifest = validManifest();
    const expanded = {
      ...manifest,
      records: {
        ...manifest.records,
        socialAccounts: [{
          ...manifest.records.socialAccounts[0],
          accessToken: 'must-never-be-imported',
        }],
      },
    };
    const { filePath } = await fixture(expanded);

    await expect(new CustomerMarketingLegacyImportRegistry().preview(filePath)).resolves.toBeNull();
  });

  it('reports duplicate ids and broken references without returning raw records', async () => {
    const manifest = validManifest();
    manifest.records.campaigns.push({ ...manifest.records.campaigns[0] });
    manifest.records.schedules.push({
      ...manifest.records.schedules[0],
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      postId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
    });
    const { filePath } = await fixture(manifest);

    const preview = await new CustomerMarketingLegacyImportRegistry().preview(filePath);

    expect(preview?.ready).toBe(false);
    expect(preview?.issues).toEqual([
      { code: 'duplicate_id', count: 1 },
      { code: 'broken_reference', count: 1 },
      { code: 'unsupported_platform', count: 1 },
    ]);
    expect(JSON.stringify(preview)).not.toContain('ffffffff-ffff-4fff-8fff-ffffffffffff');
  });

  it('re-reads stable exact bytes and consumes a ready selection only once', async () => {
    const { filePath, bytes } = await fixture(validManifest());
    const registry = new CustomerMarketingLegacyImportRegistry();
    const preview = await registry.preview(filePath);

    const consumed = await registry.consume(preview!.selectionId);

    expect(consumed).toEqual({
      bytes,
      manifestDigest: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(Object.keys(consumed!).sort()).toEqual(['bytes', 'manifestDigest']);
    await expect(registry.consume(preview!.selectionId)).resolves.toBeNull();
  });

  it('rejects a selection when the original file metadata changes after preview', async () => {
    const { filePath } = await fixture(validManifest());
    const registry = new CustomerMarketingLegacyImportRegistry();
    const preview = await registry.preview(filePath);
    const changed = new Date(Date.now() + 60_000);
    await utimes(filePath, changed, changed);

    await expect(registry.consume(preview!.selectionId)).resolves.toBeNull();
    await expect(registry.consume(preview!.selectionId)).resolves.toBeNull();
  });

  it('rejects changed bytes even when the replacement has the same size', async () => {
    const { filePath, bytes } = await fixture(validManifest());
    const registry = new CustomerMarketingLegacyImportRegistry();
    const preview = await registry.preview(filePath);
    const replacement = Buffer.from(bytes.toString('utf8').replace('Launch post', 'Launch p0st'), 'utf8');
    expect(replacement.byteLength).toBe(bytes.byteLength);
    await writeFile(filePath, replacement);

    await expect(registry.consume(preview!.selectionId)).resolves.toBeNull();
  });

  it('rejects unknown, expired, and not-ready selections before returning bytes', async () => {
    let now = 1_000;
    const registry = new CustomerMarketingLegacyImportRegistry(() => now, 500);
    const valid = await fixture(validManifest(), 'valid.json');
    const validPreview = await registry.preview(valid.filePath);
    now = 1_500;

    await expect(registry.consume(validPreview!.selectionId)).resolves.toBeNull();
    await expect(registry.consume('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).resolves.toBeNull();

    const brokenManifest = validManifest();
    brokenManifest.records.posts[0].campaignId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const broken = await fixture(brokenManifest, 'broken.json');
    const brokenPreview = await registry.preview(broken.filePath);
    expect(brokenPreview?.ready).toBe(false);
    await expect(registry.consume(brokenPreview!.selectionId)).resolves.toBeNull();
  });
});
