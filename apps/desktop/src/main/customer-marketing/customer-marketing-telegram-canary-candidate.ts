import { telegramSandboxResourceDigest } from './customer-marketing-telegram-sandbox-connector';
import type {
  CustomerMarketingTelegramCanaryCandidate,
  CustomerMarketingTelegramCanaryCandidateRequest,
} from '../../shared/customer-marketing-canary-types';

export interface CustomerMarketingTelegramCanaryCandidateBuildInput
  extends CustomerMarketingTelegramCanaryCandidateRequest {
  resourceId: string;
  expectedRevision: number;
  sourceBody: string;
  privateSandboxChatId: string;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function parseCustomerMarketingTelegramCanaryCandidateRequest(
  value: unknown,
): CustomerMarketingTelegramCanaryCandidateRequest | null {
  if (!isExactPlainRecord(value, ['workflowId', 'manifestDigest'])
    || !validRequestFields(value.workflowId, value.manifestDigest)) return null;
  return {
    workflowId: value.workflowId as string,
    manifestDigest: value.manifestDigest as string,
  };
}

export function buildCustomerMarketingTelegramCanaryCandidate(
  input: CustomerMarketingTelegramCanaryCandidateBuildInput,
): CustomerMarketingTelegramCanaryCandidate {
  const text = typeof input.sourceBody === 'string' ? input.sourceBody.trim() : '';
  if (!validRequestFields(input.workflowId, input.manifestDigest)
    || typeof input.resourceId !== 'string'
    || !IDENTIFIER_PATTERN.test(input.resourceId)
    || !Number.isSafeInteger(input.expectedRevision)
    || input.expectedRevision < 0
    || text.length < 1
    || text.length > 4_096
    || /[\u0000\u007f]/.test(text)) {
    throw new Error('Invalid Telegram canary source.');
  }
  const resource = {
    audience: 'private_sandbox' as const,
    chatId: input.privateSandboxChatId,
    text,
  };
  return {
    provider: 'telegram',
    operation: 'private_sandbox_send',
    workflowId: input.workflowId,
    manifestDigest: input.manifestDigest,
    resourceId: input.resourceId,
    expectedRevision: input.expectedRevision,
    text,
    resourceDigest: telegramSandboxResourceDigest(resource),
    externalActionPerformed: false,
  };
}

function validRequestFields(workflowId: unknown, manifestDigest: unknown): workflowId is string {
  return typeof workflowId === 'string'
    && IDENTIFIER_PATTERN.test(workflowId)
    && typeof manifestDigest === 'string'
    && SHA256_PATTERN.test(manifestDigest);
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
