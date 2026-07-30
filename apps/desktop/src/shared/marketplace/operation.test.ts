import { describe, expect, it } from 'vitest';
import {
  MarketplaceValidationError,
  parseMarketplaceInstallOperationReceipt,
} from './index';

const PLAN_ID = 'marketplace-install-plan:1.0.0:ocx_extension:reviewed-package@1.2.3:tenant:owner:user:owner:personal:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BASE = {
  schemaVersion: 1,
  operationVersion: '1.0.0',
  operationId: PLAN_ID.replace(
    'marketplace-install-plan:',
    'marketplace-install-operation:',
  ),
  planId: PLAN_ID,
  packageKey: 'ocx_extension:reviewed-package@1.2.3',
  scope: {
    tenantId: 'tenant:owner',
    userId: 'user:owner',
    workspaceInstanceId: 'personal',
  },
  startedAt: '2026-07-29T23:55:00.000Z',
  updatedAt: '2026-07-29T23:56:00.000Z',
};

describe('Marketplace operation receipt parser', () => {
  it('accepts an approval-pending receipt and freezes its stage list', () => {
    const receipt = parseMarketplaceInstallOperationReceipt({
      ...BASE,
      status: 'awaiting_approval',
      approvalId: 'approval:1',
      stages: [
        {
          stage: 'plan_revalidation',
          outcome: 'passed',
          code: 'UNCHANGED_PLAN',
          evidenceDigest: `sha256:${'b'.repeat(64)}`,
        },
        {
          stage: 'package_verification',
          outcome: 'passed',
          code: 'PACKAGE_AND_SIGNATURE_VERIFIED',
          evidenceDigest: `sha256:${'c'.repeat(64)}`,
        },
        {
          stage: 'work_approval',
          outcome: 'pending',
          code: 'APPROVAL_PENDING',
          referenceId: 'approval:1',
        },
      ],
    });

    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.stages)).toBe(true);
    expect(receipt.status).toBe('awaiting_approval');
  });

  it('rejects out-of-order, incomplete, or non-UTC receipts', () => {
    expect(() => parseMarketplaceInstallOperationReceipt({
      ...BASE,
      status: 'completed',
      stages: [
        {
          stage: 'package_verification',
          outcome: 'passed',
          code: 'PACKAGE_AND_SIGNATURE_VERIFIED',
        },
      ],
    })).toThrow(MarketplaceValidationError);

    expect(() => parseMarketplaceInstallOperationReceipt({
      ...BASE,
      status: 'failed',
      startedAt: '2026-07-29T23:55:00Z',
      stages: [{
        stage: 'plan_revalidation',
        outcome: 'passed',
        code: 'UNCHANGED_PLAN',
      }],
    })).toThrow(MarketplaceValidationError);
  });
});
