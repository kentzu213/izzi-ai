import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CustomerMarketingAssetFileRegistry } from './customer-marketing-asset-files';

const roots: string[] = [];

async function fixture(name = 'launch.mp4', bytes = Buffer.from('private-video-bytes')) {
  const root = await mkdtemp(path.join(tmpdir(), 'izzi-marketing-asset-'));
  roots.push(root);
  const filePath = path.join(root, name);
  await writeFile(filePath, bytes);
  return { filePath, bytes };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('CustomerMarketingAssetFileRegistry', () => {
  it('inspects and streams a supported video without exposing its local path', async () => {
    const { filePath, bytes } = await fixture();
    const registry = new CustomerMarketingAssetFileRegistry();

    const selection = await registry.select(filePath);

    expect(selection).toMatchObject({
      fileName: 'launch.mp4',
      mimeType: 'video/mp4',
      sizeBytes: bytes.byteLength,
      checksum: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(selection?.selectionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.stringify(selection)).not.toContain(filePath);

    const prepared = await registry.prepare(selection!.selectionId);
    expect(prepared?.selection).toEqual(selection);
    expect(Buffer.from(await new Response(prepared!.body).arrayBuffer())).toEqual(bytes);

    registry.consume(selection!.selectionId);
    await expect(registry.prepare(selection!.selectionId)).resolves.toBeNull();
  });

  it('fails closed when the selected bytes change before upload', async () => {
    const { filePath } = await fixture();
    const registry = new CustomerMarketingAssetFileRegistry();
    const selection = await registry.select(filePath);

    await writeFile(filePath, Buffer.from('changed-private-video'));

    await expect(registry.prepare(selection!.selectionId)).resolves.toBeNull();
  });

  it('rejects unsupported, empty and expired selections', async () => {
    let now = 1_000;
    const registry = new CustomerMarketingAssetFileRegistry({ now: () => now, ttlMs: 1_000 });
    const unsupported = await fixture('notes.txt');
    const empty = await fixture('empty.webm', Buffer.alloc(0));
    const valid = await fixture('clip.mov');

    await expect(registry.select(unsupported.filePath)).resolves.toBeNull();
    await expect(registry.select(empty.filePath)).resolves.toBeNull();
    const selection = await registry.select(valid.filePath);
    expect(selection?.mimeType).toBe('video/quicktime');

    now = 2_001;
    await expect(registry.prepare(selection!.selectionId)).resolves.toBeNull();
  });
});
