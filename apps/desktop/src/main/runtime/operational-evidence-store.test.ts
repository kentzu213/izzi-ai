import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { secretRef } from '../../shared/personal-office';
import type { BrowserRuntimeSpec } from '../../shared/runtime';
import type { RuntimeEncryptionProvider } from './encrypted-state-store';
import {
  createOperationalRuntimeEvidenceQuery,
} from './operational-browser-service';
import {
  EncryptedOperationalEvidenceStore,
  OperationalEvidenceStoreError,
} from './operational-evidence-store';
import { validateOperationalPackageBinding } from './operational-runtime-gate';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

class TestEncryption implements RuntimeEncryptionProvider {
  constructor(private readonly available = true) {}
  isAvailable() {
    return this.available;
  }
  encrypt(value: Buffer) {
    return Buffer.from([...value].map((byte) => byte ^ 0x6d));
  }
  decrypt(value: Buffer) {
    return this.encrypt(value);
  }
}

class NoopEncryption implements RuntimeEncryptionProvider {
  isAvailable() {
    return true;
  }
  encrypt(value: Buffer) {
    return Buffer.from(value);
  }
  decrypt(value: Buffer) {
    return Buffer.from(value);
  }
}

const packageBinding = validateOperationalPackageBinding({
  packageKey: 'agent_bundle:marketing@1.0.0',
  packageId: 'skill-package:marketing',
  integration: 'google-calendar',
  requiredScopes: ['calendar.read', 'calendar.write'],
});
const runtime: BrowserRuntimeSpec = {
  schemaVersion: 1,
  id: 'runtime.browser.marketing',
  kind: 'browser',
  authority: {
    tenantId: 'tenant:izzi',
    userId: 'user:operator',
    workspaceId: 'workspace:personal-office',
    packageId: packageBinding.packageId,
    integrationId: packageBinding.integration,
    grantId: 'grant:calendar',
    runId: 'run:marketing',
  },
  paths: {
    workDir: 'C:\\izzi\\work',
    tempDir: 'C:\\izzi\\temp',
    uploadDir: 'C:\\izzi\\upload',
    downloadDir: 'C:\\izzi\\download',
    allowedRoots: ['C:\\izzi'],
  },
  network: {
    mode: 'allowlist',
    bindHost: '127.0.0.1',
    allowedOrigins: ['https://calendar.google.com'],
    allowedPorts: [443],
  },
  budget: { cpuPercent: 25, memoryMb: 512, diskMb: 512, timeoutMs: 60_000 },
  env: [],
  visibleReviewMode: true,
  storageStateRef: secretRef('encrypted_file', 'browser/calendar/operator'),
};
const marketplaceReceipt = {
  schemaVersion: 1,
  operationVersion: '1.0.0',
  operationId: 'marketplace-install-operation:marketing',
  planId: 'marketplace-install-plan:marketing',
  packageKey: packageBinding.packageKey,
  scope: {
    tenantId: runtime.authority.tenantId,
    userId: runtime.authority.userId,
    workspaceInstanceId: runtime.authority.workspaceId,
  },
  status: 'completed',
  stages: [
    ['plan_revalidation', 'passed'],
    ['package_verification', 'passed'],
    ['work_approval', 'passed'],
    ['grant_resolution', 'passed'],
    ['workspace_provisioning', 'passed'],
    ['package_installation', 'passed'],
    ['operational_evidence', 'passed'],
  ].map(([stage, outcome]) => ({
    stage,
    outcome,
    code: `${stage}:ok`,
    ...(stage === 'work_approval' ? { referenceId: 'approval:marketplace' } : {}),
  })),
  approvalId: 'approval:marketplace',
  provisionedWorkspaceInstanceId: runtime.authority.workspaceId,
  installedPackageKey: packageBinding.packageKey,
  startedAt: '2026-07-29T10:00:00.000Z',
  updatedAt: '2026-07-29T10:01:00.000Z',
};
const grantReceipt = {
  operationId: `sha256:${'a'.repeat(64)}`,
  status: 'connected',
  code: 'CONNECTED',
  observedAt: '2026-07-29T10:02:00.000Z',
  integration: packageBinding.integration,
  grantId: runtime.authority.grantId,
  workspaceInstanceId: runtime.authority.workspaceId,
  scopes: packageBinding.requiredScopes,
  approvalId: 'approval:grant',
};

function harness(encryption = new TestEncryption()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'izzi-operational-evidence-'));
  roots.push(root);
  return {
    root,
    store: new EncryptedOperationalEvidenceStore(root, encryption),
  };
}

describe('EncryptedOperationalEvidenceStore', () => {
  it('persists only encrypted validated evidence and resolves it after restart', async () => {
    const test = harness();
    const authorization = await test.store.record({
      runtime,
      packageBinding,
      marketplaceReceipt,
      grantReceipt,
    });
    const files = fs.readdirSync(test.root);
    expect(files).toHaveLength(1);
    const raw = fs.readFileSync(path.join(test.root, files[0]!), 'utf8');
    expect(raw).not.toContain(runtime.authority.tenantId);
    expect(raw).not.toContain('approval:grant');

    const restarted = new EncryptedOperationalEvidenceStore(
      test.root,
      new TestEncryption(),
    );
    const query = createOperationalRuntimeEvidenceQuery(runtime, packageBinding);
    await expect(restarted.resolve(query)).resolves.toEqual({
      marketplaceReceipt: expect.objectContaining({
        operationId: marketplaceReceipt.operationId,
      }),
      grantReceipt: expect.objectContaining({
        operationId: grantReceipt.operationId,
      }),
    });
    expect(authorization.runId).toBe(runtime.authority.runId);
  });

  it('returns no evidence for another exact authority scope', async () => {
    const test = harness();
    await test.store.record({
      runtime,
      packageBinding,
      marketplaceReceipt,
      grantReceipt,
    });
    await expect(test.store.resolve({
      ...createOperationalRuntimeEvidenceQuery(runtime, packageBinding),
      runId: 'run:other',
    })).resolves.toBeNull();

    await expect(test.store.resolve(
      createOperationalRuntimeEvidenceQuery({
        ...runtime,
        budget: { ...runtime.budget, timeoutMs: 120_000 },
      }, packageBinding),
    )).resolves.toBeNull();
  });

  it('removes exact evidence before a later authorization revalidation', async () => {
    const test = harness();
    await test.store.record({
      runtime,
      packageBinding,
      marketplaceReceipt,
      grantReceipt,
    });
    const query = createOperationalRuntimeEvidenceQuery(runtime, packageBinding);

    await test.store.remove(query);

    await expect(test.store.resolve(query)).resolves.toBeNull();
    await expect(test.store.remove(query)).resolves.toBeUndefined();
  });

  it('fails closed for ciphertext corruption and unavailable encryption', async () => {
    const test = harness();
    await test.store.record({
      runtime,
      packageBinding,
      marketplaceReceipt,
      grantReceipt,
    });
    const file = path.join(test.root, fs.readdirSync(test.root)[0]!);
    fs.writeFileSync(file, 'not-valid-base64', 'utf8');
    await expect(test.store.resolve(
      createOperationalRuntimeEvidenceQuery(runtime, packageBinding),
    )).rejects.toEqual(new OperationalEvidenceStoreError('CORRUPT_EVIDENCE'));

    const locked = harness(new TestEncryption(false));
    await expect(locked.store.record({
      runtime,
      packageBinding,
      marketplaceReceipt,
      grantReceipt,
    })).rejects.toEqual(new OperationalEvidenceStoreError('ENCRYPTION_UNAVAILABLE'));
    expect(fs.readdirSync(locked.root)).toHaveLength(0);

    const noop = harness(new NoopEncryption());
    await expect(noop.store.record({
      runtime,
      packageBinding,
      marketplaceReceipt,
      grantReceipt,
    })).rejects.toEqual(new OperationalEvidenceStoreError('ENCRYPTION_UNAVAILABLE'));
    expect(fs.readdirSync(noop.root)).toHaveLength(0);
  });

  it('rejects excess grant scope before any evidence is written', async () => {
    const test = harness();
    await expect(test.store.record({
      runtime,
      packageBinding,
      marketplaceReceipt,
      grantReceipt: {
        ...grantReceipt,
        scopes: [...grantReceipt.scopes, 'calendar.admin'],
      },
    })).rejects.toEqual(new OperationalEvidenceStoreError('INVALID_EVIDENCE'));
    expect(fs.readdirSync(test.root)).toHaveLength(0);
  });
});
