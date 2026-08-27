import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => { throw new Error('not available in unit tests'); },
    decryptString: () => { throw new Error('not available in unit tests'); },
  },
}));

import {
  CUSTOMER_MARKETING_INTEGRATION_PROVIDERS,
  parseCustomerMarketingCredentialRevokeInput,
  type CustomerMarketingCredentialGrantInput,
  type CustomerMarketingIntegrationProvider,
} from '../../shared/customer-marketing-credential-types';
import {
  CustomerMarketingCredentialVault,
  type CustomerMarketingSafeStorage,
} from './customer-marketing-credential-vault';

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';
const SYNTHETIC_TOKEN = 'synthetic-cmr401-token-never-send';
const NOW = '2026-07-26T00:00:00.000Z';
const GRANT_EXPIRES_AT = '2026-10-24T00:00:00.000Z';
const GRANT: CustomerMarketingCredentialGrantInput = {
  permissions: ['validate', 'sandbox_execute'],
  expiresAt: GRANT_EXPIRES_AT,
};

class MemorySettings {
  readonly values = new Map<string, string>();

  getSetting(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setSetting(key: string, value: string): void {
    this.values.set(key, value);
  }

  deleteSetting(key: string): void {
    this.values.delete(key);
  }
}

class FakeSafeStorage implements CustomerMarketingSafeStorage {
  available = true;
  throwOnEncrypt = false;

  isEncryptionAvailable(): boolean {
    return this.available;
  }

  encryptString(value: string): Buffer {
    if (this.throwOnEncrypt) throw new Error(`must not escape: ${value}`);
    return this.transform(Buffer.from(value, 'utf8'));
  }

  decryptString(value: Buffer): string {
    return this.transform(value).toString('utf8');
  }

  private transform(value: Buffer): Buffer {
    return Buffer.from(value.map((byte) => byte ^ 0xa5));
  }
}

function fixture() {
  const db = new MemorySettings();
  const encryption = new FakeSafeStorage();
  let now = NOW;
  const vault = new CustomerMarketingCredentialVault(
    db,
    encryption,
    () => new Date(now),
  );
  return { db, encryption, vault, setNow: (value: string) => { now = value; } };
}

describe('CustomerMarketingCredentialVault', () => {
  it('encrypts at rest under a workspace-hashed, provider-scoped key', () => {
    const { db, vault } = fixture();

    vault.setCredential(WORKSPACE_A, 'facebook', SYNTHETIC_TOKEN, GRANT);

    expect(db.values).toHaveLength(1);
    const [[key, ciphertext]] = Array.from(db.values.entries());
    expect(key).toMatch(/^customer_marketing_credential:v1:[0-9a-f]{64}:facebook$/);
    expect(key).not.toContain(WORKSPACE_A);
    expect(ciphertext).not.toContain(SYNTHETIC_TOKEN);
    expect(JSON.stringify([...db.values.entries()])).not.toContain(SYNTHETIC_TOKEN);
    expect(vault.getCredential(WORKSPACE_A, 'facebook', 'validate')).toBe(SYNTHETIC_TOKEN);
    expect(vault.getCredential(WORKSPACE_A, 'facebook', 'sandbox_execute')).toBe(SYNTHETIC_TOKEN);
  });

  it('returns only renderer-safe status metadata for every allowlisted provider', () => {
    const { vault } = fixture();
    vault.setCredential(WORKSPACE_A, 'telegram', SYNTHETIC_TOKEN, GRANT);

    const snapshot = vault.listStatuses(WORKSPACE_A);

    expect(snapshot.vaultState).toBe('ready');
    expect(snapshot.credentials.map((item) => item.provider)).toEqual(
      CUSTOMER_MARKETING_INTEGRATION_PROVIDERS,
    );
    expect(snapshot.credentials.find((item) => item.provider === 'telegram')).toEqual({
      provider: 'telegram',
      state: 'connected',
      updatedAt: NOW,
      grant: {
        permissions: ['validate', 'sandbox_execute'],
        expiresAt: GRANT_EXPIRES_AT,
        digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain(SYNTHETIC_TOKEN);
  });

  it('does not read a credential through another workspace or provider scope', () => {
    const { vault } = fixture();
    vault.setCredential(WORKSPACE_A, 'youtube', SYNTHETIC_TOKEN, GRANT);

    expect(vault.getCredential(WORKSPACE_B, 'youtube', 'validate')).toBeNull();
    expect(vault.getCredential(WORKSPACE_A, 'google', 'validate')).toBeNull();
  });

  it('enforces provider grant permissions before credential bytes can be read', () => {
    const { vault } = fixture();
    vault.setCredential(WORKSPACE_A, 'x', SYNTHETIC_TOKEN, {
      permissions: ['validate'],
      expiresAt: GRANT_EXPIRES_AT,
    });

    expect(vault.getCredential(WORKSPACE_A, 'x', 'validate')).toBe(SYNTHETIC_TOKEN);
    expect(vault.getCredential(WORKSPACE_A, 'x', 'sandbox_execute')).toBeNull();
  });

  it('fails closed at the exact grant expiry boundary while retaining a redacted summary', () => {
    const { vault, setNow } = fixture();
    vault.setCredential(WORKSPACE_A, 'telegram', SYNTHETIC_TOKEN, GRANT);
    setNow(GRANT_EXPIRES_AT);

    expect(vault.getCredential(WORKSPACE_A, 'telegram', 'validate')).toBeNull();
    expect(vault.listStatuses(WORKSPACE_A).credentials).toEqual(expect.arrayContaining([{
      provider: 'telegram',
      state: 'expired',
      updatedAt: NOW,
      grant: {
        permissions: ['validate', 'sandbox_execute'],
        expiresAt: GRANT_EXPIRES_AT,
        digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    }]));
  });

  it('fails closed without safeStorage and never writes plaintext', () => {
    const { db, encryption, vault } = fixture();
    encryption.available = false;

    expect(() => vault.setCredential(WORKSPACE_A, 'x', SYNTHETIC_TOKEN, GRANT))
      .toThrow('Credential vault encryption is unavailable');
    expect(db.values.size).toBe(0);
    expect(vault.getCredential(WORKSPACE_A, 'x', 'validate')).toBeNull();
  });

  it('reports existing ciphertext as locked and still permits revocation when encryption is unavailable', () => {
    const { db, encryption, vault } = fixture();
    vault.setCredential(WORKSPACE_A, 'email', SYNTHETIC_TOKEN, GRANT);
    encryption.available = false;

    expect(vault.listStatuses(WORKSPACE_A)).toMatchObject({
      vaultState: 'locked',
      credentials: expect.arrayContaining([
        expect.objectContaining({ provider: 'email', state: 'locked', updatedAt: null }),
      ]),
    });
    expect(vault.getCredential(WORKSPACE_A, 'email', 'validate')).toBeNull();
    expect(vault.revokeCredential(WORKSPACE_A, 'email')).toBe(true);
    expect(db.values.size).toBe(0);
    expect(vault.listStatuses(WORKSPACE_A).credentials.find((item) => item.provider === 'email'))
      .toEqual({ provider: 'email', state: 'disconnected', updatedAt: null, grant: null });
    expect(vault.getCredential(WORKSPACE_A, 'email', 'sandbox_execute')).toBeNull();
  });

  it('leaves the previous ciphertext unchanged when encryption fails', () => {
    const { db, encryption, vault } = fixture();
    vault.setCredential(WORKSPACE_A, 'crm', 'synthetic-old-token', GRANT);
    const before = new Map(db.values);
    encryption.throwOnEncrypt = true;

    expect(() => vault.setCredential(WORKSPACE_A, 'crm', SYNTHETIC_TOKEN, GRANT))
      .toThrow('Credential vault encryption failed');
    expect(db.values).toEqual(before);
    expect(vault.getCredential(WORKSPACE_A, 'crm', 'validate')).toBe('synthetic-old-token');
  });

  it('marks corrupted or scope-mismatched ciphertext invalid and returns no raw credential', () => {
    const { db, vault } = fixture();
    vault.setCredential(WORKSPACE_A, 'facebook', SYNTHETIC_TOKEN, GRANT);
    const [[key, ciphertext]] = Array.from(db.values.entries());
    db.values.set(key.replace(/facebook$/, 'instagram'), ciphertext);
    db.values.set(key, 'not-valid-ciphertext');

    expect(vault.getCredential(WORKSPACE_A, 'facebook', 'validate')).toBeNull();
    expect(vault.getCredential(WORKSPACE_A, 'instagram', 'validate')).toBeNull();
    expect(vault.listStatuses(WORKSPACE_A).credentials).toEqual(expect.arrayContaining([
      { provider: 'facebook', state: 'invalid', updatedAt: null, grant: null },
      { provider: 'instagram', state: 'invalid', updatedAt: null, grant: null },
    ]));
  });

  it('fails closed for legacy envelopes and grant metadata that no longer matches its digest', () => {
    const { db, encryption, vault } = fixture();
    vault.setCredential(WORKSPACE_A, 'facebook', SYNTHETIC_TOKEN, GRANT);
    const [[key, ciphertext]] = Array.from(db.values.entries());
    const envelope = JSON.parse(
      encryption.decryptString(Buffer.from(ciphertext, 'base64')).toString('utf8'),
    ) as {
      version: number;
      provider: string;
      workspaceHash: string;
      secret: string;
      updatedAt: string;
      grant: { permissions: string[] };
    };

    envelope.grant.permissions = ['validate'];
    db.values.set(key, encryption.encryptString(JSON.stringify(envelope)).toString('base64'));
    expect(vault.getCredential(WORKSPACE_A, 'facebook', 'validate')).toBeNull();
    expect(vault.listStatuses(WORKSPACE_A).credentials[0]).toMatchObject({
      state: 'invalid',
      grant: null,
    });

    const legacyEnvelope = {
      version: 1,
      provider: envelope.provider,
      workspaceHash: envelope.workspaceHash,
      secret: envelope.secret,
      updatedAt: envelope.updatedAt,
    };
    db.values.set(key, encryption.encryptString(JSON.stringify(legacyEnvelope)).toString('base64'));
    expect(vault.getCredential(WORKSPACE_A, 'facebook', 'validate')).toBeNull();
    expect(vault.listStatuses(WORKSPACE_A).credentials[0]).toMatchObject({
      state: 'invalid',
      grant: null,
    });
  });

  it('rejects invalid workspace, provider, and secret input before persistence', () => {
    const { db, vault } = fixture();

    expect(() => vault.setCredential('renderer-workspace', 'facebook', SYNTHETIC_TOKEN, GRANT))
      .toThrow('Invalid customer marketing workspace');
    expect(() => vault.setCredential(
      WORKSPACE_A,
      'unknown' as CustomerMarketingIntegrationProvider,
      SYNTHETIC_TOKEN,
      GRANT,
    )).toThrow('Invalid customer marketing integration provider');
    expect(() => vault.setCredential(WORKSPACE_A, 'facebook', '   ', GRANT))
      .toThrow('Invalid customer marketing credential');
    expect(db.values.size).toBe(0);
  });

  it('rejects expired, unknown, duplicate, or expanded grant input before persistence', () => {
    const { db, vault } = fixture();
    const invalidGrants = [
      { permissions: ['validate'], expiresAt: NOW },
      { permissions: ['publish'], expiresAt: GRANT_EXPIRES_AT },
      { permissions: ['validate', 'validate'], expiresAt: GRANT_EXPIRES_AT },
      { permissions: ['validate'], expiresAt: GRANT_EXPIRES_AT, workspaceId: WORKSPACE_A },
    ];

    for (const grant of invalidGrants) {
      expect(() => vault.setCredential(
        WORKSPACE_A,
        'facebook',
        SYNTHETIC_TOKEN,
        grant as CustomerMarketingCredentialGrantInput,
      )).toThrow('Invalid customer marketing credential grant');
    }
    expect(db.values.size).toBe(0);
  });

  it('parses only the exact renderer revoke contract', () => {
    expect(parseCustomerMarketingCredentialRevokeInput({ provider: 'youtube' }))
      .toEqual({ provider: 'youtube' });
    expect(parseCustomerMarketingCredentialRevokeInput({ provider: 'unknown' })).toBeNull();
    expect(parseCustomerMarketingCredentialRevokeInput({
      provider: 'youtube',
      token: SYNTHETIC_TOKEN,
    })).toBeNull();
    expect(parseCustomerMarketingCredentialRevokeInput({
      provider: 'youtube',
      workspaceId: WORKSPACE_A,
    })).toBeNull();
  });
});
