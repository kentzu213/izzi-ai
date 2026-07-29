import { describe, expect, it, vi } from 'vitest';
import {
  PERSONAL_OFFICE_SCHEMA_VERSION,
  asId,
  secretRef,
  type IntegrationGrant,
  type IntegrationGrantId,
  type WorkspaceInstanceId,
} from '../../../shared/personal-office';
import type { IntegrationGrantScope } from '../../../shared/integration-grants';
import { GrantVault } from './grant-vault';

const scope: IntegrationGrantScope = {
  tenantId: 'tenant:izzi',
  userId: 'user:operator',
  workspaceInstanceId: asId<'WorkspaceInstanceId'>(
    'workspace:personal-office',
  ) as WorkspaceInstanceId,
  grantId: asId<'IntegrationGrantId'>('grant:telegram') as IntegrationGrantId,
  integration: 'telegram',
  scopes: ['messages.send'],
};
const ref = secretRef(
  'integration_vault',
  'integration/telegram/operator',
  scope.scopes,
);
const grant: IntegrationGrant = {
  schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
  id: scope.grantId,
  workspaceInstanceId: scope.workspaceInstanceId,
  integration: scope.integration,
  scopes: scope.scopes,
  secret: ref,
  createdAt: '2026-07-29T10:00:00.000Z',
  updatedAt: '2026-07-29T11:00:00.000Z',
};

describe('GrantVault', () => {
  it('returns resolvability only and passes the exact scope to the injected resolver', async () => {
    const canResolve = vi.fn().mockResolvedValue(true);
    const getScope = vi.fn().mockResolvedValue(scope);
    const vault = new GrantVault({ canResolve }, { getScope });

    await expect(vault.check(grant, scope)).resolves.toBe('resolvable');
    expect(canResolve).toHaveBeenCalledWith(ref, scope);
    expect(getScope).toHaveBeenCalledWith(grant.id);
  });

  it('maps missing and unavailable without leaking resolver errors or values', async () => {
    await expect(new GrantVault({
      canResolve: vi.fn().mockResolvedValue(false),
    }, {
      getScope: vi.fn().mockResolvedValue(scope),
    }).check(grant, scope)).resolves.toBe('missing');
    await expect(new GrantVault({
      canResolve: vi.fn().mockRejectedValue(new Error('credential-value-must-not-escape')),
    }, {
      getScope: vi.fn().mockResolvedValue(scope),
    }).check(grant, scope)).resolves.toBe('unavailable');
    await expect(new GrantVault({
      canResolve: vi.fn().mockResolvedValue(true),
    }, {
      getScope: vi.fn().mockRejectedValue(new Error('authority-unavailable')),
    }).check(grant, scope)).resolves.toBe('unavailable');
  });

  it('rejects wildcard or relabeled scope before invoking the resolver', async () => {
    const canResolve = vi.fn().mockResolvedValue(true);
    const vault = new GrantVault(
      { canResolve },
      { getScope: vi.fn().mockResolvedValue(scope) },
    );
    await expect(vault.check(grant, {
      ...scope,
      tenantId: '*',
    })).rejects.toThrow(/non-wildcard/);
    await expect(vault.check(grant, {
      ...scope,
      userId: 'user:other',
    })).rejects.toThrow(/trusted tenant\/user\/workspace grant scope/);
    expect(canResolve).not.toHaveBeenCalled();
  });
});
