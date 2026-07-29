import {
  type CapabilityRegistrySnapshot,
  type RegisteredCapability,
} from '../../shared/capabilities';
import { canonicalJson } from '../../shared/personal-office';
import type { RequestApprovalInput } from '../work/work-service';
import { verifyCapabilityRegistryAudit } from './registry';

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
const SHA256_REGEX = /^sha256:[a-f0-9]{64}$/;

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
  snapshot: CapabilityRegistrySnapshot,
  capability: RegisteredCapability,
  context: CapabilityApprovalContext,
): RequestApprovalInput {
  if (!verifyCapabilityRegistryAudit(snapshot)) {
    throw new CapabilityApprovalAdapterError('Capability registry audit is invalid');
  }
  const registered = snapshot.capabilities.find(
    (candidate) => candidate.tool.id === capability.tool.id,
  );
  if (
    !registered
    || registered.auditFingerprint !== capability.auditFingerprint
    || registered.policyFingerprint !== capability.policyFingerprint
  ) {
    throw new CapabilityApprovalAdapterError(
      `Capability ${capability.tool.id} is not the audited registry record`,
    );
  }
  if (!registered.sideEffects.some((effect) => APPROVAL_SIDE_EFFECTS.has(effect))) {
    throw new CapabilityApprovalAdapterError(
      `Capability ${registered.tool.id} does not require a Loop 03 approval`,
    );
  }
  if (!context.idempotencyKey.trim()) {
    throw new CapabilityApprovalAdapterError('idempotencyKey is required');
  }
  if (!SHA256_REGEX.test(snapshot.auditDigest)) {
    throw new CapabilityApprovalAdapterError('registryDigest is invalid');
  }

  const capabilityAuthorization = Object.freeze({
    schemaVersion: 1,
    registrySchemaVersion: registered.registrySchemaVersion,
    registryVersion: registered.registryVersion,
    registryDigest: snapshot.auditDigest,
    packageId: registered.packageId,
    capabilityId: registered.tool.id,
    capabilityFingerprint: registered.auditFingerprint,
    requiredPermission: registered.tool.requiredPermission,
    policyVersion: registered.policyVersion,
    policyFingerprint: registered.policyFingerprint,
  });

  return {
    runId: context.runId,
    kind: approvalKind(registered),
    title: `Approve ${registered.tool.name}`,
    summary: (
      `Permission ${registered.tool.requiredPermission}; `
      + `trust zone ${registered.trustZone}; `
      + `classifications ${registered.dataClassifications.join(', ')}`
    ),
    risk: registered.permissionRisk,
    target: context.target,
    input: Object.freeze({
      capabilityAuthorization,
      invocationInput: context.input,
    }),
    estimatedSideEffect: canonicalJson({
      capabilityAuthorization,
      sideEffects: registered.sideEffects,
    }),
    idempotencyKey: context.idempotencyKey,
    ...(context.artifactId ? { artifactId: context.artifactId } : {}),
    ...(context.stepId ? { stepId: context.stepId } : {}),
    ...(context.preview ? { preview: context.preview } : {}),
    ...(context.ttlMs !== undefined ? { ttlMs: context.ttlMs } : {}),
    blockRun: true,
  };
}
