import { describe, expect, it } from 'vitest';
import type { RuntimeHealthSnapshot } from '../../shared/runtime';
import { filterAuthorizedRuntimeHealth } from './runtime-health-authorization';

const health: RuntimeHealthSnapshot = {
  schemaVersion: 1,
  runtimeId: 'runtime.health.test',
  kind: 'browser',
  tenantId: 'tenant-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  packageId: 'package-1',
  lifecycle: 'ready',
  healthy: true,
  updatedAt: '2026-07-29T00:00:00.000Z',
};

describe('runtime health IPC authorization', () => {
  it('requires an exact tenant/user/workspace scope instead of workspace alone', () => {
    expect(filterAuthorizedRuntimeHealth([health], [{
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    }])).toEqual([health]);
    expect(filterAuthorizedRuntimeHealth([health], [{
      tenantId: 'tenant-forged',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    }])).toEqual([]);
    expect(filterAuthorizedRuntimeHealth([health], [{
      tenantId: 'tenant-1',
      userId: 'user-forged',
      workspaceId: 'workspace-1',
    }])).toEqual([]);
  });

  it('returns nothing when signed-out authority supplies no scopes', () => {
    expect(filterAuthorizedRuntimeHealth([health], [])).toEqual([]);
  });
});
