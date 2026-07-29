import { describe, expect, it } from 'vitest';
import { asId, secretRef } from '../../shared/personal-office';
import type { NativeRuntimeSpec } from '../../shared/runtime';
import {
  authorizeRuntimeSpec,
  type RuntimeAuthorizationQuery,
  type RuntimeAuthorizationResolver,
} from './runtime-authorizer';

const root = process.platform === 'win32' ? 'C:\\izzi\\runtime-auth' : '/izzi/runtime-auth';
const spec: NativeRuntimeSpec = {
  schemaVersion: 1,
  id: 'runtime.authorization.test',
  kind: 'binary',
  authority: {
    tenantId: 'tenant-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    packageId: 'package-1',
    integrationId: 'native-test',
    grantId: 'grant-1',
  },
  paths: {
    workDir: root,
    tempDir: root,
    uploadDir: root,
    downloadDir: root,
    allowedRoots: [root],
  },
  network: { mode: 'deny', bindHost: '127.0.0.1', allowedOrigins: [], allowedPorts: [] },
  budget: { cpuPercent: 10, memoryMb: 128, diskMb: 128, timeoutMs: 1000 },
  env: [],
  executable: process.platform === 'win32' ? 'C:\\izzi\\runtime-auth\\tool.exe' : '/izzi/runtime-auth/tool',
  args: [],
  executableSha256: `sha256:${'a'.repeat(64)}`,
};

function evidence(
  query: RuntimeAuthorizationQuery,
  options: { includeGrant?: boolean; expiresAt?: string; revokedAt?: string } = {},
): unknown {
  const scope = {
    tenantId: query.tenantId,
    userId: query.userId,
    workspaceInstanceId: asId<'WorkspaceInstanceId'>(query.workspaceId),
    grantId: asId<'IntegrationGrantId'>(query.grantId),
    integration: query.integrationId,
    scopes: [query.requiredScope],
  };
  const includeGrant = options.includeGrant ?? true;
  return {
    schemaVersion: 1,
    modelVersion: '1.0.0',
    observedAt: query.evaluatedAt,
    state: 'active',
    reasonCode: 'active',
    vaultResolution: 'resolvable',
    scope,
    ...(includeGrant
      ? {
          grant: {
            schemaVersion: 1,
            id: scope.grantId,
            workspaceInstanceId: scope.workspaceInstanceId,
            integration: scope.integration,
            scopes: scope.scopes,
            secret: secretRef('integration_vault', 'runtime/native-test', scope.scopes),
            createdAt: '2026-07-29T00:00:00.000Z',
            updatedAt: '2026-07-29T00:00:00.000Z',
            ...(options.expiresAt ? { expiresAt: options.expiresAt } : {}),
            ...(options.revokedAt ? { revokedAt: options.revokedAt } : {}),
          },
        }
      : {}),
  };
}

function resolver(
  resolveGrant: RuntimeAuthorizationResolver['resolveGrant'],
): RuntimeAuthorizationResolver {
  return {
    isPackageTrusted: () => true,
    resolveGrant,
  };
}

describe('runtime authorizer', () => {
  it('accepts only trusted resolver evidence with a live exact grant', async () => {
    await expect(authorizeRuntimeSpec(
      spec,
      resolver((query) => evidence(query, { expiresAt: '2099-01-01T00:00:00.000Z' })),
      '2026-07-29T00:00:00.000Z',
    )).resolves.toMatchObject({
      query: {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        requiredScope: 'runtime.native_process',
      },
      grant: { state: 'active' },
    });
  });

  it('rejects active-looking caller evidence without its backing grant', async () => {
    await expect(authorizeRuntimeSpec(
      spec,
      resolver((query) => evidence(query, { includeGrant: false })),
      '2026-07-29T00:00:00.000Z',
    )).rejects.toThrow('evidence is invalid');
  });

  it('rejects grants that are expired at the trusted evaluation time', async () => {
    await expect(authorizeRuntimeSpec(
      spec,
      resolver((query) => evidence(query, { expiresAt: '2026-07-29T00:00:00.000Z' })),
      '2026-07-29T00:00:01.000Z',
    )).rejects.toThrow();
  });
});
