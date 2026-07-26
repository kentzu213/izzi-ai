import { describe, expect, it } from 'vitest';
import type { CustomerMarketingActionGateRequest } from '../../shared/customer-marketing-action-gate-types';
import type { CustomerMarketingWorkflowRecord } from '../../shared/customer-marketing-types';
import {
  CUSTOMER_MARKETING_ACTION_GATE_EXECUTOR_ENABLED,
  evaluateCustomerMarketingActionGate,
  preflightCustomerMarketingActionGateRequest,
  validateCustomerMarketingActionGateApproval,
  type CustomerMarketingActionGateSourceEvidence,
} from './customer-marketing-action-gate';

const NOW = Date.parse('2026-07-26T01:00:00.000Z');
const DIGEST = 'a'.repeat(64);
const SOURCE_DIGEST = 'b'.repeat(64);
const REVIEWER_HASH = 'c'.repeat(64);
const RECEIPT_DIGEST = 'd'.repeat(64);

function request(
  overrides: Partial<CustomerMarketingActionGateRequest> = {},
): CustomerMarketingActionGateRequest {
  return {
    action: 'publish',
    target: 'social',
    workflowId: 'cmr306-social-workflow-1',
    approvalId: 'cmr306-social-workflow-1-approval',
    manifestDigest: DIGEST,
    provider: 'facebook',
    metadata: { itemCount: 1, recipientCount: 0, spendVnd: 0 },
    ...overrides,
  };
}

function workflowFor(
  gateRequest = request(),
  overrides: Partial<CustomerMarketingWorkflowRecord> = {},
): CustomerMarketingWorkflowRecord {
  const sourceKind = gateRequest.target === 'crm' ? 'campaign' : 'content';
  return {
    workflowId: gateRequest.workflowId,
    approvalId: gateRequest.approvalId,
    manifestDigest: gateRequest.manifestDigest,
    status: 'approved',
    manifest: {
      kind: gateRequest.target,
      title: 'Verified local dry-run',
      workspaceHash: 'e'.repeat(64),
      inputRef: {
        id: 'source-1',
        kind: sourceKind,
        revision: 3,
        sha256: SOURCE_DIGEST,
      },
      grant: {
        operations: ['read', 'draft', 'validate'],
        channels: [gateRequest.target],
        limits: { maxItems: 1, maxRecipients: 0, maxSpendVnd: 0 },
        expiresAt: new Date(NOW + 60_000).toISOString(),
        policyRevision: 'cmr-306.v1',
      },
      dryRun: {
        steps: ['validate'],
        outputs: ['manifest'],
        warnings: ['Local only'],
        externalActionPerformed: false,
      },
      nonce: 'nonce-1',
      createdAt: new Date(NOW - 60_000).toISOString(),
    },
    receipt: {
      id: 'receipt-1',
      workflowId: gateRequest.workflowId,
      approvalId: gateRequest.approvalId,
      manifestDigest: gateRequest.manifestDigest,
      decision: 'approved',
      reviewerHash: REVIEWER_HASH,
      reviewedAt: new Date(NOW - 1_000).toISOString(),
      policyRevision: 'cmr-306.v1',
      externalActionPerformed: false,
      receiptDigest: RECEIPT_DIGEST,
    },
    ...overrides,
  };
}

function sourceFor(
  workflow: CustomerMarketingWorkflowRecord,
  overrides: Partial<CustomerMarketingActionGateSourceEvidence> = {},
): CustomerMarketingActionGateSourceEvidence {
  return {
    id: workflow.manifest.inputRef.id,
    kind: workflow.manifest.inputRef.kind,
    status: 'approved',
    revision: workflow.manifest.inputRef.revision,
    sha256: workflow.manifest.inputRef.sha256,
    ...overrides,
  };
}

describe('CMR-402 request preflight', () => {
  it.each([
    [request(), null],
    [request({ target: 'seo', provider: 'google' }), null],
    [request({ target: 'social', provider: 'google' }), 'provider_unavailable'],
    [request({ action: 'bulk_email', target: 'social', provider: 'facebook' }), 'provider_unavailable'],
    [request({ action: 'spend', provider: 'telegram', metadata: { itemCount: 0, recipientCount: 0, spendVnd: 1 } }), 'provider_unavailable'],
    [request({ metadata: { itemCount: 0, recipientCount: 0, spendVnd: 0 } }), 'invalid_request'],
  ] as const)('validates target/provider/action scope without authority data', (input, reason) => {
    expect(preflightCustomerMarketingActionGateRequest(input)?.denialReason ?? null).toBe(reason);
  });
});

describe('CMR-402 approval validation', () => {
  it('requires a bound approved workflow and receipt', () => {
    const gateRequest = request();
    expect(validateCustomerMarketingActionGateApproval(gateRequest, null, NOW))
      .toEqual({ allowed: false, executed: false, denialReason: 'approval_required' });
    expect(validateCustomerMarketingActionGateApproval(
      gateRequest,
      workflowFor(gateRequest, { status: 'pending', receipt: null }),
      NOW,
    )?.denialReason).toBe('approval_required');
  });

  it('rejects forged workflow, approval, and manifest bindings', () => {
    const gateRequest = request();
    expect(validateCustomerMarketingActionGateApproval(
      gateRequest,
      workflowFor(gateRequest, { workflowId: 'different-workflow' }),
      NOW,
    )?.denialReason).toBe('approval_invalid');
    expect(validateCustomerMarketingActionGateApproval(
      gateRequest,
      workflowFor(gateRequest, { manifestDigest: 'f'.repeat(64) }),
      NOW,
    )?.denialReason).toBe('manifest_mismatch');
  });

  it('rejects invalid named-review evidence and the exact expiry boundary', () => {
    const gateRequest = request();
    const invalidReviewer = workflowFor(gateRequest);
    invalidReviewer.receipt = { ...invalidReviewer.receipt!, reviewerHash: 'named-user-from-renderer' };
    expect(validateCustomerMarketingActionGateApproval(gateRequest, invalidReviewer, NOW)?.denialReason)
      .toBe('approval_invalid');

    const expired = workflowFor(gateRequest);
    expired.manifest.grant.expiresAt = new Date(NOW).toISOString();
    expect(validateCustomerMarketingActionGateApproval(gateRequest, expired, NOW)?.denialReason)
      .toBe('approval_invalid');
  });
});

describe('CMR-402 main action gate', () => {
  it.each([
    request(),
    request({
      action: 'spend',
      metadata: { itemCount: 0, recipientCount: 0, spendVnd: 1 },
    }),
    request({
      action: 'bulk_email',
      target: 'email',
      provider: 'email',
      metadata: { itemCount: 1, recipientCount: 1, spendVnd: 0 },
    }),
    request({
      action: 'destructive',
      target: 'crm',
      provider: 'crm',
      metadata: { itemCount: 1, recipientCount: 0, spendVnd: 0 },
    }),
  ])('denies $action under the local-only cmr-306 policy', (gateRequest) => {
    const workflow = workflowFor(gateRequest);
    expect(evaluateCustomerMarketingActionGate({
      request: gateRequest,
      workflow,
      source: sourceFor(workflow),
      nowMs: NOW,
    })).toEqual({ allowed: false, executed: false, denialReason: 'policy_denied' });
  });

  it.each([
    { status: 'draft' },
    { revision: 4 },
    { sha256: 'f'.repeat(64) },
    { id: 'different-source' },
  ])('rejects changed authoritative source evidence %#', (sourceOverride) => {
    const gateRequest = request();
    const workflow = workflowFor(gateRequest);
    expect(evaluateCustomerMarketingActionGate({
      request: gateRequest,
      workflow,
      source: sourceFor(workflow, sourceOverride),
      nowMs: NOW,
    }).denialReason).toBe('manifest_mismatch');
  });

  it('has no enabled local executor', () => {
    expect(CUSTOMER_MARKETING_ACTION_GATE_EXECUTOR_ENABLED).toBe(false);
  });
});
