import { createHash } from 'node:crypto';
import {
  CAPABILITY_ADAPTER_VERSION,
  CAPABILITY_REGISTRY_SCHEMA_VERSION,
  CAPABILITY_REGISTRY_VERSION,
  canonicalCapabilityPayload,
  canonicalCapabilityPolicyPayload,
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
  PERSONAL_OFFICE_SCHEMA_VERSION,
  asId,
  isSecretRef,
  looksLikeRawSecret,
  policyFor,
  type DataClassification,
  type IntegrationGrant,
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

export interface CapabilityGrantScope {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceInstanceId: string;
  readonly packageId: string;
  readonly capabilityId: string;
  readonly requiredPermission: string;
}

/**
 * This resolver is a main-process trust boundary. Its implementation must read
 * accepted IntegrationGrant records from the authoritative store; renderer or
 * package input must never provide the returned object directly.
 */
export type CapabilityGrantResolver = (
  scope: CapabilityGrantScope,
) => IntegrationGrant | null;

export interface CapabilityInvocationRequest {
  readonly capabilityId: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceInstanceId: string;
  /** Explicit clock input used to reject expired grants deterministically. */
  readonly evaluatedAt: string;
  readonly dataClassifications: readonly DataClassification[];
}

const APPROVAL_SIDE_EFFECTS = new Set([
  'external_action',
  'local_write',
  'network_egress',
  'process_execution',
  'secret_access',
]);
const SHA256_REGEX = /^sha256:[a-f0-9]{64}$/;
const SAFE_SCOPE_VALUE_REGEX = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const SECRET_STORES = new Set([
  'encrypted_file',
  'env',
  'integration_vault',
  'os_keychain',
]);

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExpectedKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key))
  );
}

function arraysEqual<T>(
  left: readonly T[],
  right: readonly T[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isSortedUnique(values: readonly string[]): boolean {
  return (
    new Set(values).size === values.length
    && arraysEqual(values, [...values].sort())
  );
}

function isSafeScopeValue(value: unknown): value is string {
  return typeof value === 'string' && SAFE_SCOPE_VALUE_REGEX.test(value);
}

function isExactIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
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

function policyFingerprint(policy: CapabilityPolicy): string {
  return sha256(canonicalCapabilityPolicyPayload(policy));
}

export function capabilityGrantScopes(
  scope: CapabilityGrantScope,
): readonly string[] {
  return Object.freeze([
    `capability.tenant:${scope.tenantId}`,
    `capability.user:${scope.userId}`,
    `capability.workspace:${scope.workspaceInstanceId}`,
    `capability.package:${scope.packageId}`,
    `capability.tool:${scope.capabilityId}`,
    `capability.permission:${scope.requiredPermission}`,
  ].sort());
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
        policyFingerprint: policyFingerprint(policy),
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

function validatePackageRecord(
  value: CapabilityRegistrySnapshot['packages'][number],
): boolean {
  if (!hasExpectedKeys(value, ['capabilityIds', 'skillPackage', 'source'])) return false;
  if (!hasExpectedKeys(
    value.source,
    ['adapterVersion', 'kind', 'manifestName', 'manifestVersion', 'observedAt'],
  )) return false;
  if (!hasExpectedKeys(
    value.skillPackage,
    [
      'classification',
      'createdAt',
      'id',
      'name',
      'packageVersion',
      'requestedPermissions',
      'schemaVersion',
      'updatedAt',
    ],
    ['signatureDigest'],
  )) return false;
  if (!Array.isArray(value.capabilityIds) || !isSortedUnique(value.capabilityIds)) return false;
  if (
    !Array.isArray(value.skillPackage.requestedPermissions)
    || !isSortedUnique(value.skillPackage.requestedPermissions)
  ) return false;

  parseCapabilityManifestEnvelope({
    schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
    source: value.source,
    package: {
      displayName: value.source.manifestName,
      description: 'Capability registry audit reconstruction.',
      ...(value.skillPackage.signatureDigest
        ? { signatureDigest: value.skillPackage.signatureDigest }
        : {}),
    },
    declarations: [],
    unsupportedDeclarations: [],
  });

  const identity = sourceIdentity({
    schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
    source: value.source,
    package: {
      displayName: value.source.manifestName,
      description: 'Capability registry audit reconstruction.',
    },
    declarations: [],
    unsupportedDeclarations: [],
  });
  const expectedPackageId = `skill-package:${identity}`;
  return (
    value.source.adapterVersion === CAPABILITY_ADAPTER_VERSION
    && value.skillPackage.schemaVersion === PERSONAL_OFFICE_SCHEMA_VERSION
    && value.skillPackage.id === expectedPackageId
    && value.skillPackage.name === value.source.manifestName
    && value.skillPackage.packageVersion === value.source.manifestVersion
    && value.skillPackage.classification === 'public_metadata'
    && value.skillPackage.createdAt === value.source.observedAt
    && value.skillPackage.updatedAt === value.source.observedAt
  );
}

function validateCapabilityRecord(
  capability: RegisteredCapability,
  packageRecord: CapabilityRegistrySnapshot['packages'][number],
  catalog: ReadonlyMap<string, CapabilityPolicy>,
): boolean {
  if (!hasExpectedKeys(capability, [
    'auditFingerprint',
    'dataClassifications',
    'packageId',
    'permissionRisk',
    'policyFingerprint',
    'policyVersion',
    'registrySchemaVersion',
    'registryVersion',
    'sideEffects',
    'sourceDeclaration',
    'tool',
    'trustZone',
  ])) return false;
  if (!hasExpectedKeys(capability.tool, [
    'classification',
    'createdAt',
    'description',
    'hasExternalEffect',
    'id',
    'name',
    'requiredPermission',
    'schemaVersion',
    'updatedAt',
  ])) return false;
  if (!hasExpectedKeys(capability.sourceDeclaration, ['key', 'kind', 'manifestPath'])) {
    return false;
  }
  if (
    !Array.isArray(capability.dataClassifications)
    || !isSortedUnique(capability.dataClassifications)
    || !Array.isArray(capability.sideEffects)
    || !isSortedUnique(capability.sideEffects)
    || !SHA256_REGEX.test(capability.policyFingerprint)
    || !SHA256_REGEX.test(capability.auditFingerprint)
  ) return false;

  const parsed = parseCapabilityManifestEnvelope({
    schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
    source: packageRecord.source,
    package: {
      displayName: packageRecord.source.manifestName,
      description: 'Capability registry audit reconstruction.',
    },
    declarations: [capability.sourceDeclaration],
    unsupportedDeclarations: [],
  });
  const declaration = parsed.declarations[0];
  if (!declaration) return false;

  const key = capabilityPolicyKey(
    packageRecord.source.kind,
    declaration.kind,
    declaration.key,
  );
  const policy = catalog.get(key);
  if (!policy || policy.status !== 'allowed') return false;

  const expectedCapabilityId = `tool:${declarationIdentity(parsed, declaration)}`;
  const expectedPolicyFingerprint = policyFingerprint(policy);
  const { auditFingerprint, ...unsignedCapability } = capability;
  return (
    capability.registrySchemaVersion === CAPABILITY_REGISTRY_SCHEMA_VERSION
    && capability.registryVersion === CAPABILITY_REGISTRY_VERSION
    && capability.packageId === packageRecord.skillPackage.id
    && capability.tool.schemaVersion === PERSONAL_OFFICE_SCHEMA_VERSION
    && capability.tool.id === expectedCapabilityId
    && capability.tool.name === `${packageRecord.source.manifestName}:${declaration.key}`
    && capability.tool.description === policy.description
    && capability.tool.requiredPermission === policy.requiredPermission
    && capability.tool.hasExternalEffect === hasExternalEffect(policy)
    && capability.tool.classification === 'public_metadata'
    && capability.tool.createdAt === packageRecord.source.observedAt
    && capability.tool.updatedAt === packageRecord.source.observedAt
    && capability.trustZone === policy.trustZone
    && arraysEqual(capability.dataClassifications, [...policy.dataClassifications].sort())
    && arraysEqual(capability.sideEffects, [...policy.sideEffects].sort())
    && capability.permissionRisk === policy.permissionRisk
    && capability.policyVersion === policy.policyVersion
    && capability.policyFingerprint === expectedPolicyFingerprint
    && sha256(canonicalCapabilityPayload(unsignedCapability)) === auditFingerprint
  );
}

/**
 * Verify the public hashes and re-derive every authority-bearing field from the
 * trusted host policy catalog. Hashes detect accidental corruption; the catalog
 * comparison is the trust anchor that prevents a cloned snapshot from minting
 * new authority and simply recomputing its hashes.
 */
export function verifyCapabilityRegistryAudit(
  snapshot: CapabilityRegistrySnapshot,
  policies: readonly CapabilityPolicy[] = DEFAULT_CAPABILITY_POLICIES,
): boolean {
  try {
    if (!hasExpectedKeys(snapshot, [
      'auditDigest',
      'capabilities',
      'packages',
      'registryVersion',
      'schemaVersion',
    ])) return false;
    if (
      snapshot.schemaVersion !== CAPABILITY_REGISTRY_SCHEMA_VERSION
      || snapshot.registryVersion !== CAPABILITY_REGISTRY_VERSION
      || !SHA256_REGEX.test(snapshot.auditDigest)
      || !Array.isArray(snapshot.packages)
      || !Array.isArray(snapshot.capabilities)
    ) return false;

    const catalog = policyMap(policies);
    const packageIds = new Set<string>();
    const packageById = new Map<string, CapabilityRegistrySnapshot['packages'][number]>();
    const packageSortKeys: string[] = [];
    for (const packageRecord of snapshot.packages) {
      if (!validatePackageRecord(packageRecord)) return false;
      const packageId = packageRecord.skillPackage.id;
      if (packageIds.has(packageId)) return false;
      packageIds.add(packageId);
      packageById.set(packageId, packageRecord);
      packageSortKeys.push(sourceIdentity({
        schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
        source: packageRecord.source,
        package: {
          displayName: packageRecord.source.manifestName,
          description: 'Capability registry audit reconstruction.',
        },
        declarations: [],
        unsupportedDeclarations: [],
      }));
    }
    if (!arraysEqual(packageSortKeys, [...packageSortKeys].sort())) return false;

    const capabilityIds = snapshot.capabilities.map((capability) => capability.tool.id);
    if (!isSortedUnique(capabilityIds)) return false;
    const capabilitiesByPackage = new Map<string, RegisteredCapability[]>();
    for (const capability of snapshot.capabilities) {
      const packageRecord = packageById.get(capability.packageId);
      if (!packageRecord || !validateCapabilityRecord(capability, packageRecord, catalog)) {
        return false;
      }
      const current = capabilitiesByPackage.get(capability.packageId) ?? [];
      current.push(capability);
      capabilitiesByPackage.set(capability.packageId, current);
    }

    for (const packageRecord of snapshot.packages) {
      const capabilities = capabilitiesByPackage.get(packageRecord.skillPackage.id) ?? [];
      const expectedCapabilityIds = capabilities.map((capability) => capability.tool.id).sort();
      const expectedPermissions = [
        ...new Set(capabilities.map((capability) => capability.tool.requiredPermission)),
      ].sort();
      if (
        !arraysEqual(packageRecord.capabilityIds, expectedCapabilityIds)
        || !arraysEqual(packageRecord.skillPackage.requestedPermissions, expectedPermissions)
      ) return false;
    }

    const { auditDigest, ...unsignedSnapshot } = snapshot;
    return sha256(canonicalCapabilityRegistryPayload(unsignedSnapshot)) === auditDigest;
  } catch {
    return false;
  }
}

function validateResolvedGrant(
  grant: IntegrationGrant,
  expected: CapabilityGrantScope,
  evaluatedAt: string,
): boolean {
  if (!hasExpectedKeys(grant, [
    'createdAt',
    'id',
    'integration',
    'schemaVersion',
    'scopes',
    'secret',
    'updatedAt',
    'workspaceInstanceId',
  ], ['expiresAt', 'revokedAt'])) return false;
  if (
    grant.schemaVersion !== PERSONAL_OFFICE_SCHEMA_VERSION
    || !isSafeScopeValue(grant.id)
    || grant.workspaceInstanceId !== expected.workspaceInstanceId
    || grant.integration !== expected.packageId
    || !Array.isArray(grant.scopes)
    || grant.scopes.some((scope) => (
      !isSafeScopeValue(scope)
      || scope.includes('*')
      || looksLikeRawSecret(scope)
    ))
    || new Set(grant.scopes).size !== grant.scopes.length
    || !isExactIsoTimestamp(grant.createdAt)
    || !isExactIsoTimestamp(grant.updatedAt)
    || Date.parse(grant.updatedAt) < Date.parse(grant.createdAt)
    || !isSecretRef(grant.secret)
    || !hasExpectedKeys(grant.secret, ['kind', 'ref', 'store'], ['scopes'])
    || !SECRET_STORES.has(grant.secret.store)
    || !grant.secret.ref.trim()
    || /[\r\n\0]/.test(grant.secret.ref)
    || looksLikeRawSecret(grant.secret.ref)
  ) return false;
  if (
    grant.revokedAt !== undefined
    || (
      grant.expiresAt !== undefined
      && (
        !isExactIsoTimestamp(grant.expiresAt)
        || Date.parse(grant.expiresAt) <= Date.parse(evaluatedAt)
      )
    )
  ) return false;
  if (grant.secret.scopes !== undefined) {
    if (
      !Array.isArray(grant.secret.scopes)
      || grant.secret.scopes.some((scope) => (
        !isSafeScopeValue(scope)
        || scope.includes('*')
        || looksLikeRawSecret(scope)
        || !grant.scopes.includes(scope)
      ))
      || new Set(grant.secret.scopes).size !== grant.secret.scopes.length
    ) return false;
  }

  const expectedScopes = capabilityGrantScopes(expected);
  const declaredCapabilityScopes = grant.scopes
    .filter((scope) => scope.startsWith('capability.'))
    .sort();
  return arraysEqual(declaredCapabilityScopes, expectedScopes);
}

/**
 * Accepted-grant, exact-scope and classification-aware invocation gate.
 * Permission strings supplied by a renderer/package are never authorization;
 * only an accepted IntegrationGrant returned by the trusted resolver can pass.
 */
export function evaluateCapabilityInvocation(
  snapshot: CapabilityRegistrySnapshot,
  request: CapabilityInvocationRequest,
  resolveGrant: CapabilityGrantResolver,
): CapabilityInvocationDecision {
  if (!verifyCapabilityRegistryAudit(snapshot)) {
    return {
      allowed: false,
      code: 'AUDIT_INVALID',
      reason: 'Capability registry audit digest or fingerprint is invalid',
    };
  }
  if (
    !hasExpectedKeys(request, [
      'capabilityId',
      'dataClassifications',
      'evaluatedAt',
      'tenantId',
      'userId',
      'workspaceInstanceId',
    ])
    || !isSafeScopeValue(request.capabilityId)
    || !Array.isArray(request.dataClassifications)
  ) {
    return {
      allowed: false,
      code: 'GRANT_DENIED',
      reason: 'A complete, exact capability invocation scope is required',
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

  if (
    !isSafeScopeValue(request.tenantId)
    || !isSafeScopeValue(request.userId)
    || !isSafeScopeValue(request.workspaceInstanceId)
    || !isExactIsoTimestamp(request.evaluatedAt)
    || typeof resolveGrant !== 'function'
  ) {
    return {
      allowed: false,
      code: 'GRANT_DENIED',
      reason: 'A trusted, workspace-bound IntegrationGrant is required',
    };
  }

  const expectedGrant: CapabilityGrantScope = {
    tenantId: request.tenantId,
    userId: request.userId,
    workspaceInstanceId: request.workspaceInstanceId,
    packageId: capability.packageId,
    capabilityId: capability.tool.id,
    requiredPermission: capability.tool.requiredPermission,
  };
  let grant: IntegrationGrant | null;
  try {
    grant = resolveGrant(expectedGrant);
  } catch {
    grant = null;
  }
  if (!grant || !validateResolvedGrant(grant, expectedGrant, request.evaluatedAt)) {
    return {
      allowed: false,
      code: 'GRANT_DENIED',
      reason: 'No valid exact-scope IntegrationGrant authorizes this invocation',
    };
  }

  return {
    allowed: true,
    capability,
    requiresApproval: capabilityRequiresApproval(capability),
  };
}
