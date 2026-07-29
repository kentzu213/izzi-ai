import type { RegisteredCapability } from '../../shared/capabilities';
import type { RequestApprovalInput } from '../work/work-service';

export interface CapabilityApprovalContext {
  readonly runId: string;
  readonly target: string;
  readonly input: unknown;
  readonly idempotencyKey: string;
  readonly artifactId?: string;
  readonly stepId?: string;
  readonly preview?: string;
  readonly ttlMs?: number;
}

export class CapabilityApprovalAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityApprovalAdapterError';
  }
}

const APPROVAL_SIDE_EFFECTS = new Set([
  'external_action',
  'local_write',
  'network_egress',
  'process_execution',
  'secret_access',
]);

function approvalKind(
  capability: RegisteredCapability,
): RequestApprovalInput['kind'] {
  const dataOnly = capability.sideEffects.every((effect) => (
    effect === 'local_read'
    || effect === 'local_write'
    || effect === 'secret_access'
  ));
  return dataOnly ? 'data_write' : 'host_action';
}

/**
 * Translate a registered side effect into Loop 03's approval input. This only
 * builds the request; WorkService remains the authority that hashes, persists
 * and decides the approval, and it never executes the external action itself.
 */
export function buildCapabilityApprovalRequest(
  capability: RegisteredCapability,
  context: CapabilityApprovalContext,
): RequestApprovalInput {
  if (!capability.sideEffects.some((effect) => APPROVAL_SIDE_EFFECTS.has(effect))) {
    throw new CapabilityApprovalAdapterError(
      `Capability ${capability.tool.id} does not require a Loop 03 approval`,
    );
  }
  if (!context.idempotencyKey.trim()) {
    throw new CapabilityApprovalAdapterError('idempotencyKey is required');
  }

  return {
    runId: context.runId,
    kind: approvalKind(capability),
    title: `Approve ${capability.tool.name}`,
    summary: (
      `Permission ${capability.tool.requiredPermission}; `
      + `trust zone ${capability.trustZone}; `
      + `classifications ${capability.dataClassifications.join(', ')}`
    ),
    risk: capability.permissionRisk,
    target: context.target,
    input: context.input,
    estimatedSideEffect: capability.sideEffects.join(', '),
    idempotencyKey: context.idempotencyKey,
    ...(context.artifactId ? { artifactId: context.artifactId } : {}),
    ...(context.stepId ? { stepId: context.stepId } : {}),
    ...(context.preview ? { preview: context.preview } : {}),
    ...(context.ttlMs !== undefined ? { ttlMs: context.ttlMs } : {}),
    blockRun: true,
  };
}
