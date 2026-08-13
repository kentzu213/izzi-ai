import type { CustomerMarketingBridgeStatus } from './customer-marketing-types';
import {
  isCustomerMarketingIntegrationProvider,
  type CustomerMarketingIntegrationProvider,
} from './customer-marketing-credential-types';

export type CustomerMarketingConnectorOperation =
  | 'health'
  | 'revoke'
  | 'private_sandbox_send';

export type CustomerMarketingConnectorOperationOutcome =
  | 'ready'
  | 'unavailable'
  | 'revoked'
  | 'not_found'
  | 'performed'
  | 'unknown'
  | 'not_performed';

export interface CustomerMarketingConnectorOperationInput {
  provider: CustomerMarketingIntegrationProvider;
  operation: CustomerMarketingConnectorOperation;
  outcome: CustomerMarketingConnectorOperationOutcome;
  occurredAt: string;
  externalActionPerformed: boolean | null;
  sourceReceiptDigest: string | null;
}

export interface CustomerMarketingConnectorOperationReceipt
extends CustomerMarketingConnectorOperationInput {
  id: string;
  stateRevision: number;
  receiptDigest: string;
}

export interface CustomerMarketingConnectorOperationSnapshot {
  status: 'ready' | 'unavailable';
  revision: number;
  receipts: CustomerMarketingConnectorOperationReceipt[];
}

export interface CustomerMarketingConnectorOperationListResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  revision: number;
  receipts: CustomerMarketingConnectorOperationReceipt[];
  error?: string;
}

export interface CustomerMarketingConnectorHealthInput {
  provider: CustomerMarketingIntegrationProvider;
}

export interface CustomerMarketingConnectorHealthResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  provider: CustomerMarketingIntegrationProvider;
  health: 'ready' | 'unavailable';
  operationsRevision: number;
  operationReceipt: CustomerMarketingConnectorOperationReceipt | null;
  error?: string;
}

export function parseCustomerMarketingConnectorProviderInput(
  value: unknown,
): CustomerMarketingConnectorHealthInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1
    || !isCustomerMarketingIntegrationProvider(input.provider)) return null;
  return { provider: input.provider };
}
