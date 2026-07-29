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
import {
  parseIntegrationGrantScope,
  type IntegrationGrantScope,
} from '../../shared/integration-grants';
import type { MarketplaceCompletedReceiptSink } from '../marketplace/operation-service';
import type {
  IntegrationGrantOperationalEvidenceSink,
  IntegrationGrantOperationReceipt,
} from '../integrations/grant-operation/grant-operation-service';
import type { RuntimeEncryptionProvider } from './encrypted-state-store';
import {
  createOperationalRuntimeEvidenceQuery,
  type OperationalRuntimeEvidencePort,
  type OperationalRuntimeEvidenceQuery,
  type OperationalRuntimeEvidenceSnapshot,
} from './operational-browser-service';
import {
  EncryptedOperationalEvidenceStore,
} from './operational-evidence-store';
import {
  authorizeOperationalBrowserRuntime,
  parseConnectedIntegrationGrantReceipt,
  validateOperationalPackageBinding,
  type OperationalPackageBinding,
} from './operational-runtime-gate';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MAX_RECORD_BYTES = 1024 * 1024;

type AuthorityRecordKind = 'marketplace' | 'grant' | 'grant_revocation';

interface AuthorityRecord {
  readonly schemaVersion: 1;
  readonly kind: AuthorityRecordKind;
  readonly keyDigest: string;
  readonly payload: unknown;
  readonly recordDigest: string;
}

export class AuthoritativeOperationReceiptError extends Error {
  constructor(
    readonly code:
      | 'ENCRYPTION_UNAVAILABLE'
      | 'INVALID_RECEIPT'
      | 'CORRUPT_RECEIPT'
      | 'GRANT_REVOKED',
  ) {
    super(code);
    this.name = 'AuthoritativeOperationReceiptError';
  }
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function exact(value: string, _pathName: string): string {
  if (
    !value
    || value !== value.trim()
    || value.length > 512
    || /[\0\r\n*]/.test(value)
    || looksLikeRawSecret(value)
  ) {
    throw new AuthoritativeOperationReceiptError('INVALID_RECEIPT');
  }
  return value;
}

function exactIso(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new AuthoritativeOperationReceiptError('INVALID_RECEIPT');
  }
  return value;
}

function recordDigest(
  record: Omit<AuthorityRecord, 'recordDigest'>,
): string {
  return sha256(canonicalJson(record));
}

function marketplaceKey(input: {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly packageKey: string;
}): string {
  return sha256(canonicalJson({
    tenantId: exact(input.tenantId, 'tenantId'),
    userId: exact(input.userId, 'userId'),
    workspaceId: exact(input.workspaceId, 'workspaceId'),
    packageKey: exact(input.packageKey, 'packageKey'),
  }));
}

function grantKey(input: {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly integration: string;
  readonly grantId: string;
}): string {
  return sha256(canonicalJson({
    tenantId: exact(input.tenantId, 'tenantId'),
    userId: exact(input.userId, 'userId'),
    workspaceId: exact(input.workspaceId, 'workspaceId'),
    integration: exact(input.integration, 'integration'),
    grantId: exact(input.grantId, 'grantId'),
  }));
}

export class EncryptedAuthoritativeOperationReceiptStore
implements MarketplaceCompletedReceiptSink, IntegrationGrantOperationalEvidenceSink {
  constructor(
    private readonly root: string,
    private readonly encryption: RuntimeEncryptionProvider,
  ) {}

  async recordCompleted(receiptInput: MarketplaceInstallOperationReceipt): Promise<void> {
    let receipt: MarketplaceInstallOperationReceipt;
    try {
      receipt = parseMarketplaceInstallOperationReceipt(receiptInput);
      if (
        receipt.status !== 'completed'
        || receipt.installedPackageKey !== receipt.packageKey
        || receipt.provisionedWorkspaceInstanceId !== receipt.scope.workspaceInstanceId
      ) {
        throw new Error('completed install receipt required');
      }
    } catch {
      throw new AuthoritativeOperationReceiptError('INVALID_RECEIPT');
    }
    const key = marketplaceKey({
      tenantId: receipt.scope.tenantId,
      userId: receipt.scope.userId,
      workspaceId: receipt.scope.workspaceInstanceId,
      packageKey: receipt.packageKey,
    });
    await this.write('marketplace', key, receipt);
  }

  async recordConnected(receiptInput: IntegrationGrantOperationReceipt): Promise<void> {
    let receipt: IntegrationGrantOperationReceipt;
    let tenantId: string;
    let userId: string;
    try {
      receipt = parseConnectedIntegrationGrantReceipt(receiptInput);
      tenantId = exact(receiptInput.tenantId ?? '', 'grantReceipt.tenantId');
      userId = exact(receiptInput.userId ?? '', 'grantReceipt.userId');
    } catch {
      throw new AuthoritativeOperationReceiptError('INVALID_RECEIPT');
    }
    const normalizedReceipt = Object.freeze({
      ...receipt,
      tenantId,
      userId,
    });
    const key = grantKey({
      tenantId,
      userId,
      workspaceId: receipt.workspaceInstanceId!,
      integration: receipt.integration!,
      grantId: receipt.grantId!,
    });
    if (await this.exists('grant_revocation', key)) {
      throw new AuthoritativeOperationReceiptError('GRANT_REVOKED');
    }
    await this.write('grant', key, normalizedReceipt);
  }

  async beginRevocation(input: {
    readonly operationId: string;
    readonly scope: IntegrationGrantScope;
    readonly observedAt: string;
  }): Promise<void> {
    let scope: IntegrationGrantScope;
    try {
      scope = parseIntegrationGrantScope(input.scope);
      if (!DIGEST.test(input.operationId)) {
        throw new Error('operation digest required');
      }
      exactIso(input.observedAt);
    } catch {
      throw new AuthoritativeOperationReceiptError('INVALID_RECEIPT');
    }
    const key = grantKey({
      tenantId: scope.tenantId,
      userId: scope.userId,
      workspaceId: scope.workspaceInstanceId,
      integration: scope.integration,
      grantId: scope.grantId,
    });
    await this.write('grant_revocation', key, Object.freeze({
      operationId: input.operationId,
      scope,
      observedAt: input.observedAt,
    }));
  }

  async resolve(
    runtimeInput: BrowserRuntimeSpec,
    packageBindingInput: OperationalPackageBinding,
  ): Promise<OperationalRuntimeEvidenceSnapshot | null> {
    let runtime: BrowserRuntimeSpec;
    let packageBinding: OperationalPackageBinding;
    try {
      const validated = validateRuntimeSpec(runtimeInput);
      if (validated.kind !== 'browser' || !validated.authority.runId) {
        throw new Error('browser authority required');
      }
      runtime = validated;
      packageBinding = validateOperationalPackageBinding(packageBindingInput);
    } catch {
      throw new AuthoritativeOperationReceiptError('INVALID_RECEIPT');
    }
    const marketKey = marketplaceKey({
      tenantId: runtime.authority.tenantId,
      userId: runtime.authority.userId,
      workspaceId: runtime.authority.workspaceId,
      packageKey: packageBinding.packageKey,
    });
    const connectedGrantKey = grantKey({
      tenantId: runtime.authority.tenantId,
      userId: runtime.authority.userId,
      workspaceId: runtime.authority.workspaceId,
      integration: packageBinding.integration,
      grantId: runtime.authority.grantId,
    });
    if (await this.exists('grant_revocation', connectedGrantKey)) return null;
    const [marketRecord, grantRecord] = await Promise.all([
      this.read('marketplace', marketKey),
      this.read('grant', connectedGrantKey),
    ]);
    if (!marketRecord || !grantRecord) return null;
    try {
      authorizeOperationalBrowserRuntime({
        marketplaceReceipt: marketRecord.payload,
        grantReceipt: grantRecord.payload,
        packageBinding,
        runtime,
      });
    } catch {
      return null;
    }
    return Object.freeze({
      marketplaceReceipt: marketRecord.payload,
      grantReceipt: grantRecord.payload,
    });
  }

  private async write(
    kind: AuthorityRecordKind,
    keyDigest: string,
    payload: unknown,
  ): Promise<void> {
    if (!this.encryption.isAvailable()) {
      throw new AuthoritativeOperationReceiptError('ENCRYPTION_UNAVAILABLE');
    }
    const withoutDigest: Omit<AuthorityRecord, 'recordDigest'> = {
      schemaVersion: 1,
      kind,
      keyDigest,
      payload,
    };
    const record: AuthorityRecord = Object.freeze({
      ...withoutDigest,
      recordDigest: recordDigest(withoutDigest),
    });
    const plaintext = Buffer.from(JSON.stringify(record), 'utf8');
    if (plaintext.length > MAX_RECORD_BYTES) {
      throw new AuthoritativeOperationReceiptError('INVALID_RECEIPT');
    }
    let ciphertext: Buffer;
    try {
      ciphertext = this.encryption.encrypt(plaintext);
    } catch {
      throw new AuthoritativeOperationReceiptError('ENCRYPTION_UNAVAILABLE');
    }
    if (
      !Buffer.isBuffer(ciphertext)
      || ciphertext.length === 0
      || ciphertext.equals(plaintext)
    ) {
      throw new AuthoritativeOperationReceiptError('ENCRYPTION_UNAVAILABLE');
    }
    await fs.promises.mkdir(this.root, { recursive: true, mode: 0o700 });
    const file = this.fileFor(kind, keyDigest);
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

  private async read(
    kind: AuthorityRecordKind,
    keyDigest: string,
  ): Promise<AuthorityRecord | null> {
    let encoded: string;
    try {
      encoded = await fs.promises.readFile(this.fileFor(kind, keyDigest), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new AuthoritativeOperationReceiptError('CORRUPT_RECEIPT');
    }
    if (!this.encryption.isAvailable()) {
      throw new AuthoritativeOperationReceiptError('ENCRYPTION_UNAVAILABLE');
    }
    try {
      const plaintext = this.encryption.decrypt(Buffer.from(encoded, 'base64'));
      if (!Buffer.isBuffer(plaintext) || plaintext.length > MAX_RECORD_BYTES) {
        throw new Error('invalid plaintext');
      }
      const parsed = JSON.parse(plaintext.toString('utf8')) as Partial<AuthorityRecord>;
      const exactKeys = ['schemaVersion', 'kind', 'keyDigest', 'payload', 'recordDigest'];
      if (
        !parsed
        || parsed.schemaVersion !== 1
        || parsed.kind !== kind
        || parsed.keyDigest !== keyDigest
        || typeof parsed.recordDigest !== 'string'
        || !DIGEST.test(parsed.recordDigest)
        || Object.keys(parsed).length !== exactKeys.length
        || exactKeys.some((key) => !Object.prototype.hasOwnProperty.call(parsed, key))
      ) {
        throw new Error('invalid record');
      }
      const withoutDigest: Omit<AuthorityRecord, 'recordDigest'> = {
        schemaVersion: 1,
        kind,
        keyDigest,
        payload: parsed.payload,
      };
      if (parsed.recordDigest !== recordDigest(withoutDigest)) {
        throw new Error('digest mismatch');
      }
      return Object.freeze({
        ...withoutDigest,
        recordDigest: parsed.recordDigest,
      });
    } catch {
      throw new AuthoritativeOperationReceiptError('CORRUPT_RECEIPT');
    }
  }

  private async exists(kind: AuthorityRecordKind, keyDigest: string): Promise<boolean> {
    try {
      await fs.promises.access(this.fileFor(kind, keyDigest));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw new AuthoritativeOperationReceiptError('CORRUPT_RECEIPT');
    }
  }

  private fileFor(kind: AuthorityRecordKind, keyDigest: string): string {
    if (!DIGEST.test(keyDigest)) {
      throw new AuthoritativeOperationReceiptError('INVALID_RECEIPT');
    }
    return path.join(this.root, `${kind}-${keyDigest.slice('sha256:'.length)}.evidence`);
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

export class AuthoritativeOperationalEvidencePort implements OperationalRuntimeEvidencePort {
  constructor(
    private readonly receipts: EncryptedAuthoritativeOperationReceiptStore,
    private readonly evidence: EncryptedOperationalEvidenceStore,
  ) {}

  async ensure(input: {
    readonly runtime: BrowserRuntimeSpec;
    readonly packageBinding: OperationalPackageBinding;
  }): Promise<void> {
    const query = createOperationalRuntimeEvidenceQuery(
      input.runtime,
      input.packageBinding,
    );
    const snapshot = await this.receipts.resolve(input.runtime, input.packageBinding);
    if (!snapshot) {
      await this.evidence.remove(query);
      throw new AuthoritativeOperationReceiptError('INVALID_RECEIPT');
    }
    await this.evidence.record({
      runtime: input.runtime,
      packageBinding: input.packageBinding,
      marketplaceReceipt: snapshot.marketplaceReceipt,
      grantReceipt: snapshot.grantReceipt,
    });
  }

  resolve(
    query: OperationalRuntimeEvidenceQuery,
  ): Promise<OperationalRuntimeEvidenceSnapshot | null> {
    return this.evidence.resolve(query);
  }
}
