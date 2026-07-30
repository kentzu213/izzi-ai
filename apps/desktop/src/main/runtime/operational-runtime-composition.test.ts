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
import type { MarketplaceInstallOperationReceipt } from '../../shared/marketplace';
import type { BrowserRuntimeSpec } from '../../shared/runtime';
import type { RuntimeEncryptionProvider } from './encrypted-state-store';
import {
  createOperationalRuntimeEvidenceQuery,
} from './operational-browser-service';
import type { OperationalPackageBinding } from './operational-runtime-gate';
import { createOfflineOperationalRuntimeComposition } from './operational-runtime-composition';

class TestEncryption implements RuntimeEncryptionProvider {
  constructor(private readonly available = true) {}

  isAvailable(): boolean {
    return this.available;
  }

  encrypt(value: Buffer): Buffer {
    return Buffer.from([...value].map((byte) => byte ^ 0x39));
  }

  decrypt(value: Buffer): Buffer {
    return this.encrypt(value);
  }
}

const roots: string[] = [];
const workspaceId = asId<'WorkspaceInstanceId'>(
  'workspace:personal-office',
) as WorkspaceInstanceId;
const grantId = asId<'IntegrationGrantId'>(
  'grant:calendar',
) as IntegrationGrantId;
const packageBinding: OperationalPackageBinding = {
  packageKey: 'ocx_extension:calendar-operator@1.0.0',
  packageId: 'calendar-operator',
  integration: 'google-calendar',
  requiredScopes: ['calendar.read', 'calendar.write'],
};
const runtime: BrowserRuntimeSpec = {
  schemaVersion: 1,
  id: 'runtime.browser.calendar',
  kind: 'browser',
  authority: {
    tenantId: 'tenant:personal',
    userId: 'user:operator',
    workspaceId,
    packageId: packageBinding.packageId,
    integrationId: packageBinding.integration,
    grantId,
    runId: 'run:calendar',
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
    allowedOrigins: ['https://calendar.example.test'],
    allowedPorts: [443],
  },
  budget: {
    cpuPercent: 25,
    memoryMb: 512,
    diskMb: 512,
    timeoutMs: 60_000,
  },
  env: [],
  visibleReviewMode: true,
  storageStateRef: secretRef(
    'encrypted_file',
    'browser/calendar/operator',
  ),
};
const marketplaceReceipt: MarketplaceInstallOperationReceipt = {
  schemaVersion: 1,
  operationVersion: '1.0.0',
  operationId: 'marketplace-install-operation:calendar',
  planId: 'marketplace-install-plan:calendar',
  packageKey: packageBinding.packageKey,
  scope: {
    tenantId: runtime.authority.tenantId,
    userId: runtime.authority.userId,
    workspaceInstanceId: runtime.authority.workspaceId,
  },
  status: 'completed',
  stages: [
    {
      stage: 'plan_revalidation',
      outcome: 'passed',
      code: 'plan_revalidation:ok',
    },
    {
      stage: 'package_verification',
      outcome: 'passed',
      code: 'package_verification:ok',
    },
    {
      stage: 'work_approval',
      outcome: 'passed',
      code: 'work_approval:ok',
      referenceId: 'approval:marketplace',
    },
    {
      stage: 'grant_resolution',
      outcome: 'passed',
      code: 'grant_resolution:ok',
    },
    {
      stage: 'workspace_provisioning',
      outcome: 'passed',
      code: 'workspace_provisioning:ok',
    },
    {
      stage: 'package_installation',
      outcome: 'passed',
      code: 'package_installation:ok',
    },
    {
      stage: 'operational_evidence',
      outcome: 'passed',
      code: 'operational_evidence:ok',
    },
  ],
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
  tenantId: runtime.authority.tenantId,
  userId: runtime.authority.userId,
  integration: packageBinding.integration,
  grantId,
  workspaceInstanceId: workspaceId,
  scopes: packageBinding.requiredScopes,
  approvalId: 'approval:grant',
} as const;

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'izzi-runtime-composition-'));
  roots.push(root);
  return root;
}

describe('offline operational runtime composition', () => {
  it('joins authoritative operation receipts through encrypted runtime evidence', async () => {
    const composition = createOfflineOperationalRuntimeComposition({
      rootDir: tempRoot(),
      encryption: new TestEncryption(),
    });

    await composition.marketplaceCompletedReceiptSink.recordCompleted(
      marketplaceReceipt,
    );
    await composition.integrationGrantEvidenceSink.recordConnected(grantReceipt);
    await composition.runtimeEvidence.ensure({ runtime, packageBinding });

    const snapshot = await composition.runtimeEvidence.resolve(
      createOperationalRuntimeEvidenceQuery(runtime, packageBinding),
    );
    expect(snapshot).toEqual({
      marketplaceReceipt: expect.objectContaining({
        operationId: marketplaceReceipt.operationId,
      }),
      grantReceipt: expect.objectContaining({
        operationId: grantReceipt.operationId,
      }),
    });
  });

  it('fails closed without OS-backed encryption and creates no authority data', async () => {
    const root = tempRoot();
    const authorityRoot = path.join(root, 'authoritative-receipts');
    const composition = createOfflineOperationalRuntimeComposition({
      rootDir: root,
      encryption: new TestEncryption(false),
    });

    await expect(
      composition.marketplaceCompletedReceiptSink.recordCompleted(
        marketplaceReceipt,
      ),
    ).rejects.toThrow('ENCRYPTION_UNAVAILABLE');
    expect(fs.existsSync(authorityRoot)).toBe(false);
  });

  it('rejects relative or padded composition roots', () => {
    const canonical = tempRoot();
    const nonCanonical = `${canonical}\\..\\${path.basename(canonical)}`;
    expect(() => createOfflineOperationalRuntimeComposition({
      rootDir: 'relative/runtime',
      encryption: new TestEncryption(),
    })).toThrow('exact absolute path');
    expect(() => createOfflineOperationalRuntimeComposition({
      rootDir: ` ${canonical}`,
      encryption: new TestEncryption(),
    })).toThrow('exact absolute path');
    expect(() => createOfflineOperationalRuntimeComposition({
      rootDir: nonCanonical,
      encryption: new TestEncryption(),
    })).toThrow('exact absolute path');
  });
});
