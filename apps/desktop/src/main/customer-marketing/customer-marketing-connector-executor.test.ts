import { describe, expect, it } from 'vitest';
import {
  CustomerMarketingConnectorExecutor,
  type CustomerMarketingConnectorExecutionPolicy,
  type CustomerMarketingConnectorOperationRunner,
} from './customer-marketing-connector-executor';
import type {
  CustomerMarketingConnectorExecuteInput,
  CustomerMarketingConnectorRequestBase,
} from './customer-marketing-connector-sdk';

const BASE: CustomerMarketingConnectorRequestBase = {
  workspaceHash: 'a'.repeat(64),
  provider: 'telegram',
  target: 'social',
  resourceDigest: 'b'.repeat(64),
  manifestDigest: 'c'.repeat(64),
  expectedRevision: 2,
  idempotencyKey: 'cmr-exec-001',
  authority: {
    role: 'owner',
    plan: 'pro',
    permission: 'execute',
    rateLimit: { remaining: 3, resetAt: new Date(Date.now() + 300_000).toISOString() },
  },
};

const APPROVAL = {
  approvalId: 'approval-001',
  manifestDigest: 'c'.repeat(64),
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

function policy(overrides: Partial<CustomerMarketingConnectorExecutionPolicy> = {}) {
  return {
    executeEnabled: true,
    killSwitch: false,
    sandboxOnly: true,
    ...overrides,
  } satisfies CustomerMarketingConnectorExecutionPolicy;
}

function runner(calls: string[]): CustomerMarketingConnectorOperationRunner {
  return {
    dryRun: async () => ({ ok: true, detail: 'dry-run-only' }),
    execute: async () => {
      calls.push('execute');
      return { ok: true, detail: 'sent-to-private-sandbox' };
    },
  };
}

describe('CustomerMarketingConnectorExecutor', () => {
  it('dry-run never invokes execute and always reports externalActionPerformed=false', async () => {
    const calls: string[] = [];
    const executor = new CustomerMarketingConnectorExecutor(runner(calls), policy());
    const result = await executor.dryRun({ ...BASE, operation: 'dry_run' });

    expect(result).toMatchObject({ ok: true, status: 'ready', externalActionPerformed: false });
    expect(calls).toEqual([]);
  });

  it('execute requires approval, policy enablement and a non-triggered kill switch', async () => {
    const calls: string[] = [];
    const executor = new CustomerMarketingConnectorExecutor(runner(calls), policy());
    const input: CustomerMarketingConnectorExecuteInput = { ...BASE, operation: 'execute', approval: APPROVAL };

    expect((await executor.execute({ ...input, approval: undefined as never })).status).toBe('blocked');
    expect((await new CustomerMarketingConnectorExecutor(runner(calls), policy({ executeEnabled: false })).execute(input)).status).toBe('blocked');
    expect((await new CustomerMarketingConnectorExecutor(runner(calls), policy({ killSwitch: true })).execute(input)).status).toBe('blocked');
    expect(calls).toEqual([]);
  });

  it('executes once and returns duplicate on idempotent replay', async () => {
    const calls: string[] = [];
    const executor = new CustomerMarketingConnectorExecutor(runner(calls), policy());
    const input: CustomerMarketingConnectorExecuteInput = { ...BASE, operation: 'execute', approval: APPROVAL };

    const first = await executor.execute(input);
    const second = await executor.execute(input);

    expect(first).toMatchObject({ ok: true, status: 'executed', externalActionPerformed: true });
    expect(second).toMatchObject({ ok: true, status: 'duplicate', externalActionPerformed: false });
    expect(calls).toEqual(['execute']);
  });

  it('fails closed for expired or mismatched approval and does not persist a replay key', async () => {
    const calls: string[] = [];
    const executor = new CustomerMarketingConnectorExecutor(runner(calls), policy());
    const expired = { ...APPROVAL, expiresAt: new Date(Date.now() - 1_000).toISOString() };
    const mismatched = { ...APPROVAL, manifestDigest: 'd'.repeat(64) };

    expect((await executor.execute({ ...BASE, operation: 'execute', approval: expired })).status).toBe('blocked');
    expect((await executor.execute({ ...BASE, operation: 'execute', approval: mismatched })).status).toBe('blocked');
    expect(calls).toEqual([]);
  });
});
