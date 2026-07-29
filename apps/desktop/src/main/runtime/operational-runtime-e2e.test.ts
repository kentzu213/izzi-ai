import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { asId, secretRef } from '../../shared/personal-office';
import type { BrowserRuntimeSpec } from '../../shared/runtime';
import { WorkService } from '../work/work-service';
import { runWorkModelMigration } from '../work/work-migration';
import { createNodeSqliteDatabase } from '../work/test-support';
import {
  BrowserRuntimeCoordinator,
  type IsolatedBrowserDriver,
  type IsolatedBrowserSession,
} from './browser-runtime';
import {
  AttestedBrowserDriver,
  type BrowserDriverAttestation,
} from './attested-browser-driver';
import {
  EncryptedBrowserStateStore,
  type RuntimeEncryptionProvider,
} from './encrypted-state-store';
import { FileEffectClaimStore } from './effect-claim-store';
import { OperationalBrowserService } from './operational-browser-service';
import type {
  RuntimeAuthorizationQuery,
  RuntimeAuthorizationResolver,
} from './runtime-authorizer';
import { WorkServiceRuntimePort } from './work-runtime-port';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

class TestEncryption implements RuntimeEncryptionProvider {
  isAvailable() {
    return true;
  }
  encrypt(value: Buffer) {
    return Buffer.from([...value].map((byte) => byte ^ 0x5a));
  }
  decrypt(value: Buffer) {
    return this.encrypt(value);
  }
}

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
      secret: secretRef('integration_vault', 'runtime/calendar/e2e', scope.scopes),
      createdAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T10:00:00.000Z',
      expiresAt: '2026-07-30T10:00:00.000Z',
    },
  };
}

const authorization: RuntimeAuthorizationResolver = {
  isPackageTrusted: () => true,
  resolveGrant: (query) => grantEvidence(query),
};

describe('Personal Office operational runtime E2E', () => {
  it('joins install and grant evidence, creates Work approval, executes once and records artifacts', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'izzi-operational-runtime-'));
    roots.push(root);
    const { db, close } = createNodeSqliteDatabase();
    runWorkModelMigration(db);
    const service = new WorkService({
      db,
      now: () => new Date('2026-07-29T10:03:00.000Z'),
    });
    const run = service.createRun({
      workspaceId: 'workspace:personal-office',
      title: 'Operate installed Marketing workspace',
      brief: 'Review and submit one allowlisted calendar action.',
      plan: [{ key: 'browser', label: 'Prepare reviewed browser action' }],
    });
    service.queue(run.id);
    service.start(run.id);

    const runtimeRoot = process.platform === 'win32'
      ? 'C:\\izzi\\browser'
      : '/izzi/browser';
    const runtime: BrowserRuntimeSpec = {
      schemaVersion: 1,
      id: 'runtime.browser.marketing',
      kind: 'browser',
      authority: {
        tenantId: 'tenant:izzi',
        userId: 'user:operator',
        workspaceId: 'workspace:personal-office',
        packageId: 'skill-package:marketing',
        integrationId: 'google-calendar',
        grantId: 'grant:calendar',
        runId: run.id,
      },
      paths: {
        workDir: runtimeRoot,
        tempDir: runtimeRoot,
        uploadDir: runtimeRoot,
        downloadDir: runtimeRoot,
        allowedRoots: [runtimeRoot],
      },
      network: {
        mode: 'allowlist',
        bindHost: '127.0.0.1',
        allowedOrigins: ['http://127.0.0.1:43111'],
        allowedPorts: [43111],
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
      packageKey: 'agent_bundle:marketing@1.0.0',
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
      installedPackageKey: 'agent_bundle:marketing@1.0.0',
      startedAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T10:01:00.000Z',
    };
    const grantReceipt = {
      operationId: `sha256:${'b'.repeat(64)}`,
      status: 'connected',
      code: 'CONNECTED',
      observedAt: '2026-07-29T10:02:00.000Z',
      integration: runtime.authority.integrationId,
      grantId: runtime.authority.grantId,
      workspaceInstanceId: runtime.authority.workspaceId,
      scopes: ['browser.test.submit'],
      approvalId: 'approval:grant',
    };

    let submitCalls = 0;
    const session: IsolatedBrowserSession = {
      navigate: async (_url, _signal, authorizeUrl) => {
        authorizeUrl('http://127.0.0.1:43111/read');
        return {
          finalUrl: 'http://127.0.0.1:43111/read',
          text: 'Calendar draft ready',
          trace: '{"read":true}',
          screenshot: 'calendar-preview',
        };
      },
      submitTestEndpoint: async ({ body }, _signal, authorizeUrl) => {
        submitCalls += 1;
        authorizeUrl('http://127.0.0.1:43111/receipt');
        return {
          finalUrl: 'http://127.0.0.1:43111/receipt',
          status: 200,
          responseBody: JSON.stringify(body),
          trace: '{"submitted":true}',
          screenshot: 'calendar-receipt',
        };
      },
      exportStorageState: async () => '{"cookies":[]}',
      close: async () => undefined,
    };
    const innerDriver: IsolatedBrowserDriver = {
      idempotentReplaySafe: true,
      open: vi.fn().mockResolvedValue(session),
    };
    const attestation: BrowserDriverAttestation = {
      schemaVersion: 1,
      adapterId: 'playwright:managed-test',
      adapterVersion: '1.0.0',
      driver: 'playwright',
      driverDigest: `sha256:${'c'.repeat(64)}`,
      packageId: runtime.authority.packageId,
      allowedOrigins: runtime.network.allowedOrigins,
      verifiedAt: '2026-07-29T09:00:00.000Z',
      expiresAt: '2026-07-30T09:00:00.000Z',
    };
    const coordinator = new BrowserRuntimeCoordinator(
      new AttestedBrowserDriver(
        innerDriver,
        attestation,
        () => new Date('2026-07-29T10:03:00.000Z'),
      ),
      new EncryptedBrowserStateStore(path.join(root, 'state'), new TestEncryption()),
      new FileEffectClaimStore(
        path.join(root, 'claims'),
        () => new Date('2026-07-29T10:03:00.000Z'),
      ),
      new WorkServiceRuntimePort(service),
      authorization,
      () => new Date('2026-07-29T10:03:00.000Z'),
    );
    const operational = new OperationalBrowserService(coordinator, {
      resolve: async (query) => {
        expect(query).toMatchObject({
          tenantId: runtime.authority.tenantId,
          userId: runtime.authority.userId,
          workspaceId: runtime.authority.workspaceId,
          packageId: runtime.authority.packageId,
          integration: runtime.authority.integrationId,
          grantId: runtime.authority.grantId,
          runId: run.id,
        });
        return { marketplaceReceipt, grantReceipt };
      },
    });
    try {
      const prepared = await operational.prepare({
        runtime,
        packageBinding: {
          packageKey: marketplaceReceipt.packageKey,
          packageId: runtime.authority.packageId,
          integration: runtime.authority.integrationId,
          requiredScopes: ['browser.test.submit'],
        },
        runId: run.id,
        readUrl: 'http://127.0.0.1:43111/read',
        submitUrl: 'http://127.0.0.1:43111/submit',
        draftBody: { title: 'Reviewed calendar task' },
        idempotencyKey: 'operational-runtime-e2e',
      });
      expect(service.decideApproval({
        approvalId: prepared.preparedAction.approvalId,
        decision: 'approve',
        decidedBy: 'reviewer-hash',
      }).ok).toBe(true);
      const receipt = await operational.execute(prepared);
      expect(receipt.externalActionPerformed).toBe(true);
      expect(submitCalls).toBe(1);
      expect(service.listArtifacts(run.id).map((artifact) => artifact.name))
        .toEqual(expect.arrayContaining([
          'browser-action-draft',
          'browser-effect-receipt',
        ]));
    } finally {
      close();
    }
  });
});
