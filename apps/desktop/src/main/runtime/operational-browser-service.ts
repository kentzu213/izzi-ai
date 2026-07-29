import { createHash } from 'node:crypto';
import {
  canonicalJson,
  looksLikeRawSecret,
} from '../../shared/personal-office';
import {
  validateRuntimeSpec,
  type BrowserRuntimeSpec,
  type RuntimeEffectReceipt,
} from '../../shared/runtime';
import type {
  BrowserRuntimeCoordinator,
  PreparedBrowserAction,
} from './browser-runtime';
import {
  authorizeOperationalBrowserRuntime,
  validateOperationalPackageBinding,
  type OperationalPackageBinding,
  type OperationalRuntimeAuthorization,
} from './operational-runtime-gate';

export type OperationalBrowserServiceErrorCode =
  | 'EVIDENCE_UNAVAILABLE'
  | 'AUTHORIZATION_DENIED'
  | 'AUTHORIZATION_DRIFT';

export class OperationalBrowserServiceError extends Error {
  constructor(readonly code: OperationalBrowserServiceErrorCode) {
    super(code);
    this.name = 'OperationalBrowserServiceError';
  }
}

export interface OperationalRuntimeEvidenceQuery {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly packageKey: string;
  readonly packageId: string;
  readonly integration: string;
  readonly grantId: string;
  readonly runId: string;
  readonly runtimeId: string;
  readonly runtimeDigest: string;
  readonly requiredScopes: readonly string[];
}

export interface OperationalRuntimeEvidenceSnapshot {
  readonly marketplaceReceipt: unknown;
  readonly grantReceipt: unknown;
}

/**
 * Must resolve receipts from main-process authoritative stores. Renderer,
 * package and agent input may identify the requested operation but must never
 * supply either receipt or decide that a package/grant is trusted.
 */
export interface OperationalRuntimeEvidencePort {
  resolve(
    query: OperationalRuntimeEvidenceQuery,
  ): Promise<OperationalRuntimeEvidenceSnapshot | null>;
}

export interface OperationalBrowserCoordinatorPort {
  prepare(
    input: Parameters<BrowserRuntimeCoordinator['prepare']>[0],
  ): Promise<PreparedBrowserAction>;
  execute(
    prepared: PreparedBrowserAction,
    signal?: AbortSignal,
  ): Promise<RuntimeEffectReceipt>;
}

export interface OperationalPreparedBrowserAction {
  readonly schemaVersion: 1;
  readonly authorization: OperationalRuntimeAuthorization;
  readonly packageBinding: OperationalPackageBinding;
  readonly preparedAction: PreparedBrowserAction;
}

interface ResolvedAuthorization {
  readonly authorization: OperationalRuntimeAuthorization;
  readonly packageBinding: OperationalPackageBinding;
}

const DIGEST = /^sha256:[a-f0-9]{64}$/;

export function createOperationalRuntimeEvidenceQuery(
  runtime: BrowserRuntimeSpec,
  packageBinding: OperationalPackageBinding,
): OperationalRuntimeEvidenceQuery {
  const values = [
    runtime.authority.tenantId,
    runtime.authority.userId,
    runtime.authority.workspaceId,
    packageBinding.packageKey,
    packageBinding.packageId,
    packageBinding.integration,
    runtime.authority.grantId,
    runtime.authority.runId ?? '',
    runtime.id,
    ...packageBinding.requiredScopes,
  ];
  if (
    !runtime.authority.runId
    || runtime.authority.packageId !== packageBinding.packageId
    || runtime.authority.integrationId !== packageBinding.integration
    || values.some((value) => looksLikeRawSecret(value))
  ) {
    throw new OperationalBrowserServiceError('AUTHORIZATION_DENIED');
  }
  return Object.freeze({
    tenantId: runtime.authority.tenantId,
    userId: runtime.authority.userId,
    workspaceId: runtime.authority.workspaceId,
    packageKey: packageBinding.packageKey,
    packageId: packageBinding.packageId,
    integration: packageBinding.integration,
    grantId: runtime.authority.grantId,
    runId: runtime.authority.runId,
    runtimeId: runtime.id,
    runtimeDigest: `sha256:${createHash('sha256')
      .update(canonicalJson(runtime))
      .digest('hex')}`,
    requiredScopes: packageBinding.requiredScopes,
  });
}

export class OperationalBrowserService {
  constructor(
    private readonly coordinator: OperationalBrowserCoordinatorPort,
    private readonly evidence: OperationalRuntimeEvidencePort,
  ) {}

  async prepare(
    input: Parameters<BrowserRuntimeCoordinator['prepare']>[0] & {
      readonly packageBinding: OperationalPackageBinding;
    },
  ): Promise<OperationalPreparedBrowserAction> {
    const { packageBinding, ...prepareInput } = input;
    const resolved = await this.resolveAuthorization(
      input.runtime,
      packageBinding,
    );
    const preparedAction = await this.coordinator.prepare(prepareInput);
    if (
      preparedAction.runId !== resolved.authorization.runId
      || preparedAction.runtime.id !== resolved.authorization.runtimeId
    ) {
      throw new OperationalBrowserServiceError('AUTHORIZATION_DRIFT');
    }
    return Object.freeze({
      schemaVersion: 1,
      authorization: resolved.authorization,
      packageBinding: resolved.packageBinding,
      preparedAction,
    });
  }

  async execute(
    prepared: OperationalPreparedBrowserAction,
    signal?: AbortSignal,
  ): Promise<RuntimeEffectReceipt> {
    if (
      prepared.schemaVersion !== 1
      || prepared.authorization.kind !== 'operational_runtime_authorization'
      || !DIGEST.test(prepared.authorization.authorizationDigest)
    ) {
      throw new OperationalBrowserServiceError('AUTHORIZATION_DENIED');
    }
    const current = await this.resolveAuthorization(
      prepared.preparedAction.runtime,
      prepared.packageBinding,
    );
    if (
      canonicalJson(current.authorization)
      !== canonicalJson(prepared.authorization)
    ) {
      throw new OperationalBrowserServiceError('AUTHORIZATION_DRIFT');
    }
    return this.coordinator.execute(prepared.preparedAction, signal);
  }

  private async resolveAuthorization(
    inputRuntime: BrowserRuntimeSpec,
    inputBinding: OperationalPackageBinding,
  ): Promise<ResolvedAuthorization> {
    let runtime: BrowserRuntimeSpec;
    let packageBinding: OperationalPackageBinding;
    let query: OperationalRuntimeEvidenceQuery;
    try {
      const validated = validateRuntimeSpec(inputRuntime);
      if (validated.kind !== 'browser') {
        throw new Error('browser runtime required');
      }
      runtime = validated;
      packageBinding = validateOperationalPackageBinding(inputBinding);
      query = createOperationalRuntimeEvidenceQuery(runtime, packageBinding);
    } catch {
      throw new OperationalBrowserServiceError('AUTHORIZATION_DENIED');
    }
    let evidence: OperationalRuntimeEvidenceSnapshot | null;
    try {
      evidence = await this.evidence.resolve(query);
    } catch {
      evidence = null;
    }
    if (!evidence) {
      throw new OperationalBrowserServiceError('EVIDENCE_UNAVAILABLE');
    }
    try {
      return Object.freeze({
        authorization: authorizeOperationalBrowserRuntime({
          marketplaceReceipt: evidence.marketplaceReceipt,
          grantReceipt: evidence.grantReceipt,
          packageBinding,
          runtime,
        }),
        packageBinding,
      });
    } catch {
      throw new OperationalBrowserServiceError('AUTHORIZATION_DENIED');
    }
  }

}
