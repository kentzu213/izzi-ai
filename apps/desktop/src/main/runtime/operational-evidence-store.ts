import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseMarketplaceInstallOperationReceipt,
  type MarketplaceInstallOperationReceipt,
} from '../../shared/marketplace';
import {
  canonicalJson,
  looksLikeRawSecret,
} from '../../shared/personal-office';
import {
  validateRuntimeSpec,
  type BrowserRuntimeSpec,
} from '../../shared/runtime';
import type { IntegrationGrantOperationReceipt } from '../integrations/grant-operation';
import type { RuntimeEncryptionProvider } from './encrypted-state-store';
import {
  createOperationalRuntimeEvidenceQuery,
  type OperationalRuntimeEvidencePort,
  type OperationalRuntimeEvidenceQuery,
  type OperationalRuntimeEvidenceSnapshot,
} from './operational-browser-service';
import {
  authorizeOperationalBrowserRuntime,
  parseConnectedIntegrationGrantReceipt,
  validateOperationalPackageBinding,
  type OperationalPackageBinding,
  type OperationalRuntimeAuthorization,
} from './operational-runtime-gate';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MAX_RECORD_BYTES = 1024 * 1024;

export class OperationalEvidenceStoreError extends Error {
  constructor(
    readonly code:
      | 'ENCRYPTION_UNAVAILABLE'
      | 'INVALID_EVIDENCE'
      | 'CORRUPT_EVIDENCE',
  ) {
    super(code);
    this.name = 'OperationalEvidenceStoreError';
  }
}

export interface RecordOperationalRuntimeEvidenceInput {
  readonly runtime: BrowserRuntimeSpec;
  readonly packageBinding: OperationalPackageBinding;
  readonly marketplaceReceipt: unknown;
  readonly grantReceipt: unknown;
}

interface OperationalEvidenceRecord {
  readonly schemaVersion: 1;
  readonly keyDigest: string;
  readonly query: OperationalRuntimeEvidenceQuery;
  readonly runtime: BrowserRuntimeSpec;
  readonly packageBinding: OperationalPackageBinding;
  readonly authorization: OperationalRuntimeAuthorization;
  readonly marketplaceReceipt: MarketplaceInstallOperationReceipt;
  readonly grantReceipt: IntegrationGrantOperationReceipt;
  readonly recordDigest: string;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function keyDigest(query: OperationalRuntimeEvidenceQuery): string {
  return sha256(canonicalJson(query));
}

function recordDigest(
  record: Omit<OperationalEvidenceRecord, 'recordDigest'>,
): string {
  return sha256(canonicalJson(record));
}

function exact(value: unknown, _pathName: string): string {
  if (
    typeof value !== 'string'
    || !value
    || value !== value.trim()
    || value.length > 512
    || /[\0\r\n*]/.test(value)
    || looksLikeRawSecret(value)
  ) {
    throw new OperationalEvidenceStoreError('CORRUPT_EVIDENCE');
  }
  return value;
}

function normalizeQuery(value: OperationalRuntimeEvidenceQuery): OperationalRuntimeEvidenceQuery {
  if (!value || typeof value !== 'object' || !Array.isArray(value.requiredScopes)) {
    throw new OperationalEvidenceStoreError('CORRUPT_EVIDENCE');
  }
  const requiredScopes = [...new Set(
    value.requiredScopes.map((scope) => exact(scope, 'requiredScopes[]')),
  )].sort();
  if (requiredScopes.length === 0) {
    throw new OperationalEvidenceStoreError('CORRUPT_EVIDENCE');
  }
  const runtimeDigest = exact(value.runtimeDigest, 'runtimeDigest');
  if (!DIGEST.test(runtimeDigest)) {
    throw new OperationalEvidenceStoreError('CORRUPT_EVIDENCE');
  }
  return Object.freeze({
    tenantId: exact(value.tenantId, 'tenantId'),
    userId: exact(value.userId, 'userId'),
    workspaceId: exact(value.workspaceId, 'workspaceId'),
    packageKey: exact(value.packageKey, 'packageKey'),
    packageId: exact(value.packageId, 'packageId'),
    integration: exact(value.integration, 'integration'),
    grantId: exact(value.grantId, 'grantId'),
    runId: exact(value.runId, 'runId'),
    runtimeId: exact(value.runtimeId, 'runtimeId'),
    runtimeDigest,
    requiredScopes: Object.freeze(requiredScopes),
  });
}

export class EncryptedOperationalEvidenceStore implements OperationalRuntimeEvidencePort {
  constructor(
    private readonly root: string,
    private readonly encryption: RuntimeEncryptionProvider,
  ) {}

  async record(
    input: RecordOperationalRuntimeEvidenceInput,
  ): Promise<OperationalRuntimeAuthorization> {
    const normalized = this.normalizeRecordInput(input);
    const withoutDigest: Omit<OperationalEvidenceRecord, 'recordDigest'> = {
      schemaVersion: 1,
      keyDigest: keyDigest(normalized.query),
      query: normalized.query,
      runtime: normalized.runtime,
      packageBinding: normalized.packageBinding,
      authorization: normalized.authorization,
      marketplaceReceipt: normalized.marketplaceReceipt,
      grantReceipt: normalized.grantReceipt,
    };
    const record: OperationalEvidenceRecord = Object.freeze({
      ...withoutDigest,
      recordDigest: recordDigest(withoutDigest),
    });
    await this.write(record);
    return record.authorization;
  }

  async resolve(
    inputQuery: OperationalRuntimeEvidenceQuery,
  ): Promise<OperationalRuntimeEvidenceSnapshot | null> {
    const query = normalizeQuery(inputQuery);
    const file = this.fileFor(query);
    let encoded: string;
    try {
      encoded = await fs.promises.readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new OperationalEvidenceStoreError('CORRUPT_EVIDENCE');
    }
    if (!this.encryption.isAvailable()) {
      throw new OperationalEvidenceStoreError('ENCRYPTION_UNAVAILABLE');
    }
    if (Buffer.byteLength(encoded, 'utf8') > MAX_RECORD_BYTES * 2) {
      throw new OperationalEvidenceStoreError('CORRUPT_EVIDENCE');
    }
    try {
      const plaintext = this.encryption.decrypt(Buffer.from(encoded, 'base64'));
      if (!Buffer.isBuffer(plaintext) || plaintext.length > MAX_RECORD_BYTES) {
        throw new Error('invalid plaintext');
      }
      const record = this.parseRecord(JSON.parse(plaintext.toString('utf8')));
      if (canonicalJson(record.query) !== canonicalJson(query)) {
        throw new Error('scope mismatch');
      }
      return Object.freeze({
        marketplaceReceipt: record.marketplaceReceipt,
        grantReceipt: record.grantReceipt,
      });
    } catch {
      throw new OperationalEvidenceStoreError('CORRUPT_EVIDENCE');
    }
  }

  private normalizeRecordInput(
    input: RecordOperationalRuntimeEvidenceInput,
  ): Omit<OperationalEvidenceRecord, 'schemaVersion' | 'keyDigest' | 'recordDigest'> {
    try {
      const runtimeInput = validateRuntimeSpec(input.runtime);
      if (runtimeInput.kind !== 'browser') throw new Error('browser required');
      const runtime = runtimeInput;
      const packageBinding = validateOperationalPackageBinding(input.packageBinding);
      const query = createOperationalRuntimeEvidenceQuery(runtime, packageBinding);
      const marketplaceReceipt = parseMarketplaceInstallOperationReceipt(
        input.marketplaceReceipt,
      );
      const grantReceipt = parseConnectedIntegrationGrantReceipt(input.grantReceipt);
      const authorization = authorizeOperationalBrowserRuntime({
        marketplaceReceipt,
        grantReceipt,
        packageBinding,
        runtime,
      });
      return {
        query,
        runtime,
        packageBinding,
        authorization,
        marketplaceReceipt,
        grantReceipt,
      };
    } catch {
      throw new OperationalEvidenceStoreError('INVALID_EVIDENCE');
    }
  }

  private parseRecord(value: unknown): OperationalEvidenceRecord {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new OperationalEvidenceStoreError('CORRUPT_EVIDENCE');
    }
    const raw = value as Partial<OperationalEvidenceRecord>;
    const exactKeys = [
      'schemaVersion',
      'keyDigest',
      'query',
      'runtime',
      'packageBinding',
      'authorization',
      'marketplaceReceipt',
      'grantReceipt',
      'recordDigest',
    ];
    if (
      raw.schemaVersion !== 1
      || Object.keys(value).length !== exactKeys.length
      || exactKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
      || typeof raw.keyDigest !== 'string'
      || !DIGEST.test(raw.keyDigest)
      || typeof raw.recordDigest !== 'string'
      || !DIGEST.test(raw.recordDigest)
      || !raw.query
      || !raw.runtime
      || !raw.packageBinding
      || !raw.authorization
    ) {
      throw new OperationalEvidenceStoreError('CORRUPT_EVIDENCE');
    }
    const runtimeInput = validateRuntimeSpec(raw.runtime);
    if (runtimeInput.kind !== 'browser') {
      throw new OperationalEvidenceStoreError('CORRUPT_EVIDENCE');
    }
    const runtime = runtimeInput;
    const packageBinding = validateOperationalPackageBinding(raw.packageBinding);
    const query = createOperationalRuntimeEvidenceQuery(runtime, packageBinding);
    const persistedQuery = normalizeQuery(raw.query);
    if (canonicalJson(query) !== canonicalJson(persistedQuery)) {
      throw new OperationalEvidenceStoreError('CORRUPT_EVIDENCE');
    }
    const marketplaceReceipt = parseMarketplaceInstallOperationReceipt(
      raw.marketplaceReceipt,
    );
    const grantReceipt = parseConnectedIntegrationGrantReceipt(raw.grantReceipt);
    const authorization = authorizeOperationalBrowserRuntime({
      marketplaceReceipt,
      grantReceipt,
      packageBinding,
      runtime,
    });
    if (
      canonicalJson(authorization) !== canonicalJson(raw.authorization)
      || raw.keyDigest !== keyDigest(query)
    ) {
      throw new OperationalEvidenceStoreError('CORRUPT_EVIDENCE');
    }
    const withoutDigest: Omit<OperationalEvidenceRecord, 'recordDigest'> = {
      schemaVersion: 1,
      keyDigest: raw.keyDigest,
      query,
      runtime,
      packageBinding,
      authorization,
      marketplaceReceipt,
      grantReceipt,
    };
    if (raw.recordDigest !== recordDigest(withoutDigest)) {
      throw new OperationalEvidenceStoreError('CORRUPT_EVIDENCE');
    }
    return Object.freeze({
      ...withoutDigest,
      recordDigest: raw.recordDigest,
    });
  }

  private async write(record: OperationalEvidenceRecord): Promise<void> {
    if (!this.encryption.isAvailable()) {
      throw new OperationalEvidenceStoreError('ENCRYPTION_UNAVAILABLE');
    }
    const plaintext = Buffer.from(JSON.stringify(record), 'utf8');
    if (plaintext.length > MAX_RECORD_BYTES) {
      throw new OperationalEvidenceStoreError('INVALID_EVIDENCE');
    }
    let ciphertext: Buffer;
    try {
      ciphertext = this.encryption.encrypt(plaintext);
    } catch {
      throw new OperationalEvidenceStoreError('ENCRYPTION_UNAVAILABLE');
    }
    if (
      !Buffer.isBuffer(ciphertext)
      || ciphertext.length === 0
      || ciphertext.equals(plaintext)
    ) {
      throw new OperationalEvidenceStoreError('ENCRYPTION_UNAVAILABLE');
    }
    await fs.promises.mkdir(this.root, { recursive: true, mode: 0o700 });
    const file = this.fileFor(record.query);
    const temp = `${file}.${process.pid}.${randomUUID()}.tmp`;
    const handle = await fs.promises.open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(ciphertext.toString('base64'), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.promises.rename(temp, file);
      await this.syncRoot();
    } catch (error) {
      await fs.promises.unlink(temp).catch(() => undefined);
      throw error;
    }
  }

  private fileFor(query: OperationalRuntimeEvidenceQuery): string {
    const digest = keyDigest(query);
    return path.join(this.root, `${digest.slice('sha256:'.length)}.evidence`);
  }

  private async syncRoot(): Promise<void> {
    try {
      const handle = await fs.promises.open(this.root, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch {
      // Directory fsync is not available on every Windows filesystem.
    }
  }
}
