import { describe, expect, it } from 'vitest';
import {
  CustomerMarketingConnectorVaultAdapter,
  type CustomerMarketingConnectorCredentialSource,
} from './customer-marketing-connector-vault-adapter';
import type {
  CustomerMarketingCredentialGrantPermission,
} from '../../shared/customer-marketing-credential-types';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SECRET = 'synthetic-telegram-secret-never-export';

class FakeVault implements CustomerMarketingConnectorCredentialSource {
  secret: string | null = SECRET;
  status: 'connected' | 'disconnected' | 'expired' | 'locked' | 'invalid' = 'connected';
  permissions: CustomerMarketingCredentialGrantPermission[] = ['validate', 'sandbox_execute'];
  requestedPermissions: CustomerMarketingCredentialGrantPermission[] = [];

  getCredential(
    workspaceId: string,
    provider: 'telegram',
    permission: CustomerMarketingCredentialGrantPermission,
  ): string | null {
    this.requestedPermissions.push(permission);
    return workspaceId === WORKSPACE_ID
      && provider === 'telegram'
      && this.permissions.includes(permission) ? this.secret : null;
  }

  listStatuses(workspaceId: string) {
    return {
      vaultState: 'ready' as const,
      credentials: [{
        provider: 'telegram' as const,
        state: this.status,
        updatedAt: null,
        grant: this.status === 'connected' ? {
          permissions: this.permissions,
          expiresAt: '2026-10-24T00:00:00.000Z',
          digest: 'a'.repeat(64),
        } : null,
      }],
      workspaceId,
    };
  }
}

describe('CustomerMarketingConnectorVaultAdapter', () => {
  it('health reports vault status without exposing credential material', async () => {
    const vault = new FakeVault();
    const adapter = new CustomerMarketingConnectorVaultAdapter(vault, WORKSPACE_ID, 'telegram');
    const result = await adapter.health();

    expect(result).toMatchObject({ ok: true, status: 'ready', provider: 'telegram' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('validate reads the secret only inside the main-process callback', async () => {
    const vault = new FakeVault();
    let callbackSecret: string | null = null;
    const adapter = new CustomerMarketingConnectorVaultAdapter(vault, WORKSPACE_ID, 'telegram');
    const result = await adapter.validate((secret) => {
      callbackSecret = secret;
      return { valid: secret === SECRET, detail: 'sandbox credential accepted' };
    });

    expect(callbackSecret).toBe(SECRET);
    expect(vault.requestedPermissions).toEqual(['validate']);
    expect(result).toMatchObject({ ok: true, status: 'valid' });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('executes an async provider operation inside the credential boundary and returns only a boolean', async () => {
    const vault = new FakeVault();
    const adapter = new CustomerMarketingConnectorVaultAdapter(vault, WORKSPACE_ID, 'telegram');
    let callbackSecret: string | null = null;

    const result = await adapter.executeWithCredential(async (secret) => {
      callbackSecret = secret;
      return { ok: true, secret };
    });

    expect(callbackSecret).toBe(SECRET);
    expect(vault.requestedPermissions).toEqual(['sandbox_execute']);
    expect(result).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('does not execute a provider operation after credential revocation', async () => {
    const vault = new FakeVault();
    vault.status = 'disconnected';
    const adapter = new CustomerMarketingConnectorVaultAdapter(vault, WORKSPACE_ID, 'telegram');
    let called = false;

    const result = await adapter.executeWithCredential(async () => {
      called = true;
      return { ok: true };
    });

    expect(result).toBe(false);
    expect(called).toBe(false);
  });

  it('does not expose credential bytes when the grant omits sandbox execution', async () => {
    const vault = new FakeVault();
    vault.permissions = ['validate'];
    const adapter = new CustomerMarketingConnectorVaultAdapter(vault, WORKSPACE_ID, 'telegram');
    let called = false;

    expect(await adapter.executeWithCredential(async () => {
      called = true;
      return { ok: true };
    })).toBe(false);
    expect(called).toBe(false);
    expect(vault.requestedPermissions).toEqual(['sandbox_execute']);
  });

  it('fails closed when an async credential validator returns malformed output', async () => {
    const vault = new FakeVault();
    const adapter = new CustomerMarketingConnectorVaultAdapter(vault, WORKSPACE_ID, 'telegram');

    await expect(adapter.validate(async () => undefined as never)).resolves.toMatchObject({
      ok: false,
      status: 'invalid',
      detail: 'credential-invalid',
    });
  });

  it('fails closed when vault is locked, disconnected or invalid', async () => {
    const vault = new FakeVault();
    const adapter = new CustomerMarketingConnectorVaultAdapter(vault, WORKSPACE_ID, 'telegram');

    for (const status of ['locked', 'disconnected', 'expired', 'invalid'] as const) {
      vault.status = status;
      expect((await adapter.health()).status).toBe('unavailable');
      expect((await adapter.validate(() => ({ valid: true, detail: 'must not run' }))).status).toBe('forbidden');
    }
  });

  it('rejects workspace mismatch before reading credential', async () => {
    const vault = new FakeVault();
    const adapter = new CustomerMarketingConnectorVaultAdapter(vault, '22222222-2222-4222-8222-222222222222', 'telegram');
    let called = false;
    const result = await adapter.validate(() => {
      called = true;
      return { valid: true, detail: 'must not run' };
    });

    expect(called).toBe(false);
    expect(result.status).toBe('forbidden');
  });
});
