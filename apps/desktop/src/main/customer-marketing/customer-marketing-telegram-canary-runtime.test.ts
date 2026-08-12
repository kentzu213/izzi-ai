import { describe, expect, it, vi } from 'vitest';
import type {
  CustomerMarketingConnectorExecuteInput,
  CustomerMarketingConnectorExecuteResult,
} from './customer-marketing-connector-sdk';
import { CustomerMarketingCanaryController } from './customer-marketing-canary-controller';
import { CustomerMarketingTelegramCanaryRuntime } from './customer-marketing-telegram-canary-runtime';

const MANIFEST_DIGEST = 'a'.repeat(64);
const RESOURCE_DIGEST = 'b'.repeat(64);
const NOW = '2026-08-12T15:00:00.000Z';
const FUTURE = '2026-08-12T16:00:00.000Z';
const input: CustomerMarketingConnectorExecuteInput = {
  workspaceHash: 'c'.repeat(64),
  provider: 'telegram',
  target: 'social',
  resourceDigest: RESOURCE_DIGEST,
  manifestDigest: MANIFEST_DIGEST,
  expectedRevision: 2,
  idempotencyKey: 'cmr-230b-runtime-001',
  authority: {
    role: 'owner',
    plan: 'pro',
    permission: 'execute',
    rateLimit: { remaining: 1, resetAt: FUTURE },
  },
  operation: 'execute',
  approval: {
    approvalId: 'approval-cmr-230b',
    manifestDigest: MANIFEST_DIGEST,
    expiresAt: FUTURE,
  },
};
const executed: CustomerMarketingConnectorExecuteResult = {
  ok: true,
  status: 'executed',
  provider: 'telegram',
  externalActionPerformed: true,
  receipt: {
    id: 'receipt-runtime-001',
    provider: 'telegram',
    operation: 'execute',
    workspaceHash: input.workspaceHash,
    idempotencyKey: input.idempotencyKey,
    resourceDigest: RESOURCE_DIGEST,
    externalActionPerformed: true,
    createdAt: NOW,
    receiptDigest: 'd'.repeat(64),
  },
  detail: 'sandbox-execute-complete',
};

function binding() {
  return {
    provider: 'telegram' as const,
    operation: 'private_sandbox_send' as const,
    manifestDigest: MANIFEST_DIGEST,
    resourceDigest: RESOURCE_DIGEST,
    expectedRevision: 2,
    approval: {
      approvalId: 'approval-cmr-230b',
      reviewer: 'Nguyen Nghia',
      manifestDigest: MANIFEST_DIGEST,
      expiresAt: FUTURE,
    },
  };
}

describe('Customer Marketing Telegram canary runtime', () => {
  it('does not call the connector while the canary is disabled', async () => {
    const controller = new CustomerMarketingCanaryController(() => NOW);
    const execute = vi.fn(async () => executed);
    const runtime = new CustomerMarketingTelegramCanaryRuntime(controller, { execute });

    await expect(runtime.execute(input)).resolves.toMatchObject({
      ok: false,
      status: 'blocked',
      externalActionPerformed: false,
      detail: 'canary-disabled',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('blocks binding mismatch and kill switch before connector access', async () => {
    const controller = new CustomerMarketingCanaryController(() => NOW);
    controller.enable(binding(), 0);
    const execute = vi.fn(async () => executed);
    const runtime = new CustomerMarketingTelegramCanaryRuntime(controller, { execute });

    await expect(runtime.execute({ ...input, resourceDigest: 'e'.repeat(64) }))
      .resolves.toMatchObject({ detail: 'binding-mismatch', externalActionPerformed: false });
    controller.setKillSwitch(true, 1);
    await expect(runtime.execute(input))
      .resolves.toMatchObject({ detail: 'kill-switch-enabled', externalActionPerformed: false });
    expect(execute).not.toHaveBeenCalled();
  });

  it('calls the connector once only for an exact authorized intent', async () => {
    const controller = new CustomerMarketingCanaryController(() => NOW);
    controller.enable(binding(), 0);
    const execute = vi.fn(async () => executed);
    const runtime = new CustomerMarketingTelegramCanaryRuntime(controller, { execute });

    await expect(runtime.execute(input)).resolves.toEqual(executed);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(input);
  });

  it('preserves connector failures without reporting an external action', async () => {
    const controller = new CustomerMarketingCanaryController(() => NOW);
    controller.enable(binding(), 0);
    const connectorFailure: CustomerMarketingConnectorExecuteResult = {
      ok: false,
      status: 'blocked',
      provider: 'telegram',
      externalActionPerformed: false,
      receipt: null,
      detail: 'credential-unavailable',
    };
    const runtime = new CustomerMarketingTelegramCanaryRuntime(controller, {
      execute: vi.fn(async () => connectorFailure),
    });

    await expect(runtime.execute(input)).resolves.toEqual(connectorFailure);
  });
});
