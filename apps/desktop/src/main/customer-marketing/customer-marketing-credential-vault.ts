import { createHash } from 'node:crypto';
import { safeStorage } from 'electron';
import {
  CUSTOMER_MARKETING_CREDENTIAL_GRANT_PERMISSIONS,
  CUSTOMER_MARKETING_CREDENTIAL_GRANT_TTL_MS,
  CUSTOMER_MARKETING_INTEGRATION_PROVIDERS,
  isCustomerMarketingIntegrationProvider,
  type CustomerMarketingCredentialGrantInput,
  type CustomerMarketingCredentialGrantPermission,
  type CustomerMarketingCredentialGrantSummary,
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

interface CredentialEnvelopeV2 {
  version: 2;
  provider: CustomerMarketingIntegrationProvider;
  workspaceHash: string;
  secret: string;
  grant: CustomerMarketingCredentialGrantSummary;
  updatedAt: string;
}

export interface CustomerMarketingCredentialVaultSnapshot {
  vaultState: CustomerMarketingCredentialVaultState;
  credentials: CustomerMarketingCredentialStatus[];
}

const STORAGE_PREFIX = 'customer_marketing_credential:v1';
const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SECRET_LENGTH = 32_768;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

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

function isExactPlainRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function normalizedPermissions(
  value: unknown,
): CustomerMarketingCredentialGrantPermission[] | null {
  if (!Array.isArray(value)
    || value.length < 1
    || value.length > CUSTOMER_MARKETING_CREDENTIAL_GRANT_PERMISSIONS.length) return null;
  const permissions = value as unknown[];
  if (permissions.some((permission) => (
    typeof permission !== 'string'
    || !(CUSTOMER_MARKETING_CREDENTIAL_GRANT_PERMISSIONS as readonly string[]).includes(permission)
  ))) return null;
  if (new Set(permissions).size !== permissions.length) return null;
  return CUSTOMER_MARKETING_CREDENTIAL_GRANT_PERMISSIONS.filter((permission) => (
    permissions.includes(permission)
  ));
}

function parseGrantInput(
  value: unknown,
  issuedAt: string,
): CustomerMarketingCredentialGrantInput | null {
  if (!isExactPlainRecord(value, ['permissions', 'expiresAt'])) return null;
  const permissions = normalizedPermissions(value.permissions);
  if (!permissions || !validIsoDate(value.expiresAt)) return null;
  const issuedAtMs = Date.parse(issuedAt);
  const expiresAtMs = Date.parse(value.expiresAt);
  if (expiresAtMs <= issuedAtMs
    || expiresAtMs > issuedAtMs + CUSTOMER_MARKETING_CREDENTIAL_GRANT_TTL_MS) return null;
  return { permissions, expiresAt: value.expiresAt };
}

function grantDigest(
  workspace: string,
  provider: CustomerMarketingIntegrationProvider,
  grant: CustomerMarketingCredentialGrantInput,
  issuedAt: string,
): string {
  return createHash('sha256').update(JSON.stringify({
    version: 1,
    workspaceHash: workspace,
    provider,
    permissions: grant.permissions,
    expiresAt: grant.expiresAt,
    issuedAt,
  }), 'utf8').digest('hex');
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
    grantInput: CustomerMarketingCredentialGrantInput,
  ): void {
    const hash = workspaceHash(workspaceId);
    assertProvider(provider);
    assertSecret(secret);
    const updatedAt = this.now().toISOString();
    const grant = parseGrantInput(grantInput, updatedAt);
    if (!grant) throw new Error('Invalid customer marketing credential grant.');
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error('Credential vault encryption is unavailable.');
    }

    const envelope: CredentialEnvelopeV2 = {
      version: 2,
      provider,
      workspaceHash: hash,
      secret,
      grant: {
        ...grant,
        digest: grantDigest(hash, provider, grant, updatedAt),
      },
      updatedAt,
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
    permission: CustomerMarketingCredentialGrantPermission,
  ): string | null {
    if (!(CUSTOMER_MARKETING_CREDENTIAL_GRANT_PERMISSIONS as readonly string[]).includes(permission)) {
      return null;
    }
    const envelope = this.readEnvelope(workspaceId, provider);
    if (!envelope
      || Date.parse(envelope.grant.expiresAt) <= this.now().getTime()
      || !envelope.grant.permissions.includes(permission)) return null;
    return envelope.secret;
  }

  listStatuses(workspaceId: string): CustomerMarketingCredentialVaultSnapshot {
    const hash = workspaceHash(workspaceId);
    const encryptionAvailable = this.encryption.isEncryptionAvailable();
    const nowMs = this.now().getTime();
    const credentials = CUSTOMER_MARKETING_INTEGRATION_PROVIDERS.map((provider) => {
      const stored = this.db.getSetting(this.storageKey(hash, provider));
      if (!stored) return { provider, state: 'disconnected' as const, updatedAt: null, grant: null };
      if (!encryptionAvailable) return { provider, state: 'locked' as const, updatedAt: null, grant: null };
      const envelope = this.decryptEnvelope(stored, hash, provider);
      return envelope
        ? {
            provider,
            state: Date.parse(envelope.grant.expiresAt) <= nowMs
              ? 'expired' as const : 'connected' as const,
            updatedAt: envelope.updatedAt,
            grant: { ...envelope.grant, permissions: [...envelope.grant.permissions] },
          }
        : { provider, state: 'invalid' as const, updatedAt: null, grant: null };
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
  ): CredentialEnvelopeV2 | null {
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
  ): CredentialEnvelopeV2 | null {
    try {
      const decrypted = this.encryption.decryptString(Buffer.from(stored, 'base64'));
      const parsed = JSON.parse(decrypted) as unknown;
      if (
        !isExactPlainRecord(parsed, [
          'version', 'provider', 'workspaceHash', 'secret', 'grant', 'updatedAt',
        ])
        || parsed.version !== 2
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
      const grant = parseStoredGrant(
        parsed.grant,
        expectedWorkspaceHash,
        expectedProvider,
        parsed.updatedAt,
      );
      if (!grant) return null;
      return { ...parsed, grant } as CredentialEnvelopeV2;
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

function parseStoredGrant(
  value: unknown,
  workspace: string,
  provider: CustomerMarketingIntegrationProvider,
  issuedAt: string,
): CustomerMarketingCredentialGrantSummary | null {
  if (!isExactPlainRecord(value, ['permissions', 'expiresAt', 'digest'])) return null;
  const grant = parseGrantInput({ permissions: value.permissions, expiresAt: value.expiresAt }, issuedAt);
  if (!grant
    || typeof value.digest !== 'string'
    || !SHA256_PATTERN.test(value.digest)
    || value.digest !== grantDigest(workspace, provider, grant, issuedAt)) return null;
  return { ...grant, digest: value.digest };
}
