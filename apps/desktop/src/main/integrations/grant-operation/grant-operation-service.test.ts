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
import { GrantVault } from '../grant-vault';
import {
  IntegrationGrantOperationService,
  type IntegrationGrantOperationServiceOptions,
} from './grant-operation-service';

const NOW = '2026-07-29T23:30:00.000Z';
const grantId = asId<'IntegrationGrantId'>('grant:calendar') as IntegrationGrantId;
const workspaceInstanceId = asId<'WorkspaceInstanceId'>(
  'workspace:personal-office',
) as WorkspaceInstanceId;
const scope: IntegrationGrantScope = {
  tenantId: 'tenant:izzi',
  userId: 'user:operator',
  workspaceInstanceId,
  grantId,
  integration: 'google-calendar',
  scopes: ['calendar.read', 'calendar.write'],
};
const ref = secretRef(
  'integration_vault',
  'integration/google-calendar/operator',
  scope.scopes,
);
const grant: IntegrationGrant = {
  schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
  id: grantId,
  workspaceInstanceId,
  integration: scope.integration,
  scopes: scope.scopes,
  secret: ref,
  createdAt: NOW,
  updatedAt: NOW,
};

function options(
  overrides: Partial<IntegrationGrantOperationServiceOptions> = {},
): IntegrationGrantOperationServiceOptions {
  return {
    identity: {
      resolveConnectScope: vi.fn().mockResolvedValue(scope),
      resolveExistingScope: vi.fn().mockResolvedValue(scope),
    },
    approvals: {
      request: vi.fn().mockImplementation(async (input) => ({
        approvalId: 'approval:integration-grant',
        state: 'approved',
        bindingDigest: input.bindingDigest,
      })),
    },
    connector: {
      connect: vi.fn().mockResolvedValue({
        status: 'connected',
        secret: ref,
        evidenceDigest: `sha256:${'a'.repeat(64)}`,
      }),
      revoke: vi.fn().mockResolvedValue({
        status: 'revoked',
        evidenceDigest: `sha256:${'b'.repeat(64)}`,
      }),
    },
    credentials: {
      revoke: vi.fn().mockResolvedValue(true),
    },
    repository: {
      get: vi.fn().mockResolvedValue(grant),
      upsert: vi.fn().mockResolvedValue(undefined),
      markRevoked: vi.fn().mockResolvedValue(undefined),
      markInvalid: vi.fn().mockResolvedValue(undefined),
    },
    vault: new GrantVault(
      { canResolve: vi.fn().mockResolvedValue(true) },
      { getScope: vi.fn().mockResolvedValue(scope) },
    ),
    now: () => new Date(NOW),
    ...overrides,
  };
}

describe('IntegrationGrantOperationService', () => {
  it('fails closed before approval when authenticated scope is unavailable', async () => {
    const setup = options({
      identity: {
        resolveConnectScope: vi.fn().mockResolvedValue(null),
        resolveExistingScope: vi.fn().mockResolvedValue(null),
      },
    });
    const result = await new IntegrationGrantOperationService(setup).connect({
      integration: scope.integration,
      scopes: scope.scopes,
      idempotencyKey: 'connect:calendar:1',
    });

    expect(result).toMatchObject({
      status: 'failed',
      code: 'AUTHORITY_UNAVAILABLE',
    });
    expect(setup.approvals.request).not.toHaveBeenCalled();
    expect(setup.connector.connect).not.toHaveBeenCalled();
  });

  it('does not call OAuth or persistence while approval is pending', async () => {
    const setup = options({
      approvals: {
        request: vi.fn().mockImplementation(async (input) => ({
          approvalId: 'approval:pending',
          state: 'pending',
          bindingDigest: input.bindingDigest,
        })),
      },
    });
    const result = await new IntegrationGrantOperationService(setup).connect({
      integration: scope.integration,
      scopes: scope.scopes,
      idempotencyKey: 'connect:calendar:2',
    });

    expect(result).toMatchObject({
      status: 'pending_approval',
      code: 'APPROVAL_PENDING',
      approvalId: 'approval:pending',
    });
    expect(setup.connector.connect).not.toHaveBeenCalled();
    expect(setup.repository.upsert).not.toHaveBeenCalled();
  });

  it('rejects approval binding drift before connector access', async () => {
    const setup = options({
      approvals: {
        request: vi.fn().mockResolvedValue({
          approvalId: 'approval:drifted',
          state: 'approved',
          bindingDigest: `sha256:${'0'.repeat(64)}`,
        }),
      },
    });
    const result = await new IntegrationGrantOperationService(setup).connect({
      integration: scope.integration,
      scopes: scope.scopes,
      idempotencyKey: 'connect:calendar:3',
    });

    expect(result.code).toBe('APPROVAL_BINDING_MISMATCH');
    expect(setup.connector.connect).not.toHaveBeenCalled();
  });

  it('persists only a validated SecretRef after the grant vault resolves it', async () => {
    const setup = options();
    const result = await new IntegrationGrantOperationService(setup).connect({
      integration: scope.integration,
      scopes: ['calendar.write', 'calendar.read', 'calendar.read'],
      idempotencyKey: 'connect:calendar:4',
    });

    expect(result).toMatchObject({
      status: 'connected',
      code: 'CONNECTED',
      integration: scope.integration,
      grantId,
      workspaceInstanceId,
      scopes: scope.scopes,
    });
    expect(result).not.toHaveProperty('secret');
    expect(setup.repository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        secret: ref,
        integration: scope.integration,
        scopes: scope.scopes,
      }),
      scope,
    );
  });

  it('rejects raw connector credentials and never writes them', async () => {
    const setup = options({
      connector: {
        connect: vi.fn().mockResolvedValue({
          status: 'connected',
          secret: 'oauth-access-token-must-not-cross',
        }),
        revoke: vi.fn(),
      },
    });
    const result = await new IntegrationGrantOperationService(setup).connect({
      integration: scope.integration,
      scopes: scope.scopes,
      idempotencyKey: 'connect:calendar:5',
    });

    expect(result.code).toBe('SECRET_REFERENCE_INVALID');
    expect(setup.repository.upsert).not.toHaveBeenCalled();
  });

  it('does not persist a grant whose vault reference is missing', async () => {
    const setup = options({
      vault: new GrantVault(
        { canResolve: vi.fn().mockResolvedValue(false) },
        { getScope: vi.fn().mockResolvedValue(scope) },
      ),
    });
    const result = await new IntegrationGrantOperationService(setup).connect({
      integration: scope.integration,
      scopes: scope.scopes,
      idempotencyKey: 'connect:calendar:6',
    });

    expect(result.code).toBe('VAULT_UNRESOLVABLE');
    expect(setup.repository.upsert).not.toHaveBeenCalled();
  });

  it('redacts malformed evidence and adapter exceptions from public receipts', async () => {
    const setup = options({
      connector: {
        connect: vi.fn().mockResolvedValue({
          status: 'failed',
          evidenceDigest: 'oauth-token-must-not-cross',
        }),
        revoke: vi.fn(),
      },
    });
    const failed = await new IntegrationGrantOperationService(setup).connect({
      integration: scope.integration,
      scopes: scope.scopes,
      idempotencyKey: 'connect:calendar:7',
    });
    expect(failed).toMatchObject({
      status: 'failed',
      code: 'CONNECTOR_FAILED',
    });
    expect(failed).not.toHaveProperty('evidenceDigest');

    const throwing = options({
      identity: {
        resolveConnectScope: vi.fn().mockRejectedValue(
          new Error('account-token-must-not-cross'),
        ),
        resolveExistingScope: vi.fn().mockRejectedValue(
          new Error('account-token-must-not-cross'),
        ),
      },
    });
    await expect(new IntegrationGrantOperationService(throwing).connect({
      integration: scope.integration,
      scopes: scope.scopes,
      idempotencyKey: 'connect:calendar:8',
    })).resolves.toMatchObject({
      status: 'failed',
      code: 'AUTHORITY_UNAVAILABLE',
    });
  });

  it('revokes remote access, vault reference, then grant metadata after approval', async () => {
    const order: string[] = [];
    const setup = options({
      connector: {
        connect: vi.fn(),
        revoke: vi.fn().mockImplementation(async () => {
          order.push('remote');
          return { status: 'revoked' };
        }),
      },
      credentials: {
        revoke: vi.fn().mockImplementation(async () => {
          order.push('vault');
          return true;
        }),
      },
      repository: {
        get: vi.fn().mockResolvedValue(grant),
        upsert: vi.fn(),
        markRevoked: vi.fn().mockImplementation(async () => {
          order.push('metadata');
        }),
        markInvalid: vi.fn(),
      },
    });
    const result = await new IntegrationGrantOperationService(setup).revoke({
      grantId,
      idempotencyKey: 'revoke:calendar:1',
    });

    expect(result).toMatchObject({ status: 'revoked', code: 'REVOKED' });
    expect(order).toEqual(['remote', 'vault', 'metadata']);
  });

  it('stops revocation before vault and metadata when remote disconnect fails', async () => {
    const setup = options({
      connector: {
        connect: vi.fn(),
        revoke: vi.fn().mockResolvedValue({ status: 'failed' }),
      },
    });
    const result = await new IntegrationGrantOperationService(setup).revoke({
      grantId,
      idempotencyKey: 'revoke:calendar:2',
    });

    expect(result.code).toBe('REMOTE_REVOCATION_FAILED');
    expect(setup.credentials.revoke).not.toHaveBeenCalled();
    expect(setup.repository.markRevoked).not.toHaveBeenCalled();
  });

  it('marks the grant invalid when remote revoke succeeds but vault cleanup fails', async () => {
    const setup = options({
      credentials: {
        revoke: vi.fn().mockResolvedValue(false),
      },
    });
    const result = await new IntegrationGrantOperationService(setup).revoke({
      grantId,
      idempotencyKey: 'revoke:calendar:3',
    });

    expect(result.code).toBe('VAULT_REVOCATION_FAILED');
    expect(setup.repository.markInvalid).toHaveBeenCalledWith(grantId, NOW);
    expect(setup.repository.markRevoked).not.toHaveBeenCalled();
  });
});
