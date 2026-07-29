import { createHash } from 'node:crypto';
import type { CapabilityRegistrySnapshot } from '../../shared/capabilities';
import {
  MARKETPLACE_OPERATION_SCHEMA_VERSION,
  MARKETPLACE_OPERATION_VERSION,
  createMarketplaceInstallPlan,
  marketplaceOperationId,
  parseMarketplaceInstallPlan,
  type MarketplaceCatalog,
  type MarketplaceCatalogMetadataEnvelope,
  type MarketplaceConnectionState,
  type MarketplaceInstallOperationReceipt,
  type MarketplaceInstallPlan,
  type MarketplaceInstallScope,
  type MarketplacePackage,
  type MarketplacePackageVerificationEvidence,
} from '../../shared/marketplace';
import { canonicalJson } from '../../shared/personal-office';
import { buildMarketplaceCatalogFromCapabilityRegistry } from './catalog-adapter';

const SHA256 = /^sha256:[a-f0-9]{64}$/;

export type MarketplaceOperationErrorCode =
  | 'AUTHORITY_UNAVAILABLE'
  | 'CATALOG_UNAVAILABLE'
  | 'PLAN_DRIFT'
  | 'PACKAGE_EVIDENCE_INVALID';

export class MarketplaceOperationError extends Error {
  constructor(
    readonly code: MarketplaceOperationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MarketplaceOperationError';
  }
}

export interface MarketplaceCatalogAuthoritySnapshot {
  readonly metadata: MarketplaceCatalogMetadataEnvelope | unknown;
  readonly registry: CapabilityRegistrySnapshot;
  readonly desktopVersion: string;
  readonly connection: MarketplaceConnectionState;
  readonly retrievedAt: string;
  readonly installedPackageKeys?: readonly string[];
  readonly notice?: string;
}

export interface MarketplaceCatalogAuthorityPort {
  load(): Promise<MarketplaceCatalogAuthoritySnapshot | null>;
}

export interface MarketplaceIdentityAuthorityPort {
  resolveScope(): Promise<MarketplaceInstallScope | null>;
}

export interface MarketplacePackageVerificationPort {
  verify(input: {
    readonly plan: MarketplaceInstallPlan;
    readonly packageRecord: MarketplacePackage;
  }): Promise<MarketplacePackageVerificationEvidence & {
    readonly packageHandle: unknown;
  }>;
}

export type MarketplaceApprovalState =
  | 'unavailable'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'invalidated';

export interface MarketplaceApprovalPort {
  request(input: {
    readonly plan: MarketplaceInstallPlan;
    readonly packageEvidence: MarketplacePackageVerificationEvidence;
    readonly bindingDigest: string;
    readonly operationId: string;
  }): Promise<{
    readonly approvalId: string;
    readonly state: MarketplaceApprovalState;
    readonly bindingDigest: string;
  }>;
  get(approvalId: string): Promise<{
    readonly approvalId: string;
    readonly state: MarketplaceApprovalState;
    readonly bindingDigest: string;
  } | null>;
}

export interface MarketplaceGrantResolutionPort {
  resolve(input: {
    readonly plan: MarketplaceInstallPlan;
    readonly packageEvidence: MarketplacePackageVerificationEvidence;
  }): Promise<{
    readonly status: 'resolved' | 'missing' | 'unavailable';
    readonly evidenceDigest?: string;
    readonly code?: string;
  }>;
}

export interface MarketplaceWorkspaceProvisioningPort {
  provision(input: {
    readonly plan: MarketplaceInstallPlan;
    readonly packageEvidence: MarketplacePackageVerificationEvidence;
  }): Promise<{
    readonly status: 'provisioned' | 'failed' | 'unavailable';
    readonly workspaceInstanceId?: string;
    readonly evidenceDigest?: string;
    readonly code?: string;
  }>;
}

export interface MarketplaceInstallerPort {
  install(input: {
    readonly plan: MarketplaceInstallPlan;
    readonly packageEvidence: MarketplacePackageVerificationEvidence;
    readonly packageHandle: unknown;
    readonly workspaceInstanceId: string;
  }): Promise<{
    readonly status: 'installed' | 'failed' | 'unavailable';
    readonly installedPackageKey?: string;
    readonly evidenceDigest?: string;
    readonly code?: string;
  }>;
}

export interface MarketplaceCompletedReceiptSink {
  recordCompleted(receipt: MarketplaceInstallOperationReceipt): Promise<void>;
}

export interface MarketplaceOperationServiceOptions {
  readonly catalogAuthority: MarketplaceCatalogAuthorityPort;
  readonly identityAuthority: MarketplaceIdentityAuthorityPort;
  readonly packageVerifier: MarketplacePackageVerificationPort;
  readonly approvals: MarketplaceApprovalPort;
  readonly grants: MarketplaceGrantResolutionPort;
  readonly provisioner: MarketplaceWorkspaceProvisioningPort;
  readonly installer: MarketplaceInstallerPort;
  readonly completedReceiptSink?: MarketplaceCompletedReceiptSink;
  readonly now?: () => Date;
}

interface AuthoritativePlan {
  readonly plan: MarketplaceInstallPlan;
  readonly packageRecord: MarketplacePackage;
}

interface VerifiedPackage {
  readonly evidence: MarketplacePackageVerificationEvidence;
  readonly packageHandle: unknown;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function exactIso(value: Date): string {
  return value.toISOString();
}

function stage(
  receipt: Omit<import('../../shared/marketplace').MarketplaceInstallStageReceipt, 'stage'> & {
    readonly stage: import('../../shared/marketplace').MarketplaceInstallOperationStage;
  },
) {
  return Object.freeze(receipt);
}

export class MarketplaceOperationService {
  private readonly now: () => Date;

  constructor(private readonly options: MarketplaceOperationServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async loadCatalog(): Promise<MarketplaceCatalog> {
    const authority = await this.options.catalogAuthority.load();
    if (!authority) {
      throw new MarketplaceOperationError(
        'CATALOG_UNAVAILABLE',
        'An audited Marketplace catalog is unavailable.',
      );
    }
    return buildMarketplaceCatalogFromCapabilityRegistry(
      authority.metadata,
      authority.registry,
      {
        desktopVersion: authority.desktopVersion,
        connection: authority.connection,
        retrievedAt: authority.retrievedAt,
        ...(authority.installedPackageKeys
          ? { installedPackageKeys: authority.installedPackageKeys }
          : {}),
        ...(authority.notice ? { notice: authority.notice } : {}),
      },
    );
  }

  async createPlan(packageKey: string): Promise<MarketplaceInstallPlan> {
    const scope = await this.options.identityAuthority.resolveScope();
    if (!scope) {
      throw new MarketplaceOperationError(
        'AUTHORITY_UNAVAILABLE',
        'Authenticated Marketplace scope is unavailable.',
      );
    }
    return createMarketplaceInstallPlan(
      await this.loadCatalog(),
      packageKey,
      scope,
      exactIso(this.now()),
    );
  }

  async requestInstall(planInput: unknown): Promise<MarketplaceInstallOperationReceipt> {
    const startedAt = exactIso(this.now());
    const authoritative = await this.authoritativePlan(planInput);
    const stages: import('../../shared/marketplace').MarketplaceInstallStageReceipt[] = [
      stage({
        stage: 'plan_revalidation',
        outcome: 'passed',
        code: 'UNCHANGED_PLAN',
        evidenceDigest: authoritative.plan.registryDigest,
      }),
    ];
    const verified = await this.verifyPackage(authoritative, stages);
    if (!verified) {
      return this.receipt(authoritative.plan, stages, 'failed', startedAt);
    }
    const bindingDigest = this.bindingDigest(authoritative.plan, verified.evidence);

    if (authoritative.plan.requiresApproval) {
      const approval = await this.options.approvals.request({
        plan: authoritative.plan,
        packageEvidence: verified.evidence,
        bindingDigest,
        operationId: marketplaceOperationId(authoritative.plan),
      });
      if (approval.bindingDigest !== bindingDigest) {
        stages.push(stage({
          stage: 'work_approval',
          outcome: 'failed',
          code: 'APPROVAL_BINDING_MISMATCH',
          referenceId: approval.approvalId,
        }));
        return this.receipt(authoritative.plan, stages, 'failed', startedAt, approval.approvalId);
      }
      if (
        typeof approval.approvalId !== 'string'
        || !approval.approvalId.trim()
        || approval.approvalId !== approval.approvalId.trim()
      ) {
        stages.push(stage({
          stage: 'work_approval',
          outcome: 'failed',
          code: 'APPROVAL_ID_INVALID',
        }));
        return this.receipt(authoritative.plan, stages, 'failed', startedAt);
      }
      if (approval.state === 'pending') {
        stages.push(stage({
          stage: 'work_approval',
          outcome: 'pending',
          code: 'APPROVAL_PENDING',
          referenceId: approval.approvalId,
        }));
        return this.receipt(
          authoritative.plan,
          stages,
          'awaiting_approval',
          startedAt,
          approval.approvalId,
        );
      }
      if (approval.state !== 'approved') {
        stages.push(stage({
          stage: 'work_approval',
          outcome: 'blocked',
          code: `APPROVAL_${approval.state.toUpperCase()}`,
          referenceId: approval.approvalId,
        }));
        return this.receipt(
          authoritative.plan,
          stages,
          'blocked',
          startedAt,
          approval.approvalId,
        );
      }
      stages.push(stage({
        stage: 'work_approval',
        outcome: 'passed',
        code: 'APPROVAL_APPROVED',
        referenceId: approval.approvalId,
      }));
      return this.complete(
        authoritative,
        verified,
        stages,
        startedAt,
        approval.approvalId,
      );
    }

    stages.push(stage({
      stage: 'work_approval',
      outcome: 'skipped',
      code: 'APPROVAL_NOT_REQUIRED',
    }));
    return this.complete(authoritative, verified, stages, startedAt);
  }

  async resumeInstall(
    planInput: unknown,
    approvalId: string,
  ): Promise<MarketplaceInstallOperationReceipt> {
    const startedAt = exactIso(this.now());
    const authoritative = await this.authoritativePlan(planInput);
    const stages: import('../../shared/marketplace').MarketplaceInstallStageReceipt[] = [
      stage({
        stage: 'plan_revalidation',
        outcome: 'passed',
        code: 'UNCHANGED_PLAN',
        evidenceDigest: authoritative.plan.registryDigest,
      }),
    ];
    const verified = await this.verifyPackage(authoritative, stages);
    if (!verified) {
      return this.receipt(authoritative.plan, stages, 'failed', startedAt);
    }
    const approval = await this.options.approvals.get(approvalId);
    const bindingDigest = this.bindingDigest(authoritative.plan, verified.evidence);
    if (
      !approval
      || approval.approvalId !== approvalId
      || approval.bindingDigest !== bindingDigest
    ) {
      stages.push(stage({
        stage: 'work_approval',
        outcome: 'failed',
        code: approval
          ? 'APPROVAL_BINDING_MISMATCH'
          : 'APPROVAL_NOT_FOUND',
        referenceId: approvalId,
      }));
      return this.receipt(authoritative.plan, stages, 'failed', startedAt, approvalId);
    }
    if (approval.state === 'pending') {
      stages.push(stage({
        stage: 'work_approval',
        outcome: 'pending',
        code: 'APPROVAL_PENDING',
        referenceId: approvalId,
      }));
      return this.receipt(
        authoritative.plan,
        stages,
        'awaiting_approval',
        startedAt,
        approvalId,
      );
    }
    if (approval.state !== 'approved') {
      stages.push(stage({
        stage: 'work_approval',
        outcome: 'blocked',
        code: `APPROVAL_${approval.state.toUpperCase()}`,
        referenceId: approvalId,
      }));
      return this.receipt(authoritative.plan, stages, 'blocked', startedAt, approvalId);
    }
    stages.push(stage({
      stage: 'work_approval',
      outcome: 'passed',
      code: 'APPROVAL_APPROVED',
      referenceId: approvalId,
    }));
    return this.complete(authoritative, verified, stages, startedAt, approvalId);
  }

  private async authoritativePlan(planInput: unknown): Promise<AuthoritativePlan> {
    let submitted: MarketplaceInstallPlan;
    try {
      submitted = parseMarketplaceInstallPlan(planInput);
    } catch {
      throw new MarketplaceOperationError(
        'PLAN_DRIFT',
        'The submitted install plan is invalid or no longer authoritative.',
      );
    }
    const scope = await this.options.identityAuthority.resolveScope();
    if (!scope) {
      throw new MarketplaceOperationError(
        'AUTHORITY_UNAVAILABLE',
        'Authenticated Marketplace scope is unavailable.',
      );
    }
    const catalog = await this.loadCatalog();
    const recreated = createMarketplaceInstallPlan(
      catalog,
      submitted.packageIdentity.packageKey,
      scope,
      submitted.plannedAt,
    );
    if (canonicalJson(recreated) !== canonicalJson(submitted)) {
      throw new MarketplaceOperationError(
        'PLAN_DRIFT',
        'The install plan no longer matches current host authority.',
      );
    }
    const packageRecord = catalog.packages.find(
      (candidate) => candidate.identity.packageKey === recreated.packageIdentity.packageKey,
    );
    if (!packageRecord) {
      throw new MarketplaceOperationError(
        'PLAN_DRIFT',
        'The planned package is absent from the current catalog.',
      );
    }
    return { plan: recreated, packageRecord };
  }

  private async verifyPackage(
    authoritative: AuthoritativePlan,
    stages: import('../../shared/marketplace').MarketplaceInstallStageReceipt[],
  ): Promise<VerifiedPackage | null> {
    try {
      const verified = await this.options.packageVerifier.verify({
        plan: authoritative.plan,
        packageRecord: authoritative.packageRecord,
      });
      if (
        verified.packageKey !== authoritative.plan.packageIdentity.packageKey
        || !SHA256.test(verified.packageDigest)
        || !SHA256.test(verified.publisherSignatureDigest)
        || verified.publisherSignatureDigest !== authoritative.packageRecord.signatureDigest
        || verified.signatureVerified !== true
      ) {
        throw new MarketplaceOperationError(
          'PACKAGE_EVIDENCE_INVALID',
          'Package verification evidence does not match the reviewed package.',
        );
      }
      const evidence = Object.freeze({
        packageKey: verified.packageKey,
        packageDigest: verified.packageDigest,
        publisherSignatureDigest: verified.publisherSignatureDigest,
        signatureVerified: true as const,
      });
      stages.push(stage({
        stage: 'package_verification',
        outcome: 'passed',
        code: 'PACKAGE_AND_SIGNATURE_VERIFIED',
        evidenceDigest: evidence.packageDigest,
      }));
      return { evidence, packageHandle: verified.packageHandle };
    } catch {
      stages.push(stage({
        stage: 'package_verification',
        outcome: 'failed',
        code: 'PACKAGE_EVIDENCE_INVALID',
      }));
      return null;
    }
  }

  private async complete(
    authoritative: AuthoritativePlan,
    verified: VerifiedPackage,
    stages: import('../../shared/marketplace').MarketplaceInstallStageReceipt[],
    startedAt: string,
    approvalId?: string,
  ): Promise<MarketplaceInstallOperationReceipt> {
    const grant = await this.options.grants.resolve({
      plan: authoritative.plan,
      packageEvidence: verified.evidence,
    });
    if (grant.status !== 'resolved') {
      stages.push(stage({
        stage: 'grant_resolution',
        outcome: 'blocked',
        code: grant.code ?? `GRANTS_${grant.status.toUpperCase()}`,
        ...(grant.evidenceDigest ? { evidenceDigest: grant.evidenceDigest } : {}),
      }));
      return this.receipt(
        authoritative.plan,
        stages,
        'blocked',
        startedAt,
        approvalId,
      );
    }
    stages.push(stage({
      stage: 'grant_resolution',
      outcome: 'passed',
      code: 'EXACT_GRANTS_RESOLVED',
      ...(grant.evidenceDigest ? { evidenceDigest: grant.evidenceDigest } : {}),
    }));

    if (!this.options.completedReceiptSink) {
      stages.push(stage({
        stage: 'workspace_provisioning',
        outcome: 'blocked',
        code: 'OPERATIONAL_EVIDENCE_SINK_UNAVAILABLE',
      }));
      return this.receipt(
        authoritative.plan,
        stages,
        'blocked',
        startedAt,
        approvalId,
      );
    }

    const provisioned = await this.options.provisioner.provision({
      plan: authoritative.plan,
      packageEvidence: verified.evidence,
    });
    if (
      provisioned.status !== 'provisioned'
      || provisioned.workspaceInstanceId !== authoritative.plan.scope.workspaceInstanceId
    ) {
      stages.push(stage({
        stage: 'workspace_provisioning',
        outcome: provisioned.status === 'failed' ? 'failed' : 'blocked',
        code: provisioned.code ?? `PROVISIONING_${provisioned.status.toUpperCase()}`,
        ...(provisioned.evidenceDigest ? { evidenceDigest: provisioned.evidenceDigest } : {}),
      }));
      return this.receipt(
        authoritative.plan,
        stages,
        provisioned.status === 'failed' ? 'failed' : 'blocked',
        startedAt,
        approvalId,
      );
    }
    stages.push(stage({
      stage: 'workspace_provisioning',
      outcome: 'passed',
      code: 'WORKSPACE_PROVISIONED',
      ...(provisioned.evidenceDigest ? { evidenceDigest: provisioned.evidenceDigest } : {}),
      referenceId: provisioned.workspaceInstanceId,
    }));

    const installed = await this.options.installer.install({
      plan: authoritative.plan,
      packageEvidence: verified.evidence,
      packageHandle: verified.packageHandle,
      workspaceInstanceId: provisioned.workspaceInstanceId,
    });
    if (
      installed.status !== 'installed'
      || installed.installedPackageKey !== authoritative.plan.packageIdentity.packageKey
    ) {
      stages.push(stage({
        stage: 'package_installation',
        outcome: installed.status === 'failed' ? 'failed' : 'blocked',
        code: installed.code ?? `INSTALLATION_${installed.status.toUpperCase()}`,
        ...(installed.evidenceDigest ? { evidenceDigest: installed.evidenceDigest } : {}),
      }));
      return this.receipt(
        authoritative.plan,
        stages,
        installed.status === 'failed' ? 'failed' : 'blocked',
        startedAt,
        approvalId,
        provisioned.workspaceInstanceId,
      );
    }
    stages.push(stage({
      stage: 'package_installation',
      outcome: 'passed',
      code: 'PACKAGE_INSTALLED',
      ...(installed.evidenceDigest ? { evidenceDigest: installed.evidenceDigest } : {}),
      referenceId: installed.installedPackageKey,
    }));
    const completedStages = [
      ...stages,
      stage({
        stage: 'operational_evidence',
        outcome: 'passed',
        code: 'AUTHORITATIVE_RECEIPT_RECORDED',
      }),
    ];
    const completed = this.receipt(
      authoritative.plan,
      completedStages,
      'completed',
      startedAt,
      approvalId,
      provisioned.workspaceInstanceId,
      installed.installedPackageKey,
    );
    try {
      await this.options.completedReceiptSink.recordCompleted(completed);
    } catch {
      stages.push(stage({
        stage: 'operational_evidence',
        outcome: 'blocked',
        code: 'AUTHORITATIVE_RECEIPT_UNAVAILABLE',
      }));
      return this.receipt(
        authoritative.plan,
        stages,
        'blocked',
        startedAt,
        approvalId,
        provisioned.workspaceInstanceId,
        installed.installedPackageKey,
      );
    }
    return completed;
  }

  private bindingDigest(
    plan: MarketplaceInstallPlan,
    evidence: MarketplacePackageVerificationEvidence,
  ): string {
    return sha256(canonicalJson({ plan, packageEvidence: evidence }));
  }

  private receipt(
    plan: MarketplaceInstallPlan,
    stages: readonly import('../../shared/marketplace').MarketplaceInstallStageReceipt[],
    status: MarketplaceInstallOperationReceipt['status'],
    startedAt: string,
    approvalId?: string,
    provisionedWorkspaceInstanceId?: string,
    installedPackageKey?: string,
  ): MarketplaceInstallOperationReceipt {
    return Object.freeze({
      schemaVersion: MARKETPLACE_OPERATION_SCHEMA_VERSION,
      operationVersion: MARKETPLACE_OPERATION_VERSION,
      operationId: marketplaceOperationId(plan),
      planId: plan.planId,
      packageKey: plan.packageIdentity.packageKey,
      scope: plan.scope,
      status,
      stages: Object.freeze([...stages]),
      ...(approvalId ? { approvalId } : {}),
      ...(provisionedWorkspaceInstanceId ? { provisionedWorkspaceInstanceId } : {}),
      ...(installedPackageKey ? { installedPackageKey } : {}),
      startedAt,
      updatedAt: exactIso(this.now()),
    });
  }
}
