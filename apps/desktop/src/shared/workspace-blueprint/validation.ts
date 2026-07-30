import {
  asId,
  looksLikeRawSecret,
  type DataClassification,
  type TrustZone,
  type WorkspaceBlueprintId,
  type WorkspaceInstanceId,
} from '../personal-office';
import {
  WORKSPACE_BLUEPRINT_DESCRIPTOR_VERSION,
  WORKSPACE_BLUEPRINT_SCHEMA_VERSION,
  WorkspaceBlueprintValidationError,
  type WorkspaceBlueprintAppDescriptor,
  type WorkspaceBlueprintAppSideEffect,
  type WorkspaceBlueprintDescriptor,
  type WorkspaceBlueprintIntegrationGrantRequirement,
  type WorkspaceBlueprintProvenance,
  type WorkspaceBlueprintValidationCode,
  type WorkspaceProvisioningScope,
  type WorkspaceProvisioningScopeInput,
} from './types';

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const CLASSIFICATIONS: readonly DataClassification[] = [
  'artifacts',
  'audit_events',
  'local_files',
  'personal_graph',
  'public_metadata',
  'secrets',
];
const TRUST_ZONES: readonly TrustZone[] = [
  'browser_runtime',
  'desktop_execution_plane',
  'extension_package',
  'izziapi_control_plane',
  'local_runtime',
  'model_provider',
];
const APP_SIDE_EFFECTS: readonly WorkspaceBlueprintAppSideEffect[] = [
  'external_action',
  'local_read',
  'local_write',
  'network_egress',
  'process_execution',
  'secret_access',
  'ui_mutation',
];
const EMBEDDED_SECRET =
  /(?:sk|pk|ghp|gho|xox[bap])[-_][A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.|(?:AKIA|ASIA)[A-Z0-9]{16}/i;

function fail(
  code: WorkspaceBlueprintValidationCode,
  path: string,
  message: string,
): never {
  throw new WorkspaceBlueprintValidationError([{ code, path, message }]);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail('INVALID_VALUE', path, 'must be a plain object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail('INVALID_VALUE', path, 'must be a plain object');
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail('INVALID_VALUE', `${path}.${key}`, 'is required');
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('UNKNOWN_FIELD', `${path}.${key}`, 'is not supported');
  }
}

function text(
  value: unknown,
  path: string,
  max: number,
  options: { readonly id?: boolean; readonly optional?: boolean } = {},
): string | undefined {
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== 'string') fail('INVALID_VALUE', path, 'must be a string');
  if (
    value.length === 0
    || value.length > max
    || value !== value.trim()
    || value !== value.normalize('NFC')
    || /[\0\r\n]/.test(value)
  ) {
    fail('INVALID_VALUE', path, 'must use exact normalized safe text');
  }
  if (looksLikeRawSecret(value) || EMBEDDED_SECRET.test(value)) {
    fail('RAW_SECRET', path, 'credential-shaped material is forbidden');
  }
  if (options.id && (!SAFE_ID.test(value) || value.includes('*'))) {
    fail('INVALID_VALUE', path, 'must be an exact non-wildcard identifier');
  }
  return value;
}

function semver(value: unknown, path: string): string {
  const result = text(value, path, 64)!;
  if (!SEMVER.test(result)) fail('INVALID_VALUE', path, 'must be semantic version text');
  return result;
}

function stringArray<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): readonly T[] {
  if (!Array.isArray(value)) fail('INVALID_VALUE', path, 'must be an array');
  const parsed = value.map((item, index) => {
    if (typeof item !== 'string' || !allowed.includes(item as T)) {
      fail('INVALID_VALUE', `${path}[${index}]`, 'contains an unsupported value');
    }
    return item as T;
  });
  if (new Set(parsed).size !== parsed.length) {
    fail('INVALID_VALUE', path, 'must not contain duplicates');
  }
  return Object.freeze([...parsed].sort());
}

function parseApp(value: unknown, index: number): WorkspaceBlueprintAppDescriptor {
  const path = `blueprint.apps[${index}]`;
  const item = record(value, path);
  exactKeys(
    item,
    [
      'appId',
      'dataClassifications',
      'displayName',
      'expectedSideEffects',
      'packageId',
      'packageVersion',
      'trustZone',
    ],
    [],
    path,
  );
  const trustZone = text(item.trustZone, `${path}.trustZone`, 64)! as TrustZone;
  if (!TRUST_ZONES.includes(trustZone)) {
    fail('INVALID_VALUE', `${path}.trustZone`, 'is unsupported');
  }
  const packageVersion = semver(item.packageVersion, `${path}.packageVersion`);
  const packageId = text(item.packageId, `${path}.packageId`, 256, { id: true })!;
  if (!packageId.endsWith(`@${packageVersion}`)) {
    fail('INVALID_BLUEPRINT', `${path}.packageId`, 'must bind the exact package version');
  }
  return Object.freeze({
    appId: text(item.appId, `${path}.appId`, 256, { id: true })!,
    packageId,
    packageVersion,
    displayName: text(item.displayName, `${path}.displayName`, 128)!,
    trustZone,
    dataClassifications: stringArray(
      item.dataClassifications,
      `${path}.dataClassifications`,
      CLASSIFICATIONS,
    ),
    expectedSideEffects: stringArray(
      item.expectedSideEffects,
      `${path}.expectedSideEffects`,
      APP_SIDE_EFFECTS,
    ),
  });
}

function parseGrant(
  value: unknown,
  index: number,
): WorkspaceBlueprintIntegrationGrantRequirement {
  const path = `blueprint.requiredIntegrationGrants[${index}]`;
  const item = record(value, path);
  exactKeys(item, ['grantRef', 'integration'], [], path);
  return Object.freeze({
    integration: text(item.integration, `${path}.integration`, 128, { id: true })!,
    grantRef: text(item.grantRef, `${path}.grantRef`, 256, { id: true })!,
  });
}

export function parseWorkspaceProvisioningScope(
  value: WorkspaceProvisioningScopeInput | unknown,
  path = 'scope',
): WorkspaceProvisioningScope {
  const scope = record(value, path);
  exactKeys(scope, ['tenantId', 'userId', 'workspaceInstanceId'], [], path);
  return Object.freeze({
    tenantId: text(scope.tenantId, `${path}.tenantId`, 256, { id: true })!,
    userId: text(scope.userId, `${path}.userId`, 256, { id: true })!,
    workspaceInstanceId: asId<'WorkspaceInstanceId'>(
      text(scope.workspaceInstanceId, `${path}.workspaceInstanceId`, 256, { id: true })!,
    ) as WorkspaceInstanceId,
  });
}

export function exactIso(value: unknown, path: string): string {
  const result = text(value, path, 64)!;
  const parsed = new Date(result);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== result) {
    fail('INVALID_VALUE', path, 'must be an exact ISO-8601 UTC timestamp');
  }
  return result;
}

export function parseWorkspaceBlueprintDescriptor(
  value: unknown,
  provenance: WorkspaceBlueprintProvenance,
): WorkspaceBlueprintDescriptor {
  const blueprint = record(value, 'blueprint');
  exactKeys(
    blueprint,
    [
      'apps',
      'availability',
      'blueprintVersion',
      'description',
      'descriptorVersion',
      'id',
      'name',
      'requiredIntegrationGrants',
      'schemaVersion',
    ],
    ['evidenceDigest'],
    'blueprint',
  );
  if (blueprint.schemaVersion !== WORKSPACE_BLUEPRINT_SCHEMA_VERSION) {
    fail('UNSUPPORTED_VERSION', 'blueprint.schemaVersion', `expected ${WORKSPACE_BLUEPRINT_SCHEMA_VERSION}`);
  }
  if (blueprint.descriptorVersion !== WORKSPACE_BLUEPRINT_DESCRIPTOR_VERSION) {
    fail('UNSUPPORTED_VERSION', 'blueprint.descriptorVersion', `expected ${WORKSPACE_BLUEPRINT_DESCRIPTOR_VERSION}`);
  }
  const availability = text(blueprint.availability, 'blueprint.availability', 32)!;
  const evidenceDigest = text(
    blueprint.evidenceDigest,
    'blueprint.evidenceDigest',
    80,
    { optional: true },
  );
  if (provenance.boundary === 'host_validated') {
    if (availability !== 'host_verified') {
      fail('UNTRUSTED_METADATA', 'blueprint.availability', 'host validation requires host_verified');
    }
    if (
      !evidenceDigest
      || !SHA256.test(evidenceDigest)
      || evidenceDigest !== provenance.expectedEvidenceDigest
    ) {
      fail('UNTRUSTED_METADATA', 'blueprint.evidenceDigest', 'must match trusted host evidence');
    }
  } else {
    if (availability === 'host_verified') {
      fail('UNTRUSTED_METADATA', 'blueprint.availability', `${provenance.boundary} metadata cannot claim host_verified`);
    }
    if (availability !== provenance.boundary || evidenceDigest !== undefined) {
      fail('UNTRUSTED_METADATA', 'blueprint.availability', 'must match explicit untrusted provenance without evidence');
    }
  }
  if (!Array.isArray(blueprint.apps) || blueprint.apps.length === 0) {
    fail('INVALID_BLUEPRINT', 'blueprint.apps', 'must contain at least one app');
  }
  if (!Array.isArray(blueprint.requiredIntegrationGrants)) {
    fail('INVALID_BLUEPRINT', 'blueprint.requiredIntegrationGrants', 'must be an array');
  }
  const apps = blueprint.apps.map(parseApp).sort((left, right) => left.appId.localeCompare(right.appId));
  const grants = blueprint.requiredIntegrationGrants
    .map(parseGrant)
    .sort((left, right) => left.grantRef.localeCompare(right.grantRef));
  if (new Set(apps.map((app) => app.appId)).size !== apps.length) {
    fail('INVALID_BLUEPRINT', 'blueprint.apps', 'contains duplicate app ids');
  }
  if (new Set(apps.map((app) => app.packageId)).size !== apps.length) {
    fail('INVALID_BLUEPRINT', 'blueprint.apps', 'contains duplicate package ids');
  }
  if (new Set(grants.map((grant) => grant.grantRef)).size !== grants.length) {
    fail('INVALID_BLUEPRINT', 'blueprint.requiredIntegrationGrants', 'contains duplicate grant refs');
  }
  return Object.freeze({
    schemaVersion: WORKSPACE_BLUEPRINT_SCHEMA_VERSION,
    descriptorVersion: WORKSPACE_BLUEPRINT_DESCRIPTOR_VERSION,
    id: asId<'WorkspaceBlueprintId'>(
      text(blueprint.id, 'blueprint.id', 256, { id: true })!,
    ) as WorkspaceBlueprintId,
    blueprintVersion: semver(blueprint.blueprintVersion, 'blueprint.blueprintVersion'),
    name: text(blueprint.name, 'blueprint.name', 128)!,
    description: text(blueprint.description, 'blueprint.description', 500)!,
    availability: availability as WorkspaceBlueprintDescriptor['availability'],
    ...(evidenceDigest ? { evidenceDigest } : {}),
    apps: Object.freeze(apps),
    requiredIntegrationGrants: Object.freeze(grants),
  });
}

export function assertExactDerived(
  actual: readonly string[],
  expected: readonly string[],
  path: string,
): void {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    fail('INVALID_PLAN', path, 'does not match the reviewed blueprint');
  }
}

export function parseExactStringArray(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) fail('INVALID_VALUE', path, 'must be an array');
  const parsed = value.map((item, index) => text(
    item,
    `${path}[${index}]`,
    256,
    { id: true },
  )!);
  if (new Set(parsed).size !== parsed.length) fail('INVALID_VALUE', path, 'must not contain duplicates');
  return Object.freeze([...parsed].sort());
}

export function parseClassificationArray(
  value: unknown,
  path: string,
): readonly DataClassification[] {
  return stringArray(value, path, CLASSIFICATIONS);
}

export function parseTrustZoneArray(value: unknown, path: string): readonly TrustZone[] {
  return stringArray(value, path, TRUST_ZONES);
}

export function parsePlanRecord(value: unknown): Record<string, unknown> {
  const plan = record(value, 'plan');
  exactKeys(
    plan,
    [
      'blueprint',
      'dataClassifications',
      'effect',
      'expectedSideEffects',
      'planId',
      'plannedAt',
      'planVersion',
      'requestedApps',
      'requestedPackages',
      'requiredIntegrationGrantRefs',
      'requiresApproval',
      'schemaVersion',
      'scope',
      'trustZones',
    ],
    [],
    'plan',
  );
  return plan;
}

export function parsePlanText(value: unknown, path: string, max = 512): string {
  return text(value, path, max)!;
}
