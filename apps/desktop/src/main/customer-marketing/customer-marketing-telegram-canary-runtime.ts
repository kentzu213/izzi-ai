import type {
  CustomerMarketingConnectorExecuteInput,
  CustomerMarketingConnectorExecuteResult,
} from './customer-marketing-connector-sdk';
import type {
  CustomerMarketingCanaryController,
  CustomerMarketingCanaryDecision,
} from './customer-marketing-canary-controller';

export interface CustomerMarketingTelegramCanaryConnector {
  execute(input: CustomerMarketingConnectorExecuteInput): Promise<CustomerMarketingConnectorExecuteResult>;
}

export class CustomerMarketingTelegramCanaryRuntime {
  constructor(
    private readonly controller: Pick<CustomerMarketingCanaryController, 'authorize'>,
    private readonly connector: CustomerMarketingTelegramCanaryConnector,
  ) {}

  async execute(
    input: CustomerMarketingConnectorExecuteInput,
  ): Promise<CustomerMarketingConnectorExecuteResult> {
    const decision = this.controller.authorize({
      provider: 'telegram',
      operation: 'private_sandbox_send',
      manifestDigest: input.manifestDigest,
      resourceDigest: input.resourceDigest,
      expectedRevision: input.expectedRevision,
    });
    if (!decision.authorized) return this.blocked(decision);
    return this.connector.execute(input);
  }

  private blocked(decision: CustomerMarketingCanaryDecision): CustomerMarketingConnectorExecuteResult {
    return {
      ok: false,
      status: 'blocked',
      provider: 'telegram',
      externalActionPerformed: false,
      receipt: null,
      detail: decision.reason,
    };
  }
}
