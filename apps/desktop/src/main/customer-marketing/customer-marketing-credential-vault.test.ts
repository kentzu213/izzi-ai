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
  type CustomerMarketingIntegrationProvider,
} from '../../shared/customer-marketing-credential-types';
import {
  CustomerMarketingCredentialVault,
  type CustomerMarketingSafeStorage,
} from './customer-marketing-credential-vault';

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';
const SYNTHETIC_TOKEN = 'synthetic-cmr401-token-never-send';

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
  const vault = new CustomerMarketingCredentialVault(
    db,
    encryption,
    () => new Date('2026-07-26T00:00:00.000Z'),
  );
  return { db, encryption, vault };
}

describe('CustomerMarketingCredentialVault', () => {
  it('encrypts at rest under a workspace-hashed, provider-scoped key', () => {
    const { db, vault } = fixture();

    vault.setCredential(WORKSPACE_A, 'facebook', SYNTHETIC_TOKEN);

    expect(db.values).toHaveLength(1);
    const [[key, ciphertext]] = Array.from(db.values.entries());
    expect(key).toMatch(/^customer_marketing_credential:v1:[0-9a-f]{64}:facebook$/);
    expect(key).not.toContain(WORKSPACE_A);
    expect(ciphertext).not.toContain(SYNTHETIC_TOKEN);
    expect(JSON.stringify([...db.values.entries()])).not.toContain(SYNTHETIC_TOKEN);
    expect(vault.getCredential(WORKSPACE_A, 'facebook')).toBe(SYNTHETIC_TOKEN);
  });

  it('returns only renderer-safe status metadata for every allowlisted provider', () => {
    const { vault } = fixture();
    vault.setCredential(WORKSPACE_A, 'telegram', SYNTHETIC_TOKEN);

    const snapshot = vault.listStatuses(WORKSPACE_A);

    expect(snapshot.vaultState).toBe('ready');
    expect(snapshot.credentials.map((item) => item.provider)).toEqual(
      CUSTOMER_MARKETING_INTEGRATION_PROVIDERS,
    );
    expect(snapshot.credentials.find((item) => item.provider === 'telegram')).toEqual({
      provider: 'telegram',
      state: 'connected',
      updatedAt: '2026-07-26T00:00:00.000Z',
    });
    expect(JSON.stringify(snapshot)).not.toContain(SYNTHETIC_TOKEN);
  });

  it('does not read a credential through another workspace or provider scope', () => {
    const { vault } = fixture();
    vault.setCredential(WORKSPACE_A, 'youtube', SYNTHETIC_TOKEN);

    expect(vault.getCredential(WORKSPACE_B, 'youtube')).toBeNull();
    expect(vault.getCredential(WORKSPACE_A, 'google')).toBeNull();
  });

  it('fails closed without safeStorage and never writes plaintext', () => {
    const { db, encryption, vault } = fixture();
    encryption.available = false;

    expect(() => vault.setCredential(WORKSPACE_A, 'x', SYNTHETIC_TOKEN))
      .toThrow('Credential vault encryption is unavailable');
    expect(db.values.size).toBe(0);
    expect(vault.getCredential(WORKSPACE_A, 'x')).toBeNull();
  });

  it('reports existing ciphertext as locked and still permits revocation when encryption is unavailable', () => {
    const { db, encryption, vault } = fixture();
    vault.setCredential(WORKSPACE_A, 'email', SYNTHETIC_TOKEN);
    encryption.available = false;

    expect(vault.listStatuses(WORKSPACE_A)).toMatchObject({
      vaultState: 'locked',
      credentials: expect.arrayContaining([
        { provider: 'email', state: 'locked', updatedAt: null },
      ]),
    });
    expect(vault.getCredential(WORKSPACE_A, 'email')).toBeNull();
    expect(vault.revokeCredential(WORKSPACE_A, 'email')).toBe(true);
    expect(db.values.size).toBe(0);
  });

  it('leaves the previous ciphertext unchanged when encryption fails', () => {
    const { db, encryption, vault } = fixture();
    vault.setCredential(WORKSPACE_A, 'crm', 'synthetic-old-token');
    const before = new Map(db.values);
    encryption.throwOnEncrypt = true;

    expect(() => vault.setCredential(WORKSPACE_A, 'crm', SYNTHETIC_TOKEN))
      .toThrow('Credential vault encryption failed');
    expect(db.values).toEqual(before);
    expect(vault.getCredential(WORKSPACE_A, 'crm')).toBe('synthetic-old-token');
  });

  it('marks corrupted or scope-mismatched ciphertext invalid and returns no raw credential', () => {
    const { db, vault } = fixture();
    vault.setCredential(WORKSPACE_A, 'facebook', SYNTHETIC_TOKEN);
    const [[key, ciphertext]] = Array.from(db.values.entries());
    db.values.set(key.replace(/facebook$/, 'instagram'), ciphertext);
    db.values.set(key, 'not-valid-ciphertext');

    expect(vault.getCredential(WORKSPACE_A, 'facebook')).toBeNull();
    expect(vault.getCredential(WORKSPACE_A, 'instagram')).toBeNull();
    expect(vault.listStatuses(WORKSPACE_A).credentials).toEqual(expect.arrayContaining([
      { provider: 'facebook', state: 'invalid', updatedAt: null },
      { provider: 'instagram', state: 'invalid', updatedAt: null },
    ]));
  });

  it('rejects invalid workspace, provider, and secret input before persistence', () => {
    const { db, vault } = fixture();

    expect(() => vault.setCredential('renderer-workspace', 'facebook', SYNTHETIC_TOKEN))
      .toThrow('Invalid customer marketing workspace');
    expect(() => vault.setCredential(
      WORKSPACE_A,
      'unknown' as CustomerMarketingIntegrationProvider,
      SYNTHETIC_TOKEN,
    )).toThrow('Invalid customer marketing integration provider');
    expect(() => vault.setCredential(WORKSPACE_A, 'facebook', '   '))
      .toThrow('Invalid customer marketing credential');
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
