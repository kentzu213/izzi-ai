import { createHash } from 'node:crypto';
import {
  CAPABILITY_REGISTRY_SCHEMA_VERSION,
  CAPABILITY_REGISTRY_VERSION,
  canonicalCapabilityPayload,
  canonicalCapabilityRegistryPayload,
  capabilityPolicyKey,
  parseCapabilityManifestEnvelope,
  validateCapabilityPolicy,
  type CapabilityInvocationDecision,
  type CapabilityManifestEnvelope,
  type CapabilityPolicy,
  type CapabilityRegistrySnapshot,
  type RegisteredCapability,
} from '../../shared/capabilities';
import {
  asId,
  policyFor,
  type DataClassification,
  type SkillPackage,
  type ToolDefinition,
} from '../../shared/personal-office';
import { DEFAULT_CAPABILITY_POLICIES } from './policy-catalog';

export type CapabilityRegistryErrorCode =
  | 'DUPLICATE_POLICY'
  | 'DUPLICATE_PACKAGE'
  | 'UNSUPPORTED_DECLARATION'
  | 'UNKNOWN_CAPABILITY'
  | 'BLOCKED_CAPABILITY';

export class CapabilityRegistryError extends Error {
  constructor(
    readonly code: CapabilityRegistryErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = Object.freeze({}),
  ) {
    super(message);
    this.name = 'CapabilityRegistryError';
  }
}

export interface CapabilityInvocationRequest {
  readonly capabilityId: string;
  readonly grantedPermissions: readonly string[];
  readonly dataClassifications: readonly DataClassification[];
}

const APPROVAL_SIDE_EFFECTS = new Set([
  'external_action',
  'local_write',
  'network_egress',
  'process_execution',
  'secret_access',
]);

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

function sourceIdentity(envelope: CapabilityManifestEnvelope): string {
  return `${envelope.source.kind}:${envelope.source.manifestName}@${envelope.source.manifestVersion}`;
}

function declarationIdentity(
  envelope: CapabilityManifestEnvelope,
  declaration: CapabilityManifestEnvelope['declarations'][number],
): string {
  return `${sourceIdentity(envelope)}:${declaration.kind}:${declaration.key}`;
}

function policyMap(policies: readonly CapabilityPolicy[]): ReadonlyMap<string, CapabilityPolicy> {
  const mapped = new Map<string, CapabilityPolicy>();
  for (const policy of policies) {
    validateCapabilityPolicy(policy);
    const key = capabilityPolicyKey(
      policy.sourceKind,
      policy.declarationKind,
      policy.declarationKey,
    );
    if (mapped.has(key)) {
      throw new CapabilityRegistryError(
        'DUPLICATE_POLICY',
        `Duplicate capability policy: ${key}`,
        { policyKey: key },
      );
    }
    mapped.set(key, policy);
  }
  return mapped;
}

function hasExternalEffect(policy: CapabilityPolicy): boolean {
  return policy.sideEffects.some((effect) => (
    effect === 'external_action'
    || effect === 'network_egress'
    || effect === 'process_execution'
  ));
}

function capabilityRequiresApproval(capability: RegisteredCapability): boolean {
  return capability.sideEffects.some((effect) => APPROVAL_SIDE_EFFECTS.has(effect));
}

/**
 * Build an immutable registry in one pass. All envelopes and policies validate
 * before a snapshot is returned, so callers never observe a partially admitted
 * package.
 */
export function buildCapabilityRegistry(
  inputs: readonly unknown[],
  policies: readonly CapabilityPolicy[] = DEFAULT_CAPABILITY_POLICIES,
): CapabilityRegistrySnapshot {
  const catalog = policyMap(policies);
  const envelopes = inputs
    .map(parseCapabilityManifestEnvelope)
    .sort((left, right) => sourceIdentity(left).localeCompare(sourceIdentity(right)));

  const seenPackages = new Set<string>();
  const packages = [];
  const capabilities: RegisteredCapability[] = [];

  for (const envelope of envelopes) {
    const identity = sourceIdentity(envelope);
    if (seenPackages.has(identity)) {
      throw new CapabilityRegistryError(
        'DUPLICATE_PACKAGE',
        `Duplicate package envelope: ${identity}`,
        { package: identity },
      );
    }
    seenPackages.add(identity);

    if (envelope.unsupportedDeclarations.length > 0) {
      throw new CapabilityRegistryError(
        'UNSUPPORTED_DECLARATION',
        `Package ${identity} contains unsupported capability declarations`,
        {
          package: identity,
          unsupportedDeclarations: envelope.unsupportedDeclarations,
        },
      );
    }

    const packageId = `skill-package:${identity}`;
    const packageCapabilities: RegisteredCapability[] = [];
    const requestedPermissions = new Set<string>();

    for (const declaration of envelope.declarations) {
      const key = capabilityPolicyKey(
        envelope.source.kind,
        declaration.kind,
        declaration.key,
      );
      const policy = catalog.get(key);
      if (!policy) {
        throw new CapabilityRegistryError(
          'UNKNOWN_CAPABILITY',
          `Unknown capability declaration: ${key}`,
          { package: identity, declaration },
        );
      }
      if (policy.status === 'blocked') {
        throw new CapabilityRegistryError(
          'BLOCKED_CAPABILITY',
          `Blocked capability declaration: ${key}. ${policy.blockedReason}`,
          {
            package: identity,
            declaration,
            blockedReason: policy.blockedReason,
          },
        );
      }

      requestedPermissions.add(policy.requiredPermission);
      const capabilityId = `tool:${declarationIdentity(envelope, declaration)}`;
      const tool: ToolDefinition = {
        schemaVersion: 1,
        id: asId<'ToolDefinitionId'>(capabilityId),
        name: `${envelope.source.manifestName}:${declaration.key}`,
        description: policy.description,
        requiredPermission: policy.requiredPermission,
        hasExternalEffect: hasExternalEffect(policy),
        classification: 'public_metadata',
        createdAt: envelope.source.observedAt,
        updatedAt: envelope.source.observedAt,
      };
      const unsignedCapability: Omit<RegisteredCapability, 'auditFingerprint'> = {
        registrySchemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
        registryVersion: CAPABILITY_REGISTRY_VERSION,
        packageId,
        tool,
        trustZone: policy.trustZone,
        dataClassifications: Object.freeze([...policy.dataClassifications].sort()),
        sideEffects: Object.freeze([...policy.sideEffects].sort()),
        permissionRisk: policy.permissionRisk,
        policyVersion: policy.policyVersion,
        sourceDeclaration: declaration,
      };
      packageCapabilities.push({
        ...unsignedCapability,
        auditFingerprint: sha256(canonicalCapabilityPayload(unsignedCapability)),
      });
    }

    packageCapabilities.sort((left, right) => left.tool.id.localeCompare(right.tool.id));
    const skillPackage: SkillPackage = {
      schemaVersion: 1,
      id: asId<'SkillPackageId'>(packageId),
      name: envelope.source.manifestName,
      packageVersion: envelope.source.manifestVersion,
      requestedPermissions: Object.freeze([...requestedPermissions].sort()),
      ...(envelope.package.signatureDigest
        ? { signatureDigest: envelope.package.signatureDigest }
        : {}),
      classification: 'public_metadata',
      createdAt: envelope.source.observedAt,
      updatedAt: envelope.source.observedAt,
    };
    packages.push({
      source: envelope.source,
      skillPackage,
      capabilityIds: Object.freeze(
        packageCapabilities.map((capability) => capability.tool.id),
      ),
    });
    capabilities.push(...packageCapabilities);
  }

  capabilities.sort((left, right) => left.tool.id.localeCompare(right.tool.id));
  const unsignedSnapshot: Omit<CapabilityRegistrySnapshot, 'auditDigest'> = {
    schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
    registryVersion: CAPABILITY_REGISTRY_VERSION,
    packages: Object.freeze(packages),
    capabilities: Object.freeze(capabilities),
  };
  return deepFreeze({
    ...unsignedSnapshot,
    auditDigest: sha256(canonicalCapabilityRegistryPayload(unsignedSnapshot)),
  });
}

/** Verify both the whole-registry digest and every per-capability fingerprint. */
export function verifyCapabilityRegistryAudit(
  snapshot: CapabilityRegistrySnapshot,
): boolean {
  const { auditDigest, ...unsignedSnapshot } = snapshot;
  if (sha256(canonicalCapabilityRegistryPayload(unsignedSnapshot)) !== auditDigest) {
    return false;
  }
  return snapshot.capabilities.every((capability) => {
    const { auditFingerprint, ...unsignedCapability } = capability;
    return (
      sha256(canonicalCapabilityPayload(unsignedCapability))
      === auditFingerprint
    );
  });
}

/**
 * Exact-permission, classification-aware invocation gate. Wildcard grants do
 * not satisfy exact permissions.
 */
export function evaluateCapabilityInvocation(
  snapshot: CapabilityRegistrySnapshot,
  request: CapabilityInvocationRequest,
): CapabilityInvocationDecision {
  if (!verifyCapabilityRegistryAudit(snapshot)) {
    return {
      allowed: false,
      code: 'AUDIT_INVALID',
      reason: 'Capability registry audit digest or fingerprint is invalid',
    };
  }
  const capability = snapshot.capabilities.find(
    (candidate) => candidate.tool.id === request.capabilityId,
  );
  if (!capability) {
    return {
      allowed: false,
      code: 'UNKNOWN_CAPABILITY',
      reason: `Capability is not registered: ${request.capabilityId}`,
    };
  }

  if (!request.grantedPermissions.includes(capability.tool.requiredPermission)) {
    return {
      allowed: false,
      code: 'MISSING_PERMISSION',
      reason: `Exact permission required: ${capability.tool.requiredPermission}`,
    };
  }

  for (const classification of new Set(request.dataClassifications)) {
    if (!capability.dataClassifications.includes(classification)) {
      return {
        allowed: false,
        code: 'CLASSIFICATION_DENIED',
        reason: `${classification} is outside the capability policy`,
      };
    }
    if (
      capability.sideEffects.includes('network_egress')
      && policyFor(classification).egress !== 'egress_allowed'
    ) {
      return {
        allowed: false,
        code: 'EGRESS_DENIED',
        reason: `${classification} may not be sent through a network capability`,
      };
    }
  }

  return {
    allowed: true,
    capability,
    requiresApproval: capabilityRequiresApproval(capability),
  };
}
