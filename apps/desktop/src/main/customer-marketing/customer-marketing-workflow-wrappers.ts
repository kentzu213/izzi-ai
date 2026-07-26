import { createHash, randomUUID } from 'node:crypto';
import type {
  CustomerMarketingPersistedResourceRef,
  CustomerMarketingWorkflowAllowedOperation,
  CustomerMarketingWorkflowManifestV1,
  CustomerMarketingWorkflowPrepareInput,
  CustomerMarketingWorkflowPrepareRequest,
  CustomerMarketingWorkflowRecord,
  CustomerMarketingWorkflowReviewInput,
  CustomerMarketingWorkflowReviewRequest,
  CustomerMarketingWorkflowTarget,
} from '../../shared/customer-marketing-types';
import {
  CustomerMarketingWorkflowStore,
  WorkflowStoreConflictError,
  WorkflowStoreValidationError,
  workflowArtifactSha256,
  type CustomerMarketingWorkflow,
  type WorkflowApproval,
} from './customer-marketing-workflow-store';

const POLICY_REVISION = 'cmr-306.v1' as const;
const DEFAULT_APPROVAL_TTL_MS = 30 * 60 * 1_000;
const MAX_APPROVAL_TTL_MS = 24 * 60 * 60 * 1_000;
const WORKFLOW_JOB_IDS = ['validate', 'dry_run', 'approval'] as const;
const ALLOWED_OPERATIONS = ['read', 'draft', 'validate'] as const;
const HARD_DENIED_OPERATIONS = new Set([
  'publish',
  'send',
  'bulk',
  'spend',
  'integration.write',
  'contacts.write',
]);
const TARGETS = ['social', 'seo', 'email', 'crm'] as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const TARGET_CONFIG = {
  social: {
    sourceKind: 'content',
    label: 'Social',
    steps: [
      'Read the approved content revision.',
      'Draft one channel-scoped social manifest.',
      'Validate the local draft and scoped grant.',
    ],
  },
  seo: {
    sourceKind: 'content',
    label: 'SEO',
    steps: [
      'Read the approved content revision.',
      'Draft one search-workflow manifest.',
      'Validate the local brief and scoped grant.',
    ],
  },
  email: {
    sourceKind: 'content',
    label: 'Email',
    steps: [
      'Read the approved content revision.',
      'Draft one recipient-free email manifest.',
      'Validate the local draft and scoped grant.',
    ],
  },
  crm: {
    sourceKind: 'campaign',
    label: 'CRM',
    steps: [
      'Read the approved campaign revision.',
      'Draft one record-free CRM manifest.',
      'Validate the local plan and scoped grant.',
    ],
  },
} as const satisfies Record<CustomerMarketingWorkflowTarget, {
  sourceKind: CustomerMarketingPersistedResourceRef['kind'];
  label: string;
  steps: readonly string[];
}>;

const DRY_RUN_OUTPUTS = ['dry_run_manifest', 'approval_request', 'audit_receipt'] as const;
const DRY_RUN_WARNINGS = [
  'Local simulation only. No publish, delivery, spend, or external mutation is performed.',
] as const;

export interface CustomerMarketingWorkflowWrapperOptions {
  now?: () => number | Date;
  createId?: () => string;
  approvalTtlMs?: number;
}

export interface CustomerMarketingWorkflowWrapper<
  TTarget extends CustomerMarketingWorkflowTarget = CustomerMarketingWorkflowTarget,
> {
  readonly target: TTarget;
  prepare(input: CustomerMarketingWorkflowPrepareInput<TTarget>): CustomerMarketingWorkflowRecord;
  list(): CustomerMarketingWorkflowRecord[];
  review(input: CustomerMarketingWorkflowReviewInput): CustomerMarketingWorkflowRecord;
}

export type CustomerMarketingWorkflowWrappers = {
  [TTarget in CustomerMarketingWorkflowTarget]: CustomerMarketingWorkflowWrapper<TTarget>;
};

export function parseCustomerMarketingWorkflowTarget(
  value: unknown,
): CustomerMarketingWorkflowTarget | null {
  return typeof value === 'string' && (TARGETS as readonly string[]).includes(value)
    ? value as CustomerMarketingWorkflowTarget
    : null;
}

export function parseCustomerMarketingWorkflowPrepareRequest(
  value: unknown,
): CustomerMarketingWorkflowPrepareRequest | null {
  if (!isPlainRecord(value) || !hasExactRequestKeys(
    value,
    ['target', 'resourceId', 'expectedRevision'],
    ['operations'],
  )) return null;
  const target = parseCustomerMarketingWorkflowTarget(value.target);
  if (
    !target
    || !isRequestIdentifier(value.resourceId)
    || typeof value.expectedRevision !== 'number'
    || !Number.isSafeInteger(value.expectedRevision)
    || value.expectedRevision < 0
  ) return null;
  let operations: CustomerMarketingWorkflowPrepareRequest['operations'];
  if (value.operations !== undefined) {
    if (!Array.isArray(value.operations) || value.operations.length === 0) return null;
    const known = new Set<string>([...ALLOWED_OPERATIONS, ...HARD_DENIED_OPERATIONS]);
    if (
      value.operations.some((operation) => typeof operation !== 'string' || !known.has(operation))
      || new Set(value.operations).size !== value.operations.length
    ) return null;
    operations = value.operations as CustomerMarketingWorkflowPrepareRequest['operations'];
  }
  return {
    target,
    resourceId: value.resourceId,
    expectedRevision: value.expectedRevision,
    ...(operations ? { operations } : {}),
  };
}

export function parseCustomerMarketingWorkflowReviewRequest(
  value: unknown,
): CustomerMarketingWorkflowReviewRequest | null {
  if (!isPlainRecord(value) || !hasExactRequestKeys(
    value,
    ['target', 'workflowId', 'approvalId', 'manifestDigest', 'decision'],
    ['note'],
  )) return null;
  const target = parseCustomerMarketingWorkflowTarget(value.target);
  if (
    !target
    || !isRequestIdentifier(value.workflowId)
    || !isRequestIdentifier(value.approvalId)
    || typeof value.manifestDigest !== 'string'
    || !SHA256_PATTERN.test(value.manifestDigest)
    || value.decision !== 'approved' && value.decision !== 'rejected'
    || value.note !== undefined && (typeof value.note !== 'string' || value.note.length > 4_000)
  ) return null;
  return {
    target,
    workflowId: value.workflowId,
    approvalId: value.approvalId,
    manifestDigest: value.manifestDigest,
    decision: value.decision,
    ...(value.note === undefined ? {} : { note: value.note }),
  };
}

export function createCustomerMarketingWorkflowWrappers(
  store: CustomerMarketingWorkflowStore,
  workspaceId: string,
  options: CustomerMarketingWorkflowWrapperOptions = {},
): CustomerMarketingWorkflowWrappers {
  assertTrimmedString(workspaceId, 'Workspace id');
  const workspaceHash = sha256(workspaceId);
  if (store.getWorkspaceHash() !== workspaceHash) {
    throw new WorkflowStoreValidationError('Workflow store workspace mismatch.');
  }

  const nowProvider = options.now ?? Date.now;
  const idProvider = options.createId ?? randomUUID;
  const approvalTtlMs = options.approvalTtlMs ?? DEFAULT_APPROVAL_TTL_MS;
  if (
    !Number.isSafeInteger(approvalTtlMs)
    || approvalTtlMs <= 0
    || approvalTtlMs > MAX_APPROVAL_TTL_MS
  ) {
    throw new WorkflowStoreValidationError(
      'Approval TTL must be a positive integer no greater than 24 hours.',
    );
  }

  const nowMs = (): number => {
    const value = nowProvider();
    const timestamp = value instanceof Date ? value.getTime() : value;
    if (!Number.isFinite(timestamp)) {
      throw new WorkflowStoreValidationError('Workflow clock returned an invalid time.');
    }
    return timestamp;
  };

  const createNonce = (label: string): string => {
    const nonce = idProvider();
    assertIdentifier(nonce, label);
    return nonce;
  };

  const readRecord = (
    target: CustomerMarketingWorkflowTarget,
    workflow: CustomerMarketingWorkflow,
  ): CustomerMarketingWorkflowRecord => {
    const prefix = workflowPrefix(target);
    if (!workflow.id.startsWith(prefix)) {
      throw new WorkflowStoreValidationError('Workflow target binding mismatch.');
    }
    assertWrapperJobs(workflow);

    const approvalJob = workflow.jobs[2];
    if (approvalJob.approvalIds.length !== 1) {
      throw new WorkflowStoreValidationError(
        `Workflow '${workflow.id}' must have exactly one approval request.`,
      );
    }
    const approvalId = approvalJob.approvalIds[0];
    const approval = store.getApproval(approvalId);
    if (!approval || approval.workflowId !== workflow.id || approval.jobId !== 'approval') {
      throw new WorkflowStoreValidationError(
        `Workflow '${workflow.id}' has an invalid approval binding.`,
      );
    }
    const artifact = store.getArtifact(approval.artifactId);
    if (
      !artifact
      || artifact.workflowId !== workflow.id
      || artifact.jobId !== 'approval'
      || artifact.purpose !== 'approval'
      || artifact.sha256 !== approval.digest
      || !artifact.id.endsWith('-manifest')
    ) {
      throw new WorkflowStoreValidationError(
        `Workflow '${workflow.id}' has an invalid manifest artifact.`,
      );
    }

    const manifest = parseManifest(artifact.content, target, workspaceHash);
    const manifestDigest = workflowArtifactSha256(artifact.content);
    if (manifestDigest !== approval.digest) {
      throw new WorkflowStoreValidationError(
        `Workflow '${workflow.id}' manifest digest mismatch.`,
      );
    }

    const receipt = store.getReceiptByApproval(approval.id);
    assertLifecycleBinding(workflow, approval, receipt !== null);
    if (receipt && (
      receipt.workflowId !== workflow.id
      || receipt.approvalId !== approval.id
      || receipt.manifestDigest !== manifestDigest
      || receipt.decision !== approval.status
      || receipt.policyRevision !== POLICY_REVISION
      || receipt.externalActionPerformed !== false
    )) {
      throw new WorkflowStoreValidationError(
        `Workflow '${workflow.id}' has an invalid audit receipt binding.`,
      );
    }

    return {
      workflowId: workflow.id,
      approvalId: approval.id,
      manifestDigest,
      status: approval.status,
      manifest,
      receipt,
    };
  };

  const list = (target: CustomerMarketingWorkflowTarget): CustomerMarketingWorkflowRecord[] => (
    store.listWorkflows()
      .filter((workflow) => workflow.id.startsWith(workflowPrefix(target)))
      .map((workflow) => readRecord(target, workflow))
  );

  const prepare = <TTarget extends CustomerMarketingWorkflowTarget>(
    target: TTarget,
    input: CustomerMarketingWorkflowPrepareInput<TTarget>,
  ): CustomerMarketingWorkflowRecord => {
    const normalized = normalizePrepareInput(target, workspaceId, input);
    const createdAtMs = nowMs();
    const createdAt = new Date(createdAtMs).toISOString();
    const nonce = createNonce('Workflow nonce');
    const workflowId = `${workflowPrefix(target)}${sha256(
      `${workspaceHash}:${target}:${normalized.inputRef.id}:${nonce}:${createdAt}`,
    ).slice(0, 24)}`;
    const approvalId = `${workflowId}-approval`;
    const artifactId = `${workflowId}-manifest`;
    const manifest: CustomerMarketingWorkflowManifestV1 = {
      kind: target,
      title: `${TARGET_CONFIG[target].label} dry-run: ${normalized.inputRef.title}`,
      workspaceHash,
      inputRef: {
        id: normalized.inputRef.id,
        kind: normalized.inputRef.kind,
        revision: normalized.inputRef.revision,
        sha256: normalized.inputRef.sha256,
      },
      grant: {
        operations: normalized.operations,
        channels: [target],
        limits: {
          maxItems: 1,
          maxRecipients: 0,
          maxSpendVnd: 0,
        },
        expiresAt: new Date(createdAtMs + approvalTtlMs).toISOString(),
        policyRevision: POLICY_REVISION,
      },
      dryRun: {
        steps: [...TARGET_CONFIG[target].steps],
        outputs: [...DRY_RUN_OUTPUTS],
        warnings: [...DRY_RUN_WARNINGS],
        externalActionPerformed: false,
      },
      nonce,
      createdAt,
    };
    const manifestContent = JSON.stringify(manifest);
    const manifestDigest = workflowArtifactSha256(manifestContent);

    store.createWorkflow({
      id: workflowId,
      jobs: [
        { id: 'validate' },
        { id: 'dry_run', dependsOn: ['validate'] },
        { id: 'approval', dependsOn: ['dry_run'] },
      ],
    });
    completeLocalJob(store, workflowId, 'validate', `${target}-wrapper`);
    completeLocalJob(store, workflowId, 'dry_run', `${target}-wrapper`);
    const approvalJob = store.claimNextJob(workflowId, { workerId: `${target}-wrapper` });
    if (!approvalJob || approvalJob.id !== 'approval' || !approvalJob.lease) {
      throw new WorkflowStoreConflictError('Approval job could not be claimed.');
    }
    const artifact = store.appendApprovalArtifact(
      workflowId,
      'approval',
      approvalJob.lease.token,
      {
        id: artifactId,
        content: manifestContent,
        mediaType: 'application/json',
      },
    );
    store.requestApproval(workflowId, 'approval', approvalJob.lease.token, {
      id: approvalId,
      artifactId: artifact.id,
      digest: manifestDigest,
    });

    const workflow = store.getWorkflow(workflowId);
    if (!workflow) throw new WorkflowStoreConflictError('Prepared workflow was not persisted.');
    return readRecord(target, workflow);
  };

  const review = (
    target: CustomerMarketingWorkflowTarget,
    input: CustomerMarketingWorkflowReviewInput,
  ): CustomerMarketingWorkflowRecord => {
    const normalized = normalizeReviewInput(input);
    const record = list(target).find((item) => item.workflowId === normalized.workflowId);
    if (!record) {
      throw new WorkflowStoreConflictError(
        `Workflow '${normalized.workflowId}' was not found for '${target}'.`,
      );
    }
    if (record.approvalId !== normalized.approvalId) {
      throw new WorkflowStoreConflictError('Approval binding mismatch.');
    }
    if (record.manifestDigest !== normalized.manifestDigest) {
      throw new WorkflowStoreConflictError('Manifest digest mismatch.');
    }

    if (record.receipt) {
      store.reviewApproval(record.workflowId, record.approvalId, {
        decision: normalized.decision,
        digest: normalized.manifestDigest,
        ...(normalized.note === undefined ? {} : { note: normalized.note }),
        receiptContext: {
          id: record.receipt.id,
          manifestDigest: record.receipt.manifestDigest,
          reviewerHash: normalized.reviewerHash,
          policyRevision: POLICY_REVISION,
          externalActionPerformed: false,
        },
      });
      const replayed = store.getWorkflow(record.workflowId);
      if (!replayed) throw new WorkflowStoreConflictError('Reviewed workflow was not persisted.');
      return readRecord(target, replayed);
    }

    if (nowMs() >= Date.parse(record.manifest.grant.expiresAt)) {
      throw new WorkflowStoreConflictError('Workflow approval grant has expired.');
    }
    const receiptNonce = createNonce('Receipt nonce');
    const receiptId = `${workflowPrefix(target)}receipt-${sha256(
      `${record.workflowId}:${record.approvalId}:${receiptNonce}`,
    ).slice(0, 24)}`;
    store.reviewApproval(record.workflowId, record.approvalId, {
      decision: normalized.decision,
      digest: normalized.manifestDigest,
      ...(normalized.note === undefined ? {} : { note: normalized.note }),
      receiptContext: {
        id: receiptId,
        manifestDigest: normalized.manifestDigest,
        reviewerHash: normalized.reviewerHash,
        policyRevision: POLICY_REVISION,
        externalActionPerformed: false,
      },
    });
    const reviewed = store.getWorkflow(record.workflowId);
    if (!reviewed) throw new WorkflowStoreConflictError('Reviewed workflow was not persisted.');
    return readRecord(target, reviewed);
  };

  const wrapper = <TTarget extends CustomerMarketingWorkflowTarget>(
    target: TTarget,
  ): CustomerMarketingWorkflowWrapper<TTarget> => ({
    target,
    prepare: (input) => prepare(target, input),
    list: () => list(target),
    review: (input) => review(target, input),
  });

  return {
    social: wrapper('social'),
    seo: wrapper('seo'),
    email: wrapper('email'),
    crm: wrapper('crm'),
  };
}

function completeLocalJob(
  store: CustomerMarketingWorkflowStore,
  workflowId: string,
  expectedJobId: 'validate' | 'dry_run',
  workerId: string,
): void {
  const job = store.claimNextJob(workflowId, { workerId });
  if (!job || job.id !== expectedJobId || !job.lease) {
    throw new WorkflowStoreConflictError(`Local job '${expectedJobId}' could not be claimed.`);
  }
  store.completeJob(workflowId, expectedJobId, job.lease.token);
}

function normalizePrepareInput<TTarget extends CustomerMarketingWorkflowTarget>(
  target: TTarget,
  workspaceId: string,
  input: CustomerMarketingWorkflowPrepareInput<TTarget>,
): {
  inputRef: CustomerMarketingPersistedResourceRef;
  operations: CustomerMarketingWorkflowAllowedOperation[];
} {
  assertRecord(input, 'Workflow prepare input');
  assertOnlyKeys(input, ['target', 'inputRef', 'operations'], 'Workflow prepare input');
  if (input.target !== target) {
    throw new WorkflowStoreValidationError('Workflow target mismatch.');
  }
  assertRecord(input.inputRef, 'Persisted resource ref');
  assertOnlyKeys(
    input.inputRef,
    ['id', 'workspaceId', 'kind', 'revision', 'sha256', 'title'],
    'Persisted resource ref',
  );
  assertIdentifier(input.inputRef.id, 'Persisted resource id');
  assertTrimmedString(input.inputRef.workspaceId, 'Persisted resource workspace');
  assertTrimmedString(input.inputRef.title, 'Persisted resource title');
  if (input.inputRef.workspaceId !== workspaceId) {
    throw new WorkflowStoreValidationError('Persisted resource workspace mismatch.');
  }
  const expectedKind = TARGET_CONFIG[target].sourceKind;
  if (input.inputRef.kind !== expectedKind) {
    throw new WorkflowStoreValidationError(
      `${target} workflow requires an approved ${expectedKind} resource.`,
    );
  }
  if (!Number.isSafeInteger(input.inputRef.revision) || input.inputRef.revision < 1) {
    throw new WorkflowStoreValidationError('Persisted resource revision must be positive.');
  }
  assertDigest(input.inputRef.sha256, 'Persisted resource digest');

  const requested = input.operations ?? ALLOWED_OPERATIONS;
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new WorkflowStoreValidationError('Workflow operations must not be empty.');
  }
  const requestedSet = new Set<string>();
  for (const operation of requested) {
    if (typeof operation !== 'string') {
      throw new WorkflowStoreValidationError('Workflow operation is invalid.');
    }
    if (HARD_DENIED_OPERATIONS.has(operation)) {
      throw new WorkflowStoreValidationError(`Operation '${operation}' is hard-denied.`);
    }
    if (!(ALLOWED_OPERATIONS as readonly string[]).includes(operation)) {
      throw new WorkflowStoreValidationError(`Operation '${operation}' is unsupported.`);
    }
    if (requestedSet.has(operation)) {
      throw new WorkflowStoreValidationError(`Operation '${operation}' is duplicated.`);
    }
    requestedSet.add(operation);
  }

  return {
    inputRef: {
      id: input.inputRef.id,
      workspaceId: input.inputRef.workspaceId,
      kind: input.inputRef.kind,
      revision: input.inputRef.revision,
      sha256: input.inputRef.sha256,
      title: input.inputRef.title,
    },
    operations: ALLOWED_OPERATIONS.filter((operation) => requestedSet.has(operation)),
  };
}

function normalizeReviewInput(
  input: CustomerMarketingWorkflowReviewInput,
): CustomerMarketingWorkflowReviewInput {
  assertRecord(input, 'Workflow review input');
  assertOnlyKeys(
    input,
    ['workflowId', 'approvalId', 'manifestDigest', 'decision', 'reviewerHash', 'note'],
    'Workflow review input',
  );
  assertIdentifier(input.workflowId, 'Workflow id');
  assertIdentifier(input.approvalId, 'Approval id');
  assertDigest(input.manifestDigest, 'Manifest digest');
  assertDigest(input.reviewerHash, 'Reviewer hash');
  if (input.decision !== 'approved' && input.decision !== 'rejected') {
    throw new WorkflowStoreValidationError('Workflow review decision is invalid.');
  }
  if (input.note !== undefined) {
    if (typeof input.note !== 'string' || input.note.length > 4_000) {
      throw new WorkflowStoreValidationError('Workflow review note is invalid.');
    }
  }
  return {
    workflowId: input.workflowId,
    approvalId: input.approvalId,
    manifestDigest: input.manifestDigest,
    decision: input.decision,
    reviewerHash: input.reviewerHash,
    ...(input.note === undefined ? {} : { note: input.note }),
  };
}

function parseManifest(
  content: string,
  target: CustomerMarketingWorkflowTarget,
  workspaceHash: string,
): CustomerMarketingWorkflowManifestV1 {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new WorkflowStoreValidationError('Workflow manifest is not valid JSON.');
  }
  assertRecord(value, 'Workflow manifest');
  assertOrderedKeys(
    value,
    ['kind', 'title', 'workspaceHash', 'inputRef', 'grant', 'dryRun', 'nonce', 'createdAt'],
    'Workflow manifest',
  );
  if (value.kind !== target) {
    throw new WorkflowStoreValidationError('Workflow manifest target mismatch.');
  }
  assertTrimmedString(value.title, 'Workflow manifest title');
  if (value.workspaceHash !== workspaceHash) {
    throw new WorkflowStoreValidationError('Workflow manifest workspace mismatch.');
  }
  assertIdentifier(value.nonce, 'Workflow manifest nonce');
  assertIsoDate(value.createdAt, 'Workflow manifest createdAt');

  assertRecord(value.inputRef, 'Workflow manifest input ref');
  assertOrderedKeys(
    value.inputRef,
    ['id', 'kind', 'revision', 'sha256'],
    'Workflow manifest input ref',
  );
  assertIdentifier(value.inputRef.id, 'Workflow manifest input id');
  if (value.inputRef.kind !== TARGET_CONFIG[target].sourceKind) {
    throw new WorkflowStoreValidationError('Workflow manifest source kind mismatch.');
  }
  if (
    typeof value.inputRef.revision !== 'number'
    || !Number.isSafeInteger(value.inputRef.revision)
    || value.inputRef.revision < 1
  ) {
    throw new WorkflowStoreValidationError('Workflow manifest input revision is invalid.');
  }
  assertDigest(value.inputRef.sha256, 'Workflow manifest input digest');

  assertRecord(value.grant, 'Workflow manifest grant');
  assertOrderedKeys(
    value.grant,
    ['operations', 'channels', 'limits', 'expiresAt', 'policyRevision'],
    'Workflow manifest grant',
  );
  assertAllowedOperations(value.grant.operations);
  if (
    !Array.isArray(value.grant.channels)
    || value.grant.channels.length !== 1
    || value.grant.channels[0] !== target
  ) {
    throw new WorkflowStoreValidationError('Workflow manifest channel scope mismatch.');
  }
  assertRecord(value.grant.limits, 'Workflow manifest grant limits');
  assertOrderedKeys(
    value.grant.limits,
    ['maxItems', 'maxRecipients', 'maxSpendVnd'],
    'Workflow manifest grant limits',
  );
  if (
    value.grant.limits.maxItems !== 1
    || value.grant.limits.maxRecipients !== 0
    || value.grant.limits.maxSpendVnd !== 0
  ) {
    throw new WorkflowStoreValidationError('Workflow manifest grant limits are invalid.');
  }
  assertIsoDate(value.grant.expiresAt, 'Workflow manifest grant expiry');
  if (Date.parse(value.grant.expiresAt) <= Date.parse(value.createdAt)) {
    throw new WorkflowStoreValidationError('Workflow manifest grant expiry is invalid.');
  }
  if (value.grant.policyRevision !== POLICY_REVISION) {
    throw new WorkflowStoreValidationError('Workflow manifest policy revision mismatch.');
  }

  assertRecord(value.dryRun, 'Workflow manifest dry-run');
  assertOrderedKeys(
    value.dryRun,
    ['steps', 'outputs', 'warnings', 'externalActionPerformed'],
    'Workflow manifest dry-run',
  );
  assertExactStringArray(value.dryRun.steps, TARGET_CONFIG[target].steps, 'Dry-run steps');
  assertExactStringArray(value.dryRun.outputs, DRY_RUN_OUTPUTS, 'Dry-run outputs');
  assertExactStringArray(value.dryRun.warnings, DRY_RUN_WARNINGS, 'Dry-run warnings');
  if (value.dryRun.externalActionPerformed !== false) {
    throw new WorkflowStoreValidationError('Workflow manifest records an external action.');
  }
  if (JSON.stringify(value) !== content) {
    throw new WorkflowStoreValidationError('Workflow manifest is not canonical.');
  }
  return value as unknown as CustomerMarketingWorkflowManifestV1;
}

function assertWrapperJobs(workflow: CustomerMarketingWorkflow): void {
  if (workflow.jobs.length !== WORKFLOW_JOB_IDS.length) {
    throw new WorkflowStoreValidationError(
      `Workflow '${workflow.id}' has an invalid job graph.`,
    );
  }
  for (let index = 0; index < WORKFLOW_JOB_IDS.length; index += 1) {
    const job = workflow.jobs[index];
    const expectedId = WORKFLOW_JOB_IDS[index];
    const expectedDependencies = index === 0 ? [] : [WORKFLOW_JOB_IDS[index - 1]];
    if (
      job.id !== expectedId
      || job.dependsOn.length !== expectedDependencies.length
      || job.dependsOn.some((dependency, dependencyIndex) => (
        dependency !== expectedDependencies[dependencyIndex]
      ))
    ) {
      throw new WorkflowStoreValidationError(
        `Workflow '${workflow.id}' has an invalid job graph.`,
      );
    }
  }
}

function assertLifecycleBinding(
  workflow: CustomerMarketingWorkflow,
  approval: WorkflowApproval,
  hasReceipt: boolean,
): void {
  const approvalJob = workflow.jobs[2];
  if (approval.status === 'pending') {
    if (
      hasReceipt
      || workflow.status !== 'awaiting_approval'
      || approvalJob.status !== 'awaiting_approval'
    ) {
      throw new WorkflowStoreValidationError(
        `Workflow '${workflow.id}' has an invalid pending approval state.`,
      );
    }
    return;
  }
  if (!hasReceipt) {
    throw new WorkflowStoreValidationError(
      `Workflow '${workflow.id}' is missing its audit receipt.`,
    );
  }
  if (approval.status === 'approved') {
    if (workflow.status !== 'completed' || approvalJob.status !== 'completed') {
      throw new WorkflowStoreValidationError(
        `Workflow '${workflow.id}' has an invalid approved state.`,
      );
    }
    return;
  }
  if (workflow.status !== 'blocked' || approvalJob.status !== 'blocked') {
    throw new WorkflowStoreValidationError(
      `Workflow '${workflow.id}' has an invalid rejected state.`,
    );
  }
}

function assertAllowedOperations(value: unknown): void {
  if (!Array.isArray(value) || value.length === 0 || value.length > ALLOWED_OPERATIONS.length) {
    throw new WorkflowStoreValidationError('Workflow manifest operations are invalid.');
  }
  const expected = ALLOWED_OPERATIONS.filter((operation) => value.includes(operation));
  if (
    expected.length !== value.length
    || value.some((operation, index) => operation !== expected[index])
  ) {
    throw new WorkflowStoreValidationError('Workflow manifest operations are invalid.');
  }
}

function workflowPrefix(target: CustomerMarketingWorkflowTarget): string {
  return `cmr-306-${target}-`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new WorkflowStoreValidationError(`${label} must be an object.`);
  }
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const allowed = new Set(keys);
  const unsupported = Object.keys(value).find((key) => !allowed.has(key));
  if (unsupported) {
    throw new WorkflowStoreValidationError(`${label} contains unsupported field '${unsupported}'.`);
  }
  const missing = keys.find((key) => key !== 'operations' && key !== 'note' && !(key in value));
  if (missing) {
    throw new WorkflowStoreValidationError(`${label} is missing field '${missing}'.`);
  }
}

function assertOrderedKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value);
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new WorkflowStoreValidationError(`${label} fields are not canonical.`);
  }
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  assertTrimmedString(value, label);
  if (value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new WorkflowStoreValidationError(`${label} is invalid.`);
  }
}

function assertTrimmedString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new WorkflowStoreValidationError(`${label} must be a non-empty trimmed string.`);
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

function assertExactStringArray(
  value: unknown,
  expected: readonly string[],
  label: string,
): void {
  if (
    !Array.isArray(value)
    || value.length !== expected.length
    || value.some((item, index) => item !== expected[index])
  ) {
    throw new WorkflowStoreValidationError(`${label} are invalid.`);
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactRequestKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const keys = Object.keys(value);
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && keys.every((key) => allowed.has(key));
}

function isRequestIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && value === value.trim()
    && !/[\u0000-\u001f\u007f]/.test(value);
}
