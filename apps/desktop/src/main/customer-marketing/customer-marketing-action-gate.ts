import type {
  CustomerMarketingActionGateRequest,
  CustomerMarketingActionGateResult,
} from '../../shared/customer-marketing-action-gate-types';
import type {
  CustomerMarketingWorkflowRecord,
  CustomerMarketingWorkflowTarget,
} from '../../shared/customer-marketing-types';
import type { CustomerMarketingIntegrationProvider } from '../../shared/customer-marketing-credential-types';

export const CUSTOMER_MARKETING_ACTION_GATE_EXECUTOR_ENABLED = false as const;

export interface CustomerMarketingActionGateSourceEvidence {
  id: string;
  kind: 'campaign' | 'content';
  status: string;
  revision: number;
  sha256: string;
}

export interface CustomerMarketingActionGateEvaluationInput {
  request: CustomerMarketingActionGateRequest;
  workflow: CustomerMarketingWorkflowRecord | null;
  source: CustomerMarketingActionGateSourceEvidence | null;
  nowMs?: number;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const TARGET_PROVIDERS: Readonly<Record<
  CustomerMarketingWorkflowTarget,
  readonly CustomerMarketingIntegrationProvider[]
>> = Object.freeze({
  social: ['facebook', 'instagram', 'tiktok', 'youtube', 'telegram', 'x'],
  seo: ['google'],
  email: ['email'],
  crm: ['crm'],
});

const SPEND_PROVIDERS = new Set<CustomerMarketingIntegrationProvider>([
  'facebook',
  'instagram',
  'tiktok',
  'youtube',
  'x',
  'google',
]);

const REQUIRED_OPERATION = Object.freeze({
  publish: 'publish',
  spend: 'spend',
  bulk_email: 'bulk',
  destructive: 'integration.write',
} as const);

function denied(
  denialReason: CustomerMarketingActionGateResult['denialReason'],
): CustomerMarketingActionGateResult {
  return { allowed: false, executed: false, denialReason };
}

export function preflightCustomerMarketingActionGateRequest(
  request: CustomerMarketingActionGateRequest,
): CustomerMarketingActionGateResult | null {
  if (!TARGET_PROVIDERS[request.target].includes(request.provider)) {
    return denied('provider_unavailable');
  }
  if (
    request.action === 'bulk_email'
    && (request.target !== 'email' || request.provider !== 'email')
  ) {
    return denied('provider_unavailable');
  }
  if (
    request.action === 'spend'
    && (request.target !== 'social' && request.target !== 'seo'
      || !SPEND_PROVIDERS.has(request.provider))
  ) {
    return denied('provider_unavailable');
  }
  if (
    request.action === 'publish'
    && request.target !== 'social'
    && request.target !== 'seo'
  ) {
    return denied('provider_unavailable');
  }

  const { itemCount, recipientCount, spendVnd } = request.metadata;
  if (
    request.action === 'publish' && (itemCount < 1 || recipientCount !== 0 || spendVnd !== 0)
    || request.action === 'spend' && spendVnd < 1
    || request.action === 'bulk_email' && recipientCount < 1
    || request.action === 'destructive' && itemCount < 1
  ) {
    return denied('invalid_request');
  }
  return null;
}

export function validateCustomerMarketingActionGateApproval(
  request: CustomerMarketingActionGateRequest,
  workflow: CustomerMarketingWorkflowRecord | null,
  nowMs = Date.now(),
): CustomerMarketingActionGateResult | null {
  if (!workflow) return denied('approval_required');
  if (
    workflow.workflowId !== request.workflowId
    || workflow.approvalId !== request.approvalId
  ) {
    return denied('approval_invalid');
  }
  if (workflow.manifestDigest !== request.manifestDigest) {
    return denied('manifest_mismatch');
  }
  if (workflow.status !== 'approved' || !workflow.receipt) {
    return denied('approval_required');
  }

  const receipt = workflow.receipt;
  if (
    receipt.workflowId !== workflow.workflowId
    || receipt.approvalId !== workflow.approvalId
    || receipt.decision !== 'approved'
    || receipt.policyRevision !== workflow.manifest.grant.policyRevision
    || receipt.externalActionPerformed !== false
    || !SHA256_PATTERN.test(receipt.reviewerHash)
    || !SHA256_PATTERN.test(receipt.receiptDigest)
  ) {
    return denied('approval_invalid');
  }
  if (receipt.manifestDigest !== workflow.manifestDigest) {
    return denied('manifest_mismatch');
  }

  const expiresAt = Date.parse(workflow.manifest.grant.expiresAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresAt) || nowMs >= expiresAt) {
    return denied('approval_invalid');
  }
  return null;
}

export function evaluateCustomerMarketingActionGate(
  input: CustomerMarketingActionGateEvaluationInput,
): CustomerMarketingActionGateResult {
  const requestDenial = preflightCustomerMarketingActionGateRequest(input.request);
  if (requestDenial) return requestDenial;

  const approvalDenial = validateCustomerMarketingActionGateApproval(
    input.request,
    input.workflow,
    input.nowMs,
  );
  if (approvalDenial) return approvalDenial;

  const workflow = input.workflow!;
  const source = input.source;
  const manifest = workflow.manifest;
  if (
    !source
    || manifest.kind !== input.request.target
    || source.id !== manifest.inputRef.id
    || source.kind !== manifest.inputRef.kind
    || source.status !== 'approved'
    || source.revision !== manifest.inputRef.revision
    || source.sha256 !== manifest.inputRef.sha256
  ) {
    return denied('manifest_mismatch');
  }

  const grant = manifest.grant;
  if (
    grant.channels.length !== 1
    || grant.channels[0] !== input.request.target
    || input.request.metadata.itemCount > grant.limits.maxItems
    || input.request.metadata.recipientCount > grant.limits.maxRecipients
    || input.request.metadata.spendVnd > grant.limits.maxSpendVnd
    || !(grant.operations as readonly string[]).includes(REQUIRED_OPERATION[input.request.action])
  ) {
    return denied('policy_denied');
  }

  // CMR-306 approvals authorize local dry-runs only. Do not inspect credentials
  // until a separately reviewed external-action policy exists.
  if (grant.policyRevision === 'cmr-306.v1') return denied('policy_denied');

  return denied('current_wave_disabled');
}
