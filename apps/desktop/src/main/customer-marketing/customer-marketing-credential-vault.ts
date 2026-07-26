import { createHash } from 'node:crypto';
import { safeStorage } from 'electron';
import {
  CUSTOMER_MARKETING_INTEGRATION_PROVIDERS,
  isCustomerMarketingIntegrationProvider,
  type CustomerMarketingCredentialStatus,
  type CustomerMarketingCredentialVaultState,
  type CustomerMarketingIntegrationProvider,
} from '../../shared/customer-marketing-credential-types';

interface CredentialSettingsStore {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  deleteSetting(key: string): void;
}

export interface CustomerMarketingSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface CredentialEnvelopeV1 {
  version: 1;
  provider: CustomerMarketingIntegrationProvider;
  workspaceHash: string;
  secret: string;
  updatedAt: string;
}

export interface CustomerMarketingCredentialVaultSnapshot {
  vaultState: CustomerMarketingCredentialVaultState;
  credentials: CustomerMarketingCredentialStatus[];
}

const STORAGE_PREFIX = 'customer_marketing_credential:v1';
const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SECRET_LENGTH = 32_768;

function workspaceHash(workspaceId: string): string {
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new Error('Invalid customer marketing workspace.');
  }
  return createHash('sha256').update(workspaceId.toLowerCase(), 'utf8').digest('hex');
}

function assertProvider(value: unknown): asserts value is CustomerMarketingIntegrationProvider {
  if (!isCustomerMarketingIntegrationProvider(value)) {
    throw new Error('Invalid customer marketing integration provider.');
  }
}

function assertSecret(value: string): void {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || value.length > MAX_SECRET_LENGTH
    || value.includes('\0')
  ) {
    throw new Error('Invalid customer marketing credential.');
  }
}

function validIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

export class CustomerMarketingCredentialVault {
  constructor(
    private readonly db: CredentialSettingsStore,
    private readonly encryption: CustomerMarketingSafeStorage = safeStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  setCredential(
    workspaceId: string,
    provider: CustomerMarketingIntegrationProvider,
    secret: string,
  ): void {
    const hash = workspaceHash(workspaceId);
    assertProvider(provider);
    assertSecret(secret);
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error('Credential vault encryption is unavailable.');
    }

    const envelope: CredentialEnvelopeV1 = {
      version: 1,
      provider,
      workspaceHash: hash,
      secret,
      updatedAt: this.now().toISOString(),
    };
    let ciphertext: Buffer;
    try {
      ciphertext = this.encryption.encryptString(JSON.stringify(envelope));
    } catch {
      throw new Error('Credential vault encryption failed.');
    }
    if (!Buffer.isBuffer(ciphertext) || ciphertext.length === 0) {
      throw new Error('Credential vault encryption failed.');
    }
    this.db.setSetting(this.storageKey(hash, provider), ciphertext.toString('base64'));
  }

  getCredential(
    workspaceId: string,
    provider: CustomerMarketingIntegrationProvider,
  ): string | null {
    const envelope = this.readEnvelope(workspaceId, provider);
    return envelope?.secret ?? null;
  }

  listStatuses(workspaceId: string): CustomerMarketingCredentialVaultSnapshot {
    const hash = workspaceHash(workspaceId);
    const encryptionAvailable = this.encryption.isEncryptionAvailable();
    const credentials = CUSTOMER_MARKETING_INTEGRATION_PROVIDERS.map((provider) => {
      const stored = this.db.getSetting(this.storageKey(hash, provider));
      if (!stored) return { provider, state: 'disconnected' as const, updatedAt: null };
      if (!encryptionAvailable) return { provider, state: 'locked' as const, updatedAt: null };
      const envelope = this.decryptEnvelope(stored, hash, provider);
      return envelope
        ? { provider, state: 'connected' as const, updatedAt: envelope.updatedAt }
        : { provider, state: 'invalid' as const, updatedAt: null };
    });
    return {
      vaultState: encryptionAvailable ? 'ready' : 'locked',
      credentials,
    };
  }

  revokeCredential(
    workspaceId: string,
    provider: CustomerMarketingIntegrationProvider,
  ): boolean {
    const hash = workspaceHash(workspaceId);
    assertProvider(provider);
    const key = this.storageKey(hash, provider);
    const existed = this.db.getSetting(key) !== null;
    this.db.deleteSetting(key);
    return existed;
  }

  private readEnvelope(
    workspaceId: string,
    provider: CustomerMarketingIntegrationProvider,
  ): CredentialEnvelopeV1 | null {
    const hash = workspaceHash(workspaceId);
    assertProvider(provider);
    if (!this.encryption.isEncryptionAvailable()) return null;
    const stored = this.db.getSetting(this.storageKey(hash, provider));
    return stored ? this.decryptEnvelope(stored, hash, provider) : null;
  }

  private decryptEnvelope(
    stored: string,
    expectedWorkspaceHash: string,
    expectedProvider: CustomerMarketingIntegrationProvider,
  ): CredentialEnvelopeV1 | null {
    try {
      const decrypted = this.encryption.decryptString(Buffer.from(stored, 'base64'));
      const parsed = JSON.parse(decrypted) as Partial<CredentialEnvelopeV1>;
      if (
        parsed.version !== 1
        || parsed.provider !== expectedProvider
        || parsed.workspaceHash !== expectedWorkspaceHash
        || typeof parsed.secret !== 'string'
        || parsed.secret.trim().length === 0
        || parsed.secret.length > MAX_SECRET_LENGTH
        || parsed.secret.includes('\0')
        || !validIsoDate(parsed.updatedAt)
      ) {
        return null;
      }
      return parsed as CredentialEnvelopeV1;
    } catch {
      return null;
    }
  }

  private storageKey(
    hash: string,
    provider: CustomerMarketingIntegrationProvider,
  ): string {
    return `${STORAGE_PREFIX}:${hash}:${provider}`;
  }
}
