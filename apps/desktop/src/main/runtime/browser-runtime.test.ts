import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { secretRef, asId } from '../../shared/personal-office';
import type { BrowserRuntimeSpec } from '../../shared/runtime';
import { computeActionHash } from '../work/work-hash';
import { redactDeep } from '../work/work-redaction';
import { WorkService } from '../work/work-service';
import { runWorkModelMigration } from '../work/work-migration';
import { createNodeSqliteDatabase } from '../work/test-support';
import type { WorkApproval, WorkArtifact, WorkRun } from '../work/work-types';
import {
  BrowserApprovalError,
  BrowserRuntimeCoordinator,
  browserStateKey,
  type BrowserWorkPort,
  type IsolatedBrowserDriver,
  type IsolatedBrowserSession,
} from './browser-runtime';
import { EncryptedBrowserStateStore, type RuntimeEncryptionProvider } from './encrypted-state-store';
import { FileEffectClaimStore } from './effect-claim-store';
import { WorkServiceRuntimePort } from './work-runtime-port';
import type {
  RuntimeAuthorizationQuery,
  RuntimeAuthorizationResolver,
} from './runtime-authorizer';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
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

class FakeWork implements BrowserWorkPort {
  readonly run: WorkRun = {
    id: 'run-1',
    workspaceId: 'workspace-1',
    title: 'Browser POC',
    brief: 'test',
    state: 'running',
    origin: 'manual',
    planVersion: 1,
    planHash: 'plan-hash',
    rootRunId: 'run-1',
    lineageKind: 'original',
    attempt: 1,
    schemaVersion: 1,
    createdAt: '2026-07-29T00:00:00Z',
    updatedAt: '2026-07-29T00:00:00Z',
  };
  readonly artifacts: WorkArtifact[] = [];
  readonly steps: unknown[] = [];
  approval: WorkApproval | null = null;

  putArtifact(input: Parameters<BrowserWorkPort['putArtifact']>[0]): WorkArtifact {
    const artifact: WorkArtifact = {
      id: `artifact-${this.artifacts.length + 1}`,
      runId: input.runId,
      workspaceId: this.run.workspaceId,
      name: input.name,
      kind: input.kind,
      mediaType: input.mediaType,
      version: 1,
      sha256: 'digest',
      sizeBytes: input.body.length,
      body: input.body,
      schemaVersion: 1,
      createdAt: '2026-07-29T00:00:00Z',
      updatedAt: '2026-07-29T00:00:00Z',
    };
    this.artifacts.push(artifact);
    return artifact;
  }

  requestApproval(input: Parameters<BrowserWorkPort['requestApproval']>[0]): WorkApproval {
    const redacted = redactDeep(input.body);
    const approvalInput = redacted.value !== null
      && typeof redacted.value === 'object'
      && !Array.isArray(redacted.value)
      ? { ...(redacted.value as Record<string, unknown>), _redacted: redacted.kinds }
      : redacted.value;
    const binding = {
      target: input.target,
      input: approvalInput,
      artifactId: asId<'ArtifactId'>(input.artifactId),
      artifactVersion: 1,
      estimatedSideEffect: 'test submit',
      idempotencyKey: input.idempotencyKey,
      expiresAt: '2026-07-30T00:00:00Z',
      planHash: this.run.planHash,
      contextSnapshotId: null,
    };
    this.approval = {
      id: 'approval-1',
      runId: input.runId,
      workspaceId: this.run.workspaceId,
      kind: 'external_publish',
      title: 'Approve test',
      summary: 'test',
      risk: 'high',
      status: 'pending',
      actionHash: computeActionHash(binding),
      binding,
      expiresAt: binding.expiresAt,
      schemaVersion: 1,
      createdAt: '2026-07-29T00:00:00Z',
      updatedAt: '2026-07-29T00:00:00Z',
    };
    return this.approval;
  }

  approve(): void {
    if (this.approval) this.approval = { ...this.approval, status: 'approved' };
  }

  reject(): void {
    if (this.approval) this.approval = { ...this.approval, status: 'rejected' };
  }

  getApproval() {
    return this.approval;
  }
  getRun() {
    return this.run;
  }
  listArtifacts() {
    return this.artifacts;
  }
  recordStep(input: Parameters<BrowserWorkPort['recordStep']>[0]) {
    this.steps.push(input);
  }
}

class FakeDriver implements IsolatedBrowserDriver {
  readonly idempotentReplaySafe = true;
  readonly effects = new Set<string>();
  readonly submittedBodies: unknown[] = [];
  submitCalls = 0;
  openCalls = 0;
  crashOnSubmit = false;
  finalSubmitUrl = 'http://127.0.0.1:43111/receipt';

  async open(): Promise<IsolatedBrowserSession> {
    this.openCalls += 1;
    return {
      navigate: async (_url, _signal, authorizeUrl) => {
        authorizeUrl('http://127.0.0.1:43111/read');
        return {
          finalUrl: 'http://127.0.0.1:43111/read',
          text: 'safe read sk-secretshouldberedacted123456',
          trace: 'Authorization: Bearer abcDEF123456ghiJKL\nCookie: sid=browser-cookie',
          screenshot: 'password=hunter2\nSet-Cookie: session=browser-session',
        };
      },
      submitTestEndpoint: async ({ idempotencyKey, body }, _signal, authorizeUrl) => {
        this.submitCalls += 1;
        if (this.crashOnSubmit) throw new Error('driver crashed');
        authorizeUrl(this.finalSubmitUrl);
        this.submittedBodies.push(body);
        this.effects.add(idempotencyKey);
        return {
          finalUrl: this.finalSubmitUrl,
          status: 200,
          responseBody: 'ok',
          trace: 'token=submit-secret-value\n{"submit":true}',
          screenshot: 'Set-Cookie: receipt=submit-session',
        };
      },
      exportStorageState: async () => '{"cookies":[]}',
      close: async () => undefined,
    };
  }
}

const runtimeRoot = process.platform === 'win32' ? 'C:\\izzi\\browser' : '/izzi/browser';
const runtime: BrowserRuntimeSpec = {
  schemaVersion: 1,
  id: 'runtime.browser.poc',
  kind: 'browser',
  authority: {
    tenantId: 'tenant-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    packageId: 'marketing-blueprint',
    integrationId: 'test-endpoint',
    grantId: 'grant-browser-1',
    runId: 'run-1',
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
  budget: { cpuPercent: 25, memoryMb: 256, diskMb: 256, timeoutMs: 10_000 },
  env: [],
  visibleReviewMode: false,
  storageStateRef: secretRef('encrypted_file', 'browser/workspace-1/test'),
};

function grantEvidence(
  query: RuntimeAuthorizationQuery,
  scopeOverrides: Partial<{
    tenantId: string;
    userId: string;
    workspaceId: string;
    integrationId: string;
    grantId: string;
  }> = {},
): unknown {
  const scope = {
    tenantId: scopeOverrides.tenantId ?? query.tenantId,
    userId: scopeOverrides.userId ?? query.userId,
    workspaceInstanceId: asId<'WorkspaceInstanceId'>(
      scopeOverrides.workspaceId ?? query.workspaceId,
    ),
    grantId: asId<'IntegrationGrantId'>(scopeOverrides.grantId ?? query.grantId),
    integration: scopeOverrides.integrationId ?? query.integrationId,
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
      secret: secretRef('integration_vault', 'runtime/browser-test', scope.scopes),
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
  };
}

const trustedAuthorization: RuntimeAuthorizationResolver = {
  isPackageTrusted: () => true,
  resolveGrant: (query) => grantEvidence(query),
};

function setup(authorization: RuntimeAuthorizationResolver = trustedAuthorization) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'izzi-browser-poc-'));
  roots.push(root);
  const driver = new FakeDriver();
  const work = new FakeWork();
  const coordinator = new BrowserRuntimeCoordinator(
    driver,
    new EncryptedBrowserStateStore(path.join(root, 'state'), new TestEncryption()),
    new FileEffectClaimStore(path.join(root, 'claims'), () => new Date('2026-07-29T00:00:00Z')),
    work,
    authorization,
    () => new Date('2026-07-29T00:00:00Z'),
  );
  return { root, driver, work, coordinator };
}

describe('BrowserRuntimeCoordinator safe POC', () => {
  it('reads and drafts but creates no side effect before approval', async () => {
    const { driver, work, coordinator } = setup();
    await coordinator.prepare({
      runtime,
      runId: 'run-1',
      readUrl: 'http://127.0.0.1:43111/read',
      submitUrl: 'http://127.0.0.1:43111/submit',
      draftBody: { message: 'review me' },
      idempotencyKey: 'browser-effect-1',
    });
    expect(driver.effects.size).toBe(0);
    expect(work.approval?.status).toBe('pending');
    expect(work.artifacts.some((item) => item.name === 'browser-action-draft')).toBe(true);
    expect(JSON.stringify(work.artifacts)).not.toContain('sk-secretshouldberedacted123456');
    expect(JSON.stringify(work.artifacts)).not.toContain('abcDEF123456ghiJKL');
    expect(JSON.stringify(work.artifacts)).not.toContain('browser-cookie');
    expect(JSON.stringify(work.artifacts)).not.toContain('hunter2');
    expect(JSON.stringify(work.artifacts)).not.toContain('browser-session');
  });

  it('rejects bypass and reject without any effect', async () => {
    const { driver, work, coordinator } = setup();
    const prepared = await coordinator.prepare({
      runtime,
      runId: 'run-1',
      readUrl: 'http://127.0.0.1:43111/read',
      submitUrl: 'http://127.0.0.1:43111/submit',
      draftBody: { message: 'review me' },
      idempotencyKey: 'browser-effect-2',
    });
    await expect(coordinator.execute(prepared)).rejects.toBeInstanceOf(BrowserApprovalError);
    work.reject();
    await expect(coordinator.execute(prepared)).rejects.toThrow('not approved');
    expect(driver.effects.size).toBe(0);
  });

  it('submits an approved action once and replays the persisted receipt', async () => {
    const { driver, work, coordinator } = setup();
    const prepared = await coordinator.prepare({
      runtime,
      runId: 'run-1',
      readUrl: 'http://127.0.0.1:43111/read',
      submitUrl: 'http://127.0.0.1:43111/submit',
      draftBody: { message: 'approved' },
      idempotencyKey: 'browser-effect-3',
    });
    work.approve();
    const first = await coordinator.execute(prepared);
    const replay = await coordinator.execute(prepared);
    expect(first).toEqual(replay);
    expect(driver.effects.size).toBe(1);
    expect(driver.submitCalls).toBe(1);
    expect(work.artifacts.some((item) => item.name === 'browser-effect-receipt')).toBe(true);
  });

  it('rejects a draft-body substitution after approval without any effect', async () => {
    const { driver, work, coordinator } = setup();
    const prepared = await coordinator.prepare({
      runtime,
      runId: 'run-1',
      readUrl: 'http://127.0.0.1:43111/read',
      submitUrl: 'http://127.0.0.1:43111/submit',
      draftBody: { message: 'approved body' },
      idempotencyKey: 'browser-effect-body-binding',
    });
    work.approve();
    await expect(coordinator.execute({
      ...prepared,
      draftBody: { message: 'unapproved replacement' },
    })).rejects.toThrow('stale or tampered');
    expect(driver.effects.size).toBe(0);
    expect(driver.submitCalls).toBe(0);
  });

  it('executes a normally approved object through the real WorkService port', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'izzi-browser-work-port-'));
    roots.push(root);
    const { db, close } = createNodeSqliteDatabase();
    runWorkModelMigration(db);
    const service = new WorkService({
      db,
      now: () => new Date('2026-07-29T00:00:00Z'),
    });
    const run = service.createRun({
      workspaceId: 'workspace-1',
      title: 'Browser POC',
      brief: 'test WorkService normalization',
      plan: [{ key: 'browser', label: 'Prepare browser action' }],
    });
    service.queue(run.id);
    service.start(run.id);
    const runtimeForRun: BrowserRuntimeSpec = {
      ...runtime,
      authority: { ...runtime.authority, runId: run.id },
    };
    const driver = new FakeDriver();
    const coordinator = new BrowserRuntimeCoordinator(
      driver,
      new EncryptedBrowserStateStore(path.join(root, 'state'), new TestEncryption()),
      new FileEffectClaimStore(path.join(root, 'claims'), () => new Date('2026-07-29T00:00:00Z')),
      new WorkServiceRuntimePort(service),
      trustedAuthorization,
      () => new Date('2026-07-29T00:00:00Z'),
    );
    try {
      const prepared = await coordinator.prepare({
        runtime: runtimeForRun,
        runId: run.id,
        readUrl: 'http://127.0.0.1:43111/read',
        submitUrl: 'http://127.0.0.1:43111/submit',
        draftBody: { message: 'approved body' },
        idempotencyKey: 'browser-real-work-port',
      });
      expect(service.getApproval(prepared.approvalId)?.binding.input).toEqual({
        message: 'approved body',
        _redacted: [],
      });
      const decision = service.decideApproval({
        approvalId: prepared.approvalId,
        decision: 'approve',
        decidedBy: 'reviewer-hash',
      });
      expect(decision.ok).toBe(true);
      await expect(coordinator.execute(prepared)).resolves.toMatchObject({
        externalActionPerformed: true,
      });
      expect(driver.submitCalls).toBe(1);
      expect(driver.submittedBodies).toEqual([{ message: 'approved body' }]);
    } finally {
      close();
    }
  });

  it('rejects a secret-shaped body value before the browser driver opens', async () => {
    const { driver, coordinator } = setup();
    await expect(coordinator.prepare({
      runtime,
      runId: 'run-1',
      readUrl: 'http://127.0.0.1:43111/read',
      submitUrl: 'http://127.0.0.1:43111/submit',
      draftBody: { message: 'sk-live-secret-value-that-must-not-leave' },
      idempotencyKey: 'browser-secret-body',
    })).rejects.toThrow('cannot be approval-bound');
    expect(driver.openCalls).toBe(0);
  });

  it.each([
    ['constructor', JSON.parse('{"message":"safe","constructor":{"admin":true}}')],
    ['prototype', JSON.parse('{"message":"safe","prototype":{"admin":true}}')],
    ['__proto__', JSON.parse('{"message":"safe","__proto__":{"admin":true}}')],
    ['_redacted', { message: 'safe', _redacted: [] }],
  ])('rejects reserved approval key %s before the browser driver opens', async (_label, body) => {
    const { driver, coordinator } = setup();
    await expect(coordinator.prepare({
      runtime,
      runId: 'run-1',
      readUrl: 'http://127.0.0.1:43111/read',
      submitUrl: 'http://127.0.0.1:43111/submit',
      draftBody: body,
      idempotencyKey: `browser-reserved-${_label}`,
    })).rejects.toThrow('reserved key');
    expect(driver.openCalls).toBe(0);
  });

  it.each(['constructor', 'prototype', '__proto__'])(
    'rejects persisted approval-binding injection through %s before submit',
    async (reservedKey) => {
      const { driver, work, coordinator } = setup();
      const prepared = await coordinator.prepare({
        runtime,
        runId: 'run-1',
        readUrl: 'http://127.0.0.1:43111/read',
        submitUrl: 'http://127.0.0.1:43111/submit',
        draftBody: { message: 'approved body' },
        idempotencyKey: `browser-persisted-${reservedKey}`,
      });
      work.approve();
      if (!work.approval) throw new Error('approval missing');
      const injectedInput = JSON.parse(JSON.stringify(work.approval.binding.input)) as Record<string, unknown>;
      Object.defineProperty(injectedInput, reservedKey, {
        value: { admin: true },
        enumerable: true,
        configurable: true,
        writable: true,
      });
      work.approval = {
        ...work.approval,
        binding: { ...work.approval.binding, input: injectedInput },
      };
      await expect(coordinator.execute(prepared)).rejects.toThrow('reserved key');
      expect(driver.submitCalls).toBe(0);
      expect(driver.effects.size).toBe(0);
    },
  );

  it('rejects reserved-key injection nested in a persisted array binding', async () => {
    const { driver, work, coordinator } = setup();
    const prepared = await coordinator.prepare({
      runtime,
      runId: 'run-1',
      readUrl: 'http://127.0.0.1:43111/read',
      submitUrl: 'http://127.0.0.1:43111/submit',
      draftBody: [{ message: 'approved array body' }],
      idempotencyKey: 'browser-persisted-array',
    });
    work.approve();
    if (!work.approval) throw new Error('approval missing');
    const injectedInput = JSON.parse(
      JSON.stringify(work.approval.binding.input),
    ) as Array<Record<string, unknown>>;
    Object.defineProperty(injectedInput[0], 'constructor', {
      value: { admin: true },
      enumerable: true,
      configurable: true,
      writable: true,
    });
    work.approval = {
      ...work.approval,
      binding: { ...work.approval.binding, input: injectedInput },
    };
    await expect(coordinator.execute(prepared)).rejects.toThrow('reserved key');
    expect(driver.submitCalls).toBe(0);
    expect(driver.effects.size).toBe(0);
  });

  it('marks a crashed outcome uncertain and refuses automatic retry', async () => {
    const { root, driver, work, coordinator } = setup();
    const prepared = await coordinator.prepare({
      runtime,
      runId: 'run-1',
      readUrl: 'http://127.0.0.1:43111/read',
      submitUrl: 'http://127.0.0.1:43111/submit',
      draftBody: { message: 'approved' },
      idempotencyKey: 'browser-effect-4',
    });
    work.approve();
    driver.crashOnSubmit = true;
    await expect(coordinator.execute(prepared)).rejects.toThrow('driver crashed');
    driver.crashOnSubmit = false;
    await expect(coordinator.execute(prepared)).rejects.toThrow('uncertain');
    expect(driver.effects.size).toBe(0);
    expect(fs.readFileSync(path.join(root, 'claims', fs.readdirSync(path.join(root, 'claims'))[0]), 'utf8'))
      .toContain('browser-effect-4');
  });

  it('fails final redirect validation', async () => {
    const { driver, work, coordinator } = setup();
    const prepared = await coordinator.prepare({
      runtime,
      runId: 'run-1',
      readUrl: 'http://127.0.0.1:43111/read',
      submitUrl: 'http://127.0.0.1:43111/submit',
      draftBody: { message: 'approved' },
      idempotencyKey: 'browser-effect-5',
    });
    work.approve();
    driver.finalSubmitUrl = 'http://127.0.0.1.evil.test:43111/receipt';
    await expect(coordinator.execute(prepared)).rejects.toThrow('not allowlisted');
    expect(driver.effects.size).toBe(0);
  });

  it('denies untrusted packages before opening the browser driver', async () => {
    const { driver, coordinator } = setup({
      isPackageTrusted: () => false,
      resolveGrant: (query) => grantEvidence(query),
    });
    await expect(coordinator.prepare({
      runtime,
      runId: 'run-1',
      readUrl: 'http://127.0.0.1:43111/read',
      submitUrl: 'http://127.0.0.1:43111/submit',
      draftBody: { message: 'denied' },
      idempotencyKey: 'browser-denied-package',
    })).rejects.toThrow('Untrusted package');
    expect(driver.openCalls).toBe(0);
  });

  it.each([
    ['tenant', { tenantId: 'tenant-forged' }],
    ['user', { userId: 'user-forged' }],
    ['workspace', { workspaceId: 'workspace-forged' }],
    ['integration', { integrationId: 'integration-forged' }],
  ])('denies a forged %s grant before opening the browser driver', async (_label, overrides) => {
    const { driver, coordinator } = setup({
      isPackageTrusted: () => true,
      resolveGrant: (query) => grantEvidence(query, overrides),
    });
    await expect(coordinator.prepare({
      runtime,
      runId: 'run-1',
      readUrl: 'http://127.0.0.1:43111/read',
      submitUrl: 'http://127.0.0.1:43111/submit',
      draftBody: { message: 'denied' },
      idempotencyKey: `browser-denied-${_label}`,
    })).rejects.toThrow('evidence is invalid');
    expect(driver.openCalls).toBe(0);
  });

  it('denies a runtime runId mismatch before opening the browser driver', async () => {
    const { driver, coordinator } = setup();
    await expect(coordinator.prepare({
      runtime,
      runId: 'run-forged',
      readUrl: 'http://127.0.0.1:43111/read',
      submitUrl: 'http://127.0.0.1:43111/submit',
      draftBody: { message: 'denied' },
      idempotencyKey: 'browser-denied-run',
    })).rejects.toThrow('runId');
    expect(driver.openCalls).toBe(0);
  });

  it('isolates encrypted browser state by tenant/user and collision-safe identity', () => {
    const tenantKey = browserStateKey(runtime);
    expect(browserStateKey({
      ...runtime,
      authority: { ...runtime.authority, tenantId: 'tenant-2' },
    })).not.toBe(tenantKey);
    expect(browserStateKey({
      ...runtime,
      authority: { ...runtime.authority, userId: 'user-2' },
    })).not.toBe(tenantKey);
    expect(browserStateKey({
      ...runtime,
      authority: { ...runtime.authority, grantId: 'grant-browser-2' },
    })).not.toBe(tenantKey);
    expect(browserStateKey({
      ...runtime,
      storageStateRef: secretRef('encrypted_file', 'browser/workspace-1/other'),
    })).not.toBe(tenantKey);
    const dotted = browserStateKey({
      ...runtime,
      authority: {
        ...runtime.authority,
        workspaceId: 'a.b',
        packageId: 'c',
      },
    });
    const ambiguousWithoutCanonicalHash = browserStateKey({
      ...runtime,
      authority: {
        ...runtime.authority,
        workspaceId: 'a',
        packageId: 'b.c',
      },
    });
    expect(dotted).not.toBe(ambiguousWithoutCanonicalHash);
  });
});
