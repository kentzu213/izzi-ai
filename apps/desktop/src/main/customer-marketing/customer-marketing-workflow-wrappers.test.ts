import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  CustomerMarketingPersistedResourceRef,
  CustomerMarketingWorkflowAuditReceiptV1,
  CustomerMarketingWorkflowTarget,
} from '../../shared/customer-marketing-types';
import {
  CustomerMarketingWorkflowStore,
  WorkflowStoreConflictError,
  WorkflowStoreValidationError,
  type WorkflowSettings,
} from './customer-marketing-workflow-store';
import { createCustomerMarketingWorkflowWrappers } from './customer-marketing-workflow-wrappers';

class MemorySettings implements WorkflowSettings {
  readonly values = new Map<string, string>();
  getSetting(key: string): string | null { return this.values.get(key) ?? null; }
  setSetting(key: string, value: string): void { this.values.set(key, value); }
  deleteSetting(key: string): void { this.values.delete(key); }
}

function resourceRef(
  kind: 'content' | 'campaign',
  overrides: Partial<CustomerMarketingPersistedResourceRef> = {},
): CustomerMarketingPersistedResourceRef {
  return {
    id: `${kind}-1`,
    workspaceId: 'workspace-a',
    kind,
    revision: 1,
    sha256: kind === 'content' ? 'a'.repeat(64) : 'b'.repeat(64),
    title: kind === 'content' ? 'Launch content' : 'Launch campaign',
    ...overrides,
  } as CustomerMarketingPersistedResourceRef;
}

function harness(options: { approvalTtlMs?: number } = {}) {
  const settings = new MemorySettings();
  let currentTime = Date.parse('2026-07-26T00:00:00.000Z');
  let leaseSequence = 0;
  let nonceSequence = 0;
  const now = () => currentTime;
  const store = new CustomerMarketingWorkflowStore(settings, 'workspace-a', {
    now,
    createId: () => `lease-${++leaseSequence}`,
  });
  const wrappers = createCustomerMarketingWorkflowWrappers(store, 'workspace-a', {
    now,
    createId: () => `nonce-${++nonceSequence}`,
    ...options,
  });
  return {
    settings,
    store,
    wrappers,
    advance(ms: number) { currentTime += ms; },
  };
}

function receiptDigest(receipt: CustomerMarketingWorkflowAuditReceiptV1): string {
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
  return createHash('sha256').update(JSON.stringify(canonicalFields), 'utf8').digest('hex');
}

describe('CMR-306 customer marketing workflow wrappers', () => {
  it.each([
    ['social', 'content'],
    ['seo', 'content'],
    ['email', 'content'],
    ['crm', 'campaign'],
  ] as const)('prepares a durable canonical %s workflow from a persisted %s ref', (target, sourceKind) => {
    const test = harness();
    const prepared = test.wrappers[target].prepare({
      target,
      inputRef: resourceRef(sourceKind),
    });

    expect(Object.keys(prepared.manifest)).toEqual([
      'kind', 'title', 'workspaceHash', 'inputRef', 'grant', 'dryRun', 'nonce', 'createdAt',
    ]);
    expect(prepared.manifest).toMatchObject({
      kind: target,
      inputRef: { id: `${sourceKind}-1`, kind: sourceKind, revision: 1 },
      grant: {
        operations: ['read', 'draft', 'validate'],
        channels: [target],
        limits: { maxItems: 1, maxRecipients: 0, maxSpendVnd: 0 },
        policyRevision: 'cmr-306.v1',
      },
      dryRun: { externalActionPerformed: false },
    });
    expect(Object.keys(prepared.manifest.inputRef)).toEqual(['id', 'kind', 'revision', 'sha256']);
    expect(Object.keys(prepared.manifest.grant)).toEqual([
      'operations', 'channels', 'limits', 'expiresAt', 'policyRevision',
    ]);
    expect(Object.keys(prepared.manifest.grant.limits)).toEqual([
      'maxItems', 'maxRecipients', 'maxSpendVnd',
    ]);
    expect(Object.keys(prepared.manifest.dryRun)).toEqual([
      'steps', 'outputs', 'warnings', 'externalActionPerformed',
    ]);
    expect(prepared.manifestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.status).toBe('pending');
    expect(test.wrappers[target].list()).toEqual([prepared]);
    expect(test.store.getWorkflow(prepared.workflowId)).toMatchObject({
      status: 'awaiting_approval',
      jobs: [
        { id: 'validate', status: 'completed' },
        { id: 'dry_run', status: 'completed' },
        { id: 'approval', status: 'awaiting_approval' },
      ],
    });
  });

  it('rejects invalid source, target, workspace, unsafe fields, and hard-denied operations', () => {
    const test = harness();

    expect(() => test.wrappers.social.prepare({
      target: 'social',
      inputRef: resourceRef('campaign'),
    })).toThrow(/content/i);
    expect(() => test.wrappers.crm.prepare({
      target: 'crm',
      inputRef: resourceRef('content'),
    })).toThrow(/campaign/i);
    expect(() => test.wrappers.social.prepare({
      target: 'seo',
      inputRef: resourceRef('content'),
    } as never)).toThrow(/target/i);
    expect(() => test.wrappers.social.prepare({
      target: 'social',
      inputRef: resourceRef('content', { workspaceId: 'workspace-b' }),
    })).toThrow(/workspace/i);
    expect(() => test.wrappers.social.prepare({
      target: 'social',
      inputRef: { ...resourceRef('content'), path: 'C:\\private' },
    } as never)).toThrow(/unsupported field/i);

    for (const operation of [
      'publish', 'send', 'bulk', 'spend', 'integration.write', 'contacts.write',
    ] as const) {
      expect(() => test.wrappers.social.prepare({
        target: 'social',
        inputRef: resourceRef('content'),
        operations: ['read', 'draft', 'validate', operation],
      })).toThrow(/hard-denied/i);
    }
    expect(test.settings.values.size).toBe(0);
  });

  it('creates immutable approve and reject receipts with store-computed canonical digests', () => {
    const test = harness();
    const approved = test.wrappers.social.prepare({
      target: 'social',
      inputRef: resourceRef('content'),
    });
    const approvedReview = test.wrappers.social.review({
      workflowId: approved.workflowId,
      approvalId: approved.approvalId,
      manifestDigest: approved.manifestDigest,
      decision: 'approved',
      reviewerHash: 'c'.repeat(64),
      note: 'Approved locally',
    });

    expect(approvedReview.status).toBe('approved');
    expect(approvedReview.receipt).toMatchObject({
      workflowId: approved.workflowId,
      approvalId: approved.approvalId,
      manifestDigest: approved.manifestDigest,
      decision: 'approved',
      reviewerHash: 'c'.repeat(64),
      policyRevision: 'cmr-306.v1',
      externalActionPerformed: false,
    });
    expect(approvedReview.receipt!.receiptDigest).toBe(receiptDigest(approvedReview.receipt!));

    const rejected = test.wrappers.crm.prepare({
      target: 'crm',
      inputRef: resourceRef('campaign', { revision: 2, sha256: 'd'.repeat(64) }),
    });
    const rejectedReview = test.wrappers.crm.review({
      workflowId: rejected.workflowId,
      approvalId: rejected.approvalId,
      manifestDigest: rejected.manifestDigest,
      decision: 'rejected',
      reviewerHash: 'e'.repeat(64),
    });

    expect(rejectedReview.status).toBe('rejected');
    expect(rejectedReview.receipt?.decision).toBe('rejected');
    expect(test.store.getWorkflow(rejected.workflowId)?.status).toBe('blocked');
  });

  it('rejects digest tampering and makes exact review replay idempotent', () => {
    const test = harness();
    const prepared = test.wrappers.email.prepare({
      target: 'email',
      inputRef: resourceRef('content'),
    });
    const review = {
      workflowId: prepared.workflowId,
      approvalId: prepared.approvalId,
      manifestDigest: prepared.manifestDigest,
      decision: 'approved' as const,
      reviewerHash: 'f'.repeat(64),
    };

    expect(() => test.wrappers.email.review({
      ...review,
      manifestDigest: '0'.repeat(64),
    })).toThrow(/digest mismatch/i);
    const first = test.wrappers.email.review(review);
    const revision = test.store.getSnapshot().revision;
    const replay = test.wrappers.email.review(review);

    expect(replay).toEqual(first);
    expect(test.store.getSnapshot().revision).toBe(revision);
    expect(() => test.wrappers.email.review({
      ...review,
      reviewerHash: '1'.repeat(64),
    })).toThrow(WorkflowStoreConflictError);
    expect(() => test.wrappers.email.review({
      ...review,
      decision: 'rejected',
    })).toThrow(WorkflowStoreConflictError);
  });

  it('fails closed after grant expiry but permits an exact replay of an earlier review', () => {
    const test = harness({ approvalTtlMs: 1_000 });
    const expired = test.wrappers.seo.prepare({
      target: 'seo',
      inputRef: resourceRef('content'),
    });
    test.advance(1_000);

    expect(() => test.wrappers.seo.review({
      workflowId: expired.workflowId,
      approvalId: expired.approvalId,
      manifestDigest: expired.manifestDigest,
      decision: 'approved',
      reviewerHash: '2'.repeat(64),
    })).toThrow(/expired/i);
    expect(test.store.getReceiptByApproval(expired.approvalId)).toBeNull();

    const activeTest = harness({ approvalTtlMs: 1_000 });
    const active = activeTest.wrappers.seo.prepare({
      target: 'seo',
      inputRef: resourceRef('content'),
    });
    const input = {
      workflowId: active.workflowId,
      approvalId: active.approvalId,
      manifestDigest: active.manifestDigest,
      decision: 'approved' as const,
      reviewerHash: '3'.repeat(64),
    };
    const reviewed = activeTest.wrappers.seo.review(input);
    activeTest.advance(1_000);
    expect(activeTest.wrappers.seo.review(input)).toEqual(reviewed);
  });

  it('detects store/workspace mismatch and semantically corrupted manifests', () => {
    const test = harness();
    expect(() => createCustomerMarketingWorkflowWrappers(
      test.store,
      'workspace-b',
    )).toThrow(/workspace/i);

    const prepared = test.wrappers.social.prepare({
      target: 'social',
      inputRef: resourceRef('content'),
    });
    const [[storageKey, raw]] = Array.from(test.settings.values.entries());
    const persisted = JSON.parse(raw) as {
      artifacts: Array<{ id: string; content: string; sha256: string }>;
      approvals: Array<{ id: string; digest: string }>;
    };
    const artifact = persisted.artifacts.find((item) => item.id.endsWith('-manifest'))!;
    const manifest = JSON.parse(artifact.content) as { kind: CustomerMarketingWorkflowTarget };
    manifest.kind = 'crm';
    artifact.content = JSON.stringify(manifest);
    artifact.sha256 = createHash('sha256').update(artifact.content, 'utf8').digest('hex');
    persisted.approvals.find((item) => item.id === prepared.approvalId)!.digest = artifact.sha256;
    test.settings.values.set(storageKey, JSON.stringify(persisted));

    expect(() => test.wrappers.social.list()).toThrow(WorkflowStoreValidationError);
  });

  it('persists no connector, token, path, contact-list, spend, or external action effect', () => {
    const test = harness();
    const prepared = test.wrappers.crm.prepare({
      target: 'crm',
      inputRef: resourceRef('campaign'),
      operations: ['read', 'draft', 'validate'],
    });
    const reviewed = test.wrappers.crm.review({
      workflowId: prepared.workflowId,
      approvalId: prepared.approvalId,
      manifestDigest: prepared.manifestDigest,
      decision: 'approved',
      reviewerHash: '4'.repeat(64),
    });
    const persisted = Array.from(test.settings.values.values()).join('\n');

    expect(prepared.manifest.grant.limits).toEqual({
      maxItems: 1,
      maxRecipients: 0,
      maxSpendVnd: 0,
    });
    expect(reviewed.receipt?.externalActionPerformed).toBe(false);
    expect(persisted).not.toMatch(/connector|token|contactList|contact-list|integration\.write|contacts\.write/i);
    expect(persisted).not.toContain('externalActionPerformed":true');
  });
});
