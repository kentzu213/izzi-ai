import {
  MARKETING_WORKSPACE_BRIDGE_SCHEMA_VERSION,
  type MarketingWorkspaceHostEvidence,
  type MarketingWorkspaceProvisionRequest,
} from './types';

const DIGEST = /^sha256:[a-f0-9]{64}$/;
const PACKAGE_KEY = /^ocx_extension:[a-z0-9][a-z0-9._-]*@[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;
const ROLES = new Set(['owner', 'manager', 'editor', 'reviewer', 'viewer']);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function text(value: unknown, max = 256): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const hasControlCharacter = Array.from(trimmed).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
  return trimmed && trimmed.length <= max && !hasControlCharacter
    ? trimmed
    : null;
}

export function parseMarketingWorkspaceHostEvidence(
  value: unknown,
): MarketingWorkspaceHostEvidence | null {
  const input = record(value);
  if (!input || !exactKeys(input, [
    'evidenceDigest',
    'installedPackage',
    'issuedAt',
    'role',
    'schemaVersion',
    'scope',
  ])) return null;
  if (input.schemaVersion !== MARKETING_WORKSPACE_BRIDGE_SCHEMA_VERSION) return null;
  const evidenceDigest = text(input.evidenceDigest, 80);
  const issuedAt = text(input.issuedAt, 40);
  const role = text(input.role, 16);
  const scope = record(input.scope);
  const installedPackage = record(input.installedPackage);
  if (
    !evidenceDigest
    || !DIGEST.test(evidenceDigest)
    || !issuedAt
    || Number.isNaN(Date.parse(issuedAt))
    || !role
    || !ROLES.has(role)
    || !scope
    || !exactKeys(scope, ['tenantId', 'userId', 'workspaceInstanceId'])
    || !installedPackage
    || !exactKeys(installedPackage, ['extensionId', 'packageKey', 'state', 'version'])
  ) return null;
  const tenantId = text(scope.tenantId);
  const userId = text(scope.userId);
  const workspaceInstanceId = text(scope.workspaceInstanceId);
  const extensionId = text(installedPackage.extensionId);
  const packageKey = text(installedPackage.packageKey);
  const version = text(installedPackage.version, 64);
  const state = text(installedPackage.state, 32);
  if (
    !tenantId
    || !userId
    || !workspaceInstanceId
    || !extensionId
    || !packageKey
    || !PACKAGE_KEY.test(packageKey)
    || !version
    || !state
  ) return null;
  return Object.freeze({
    schemaVersion: MARKETING_WORKSPACE_BRIDGE_SCHEMA_VERSION,
    evidenceDigest,
    issuedAt,
    role: role as MarketingWorkspaceHostEvidence['role'],
    scope: Object.freeze({ tenantId, userId, workspaceInstanceId }),
    installedPackage: Object.freeze({ extensionId, packageKey, version, state }),
  });
}

export function parseMarketingWorkspaceProvisionRequest(
  value: unknown,
): MarketingWorkspaceProvisionRequest | null {
  const input = record(value);
  if (!input || !exactKeys(input, ['evidence'])) return null;
  const evidence = parseMarketingWorkspaceHostEvidence(input.evidence);
  return evidence ? Object.freeze({ evidence }) : null;
}
