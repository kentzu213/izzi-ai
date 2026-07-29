import { describe, expect, it, vi } from 'vitest';
import { secretRef } from '../../shared/personal-office';
import type {
  BrowserRuntimeSpec,
  RuntimeEffectReceipt,
} from '../../shared/runtime';
import type { PreparedBrowserAction } from './browser-runtime';
import {
  OperationalBrowserService,
  OperationalBrowserServiceError,
  type OperationalBrowserCoordinatorPort,
  type OperationalRuntimeEvidenceSnapshot,
} from './operational-browser-service';

const packageBinding = {
  packageKey: 'agent_bundle:marketing@1.0.0',
  packageId: 'skill-package:marketing',
  integration: 'google-calendar',
  requiredScopes: ['calendar.read', 'calendar.write'],
};
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
const preparedAction: PreparedBrowserAction = {
  runtime,
  runId: runtime.authority.runId!,
  readUrl: 'https://calendar.google.com/read',
  submitUrl: 'https://calendar.google.com/submit',
  draftBody: { title: 'Reviewed task' },
  idempotencyKey: 'runtime-operation',
  artifactId: 'artifact:browser-draft',
  artifactVersion: 1,
  approvalId: 'approval:browser',
  actionHash: `sha256:${'c'.repeat(64)}`,
};
const receipt: RuntimeEffectReceipt = {
  schemaVersion: 1,
  claimId: 'claim:browser',
  approvalId: preparedAction.approvalId,
  actionHash: preparedAction.actionHash,
  idempotencyKey: preparedAction.idempotencyKey,
  workspaceId: runtime.authority.workspaceId,
  runId: preparedAction.runId,
  target: preparedAction.submitUrl,
  responseDigest: `sha256:${'d'.repeat(64)}`,
  externalActionPerformed: true,
  performedAt: '2026-07-29T10:03:00.000Z',
};

function harness(initial: OperationalRuntimeEvidenceSnapshot | null = {
  marketplaceReceipt,
  grantReceipt,
}) {
  let snapshot = initial;
  const coordinator: OperationalBrowserCoordinatorPort = {
    prepare: vi.fn().mockResolvedValue(preparedAction),
    execute: vi.fn().mockResolvedValue(receipt),
  };
  const evidence = {
    resolve: vi.fn(async () => snapshot),
  };
  return {
    service: new OperationalBrowserService(coordinator, evidence),
    coordinator,
    evidence,
    setSnapshot(value: OperationalRuntimeEvidenceSnapshot | null) {
      snapshot = value;
    },
  };
}

describe('OperationalBrowserService', () => {
  it('requires authoritative evidence at prepare and revalidates it before execute', async () => {
    const test = harness();
    const prepared = await test.service.prepare({
      runtime,
      packageBinding,
      runId: preparedAction.runId,
      readUrl: preparedAction.readUrl,
      submitUrl: preparedAction.submitUrl,
      draftBody: preparedAction.draftBody,
      idempotencyKey: preparedAction.idempotencyKey,
    });
    await expect(test.service.execute(prepared)).resolves.toEqual(receipt);
    expect(test.evidence.resolve).toHaveBeenCalledTimes(2);
    expect(test.evidence.resolve).toHaveBeenCalledWith({
      tenantId: runtime.authority.tenantId,
      userId: runtime.authority.userId,
      workspaceId: runtime.authority.workspaceId,
      packageKey: packageBinding.packageKey,
      packageId: packageBinding.packageId,
      integration: packageBinding.integration,
      grantId: runtime.authority.grantId,
      runId: runtime.authority.runId,
      requiredScopes: [...packageBinding.requiredScopes].sort(),
    });
    expect(test.coordinator.execute).toHaveBeenCalledOnce();
  });

  it('denies execution when exact receipt evidence drifts after approval preparation', async () => {
    const test = harness();
    const prepared = await test.service.prepare({
      runtime,
      packageBinding,
      runId: preparedAction.runId,
      readUrl: preparedAction.readUrl,
      submitUrl: preparedAction.submitUrl,
      draftBody: preparedAction.draftBody,
      idempotencyKey: preparedAction.idempotencyKey,
    });
    test.setSnapshot({
      marketplaceReceipt,
      grantReceipt: {
        ...grantReceipt,
        evidenceDigest: `sha256:${'e'.repeat(64)}`,
      },
    });
    await expect(test.service.execute(prepared)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DRIFT',
    });
    expect(test.coordinator.execute).not.toHaveBeenCalled();
  });

  it('rejects unavailable evidence and grants with excess scope', async () => {
    const unavailable = harness(null);
    await expect(unavailable.service.prepare({
      runtime,
      packageBinding,
      runId: preparedAction.runId,
      readUrl: preparedAction.readUrl,
      submitUrl: preparedAction.submitUrl,
      draftBody: preparedAction.draftBody,
      idempotencyKey: preparedAction.idempotencyKey,
    })).rejects.toEqual(new OperationalBrowserServiceError('EVIDENCE_UNAVAILABLE'));

    const excessive = harness({
      marketplaceReceipt,
      grantReceipt: {
        ...grantReceipt,
        scopes: [...grantReceipt.scopes, 'calendar.admin'],
      },
    });
    await expect(excessive.service.prepare({
      runtime,
      packageBinding,
      runId: preparedAction.runId,
      readUrl: preparedAction.readUrl,
      submitUrl: preparedAction.submitUrl,
      draftBody: preparedAction.draftBody,
      idempotencyKey: preparedAction.idempotencyKey,
    })).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    expect(excessive.coordinator.prepare).not.toHaveBeenCalled();
  });

  it('does not query evidence for an incomplete or mismatched runtime authority', async () => {
    const test = harness();
    await expect(test.service.prepare({
      runtime: {
        ...runtime,
        authority: { ...runtime.authority, runId: undefined },
      },
      packageBinding,
      runId: preparedAction.runId,
      readUrl: preparedAction.readUrl,
      submitUrl: preparedAction.submitUrl,
      draftBody: preparedAction.draftBody,
      idempotencyKey: preparedAction.idempotencyKey,
    })).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    expect(test.evidence.resolve).not.toHaveBeenCalled();
  });
});
