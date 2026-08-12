import type {
  CustomerMarketingIntegrationProvider,
} from '../../shared/customer-marketing-credential-types';
import type {
  CustomerMarketingPlan,
  CustomerMarketingWorkflowTarget,
} from '../../shared/customer-marketing-types';

export const CUSTOMER_MARKETING_CONNECTOR_PROVIDERS = [
  'facebook',
  'instagram',
  'tiktok',
  'youtube',
  'telegram',
  'x',
  'google',
  'email',
  'crm',
] as const satisfies readonly CustomerMarketingIntegrationProvider[];

export type CustomerMarketingConnectorOperation = 'health' | 'validate' | 'dry_run' | 'execute';
export type CustomerMarketingConnectorErrorCode =
  | 'invalid_request'
  | 'provider_unavailable'
  | 'authority_unavailable'
  | 'permission_denied'
  | 'plan_required'
  | 'rate_limited'
  | 'approval_required'
  | 'duplicate_request'
  | 'external_action_disabled'
  | 'credential_unavailable';
export type CustomerMarketingConnectorPermission = 'read' | 'draft' | 'validate' | 'execute';
export type CustomerMarketingConnectorHealthStatus = 'ready' | 'unavailable' | 'rate_limited';
export type CustomerMarketingConnectorValidationStatus = 'valid' | 'invalid' | 'forbidden';
export type CustomerMarketingConnectorDryRunStatus = 'ready' | 'blocked';
export type CustomerMarketingConnectorExecuteStatus = 'executed' | 'duplicate' | 'blocked' | 'failed';

export interface CustomerMarketingConnectorCapability {
  target: CustomerMarketingWorkflowTarget;
  operations: readonly CustomerMarketingConnectorOperation[];
  sandboxOnly: boolean;
}

export const CUSTOMER_MARKETING_CONNECTOR_CAPABILITIES: Readonly<
  Record<CustomerMarketingIntegrationProvider, CustomerMarketingConnectorCapability>
> = Object.freeze({
  facebook: { target: 'social', operations: ['health', 'validate', 'dry_run'], sandboxOnly: true },
  instagram: { target: 'social', operations: ['health', 'validate', 'dry_run'], sandboxOnly: true },
  tiktok: { target: 'social', operations: ['health', 'validate', 'dry_run'], sandboxOnly: true },
  youtube: { target: 'social', operations: ['health', 'validate', 'dry_run'], sandboxOnly: true },
  telegram: { target: 'social', operations: ['health', 'validate', 'dry_run', 'execute'], sandboxOnly: true },
  x: { target: 'social', operations: ['health', 'validate', 'dry_run', 'execute'], sandboxOnly: true },
  google: { target: 'seo', operations: ['health', 'validate', 'dry_run'], sandboxOnly: true },
  email: { target: 'email', operations: ['health', 'validate', 'dry_run'], sandboxOnly: true },
  crm: { target: 'crm', operations: ['health', 'validate', 'dry_run'], sandboxOnly: true },
});

export interface CustomerMarketingConnectorRateLimit {
  remaining: number;
  resetAt: string;
}

export interface CustomerMarketingConnectorAuthority {
  role: 'owner' | 'manager' | 'editor' | 'reviewer' | 'viewer';
  plan: CustomerMarketingPlan;
  permission: CustomerMarketingConnectorPermission;
  rateLimit: CustomerMarketingConnectorRateLimit;
}

export interface CustomerMarketingConnectorApproval {
  approvalId: string;
  manifestDigest: string;
  expiresAt: string;
}

export interface CustomerMarketingConnectorRequestBase {
  workspaceHash: string;
  provider: CustomerMarketingIntegrationProvider;
  target: CustomerMarketingWorkflowTarget;
  resourceDigest: string;
  manifestDigest: string;
  expectedRevision: number;
  idempotencyKey: string;
  authority: CustomerMarketingConnectorAuthority;
}

export type CustomerMarketingConnectorRequest = CustomerMarketingConnectorRequestBase & {
  operation: CustomerMarketingConnectorOperation;
  approval?: CustomerMarketingConnectorApproval;
};

export type CustomerMarketingConnectorHealthInput = CustomerMarketingConnectorRequestBase & {
  operation: 'health';
};

export type CustomerMarketingConnectorValidateInput = CustomerMarketingConnectorRequestBase & {
  operation: 'validate';
};

export type CustomerMarketingConnectorDryRunInput = CustomerMarketingConnectorRequestBase & {
  operation: 'dry_run';
};

export type CustomerMarketingConnectorExecuteInput = CustomerMarketingConnectorRequestBase & {
  operation: 'execute';
  approval: CustomerMarketingConnectorApproval;
};

export interface CustomerMarketingConnectorHealthResult {
  ok: boolean;
  status: CustomerMarketingConnectorHealthStatus;
  provider: CustomerMarketingIntegrationProvider;
  checkedAt: string;
  detail: string;
}

export interface CustomerMarketingConnectorValidateResult {
  ok: boolean;
  status: CustomerMarketingConnectorValidationStatus;
  provider: CustomerMarketingIntegrationProvider;
  checkedAt: string;
  detail: string;
}

export interface CustomerMarketingConnectorReceipt {
  id: string;
  provider: CustomerMarketingIntegrationProvider;
  operation: 'execute';
  workspaceHash: string;
  idempotencyKey: string;
  resourceDigest: string;
  externalActionPerformed: boolean;
  createdAt: string;
  receiptDigest: string;
}

export interface CustomerMarketingConnectorDryRunResult {
  ok: boolean;
  status: CustomerMarketingConnectorDryRunStatus;
  provider: CustomerMarketingIntegrationProvider;
  externalActionPerformed: false;
  receipt: null;
  detail: string;
}

export interface CustomerMarketingConnectorExecuteResult {
  ok: boolean;
  status: CustomerMarketingConnectorExecuteStatus;
  provider: CustomerMarketingIntegrationProvider;
  externalActionPerformed: boolean;
  receipt: CustomerMarketingConnectorReceipt | null;
  detail: string;
}

export interface CustomerMarketingConnector {
  readonly provider: CustomerMarketingIntegrationProvider;
  health(input: CustomerMarketingConnectorHealthInput): Promise<CustomerMarketingConnectorHealthResult>;
  validate(input: CustomerMarketingConnectorValidateInput): Promise<CustomerMarketingConnectorValidateResult>;
  dryRun(input: CustomerMarketingConnectorDryRunInput): Promise<CustomerMarketingConnectorDryRunResult>;
  execute(input: CustomerMarketingConnectorExecuteInput): Promise<CustomerMarketingConnectorExecuteResult>;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const WORKSPACE_HASH_PATTERN = SHA256_PATTERN;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const ALLOWED_KEYS = new Set([
  'workspaceHash', 'provider', 'target', 'resourceDigest', 'expectedRevision',
  'manifestDigest', 'idempotencyKey', 'authority', 'operation', 'approval',
]);
const PROVIDER_TARGETS: Readonly<Record<CustomerMarketingWorkflowTarget, readonly CustomerMarketingIntegrationProvider[]>> = Object.freeze({
  social: ['facebook', 'instagram', 'tiktok', 'youtube', 'telegram', 'x'],
  seo: ['google'],
  email: ['email'],
  crm: ['crm'],
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && ISO_DATE_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function isProvider(value: unknown): value is CustomerMarketingIntegrationProvider {
  return typeof value === 'string' && (CUSTOMER_MARKETING_CONNECTOR_PROVIDERS as readonly string[]).includes(value);
}

function isAuthority(value: unknown): value is CustomerMarketingConnectorAuthority {
  if (!isRecord(value)) return false;
  if (Object.keys(value).some((key) => !['role', 'plan', 'permission', 'rateLimit'].includes(key))) return false;
  const rateLimit = value.rateLimit;
  if (!isRecord(rateLimit) || Object.keys(rateLimit).some((key) => !['remaining', 'resetAt'].includes(key))) return false;
  return (value.role === 'owner' || value.role === 'manager' || value.role === 'editor'
    || value.role === 'reviewer' || value.role === 'viewer')
    && (value.plan === 'free' || value.plan === 'starter' || value.plan === 'pro'
      || value.plan === 'max' || value.plan === 'ultra')
    && (value.permission === 'read' || value.permission === 'draft'
      || value.permission === 'validate' || value.permission === 'execute')
    && typeof rateLimit.remaining === 'number'
    && Number.isInteger(rateLimit.remaining)
    && rateLimit.remaining >= 0
    && isIsoDate(rateLimit.resetAt)
    && Date.parse(rateLimit.resetAt) > Date.now();
}

function isApproval(value: unknown): value is CustomerMarketingConnectorApproval {
  return isRecord(value)
    && Object.keys(value).every((key) => ['approvalId', 'manifestDigest', 'expiresAt'].includes(key))
    && typeof value.approvalId === 'string'
    && /^[A-Za-z0-9._:-]{8,128}$/.test(value.approvalId)
    && SHA256_PATTERN.test(String(value.manifestDigest))
    && isIsoDate(value.expiresAt)
    && Date.parse(value.expiresAt) > Date.now();
}

export function parseCustomerMarketingConnectorRequest(
  value: unknown,
): CustomerMarketingConnectorRequest | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.some((key) => !ALLOWED_KEYS.has(key))) return null;
  if (!WORKSPACE_HASH_PATTERN.test(String(value.workspaceHash))
    || !isProvider(value.provider)
    || (value.target !== 'social' && value.target !== 'seo' && value.target !== 'email' && value.target !== 'crm')
    || !PROVIDER_TARGETS[value.target].includes(value.provider)
    || !SHA256_PATTERN.test(String(value.resourceDigest))
    || !SHA256_PATTERN.test(String(value.manifestDigest))
    || typeof value.expectedRevision !== 'number'
    || !Number.isInteger(value.expectedRevision)
    || value.expectedRevision < 0
    || typeof value.idempotencyKey !== 'string'
    || !IDEMPOTENCY_PATTERN.test(value.idempotencyKey)
    || !isAuthority(value.authority)
    || (value.operation !== 'health' && value.operation !== 'validate'
      && value.operation !== 'dry_run' && value.operation !== 'execute')) {
    return null;
  }
  if (value.operation === 'execute') {
    if (value.authority.permission !== 'execute'
      || !CUSTOMER_MARKETING_CONNECTOR_CAPABILITIES[value.provider].operations.includes('execute')
      || !isApproval(value.approval)) return null;
    return { ...value, operation: 'execute', approval: value.approval } as CustomerMarketingConnectorExecuteInput;
  }
  if (value.approval !== undefined) return null;
  return value as unknown as CustomerMarketingConnectorRequest;
}
