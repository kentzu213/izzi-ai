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
