import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CustomerMarketingWorkflowStore,
  WorkflowStoreConflictError,
  WorkflowStoreCorruptionError,
  type WorkflowSettings,
} from './customer-marketing-workflow-store';

class MemorySettings implements WorkflowSettings {
  readonly values = new Map<string, string>();

  getSetting(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setSetting(key: string, value: string): void {
    this.values.set(key, value);
  }

  deleteSetting(key: string): void {
    this.values.delete(key);
  }
}

function harness(settings = new MemorySettings(), workspaceId = 'workspace-a') {
  let currentTime = Date.parse('2026-07-22T00:00:00.000Z');
  let sequence = 0;
  const makeStore = () => new CustomerMarketingWorkflowStore(settings, workspaceId, {
    now: () => currentTime,
    createId: () => `lease-${++sequence}`,
    retryBaseDelayMs: 1_000,
  });

  return {
    settings,
    makeStore,
    advance(ms: number) {
      currentTime += ms;
    },
  };
}

function oneJobWorkflow(id = 'workflow-1', maxAttempts = 3) {
  return {
    id,
    jobs: [{ id: 'job-1', maxAttempts }],
  };
}

const PRODUCT_CONTEXT_REF = {
  contextId: 'product-marketing-context' as const,
  revision: 7,
  sha256: 'a'.repeat(64),
};

function createApprovalChain(
  store: CustomerMarketingWorkflowStore,
  productContextRef?: typeof PRODUCT_CONTEXT_REF,
) {
  store.createWorkflow({
    id: 'workflow-1',
    jobs: [{ id: 'job-1' }],
    ...(productContextRef ? { productContextRef } : {}),
  });
  const claim = store.claimNextJob('workflow-1', { workerId: 'reviewer' })!;
  const artifact = store.appendApprovalArtifact(
    'workflow-1',
    'job-1',
    claim.lease!.token,
    { id: 'approval-artifact', content: 'Reviewable campaign' },
  );
  const approval = store.requestApproval('workflow-1', 'job-1', claim.lease!.token, {
    id: 'approval-1',
    artifactId: artifact.id,
    digest: artifact.sha256,
  });
  return { artifact, approval };
}

function createPendingApproval(store: CustomerMarketingWorkflowStore) {
  store.createWorkflow(oneJobWorkflow());
  const claim = store.claimNextJob('workflow-1', { workerId: 'receipt-reviewer' })!;
  const artifact = store.appendApprovalArtifact(
    'workflow-1',
    'job-1',
    claim.lease!.token,
    { id: 'receipt-artifact', content: 'Canonical approval manifest' },
  );
  store.requestApproval('workflow-1', 'job-1', claim.lease!.token, {
    id: 'approval-1',
    artifactId: artifact.id,
    digest: artifact.sha256,
  });
  return artifact;
}

describe('CustomerMarketingWorkflowStore', () => {
  it('persists revisions across store instances under a hashed workspace key', () => {
    const test = harness();
    const first = test.makeStore();

    first.createWorkflow(oneJobWorkflow());
    expect(first.getSnapshot().revision).toBe(1);

    const second = test.makeStore();
    expect(second.getWorkflow('workflow-1')?.jobs[0]?.status).toBe('pending');
    second.createWorkflow({ id: 'workflow-2', jobs: [{ id: 'job-2' }] });
    expect(first.getSnapshot().revision).toBe(2);

    const [storageKey] = Array.from(test.settings.values.keys());
    expect(storageKey).toMatch(/^customer_marketing_workflows:v1:[a-f0-9]{64}$/);
    expect(storageKey).not.toContain('workspace-a');
  });

  it('isolates workflows belonging to two workspaces', () => {
    const settings = new MemorySettings();
    const first = harness(settings, 'workspace-a').makeStore();
    const second = harness(settings, 'workspace-b').makeStore();

    first.createWorkflow(oneJobWorkflow('first'));
    second.createWorkflow(oneJobWorkflow('second'));

    expect(first.getWorkflow('first')).not.toBeNull();
    expect(first.getWorkflow('second')).toBeNull();
    expect(second.getWorkflow('second')).not.toBeNull();
    expect(settings.values.size).toBe(2);
    for (const key of settings.values.keys()) {
      expect(key).not.toContain('workspace-a');
      expect(key).not.toContain('workspace-b');
    }
  });

  it('rejects missing dependencies, duplicate jobs, and cycles without persisting', () => {
    const test = harness();
    const store = test.makeStore();

    expect(() => store.createWorkflow({
      id: 'missing',
      jobs: [{ id: 'publish', dependsOn: ['draft'] }],
    })).toThrow(/missing dependency/i);
    expect(() => store.createWorkflow({
      id: 'duplicate',
      jobs: [{ id: 'draft' }, { id: 'draft' }],
    })).toThrow(/duplicate job/i);
    expect(() => store.createWorkflow({
      id: 'cycle',
      jobs: [
        { id: 'draft', dependsOn: ['publish'] },
        { id: 'publish', dependsOn: ['draft'] },
      ],
    })).toThrow(/cycle/i);
    expect(test.settings.values.size).toBe(0);
  });

  it('claims in dependency order and blocks after retry backoff exhausts max attempts', () => {
    const test = harness();
    const store = test.makeStore();
    store.createWorkflow({
      id: 'campaign',
      jobs: [
        { id: 'draft', maxAttempts: 2 },
        { id: 'publish', dependsOn: ['draft'] },
      ],
    });

    const firstClaim = store.claimNextJob('campaign', { workerId: 'local-worker' });
    expect(firstClaim).toMatchObject({ id: 'draft', attempts: 1, status: 'running' });
    const firstFailure = store.failJob(
      'campaign',
      'draft',
      firstClaim!.lease!.token,
      { error: 'temporary failure' },
    );
    expect(firstFailure).toMatchObject({
      status: 'retry_scheduled',
      nextAttemptAt: '2026-07-22T00:00:01.000Z',
    });
    expect(store.claimNextJob('campaign', { workerId: 'local-worker' })).toBeNull();

    test.advance(1_000);
    const secondClaim = store.claimNextJob('campaign', { workerId: 'local-worker' });
    expect(secondClaim).toMatchObject({ id: 'draft', attempts: 2 });
    const finalFailure = store.failJob(
      'campaign',
      'draft',
      secondClaim!.lease!.token,
      { error: 'permanent failure' },
    );

    expect(finalFailure.status).toBe('blocked');
    expect(store.getWorkflow('campaign')).toMatchObject({
      status: 'blocked',
      jobs: [
        { id: 'draft', status: 'blocked' },
        { id: 'publish', status: 'blocked' },
      ],
    });
  });

  it('recovers expired leases and resumes persisted in-flight work', () => {
    const test = harness();
    const first = test.makeStore();
    first.createWorkflow(oneJobWorkflow('stale'));
    first.claimNextJob('stale', { workerId: 'worker-a', leaseMs: 500 });

    test.advance(500);
    const second = test.makeStore();
    expect(second.recoverStaleJobs()).toBe(1);
    expect(second.getWorkflow('stale')?.jobs[0]).toMatchObject({
      attempts: 1,
      status: 'retry_scheduled',
      lease: null,
      nextAttemptAt: '2026-07-22T00:00:01.500Z',
    });

    second.resumeWorkflow('stale');
    expect(second.claimNextJob('stale', { workerId: 'worker-b' })).toBeNull();
    test.advance(1_000);
    const resumed = second.claimNextJob('stale', { workerId: 'worker-b' });
    expect(resumed).toMatchObject({ attempts: 2, status: 'running' });
  });

  it('preserves active leases and rejects an expired claimant before recovery', () => {
    const test = harness();
    const store = test.makeStore();
    store.createWorkflow(oneJobWorkflow('leased'));
    const claim = store.claimNextJob('leased', { workerId: 'worker-a', leaseMs: 500 })!;

    store.resumeWorkflow('leased');
    expect(store.getWorkflow('leased')?.jobs[0]).toMatchObject({
      status: 'running',
      lease: { token: claim.lease!.token, workerId: 'worker-a' },
    });
    expect(store.claimNextJob('leased', { workerId: 'worker-b' })).toBeNull();

    test.advance(500);
    expect(() => store.completeJob('leased', 'job-1', claim.lease!.token, {
      id: 'late-artifact',
      content: 'stale write',
    })).toThrow(/lease has expired/i);
    expect(store.getArtifact('late-artifact')).toBeNull();

    store.resumeWorkflow('leased');
    expect(store.getWorkflow('leased')?.jobs[0]).toMatchObject({
      status: 'retry_scheduled',
      lease: null,
      nextAttemptAt: '2026-07-22T00:00:01.500Z',
    });
  });

  it('creates completion artifacts with SHA-256 exactly once', () => {
    const test = harness();
    const store = test.makeStore();
    store.createWorkflow(oneJobWorkflow());
    const claim = store.claimNextJob('workflow-1', { workerId: 'worker' })!;
    const artifact = {
      id: 'artifact-1',
      content: 'local campaign draft',
      mediaType: 'text/markdown',
    };

    const completed = store.completeJob('workflow-1', 'job-1', claim.lease!.token, artifact);
    expect(completed.status).toBe('completed');
    expect(store.getArtifact('artifact-1')).toMatchObject({
      ...artifact,
      sha256: createHash('sha256').update(artifact.content, 'utf8').digest('hex'),
      revision: 1,
    });
    const revision = store.getSnapshot().revision;

    store.completeJob('workflow-1', 'job-1', claim.lease!.token, artifact);
    expect(store.getSnapshot().revision).toBe(revision);
    expect(store.getWorkflow('workflow-1')).toMatchObject({ status: 'completed' });
  });

  it('appends and revises approval artifacts idempotently and binds reviews to the digest', () => {
    const test = harness();
    const store = test.makeStore();
    store.createWorkflow(oneJobWorkflow());
    const claim = store.claimNextJob('workflow-1', { workerId: 'worker' })!;
    const original = {
      id: 'approval-artifact',
      content: 'Draft A',
      mediaType: 'text/plain',
    };

    const artifact = store.appendApprovalArtifact(
      'workflow-1',
      'job-1',
      claim.lease!.token,
      original,
    );
    const appendRevision = store.getSnapshot().revision;
    store.appendApprovalArtifact('workflow-1', 'job-1', claim.lease!.token, original);
    expect(store.getSnapshot().revision).toBe(appendRevision);

    const revised = store.reviseApprovalArtifact(
      'workflow-1',
      'job-1',
      claim.lease!.token,
      artifact.id,
      { content: 'Draft B', mediaType: 'text/plain' },
    );
    expect(revised).toMatchObject({ revision: 2 });
    const reviseRevision = store.getSnapshot().revision;
    store.reviseApprovalArtifact(
      'workflow-1',
      'job-1',
      claim.lease!.token,
      artifact.id,
      { content: 'Draft B', mediaType: 'text/plain' },
    );
    expect(store.getSnapshot().revision).toBe(reviseRevision);

    const approvalInput = {
      id: 'approval-1',
      artifactId: revised.id,
      digest: revised.sha256,
    };
    store.requestApproval('workflow-1', 'job-1', claim.lease!.token, approvalInput);
    const requestRevision = store.getSnapshot().revision;
    store.requestApproval('workflow-1', 'job-1', claim.lease!.token, approvalInput);
    expect(store.getSnapshot().revision).toBe(requestRevision);
    expect(() => store.reviewApproval('workflow-1', 'approval-1', {
      decision: 'approved',
      digest: '0'.repeat(64),
    })).toThrow(/digest mismatch/i);
    expect(store.getApproval('approval-1')?.status).toBe('pending');
  });

  it('atomically revises pending approval evidence and rebinds its digest', () => {
    const test = harness();
    const store = test.makeStore();
    store.createWorkflow(oneJobWorkflow());
    const claim = store.claimNextJob('workflow-1', { workerId: 'worker' })!;
    const artifact = store.appendApprovalArtifact(
      'workflow-1',
      'job-1',
      claim.lease!.token,
      { id: 'approval-artifact', content: 'Local draft' },
    );
    store.requestApproval('workflow-1', 'job-1', claim.lease!.token, {
      id: 'approval-1',
      artifactId: artifact.id,
      digest: artifact.sha256,
    });

    const revised = store.revisePendingApprovalArtifact(
      'workflow-1',
      'approval-1',
      artifact.sha256,
      { content: 'Director revised draft' },
    );

    expect(revised.artifact).toMatchObject({ content: 'Director revised draft', revision: 2 });
    expect(revised.approval).toMatchObject({
      digest: revised.artifact.sha256,
      revision: 2,
      status: 'pending',
    });
    expect(() => store.revisePendingApprovalArtifact(
      'workflow-1',
      'approval-1',
      artifact.sha256,
      { content: 'Stale overwrite' },
    )).toThrow(/digest changed/i);
    store.reviewApproval('workflow-1', 'approval-1', {
      decision: 'approved',
      digest: revised.approval.digest,
    });
    expect(store.getWorkflow('workflow-1')?.status).toBe('completed');
  });

  it('runs a fully local dependency and approval lifecycle to completion', () => {
    const test = harness();
    const store = test.makeStore();
    store.createWorkflow({
      id: 'campaign',
      jobs: [
        { id: 'draft' },
        { id: 'review', dependsOn: ['draft'] },
      ],
    });

    const draft = store.claimNextJob('campaign', { workerId: 'writer' })!;
    store.completeJob('campaign', 'draft', draft.lease!.token, {
      id: 'draft-output',
      content: 'Campaign draft',
    });

    const review = store.claimNextJob('campaign', { workerId: 'reviewer' })!;
    expect(review.id).toBe('review');
    const approvalArtifact = store.appendApprovalArtifact(
      'campaign',
      'review',
      review.lease!.token,
      { id: 'review-output', content: 'Approved local content' },
    );
    store.requestApproval('campaign', 'review', review.lease!.token, {
      id: 'approval-1',
      artifactId: approvalArtifact.id,
      digest: approvalArtifact.sha256,
    });
    store.reviewApproval('campaign', 'approval-1', {
      decision: 'approved',
      digest: approvalArtifact.sha256,
      note: 'Ready',
    });

    expect(store.getWorkflow('campaign')).toMatchObject({
      status: 'completed',
      jobs: [
        { id: 'draft', status: 'completed' },
        { id: 'review', status: 'completed' },
      ],
    });
  });

  it('blocks the workflow and dependent jobs when an approval is rejected', () => {
    const test = harness();
    const store = test.makeStore();
    store.createWorkflow({
      id: 'campaign',
      jobs: [
        { id: 'review' },
        { id: 'publish', dependsOn: ['review'] },
      ],
    });
    const claim = store.claimNextJob('campaign', { workerId: 'reviewer' })!;
    const artifact = store.appendApprovalArtifact(
      'campaign',
      'review',
      claim.lease!.token,
      { id: 'review-output', content: 'Unsafe claim' },
    );
    store.requestApproval('campaign', 'review', claim.lease!.token, {
      id: 'approval-1',
      artifactId: artifact.id,
      digest: artifact.sha256,
    });

    store.reviewApproval('campaign', 'approval-1', {
      decision: 'rejected',
      digest: artifact.sha256,
      note: 'Claim needs evidence',
    });

    expect(store.getWorkflow('campaign')).toMatchObject({
      status: 'blocked',
      jobs: [
        { id: 'review', status: 'blocked', lastError: 'Claim needs evidence' },
        { id: 'publish', status: 'blocked' },
      ],
    });
  });

  it('binds one product context reference to the workflow, every job, artifact, and approval', () => {
    const test = harness();
    const store = test.makeStore();
    const workflow = store.createWorkflow({
      id: 'campaign',
      productContextRef: PRODUCT_CONTEXT_REF,
      jobs: [
        { id: 'draft' },
        { id: 'review', dependsOn: ['draft'] },
      ],
    });

    const draft = store.claimNextJob('campaign', { workerId: 'writer' })!;
    const draftArtifactInput = { id: 'draft-output', content: 'Campaign draft' };
    store.completeJob('campaign', 'draft', draft.lease!.token, draftArtifactInput);
    const review = store.claimNextJob('campaign', { workerId: 'reviewer' })!;
    const approvalArtifact = store.appendApprovalArtifact(
      'campaign',
      'review',
      review.lease!.token,
      { id: 'review-output', content: 'Reviewable campaign' },
    );
    const approval = store.requestApproval('campaign', 'review', review.lease!.token, {
      id: 'approval-1',
      artifactId: approvalArtifact.id,
      digest: approvalArtifact.sha256,
    });

    expect(workflow.productContextRef).toEqual(PRODUCT_CONTEXT_REF);
    expect(workflow.jobs.every((job) => (
      JSON.stringify(job.productContextRef) === JSON.stringify(PRODUCT_CONTEXT_REF)
    ))).toBe(true);
    expect(store.getArtifact(draftArtifactInput.id)?.productContextRef)
      .toEqual(PRODUCT_CONTEXT_REF);
    expect(approvalArtifact.productContextRef).toEqual(PRODUCT_CONTEXT_REF);
    expect(approval.productContextRef).toEqual(PRODUCT_CONTEXT_REF);
  });

  it('rejects malformed product context references before persistence', () => {
    const test = harness();
    const store = test.makeStore();
    const invalidRefs = [
      { ...PRODUCT_CONTEXT_REF, contextId: 'renderer-context' },
      { ...PRODUCT_CONTEXT_REF, revision: 0 },
      { ...PRODUCT_CONTEXT_REF, sha256: 'A'.repeat(64) },
      { ...PRODUCT_CONTEXT_REF, workspaceId: 'renderer-controlled' },
    ];

    for (const productContextRef of invalidRefs) {
      expect(() => store.createWorkflow({
        ...oneJobWorkflow(`invalid-${test.settings.values.size}`),
        productContextRef,
      } as never)).toThrow(/product context reference is invalid/i);
    }
    expect(test.settings.values.size).toBe(0);
  });

  it('rejects caller-supplied product context references on artifact and approval inputs', () => {
    const test = harness();
    const store = test.makeStore();
    store.createWorkflow({
      ...oneJobWorkflow(),
      productContextRef: PRODUCT_CONTEXT_REF,
    });
    const claim = store.claimNextJob('workflow-1', { workerId: 'reviewer' })!;

    expect(() => store.appendApprovalArtifact(
      'workflow-1',
      'job-1',
      claim.lease!.token,
      {
        id: 'unsafe-artifact',
        content: 'Renderer-controlled context',
        productContextRef: PRODUCT_CONTEXT_REF,
      } as never,
    )).toThrow(/unsupported field/i);

    const artifact = store.appendApprovalArtifact(
      'workflow-1',
      'job-1',
      claim.lease!.token,
      { id: 'approval-artifact', content: 'Store-bound context' },
    );
    expect(() => store.requestApproval('workflow-1', 'job-1', claim.lease!.token, {
      id: 'unsafe-approval',
      artifactId: artifact.id,
      digest: artifact.sha256,
      productContextRef: PRODUCT_CONTEXT_REF,
    } as never)).toThrow(/unsupported field/i);
    expect(store.getApproval('unsafe-approval')).toBeNull();
  });

  it('persists null product context references when workflow callers omit the binding', () => {
    const test = harness();
    const store = test.makeStore();
    const { artifact, approval } = createApprovalChain(store);
    const workflow = store.getWorkflow('workflow-1')!;

    expect(workflow.productContextRef).toBeNull();
    expect(workflow.jobs[0]?.productContextRef).toBeNull();
    expect(artifact.productContextRef).toBeNull();
    expect(approval.productContextRef).toBeNull();
  });

  it('normalizes legacy V1 records missing product context references to null without quarantine', () => {
    const test = harness();
    const first = test.makeStore();
    createApprovalChain(first);
    const storageKey = Array.from(test.settings.values.keys())[0]!;
    const legacy = JSON.parse(test.settings.values.get(storageKey)!) as {
      workflows: Array<{
        productContextRef?: unknown;
        jobs: Array<{ productContextRef?: unknown }>;
      }>;
      artifacts: Array<{ productContextRef?: unknown }>;
      approvals: Array<{ productContextRef?: unknown }>;
    };
    delete legacy.workflows[0]?.productContextRef;
    delete legacy.workflows[0]?.jobs[0]?.productContextRef;
    delete legacy.artifacts[0]?.productContextRef;
    delete legacy.approvals[0]?.productContextRef;
    test.settings.values.set(storageKey, JSON.stringify(legacy));

    const snapshot = test.makeStore().getSnapshot();

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.workflows[0]?.productContextRef).toBeNull();
    expect(snapshot.workflows[0]?.jobs[0]?.productContextRef).toBeNull();
    expect(snapshot.artifacts[0]?.productContextRef).toBeNull();
    expect(snapshot.approvals[0]?.productContextRef).toBeNull();
    expect(test.settings.values.has(`${storageKey}:quarantine`)).toBe(false);
    expect(JSON.parse(test.settings.values.get(storageKey)!).workflows[0])
      .not.toHaveProperty('productContextRef');
  });

  it.each(['workflow', 'job', 'artifact', 'approval'] as const)(
    'quarantines a tampered %s product context reference and fails closed',
    (layer) => {
      const test = harness();
      const store = test.makeStore();
      createApprovalChain(store, PRODUCT_CONTEXT_REF);
      const storageKey = Array.from(test.settings.values.keys())[0]!;
      const persisted = JSON.parse(test.settings.values.get(storageKey)!) as {
        workflows: Array<{
          productContextRef: typeof PRODUCT_CONTEXT_REF;
          jobs: Array<{ productContextRef: typeof PRODUCT_CONTEXT_REF }>;
        }>;
        artifacts: Array<{ productContextRef: typeof PRODUCT_CONTEXT_REF }>;
        approvals: Array<{ productContextRef: typeof PRODUCT_CONTEXT_REF }>;
      };
      const tamperedRef = { ...PRODUCT_CONTEXT_REF, revision: PRODUCT_CONTEXT_REF.revision + 1 };
      if (layer === 'workflow') persisted.workflows[0]!.productContextRef = tamperedRef;
      if (layer === 'job') persisted.workflows[0]!.jobs[0]!.productContextRef = tamperedRef;
      if (layer === 'artifact') persisted.artifacts[0]!.productContextRef = tamperedRef;
      if (layer === 'approval') persisted.approvals[0]!.productContextRef = tamperedRef;
      test.settings.values.set(storageKey, JSON.stringify(persisted));

      expect(() => store.getSnapshot()).toThrow(WorkflowStoreCorruptionError);
      expect(test.settings.values.has(storageKey)).toBe(false);
      expect(test.settings.values.get(`${storageKey}:quarantine`))
        .toContain('product context reference mismatch');
    },
  );

  it('fails closed and quarantines malformed persisted data', () => {
    const test = harness();
    const store = test.makeStore();
    store.createWorkflow(oneJobWorkflow());
    const [storageKey] = Array.from(test.settings.values.keys());
    test.settings.values.set(storageKey, '{malformed');

    expect(() => store.getSnapshot()).toThrow(WorkflowStoreCorruptionError);
    expect(test.settings.values.has(storageKey)).toBe(false);
    const quarantineKey = Array.from(test.settings.values.keys()).find((key) => key.endsWith(':quarantine'));
    expect(quarantineKey).toBe(`${storageKey}:quarantine`);
    expect(test.settings.values.get(quarantineKey!)).toContain('{malformed');
  });

  it('rejects executable or external-action-shaped job definitions', () => {
    const test = harness();
    const store = test.makeStore();

    expect(() => store.createWorkflow({
      id: 'unsafe',
      jobs: [{ id: 'job-1', externalAction: 'post-to-social' }],
    } as never)).toThrow(/unsupported field/i);
    expect(() => store.createWorkflow({
      id: 'unsafe-function',
      jobs: [{ id: 'job-1', run: () => undefined }],
    } as never)).toThrow(/unsupported field/i);
    expect(test.settings.values.size).toBe(0);
  });

  it.each(['approved', 'rejected'] as const)(
    'persists an atomic %s receipt with canonical digest and zero external effects',
    (decision) => {
      class TrackingSettings extends MemorySettings {
        readonly writes: string[] = [];

        override setSetting(key: string, value: string): void {
          this.writes.push(value);
          super.setSetting(key, value);
        }
      }

      const settings = new TrackingSettings();
      const test = harness(settings);
      const store = test.makeStore();
      const artifact = createPendingApproval(store);
      const receiptContext = {
        id: `receipt-${decision}`,
        manifestDigest: artifact.sha256,
        reviewerHash: 'a'.repeat(64),
        policyRevision: 'cmr-306.v1' as const,
        externalActionPerformed: false as const,
      };
      const writesBeforeReview = settings.writes.length;

      store.reviewApproval('workflow-1', 'approval-1', {
        decision,
        digest: artifact.sha256,
        receiptContext,
      });

      expect(settings.writes).toHaveLength(writesBeforeReview + 1);
      const persisted = JSON.parse(settings.writes.at(-1)!) as {
        approvals: Array<{ id: string; status: string; reviewedAt: string | null }>;
        receipts: Array<{
          id: string;
          workflowId: string;
          approvalId: string;
          manifestDigest: string;
          decision: string;
          reviewerHash: string;
          reviewedAt: string;
          policyRevision: string;
          externalActionPerformed: boolean;
          receiptDigest: string;
        }>;
        workflows: Array<{ id: string; status: string }>;
      };
      const approval = persisted.approvals.find((item) => item.id === 'approval-1')!;
      const receipt = persisted.receipts.find((item) => item.id === receiptContext.id)!;
      expect(approval).toMatchObject({ status: decision, reviewedAt: receipt.reviewedAt });
      expect(persisted.workflows[0]?.status).toBe(
        decision === 'approved' ? 'completed' : 'blocked',
      );
      expect(receipt).toMatchObject({
        workflowId: 'workflow-1',
        approvalId: 'approval-1',
        manifestDigest: artifact.sha256,
        decision,
        reviewerHash: 'a'.repeat(64),
        policyRevision: 'cmr-306.v1',
        externalActionPerformed: false,
      });
      const canonicalFields = {
        id: receipt.id,
        workflowId: receipt.workflowId,
        approvalId: receipt.approvalId,
        manifestDigest: receipt.manifestDigest,
        decision: receipt.decision,
        reviewerHash: receipt.reviewerHash,
        reviewedAt: receipt.reviewedAt,
        policyRevision: receipt.policyRevision,
        externalActionPerformed: receipt.externalActionPerformed,
      };
      expect(receipt.receiptDigest).toBe(
        createHash('sha256').update(JSON.stringify(canonicalFields), 'utf8').digest('hex'),
      );
    },
  );

  it('keeps exact receipt replay idempotent and conflicts on altered replay context', () => {
    const test = harness();
    const store = test.makeStore();
    const artifact = createPendingApproval(store);
    const review = {
      decision: 'approved' as const,
      digest: artifact.sha256,
      note: 'Local approval only',
      receiptContext: {
        id: 'receipt-1',
        manifestDigest: artifact.sha256,
        reviewerHash: 'b'.repeat(64),
        policyRevision: 'cmr-306.v1' as const,
        externalActionPerformed: false as const,
      },
    };

    store.reviewApproval('workflow-1', 'approval-1', review);
    const revision = store.getSnapshot().revision;
    const originalReceipt = store.getReceipt('receipt-1');
    store.reviewApproval('workflow-1', 'approval-1', review);

    expect(store.getSnapshot().revision).toBe(revision);
    expect(store.getReceipt('receipt-1')).toEqual(originalReceipt);
    expect(() => store.reviewApproval('workflow-1', 'approval-1', {
      ...review,
      receiptContext: {
        ...review.receiptContext,
        reviewerHash: 'c'.repeat(64),
      },
    })).toThrow(WorkflowStoreConflictError);
    expect(() => store.reviewApproval('workflow-1', 'approval-1', {
      ...review,
      decision: 'rejected',
    })).toThrow(WorkflowStoreConflictError);
    expect(store.getSnapshot().revision).toBe(revision);
  });

  it('quarantines a tampered persisted receipt and fails closed', () => {
    const test = harness();
    const store = test.makeStore();
    const artifact = createPendingApproval(store);
    store.reviewApproval('workflow-1', 'approval-1', {
      decision: 'approved',
      digest: artifact.sha256,
      receiptContext: {
        id: 'receipt-1',
        manifestDigest: artifact.sha256,
        reviewerHash: 'd'.repeat(64),
        policyRevision: 'cmr-306.v1',
        externalActionPerformed: false,
      },
    });
    const storageKey = Array.from(test.settings.values.keys()).find(
      (key) => !key.endsWith(':quarantine'),
    )!;
    const persisted = JSON.parse(test.settings.values.get(storageKey)!) as {
      receipts: Array<{ id: string; reviewerHash: string }>;
    };
    persisted.receipts.find((receipt) => receipt.id === 'receipt-1')!.reviewerHash = 'e'.repeat(64);
    test.settings.values.set(storageKey, JSON.stringify(persisted));

    expect(() => store.getSnapshot()).toThrow(WorkflowStoreCorruptionError);
    expect(test.settings.values.has(storageKey)).toBe(false);
    const quarantineKey = `${storageKey}:quarantine`;
    expect(test.settings.values.has(quarantineKey)).toBe(true);
    expect(test.settings.values.get(quarantineKey)).toContain('digest mismatch');
  });

  it('reads legacy V1 records that do not contain a receipts collection', () => {
    const test = harness();
    const first = test.makeStore();
    first.createWorkflow(oneJobWorkflow('legacy-workflow'));
    const storageKey = Array.from(test.settings.values.keys())[0]!;
    const legacy = JSON.parse(test.settings.values.get(storageKey)!) as Record<string, unknown>;
    delete legacy.receipts;
    test.settings.values.set(storageKey, JSON.stringify(legacy));

    const snapshot = test.makeStore().getSnapshot();

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.receipts).toEqual([]);
    expect(snapshot.workflows).toMatchObject([
      { id: 'legacy-workflow', status: 'pending', revision: 1 },
    ]);
    expect(JSON.parse(test.settings.values.get(storageKey)!)).not.toHaveProperty('receipts');
  });
});
