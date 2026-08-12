import type { CustomerMarketingBridgeStatus } from './customer-marketing-types';
import type { CustomerMarketingCredentialConnectionState } from './customer-marketing-credential-types';

export interface CustomerMarketingCanaryReadinessResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  provider: 'telegram';
  controlPlane: {
    enabled: boolean;
    killSwitch: boolean;
    bindingDigest: string | null;
    stateRevision: number;
  } | null;
  credentialState: CustomerMarketingCredentialConnectionState | 'missing';
  liveReady: boolean;
  missingRequirements: Array<'credential' | 'private_sandbox_chat' | 'named_approval' | 'canary_enablement'>;
  externalActionPerformed: false;
  error?: string;
}

export interface CustomerMarketingTelegramSandboxSetupInput {
  token: string;
  privateSandboxChatId: string;
}

export interface CustomerMarketingTelegramSandboxSetupResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  provider: 'telegram';
  credentialState: CustomerMarketingCredentialConnectionState | 'missing';
  privateSandboxChatConfigured: boolean;
  externalActionPerformed: false;
  error?: string;
}

export interface CustomerMarketingTelegramCanaryCandidateRequest {
  workflowId: string;
  manifestDigest: string;
}

export interface CustomerMarketingTelegramCanaryCandidate {
  provider: 'telegram';
  operation: 'private_sandbox_send';
  workflowId: string;
  manifestDigest: string;
  resourceId: string;
  expectedRevision: number;
  text: string;
  resourceDigest: string;
  externalActionPerformed: false;
}

export interface CustomerMarketingTelegramCanaryCandidateResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  candidate: CustomerMarketingTelegramCanaryCandidate | null;
  externalActionPerformed: false;
  error?: string;
}

export interface CustomerMarketingTelegramCanaryNamedApprovalRequest {
  workflowId: string;
  manifestDigest: string;
  resourceDigest: string;
  expectedRevision: number;
}

export interface CustomerMarketingTelegramCanaryNamedApprovalResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  approval: {
    approvalId: string;
    reviewer: string;
    manifestDigest: string;
    resourceDigest: string;
    expectedRevision: number;
    expiresAt: string;
    receiptDigest: string;
    externalActionPerformed: false;
  } | null;
  externalActionPerformed: false;
  error?: string;
}

export interface CustomerMarketingTelegramCanaryEnableRequest
  extends CustomerMarketingTelegramCanaryNamedApprovalRequest {
  expectedStateRevision: number;
}

export interface CustomerMarketingTelegramCanaryEnableResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  controlPlane: CustomerMarketingCanaryReadinessResult['controlPlane'];
  receipt: {
    action: 'enabled';
    reason: string;
    bindingDigest: string | null;
    stateRevision: number;
    createdAt: string;
    externalActionPerformed: false;
    receiptDigest: string;
  } | null;
  externalActionPerformed: false;
  error?: string;
}

const TELEGRAM_BOT_TOKEN_PATTERN = /^[1-9][0-9]{5,15}:[A-Za-z0-9_-]{30,80}$/;
const TELEGRAM_PRIVATE_SANDBOX_CHAT_ID_PATTERN = /^-100[1-9][0-9]{5,19}$/;

export function parseCustomerMarketingTelegramSandboxSetupInput(
  value: unknown,
): CustomerMarketingTelegramSandboxSetupInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 2
    || typeof input.token !== 'string'
    || !TELEGRAM_BOT_TOKEN_PATTERN.test(input.token)
    || typeof input.privateSandboxChatId !== 'string'
    || !TELEGRAM_PRIVATE_SANDBOX_CHAT_ID_PATTERN.test(input.privateSandboxChatId)) {
    return null;
  }
  return {
    token: input.token,
    privateSandboxChatId: input.privateSandboxChatId,
  };
}

export function parseCustomerMarketingTelegramCanaryEnableRequest(
  value: unknown,
): CustomerMarketingTelegramCanaryEnableRequest | null {
  if (!isExactPlainRecord(value, [
    'workflowId', 'manifestDigest', 'resourceDigest', 'expectedRevision', 'expectedStateRevision',
  ])
    || typeof value.workflowId !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value.workflowId)
    || typeof value.manifestDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.manifestDigest)
    || typeof value.resourceDigest !== 'string'
    || !/^[a-f0-9]{64}$/.test(value.resourceDigest)
    || typeof value.expectedRevision !== 'number'
    || !Number.isSafeInteger(value.expectedRevision)
    || value.expectedRevision < 0
    || typeof value.expectedStateRevision !== 'number'
    || !Number.isSafeInteger(value.expectedStateRevision)
    || value.expectedStateRevision < 0) return null;
  return value as unknown as CustomerMarketingTelegramCanaryEnableRequest;
}

function isExactPlainRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
