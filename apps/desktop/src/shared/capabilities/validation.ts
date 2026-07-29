/**
 * Strict validation for capability envelopes and trusted policies.
 *
 * Unknown fields are rejected rather than ignored. That makes version drift and
 * attempted authority injection visible instead of silently accepted.
 */

import {
  CAPABILITY_ADAPTER_VERSION,
  CAPABILITY_REGISTRY_SCHEMA_VERSION,
  type CapabilityDeclarationKind,
  type CapabilityManifestDeclaration,
  type CapabilityManifestEnvelope,
  type CapabilityManifestPackage,
  type CapabilityManifestSource,
  type CapabilityManifestSourceKind,
  type CapabilityPermissionRisk,
  type CapabilityPolicy,
  type CapabilityPolicyStatus,
  type CapabilitySideEffect,
  type UnsupportedCapabilityDeclaration,
} from './types';
import {
  looksLikeRawSecret,
  type DataClassification,
} from '../personal-office';

export type CapabilityValidationCode =
  | 'INVALID_ENVELOPE'
  | 'UNSUPPORTED_VERSION'
  | 'UNKNOWN_FIELD'
  | 'INVALID_VALUE'
  | 'DUPLICATE_DECLARATION'
  | 'RAW_SECRET'
  | 'OVER_PRIVILEGED_POLICY';

export interface CapabilityValidationIssue {
  readonly code: CapabilityValidationCode;
  readonly path: string;
  readonly message: string;
}

export class CapabilityValidationError extends Error {
  constructor(readonly issues: readonly CapabilityValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
    this.name = 'CapabilityValidationError';
  }
}

const SOURCE_KINDS: readonly CapabilityManifestSourceKind[] = [
  'agent_bundle',
  'ocx_extension',
];
const DECLARATION_KINDS: readonly CapabilityDeclarationKind[] = [
  'permission',
  'runtime',
  'tool',
];
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
const RISKS: readonly CapabilityPermissionRisk[] = ['high', 'low', 'medium'];
const POLICY_STATUSES: readonly CapabilityPolicyStatus[] = ['allowed', 'blocked'];

const NAME_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const DECLARATION_KEY_REGEX = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const PERMISSION_REGEX = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SIGNATURE_DIGEST_REGEX = /^sha256:[a-f0-9]{64}$/;

function issue(
  code: CapabilityValidationCode,
  path: string,
  message: string,
): CapabilityValidationError {
  return new CapabilityValidationError([{ code, path, message }]);
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw issue('INVALID_VALUE', path, 'must be an object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw issue('INVALID_VALUE', path, 'must be a plain object');
  }
  return value as Record<string, unknown>;
}

function assertKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(record).filter((key) => !allowedSet.has(key)).sort();
  if (unknown.length > 0) {
    throw issue('UNKNOWN_FIELD', path, `unknown fields: ${unknown.join(', ')}`);
  }
}

function readString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  options: { min?: number; max?: number; optional?: boolean } = {},
): string | undefined {
  const value = record[key];
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== 'string') {
    throw issue('INVALID_VALUE', `${path}.${key}`, 'must be a string');
  }
  const min = options.min ?? 1;
  const max = options.max ?? 500;
  if (value.length < min || value.length > max) {
    throw issue(
      'INVALID_VALUE',
      `${path}.${key}`,
      `must be ${min}-${max} characters`,
    );
  }
  if (/[\r\n\0]/.test(value)) {
    throw issue('INVALID_VALUE', `${path}.${key}`, 'must be a single safe line');
  }
  return value;
}

function assertNoRawSecret(value: string, path: string): void {
  if (looksLikeRawSecret(value)) {
    throw issue('RAW_SECRET', path, 'credential-shaped values are forbidden');
  }
}

function parseSource(value: unknown): CapabilityManifestSource {
  const record = asRecord(value, 'source');
  assertKeys(
    record,
    ['adapterVersion', 'kind', 'manifestName', 'manifestVersion', 'observedAt'],
    'source',
  );

  const kind = readString(record, 'kind', 'source') as CapabilityManifestSourceKind;
  if (!SOURCE_KINDS.includes(kind)) {
    throw issue('INVALID_VALUE', 'source.kind', `unsupported source kind: ${kind}`);
  }

  const manifestName = readString(record, 'manifestName', 'source', { max: 64 })!;
  if (!NAME_REGEX.test(manifestName)) {
    throw issue('INVALID_VALUE', 'source.manifestName', 'must be kebab-case');
  }

  const manifestVersion = readString(record, 'manifestVersion', 'source', { max: 64 })!;
  if (!SEMVER_REGEX.test(manifestVersion)) {
    throw issue('INVALID_VALUE', 'source.manifestVersion', 'must be semver');
  }

  const observedAt = readString(record, 'observedAt', 'source', { max: 64 })!;
  const parsedObservedAt = new Date(observedAt);
  if (
    Number.isNaN(parsedObservedAt.getTime())
    || parsedObservedAt.toISOString() !== observedAt
  ) {
    throw issue(
      'INVALID_VALUE',
      'source.observedAt',
      'must be an exact ISO-8601 UTC timestamp',
    );
  }

  const adapterVersion = readString(record, 'adapterVersion', 'source', { max: 32 });
  if (adapterVersion !== CAPABILITY_ADAPTER_VERSION) {
    throw issue(
      'UNSUPPORTED_VERSION',
      'source.adapterVersion',
      `expected ${CAPABILITY_ADAPTER_VERSION}`,
    );
  }

  return Object.freeze({
    kind,
    manifestName,
    manifestVersion,
    observedAt,
    adapterVersion,
  });
}

function parsePackage(value: unknown): CapabilityManifestPackage {
  const record = asRecord(value, 'package');
  assertKeys(record, ['description', 'displayName', 'signatureDigest'], 'package');
  const displayName = readString(record, 'displayName', 'package', { max: 128 })!;
  const description = readString(record, 'description', 'package', { max: 500 })!;
  assertNoRawSecret(displayName, 'package.displayName');
  assertNoRawSecret(description, 'package.description');

  const signatureDigest = readString(record, 'signatureDigest', 'package', {
    max: 80,
    optional: true,
  });
  if (signatureDigest !== undefined && !SIGNATURE_DIGEST_REGEX.test(signatureDigest)) {
    throw issue(
      'INVALID_VALUE',
      'package.signatureDigest',
      'must be sha256:<64 lowercase hex characters>',
    );
  }

  return Object.freeze({
    displayName,
    description,
    ...(signatureDigest ? { signatureDigest } : {}),
  });
}

function parseDeclaration(
  value: unknown,
  index: number,
): CapabilityManifestDeclaration {
  const path = `declarations[${index}]`;
  const record = asRecord(value, path);
  assertKeys(record, ['key', 'kind', 'manifestPath'], path);
  const kind = readString(record, 'kind', path) as CapabilityDeclarationKind;
  if (!DECLARATION_KINDS.includes(kind)) {
    throw issue('INVALID_VALUE', `${path}.kind`, `unsupported kind: ${kind}`);
  }
  const key = readString(record, 'key', path, { max: 128 })!;
  if (!DECLARATION_KEY_REGEX.test(key)) {
    throw issue(
      'INVALID_VALUE',
      `${path}.key`,
      'must use lowercase capability-token characters',
    );
  }
  if (key.includes('*')) {
    throw issue(
      'OVER_PRIVILEGED_POLICY',
      `${path}.key`,
      'wildcard declarations are forbidden',
    );
  }
  const manifestPath = readString(record, 'manifestPath', path, { max: 256 })!;
  return Object.freeze({ kind, key, manifestPath });
}

function parseUnsupported(
  value: unknown,
  index: number,
): UnsupportedCapabilityDeclaration {
  const path = `unsupportedDeclarations[${index}]`;
  const record = asRecord(value, path);
  assertKeys(record, ['manifestPath', 'reason'], path);
  return Object.freeze({
    manifestPath: readString(record, 'manifestPath', path, { max: 256 })!,
    reason: readString(record, 'reason', path, { max: 500 })!,
  });
}

function declarationSortKey(declaration: CapabilityManifestDeclaration): string {
  return `${declaration.kind}\0${declaration.key}\0${declaration.manifestPath}`;
}

/** Parse, normalize and freeze an untrusted capability manifest envelope. */
export function parseCapabilityManifestEnvelope(
  value: unknown,
): CapabilityManifestEnvelope {
  const record = asRecord(value, 'envelope');
  assertKeys(
    record,
    [
      'declarations',
      'package',
      'schemaVersion',
      'source',
      'unsupportedDeclarations',
    ],
    'envelope',
  );

  if (record.schemaVersion !== CAPABILITY_REGISTRY_SCHEMA_VERSION) {
    throw issue(
      'UNSUPPORTED_VERSION',
      'schemaVersion',
      `expected ${CAPABILITY_REGISTRY_SCHEMA_VERSION}`,
    );
  }

  if (!Array.isArray(record.declarations)) {
    throw issue('INVALID_VALUE', 'declarations', 'must be an array');
  }
  if (!Array.isArray(record.unsupportedDeclarations)) {
    throw issue('INVALID_VALUE', 'unsupportedDeclarations', 'must be an array');
  }

  const declarations = record.declarations
    .map(parseDeclaration)
    .sort((left, right) => declarationSortKey(left).localeCompare(declarationSortKey(right)));
  const seen = new Set<string>();
  for (const declaration of declarations) {
    const key = `${declaration.kind}:${declaration.key}`;
    if (seen.has(key)) {
      throw issue(
        'DUPLICATE_DECLARATION',
        'declarations',
        `duplicate declaration: ${key}`,
      );
    }
    seen.add(key);
  }

  const unsupportedDeclarations = record.unsupportedDeclarations
    .map(parseUnsupported)
    .sort((left, right) => (
      `${left.manifestPath}\0${left.reason}`
        .localeCompare(`${right.manifestPath}\0${right.reason}`)
    ));

  return Object.freeze({
    schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
    source: parseSource(record.source),
    package: parsePackage(record.package),
    declarations: Object.freeze(declarations),
    unsupportedDeclarations: Object.freeze(unsupportedDeclarations),
  });
}

function assertUniqueStrings(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw issue('INVALID_VALUE', path, 'must not contain duplicates');
  }
}

/** Validate a trusted policy before it is admitted to the host catalog. */
export function validateCapabilityPolicy(policy: CapabilityPolicy): void {
  if (policy.schemaVersion !== CAPABILITY_REGISTRY_SCHEMA_VERSION) {
    throw issue(
      'UNSUPPORTED_VERSION',
      'policy.schemaVersion',
      `expected ${CAPABILITY_REGISTRY_SCHEMA_VERSION}`,
    );
  }
  if (!SEMVER_REGEX.test(policy.policyVersion)) {
    throw issue('INVALID_VALUE', 'policy.policyVersion', 'must be semver');
  }
  if (!SOURCE_KINDS.includes(policy.sourceKind)) {
    throw issue('INVALID_VALUE', 'policy.sourceKind', 'is unsupported');
  }
  if (!DECLARATION_KINDS.includes(policy.declarationKind)) {
    throw issue('INVALID_VALUE', 'policy.declarationKind', 'is unsupported');
  }
  if (!DECLARATION_KEY_REGEX.test(policy.declarationKey)) {
    throw issue('INVALID_VALUE', 'policy.declarationKey', 'is invalid');
  }
  if (
    !PERMISSION_REGEX.test(policy.requiredPermission)
    || policy.requiredPermission.includes('*')
  ) {
    throw issue(
      'OVER_PRIVILEGED_POLICY',
      'policy.requiredPermission',
      'must be an exact non-wildcard permission',
    );
  }
  if (policy.trustZone !== 'extension_package') {
    throw issue(
      'OVER_PRIVILEGED_POLICY',
      'policy.trustZone',
      'package capabilities must remain in extension_package',
    );
  }
  if (
    policy.dataClassifications.length === 0
    || policy.dataClassifications.some((value) => !CLASSIFICATIONS.includes(value))
  ) {
    throw issue(
      'INVALID_VALUE',
      'policy.dataClassifications',
      'must contain known classifications',
    );
  }
  assertUniqueStrings(policy.dataClassifications, 'policy.dataClassifications');
  if (policy.sideEffects.some((value) => !SIDE_EFFECTS.includes(value))) {
    throw issue('INVALID_VALUE', 'policy.sideEffects', 'contains an unknown side effect');
  }
  assertUniqueStrings(policy.sideEffects, 'policy.sideEffects');
  if (!RISKS.includes(policy.permissionRisk)) {
    throw issue('INVALID_VALUE', 'policy.permissionRisk', 'is unsupported');
  }
  if (!POLICY_STATUSES.includes(policy.status)) {
    throw issue('INVALID_VALUE', 'policy.status', 'is unsupported');
  }
  if (policy.status === 'blocked' && !policy.blockedReason?.trim()) {
    throw issue(
      'INVALID_VALUE',
      'policy.blockedReason',
      'is required for blocked policies',
    );
  }
  if (policy.status === 'allowed' && policy.blockedReason !== undefined) {
    throw issue(
      'INVALID_VALUE',
      'policy.blockedReason',
      'must be absent for allowed policies',
    );
  }
  if (!policy.description.trim() || policy.description.length > 500) {
    throw issue('INVALID_VALUE', 'policy.description', 'must be 1-500 characters');
  }
}

export function capabilityPolicyKey(
  sourceKind: CapabilityManifestSourceKind,
  declarationKind: CapabilityDeclarationKind,
  declarationKey: string,
): string {
  return `${sourceKind}:${declarationKind}:${declarationKey}`;
}
