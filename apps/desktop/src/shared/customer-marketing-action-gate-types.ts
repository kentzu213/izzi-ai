import {
  CUSTOMER_MARKETING_INTEGRATION_PROVIDERS,
  type CustomerMarketingIntegrationProvider,
} from './customer-marketing-credential-types';
import type { CustomerMarketingWorkflowTarget } from './customer-marketing-types';

export const CUSTOMER_MARKETING_ACTION_GATE_ACTIONS = [
  'publish',
  'spend',
  'bulk_email',
  'destructive',
] as const;

export type CustomerMarketingActionGateAction =
  (typeof CUSTOMER_MARKETING_ACTION_GATE_ACTIONS)[number];

export const CUSTOMER_MARKETING_ACTION_GATE_METADATA_MAXIMA = {
  itemCount: 10_000,
  recipientCount: 100_000,
  spendVnd: 100_000_000,
} as const;

export interface CustomerMarketingActionGateMetadata {
  itemCount: number;
  recipientCount: number;
  spendVnd: number;
}

export interface CustomerMarketingActionGateRequest {
  action: CustomerMarketingActionGateAction;
  target: CustomerMarketingWorkflowTarget;
  workflowId: string;
  approvalId: string;
  manifestDigest: string;
  provider: CustomerMarketingIntegrationProvider;
  metadata: CustomerMarketingActionGateMetadata;
}

export const CUSTOMER_MARKETING_ACTION_GATE_PUBLIC_DENIAL_REASONS = [
  'current_wave_disabled',
  'invalid_request',
  'approval_required',
  'approval_invalid',
  'manifest_mismatch',
  'provider_unavailable',
  'policy_denied',
] as const;

export type CustomerMarketingActionGatePublicDenialReason =
  (typeof CUSTOMER_MARKETING_ACTION_GATE_PUBLIC_DENIAL_REASONS)[number];

export interface CustomerMarketingActionGateResult {
  allowed: false;
  executed: false;
  denialReason: CustomerMarketingActionGatePublicDenialReason;
}

const CUSTOMER_MARKETING_ACTION_GATE_TARGETS = [
  'social',
  'seo',
  'email',
  'crm',
] as const satisfies readonly CustomerMarketingWorkflowTarget[];

const REQUEST_KEYS = [
  'action',
  'target',
  'workflowId',
  'approvalId',
  'manifestDigest',
  'provider',
  'metadata',
] as const;

const METADATA_KEYS = ['itemCount', 'recipientCount', 'spendVnd'] as const;
const ACTIONS = new Set<string>(CUSTOMER_MARKETING_ACTION_GATE_ACTIONS);
const TARGETS = new Set<string>(CUSTOMER_MARKETING_ACTION_GATE_TARGETS);
const PROVIDERS = new Set<string>(CUSTOMER_MARKETING_INTEGRATION_PROVIDERS);
const IDENTIFIER_MAX_LENGTH = 256;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export function parseCustomerMarketingActionGateRequest(
  value: unknown,
): CustomerMarketingActionGateRequest | null {
  try {
    const request = exactPlainDataRecord(value, REQUEST_KEYS);
    if (!request) return null;

    const metadata = exactPlainDataRecord(request.metadata, METADATA_KEYS);
    if (!metadata) return null;

    if (
      typeof request.action !== 'string'
      || !ACTIONS.has(request.action)
      || typeof request.target !== 'string'
      || !TARGETS.has(request.target)
      || !isIdentifier(request.workflowId)
      || !isIdentifier(request.approvalId)
      || typeof request.manifestDigest !== 'string'
      || !SHA256_PATTERN.test(request.manifestDigest)
      || typeof request.provider !== 'string'
      || !PROVIDERS.has(request.provider)
      || !isBoundedCount(
        metadata.itemCount,
        CUSTOMER_MARKETING_ACTION_GATE_METADATA_MAXIMA.itemCount,
      )
      || !isBoundedCount(
        metadata.recipientCount,
        CUSTOMER_MARKETING_ACTION_GATE_METADATA_MAXIMA.recipientCount,
      )
      || !isBoundedCount(
        metadata.spendVnd,
        CUSTOMER_MARKETING_ACTION_GATE_METADATA_MAXIMA.spendVnd,
      )
    ) return null;

    return {
      action: request.action as CustomerMarketingActionGateAction,
      target: request.target as CustomerMarketingWorkflowTarget,
      workflowId: request.workflowId,
      approvalId: request.approvalId,
      manifestDigest: request.manifestDigest,
      provider: request.provider as CustomerMarketingIntegrationProvider,
      metadata: {
        itemCount: metadata.itemCount,
        recipientCount: metadata.recipientCount,
        spendVnd: metadata.spendVnd,
      },
    };
  } catch {
    return null;
  }
}

function exactPlainDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) return null;

  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.length
    || ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) return null;

  const normalized: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
    normalized[key] = descriptor.value;
  }
  return normalized;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= IDENTIFIER_MAX_LENGTH
    && value === value.trim()
    && !CONTROL_CHARACTER_PATTERN.test(value);
}

function isBoundedCount(value: unknown, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= maximum;
}
