import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import type { CustomerMarketingWorkflowAuditReceiptV1 } from '../../shared/customer-marketing-types';

const SCHEMA_VERSION = 1;
const STORAGE_PREFIX = 'customer_marketing_workflows:v1:';
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_LEASE_MS = 60_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_RETRY_DELAY_MS = 60 * 60 * 1_000;
const MAX_ARTIFACT_BYTES = 1024 * 1024;
const MAX_ID_LENGTH = 256;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface WorkflowSettings {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  deleteSetting(key: string): void;
}

export type WorkflowStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'blocked';

export type WorkflowJobStatus =
  | 'pending'
  | 'running'
  | 'retry_scheduled'
  | 'awaiting_approval'
  | 'completed'
  | 'blocked';

export type WorkflowApprovalStatus = 'pending' | 'approved' | 'rejected';
export type WorkflowApprovalDecision = 'approved' | 'rejected';
export type WorkflowArtifactPurpose = 'job_output' | 'approval';

export interface WorkflowLease {
  token: string;
  workerId: string;
  claimedAt: string;
  expiresAt: string;
}

export interface WorkflowJob {
  id: string;
  dependsOn: string[];
  status: WorkflowJobStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  lease: WorkflowLease | null;
  lastError: string | null;
  artifactIds: string[];
  approvalIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CustomerMarketingWorkflow {
  id: string;
  status: WorkflowStatus;
  jobs: WorkflowJob[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface WorkflowArtifact {
  id: string;
  workflowId: string;
  jobId: string;
  purpose: WorkflowArtifactPurpose;
  content: string;
  mediaType: string;
  sha256: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowApproval {
  id: string;
  workflowId: string;
  jobId: string;
  artifactId: string;
  digest: string;
  status: WorkflowApprovalStatus;
  note: string | null;
  revision: number;
  requestedAt: string;
  reviewedAt: string | null;
}

export type WorkflowAuditReceipt = CustomerMarketingWorkflowAuditReceiptV1;

export interface WorkflowApprovalReceiptContext {
  id: string;
  manifestDigest: string;
  reviewerHash: string;
  policyRevision: 'cmr-306.v1';
  externalActionPerformed: false;
}

export interface WorkflowStoreSnapshot {
  schemaVersion: typeof SCHEMA_VERSION;
  workspaceHash: string;
  revision: number;
  workflows: CustomerMarketingWorkflow[];
  artifacts: WorkflowArtifact[];
  approvals: WorkflowApproval[];
  receipts: WorkflowAuditReceipt[];
  updatedAt: string;
}

export interface CreateWorkflowJobInput {
  id: string;
  dependsOn?: readonly string[];
  maxAttempts?: number;
}

export interface CreateWorkflowInput {
  id: string;
  jobs: readonly CreateWorkflowJobInput[];
}

export interface ClaimNextJobInput {
  workerId: string;
  leaseMs?: number;
}

export interface ArtifactInput {
  id: string;
  content: string;
  mediaType?: string;
}

export interface ReviseArtifactInput {
  content: string;
  mediaType?: string;
}

export interface FailJobInput {
  error: string;
  retryDelayMs?: number;
}

export interface RequestApprovalInput {
  id: string;
  artifactId: string;
  digest: string;
}

export interface ReviewApprovalInput {
  decision: WorkflowApprovalDecision;
  digest: string;
  note?: string;
  receiptContext?: WorkflowApprovalReceiptContext;
}

export interface RevisedPendingApprovalArtifact {
  artifact: WorkflowArtifact;
  approval: WorkflowApproval;
}

export interface WorkflowStoreOptions {
  now?: () => number | Date;
  createId?: () => string;
  defaultLeaseMs?: number;
  retryBaseDelayMs?: number;
  maxRetryDelayMs?: number;
}

export class WorkflowStoreValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowStoreValidationError';
  }
}

export class WorkflowStoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowStoreConflictError';
  }
}

export class WorkflowStoreCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowStoreCorruptionError';
  }
}

export function workflowArtifactSha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function workflowAuditReceiptDigest(
  receipt: Omit<WorkflowAuditReceipt, 'receiptDigest'>,
): string {
  return workflowArtifactSha256(JSON.stringify({
    id: receipt.id,
    workflowId: receipt.workflowId,
    approvalId: receipt.approvalId,
    manifestDigest: receipt.manifestDigest,
    decision: receipt.decision,
    reviewerHash: receipt.reviewerHash,
    reviewedAt: receipt.reviewedAt,
    policyRevision: receipt.policyRevision,
    externalActionPerformed: receipt.externalActionPerformed,
  }));
}

export function customerMarketingWorkflowStorageKey(workspaceId: string): string {
  assertIdentifier(workspaceId, 'Workspace id');
  const workspaceHash = createHash('sha256').update(workspaceId, 'utf8').digest('hex');
  return `${STORAGE_PREFIX}${workspaceHash}`;
}

export class CustomerMarketingWorkflowStore {
  private readonly storageKey: string;
  private readonly quarantineKey: string;
  private readonly workspaceHash: string;
  private readonly nowProvider: () => number | Date;
  private readonly idProvider: () => string;
  private readonly defaultLeaseMs: number;
  private readonly retryBaseDelayMs: number;
  private readonly maxRetryDelayMs: number;

  constructor(
    private readonly settings: WorkflowSettings,
    workspaceId: string,
    options: WorkflowStoreOptions = {},
  ) {
    assertSettings(settings);
    this.storageKey = customerMarketingWorkflowStorageKey(workspaceId);
    this.quarantineKey = `${this.storageKey}:quarantine`;
    this.workspaceHash = this.storageKey.slice(STORAGE_PREFIX.length);
    this.nowProvider = options.now ?? Date.now;
    this.idProvider = options.createId ?? randomUUID;
    this.defaultLeaseMs = positiveInteger(
      options.defaultLeaseMs ?? DEFAULT_LEASE_MS,
      'Default lease duration',
    );
    this.retryBaseDelayMs = positiveInteger(
      options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
      'Retry base delay',
    );
    this.maxRetryDelayMs = positiveInteger(
      options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS,
      'Maximum retry delay',
    );
    if (this.retryBaseDelayMs > this.maxRetryDelayMs) {
      throw new WorkflowStoreValidationError(
        'Retry base delay cannot exceed the maximum retry delay.',
      );
    }
  }

  getSnapshot(): WorkflowStoreSnapshot {
    return clone(this.readState());
  }

  listWorkflows(): CustomerMarketingWorkflow[] {
    return clone(this.readState().workflows);
  }

  getWorkflow(workflowId: string): CustomerMarketingWorkflow | null {
    assertIdentifier(workflowId, 'Workflow id');
    const workflow = this.readState().workflows.find((item) => item.id === workflowId);
    return workflow ? clone(workflow) : null;
  }

  getArtifact(artifactId: string): WorkflowArtifact | null {
    assertIdentifier(artifactId, 'Artifact id');
    const artifact = this.readState().artifacts.find((item) => item.id === artifactId);
    return artifact ? clone(artifact) : null;
  }

  getApproval(approvalId: string): WorkflowApproval | null {
    assertIdentifier(approvalId, 'Approval id');
    const approval = this.readState().approvals.find((item) => item.id === approvalId);
    return approval ? clone(approval) : null;
  }

  getWorkspaceHash(): string {
    return this.workspaceHash;
  }

  getReceipt(receiptId: string): WorkflowAuditReceipt | null {
    assertIdentifier(receiptId, 'Receipt id');
    const receipt = this.readState().receipts.find((item) => item.id === receiptId);
    return receipt ? clone(receipt) : null;
  }

  getReceiptByApproval(approvalId: string): WorkflowAuditReceipt | null {
    assertIdentifier(approvalId, 'Approval id');
    const receipt = this.readState().receipts.find((item) => item.approvalId === approvalId);
    return receipt ? clone(receipt) : null;
  }

  listReceipts(): WorkflowAuditReceipt[] {
    return clone(this.readState().receipts);
  }

  createWorkflow(input: CreateWorkflowInput): CustomerMarketingWorkflow {
    const normalized = normalizeWorkflowInput(input);
    const timestamp = this.nowIso();

    return this.mutate((state) => {
      if (state.workflows.some((workflow) => workflow.id === normalized.id)) {
        throw new WorkflowStoreConflictError(`Workflow '${normalized.id}' already exists.`);
      }
      const workflow: CustomerMarketingWorkflow = {
        id: normalized.id,
        status: 'pending',
        jobs: normalized.jobs.map((job) => ({
          id: job.id,
          dependsOn: [...job.dependsOn],
          status: 'pending',
          attempts: 0,
          maxAttempts: job.maxAttempts,
          nextAttemptAt: null,
          lease: null,
          lastError: null,
          artifactIds: [],
          approvalIds: [],
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: null,
        })),
        revision: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
      };
      state.workflows.push(workflow);
      return workflow;
    });
  }

  claimNextJob(workflowId: string, input: ClaimNextJobInput): WorkflowJob | null {
    assertIdentifier(workflowId, 'Workflow id');
    assertRecord(input, 'Claim input');
    assertOnlyKeys(input, ['workerId', 'leaseMs'], 'Claim input');
    assertIdentifier(input.workerId, 'Worker id');
    const leaseMs = positiveInteger(input.leaseMs ?? this.defaultLeaseMs, 'Lease duration');
    const now = this.nowMs();
    const timestamp = new Date(now).toISOString();

    return this.mutate((state) => {
      const workflow = requireWorkflow(state, workflowId);
      if (workflow.status === 'completed' || workflow.status === 'blocked') return null;

      const job = workflow.jobs.find((candidate) => {
        if (candidate.status !== 'pending' && candidate.status !== 'retry_scheduled') return false;
        if (candidate.attempts >= candidate.maxAttempts) return false;
        if (candidate.nextAttemptAt && Date.parse(candidate.nextAttemptAt) > now) return false;
        return candidate.dependsOn.every((dependencyId) => (
          workflow.jobs.find((dependency) => dependency.id === dependencyId)?.status === 'completed'
        ));
      });
      if (!job) return null;

      const token = this.idProvider();
      assertIdentifier(token, 'Lease token');
      job.attempts += 1;
      job.status = 'running';
      job.nextAttemptAt = null;
      job.lease = {
        token,
        workerId: input.workerId,
        claimedAt: timestamp,
        expiresAt: new Date(now + leaseMs).toISOString(),
      };
      job.updatedAt = timestamp;
      touchWorkflow(workflow, timestamp);
      recomputeWorkflowStatus(workflow, timestamp);
      return job;
    });
  }

  completeJob(
    workflowId: string,
    jobId: string,
    leaseToken: string,
    artifactInput?: ArtifactInput,
  ): WorkflowJob {
    assertIdentifier(workflowId, 'Workflow id');
    assertIdentifier(jobId, 'Job id');
    assertIdentifier(leaseToken, 'Lease token');
    const artifact = artifactInput ? normalizeArtifactInput(artifactInput) : null;
    const now = this.nowMs();
    const timestamp = new Date(now).toISOString();

    return this.mutate((state) => {
      const workflow = requireWorkflow(state, workflowId);
      const job = requireJob(workflow, jobId);
      if (job.status === 'completed') {
        if (artifact) {
          const existing = state.artifacts.find((item) => item.id === artifact.id);
          if (
            !existing
            || existing.workflowId !== workflowId
            || existing.jobId !== jobId
            || existing.purpose !== 'job_output'
            || existing.content !== artifact.content
            || existing.mediaType !== artifact.mediaType
            || !job.artifactIds.includes(existing.id)
          ) {
            throw new WorkflowStoreConflictError(
              'Completed job artifact does not match its original completion.',
            );
          }
        }
        return job;
      }

      requireLease(job, leaseToken, now);
      if (artifact) {
        const added = addArtifact(
          state,
          workflowId,
          jobId,
          'job_output',
          artifact,
          timestamp,
        );
        if (!job.artifactIds.includes(added.artifact.id)) {
          job.artifactIds.push(added.artifact.id);
        }
      }
      job.status = 'completed';
      job.lease = null;
      job.nextAttemptAt = null;
      job.lastError = null;
      job.updatedAt = timestamp;
      job.completedAt = timestamp;
      touchWorkflow(workflow, timestamp);
      recomputeWorkflowStatus(workflow, timestamp);
      return job;
    });
  }

  failJob(
    workflowId: string,
    jobId: string,
    leaseToken: string,
    input: FailJobInput,
  ): WorkflowJob {
    assertIdentifier(workflowId, 'Workflow id');
    assertIdentifier(jobId, 'Job id');
    assertIdentifier(leaseToken, 'Lease token');
    assertRecord(input, 'Failure input');
    assertOnlyKeys(input, ['error', 'retryDelayMs'], 'Failure input');
    assertNonEmptyString(input.error, 'Failure error');
    const explicitDelay = input.retryDelayMs === undefined
      ? null
      : nonNegativeInteger(input.retryDelayMs, 'Retry delay');
    const now = this.nowMs();
    const timestamp = new Date(now).toISOString();

    return this.mutate((state) => {
      const workflow = requireWorkflow(state, workflowId);
      const job = requireJob(workflow, jobId);
      requireLease(job, leaseToken, now);
      job.lease = null;
      job.lastError = input.error;
      job.updatedAt = timestamp;

      if (job.attempts >= job.maxAttempts) {
        blockJobAndDependents(workflow, job.id, input.error, timestamp);
      } else {
        const delay = explicitDelay ?? this.retryDelayForAttempt(job.attempts);
        job.status = 'retry_scheduled';
        job.nextAttemptAt = new Date(now + delay).toISOString();
      }
      touchWorkflow(workflow, timestamp);
      recomputeWorkflowStatus(workflow, timestamp);
      return job;
    });
  }

  recoverStaleJobs(workflowId?: string): number {
    if (workflowId !== undefined) assertIdentifier(workflowId, 'Workflow id');
    const now = this.nowMs();
    const timestamp = new Date(now).toISOString();

    return this.mutate((state) => {
      const workflows = workflowId === undefined
        ? state.workflows
        : [requireWorkflow(state, workflowId)];
      let recovered = 0;

      for (const workflow of workflows) {
        if (workflow.status === 'completed' || workflow.status === 'blocked') continue;
        let changed = false;
        for (const job of workflow.jobs) {
          if (
            job.status !== 'running'
            || !job.lease
            || Date.parse(job.lease.expiresAt) > now
          ) {
            continue;
          }
          recovered += 1;
          changed = true;
          job.lease = null;
          job.lastError = 'Lease expired.';
          job.updatedAt = timestamp;
          if (job.attempts >= job.maxAttempts) {
            blockJobAndDependents(workflow, job.id, job.lastError, timestamp);
          } else {
            job.status = 'retry_scheduled';
            job.nextAttemptAt = new Date(
              now + this.retryDelayForAttempt(job.attempts),
            ).toISOString();
          }
        }
        if (changed) {
          touchWorkflow(workflow, timestamp);
          recomputeWorkflowStatus(workflow, timestamp);
        }
      }
      return recovered;
    });
  }

  resumeWorkflow(workflowId: string): CustomerMarketingWorkflow {
    assertIdentifier(workflowId, 'Workflow id');
    const now = this.nowMs();
    const timestamp = new Date(now).toISOString();

    return this.mutate((state) => {
      const workflow = requireWorkflow(state, workflowId);
      if (workflow.status === 'completed' || workflow.status === 'blocked') return workflow;
      let changed = false;

      for (const job of workflow.jobs) {
        if (
          job.status === 'running'
          && job.lease
          && Date.parse(job.lease.expiresAt) <= now
        ) {
          changed = true;
          job.lease = null;
          job.updatedAt = timestamp;
          if (job.attempts >= job.maxAttempts) {
            blockJobAndDependents(workflow, job.id, 'Lease released during resume.', timestamp);
          } else {
            job.status = 'retry_scheduled';
            job.nextAttemptAt = new Date(
              now + this.retryDelayForAttempt(job.attempts),
            ).toISOString();
            job.lastError = 'Lease expired during resume.';
          }
        }
      }

      if (changed) {
        touchWorkflow(workflow, timestamp);
        recomputeWorkflowStatus(workflow, timestamp);
      }
      return workflow;
    });
  }

  appendApprovalArtifact(
    workflowId: string,
    jobId: string,
    leaseToken: string,
    input: ArtifactInput,
  ): WorkflowArtifact {
    assertIdentifier(workflowId, 'Workflow id');
    assertIdentifier(jobId, 'Job id');
    assertIdentifier(leaseToken, 'Lease token');
    const artifactInput = normalizeArtifactInput(input);
    const now = this.nowMs();
    const timestamp = new Date(now).toISOString();

    return this.mutate((state) => {
      const workflow = requireWorkflow(state, workflowId);
      const job = requireJob(workflow, jobId);
      const existing = state.artifacts.find((artifact) => artifact.id === artifactInput.id);
      if (existing) {
        if (
          existing.workflowId === workflowId
          && existing.jobId === jobId
          && existing.purpose === 'approval'
          && existing.content === artifactInput.content
          && existing.mediaType === artifactInput.mediaType
          && job.artifactIds.includes(existing.id)
        ) {
          return existing;
        }
        throw new WorkflowStoreConflictError(`Artifact '${artifactInput.id}' already exists.`);
      }

      requireLease(job, leaseToken, now);
      const added = addArtifact(
        state,
        workflowId,
        jobId,
        'approval',
        artifactInput,
        timestamp,
      );
      job.artifactIds.push(added.artifact.id);
      job.updatedAt = timestamp;
      touchWorkflow(workflow, timestamp);
      return added.artifact;
    });
  }

  reviseApprovalArtifact(
    workflowId: string,
    jobId: string,
    leaseToken: string,
    artifactId: string,
    input: ReviseArtifactInput,
  ): WorkflowArtifact {
    assertIdentifier(workflowId, 'Workflow id');
    assertIdentifier(jobId, 'Job id');
    assertIdentifier(leaseToken, 'Lease token');
    assertIdentifier(artifactId, 'Artifact id');
    const revision = normalizeArtifactRevision(input);
    const now = this.nowMs();
    const timestamp = new Date(now).toISOString();

    return this.mutate((state) => {
      const workflow = requireWorkflow(state, workflowId);
      const job = requireJob(workflow, jobId);
      const artifact = state.artifacts.find((item) => item.id === artifactId);
      if (
        !artifact
        || artifact.workflowId !== workflowId
        || artifact.jobId !== jobId
        || artifact.purpose !== 'approval'
        || !job.artifactIds.includes(artifactId)
      ) {
        throw new WorkflowStoreConflictError(`Approval artifact '${artifactId}' was not found.`);
      }

      const mediaType = revision.mediaType ?? artifact.mediaType;
      if (artifact.content === revision.content && artifact.mediaType === mediaType) return artifact;
      requireLease(job, leaseToken, now);
      if (state.approvals.some((approval) => approval.artifactId === artifactId)) {
        throw new WorkflowStoreConflictError(
          'An artifact bound to an approval request cannot be revised.',
        );
      }

      artifact.content = revision.content;
      artifact.mediaType = mediaType;
      artifact.sha256 = workflowArtifactSha256(revision.content);
      artifact.revision += 1;
      artifact.updatedAt = timestamp;
      job.updatedAt = timestamp;
      touchWorkflow(workflow, timestamp);
      return artifact;
    });
  }

  revisePendingApprovalArtifact(
    workflowId: string,
    approvalId: string,
    expectedDigest: string,
    input: ReviseArtifactInput,
  ): RevisedPendingApprovalArtifact {
    assertIdentifier(workflowId, 'Workflow id');
    assertIdentifier(approvalId, 'Approval id');
    assertDigest(expectedDigest, 'Expected approval digest');
    const revision = normalizeArtifactRevision(input);
    const timestamp = this.nowIso();

    return this.mutate((state) => {
      const workflow = requireWorkflow(state, workflowId);
      const approval = state.approvals.find((item) => item.id === approvalId);
      if (!approval || approval.workflowId !== workflowId) {
        throw new WorkflowStoreConflictError(`Approval '${approvalId}' was not found.`);
      }
      if (approval.status !== 'pending') {
        throw new WorkflowStoreConflictError('Only a pending approval artifact can be revised.');
      }
      if (approval.digest !== expectedDigest) {
        throw new WorkflowStoreConflictError('Approval digest changed before revision.');
      }

      const job = requireJob(workflow, approval.jobId);
      if (job.status !== 'awaiting_approval') {
        throw new WorkflowStoreConflictError('The approval job is not awaiting review.');
      }
      const artifact = state.artifacts.find((item) => item.id === approval.artifactId);
      if (
        !artifact
        || artifact.workflowId !== workflowId
        || artifact.jobId !== job.id
        || artifact.purpose !== 'approval'
        || !job.artifactIds.includes(artifact.id)
        || artifact.sha256 !== expectedDigest
      ) {
        throw new WorkflowStoreConflictError('Approval artifact digest mismatch.');
      }

      const mediaType = revision.mediaType ?? artifact.mediaType;
      if (artifact.content === revision.content && artifact.mediaType === mediaType) {
        return { artifact, approval };
      }

      artifact.content = revision.content;
      artifact.mediaType = mediaType;
      artifact.sha256 = workflowArtifactSha256(revision.content);
      artifact.revision += 1;
      artifact.updatedAt = timestamp;
      approval.digest = artifact.sha256;
      approval.revision += 1;
      approval.requestedAt = timestamp;
      job.updatedAt = timestamp;
      touchWorkflow(workflow, timestamp);
      return { artifact, approval };
    });
  }

  requestApproval(
    workflowId: string,
    jobId: string,
    leaseToken: string,
    input: RequestApprovalInput,
  ): WorkflowApproval {
    assertIdentifier(workflowId, 'Workflow id');
    assertIdentifier(jobId, 'Job id');
    assertIdentifier(leaseToken, 'Lease token');
    const request = normalizeApprovalRequest(input);
    const now = this.nowMs();
    const timestamp = new Date(now).toISOString();

    return this.mutate((state) => {
      const workflow = requireWorkflow(state, workflowId);
      const job = requireJob(workflow, jobId);
      const existing = state.approvals.find((approval) => approval.id === request.id);
      if (existing) {
        if (
          existing.workflowId === workflowId
          && existing.jobId === jobId
          && existing.artifactId === request.artifactId
          && existing.digest === request.digest
          && job.approvalIds.includes(existing.id)
        ) {
          return existing;
        }
        throw new WorkflowStoreConflictError(`Approval '${request.id}' already exists.`);
      }

      requireLease(job, leaseToken, now);
      const artifact = state.artifacts.find((item) => item.id === request.artifactId);
      if (
        !artifact
        || artifact.workflowId !== workflowId
        || artifact.jobId !== jobId
        || artifact.purpose !== 'approval'
        || !job.artifactIds.includes(artifact.id)
      ) {
        throw new WorkflowStoreConflictError(
          `Approval artifact '${request.artifactId}' was not found for this job.`,
        );
      }
      if (artifact.sha256 !== request.digest) {
        throw new WorkflowStoreConflictError('Approval digest mismatch.');
      }
      if (state.approvals.some((approval) => (
        approval.workflowId === workflowId
        && approval.jobId === jobId
        && approval.status === 'pending'
      ))) {
        throw new WorkflowStoreConflictError('The job already has a pending approval request.');
      }

      const approval: WorkflowApproval = {
        id: request.id,
        workflowId,
        jobId,
        artifactId: request.artifactId,
        digest: request.digest,
        status: 'pending',
        note: null,
        revision: 1,
        requestedAt: timestamp,
        reviewedAt: null,
      };
      state.approvals.push(approval);
      job.approvalIds.push(approval.id);
      job.status = 'awaiting_approval';
      job.lease = null;
      job.nextAttemptAt = null;
      job.updatedAt = timestamp;
      touchWorkflow(workflow, timestamp);
      recomputeWorkflowStatus(workflow, timestamp);
      return approval;
    });
  }

  reviewApproval(
    workflowId: string,
    approvalId: string,
    input: ReviewApprovalInput,
  ): WorkflowApproval {
    assertIdentifier(workflowId, 'Workflow id');
    assertIdentifier(approvalId, 'Approval id');
    const review = normalizeApprovalReview(input);
    const timestamp = this.nowIso();

    return this.mutate((state) => {
      const workflow = requireWorkflow(state, workflowId);
      const approval = state.approvals.find((item) => item.id === approvalId);
      if (!approval || approval.workflowId !== workflowId) {
        throw new WorkflowStoreConflictError(`Approval '${approvalId}' was not found.`);
      }
      if (approval.digest !== review.digest) {
        throw new WorkflowStoreConflictError('Approval digest mismatch.');
      }
      const artifact = state.artifacts.find((item) => item.id === approval.artifactId);
      if (!artifact || artifact.sha256 !== approval.digest) {
        throw new WorkflowStoreConflictError('Approval artifact digest mismatch.');
      }
      const existingReceipt = state.receipts.find((item) => item.approvalId === approvalId);
      if (approval.status !== 'pending') {
        if (approval.status !== review.decision || approval.note !== review.note) {
          throw new WorkflowStoreConflictError('Approval has already been reviewed.');
        }
        if (!review.receiptContext) {
          if (existingReceipt) {
            throw new WorkflowStoreConflictError('Approval review receipt context mismatch.');
          }
          return approval;
        }
        if (
          !existingReceipt
          || !approval.reviewedAt
          || !receiptMatchesReview(
            existingReceipt,
            workflowId,
            approvalId,
            approval.reviewedAt,
            review,
          )
        ) {
          throw new WorkflowStoreConflictError('Approval review receipt context mismatch.');
        }
        return approval;
      }

      const job = requireJob(workflow, approval.jobId);
      if (job.status !== 'awaiting_approval') {
        throw new WorkflowStoreConflictError('The approval job is not awaiting review.');
      }
      if (existingReceipt) {
        throw new WorkflowStoreConflictError('Pending approval already has an audit receipt.');
      }
      if (review.receiptContext) {
        if (review.receiptContext.manifestDigest !== approval.digest) {
          throw new WorkflowStoreConflictError('Receipt manifest digest mismatch.');
        }
        const receiptWithSameId = state.receipts.find(
          (item) => item.id === review.receiptContext!.id,
        );
        if (receiptWithSameId) {
          throw new WorkflowStoreConflictError(
            `Receipt '${review.receiptContext.id}' already exists.`,
          );
        }
      }
      approval.status = review.decision;
      approval.note = review.note;
      approval.revision += 1;
      approval.reviewedAt = timestamp;

      if (review.decision === 'approved') {
        job.status = 'completed';
        job.lastError = null;
        job.completedAt = timestamp;
        job.updatedAt = timestamp;
      } else {
        blockJobAndDependents(
          workflow,
          job.id,
          review.note ?? 'Approval rejected.',
          timestamp,
        );
      }
      if (review.receiptContext) {
        const receiptFields: Omit<WorkflowAuditReceipt, 'receiptDigest'> = {
          id: review.receiptContext.id,
          workflowId,
          approvalId,
          manifestDigest: review.receiptContext.manifestDigest,
          decision: review.decision,
          reviewerHash: review.receiptContext.reviewerHash,
          reviewedAt: timestamp,
          policyRevision: review.receiptContext.policyRevision,
          externalActionPerformed: false,
        };
        state.receipts.push({
          ...receiptFields,
          receiptDigest: workflowAuditReceiptDigest(receiptFields),
        });
      }
      touchWorkflow(workflow, timestamp);
      recomputeWorkflowStatus(workflow, timestamp);
      return approval;
    });
  }

  private readState(): WorkflowStoreSnapshot {
    const raw = this.settings.getSetting(this.storageKey);
    if (raw === null) return emptyState(this.workspaceHash, this.nowIso());

    try {
      const parsed: unknown = JSON.parse(raw);
      const normalized = normalizePersistedStateShape(parsed);
      validatePersistedState(normalized, this.workspaceHash);
      return normalized;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown validation error.';
      this.quarantine(raw, reason);
      throw new WorkflowStoreCorruptionError(
        `Workflow store data was quarantined: ${reason}`,
      );
    }
  }

  private mutate<T>(operation: (state: WorkflowStoreSnapshot) => T): T {
    const state = this.readState();
    const before = JSON.stringify(state);
    const result = operation(state);
    if (JSON.stringify(state) !== before) {
      state.revision += 1;
      state.updatedAt = this.nowIso();
      validatePersistedState(state, this.workspaceHash);
      this.settings.setSetting(this.storageKey, JSON.stringify(state));
    }
    return clone(result);
  }

  private quarantine(raw: string, reason: string): void {
    const record = JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      quarantinedAt: this.nowIso(),
      digest: workflowArtifactSha256(raw),
      reason,
      raw,
    });
    try {
      this.settings.setSetting(this.quarantineKey, record);
      this.settings.deleteSetting(this.storageKey);
    } catch {
      // Preserve fail-closed behavior even if the backing settings store is unavailable.
    }
  }

  private retryDelayForAttempt(attempts: number): number {
    return Math.min(
      this.maxRetryDelayMs,
      this.retryBaseDelayMs * (2 ** Math.max(0, attempts - 1)),
    );
  }

  private nowMs(): number {
    const value = this.nowProvider();
    const milliseconds = value instanceof Date ? value.getTime() : value;
    if (!Number.isFinite(milliseconds)) {
      throw new WorkflowStoreValidationError('Clock returned an invalid time.');
    }
    return milliseconds;
  }

  private nowIso(): string {
    return new Date(this.nowMs()).toISOString();
  }
}

function emptyState(workspaceHash: string, timestamp: string): WorkflowStoreSnapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    workspaceHash,
    revision: 0,
    workflows: [],
    artifacts: [],
    approvals: [],
    receipts: [],
    updatedAt: timestamp,
  };
}

function normalizePersistedStateShape(value: unknown): unknown {
  assertRecord(value, 'Persisted workflow store');
  assertOnlyKeys(
    value,
    [
      'schemaVersion',
      'workspaceHash',
      'revision',
      'workflows',
      'artifacts',
      'approvals',
      'receipts',
      'updatedAt',
    ],
    'Persisted workflow store',
  );
  if (Object.prototype.hasOwnProperty.call(value, 'receipts')) return value;
  return { ...value, receipts: [] };
}

function normalizeWorkflowInput(input: CreateWorkflowInput): {
  id: string;
  jobs: Array<{ id: string; dependsOn: string[]; maxAttempts: number }>;
} {
  assertRecord(input, 'Workflow input');
  assertOnlyKeys(input, ['id', 'jobs'], 'Workflow input');
  assertIdentifier(input.id, 'Workflow id');
  if (!Array.isArray(input.jobs) || input.jobs.length === 0) {
    throw new WorkflowStoreValidationError('Workflow jobs must be a non-empty array.');
  }

  const jobs = input.jobs.map((job, index) => {
    assertRecord(job, `Job ${index + 1}`);
    assertOnlyKeys(job, ['id', 'dependsOn', 'maxAttempts'], `Job '${String(job.id)}'`);
    assertIdentifier(job.id, `Job ${index + 1} id`);
    const dependsOn = job.dependsOn === undefined ? [] : stringArray(job.dependsOn, 'Dependencies');
    const maxAttempts = positiveInteger(
      job.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      `Job '${job.id}' maxAttempts`,
    );
    if (maxAttempts > 100) {
      throw new WorkflowStoreValidationError('Job maxAttempts cannot exceed 100.');
    }
    return { id: job.id, dependsOn, maxAttempts };
  });
  validateDag(jobs);
  return { id: input.id, jobs };
}

function normalizeArtifactInput(input: ArtifactInput): Required<ArtifactInput> {
  assertRecord(input, 'Artifact input');
  assertOnlyKeys(input, ['id', 'content', 'mediaType'], 'Artifact input');
  assertIdentifier(input.id, 'Artifact id');
  assertArtifactContent(input.content);
  const mediaType = input.mediaType ?? 'text/plain';
  assertNonEmptyString(mediaType, 'Artifact media type');
  if (mediaType.length > 128) {
    throw new WorkflowStoreValidationError('Artifact media type is too long.');
  }
  return { id: input.id, content: input.content, mediaType };
}

function normalizeArtifactRevision(input: ReviseArtifactInput): ReviseArtifactInput {
  assertRecord(input, 'Artifact revision');
  assertOnlyKeys(input, ['content', 'mediaType'], 'Artifact revision');
  assertArtifactContent(input.content);
  if (input.mediaType !== undefined) {
    assertNonEmptyString(input.mediaType, 'Artifact media type');
    if (input.mediaType.length > 128) {
      throw new WorkflowStoreValidationError('Artifact media type is too long.');
    }
  }
  return { content: input.content, ...(input.mediaType ? { mediaType: input.mediaType } : {}) };
}

function normalizeApprovalRequest(input: RequestApprovalInput): RequestApprovalInput {
  assertRecord(input, 'Approval request');
  assertOnlyKeys(input, ['id', 'artifactId', 'digest'], 'Approval request');
  assertIdentifier(input.id, 'Approval id');
  assertIdentifier(input.artifactId, 'Approval artifact id');
  assertDigest(input.digest, 'Approval digest');
  return { id: input.id, artifactId: input.artifactId, digest: input.digest };
}

function normalizeApprovalReview(input: ReviewApprovalInput): {
  decision: WorkflowApprovalDecision;
  digest: string;
  note: string | null;
  receiptContext?: WorkflowApprovalReceiptContext;
} {
  assertRecord(input, 'Approval review');
  assertOnlyKeys(input, ['decision', 'digest', 'note', 'receiptContext'], 'Approval review');
  if (input.decision !== 'approved' && input.decision !== 'rejected') {
    throw new WorkflowStoreValidationError('Approval decision must be approved or rejected.');
  }
  assertDigest(input.digest, 'Approval digest');
  if (input.note !== undefined && typeof input.note !== 'string') {
    throw new WorkflowStoreValidationError('Approval note must be a string.');
  }
  if (input.note && input.note.length > 4_000) {
    throw new WorkflowStoreValidationError('Approval note is too long.');
  }
  const receiptContext = input.receiptContext === undefined
    ? undefined
    : normalizeReceiptContext(input.receiptContext);
  return {
    decision: input.decision,
    digest: input.digest,
    note: input.note ?? null,
    ...(receiptContext ? { receiptContext } : {}),
  };
}

function normalizeReceiptContext(value: unknown): WorkflowApprovalReceiptContext {
  assertRecord(value, 'Approval receipt context');
  assertOnlyKeys(
    value,
    ['id', 'manifestDigest', 'reviewerHash', 'policyRevision', 'externalActionPerformed'],
    'Approval receipt context',
  );
  assertIdentifier(value.id, 'Receipt id');
  assertDigest(value.manifestDigest, 'Receipt manifest digest');
  assertDigest(value.reviewerHash, 'Receipt reviewer hash');
  if (value.policyRevision !== 'cmr-306.v1') {
    throw new WorkflowStoreValidationError('Receipt policy revision must be cmr-306.v1.');
  }
  if (value.externalActionPerformed !== false) {
    throw new WorkflowStoreValidationError(
      'Receipt externalActionPerformed must be false.',
    );
  }
  return {
    id: value.id,
    manifestDigest: value.manifestDigest,
    reviewerHash: value.reviewerHash,
    policyRevision: value.policyRevision,
    externalActionPerformed: false,
  };
}

function receiptMatchesReview(
  receipt: WorkflowAuditReceipt,
  workflowId: string,
  approvalId: string,
  reviewedAt: string,
  review: {
    decision: WorkflowApprovalDecision;
    receiptContext?: WorkflowApprovalReceiptContext;
  },
): boolean {
  const context = review.receiptContext;
  if (!context) return false;
  const expectedFields: Omit<WorkflowAuditReceipt, 'receiptDigest'> = {
    id: context.id,
    workflowId,
    approvalId,
    manifestDigest: context.manifestDigest,
    decision: review.decision,
    reviewerHash: context.reviewerHash,
    reviewedAt,
    policyRevision: context.policyRevision,
    externalActionPerformed: false,
  };
  return receipt.id === expectedFields.id
    && receipt.workflowId === expectedFields.workflowId
    && receipt.approvalId === expectedFields.approvalId
    && receipt.manifestDigest === expectedFields.manifestDigest
    && receipt.decision === expectedFields.decision
    && receipt.reviewerHash === expectedFields.reviewerHash
    && receipt.reviewedAt === expectedFields.reviewedAt
    && receipt.policyRevision === expectedFields.policyRevision
    && receipt.externalActionPerformed === false
    && receipt.receiptDigest === workflowAuditReceiptDigest(expectedFields);
}

function addArtifact(
  state: WorkflowStoreSnapshot,
  workflowId: string,
  jobId: string,
  purpose: WorkflowArtifactPurpose,
  input: Required<ArtifactInput>,
  timestamp: string,
): { artifact: WorkflowArtifact; created: boolean } {
  const existing = state.artifacts.find((artifact) => artifact.id === input.id);
  if (existing) {
    if (
      existing.workflowId === workflowId
      && existing.jobId === jobId
      && existing.purpose === purpose
      && existing.content === input.content
      && existing.mediaType === input.mediaType
    ) {
      return { artifact: existing, created: false };
    }
    throw new WorkflowStoreConflictError(`Artifact '${input.id}' already exists.`);
  }

  const artifact: WorkflowArtifact = {
    id: input.id,
    workflowId,
    jobId,
    purpose,
    content: input.content,
    mediaType: input.mediaType,
    sha256: workflowArtifactSha256(input.content),
    revision: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  state.artifacts.push(artifact);
  return { artifact, created: true };
}

function requireWorkflow(
  state: WorkflowStoreSnapshot,
  workflowId: string,
): CustomerMarketingWorkflow {
  const workflow = state.workflows.find((item) => item.id === workflowId);
  if (!workflow) throw new WorkflowStoreConflictError(`Workflow '${workflowId}' was not found.`);
  return workflow;
}

function requireJob(workflow: CustomerMarketingWorkflow, jobId: string): WorkflowJob {
  const job = workflow.jobs.find((item) => item.id === jobId);
  if (!job) throw new WorkflowStoreConflictError(`Job '${jobId}' was not found.`);
  return job;
}

function requireLease(job: WorkflowJob, leaseToken: string, now: number): void {
  if (job.status !== 'running' || !job.lease || job.lease.token !== leaseToken) {
    throw new WorkflowStoreConflictError('Job lease is missing, stale, or owned by another claimant.');
  }
  if (Date.parse(job.lease.expiresAt) <= now) {
    throw new WorkflowStoreConflictError('Job lease has expired.');
  }
}

function blockJobAndDependents(
  workflow: CustomerMarketingWorkflow,
  rootJobId: string,
  reason: string,
  timestamp: string,
): void {
  const blockedIds = new Set([rootJobId]);
  let added = true;
  while (added) {
    added = false;
    for (const job of workflow.jobs) {
      if (!blockedIds.has(job.id) && job.dependsOn.some((dependency) => blockedIds.has(dependency))) {
        blockedIds.add(job.id);
        added = true;
      }
    }
  }

  for (const job of workflow.jobs) {
    if (!blockedIds.has(job.id) || job.status === 'completed') continue;
    job.status = 'blocked';
    job.lease = null;
    job.nextAttemptAt = null;
    job.lastError = job.id === rootJobId ? reason : `Blocked by dependency '${rootJobId}'.`;
    job.updatedAt = timestamp;
  }
}

function touchWorkflow(workflow: CustomerMarketingWorkflow, timestamp: string): void {
  workflow.revision += 1;
  workflow.updatedAt = timestamp;
}

function recomputeWorkflowStatus(
  workflow: CustomerMarketingWorkflow,
  timestamp: string,
): void {
  workflow.status = derivedWorkflowStatus(workflow.jobs);
  if (workflow.status === 'completed') {
    workflow.completedAt ??= timestamp;
  } else {
    workflow.completedAt = null;
  }
}

function derivedWorkflowStatus(jobs: readonly WorkflowJob[]): WorkflowStatus {
  if (jobs.every((job) => job.status === 'completed')) return 'completed';
  if (jobs.some((job) => job.status === 'blocked')) return 'blocked';
  if (jobs.some((job) => job.status === 'awaiting_approval')) return 'awaiting_approval';
  if (jobs.some((job) => job.status === 'running')) return 'running';
  return 'pending';
}

function validateDag(jobs: readonly { id: string; dependsOn: readonly string[] }[]): void {
  const ids = new Set<string>();
  for (const job of jobs) {
    if (ids.has(job.id)) {
      throw new WorkflowStoreValidationError(`Duplicate job id '${job.id}'.`);
    }
    ids.add(job.id);
  }
  for (const job of jobs) {
    const seenDependencies = new Set<string>();
    for (const dependency of job.dependsOn) {
      if (!ids.has(dependency)) {
        throw new WorkflowStoreValidationError(
          `Job '${job.id}' has missing dependency '${dependency}'.`,
        );
      }
      if (seenDependencies.has(dependency)) {
        throw new WorkflowStoreValidationError(
          `Job '${job.id}' has duplicate dependency '${dependency}'.`,
        );
      }
      seenDependencies.add(dependency);
    }
  }

  const byId = new Map(jobs.map((job) => [job.id, job]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (jobId: string): void => {
    if (visiting.has(jobId)) {
      throw new WorkflowStoreValidationError('Workflow dependency cycle detected.');
    }
    if (visited.has(jobId)) return;
    visiting.add(jobId);
    for (const dependency of byId.get(jobId)?.dependsOn ?? []) visit(dependency);
    visiting.delete(jobId);
    visited.add(jobId);
  };
  for (const job of jobs) visit(job.id);
}

function validatePersistedState(
  value: unknown,
  expectedWorkspaceHash: string,
): asserts value is WorkflowStoreSnapshot {
  assertRecord(value, 'Persisted workflow store');
  assertOnlyKeys(
    value,
    [
      'schemaVersion',
      'workspaceHash',
      'revision',
      'workflows',
      'artifacts',
      'approvals',
      'receipts',
      'updatedAt',
    ],
    'Persisted workflow store',
  );
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new WorkflowStoreValidationError('Unsupported workflow store schema version.');
  }
  if (value.workspaceHash !== expectedWorkspaceHash) {
    throw new WorkflowStoreValidationError('Persisted workflow workspace hash mismatch.');
  }
  nonNegativeInteger(value.revision, 'Persisted revision');
  assertIsoDate(value.updatedAt, 'Persisted updatedAt');
  if (
    !Array.isArray(value.workflows)
    || !Array.isArray(value.artifacts)
    || !Array.isArray(value.approvals)
    || !Array.isArray(value.receipts)
  ) {
    throw new WorkflowStoreValidationError('Persisted workflow collections must be arrays.');
  }

  const workflowIds = new Set<string>();
  const jobsByKey = new Map<string, WorkflowJob>();
  for (const workflow of value.workflows) {
    validatePersistedWorkflow(workflow);
    if (workflowIds.has(workflow.id)) {
      throw new WorkflowStoreValidationError(`Duplicate persisted workflow '${workflow.id}'.`);
    }
    workflowIds.add(workflow.id);
    for (const job of workflow.jobs) {
      const key = jobKey(workflow.id, job.id);
      jobsByKey.set(key, job);
    }
  }

  const artifactsById = new Map<string, WorkflowArtifact>();
  for (const artifact of value.artifacts) {
    validatePersistedArtifact(artifact);
    if (artifactsById.has(artifact.id)) {
      throw new WorkflowStoreValidationError(`Duplicate persisted artifact '${artifact.id}'.`);
    }
    const owner = jobsByKey.get(jobKey(artifact.workflowId, artifact.jobId));
    if (!owner || !owner.artifactIds.includes(artifact.id)) {
      throw new WorkflowStoreValidationError(`Artifact '${artifact.id}' references a missing job.`);
    }
    artifactsById.set(artifact.id, artifact);
  }

  const approvalsById = new Map<string, WorkflowApproval>();
  for (const approval of value.approvals) {
    validatePersistedApproval(approval);
    if (approvalsById.has(approval.id)) {
      throw new WorkflowStoreValidationError(`Duplicate persisted approval '${approval.id}'.`);
    }
    const artifact = artifactsById.get(approval.artifactId);
    if (
      !artifact
      || artifact.workflowId !== approval.workflowId
      || artifact.jobId !== approval.jobId
      || artifact.purpose !== 'approval'
      || artifact.sha256 !== approval.digest
    ) {
      throw new WorkflowStoreValidationError(`Approval '${approval.id}' has an invalid artifact binding.`);
    }
    const owner = jobsByKey.get(jobKey(approval.workflowId, approval.jobId));
    if (!owner || !owner.approvalIds.includes(approval.id)) {
      throw new WorkflowStoreValidationError(`Approval '${approval.id}' references a missing job.`);
    }
    approvalsById.set(approval.id, approval);
  }

  const receiptIds = new Set<string>();
  const receiptApprovalIds = new Set<string>();
  for (const receipt of value.receipts) {
    validatePersistedReceipt(receipt);
    if (receiptIds.has(receipt.id)) {
      throw new WorkflowStoreValidationError(`Duplicate persisted receipt '${receipt.id}'.`);
    }
    if (receiptApprovalIds.has(receipt.approvalId)) {
      throw new WorkflowStoreValidationError(
        `Approval '${receipt.approvalId}' has duplicate audit receipts.`,
      );
    }
    const approval = approvalsById.get(receipt.approvalId);
    if (
      !approval
      || approval.workflowId !== receipt.workflowId
      || approval.status === 'pending'
      || approval.status !== receipt.decision
      || approval.digest !== receipt.manifestDigest
      || approval.reviewedAt !== receipt.reviewedAt
    ) {
      throw new WorkflowStoreValidationError(
        `Receipt '${receipt.id}' has an invalid approval binding.`,
      );
    }
    receiptIds.add(receipt.id);
    receiptApprovalIds.add(receipt.approvalId);
  }

  for (const [key, job] of jobsByKey) {
    const [workflowId] = key.split('\u0000');
    for (const artifactId of job.artifactIds) {
      const artifact = artifactsById.get(artifactId);
      if (!artifact || artifact.workflowId !== workflowId || artifact.jobId !== job.id) {
        throw new WorkflowStoreValidationError(`Job '${job.id}' has an invalid artifact reference.`);
      }
    }
    for (const approvalId of job.approvalIds) {
      const approval = approvalsById.get(approvalId);
      if (!approval || approval.workflowId !== workflowId || approval.jobId !== job.id) {
        throw new WorkflowStoreValidationError(`Job '${job.id}' has an invalid approval reference.`);
      }
    }
    if (job.status === 'awaiting_approval') {
      const pending = job.approvalIds.filter((id) => approvalsById.get(id)?.status === 'pending');
      if (pending.length !== 1) {
        throw new WorkflowStoreValidationError(
          `Job '${job.id}' must have exactly one pending approval.`,
        );
      }
    }
  }
}

function validatePersistedWorkflow(value: unknown): asserts value is CustomerMarketingWorkflow {
  assertRecord(value, 'Persisted workflow');
  assertOnlyKeys(
    value,
    ['id', 'status', 'jobs', 'revision', 'createdAt', 'updatedAt', 'completedAt'],
    'Persisted workflow',
  );
  assertIdentifier(value.id, 'Persisted workflow id');
  if (!isWorkflowStatus(value.status)) {
    throw new WorkflowStoreValidationError(`Workflow '${value.id}' has an invalid status.`);
  }
  positiveInteger(value.revision, `Workflow '${value.id}' revision`);
  assertIsoDate(value.createdAt, `Workflow '${value.id}' createdAt`);
  assertIsoDate(value.updatedAt, `Workflow '${value.id}' updatedAt`);
  if (value.completedAt !== null) assertIsoDate(value.completedAt, 'Workflow completedAt');
  if (!Array.isArray(value.jobs) || value.jobs.length === 0) {
    throw new WorkflowStoreValidationError(`Workflow '${value.id}' must contain jobs.`);
  }
  for (const job of value.jobs) validatePersistedJob(job);
  validateDag(value.jobs);
  if (derivedWorkflowStatus(value.jobs) !== value.status) {
    throw new WorkflowStoreValidationError(`Workflow '${value.id}' status is inconsistent with its jobs.`);
  }
  if ((value.status === 'completed') !== (value.completedAt !== null)) {
    throw new WorkflowStoreValidationError(`Workflow '${value.id}' completion time is inconsistent.`);
  }
}

function validatePersistedJob(value: unknown): asserts value is WorkflowJob {
  assertRecord(value, 'Persisted job');
  assertOnlyKeys(
    value,
    [
      'id',
      'dependsOn',
      'status',
      'attempts',
      'maxAttempts',
      'nextAttemptAt',
      'lease',
      'lastError',
      'artifactIds',
      'approvalIds',
      'createdAt',
      'updatedAt',
      'completedAt',
    ],
    'Persisted job',
  );
  assertIdentifier(value.id, 'Persisted job id');
  if (!isJobStatus(value.status)) {
    throw new WorkflowStoreValidationError(`Job '${value.id}' has an invalid status.`);
  }
  const attempts = nonNegativeInteger(value.attempts, `Job '${value.id}' attempts`);
  const maxAttempts = positiveInteger(value.maxAttempts, `Job '${value.id}' maxAttempts`);
  if (maxAttempts > 100 || attempts > maxAttempts) {
    throw new WorkflowStoreValidationError(`Job '${value.id}' has invalid attempts.`);
  }
  stringArray(value.dependsOn, `Job '${value.id}' dependencies`);
  const artifactIds = stringArray(value.artifactIds, `Job '${value.id}' artifact ids`);
  const approvalIds = stringArray(value.approvalIds, `Job '${value.id}' approval ids`);
  assertUnique(artifactIds, `Job '${value.id}' artifact ids`);
  assertUnique(approvalIds, `Job '${value.id}' approval ids`);
  assertIsoDate(value.createdAt, `Job '${value.id}' createdAt`);
  assertIsoDate(value.updatedAt, `Job '${value.id}' updatedAt`);
  if (value.lastError !== null && typeof value.lastError !== 'string') {
    throw new WorkflowStoreValidationError(`Job '${value.id}' has an invalid last error.`);
  }
  if (value.status === 'running') {
    validateLease(value.lease);
  } else if (value.lease !== null) {
    throw new WorkflowStoreValidationError(`Job '${value.id}' has a lease while not running.`);
  }
  if (value.status === 'retry_scheduled') {
    assertIsoDate(value.nextAttemptAt, `Job '${value.id}' nextAttemptAt`);
  } else if (value.nextAttemptAt !== null) {
    throw new WorkflowStoreValidationError(`Job '${value.id}' has an unexpected retry time.`);
  }
  if (value.status === 'completed') {
    assertIsoDate(value.completedAt, `Job '${value.id}' completedAt`);
  } else if (value.completedAt !== null) {
    throw new WorkflowStoreValidationError(`Job '${value.id}' has an unexpected completion time.`);
  }
  if (
    attempts >= maxAttempts
    && (value.status === 'pending' || value.status === 'retry_scheduled')
  ) {
    throw new WorkflowStoreValidationError(`Job '${value.id}' exhausted its attempts without blocking.`);
  }
}

function validateLease(value: unknown): asserts value is WorkflowLease {
  assertRecord(value, 'Persisted lease');
  assertOnlyKeys(value, ['token', 'workerId', 'claimedAt', 'expiresAt'], 'Persisted lease');
  assertIdentifier(value.token, 'Persisted lease token');
  assertIdentifier(value.workerId, 'Persisted lease worker id');
  assertIsoDate(value.claimedAt, 'Persisted lease claimedAt');
  assertIsoDate(value.expiresAt, 'Persisted lease expiresAt');
  if (Date.parse(value.expiresAt) <= Date.parse(value.claimedAt)) {
    throw new WorkflowStoreValidationError('Persisted lease expiry must follow its claim time.');
  }
}

function validatePersistedArtifact(value: unknown): asserts value is WorkflowArtifact {
  assertRecord(value, 'Persisted artifact');
  assertOnlyKeys(
    value,
    [
      'id',
      'workflowId',
      'jobId',
      'purpose',
      'content',
      'mediaType',
      'sha256',
      'revision',
      'createdAt',
      'updatedAt',
    ],
    'Persisted artifact',
  );
  assertIdentifier(value.id, 'Persisted artifact id');
  assertIdentifier(value.workflowId, 'Persisted artifact workflow id');
  assertIdentifier(value.jobId, 'Persisted artifact job id');
  if (value.purpose !== 'job_output' && value.purpose !== 'approval') {
    throw new WorkflowStoreValidationError(`Artifact '${value.id}' has an invalid purpose.`);
  }
  assertArtifactContent(value.content);
  assertNonEmptyString(value.mediaType, 'Persisted artifact media type');
  assertDigest(value.sha256, 'Persisted artifact digest');
  if (value.mediaType.length > 128) {
    throw new WorkflowStoreValidationError(`Artifact '${value.id}' media type is too long.`);
  }
  if (workflowArtifactSha256(value.content) !== value.sha256) {
    throw new WorkflowStoreValidationError(`Artifact '${value.id}' digest mismatch.`);
  }
  positiveInteger(value.revision, `Artifact '${value.id}' revision`);
  assertIsoDate(value.createdAt, `Artifact '${value.id}' createdAt`);
  assertIsoDate(value.updatedAt, `Artifact '${value.id}' updatedAt`);
}

function validatePersistedApproval(value: unknown): asserts value is WorkflowApproval {
  assertRecord(value, 'Persisted approval');
  assertOnlyKeys(
    value,
    [
      'id',
      'workflowId',
      'jobId',
      'artifactId',
      'digest',
      'status',
      'note',
      'revision',
      'requestedAt',
      'reviewedAt',
    ],
    'Persisted approval',
  );
  assertIdentifier(value.id, 'Persisted approval id');
  assertIdentifier(value.workflowId, 'Persisted approval workflow id');
  assertIdentifier(value.jobId, 'Persisted approval job id');
  assertIdentifier(value.artifactId, 'Persisted approval artifact id');
  assertDigest(value.digest, 'Persisted approval digest');
  if (value.status !== 'pending' && value.status !== 'approved' && value.status !== 'rejected') {
    throw new WorkflowStoreValidationError(`Approval '${value.id}' has an invalid status.`);
  }
  if (value.note !== null && typeof value.note !== 'string') {
    throw new WorkflowStoreValidationError(`Approval '${value.id}' has an invalid note.`);
  }
  positiveInteger(value.revision, `Approval '${value.id}' revision`);
  if (value.note && value.note.length > 4_000) {
    throw new WorkflowStoreValidationError(`Approval '${value.id}' note is too long.`);
  }
  assertIsoDate(value.requestedAt, `Approval '${value.id}' requestedAt`);
  if (value.status === 'pending') {
    if (value.reviewedAt !== null) {
      throw new WorkflowStoreValidationError(`Pending approval '${value.id}' has a review time.`);
    }
  } else {
    assertIsoDate(value.reviewedAt, `Approval '${value.id}' reviewedAt`);
  }
}

function validatePersistedReceipt(value: unknown): asserts value is WorkflowAuditReceipt {
  assertRecord(value, 'Persisted audit receipt');
  assertOnlyKeys(
    value,
    [
      'id',
      'workflowId',
      'approvalId',
      'manifestDigest',
      'decision',
      'reviewerHash',
      'reviewedAt',
      'policyRevision',
      'externalActionPerformed',
      'receiptDigest',
    ],
    'Persisted audit receipt',
  );
  assertIdentifier(value.id, 'Persisted receipt id');
  assertIdentifier(value.workflowId, 'Persisted receipt workflow id');
  assertIdentifier(value.approvalId, 'Persisted receipt approval id');
  assertDigest(value.manifestDigest, 'Persisted receipt manifest digest');
  if (value.decision !== 'approved' && value.decision !== 'rejected') {
    throw new WorkflowStoreValidationError(`Receipt '${value.id}' has an invalid decision.`);
  }
  assertDigest(value.reviewerHash, 'Persisted receipt reviewer hash');
  assertIsoDate(value.reviewedAt, 'Persisted receipt reviewedAt');
  if (value.policyRevision !== 'cmr-306.v1') {
    throw new WorkflowStoreValidationError(`Receipt '${value.id}' has an invalid policy revision.`);
  }
  if (value.externalActionPerformed !== false) {
    throw new WorkflowStoreValidationError(
      `Receipt '${value.id}' records an external action.`,
    );
  }
  assertDigest(value.receiptDigest, 'Persisted receipt digest');
  const fields: Omit<WorkflowAuditReceipt, 'receiptDigest'> = {
    id: value.id,
    workflowId: value.workflowId,
    approvalId: value.approvalId,
    manifestDigest: value.manifestDigest,
    decision: value.decision,
    reviewerHash: value.reviewerHash,
    reviewedAt: value.reviewedAt,
    policyRevision: value.policyRevision,
    externalActionPerformed: false,
  };
  if (workflowAuditReceiptDigest(fields) !== value.receiptDigest) {
    throw new WorkflowStoreValidationError(`Receipt '${value.id}' digest mismatch.`);
  }
}

function assertSettings(value: unknown): asserts value is WorkflowSettings {
  if (
    !value
    || typeof value !== 'object'
    || typeof (value as WorkflowSettings).getSetting !== 'function'
    || typeof (value as WorkflowSettings).setSetting !== 'function'
    || typeof (value as WorkflowSettings).deleteSetting !== 'function'
  ) {
    throw new WorkflowStoreValidationError(
      'Settings must provide getSetting, setSetting, and deleteSetting.',
    );
  }
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorkflowStoreValidationError(`${label} must be an object.`);
  }
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  const unsupported = Object.keys(value).find((key) => !allowedKeys.has(key));
  if (unsupported) {
    throw new WorkflowStoreValidationError(`${label} contains unsupported field '${unsupported}'.`);
  }
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  assertNonEmptyString(value, label);
  if (value.length > MAX_ID_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new WorkflowStoreValidationError(`${label} is invalid.`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new WorkflowStoreValidationError(`${label} must be a non-empty trimmed string.`);
  }
}

function assertArtifactContent(value: unknown): asserts value is string {
  if (typeof value !== 'string') {
    throw new WorkflowStoreValidationError('Artifact content must be a string.');
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_ARTIFACT_BYTES) {
    throw new WorkflowStoreValidationError('Artifact content exceeds the local storage limit.');
  }
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new WorkflowStoreValidationError(`${label} must be a lowercase SHA-256 digest.`);
  }
}

function assertIsoDate(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string'
    || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value
  ) {
    throw new WorkflowStoreValidationError(`${label} must be an ISO timestamp.`);
  }
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new WorkflowStoreValidationError(`${label} must be an array.`);
  }
  const result = value.map((item, index) => {
    assertIdentifier(item, `${label} item ${index + 1}`);
    return item;
  });
  assertUnique(result, label);
  return result;
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new WorkflowStoreValidationError(`${label} must not contain duplicates.`);
  }
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new WorkflowStoreValidationError(`${label} must be a positive integer.`);
  }
  return value as number;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new WorkflowStoreValidationError(`${label} must be a non-negative integer.`);
  }
  return value as number;
}

function isWorkflowStatus(value: unknown): value is WorkflowStatus {
  return value === 'pending'
    || value === 'running'
    || value === 'awaiting_approval'
    || value === 'completed'
    || value === 'blocked';
}

function isJobStatus(value: unknown): value is WorkflowJobStatus {
  return value === 'pending'
    || value === 'running'
    || value === 'retry_scheduled'
    || value === 'awaiting_approval'
    || value === 'completed'
    || value === 'blocked';
}

function jobKey(workflowId: string, jobId: string): string {
  return `${workflowId}\u0000${jobId}`;
}

function clone<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value)) as T;
}
