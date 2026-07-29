import { describe, expect, it } from 'vitest';
import { secretRef } from '../../shared/personal-office';
import type { BrowserRuntimeSpec } from '../../shared/runtime';
import { authorizeOperationalBrowserRuntime } from './operational-runtime-gate';

const scope = {
  tenantId: 'tenant:izzi',
  userId: 'user:operator',
  workspaceInstanceId: 'workspace:personal-office',
};
const packageBinding = {
  packageKey: 'agent_bundle:marketing@1.0.0',
  packageId: 'skill-package:marketing',
  integration: 'google-calendar',
  requiredScopes: ['calendar.read', 'calendar.write'],
};
const marketplaceReceipt = {
  schemaVersion: 1,
  operationVersion: '1.0.0',
  operationId: 'marketplace-install-operation:marketing',
  planId: 'marketplace-install-plan:marketing',
  packageKey: packageBinding.packageKey,
  scope,
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
  provisionedWorkspaceInstanceId: scope.workspaceInstanceId,
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
  grantId: 'grant:calendar',
  workspaceInstanceId: scope.workspaceInstanceId,
  scopes: packageBinding.requiredScopes,
  approvalId: 'approval:grant',
};
const runtime: BrowserRuntimeSpec = {
  schemaVersion: 1,
  id: 'runtime.browser.marketing',
  kind: 'browser',
  authority: {
    tenantId: scope.tenantId,
    userId: scope.userId,
    workspaceId: scope.workspaceInstanceId,
    packageId: packageBinding.packageId,
    integrationId: packageBinding.integration,
    grantId: grantReceipt.grantId,
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

describe('authorizeOperationalBrowserRuntime', () => {
  it('binds completed install, connected grant and exact runtime authority', () => {
    expect(authorizeOperationalBrowserRuntime({
      marketplaceReceipt,
      grantReceipt,
      packageBinding,
      runtime,
    })).toMatchObject({
      kind: 'operational_runtime_authorization',
      workspaceId: scope.workspaceInstanceId,
      packageKey: packageBinding.packageKey,
      packageId: packageBinding.packageId,
      integration: packageBinding.integration,
      grantId: grantReceipt.grantId,
      requiredScopes: packageBinding.requiredScopes,
      runtimeId: runtime.id,
      runId: runtime.authority.runId,
    });
  });

  it.each([
    ['install not completed', { marketplaceReceipt: { ...marketplaceReceipt, status: 'blocked' } }],
    ['foreign workspace', { runtime: { ...runtime, authority: { ...runtime.authority, workspaceId: 'workspace:other' } } }],
    ['wrong package', { runtime: { ...runtime, authority: { ...runtime.authority, packageId: 'skill-package:other' } } }],
    ['wrong grant', { runtime: { ...runtime, authority: { ...runtime.authority, grantId: 'grant:other' } } }],
    ['missing scope', { grantReceipt: { ...grantReceipt, scopes: ['calendar.read'] } }],
    ['excess scope', { grantReceipt: { ...grantReceipt, scopes: [...grantReceipt.scopes, 'calendar.admin'] } }],
    ['invalid observed time', { grantReceipt: { ...grantReceipt, observedAt: 'not-a-time' } }],
    ['invalid evidence digest', { grantReceipt: { ...grantReceipt, evidenceDigest: 'sha256:not-valid' } }],
    ['missing grant approval', { grantReceipt: { ...grantReceipt, approvalId: undefined } }],
    ['failed intermediate install stage', {
      marketplaceReceipt: {
        ...marketplaceReceipt,
        stages: marketplaceReceipt.stages.map((stage) => (
          stage.stage === 'grant_resolution'
            ? { ...stage, outcome: 'failed' }
            : stage
        )),
      },
    }],
    ['mismatched install approval', {
      marketplaceReceipt: {
        ...marketplaceReceipt,
        approvalId: 'approval:other',
      },
    }],
  ])('rejects %s', (_label, override) => {
    expect(() => authorizeOperationalBrowserRuntime({
      marketplaceReceipt,
      grantReceipt,
      packageBinding,
      runtime,
      ...override,
    })).toThrow();
  });

  it('binds the authorization digest to exact receipt evidence', () => {
    const original = authorizeOperationalBrowserRuntime({
      marketplaceReceipt,
      grantReceipt,
      packageBinding,
      runtime,
    });
    const changed = authorizeOperationalBrowserRuntime({
      marketplaceReceipt,
      grantReceipt: {
        ...grantReceipt,
        evidenceDigest: `sha256:${'b'.repeat(64)}`,
      },
      packageBinding,
      runtime,
    });
    expect(changed.authorizationDigest).not.toBe(original.authorizationDigest);
  });
});
