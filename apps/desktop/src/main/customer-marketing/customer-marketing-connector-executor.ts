import { createHash } from 'node:crypto';
import type {
  CustomerMarketingConnectorExecuteInput,
  CustomerMarketingConnectorExecuteResult,
  CustomerMarketingConnectorDryRunInput,
  CustomerMarketingConnectorDryRunResult,
} from './customer-marketing-connector-sdk';

export interface CustomerMarketingConnectorExecutionPolicy {
  executeEnabled: boolean;
  killSwitch: boolean;
  sandboxOnly: boolean;
}

export interface CustomerMarketingConnectorOperationRunner {
  dryRun(input: CustomerMarketingConnectorDryRunInput): Promise<{ ok: boolean; detail: string }>;
  execute(input: CustomerMarketingConnectorExecuteInput): Promise<{ ok: boolean; detail: string }>;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function validApproval(input: CustomerMarketingConnectorExecuteInput): boolean {
  return Boolean(input.approval)
    && SHA256_PATTERN.test(input.approval.manifestDigest)
    && ISO_DATE_PATTERN.test(input.approval.expiresAt)
    && Date.parse(input.approval.expiresAt) > Date.now()
    && input.approval.manifestDigest === input.manifestDigest;
}

export class CustomerMarketingConnectorExecutor {
  private readonly completed = new Map<string, CustomerMarketingConnectorExecuteResult>();

  constructor(
    private readonly runner: CustomerMarketingConnectorOperationRunner,
    private readonly policy: CustomerMarketingConnectorExecutionPolicy,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async dryRun(input: CustomerMarketingConnectorDryRunInput): Promise<CustomerMarketingConnectorDryRunResult> {
    const outcome = await this.runner.dryRun(input);
    return {
      ok: outcome.ok,
      status: outcome.ok ? 'ready' : 'blocked',
      provider: input.provider,
      externalActionPerformed: false,
      receipt: null,
      detail: outcome.ok ? 'dry-run-complete' : 'dry-run-blocked',
    };
  }

  async execute(input: CustomerMarketingConnectorExecuteInput): Promise<CustomerMarketingConnectorExecuteResult> {
    if (!this.policy.executeEnabled || this.policy.killSwitch || !this.policy.sandboxOnly) {
      return this.blocked(input.provider, 'execute-policy-blocked');
    }
    if (!validApproval(input)) return this.blocked(input.provider, 'approval-invalid');

    const replayKey = `${input.workspaceHash}:${input.provider}:${input.idempotencyKey}`;
    const previous = this.completed.get(replayKey);
    if (previous) {
      return {
        ...previous,
        ok: true,
        status: 'duplicate',
        externalActionPerformed: false,
        detail: 'duplicate-idempotent-replay',
      };
    }

    const outcome = await this.runner.execute(input);
    if (!outcome.ok) return this.blocked(input.provider, 'external-operation-failed');
    const receipt: CustomerMarketingConnectorExecuteResult = {
      ok: true,
      status: 'executed',
      provider: input.provider,
      externalActionPerformed: true,
      receipt: {
        id: `receipt-${digest(`${replayKey}:${input.resourceDigest}`).slice(0, 24)}`,
        provider: input.provider,
        operation: 'execute',
        workspaceHash: input.workspaceHash,
        idempotencyKey: input.idempotencyKey,
        resourceDigest: input.resourceDigest,
        externalActionPerformed: true,
        createdAt: this.now(),
        receiptDigest: digest(`${replayKey}:${input.resourceDigest}:${input.approval.manifestDigest}`),
      },
      detail: 'sandbox-execute-complete',
    };
    this.completed.set(replayKey, receipt);
    return receipt;
  }

  private blocked(
    provider: CustomerMarketingConnectorExecuteResult['provider'],
    detail: string,
  ): CustomerMarketingConnectorExecuteResult {
    return {
      ok: false,
      status: 'blocked',
      provider,
      externalActionPerformed: false,
      receipt: null,
      detail,
    };
  }
}
