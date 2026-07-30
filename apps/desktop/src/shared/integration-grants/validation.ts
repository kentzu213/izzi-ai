import {
  PERSONAL_OFFICE_SCHEMA_VERSION,
  asId,
  isSecretRef,
  looksLikeRawSecret,
  type IntegrationGrant,
  type IntegrationGrantId,
  type SecretRef,
  type WorkspaceInstanceId,
} from '../personal-office';
import {
  INTEGRATION_GRANT_READ_MODEL_SCHEMA_VERSION,
  INTEGRATION_GRANT_READ_MODEL_VERSION,
  type IntegrationGrantReadModel,
  type IntegrationGrantReasonCode,
  type IntegrationGrantScope,
  type IntegrationGrantState,
  type IntegrationGrantVaultResolution,
  type LegacyIntegrationGrantEvidence,
  type LegacyIntegrationGrantStatus,
} from './types';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const CREDENTIAL_SHAPE =
  /(?:sk|pk|ghp|gho|xox[bap])[-_][A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.|(?:AKIA|ASIA)[A-Z0-9]{16}/i;
const SECRET_STORES = ['os_keychain', 'encrypted_file', 'env', 'integration_vault'] as const;
const STATES: readonly IntegrationGrantState[] = [
  'active',
  'disconnected',
  'pending',
  'error',
  'locked',
  'invalid',
];
const REASONS: readonly IntegrationGrantReasonCode[] = [
  'active',
  'disconnected_absent',
  'disconnected_revoked',
  'grant_expired',
  'grant_invalid',
  'grant_missing',
  'legacy_status_inconsistent',
  'legacy_error_redacted',
  'pending_activation',
  'vault_locked',
  'vault_secret_missing',
];
const VAULT_RESOLUTIONS: readonly IntegrationGrantVaultResolution[] = [
  'resolvable',
  'missing',
  'unavailable',
];
const LEGACY_STATUSES: readonly LegacyIntegrationGrantStatus[] = [
  'connected',
  'disconnected',
  'pending',
  'error',
  'locked',
  'invalid',
];

export type IntegrationGrantValidationCode =
  | 'INVALID_VALUE'
  | 'RAW_SECRET'
  | 'SCOPE_MISMATCH'
  | 'UNKNOWN_FIELD'
  | 'UNSUPPORTED_VERSION';

export class IntegrationGrantValidationError extends Error {
  constructor(
    readonly code: IntegrationGrantValidationCode,
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'IntegrationGrantValidationError';
  }
}

function fail(
  code: IntegrationGrantValidationCode,
  path: string,
  message: string,
): never {
  throw new IntegrationGrantValidationError(code, path, message);
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

function safeText(value: unknown, path: string, max = 256): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > max
    || value !== value.trim()
    || value !== value.normalize('NFC')
    || /[\0\r\n]/.test(value)
  ) {
    fail('INVALID_VALUE', path, 'must be exact normalized text');
  }
  if (
    value.includes('*')
    || !SAFE_ID.test(value)
    || looksLikeRawSecret(value)
    || CREDENTIAL_SHAPE.test(value)
  ) {
    fail(
      looksLikeRawSecret(value) || CREDENTIAL_SHAPE.test(value) ? 'RAW_SECRET' : 'INVALID_VALUE',
      path,
      'must be a non-wildcard, non-credential identifier',
    );
  }
  return value;
}

function exactIso(value: unknown, path: string): string {
  if (typeof value !== 'string') fail('INVALID_VALUE', path, 'must be an ISO timestamp');
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    fail('INVALID_VALUE', path, 'must be an exact ISO-8601 UTC timestamp');
  }
  return value;
}

function optionalIso(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : exactIso(value, path);
}

function exactScopes(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail('INVALID_VALUE', path, 'must contain at least one least-privilege scope');
  }
  const scopes = value.map((scope, index) => safeText(scope, `${path}[${index}]`, 128));
  const sorted = [...scopes].sort();
  if (
    new Set(scopes).size !== scopes.length
    || scopes.some((scope, index) => scope !== sorted[index])
  ) {
    fail('INVALID_VALUE', path, 'must be sorted and unique');
  }
  return Object.freeze(scopes);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function assertExactIntegrationGrantScope(
  actual: IntegrationGrantScope,
  expected: IntegrationGrantScope,
  path = 'scope',
): void {
  if (
    actual.tenantId !== expected.tenantId
    || actual.userId !== expected.userId
    || actual.workspaceInstanceId !== expected.workspaceInstanceId
    || actual.grantId !== expected.grantId
    || actual.integration !== expected.integration
    || !sameStrings(actual.scopes, expected.scopes)
  ) {
    fail('SCOPE_MISMATCH', path, 'does not match the trusted tenant/user/workspace grant scope');
  }
}

function parseSecretRef(value: unknown, path: string, scopes: readonly string[]): SecretRef {
  const secret = record(value, path);
  exactKeys(secret, ['kind', 'ref', 'store'], ['scopes'], path);
  if (
    !isSecretRef(secret)
    || !SECRET_STORES.includes(secret.store as typeof SECRET_STORES[number])
    || secret.store !== 'integration_vault'
  ) {
    fail('INVALID_VALUE', path, 'must be a supported SecretRef');
  }
  const ref = safeText(secret.ref, `${path}.ref`);
  const secretScopes = secret.scopes === undefined
    ? scopes
    : exactScopes(secret.scopes, `${path}.scopes`);
  if (!sameStrings(secretScopes, scopes)) {
    fail('SCOPE_MISMATCH', `${path}.scopes`, 'must equal the grant scopes');
  }
  return Object.freeze({
    kind: 'secret-ref',
    store: secret.store,
    ref,
    scopes: secretScopes,
  });
}

export function parseIntegrationGrantScope(
  value: unknown,
  path = 'scope',
): IntegrationGrantScope {
  const scope = record(value, path);
  exactKeys(
    scope,
    ['tenantId', 'userId', 'workspaceInstanceId', 'grantId', 'integration', 'scopes'],
    [],
    path,
  );
  return Object.freeze({
    tenantId: safeText(scope.tenantId, `${path}.tenantId`),
    userId: safeText(scope.userId, `${path}.userId`),
    workspaceInstanceId: asId<'WorkspaceInstanceId'>(
      safeText(scope.workspaceInstanceId, `${path}.workspaceInstanceId`),
    ) as WorkspaceInstanceId,
    grantId: asId<'IntegrationGrantId'>(
      safeText(scope.grantId, `${path}.grantId`),
    ) as IntegrationGrantId,
    integration: safeText(scope.integration, `${path}.integration`, 128),
    scopes: exactScopes(scope.scopes, `${path}.scopes`),
  });
}

export function parseIntegrationGrant(
  value: unknown,
  expectedScope?: IntegrationGrantScope,
  path = 'grant',
): IntegrationGrant {
  const grant = record(value, path);
  exactKeys(
    grant,
    [
      'schemaVersion',
      'id',
      'workspaceInstanceId',
      'integration',
      'scopes',
      'secret',
      'createdAt',
      'updatedAt',
    ],
    ['expiresAt', 'revokedAt', 'lastErrorAt', 'invalid'],
    path,
  );
  if (grant.schemaVersion !== PERSONAL_OFFICE_SCHEMA_VERSION) {
    fail('UNSUPPORTED_VERSION', `${path}.schemaVersion`, 'is not current');
  }
  const scopes = exactScopes(grant.scopes, `${path}.scopes`);
  const parsed: IntegrationGrant = Object.freeze({
    schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
    id: asId<'IntegrationGrantId'>(safeText(grant.id, `${path}.id`)) as IntegrationGrantId,
    workspaceInstanceId: asId<'WorkspaceInstanceId'>(
      safeText(grant.workspaceInstanceId, `${path}.workspaceInstanceId`),
    ) as WorkspaceInstanceId,
    integration: safeText(grant.integration, `${path}.integration`, 128),
    scopes,
    secret: parseSecretRef(grant.secret, `${path}.secret`, scopes),
    createdAt: exactIso(grant.createdAt, `${path}.createdAt`),
    updatedAt: exactIso(grant.updatedAt, `${path}.updatedAt`),
    ...(grant.expiresAt === undefined
      ? {}
      : { expiresAt: exactIso(grant.expiresAt, `${path}.expiresAt`) }),
    ...(grant.revokedAt === undefined
      ? {}
      : { revokedAt: exactIso(grant.revokedAt, `${path}.revokedAt`) }),
    ...(grant.lastErrorAt === undefined
      ? {}
      : { lastErrorAt: exactIso(grant.lastErrorAt, `${path}.lastErrorAt`) }),
    ...(grant.invalid === undefined ? {} : { invalid: grant.invalid === true }),
  });
  if (grant.invalid !== undefined && grant.invalid !== true && grant.invalid !== false) {
    fail('INVALID_VALUE', `${path}.invalid`, 'must be boolean');
  }
  if (
    expectedScope
    && (
      parsed.id !== expectedScope.grantId
      || parsed.workspaceInstanceId !== expectedScope.workspaceInstanceId
      || parsed.integration !== expectedScope.integration
      || !sameStrings(parsed.scopes, expectedScope.scopes)
    )
  ) {
    fail('SCOPE_MISMATCH', path, 'does not match the exact requested scope');
  }
  return parsed;
}

export function parseIntegrationGrantReadModel(
  value: unknown,
  expectedScope: IntegrationGrantScope,
): IntegrationGrantReadModel {
  const model = record(value, 'readModel');
  exactKeys(
    model,
    [
      'schemaVersion',
      'modelVersion',
      'observedAt',
      'state',
      'reasonCode',
      'vaultResolution',
      'scope',
    ],
    ['grant', 'requestedAt', 'lastErrorAt'],
    'readModel',
  );
  if (model.schemaVersion !== INTEGRATION_GRANT_READ_MODEL_SCHEMA_VERSION) {
    fail('UNSUPPORTED_VERSION', 'readModel.schemaVersion', 'is not current');
  }
  if (model.modelVersion !== INTEGRATION_GRANT_READ_MODEL_VERSION) {
    fail('UNSUPPORTED_VERSION', 'readModel.modelVersion', 'is not current');
  }
  if (!STATES.includes(model.state as IntegrationGrantState)) {
    fail('INVALID_VALUE', 'readModel.state', 'is unsupported');
  }
  if (!REASONS.includes(model.reasonCode as IntegrationGrantReasonCode)) {
    fail('INVALID_VALUE', 'readModel.reasonCode', 'is unsupported');
  }
  if (!VAULT_RESOLUTIONS.includes(model.vaultResolution as IntegrationGrantVaultResolution)) {
    fail('INVALID_VALUE', 'readModel.vaultResolution', 'is unsupported');
  }
  const scope = parseIntegrationGrantScope(model.scope);
  assertExactIntegrationGrantScope(scope, parseIntegrationGrantScope(expectedScope), 'readModel.scope');
  const grant = model.grant === undefined
    ? undefined
    : parseIntegrationGrant(model.grant, scope);
  const parsed: IntegrationGrantReadModel = Object.freeze({
    schemaVersion: INTEGRATION_GRANT_READ_MODEL_SCHEMA_VERSION,
    modelVersion: INTEGRATION_GRANT_READ_MODEL_VERSION,
    observedAt: exactIso(model.observedAt, 'readModel.observedAt'),
    state: model.state as IntegrationGrantState,
    reasonCode: model.reasonCode as IntegrationGrantReasonCode,
    vaultResolution: model.vaultResolution as IntegrationGrantVaultResolution,
    scope,
    ...(grant ? { grant } : {}),
    ...(model.requestedAt === undefined
      ? {}
      : { requestedAt: exactIso(model.requestedAt, 'readModel.requestedAt') }),
    ...(model.lastErrorAt === undefined
      ? {}
      : { lastErrorAt: exactIso(model.lastErrorAt, 'readModel.lastErrorAt') }),
  });
  if (
    parsed.state === 'active'
    && (
      !parsed.grant
      || parsed.reasonCode !== 'active'
      || parsed.vaultResolution !== 'resolvable'
      || parsed.grant.invalid
      || parsed.grant.revokedAt
      || isGrantExpired(parsed.grant, parsed.observedAt)
    )
  ) {
    fail('INVALID_VALUE', 'readModel.state', 'active requires a live resolvable grant');
  }
  if (parsed.state === 'error' && (!parsed.grant || !parsed.lastErrorAt)) {
    fail('INVALID_VALUE', 'readModel.state', 'error requires a grant and redacted timestamp');
  }
  if (
    parsed.state === 'error'
    && (
      parsed.grant?.invalid
      || parsed.grant?.revokedAt
      || Boolean(parsed.grant && isGrantExpired(parsed.grant, parsed.observedAt))
    )
  ) {
    fail('INVALID_VALUE', 'readModel.state', 'error requires a live grant');
  }
  if (parsed.state === 'locked' && parsed.vaultResolution !== 'unavailable') {
    fail('INVALID_VALUE', 'readModel.state', 'locked requires unavailable vault evidence');
  }
  if (
    parsed.state === 'disconnected'
    && !(
      (
        parsed.reasonCode === 'disconnected_absent'
        && !parsed.grant
        && parsed.vaultResolution === 'missing'
      )
      || (
        parsed.reasonCode === 'disconnected_revoked'
        && Boolean(parsed.grant?.revokedAt)
        && parsed.vaultResolution === 'missing'
      )
    )
  ) {
    fail('INVALID_VALUE', 'readModel.state', 'disconnected requires absent or revoked evidence');
  }
  if (
    parsed.state === 'pending'
    && (parsed.reasonCode !== 'pending_activation' || !parsed.requestedAt)
  ) {
    fail('INVALID_VALUE', 'readModel.state', 'pending requires request evidence');
  }
  if (
    parsed.state === 'invalid'
    && !(
      (parsed.reasonCode === 'grant_missing' && !parsed.grant)
      || (parsed.reasonCode === 'grant_invalid' && parsed.grant?.invalid === true)
      || (
        parsed.reasonCode === 'grant_expired'
        && Boolean(parsed.grant && isGrantExpired(parsed.grant, parsed.observedAt))
      )
      || (
        parsed.reasonCode === 'vault_secret_missing'
        && Boolean(parsed.grant)
        && parsed.vaultResolution === 'missing'
      )
      || (
        parsed.reasonCode === 'legacy_status_inconsistent'
        && Boolean(parsed.grant)
        && !parsed.grant?.revokedAt
      )
    )
  ) {
    fail('INVALID_VALUE', 'readModel.state', 'invalid reason does not match its evidence');
  }
  if (parsed.state === 'error' && parsed.reasonCode !== 'legacy_error_redacted') {
    fail('INVALID_VALUE', 'readModel.state', 'error reason is not redacted legacy evidence');
  }
  if (parsed.state !== 'error' && parsed.lastErrorAt !== undefined) {
    fail('INVALID_VALUE', 'readModel.lastErrorAt', 'is allowed only for error state');
  }
  if (parsed.state !== 'pending' && parsed.requestedAt !== undefined) {
    fail('INVALID_VALUE', 'readModel.requestedAt', 'is allowed only for pending state');
  }
  return parsed;
}

export function parseLegacyIntegrationGrantEvidence(
  value: unknown,
  expectedScope: IntegrationGrantScope,
): LegacyIntegrationGrantEvidence {
  const evidence = record(value, 'evidence');
  exactKeys(
    evidence,
    ['status', 'observedAt', 'scope', 'vaultState', 'secretResolvable'],
    ['grant', 'requestedAt', 'lastErrorAt'],
    'evidence',
  );
  if (!LEGACY_STATUSES.includes(evidence.status as LegacyIntegrationGrantStatus)) {
    fail('INVALID_VALUE', 'evidence.status', 'is unsupported');
  }
  if (evidence.vaultState !== 'ready' && evidence.vaultState !== 'locked') {
    fail('INVALID_VALUE', 'evidence.vaultState', 'is unsupported');
  }
  if (typeof evidence.secretResolvable !== 'boolean') {
    fail('INVALID_VALUE', 'evidence.secretResolvable', 'must be boolean');
  }
  const scope = parseIntegrationGrantScope(evidence.scope);
  assertExactIntegrationGrantScope(scope, parseIntegrationGrantScope(expectedScope), 'evidence.scope');
  return Object.freeze({
    status: evidence.status as LegacyIntegrationGrantStatus,
    observedAt: exactIso(evidence.observedAt, 'evidence.observedAt'),
    scope,
    ...(evidence.grant === undefined
      ? {}
      : { grant: parseIntegrationGrant(evidence.grant, scope) }),
    ...(evidence.requestedAt === undefined
      ? {}
      : { requestedAt: exactIso(evidence.requestedAt, 'evidence.requestedAt') }),
    ...(evidence.lastErrorAt === undefined
      ? {}
      : { lastErrorAt: exactIso(evidence.lastErrorAt, 'evidence.lastErrorAt') }),
    vaultState: evidence.vaultState,
    secretResolvable: evidence.secretResolvable,
  });
}

export function isGrantExpired(grant: IntegrationGrant, observedAt: string): boolean {
  return grant.expiresAt !== undefined && grant.expiresAt <= exactIso(observedAt, 'observedAt');
}

export function assertExactGrantScope(
  grant: IntegrationGrant,
  scope: IntegrationGrantScope,
): void {
  parseIntegrationGrant(grant, scope);
}

export function parseOptionalTimestamp(value: unknown, path: string): string | undefined {
  return optionalIso(value, path);
}
