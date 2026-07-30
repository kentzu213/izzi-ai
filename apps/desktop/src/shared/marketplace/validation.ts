import {
  CAPABILITY_REGISTRY_SCHEMA_VERSION,
  CAPABILITY_REGISTRY_VERSION,
  type CapabilityManifestSourceKind,
  type CapabilityPermissionRisk,
  type CapabilitySideEffect,
} from '../capabilities';
import {
  looksLikeRawSecret,
  type DataClassification,
} from '../personal-office';
import {
  MARKETPLACE_CATALOG_SCHEMA_VERSION,
  MARKETPLACE_CATALOG_VERSION,
  MARKETPLACE_INSTALL_PLAN_SCHEMA_VERSION,
  MARKETPLACE_INSTALL_PLAN_VERSION,
  MarketplaceValidationError,
  type MarketplaceCapabilityReview,
  type MarketplaceCatalog,
  type MarketplaceCatalogMetadataEnvelope,
  type MarketplaceCatalogMetadataPackage,
  type MarketplaceCatalogProvenance,
  type MarketplaceCatalogSource,
  type MarketplaceInstallPlan,
  type MarketplaceInstallPlanCapability,
  type MarketplaceInstallScope,
  type MarketplacePackage,
  type MarketplacePackageCompatibility,
  type MarketplacePackageIdentity,
  type MarketplacePackageInstallation,
  type MarketplaceValidationCode,
} from './types';

const SOURCE_KINDS: readonly CapabilityManifestSourceKind[] = [
  'agent_bundle',
  'ocx_extension',
];
const RISKS: readonly CapabilityPermissionRisk[] = ['low', 'medium', 'high'];
const CLASSIFICATIONS: readonly DataClassification[] = [
  'artifacts',
  'audit_events',
  'local_files',
  'personal_graph',
  'public_metadata',
  'secrets',
];
const SIDE_EFFECTS: readonly CapabilitySideEffect[] = [
  'external_action',
  'local_read',
  'local_write',
  'network_egress',
  'process_execution',
  'secret_access',
  'ui_mutation',
];
const APPROVAL_SIDE_EFFECTS = new Set<CapabilitySideEffect>([
  'external_action',
  'local_write',
  'network_egress',
  'process_execution',
  'secret_access',
]);
const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const NAME_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const SAFE_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const PERMISSION_REGEX = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SHA256_REGEX = /^sha256:[a-f0-9]{64}$/;
const EMBEDDED_CREDENTIAL_REGEX =
  /(?:^|[^A-Za-z0-9])(?:sk|pk|ghp|gho|xox[bap])[-_][A-Za-z0-9_-]{10,}(?:$|[^A-Za-z0-9_-])/i;
const EMBEDDED_HEX_SECRET_REGEX = /(?:^|[^A-Fa-f0-9])[A-Fa-f0-9]{32,}(?:$|[^A-Fa-f0-9])/;
const EMBEDDED_JWT_REGEX =
  /(?:^|[^A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/;

function fail(
  code: MarketplaceValidationCode,
  path: string,
  message: string,
): never {
  throw new MarketplaceValidationError([{ code, path, message }]);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('INVALID_VALUE', path, 'must be a plain object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail('INVALID_VALUE', path, 'must be a plain object');
  }
  return value as Record<string, unknown>;
}

function assertKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      fail('INVALID_VALUE', `${path}.${key}`, 'is required');
    }
  }
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      fail('UNKNOWN_FIELD', `${path}.${key}`, 'is not supported');
    }
  }
}

function readString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  options: {
    readonly min?: number;
    readonly max?: number;
    readonly optional?: boolean;
  } = {},
): string | undefined {
  const value = record[key];
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== 'string') {
    fail('INVALID_VALUE', `${path}.${key}`, 'must be a string');
  }
  const min = options.min ?? 1;
  const max = options.max ?? 500;
  if (value.length < min || value.length > max || /[\r\n\0]/.test(value)) {
    fail('INVALID_VALUE', `${path}.${key}`, `must be ${min}-${max} safe characters`);
  }
  return value;
}

function readStringArray(
  value: unknown,
  path: string,
  allowed?: readonly string[],
): readonly string[] {
  if (!Array.isArray(value)) fail('INVALID_VALUE', path, 'must be an array');
  const result = value.map((item, index) => {
    if (typeof item !== 'string') {
      fail('INVALID_VALUE', `${path}[${index}]`, 'must be a string');
    }
    if (allowed && !allowed.includes(item)) {
      fail('INVALID_VALUE', `${path}[${index}]`, `unsupported value: ${item}`);
    }
    return item;
  });
  if (new Set(result).size !== result.length) {
    fail('INVALID_VALUE', path, 'must not contain duplicates');
  }
  return Object.freeze([...result].sort());
}

function exactIso(value: string, path: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    fail('INVALID_VALUE', path, 'must be an exact ISO-8601 UTC timestamp');
  }
  return value;
}

function semver(value: string, path: string): string {
  if (!SEMVER_REGEX.test(value)) {
    fail('INVALID_VALUE', path, 'must be semantic version text');
  }
  return value;
}

function safePublicText(value: string, path: string): string {
  if (
    looksLikeRawSecret(value)
    || EMBEDDED_CREDENTIAL_REGEX.test(value)
    || EMBEDDED_HEX_SECRET_REGEX.test(value)
    || EMBEDDED_JWT_REGEX.test(value)
  ) {
    fail('RAW_SECRET', path, 'credential-shaped public metadata is forbidden');
  }
  return value;
}

export function marketplacePackageKey(
  sourceKind: CapabilityManifestSourceKind,
  packageName: string,
  packageVersion: string,
): string {
  return `${sourceKind}:${packageName}@${packageVersion}`;
}

export function marketplaceInstallPlanId(
  packageKey: string,
  scope: MarketplaceInstallScope,
  registryDigest: string,
): string {
  return [
    'marketplace-install-plan',
    MARKETPLACE_INSTALL_PLAN_VERSION,
    packageKey,
    scope.tenantId,
    scope.userId,
    scope.workspaceInstanceId,
    registryDigest,
  ].join(':');
}

function parseIdentity(value: unknown, path: string): MarketplacePackageIdentity {
  const record = asRecord(value, path);
  assertKeys(
    record,
    ['packageKey', 'packageName', 'packageVersion', 'sourceKind'],
    [],
    path,
  );
  const sourceKind = readString(record, 'sourceKind', path) as CapabilityManifestSourceKind;
  if (!SOURCE_KINDS.includes(sourceKind)) {
    fail('INVALID_VALUE', `${path}.sourceKind`, 'is unsupported');
  }
  const packageName = readString(record, 'packageName', path, { max: 64 })!;
  if (!NAME_REGEX.test(packageName)) {
    fail('INVALID_VALUE', `${path}.packageName`, 'must be kebab-case');
  }
  const packageVersion = semver(
    readString(record, 'packageVersion', path, { max: 64 })!,
    `${path}.packageVersion`,
  );
  const packageKey = readString(record, 'packageKey', path, { max: 256 })!;
  const expected = marketplacePackageKey(sourceKind, packageName, packageVersion);
  if (packageKey !== expected) {
    fail('INVALID_VALUE', `${path}.packageKey`, `must equal ${expected}`);
  }
  return Object.freeze({ sourceKind, packageName, packageVersion, packageKey });
}

function parseMetadataIdentity(
  value: unknown,
  path: string,
): Omit<MarketplacePackageIdentity, 'packageKey'> {
  const record = asRecord(value, path);
  assertKeys(record, ['packageName', 'packageVersion', 'sourceKind'], [], path);
  const sourceKind = readString(record, 'sourceKind', path) as CapabilityManifestSourceKind;
  if (!SOURCE_KINDS.includes(sourceKind)) {
    fail('INVALID_VALUE', `${path}.sourceKind`, 'is unsupported');
  }
  const packageName = readString(record, 'packageName', path, { max: 64 })!;
  if (!NAME_REGEX.test(packageName)) {
    fail('INVALID_VALUE', `${path}.packageName`, 'must be kebab-case');
  }
  return Object.freeze({
    sourceKind,
    packageName,
    packageVersion: semver(
      readString(record, 'packageVersion', path, { max: 64 })!,
      `${path}.packageVersion`,
    ),
  });
}

function parseMetadataPackage(
  value: unknown,
  index: number,
): MarketplaceCatalogMetadataPackage {
  const path = `metadata.packages[${index}]`;
  const record = asRecord(value, path);
  assertKeys(
    record,
    [
      'category',
      'displayName',
      'identity',
      'minimumDesktopVersion',
      'publisher',
      'summary',
    ],
    ['maximumDesktopVersion'],
    path,
  );
  const maximumDesktopVersion = readString(record, 'maximumDesktopVersion', path, {
    max: 64,
    optional: true,
  });
  return Object.freeze({
    identity: parseMetadataIdentity(record.identity, `${path}.identity`),
    displayName: safePublicText(
      readString(record, 'displayName', path, { max: 128 })!,
      `${path}.displayName`,
    ),
    summary: safePublicText(
      readString(record, 'summary', path, { max: 500 })!,
      `${path}.summary`,
    ),
    publisher: safePublicText(
      readString(record, 'publisher', path, { max: 128 })!,
      `${path}.publisher`,
    ),
    category: safePublicText(
      readString(record, 'category', path, { max: 64 })!,
      `${path}.category`,
    ),
    minimumDesktopVersion: semver(
      readString(record, 'minimumDesktopVersion', path, { max: 64 })!,
      `${path}.minimumDesktopVersion`,
    ),
    ...(maximumDesktopVersion
      ? {
          maximumDesktopVersion: semver(
            maximumDesktopVersion,
            `${path}.maximumDesktopVersion`,
          ),
        }
      : {}),
  });
}

export function parseMarketplaceCatalogMetadata(
  value: unknown,
): MarketplaceCatalogMetadataEnvelope {
  const record = asRecord(value, 'metadata');
  assertKeys(
    record,
    ['catalogVersion', 'generatedAt', 'packages', 'schemaVersion', 'source'],
    [],
    'metadata',
  );
  if (record.schemaVersion !== MARKETPLACE_CATALOG_SCHEMA_VERSION) {
    fail(
      'UNSUPPORTED_VERSION',
      'metadata.schemaVersion',
      `expected ${MARKETPLACE_CATALOG_SCHEMA_VERSION}`,
    );
  }
  if (record.catalogVersion !== MARKETPLACE_CATALOG_VERSION) {
    fail(
      'UNSUPPORTED_VERSION',
      'metadata.catalogVersion',
      `expected ${MARKETPLACE_CATALOG_VERSION}`,
    );
  }
  if (record.source !== 'remote' && record.source !== 'cached') {
    fail('UNTRUSTED_METADATA', 'metadata.source', 'must be remote or cached');
  }
  if (!Array.isArray(record.packages)) {
    fail('INVALID_VALUE', 'metadata.packages', 'must be an array');
  }
  const packages = record.packages.map(parseMetadataPackage);
  const keys = packages.map((item) => marketplacePackageKey(
    item.identity.sourceKind,
    item.identity.packageName,
    item.identity.packageVersion,
  ));
  if (new Set(keys).size !== keys.length) {
    fail('DUPLICATE_PACKAGE', 'metadata.packages', 'contains duplicate package identities');
  }
  return Object.freeze({
    schemaVersion: MARKETPLACE_CATALOG_SCHEMA_VERSION,
    catalogVersion: MARKETPLACE_CATALOG_VERSION,
    generatedAt: exactIso(
      readString(record, 'generatedAt', 'metadata', { max: 64 })!,
      'metadata.generatedAt',
    ),
    source: record.source,
    packages: Object.freeze(packages),
  });
}

function parseSource(value: unknown): MarketplaceCatalogSource {
  const record = asRecord(value, 'catalog.source');
  assertKeys(
    record,
    ['connection', 'kind', 'retrievedAt'],
    ['notice'],
    'catalog.source',
  );
  if (!['remote', 'cached', 'demo'].includes(String(record.kind))) {
    fail('INVALID_VALUE', 'catalog.source.kind', 'is unsupported');
  }
  if (record.connection !== 'online' && record.connection !== 'offline') {
    fail('INVALID_VALUE', 'catalog.source.connection', 'is unsupported');
  }
  const notice = readString(record, 'notice', 'catalog.source', {
    max: 500,
    optional: true,
  });
  return Object.freeze({
    kind: record.kind as MarketplaceCatalogSource['kind'],
    connection: record.connection,
    retrievedAt: exactIso(
      readString(record, 'retrievedAt', 'catalog.source', { max: 64 })!,
      'catalog.source.retrievedAt',
    ),
    ...(notice
      ? { notice: safePublicText(notice, 'catalog.source.notice') }
      : {}),
  });
}

function parseCompatibility(
  value: unknown,
  path: string,
): MarketplacePackageCompatibility {
  const record = asRecord(value, path);
  assertKeys(
    record,
    ['desktopVersion', 'minimumDesktopVersion', 'state'],
    ['maximumDesktopVersion', 'reason'],
    path,
  );
  if (record.state !== 'compatible' && record.state !== 'incompatible') {
    fail('INVALID_VALUE', `${path}.state`, 'is unsupported');
  }
  const maximumDesktopVersion = readString(record, 'maximumDesktopVersion', path, {
    max: 64,
    optional: true,
  });
  const reason = readString(record, 'reason', path, {
    max: 500,
    optional: true,
  });
  if (record.state === 'incompatible' && !reason) {
    fail('INVALID_VALUE', `${path}.reason`, 'is required when incompatible');
  }
  if (record.state === 'compatible' && reason !== undefined) {
    fail('INVALID_VALUE', `${path}.reason`, 'must be absent when compatible');
  }
  return Object.freeze({
    state: record.state,
    desktopVersion: semver(
      readString(record, 'desktopVersion', path, { max: 64 })!,
      `${path}.desktopVersion`,
    ),
    minimumDesktopVersion: semver(
      readString(record, 'minimumDesktopVersion', path, { max: 64 })!,
      `${path}.minimumDesktopVersion`,
    ),
    ...(maximumDesktopVersion
      ? {
          maximumDesktopVersion: semver(
            maximumDesktopVersion,
            `${path}.maximumDesktopVersion`,
          ),
        }
      : {}),
    ...(reason ? { reason: safePublicText(reason, `${path}.reason`) } : {}),
  });
}

function parseInstallation(
  value: unknown,
  path: string,
): MarketplacePackageInstallation {
  const record = asRecord(value, path);
  assertKeys(record, ['state'], ['installedVersion'], path);
  if (record.state !== 'not_installed' && record.state !== 'installed') {
    fail('INVALID_VALUE', `${path}.state`, 'is unsupported');
  }
  const installedVersion = readString(record, 'installedVersion', path, {
    max: 64,
    optional: true,
  });
  if (record.state === 'installed' && !installedVersion) {
    fail('INVALID_VALUE', `${path}.installedVersion`, 'is required when installed');
  }
  if (record.state === 'not_installed' && installedVersion !== undefined) {
    fail('INVALID_VALUE', `${path}.installedVersion`, 'must be absent when not installed');
  }
  return Object.freeze({
    state: record.state,
    ...(installedVersion
      ? { installedVersion: semver(installedVersion, `${path}.installedVersion`) }
      : {}),
  });
}

function parseCapability(
  value: unknown,
  path: string,
): MarketplaceCapabilityReview {
  const record = asRecord(value, path);
  assertKeys(
    record,
    [
      'auditFingerprint',
      'capabilityId',
      'dataClassifications',
      'description',
      'name',
      'permissionRisk',
      'policyFingerprint',
      'policyVersion',
      'requiredPermission',
      'sideEffects',
      'trustZone',
    ],
    [],
    path,
  );
  const requiredPermission = readString(record, 'requiredPermission', path, { max: 128 })!;
  if (!PERMISSION_REGEX.test(requiredPermission) || requiredPermission.includes('*')) {
    fail(
      'PERMISSION_WIDENING',
      `${path}.requiredPermission`,
      'must be an exact non-wildcard permission',
    );
  }
  if (record.trustZone !== 'extension_package') {
    fail(
      'PERMISSION_WIDENING',
      `${path}.trustZone`,
      'must remain extension_package',
    );
  }
  if (!RISKS.includes(record.permissionRisk as CapabilityPermissionRisk)) {
    fail('INVALID_VALUE', `${path}.permissionRisk`, 'is unsupported');
  }
  const policyFingerprint = readString(record, 'policyFingerprint', path, { max: 80 })!;
  const auditFingerprint = readString(record, 'auditFingerprint', path, { max: 80 })!;
  if (!SHA256_REGEX.test(policyFingerprint) || !SHA256_REGEX.test(auditFingerprint)) {
    fail('INVALID_VALUE', path, 'fingerprints must use sha256:<64 lowercase hex>');
  }
  return Object.freeze({
    capabilityId: safePublicText(
      readString(record, 'capabilityId', path, { max: 256 })!,
      `${path}.capabilityId`,
    ),
    name: safePublicText(
      readString(record, 'name', path, { max: 128 })!,
      `${path}.name`,
    ),
    description: safePublicText(
      readString(record, 'description', path, { max: 500 })!,
      `${path}.description`,
    ),
    requiredPermission,
    trustZone: 'extension_package',
    dataClassifications: readStringArray(
      record.dataClassifications,
      `${path}.dataClassifications`,
      CLASSIFICATIONS,
    ) as readonly DataClassification[],
    sideEffects: readStringArray(
      record.sideEffects,
      `${path}.sideEffects`,
      SIDE_EFFECTS,
    ) as readonly CapabilitySideEffect[],
    permissionRisk: record.permissionRisk as CapabilityPermissionRisk,
    policyVersion: semver(
      readString(record, 'policyVersion', path, { max: 64 })!,
      `${path}.policyVersion`,
    ),
    policyFingerprint,
    auditFingerprint,
  });
}

function parsePackage(
  value: unknown,
  index: number,
  sourceKind: MarketplaceCatalogSource['kind'],
  provenance: MarketplaceCatalogProvenance,
): MarketplacePackage {
  const path = `catalog.packages[${index}]`;
  const record = asRecord(value, path);
  assertKeys(
    record,
    [
      'capabilities',
      'category',
      'compatibility',
      'displayName',
      'identity',
      'installation',
      'packageId',
      'publisher',
      'registryDigest',
      'registrySchemaVersion',
      'registryVersion',
      'summary',
      'verification',
    ],
    ['signatureDigest'],
    path,
  );
  if (!Array.isArray(record.capabilities)) {
    fail('INVALID_VALUE', `${path}.capabilities`, 'must be an array');
  }
  const capabilities = record.capabilities.map((item, capabilityIndex) => (
    parseCapability(item, `${path}.capabilities[${capabilityIndex}]`)
  ));
  const capabilityIds = capabilities.map((item) => item.capabilityId);
  if (new Set(capabilityIds).size !== capabilityIds.length) {
    fail('DUPLICATE_CAPABILITY', `${path}.capabilities`, 'contains duplicate ids');
  }
  const registryDigest = readString(record, 'registryDigest', path, { max: 80 })!;
  if (!SHA256_REGEX.test(registryDigest)) {
    fail('INVALID_VALUE', `${path}.registryDigest`, 'must use sha256:<64 lowercase hex>');
  }
  const signatureDigest = readString(record, 'signatureDigest', path, {
    max: 80,
    optional: true,
  });
  if (signatureDigest !== undefined && !SHA256_REGEX.test(signatureDigest)) {
    fail('INVALID_VALUE', `${path}.signatureDigest`, 'must use sha256:<64 lowercase hex>');
  }
  if (sourceKind === 'demo') {
    if (record.verification !== 'demo_unverified' || provenance.boundary !== 'demo') {
      fail(
        'UNTRUSTED_METADATA',
        `${path}.verification`,
        'demo records must remain explicitly unverified',
      );
    }
  } else {
    if (provenance.boundary !== 'host_validated' || record.verification !== 'host_verified') {
      fail(
        'UNTRUSTED_METADATA',
        `${path}.verification`,
        'remote and cached records require a host-validated boundary',
      );
    }
    if (!signatureDigest) {
      fail('UNSIGNED_PACKAGE', `${path}.signatureDigest`, 'is required');
    }
    if (registryDigest !== provenance.expectedRegistryDigest) {
      fail('UNTRUSTED_METADATA', `${path}.registryDigest`, 'does not match trusted audit');
    }
  }
  if (record.registrySchemaVersion !== CAPABILITY_REGISTRY_SCHEMA_VERSION) {
    fail(
      'UNSUPPORTED_VERSION',
      `${path}.registrySchemaVersion`,
      `expected ${CAPABILITY_REGISTRY_SCHEMA_VERSION}`,
    );
  }
  if (record.registryVersion !== CAPABILITY_REGISTRY_VERSION) {
    fail(
      'UNSUPPORTED_VERSION',
      `${path}.registryVersion`,
      `expected ${CAPABILITY_REGISTRY_VERSION}`,
    );
  }
  return Object.freeze({
    identity: parseIdentity(record.identity, `${path}.identity`),
    displayName: safePublicText(
      readString(record, 'displayName', path, { max: 128 })!,
      `${path}.displayName`,
    ),
    summary: safePublicText(
      readString(record, 'summary', path, { max: 500 })!,
      `${path}.summary`,
    ),
    publisher: safePublicText(
      readString(record, 'publisher', path, { max: 128 })!,
      `${path}.publisher`,
    ),
    category: safePublicText(
      readString(record, 'category', path, { max: 64 })!,
      `${path}.category`,
    ),
    ...(signatureDigest ? { signatureDigest } : {}),
    verification: record.verification as MarketplacePackage['verification'],
    registrySchemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
    registryVersion: CAPABILITY_REGISTRY_VERSION,
    registryDigest,
    packageId: safePublicText(
      readString(record, 'packageId', path, { max: 256 })!,
      `${path}.packageId`,
    ),
    compatibility: parseCompatibility(record.compatibility, `${path}.compatibility`),
    installation: parseInstallation(record.installation, `${path}.installation`),
    capabilities: Object.freeze(
      [...capabilities].sort((left, right) => (
        left.capabilityId.localeCompare(right.capabilityId)
      )),
    ),
  });
}

export function parseMarketplaceCatalog(
  value: unknown,
  provenance: MarketplaceCatalogProvenance,
): MarketplaceCatalog {
  const record = asRecord(value, 'catalog');
  assertKeys(
    record,
    ['catalogVersion', 'generatedAt', 'packages', 'schemaVersion', 'source'],
    [],
    'catalog',
  );
  if (record.schemaVersion !== MARKETPLACE_CATALOG_SCHEMA_VERSION) {
    fail(
      'UNSUPPORTED_VERSION',
      'catalog.schemaVersion',
      `expected ${MARKETPLACE_CATALOG_SCHEMA_VERSION}`,
    );
  }
  if (record.catalogVersion !== MARKETPLACE_CATALOG_VERSION) {
    fail(
      'UNSUPPORTED_VERSION',
      'catalog.catalogVersion',
      `expected ${MARKETPLACE_CATALOG_VERSION}`,
    );
  }
  const source = parseSource(record.source);
  if (provenance.boundary === 'demo' && source.kind !== 'demo') {
    fail('UNTRUSTED_METADATA', 'catalog.source.kind', 'must be demo');
  }
  if (provenance.boundary === 'host_validated' && source.kind === 'demo') {
    fail('UNTRUSTED_METADATA', 'catalog.source.kind', 'must be remote or cached');
  }
  if (!Array.isArray(record.packages)) {
    fail('INVALID_VALUE', 'catalog.packages', 'must be an array');
  }
  const packages = record.packages.map((item, index) => (
    parsePackage(item, index, source.kind, provenance)
  ));
  const keys = packages.map((item) => item.identity.packageKey);
  if (new Set(keys).size !== keys.length) {
    fail('DUPLICATE_PACKAGE', 'catalog.packages', 'contains duplicate identities');
  }
  return Object.freeze({
    schemaVersion: MARKETPLACE_CATALOG_SCHEMA_VERSION,
    catalogVersion: MARKETPLACE_CATALOG_VERSION,
    generatedAt: exactIso(
      readString(record, 'generatedAt', 'catalog', { max: 64 })!,
      'catalog.generatedAt',
    ),
    source,
    packages: Object.freeze(
      [...packages].sort((left, right) => (
        left.identity.packageKey.localeCompare(right.identity.packageKey)
      )),
    ),
  });
}

export function parseMarketplaceInstallScope(
  value: unknown,
  path = 'scope',
): MarketplaceInstallScope {
  const record = asRecord(value, path);
  assertKeys(record, ['tenantId', 'userId', 'workspaceInstanceId'], [], path);
  const scope = {
    tenantId: readString(record, 'tenantId', path, { max: 256 })!,
    userId: readString(record, 'userId', path, { max: 256 })!,
    workspaceInstanceId: readString(record, 'workspaceInstanceId', path, { max: 256 })!,
  };
  for (const [key, field] of Object.entries(scope)) {
    if (!SAFE_ID_REGEX.test(field) || field.includes('*')) {
      fail('AMBIGUOUS_SCOPE', `${path}.${key}`, 'must be an exact non-wildcard id');
    }
    if (looksLikeRawSecret(field)) {
      fail('RAW_SECRET', `${path}.${key}`, 'must not contain a credential');
    }
  }
  return Object.freeze(scope);
}

function parsePlanCapability(
  value: unknown,
  path: string,
): MarketplaceInstallPlanCapability {
  const record = asRecord(value, path);
  assertKeys(
    record,
    [
      'capabilityId',
      'dataClassifications',
      'permissionRisk',
      'requiredPermission',
      'sideEffects',
      'trustZone',
    ],
    [],
    path,
  );
  const requiredPermission = readString(record, 'requiredPermission', path, { max: 128 })!;
  if (!PERMISSION_REGEX.test(requiredPermission) || requiredPermission.includes('*')) {
    fail('PERMISSION_WIDENING', `${path}.requiredPermission`, 'must be exact');
  }
  if (record.trustZone !== 'extension_package') {
    fail('PERMISSION_WIDENING', `${path}.trustZone`, 'must remain extension_package');
  }
  if (!RISKS.includes(record.permissionRisk as CapabilityPermissionRisk)) {
    fail('INVALID_VALUE', `${path}.permissionRisk`, 'is unsupported');
  }
  return Object.freeze({
    capabilityId: readString(record, 'capabilityId', path, { max: 256 })!,
    requiredPermission,
    trustZone: 'extension_package',
    dataClassifications: readStringArray(
      record.dataClassifications,
      `${path}.dataClassifications`,
      CLASSIFICATIONS,
    ) as readonly DataClassification[],
    sideEffects: readStringArray(
      record.sideEffects,
      `${path}.sideEffects`,
      SIDE_EFFECTS,
    ) as readonly CapabilitySideEffect[],
    permissionRisk: record.permissionRisk as CapabilityPermissionRisk,
  });
}

function assertDerivedStringArray(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
): void {
  if (
    actual.length !== expected.length
    || actual.some((value, index) => value !== expected[index])
  ) {
    fail('INVALID_INSTALL_PLAN', path, 'must match the reviewed capabilities');
  }
}

export function parseMarketplaceInstallPlan(value: unknown): MarketplaceInstallPlan {
  const record = asRecord(value, 'plan');
  assertKeys(
    record,
    [
      'capabilities',
      'dataClassifications',
      'effect',
      'packageId',
      'packageIdentity',
      'planId',
      'plannedAt',
      'planVersion',
      'registryDigest',
      'registryVersion',
      'requestedPermissions',
      'requiresApproval',
      'schemaVersion',
      'scope',
      'sideEffects',
    ],
    [],
    'plan',
  );
  if (record.schemaVersion !== MARKETPLACE_INSTALL_PLAN_SCHEMA_VERSION) {
    fail(
      'UNSUPPORTED_VERSION',
      'plan.schemaVersion',
      `expected ${MARKETPLACE_INSTALL_PLAN_SCHEMA_VERSION}`,
    );
  }
  if (record.planVersion !== MARKETPLACE_INSTALL_PLAN_VERSION) {
    fail(
      'UNSUPPORTED_VERSION',
      'plan.planVersion',
      `expected ${MARKETPLACE_INSTALL_PLAN_VERSION}`,
    );
  }
  if (record.effect !== 'plan_only') {
    fail('INVALID_INSTALL_PLAN', 'plan.effect', 'must remain plan_only');
  }
  if (typeof record.requiresApproval !== 'boolean') {
    fail('INVALID_VALUE', 'plan.requiresApproval', 'must be boolean');
  }
  if (!Array.isArray(record.capabilities)) {
    fail('INVALID_VALUE', 'plan.capabilities', 'must be an array');
  }
  const capabilities = record.capabilities.map((item, index) => (
    parsePlanCapability(item, `plan.capabilities[${index}]`)
  ));
  if (capabilities.length === 0) {
    fail('INVALID_INSTALL_PLAN', 'plan.capabilities', 'must contain a reviewed capability');
  }
  const capabilityIds = capabilities.map((item) => item.capabilityId);
  if (new Set(capabilityIds).size !== capabilityIds.length) {
    fail('DUPLICATE_CAPABILITY', 'plan.capabilities', 'contains duplicate ids');
  }
  const registryDigest = readString(record, 'registryDigest', 'plan', { max: 80 })!;
  if (!SHA256_REGEX.test(registryDigest)) {
    fail('INVALID_VALUE', 'plan.registryDigest', 'must use sha256:<64 lowercase hex>');
  }
  const registryVersion = semver(
    readString(record, 'registryVersion', 'plan', { max: 64 })!,
    'plan.registryVersion',
  );
  if (registryVersion !== CAPABILITY_REGISTRY_VERSION) {
    fail(
      'UNSUPPORTED_VERSION',
      'plan.registryVersion',
      `expected ${CAPABILITY_REGISTRY_VERSION}`,
    );
  }
  const packageIdentity = parseIdentity(record.packageIdentity, 'plan.packageIdentity');
  const packageId = readString(record, 'packageId', 'plan', { max: 256 })!;
  if (packageId !== `skill-package:${packageIdentity.packageKey}`) {
    fail(
      'INVALID_INSTALL_PLAN',
      'plan.packageId',
      'must match the reviewed package identity',
    );
  }
  const scope = parseMarketplaceInstallScope(record.scope, 'plan.scope');
  const requestedPermissions = readStringArray(
    record.requestedPermissions,
    'plan.requestedPermissions',
  );
  for (const permission of requestedPermissions) {
    if (!PERMISSION_REGEX.test(permission) || permission.includes('*')) {
      fail('PERMISSION_WIDENING', 'plan.requestedPermissions', 'must contain exact permissions');
    }
  }
  const dataClassifications = readStringArray(
    record.dataClassifications,
    'plan.dataClassifications',
    CLASSIFICATIONS,
  ) as readonly DataClassification[];
  const sideEffects = readStringArray(
    record.sideEffects,
    'plan.sideEffects',
    SIDE_EFFECTS,
  ) as readonly CapabilitySideEffect[];
  const expectedPermissions = Object.freeze([
    ...new Set(capabilities.map((capability) => capability.requiredPermission)),
  ].sort());
  const expectedClassifications = Object.freeze([
    ...new Set(capabilities.flatMap((capability) => capability.dataClassifications)),
  ].sort());
  const expectedSideEffects = Object.freeze([
    ...new Set(capabilities.flatMap((capability) => capability.sideEffects)),
  ].sort());
  assertDerivedStringArray(
    requestedPermissions,
    expectedPermissions,
    'plan.requestedPermissions',
  );
  assertDerivedStringArray(
    dataClassifications,
    expectedClassifications,
    'plan.dataClassifications',
  );
  assertDerivedStringArray(sideEffects, expectedSideEffects, 'plan.sideEffects');
  const expectedRequiresApproval = sideEffects.some((effect) => (
    APPROVAL_SIDE_EFFECTS.has(effect)
  ));
  if (record.requiresApproval !== expectedRequiresApproval) {
    fail(
      'INVALID_INSTALL_PLAN',
      'plan.requiresApproval',
      'must match the reviewed side effects',
    );
  }
  const planId = readString(record, 'planId', 'plan', { max: 1024 })!;
  const expectedPlanId = marketplaceInstallPlanId(
    packageIdentity.packageKey,
    scope,
    registryDigest,
  );
  if (planId !== expectedPlanId) {
    fail('INVALID_INSTALL_PLAN', 'plan.planId', 'must match package, scope, and registry');
  }
  return Object.freeze({
    schemaVersion: MARKETPLACE_INSTALL_PLAN_SCHEMA_VERSION,
    planVersion: MARKETPLACE_INSTALL_PLAN_VERSION,
    planId,
    plannedAt: exactIso(
      readString(record, 'plannedAt', 'plan', { max: 64 })!,
      'plan.plannedAt',
    ),
    packageIdentity,
    packageId,
    registryVersion,
    registryDigest,
    scope,
    requestedPermissions,
    dataClassifications,
    sideEffects,
    capabilities: Object.freeze(
      [...capabilities].sort((left, right) => (
        left.capabilityId.localeCompare(right.capabilityId)
      )),
    ),
    requiresApproval: record.requiresApproval,
    effect: 'plan_only',
  });
}

function semverParts(value: string): readonly [number, number, number, readonly string[]] {
  semver(value, 'version');
  const [core, prerelease = ''] = value.split('-', 2);
  const [major, minor, patch] = core.split('.').map(Number);
  return [major, minor, patch, prerelease ? prerelease.split('.') : []];
}

export function compareMarketplaceSemver(left: string, right: string): number {
  const leftParts = semverParts(left);
  const rightParts = semverParts(right);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return Number(leftParts[index]) - Number(rightParts[index]);
    }
  }
  const leftPre = leftParts[3];
  const rightPre = rightParts[3];
  if (leftPre.length === 0 && rightPre.length > 0) return 1;
  if (rightPre.length === 0 && leftPre.length > 0) return -1;
  const length = Math.max(leftPre.length, rightPre.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftPre[index];
    const rightPart = rightPre[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
}

export function evaluateMarketplaceCompatibility(
  desktopVersion: string,
  minimumDesktopVersion: string,
  maximumDesktopVersion?: string,
): MarketplacePackageCompatibility {
  semver(desktopVersion, 'desktopVersion');
  semver(minimumDesktopVersion, 'minimumDesktopVersion');
  if (maximumDesktopVersion) semver(maximumDesktopVersion, 'maximumDesktopVersion');
  if (compareMarketplaceSemver(desktopVersion, minimumDesktopVersion) < 0) {
    return Object.freeze({
      state: 'incompatible',
      desktopVersion,
      minimumDesktopVersion,
      ...(maximumDesktopVersion ? { maximumDesktopVersion } : {}),
      reason: `Requires desktop ${minimumDesktopVersion} or newer.`,
    });
  }
  if (
    maximumDesktopVersion
    && compareMarketplaceSemver(desktopVersion, maximumDesktopVersion) > 0
  ) {
    return Object.freeze({
      state: 'incompatible',
      desktopVersion,
      minimumDesktopVersion,
      maximumDesktopVersion,
      reason: `Supports desktop versions through ${maximumDesktopVersion}.`,
    });
  }
  return Object.freeze({
    state: 'compatible',
    desktopVersion,
    minimumDesktopVersion,
    ...(maximumDesktopVersion ? { maximumDesktopVersion } : {}),
  });
}
