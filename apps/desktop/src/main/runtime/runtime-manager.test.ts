import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { asId, secretRef, type SecretRef } from '../../shared/personal-office';
import type { NativeRuntimeSpec } from '../../shared/runtime';
import { NativeProcessAdapter, type NativeProcessRunner } from './native-process-adapter';
import { RuntimeManager, type RuntimeAdapter } from './runtime-manager';
import type {
  RuntimeAuthorizationQuery,
  RuntimeAuthorizationResolver,
} from './runtime-authorizer';

const root = process.platform === 'win32' ? 'C:\\izzi\\workspace' : '/izzi/workspace';
const spec: NativeRuntimeSpec = {
  schemaVersion: 1,
  id: 'runtime.manager.test',
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
  budget: { cpuPercent: 50, memoryMb: 256, diskMb: 512, timeoutMs: 1000 },
  env: [{ name: 'TOKEN', secret: secretRef('os_keychain', 'runtime/test') }],
  executable: process.platform === 'win32' ? 'C:\\izzi\\workspace\\tool.exe' : '/izzi/workspace/tool',
  args: ['hello;literal'],
  executableSha256: `sha256:${'a'.repeat(64)}`,
};

function grantEvidence(query: RuntimeAuthorizationQuery): unknown {
  const scope = {
    tenantId: query.tenantId,
    userId: query.userId,
    workspaceInstanceId: asId<'WorkspaceInstanceId'>(query.workspaceId),
    grantId: asId<'IntegrationGrantId'>(query.grantId),
    integration: query.integrationId,
    scopes: [query.requiredScope],
  };
  return {
    schemaVersion: 1,
    modelVersion: '1.0.0',
    observedAt: query.evaluatedAt,
    state: 'active',
    reasonCode: 'active',
    vaultResolution: 'resolvable',
    scope,
    grant: {
      schemaVersion: 1,
      id: scope.grantId,
      workspaceInstanceId: scope.workspaceInstanceId,
      integration: scope.integration,
      scopes: scope.scopes,
      secret: secretRef('integration_vault', 'runtime/native-test', scope.scopes),
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
  };
}

const trustedAuthorization: RuntimeAuthorizationResolver = {
  isPackageTrusted: () => true,
  resolveGrant: grantEvidence,
};

describe('RuntimeManager', () => {
  it('denies untrusted packages before invoking an adapter', async () => {
    let called = false;
    const adapter: RuntimeAdapter = {
      kind: 'binary',
      start: async () => {
        called = true;
        return { healthy: true };
      },
      stop: async () => undefined,
      health: async () => ({ healthy: true }),
    };
    const manager = new RuntimeManager([adapter], {
      isPackageTrusted: () => false,
      resolveGrant: grantEvidence,
    });
    await expect(manager.start(spec)).rejects.toThrow('Untrusted');
    expect(called).toBe(false);
  });

  it('prevents a runtime id from crossing workspace/package authority', async () => {
    const adapter: RuntimeAdapter = {
      kind: 'binary',
      start: async () => ({ healthy: true }),
      stop: async () => undefined,
      health: async () => ({ healthy: true }),
    };
    const manager = new RuntimeManager([adapter], trustedAuthorization);
    await manager.start(spec);
    await expect(
      manager.start({
        ...spec,
        authority: { ...spec.authority, workspaceId: 'workspace-2' },
      }),
    ).rejects.toThrow('another workspace');
  });

  it('passes an empty host environment and literal argv to native execution', async () => {
    let captured:
      | { args: readonly string[]; env: Readonly<Record<string, string>> }
      | undefined;
    const runner: NativeProcessRunner = {
      start(input) {
        captured = { args: input.args, env: input.env };
        return {
          pid: 123,
          exited: new Promise(() => undefined),
          kill: () => undefined,
        };
      },
    };
    const adapter = new NativeProcessAdapter(
      'binary',
      { verify: async () => true },
      { resolve: async (_ref: SecretRef) => 'resolved-value' },
      runner,
      { realpath: (candidate) => candidate },
    );
    const manager = new RuntimeManager([adapter], trustedAuthorization);
    await expect(manager.start(spec)).resolves.toMatchObject({ lifecycle: 'ready' });
    expect(captured).toEqual({
      args: ['hello;literal'],
      env: { TOKEN: 'resolved-value' },
    });
    expect(captured?.env).not.toHaveProperty('PATH');
  });

  it('stops a runtime without deleting user artifacts', async () => {
    const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'izzi-runtime-owned-'));
    const artifact = path.join(owned, 'deliverable.txt');
    fs.writeFileSync(artifact, 'keep me');
    const localSpec: NativeRuntimeSpec = {
      ...spec,
      id: 'runtime.cleanup.test',
      paths: {
        workDir: owned,
        tempDir: owned,
        uploadDir: owned,
        downloadDir: owned,
        allowedRoots: [owned],
      },
      executable: path.join(owned, 'tool.exe'),
    };
    fs.writeFileSync(localSpec.executable, 'fixture');
    let stopped = false;
    const adapter: RuntimeAdapter = {
      kind: 'binary',
      start: async () => ({ healthy: true }),
      stop: async () => {
        stopped = true;
      },
      health: async () => ({ healthy: true }),
    };
    try {
      const manager = new RuntimeManager([adapter], trustedAuthorization);
      await manager.start(localSpec);
      await manager.stop(localSpec.id);
      expect(stopped).toBe(true);
      expect(fs.readFileSync(artifact, 'utf8')).toBe('keep me');
    } finally {
      fs.rmSync(owned, { recursive: true, force: true });
    }
  });

  it('redacts adapter health and error details before renderer-visible snapshots', async () => {
    const adapter: RuntimeAdapter = {
      kind: 'binary',
      start: async () => ({
        healthy: true,
        detail: 'Authorization: Bearer abcDEF123456ghiJKL Cookie: sid=browser-cookie',
      }),
      stop: async () => undefined,
      health: async () => ({
        healthy: false,
        detail: 'password=hunter2 Set-Cookie: session=secret-session',
      }),
    };
    const manager = new RuntimeManager([adapter], trustedAuthorization);
    const started = await manager.start(spec);
    expect(started.detail).not.toContain('abcDEF123456ghiJKL');
    expect(started.detail).not.toContain('browser-cookie');
    const refreshed = await manager.refresh(spec.id);
    expect(refreshed.detail).not.toContain('hunter2');
    expect(refreshed.detail).not.toContain('secret-session');
  });
});
