import type { CustomerMarketingBridgeStatus } from './customer-marketing-types';

export const CUSTOMER_MARKETING_INTEGRATION_PROVIDERS = [
  'facebook',
  'instagram',
  'tiktok',
  'youtube',
  'telegram',
  'x',
  'google',
  'email',
  'crm',
] as const;

export type CustomerMarketingIntegrationProvider =
  (typeof CUSTOMER_MARKETING_INTEGRATION_PROVIDERS)[number];

export type CustomerMarketingCredentialConnectionState =
  | 'connected'
  | 'disconnected'
  | 'locked'
  | 'invalid';

export type CustomerMarketingCredentialVaultState = 'ready' | 'locked';

export interface CustomerMarketingCredentialStatus {
  provider: CustomerMarketingIntegrationProvider;
  state: CustomerMarketingCredentialConnectionState;
  updatedAt: string | null;
}

export interface CustomerMarketingCredentialListResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  vaultState: CustomerMarketingCredentialVaultState;
  credentials: CustomerMarketingCredentialStatus[];
  error?: string;
}

export interface CustomerMarketingCredentialRevokeInput {
  provider: CustomerMarketingIntegrationProvider;
}

export interface CustomerMarketingCredentialRevokeResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  provider: CustomerMarketingIntegrationProvider;
  revoked: boolean;
  credential: CustomerMarketingCredentialStatus | null;
  error?: string;
}

export function isCustomerMarketingIntegrationProvider(
  value: unknown,
): value is CustomerMarketingIntegrationProvider {
  return typeof value === 'string'
    && CUSTOMER_MARKETING_INTEGRATION_PROVIDERS.some((provider) => provider === value);
}

export function parseCustomerMarketingCredentialRevokeInput(
  value: unknown,
): CustomerMarketingCredentialRevokeInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 1 || !isCustomerMarketingIntegrationProvider(input.provider)) {
    return null;
  }
  return { provider: input.provider };
}
