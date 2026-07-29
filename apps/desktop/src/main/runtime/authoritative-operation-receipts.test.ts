import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  asId,
  secretRef,
  type IntegrationGrantId,
  type WorkspaceInstanceId,
} from '../../shared/personal-office';
import type { IntegrationGrantScope } from '../../shared/integration-grants';
import type { BrowserRuntimeSpec } from '../../shared/runtime';
import type { RuntimeEncryptionProvider } from './encrypted-state-store';
import {
  AuthoritativeOperationReceiptError,
  AuthoritativeOperationalEvidencePort,
  EncryptedAuthoritativeOperationReceiptStore,
} from './authoritative-operation-receipts';
import {
  createOperationalRuntimeEvidenceQuery,
} from './operational-browser-service';
import { EncryptedOperationalEvidenceStore } from './operational-evidence-store';
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
    return Buffer.from([...value].map((byte) => byte ^ 0x53));
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
const grantId = asId<'IntegrationGrantId'>('grant:calendar') as IntegrationGrantId;
const workspaceId = asId<'WorkspaceInstanceId'>(
  'workspace:personal-office',
) as WorkspaceInstanceId;
const runtime: BrowserRuntimeSpec = {
  schemaVersion: 1,
  id: 'runtime.browser.marketing',
  kind: 'browser',
  authority: {
    tenantId: 'tenant:izzi',
    userId: 'user:operator',
    workspaceId,
    packageId: packageBinding.packageId,
    integrationId: packageBinding.integration,
    grantId,
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
} as const;
const grantReceipt = {
  operationId: `sha256:${'a'.repeat(64)}`,
  status: 'connected',
  code: 'CONNECTED',
  observedAt: '2026-07-29T10:02:00.000Z',
  tenantId: runtime.authority.tenantId,
  userId: runtime.authority.userId,
  integration: packageBinding.integration,
  grantId,
  workspaceInstanceId: workspaceId,
  scopes: packageBinding.requiredScopes,
  approvalId: 'approval:grant',
} as const;
const scope: IntegrationGrantScope = {
  tenantId: runtime.authority.tenantId,
  userId: runtime.authority.userId,
  workspaceInstanceId: workspaceId,
  grantId,
  integration: packageBinding.integration,
  scopes: packageBinding.requiredScopes,
};

function harness(encryption: RuntimeEncryptionProvider = new TestEncryption()) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'izzi-authoritative-receipts-'));
  roots.push(root);
  const receiptRoot = path.join(root, 'receipts');
  const evidenceRoot = path.join(root, 'evidence');
  const receipts = new EncryptedAuthoritativeOperationReceiptStore(
    receiptRoot,
    encryption,
  );
  const evidence = new EncryptedOperationalEvidenceStore(evidenceRoot, encryption);
  return {
    root,
    receiptRoot,
    evidence,
    receipts,
    authority: new AuthoritativeOperationalEvidencePort(receipts, evidence),
  };
}

describe('authoritative operation receipt lifecycle', () => {
  it('joins encrypted authoritative outputs and denies stale evidence after revocation', async () => {
    const test = harness();
    await test.receipts.recordCompleted(marketplaceReceipt);
    await test.receipts.recordConnected(grantReceipt);
    await test.authority.ensure({ runtime, packageBinding });

    const query = createOperationalRuntimeEvidenceQuery(runtime, packageBinding);
    await expect(test.authority.resolve(query)).resolves.toEqual({
      marketplaceReceipt: expect.objectContaining({
        operationId: marketplaceReceipt.operationId,
      }),
      grantReceipt: expect.objectContaining({
        operationId: grantReceipt.operationId,
      }),
    });

    const ciphertext = fs.readdirSync(test.receiptRoot)
      .map((file) => fs.readFileSync(path.join(test.receiptRoot, file), 'utf8'))
      .join('');
    expect(ciphertext).not.toContain(runtime.authority.tenantId);
    expect(ciphertext).not.toContain(runtime.authority.userId);
    expect(ciphertext).not.toContain(grantId);
    expect(fs.readdirSync(test.receiptRoot).every(
      (file) => !file.includes('calendar') && !file.includes('workspace'),
    )).toBe(true);

    await test.receipts.beginRevocation({
      operationId: `sha256:${'b'.repeat(64)}`,
      scope: {
        ...scope,
        scopes: ['calendar.admin'],
      },
      observedAt: '2026-07-29T10:03:00.000Z',
    });

    const restartedReceipts = new EncryptedAuthoritativeOperationReceiptStore(
      test.receiptRoot,
      new TestEncryption(),
    );
    const restartedAuthority = new AuthoritativeOperationalEvidencePort(
      restartedReceipts,
      test.evidence,
    );
    await expect(restartedAuthority.ensure({ runtime, packageBinding }))
      .rejects.toEqual(new AuthoritativeOperationReceiptError('INVALID_RECEIPT'));
    await expect(test.evidence.resolve(query)).resolves.toBeNull();
    await expect(restartedReceipts.recordConnected(grantReceipt))
      .rejects.toEqual(new AuthoritativeOperationReceiptError('GRANT_REVOKED'));
  });

  it('requires exact tenant and user binding on connected grant receipts', async () => {
    const test = harness();
    await test.receipts.recordCompleted(marketplaceReceipt);
    await test.receipts.recordConnected({
      ...grantReceipt,
      userId: 'user:other-operator',
    });

    await expect(test.authority.ensure({ runtime, packageBinding }))
      .rejects.toEqual(new AuthoritativeOperationReceiptError('INVALID_RECEIPT'));

    await test.receipts.recordConnected(grantReceipt);
    await expect(test.authority.ensure({ runtime, packageBinding }))
      .resolves.toBeUndefined();
  });

  it('rejects unavailable or plaintext encryption before persisting authority', async () => {
    const unavailable = harness(new TestEncryption(false));
    await expect(unavailable.receipts.recordCompleted(marketplaceReceipt))
      .rejects.toEqual(
        new AuthoritativeOperationReceiptError('ENCRYPTION_UNAVAILABLE'),
      );
    expect(fs.existsSync(unavailable.receiptRoot)).toBe(false);

    const noop = harness(new NoopEncryption());
    await expect(noop.receipts.recordConnected(grantReceipt))
      .rejects.toEqual(
        new AuthoritativeOperationReceiptError('ENCRYPTION_UNAVAILABLE'),
      );
    expect(fs.existsSync(noop.receiptRoot)).toBe(false);
  });
});
