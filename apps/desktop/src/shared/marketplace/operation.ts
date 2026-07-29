import {
  MarketplaceValidationError,
  type MarketplaceInstallPlan,
  type MarketplaceInstallScope,
} from './types';
import { parseMarketplaceInstallScope } from './validation';

export const MARKETPLACE_OPERATION_SCHEMA_VERSION = 1 as const;
export const MARKETPLACE_OPERATION_VERSION = '1.0.0' as const;

export type MarketplaceInstallOperationStatus =
  | 'awaiting_approval'
  | 'blocked'
  | 'completed'
  | 'failed';

export type MarketplaceInstallOperationStage =
  | 'plan_revalidation'
  | 'package_verification'
  | 'work_approval'
  | 'grant_resolution'
  | 'workspace_provisioning'
  | 'package_installation';

export type MarketplaceInstallStageOutcome =
  | 'passed'
  | 'pending'
  | 'skipped'
  | 'blocked'
  | 'failed';

export interface MarketplaceInstallStageReceipt {
  readonly stage: MarketplaceInstallOperationStage;
  readonly outcome: MarketplaceInstallStageOutcome;
  readonly code: string;
  readonly evidenceDigest?: string;
  readonly referenceId?: string;
}

export interface MarketplaceInstallOperationReceipt {
  readonly schemaVersion: typeof MARKETPLACE_OPERATION_SCHEMA_VERSION;
  readonly operationVersion: typeof MARKETPLACE_OPERATION_VERSION;
  readonly operationId: string;
  readonly planId: string;
  readonly packageKey: string;
  readonly scope: MarketplaceInstallScope;
  readonly status: MarketplaceInstallOperationStatus;
  readonly stages: readonly MarketplaceInstallStageReceipt[];
  readonly approvalId?: string;
  readonly provisionedWorkspaceInstanceId?: string;
  readonly installedPackageKey?: string;
  readonly startedAt: string;
  readonly updatedAt: string;
}

export interface MarketplacePackageVerificationEvidence {
  readonly packageKey: string;
  readonly packageDigest: string;
  readonly publisherSignatureDigest: string;
  readonly signatureVerified: true;
}

export interface MarketplaceInstallOperationRequest {
  readonly plan: MarketplaceInstallPlan;
}

export interface MarketplaceInstallOperationResumeRequest {
  readonly plan: MarketplaceInstallPlan;
  readonly approvalId: string;
}

export type MarketplaceOperationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

export interface MarketplacePreloadApi {
  loadCatalog: () => Promise<MarketplaceOperationResult<import('./types').MarketplaceCatalog>>;
  createPlan: (
    packageKey: string,
  ) => Promise<MarketplaceOperationResult<MarketplaceInstallPlan>>;
  requestInstall: (
    input: MarketplaceInstallOperationRequest,
  ) => Promise<MarketplaceOperationResult<MarketplaceInstallOperationReceipt>>;
  resumeInstall: (
    input: MarketplaceInstallOperationResumeRequest,
  ) => Promise<MarketplaceOperationResult<MarketplaceInstallOperationReceipt>>;
}

const OPERATION_STATUSES: readonly MarketplaceInstallOperationStatus[] = [
  'awaiting_approval',
  'blocked',
  'completed',
  'failed',
];
const OPERATION_STAGES: readonly MarketplaceInstallOperationStage[] = [
  'plan_revalidation',
  'package_verification',
  'work_approval',
  'grant_resolution',
  'workspace_provisioning',
  'package_installation',
];
const STAGE_OUTCOMES: readonly MarketplaceInstallStageOutcome[] = [
  'passed',
  'pending',
  'skipped',
  'blocked',
  'failed',
];
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_VALUE',
      path,
      message: 'must be a plain object',
    }]);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, path: string): string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || value.length > 1024
    || /[\r\n\0]/.test(value)
  ) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_VALUE',
      path,
      message: 'must be a non-empty string',
    }]);
  }
  return value;
}

function exactIso(value: unknown, path: string): string {
  const text = requiredString(value, path);
  const parsed = new Date(text);
  if (!ISO_UTC.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== text) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_VALUE',
      path,
      message: 'must be an exact ISO-8601 UTC timestamp',
    }]);
  }
  return text;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);
  if (required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_VALUE',
      path,
      message: `missing required field; expected ${required.join(', ')}`,
    }]);
  }
  if (keys.some((key) => !allowed.has(key))) {
    throw new MarketplaceValidationError([{
      code: 'UNKNOWN_FIELD',
      path,
      message: 'contains an unknown field',
    }]);
  }
}

export const MARKETPLACE_IPC_CHANNELS = Object.freeze({
  loadCatalog: 'personalOfficeMarketplace:loadCatalog',
  createPlan: 'personalOfficeMarketplace:createPlan',
  requestInstall: 'personalOfficeMarketplace:requestInstall',
  resumeInstall: 'personalOfficeMarketplace:resumeInstall',
});

export function marketplaceOperationId(plan: MarketplaceInstallPlan): string {
  return plan.planId.replace(
    /^marketplace-install-plan:/,
    'marketplace-install-operation:',
  );
}

export function parseMarketplaceInstallOperationReceipt(
  value: unknown,
): MarketplaceInstallOperationReceipt {
  const root = record(value, 'receipt');
  exactKeys(root, [
    'schemaVersion',
    'operationVersion',
    'operationId',
    'planId',
    'packageKey',
    'scope',
    'status',
    'stages',
    'startedAt',
    'updatedAt',
  ], [
    'approvalId',
    'provisionedWorkspaceInstanceId',
    'installedPackageKey',
  ], 'receipt');
  if (root.schemaVersion !== MARKETPLACE_OPERATION_SCHEMA_VERSION
    || root.operationVersion !== MARKETPLACE_OPERATION_VERSION) {
    throw new MarketplaceValidationError([{
      code: 'UNSUPPORTED_VERSION',
      path: 'receipt.schemaVersion',
      message: 'unsupported Marketplace operation version',
    }]);
  }
  const operationId = requiredString(root.operationId, 'receipt.operationId');
  const planId = requiredString(root.planId, 'receipt.planId');
  const packageKey = requiredString(root.packageKey, 'receipt.packageKey');
  const scope = parseMarketplaceInstallScope(root.scope, 'receipt.scope');
  const status = requiredString(root.status, 'receipt.status') as MarketplaceInstallOperationStatus;
  if (!OPERATION_STATUSES.includes(status)) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_VALUE',
      path: 'receipt.status',
      message: 'unsupported operation status',
    }]);
  }
  if (operationId !== planId.replace(/^marketplace-install-plan:/, 'marketplace-install-operation:')) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_VALUE',
      path: 'receipt.operationId',
      message: 'must bind the exact plan id',
    }]);
  }
  if (!Array.isArray(root.stages)) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_VALUE',
      path: 'receipt.stages',
      message: 'must be an array',
    }]);
  }
  const stages = root.stages.map((item, index) => {
    const path = `receipt.stages[${index}]`;
    const stageRecord = record(item, path);
    exactKeys(stageRecord, ['stage', 'outcome', 'code'], ['evidenceDigest', 'referenceId'], path);
    const stageName = requiredString(stageRecord.stage, `${path}.stage`) as MarketplaceInstallOperationStage;
    const outcome = requiredString(stageRecord.outcome, `${path}.outcome`) as MarketplaceInstallStageOutcome;
    const code = requiredString(stageRecord.code, `${path}.code`);
    if (!OPERATION_STAGES.includes(stageName) || !STAGE_OUTCOMES.includes(outcome)) {
      throw new MarketplaceValidationError([{
        code: 'INVALID_VALUE',
        path,
        message: 'unsupported stage or outcome',
      }]);
    }
    const evidenceDigest = stageRecord.evidenceDigest === undefined
      ? undefined
      : requiredString(stageRecord.evidenceDigest, `${path}.evidenceDigest`);
    if (evidenceDigest !== undefined && !DIGEST.test(evidenceDigest)) {
      throw new MarketplaceValidationError([{
        code: 'INVALID_VALUE',
        path: `${path}.evidenceDigest`,
        message: 'must use sha256:<64 lowercase hex>',
      }]);
    }
    const referenceId = stageRecord.referenceId === undefined
      ? undefined
      : requiredString(stageRecord.referenceId, `${path}.referenceId`);
    return Object.freeze({
      stage: stageName,
      outcome,
      code,
      ...(evidenceDigest ? { evidenceDigest } : {}),
      ...(referenceId ? { referenceId } : {}),
    });
  });
  const expectedStageNames = OPERATION_STAGES.slice(0, stages.length);
  if (stages.some((item, index) => item.stage !== expectedStageNames[index])) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_VALUE',
      path: 'receipt.stages',
      message: 'stages must be a unique ordered prefix of the operation pipeline',
    }]);
  }
  const lastStage = stages.at(-1);
  if (!lastStage) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_VALUE',
      path: 'receipt.stages',
      message: 'must contain at least one stage',
    }]);
  }
  if (
    root.status === 'awaiting_approval'
    && (lastStage.stage !== 'work_approval' || lastStage.outcome !== 'pending')
  ) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_VALUE',
      path: 'receipt.status',
      message: 'awaiting_approval requires a pending work_approval stage',
    }]);
  }
  if (
    root.status === 'completed'
    && (
      stages.length !== OPERATION_STAGES.length
      || lastStage.stage !== 'package_installation'
      || lastStage.outcome !== 'passed'
    )
  ) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_VALUE',
      path: 'receipt.status',
      message: 'completed requires every operation stage and a passed installation',
    }]);
  }
  if (
    (root.status === 'blocked' || root.status === 'failed')
    && !['blocked', 'failed'].includes(lastStage.outcome)
  ) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_VALUE',
      path: 'receipt.status',
      message: 'blocked or failed requires a blocked or failed terminal stage',
    }]);
  }
  const optionalString = (key: string): string | undefined => (
    root[key] === undefined ? undefined : requiredString(root[key], `receipt.${key}`)
  );
  const approvalId = optionalString('approvalId');
  const provisionedWorkspaceInstanceId = optionalString('provisionedWorkspaceInstanceId');
  const installedPackageKey = optionalString('installedPackageKey');
  const startedAt = exactIso(root.startedAt, 'receipt.startedAt');
  const updatedAt = exactIso(root.updatedAt, 'receipt.updatedAt');
  if (new Date(updatedAt).getTime() < new Date(startedAt).getTime()) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_VALUE',
      path: 'receipt.updatedAt',
      message: 'must not precede startedAt',
    }]);
  }
  if (
    provisionedWorkspaceInstanceId !== undefined
    && provisionedWorkspaceInstanceId !== scope.workspaceInstanceId
  ) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_VALUE',
      path: 'receipt.provisionedWorkspaceInstanceId',
      message: 'must match the exact operation workspace',
    }]);
  }
  if (installedPackageKey !== undefined && installedPackageKey !== packageKey) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_VALUE',
      path: 'receipt.installedPackageKey',
      message: 'must match the exact reviewed package',
    }]);
  }
  const approvalStage = stages.find((item) => item.stage === 'work_approval');
  if (
    approvalId !== undefined
    && approvalStage?.referenceId !== approvalId
  ) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_VALUE',
      path: 'receipt.approvalId',
      message: 'must match the work approval stage reference',
    }]);
  }
  if (status === 'awaiting_approval' && approvalId === undefined) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_VALUE',
      path: 'receipt.approvalId',
      message: 'is required while awaiting approval',
    }]);
  }
  if (
    status === 'completed'
    && (
      provisionedWorkspaceInstanceId === undefined
      || installedPackageKey === undefined
    )
  ) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_VALUE',
      path: 'receipt.status',
      message: 'completed requires exact provisioning and installation evidence',
    }]);
  }
  return Object.freeze({
    schemaVersion: MARKETPLACE_OPERATION_SCHEMA_VERSION,
    operationVersion: MARKETPLACE_OPERATION_VERSION,
    operationId,
    planId,
    packageKey,
    scope,
    status,
    stages: Object.freeze(stages),
    ...(approvalId ? { approvalId } : {}),
    ...(provisionedWorkspaceInstanceId ? { provisionedWorkspaceInstanceId } : {}),
    ...(installedPackageKey ? { installedPackageKey } : {}),
    startedAt,
    updatedAt,
  });
}
