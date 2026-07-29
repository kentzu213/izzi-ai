import { createHash } from 'node:crypto';
import {
  parseMarketplaceInstallOperationReceipt,
  type MarketplaceInstallOperationReceipt,
} from '../../shared/marketplace';
import {
  canonicalJson,
  looksLikeRawSecret,
} from '../../shared/personal-office';
import {
  validateRuntimeSpec,
  type BrowserRuntimeSpec,
} from '../../shared/runtime';
import type { IntegrationGrantOperationReceipt } from '../integrations/grant-operation';

export interface OperationalPackageBinding {
  readonly packageKey: string;
  readonly packageId: string;
  readonly integration: string;
  readonly requiredScopes: readonly string[];
}

export interface OperationalRuntimeAuthorization {
  readonly schemaVersion: 1;
  readonly kind: 'operational_runtime_authorization';
  readonly authorizationDigest: string;
  readonly marketplaceOperationId: string;
  readonly grantOperationId: string;
  readonly workspaceId: string;
  readonly packageKey: string;
  readonly packageId: string;
  readonly runtimeId: string;
  readonly runId: string;
}

function exact(value: string, path: string): string {
  if (
    !value
    || value !== value.trim()
    || value.length > 512
    || /[\0\r\n*]/.test(value)
    || looksLikeRawSecret(value)
  ) {
    throw new Error(`${path}: exact non-credential value required`);
  }
  return value;
}

function scopes(values: readonly string[], path: string): readonly string[] {
  const normalized = [...new Set(values.map((value) => exact(value, `${path}[]`)))].sort();
  if (normalized.length === 0) throw new Error(`${path}: at least one scope required`);
  return Object.freeze(normalized);
}

function parseConnectedGrant(value: unknown): IntegrationGrantOperationReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('grantReceipt: plain object required');
  }
  const receipt = value as Partial<IntegrationGrantOperationReceipt>;
  if (
    receipt.status !== 'connected'
    || receipt.code !== 'CONNECTED'
    || typeof receipt.operationId !== 'string'
    || !/^sha256:[a-f0-9]{64}$/.test(receipt.operationId)
    || typeof receipt.observedAt !== 'string'
    || new Date(receipt.observedAt).toISOString() !== receipt.observedAt
    || typeof receipt.integration !== 'string'
    || typeof receipt.grantId !== 'string'
    || typeof receipt.workspaceInstanceId !== 'string'
    || !Array.isArray(receipt.scopes)
  ) {
    throw new Error('grantReceipt: exact connected receipt required');
  }
  return Object.freeze({
    operationId: receipt.operationId,
    status: receipt.status,
    code: receipt.code,
    observedAt: receipt.observedAt,
    integration: exact(receipt.integration, 'grantReceipt.integration'),
    grantId: receipt.grantId,
    workspaceInstanceId: receipt.workspaceInstanceId,
    scopes: scopes(receipt.scopes, 'grantReceipt.scopes'),
    ...(typeof receipt.approvalId === 'string'
      ? { approvalId: exact(receipt.approvalId, 'grantReceipt.approvalId') }
      : {}),
    ...(typeof receipt.evidenceDigest === 'string'
      && /^sha256:[a-f0-9]{64}$/.test(receipt.evidenceDigest)
      ? { evidenceDigest: receipt.evidenceDigest }
      : {}),
  });
}

function assertCompletedInstall(
  receipt: MarketplaceInstallOperationReceipt,
  binding: OperationalPackageBinding,
): void {
  if (
    receipt.status !== 'completed'
    || receipt.packageKey !== binding.packageKey
    || receipt.installedPackageKey !== binding.packageKey
    || receipt.provisionedWorkspaceInstanceId !== receipt.scope.workspaceInstanceId
  ) {
    throw new Error('Marketplace receipt does not prove exact installation');
  }
}

export function authorizeOperationalBrowserRuntime(input: {
  readonly marketplaceReceipt: unknown;
  readonly grantReceipt: unknown;
  readonly packageBinding: OperationalPackageBinding;
  readonly runtime: BrowserRuntimeSpec;
}): OperationalRuntimeAuthorization {
  const marketplace = parseMarketplaceInstallOperationReceipt(input.marketplaceReceipt);
  const grant = parseConnectedGrant(input.grantReceipt);
  const binding = Object.freeze({
    packageKey: exact(input.packageBinding.packageKey, 'packageBinding.packageKey'),
    packageId: exact(input.packageBinding.packageId, 'packageBinding.packageId'),
    integration: exact(input.packageBinding.integration, 'packageBinding.integration'),
    requiredScopes: scopes(input.packageBinding.requiredScopes, 'packageBinding.requiredScopes'),
  });
  const runtime = validateRuntimeSpec(input.runtime);
  if (runtime.kind !== 'browser') throw new Error('Only browser runtime is supported');
  assertCompletedInstall(marketplace, binding);
  if (
    runtime.authority.tenantId !== marketplace.scope.tenantId
    || runtime.authority.userId !== marketplace.scope.userId
    || runtime.authority.workspaceId !== marketplace.scope.workspaceInstanceId
    || runtime.authority.packageId !== binding.packageId
    || runtime.authority.integrationId !== binding.integration
    || runtime.authority.grantId !== grant.grantId
    || grant.workspaceInstanceId !== marketplace.scope.workspaceInstanceId
    || grant.integration !== binding.integration
    || !runtime.authority.runId
  ) {
    throw new Error('Operational runtime authority does not match installed evidence');
  }
  const grantedScopes = new Set(grant.scopes);
  if (binding.requiredScopes.some((required) => !grantedScopes.has(required))) {
    throw new Error('Connected grant does not cover required runtime scopes');
  }
  const evidence = {
    marketplaceOperationId: marketplace.operationId,
    grantOperationId: grant.operationId,
    workspaceId: marketplace.scope.workspaceInstanceId,
    packageKey: binding.packageKey,
    packageId: binding.packageId,
    runtimeId: runtime.id,
    runId: runtime.authority.runId,
  };
  return Object.freeze({
    schemaVersion: 1,
    kind: 'operational_runtime_authorization',
    authorizationDigest: `sha256:${createHash('sha256')
      .update(canonicalJson(evidence))
      .digest('hex')}`,
    ...evidence,
  });
}
