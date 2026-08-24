import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type {
  CustomerMarketingAssetSelection,
  CustomerMarketingAssetUploadInput,
} from '../../shared/customer-marketing-types';

export const MAX_CUSTOMER_MARKETING_VIDEO_BYTES = 50 * 1024 * 1024;

const DEFAULT_SELECTION_TTL_MS = 15 * 60_000;
const MAX_SELECTIONS = 8;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_BY_EXTENSION = new Map([
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/x-m4v'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
]);

interface StoredSelection {
  selection: CustomerMarketingAssetSelection;
  sourcePath: string;
  idempotencyKey: string;
  modifiedAtMs: number;
  expiresAt: number;
  inFlight: boolean;
}

export interface CustomerMarketingAssetPreparedUpload {
  selection: CustomerMarketingAssetSelection;
  idempotencyKey: string;
  body: ReadableStream<Uint8Array>;
}

export interface CustomerMarketingAssetFileGateway {
  select(sourcePath: string): Promise<CustomerMarketingAssetSelection | null>;
  prepare(selectionId: string): Promise<CustomerMarketingAssetPreparedUpload | null>;
  release(selectionId: string): void;
  consume(selectionId: string): void;
}

export interface CustomerMarketingAssetFileRegistryOptions {
  now?: () => number;
  ttlMs?: number;
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

export function parseCustomerMarketingAssetUploadInput(
  value: unknown,
): CustomerMarketingAssetUploadInput | null {
  if (!exactObject(value, ['selectionId', 'title', 'altText', 'tags'])) return null;
  const selectionId = typeof value.selectionId === 'string' ? value.selectionId : '';
  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const altText = typeof value.altText === 'string' ? value.altText.trim() : '';
  const tags = typeof value.tags === 'string'
    ? value.tags.split(',').map((tag) => tag.trim()).filter(Boolean).join(', ')
    : '';
  if (
    !UUID_PATTERN.test(selectionId)
    || title.length < 1 || title.length > 160
    || altText.length > 1_000
    || tags.length > 500
  ) return null;
  return { selectionId: selectionId.toLowerCase(), title, altText, tags };
}

async function sha256File(sourcePath: string): Promise<string | null> {
  const digest = createHash('sha256');
  try {
    for await (const chunk of createReadStream(sourcePath)) digest.update(chunk as Buffer);
    return digest.digest('hex');
  } catch {
    return null;
  }
}

function streamFile(sourcePath: string): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(sourcePath)) as ReadableStream<Uint8Array>;
}

export class CustomerMarketingAssetFileRegistry implements CustomerMarketingAssetFileGateway {
  private readonly selections = new Map<string, StoredSelection>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: CustomerMarketingAssetFileRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = Number.isSafeInteger(options.ttlMs) && (options.ttlMs ?? 0) > 0
      ? options.ttlMs!
      : DEFAULT_SELECTION_TTL_MS;
  }

  async select(sourcePath: string): Promise<CustomerMarketingAssetSelection | null> {
    this.purge();
    if (typeof sourcePath !== 'string' || sourcePath.length < 1 || sourcePath.length > 32_767) return null;
    const absolutePath = path.resolve(sourcePath);
    const extension = path.extname(absolutePath).toLowerCase();
    const mimeType = MIME_BY_EXTENSION.get(extension);
    const fileName = path.basename(absolutePath);
    if (!mimeType || fileName.length < 1 || fileName.length > 255) return null;

    try {
      const before = await lstat(absolutePath);
      if (!before.isFile() || before.isSymbolicLink()
        || before.size < 1 || before.size > MAX_CUSTOMER_MARKETING_VIDEO_BYTES) return null;
      const checksum = await sha256File(absolutePath);
      if (!checksum) return null;
      const after = await lstat(absolutePath);
      if (!after.isFile() || after.isSymbolicLink()
        || after.size !== before.size || after.mtimeMs !== before.mtimeMs) return null;

      while (this.selections.size >= MAX_SELECTIONS) {
        const oldest = this.selections.keys().next().value;
        if (!oldest) break;
        this.selections.delete(oldest);
      }
      const selection: CustomerMarketingAssetSelection = {
        selectionId: randomUUID(),
        fileName,
        mimeType,
        sizeBytes: before.size,
        checksum,
      };
      this.selections.set(selection.selectionId, {
        selection,
        sourcePath: absolutePath,
        idempotencyKey: randomUUID(),
        modifiedAtMs: before.mtimeMs,
        expiresAt: this.now() + this.ttlMs,
        inFlight: false,
      });
      return selection;
    } catch {
      return null;
    }
  }

  async prepare(selectionId: string): Promise<CustomerMarketingAssetPreparedUpload | null> {
    this.purge();
    if (!UUID_PATTERN.test(selectionId)) return null;
    const stored = this.selections.get(selectionId.toLowerCase());
    if (!stored || stored.inFlight) return null;
    stored.inFlight = true;
    try {
      const before = await lstat(stored.sourcePath);
      if (!before.isFile() || before.isSymbolicLink()
        || before.size !== stored.selection.sizeBytes || before.mtimeMs !== stored.modifiedAtMs) {
        this.selections.delete(selectionId.toLowerCase());
        return null;
      }
      const checksum = await sha256File(stored.sourcePath);
      const after = await lstat(stored.sourcePath);
      if (
        checksum !== stored.selection.checksum
        || !after.isFile() || after.isSymbolicLink()
        || after.size !== before.size || after.mtimeMs !== before.mtimeMs
      ) {
        this.selections.delete(selectionId.toLowerCase());
        return null;
      }
      return {
        selection: stored.selection,
        idempotencyKey: stored.idempotencyKey,
        body: streamFile(stored.sourcePath),
      };
    } catch {
      this.selections.delete(selectionId.toLowerCase());
      return null;
    }
  }

  release(selectionId: string): void {
    const stored = this.selections.get(selectionId.toLowerCase());
    if (stored) stored.inFlight = false;
  }

  consume(selectionId: string): void {
    this.selections.delete(selectionId.toLowerCase());
  }

  private purge(): void {
    const now = this.now();
    for (const [selectionId, stored] of this.selections) {
      if (stored.expiresAt <= now) this.selections.delete(selectionId);
    }
  }
}
