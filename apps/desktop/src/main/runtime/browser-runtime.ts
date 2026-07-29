import { createHash } from 'crypto';
import {
  RUNTIME_CONTRACT_VERSION,
  assertAllowedUrl,
  assertNoCredentialFields,
  type BrowserRuntimeSpec,
  type RuntimeEffectReceipt,
} from '../../shared/runtime';
import { canonicalJson } from '../../shared/personal-office';
import type { WorkApproval, WorkArtifact, WorkRun } from '../work/work-types';
import { computeActionHash } from '../work/work-hash';
import { redactDeep } from '../work/work-redaction';
import type { EffectClaimStore } from './effect-claim-store';
import type { EncryptedBrowserStateStore } from './encrypted-state-store';
import { redactRuntimeText } from './redaction';
import {
  authorizeRuntimeSpec,
  type RuntimeAuthorizationResolver,
} from './runtime-authorizer';

export interface BrowserReadResult {
  readonly finalUrl: string;
  readonly text: string;
  readonly trace: string;
  readonly screenshot: string;
}

export interface BrowserSubmitResult {
  readonly finalUrl: string;
  readonly status: number;
  readonly responseBody: string;
  readonly trace: string;
  readonly screenshot: string;
}

export interface IsolatedBrowserSession {
  navigate(
    url: string,
    signal: AbortSignal | undefined,
    authorizeUrl: (candidate: string) => void,
  ): Promise<BrowserReadResult>;
  submitTestEndpoint(
    input: { url: string; body: unknown; idempotencyKey: string },
    signal: AbortSignal | undefined,
    authorizeUrl: (candidate: string) => void,
  ): Promise<BrowserSubmitResult>;
  exportStorageState(): Promise<string>;
  close(): Promise<void>;
}

export interface IsolatedBrowserDriver {
  readonly idempotentReplaySafe: boolean;
  open(spec: BrowserRuntimeSpec, encryptedStorageState: string | null): Promise<IsolatedBrowserSession>;
}

export interface BrowserWorkPort {
  putArtifact(input: {
    runId: string;
    name: string;
    kind: 'document_draft' | 'report' | 'media' | 'receipt';
    mediaType: string;
    body: string;
    idempotencyKey: string;
  }): WorkArtifact;
  requestApproval(input: {
    runId: string;
    target: string;
    body: unknown;
    artifactId: string;
    idempotencyKey: string;
    preview: string;
  }): WorkApproval;
  getApproval(approvalId: string): WorkApproval | null;
  getRun(runId: string): WorkRun | null;
  listArtifacts(runId: string): WorkArtifact[];
  recordStep(input: {
    runId: string;
    key: string;
    label: string;
    status: 'running' | 'done' | 'error' | 'blocked';
    detail?: string;
    idempotencyKey: string;
  }): void;
}

export interface PreparedBrowserAction {
  readonly runtime: BrowserRuntimeSpec;
  readonly runId: string;
  readonly readUrl: string;
  readonly submitUrl: string;
  readonly draftBody: unknown;
  readonly idempotencyKey: string;
  readonly artifactId: string;
  readonly artifactVersion: number;
  readonly approvalId: string;
  readonly actionHash: string;
}

export class BrowserApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BrowserApprovalError';
  }
}

export class BrowserRuntimeCoordinator {
  constructor(
    private readonly driver: IsolatedBrowserDriver,
    private readonly state: EncryptedBrowserStateStore,
    private readonly claims: EffectClaimStore,
    private readonly work: BrowserWorkPort,
    private readonly authorization: RuntimeAuthorizationResolver,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async prepare(input: {
    runtime: BrowserRuntimeSpec;
    runId: string;
    readUrl: string;
    submitUrl: string;
    draftBody: unknown;
    idempotencyKey: string;
    signal?: AbortSignal;
  }): Promise<PreparedBrowserAction> {
    if (input.runtime.authority.runId !== input.runId) {
      throw new BrowserApprovalError('Browser runtime runId does not match the requested run');
    }
    await authorizeRuntimeSpec(
      input.runtime,
      this.authorization,
      this.clock().toISOString(),
    );
    assertNoCredentialFields(input.draftBody);
    const expectedApprovalInput = browserApprovalInput(input.draftBody);
    assertAllowedUrl(input.readUrl, input.runtime.network);
    assertAllowedUrl(input.submitUrl, input.runtime.network);
    if (input.signal?.aborted) throw new Error('browser preparation canceled');
    const scopeKey = stateKey(input.runtime);
    const session = await this.driver.open(input.runtime, await this.state.read(scopeKey));
    try {
      const authorizeUrl = (candidate: string) => {
        assertAllowedUrl(candidate, input.runtime.network);
      };
      const read = await session.navigate(input.readUrl, input.signal, authorizeUrl);
      assertAllowedUrl(read.finalUrl, input.runtime.network);
      const draft = this.work.putArtifact({
        runId: input.runId,
        name: 'browser-action-draft',
        kind: 'document_draft',
        mediaType: 'application/json',
        body: JSON.stringify({ observed: redactRuntimeText(read.text), draft: input.draftBody }),
        idempotencyKey: `browser:draft:${input.idempotencyKey}`,
      });
      this.work.putArtifact({
        runId: input.runId,
        name: 'browser-read-trace',
        kind: 'report',
        mediaType: 'application/json',
        body: redactRuntimeText(read.trace),
        idempotencyKey: `browser:read-trace:${input.idempotencyKey}`,
      });
      this.work.putArtifact({
        runId: input.runId,
        name: 'browser-read-screenshot',
        kind: 'media',
        mediaType: 'text/plain',
        body: redactRuntimeText(read.screenshot),
        idempotencyKey: `browser:read-screenshot:${input.idempotencyKey}`,
      });
      const approval = this.work.requestApproval({
        runId: input.runId,
        target: input.submitUrl,
        body: input.draftBody,
        artifactId: draft.id,
        idempotencyKey: input.idempotencyKey,
        preview: JSON.stringify(input.draftBody),
      });
      if (
        canonicalJson(approval.binding.input)
        !== canonicalJson(expectedApprovalInput)
      ) {
        throw new BrowserApprovalError('Approval input normalization is incompatible');
      }
      await this.state.write(scopeKey, await session.exportStorageState());
      return {
        runtime: input.runtime,
        runId: input.runId,
        readUrl: input.readUrl,
        submitUrl: input.submitUrl,
        draftBody: input.draftBody,
        idempotencyKey: input.idempotencyKey,
        artifactId: draft.id,
        artifactVersion: draft.version,
        approvalId: approval.id,
        actionHash: approval.actionHash,
      };
    } finally {
      await session.close();
    }
  }

  async execute(
    prepared: PreparedBrowserAction,
    signal?: AbortSignal,
  ): Promise<RuntimeEffectReceipt> {
    if (prepared.runtime.authority.runId !== prepared.runId) {
      throw new BrowserApprovalError('Browser runtime runId does not match the prepared run');
    }
    await authorizeRuntimeSpec(
      prepared.runtime,
      this.authorization,
      this.clock().toISOString(),
    );
    if (signal?.aborted) throw new BrowserApprovalError('Action canceled before approval claim');
    const approval = this.assertApproval(prepared);
    const approvedEffectBody = browserEffectBody(approval.binding.input);
    const claimKey = {
      approvalId: approval.id,
      actionHash: approval.actionHash,
      idempotencyKey: approval.binding.idempotencyKey,
      tenantId: prepared.runtime.authority.tenantId,
      userId: prepared.runtime.authority.userId,
      workspaceId: prepared.runtime.authority.workspaceId,
      runId: prepared.runId,
    };
    const claimed = await this.claims.claim(claimKey);
    if (claimed.record.state === 'effected' && claimed.record.receipt) {
      return claimed.record.receipt;
    }
    if (!claimed.created && !this.driver.idempotentReplaySafe) {
      throw new BrowserApprovalError(`Effect claim is ${claimed.record.state}; replay denied`);
    }
    if (claimed.record.state === 'uncertain') {
      throw new BrowserApprovalError('Effect outcome is uncertain; automatic replay denied');
    }
    if (claimed.record.state === 'aborted') {
      throw new BrowserApprovalError('Effect claim was aborted');
    }

    const scopeKey = stateKey(prepared.runtime);
    const session = await this.driver.open(prepared.runtime, await this.state.read(scopeKey));
    try {
      if (signal?.aborted) {
        await this.claims.markAborted(claimed.record.claimId, 'canceled before submit');
        throw new BrowserApprovalError('Action canceled before submit');
      }
      const result = await session.submitTestEndpoint(
        {
          url: prepared.submitUrl,
          body: approvedEffectBody,
          idempotencyKey: prepared.idempotencyKey,
        },
        signal,
        (candidate) => {
          assertAllowedUrl(candidate, prepared.runtime.network);
        },
      );
      assertAllowedUrl(result.finalUrl, prepared.runtime.network);
      const receipt: RuntimeEffectReceipt = {
        schemaVersion: RUNTIME_CONTRACT_VERSION,
        claimId: claimed.record.claimId,
        approvalId: approval.id,
        actionHash: approval.actionHash,
        idempotencyKey: prepared.idempotencyKey,
        workspaceId: prepared.runtime.authority.workspaceId,
        runId: prepared.runId,
        target: prepared.submitUrl,
        responseDigest: `sha256:${createHash('sha256').update(result.responseBody).digest('hex')}`,
        externalActionPerformed: true,
        performedAt: this.clock().toISOString(),
      };
      await this.claims.markEffected(claimed.record.claimId, receipt);
      await this.state.write(scopeKey, await session.exportStorageState());
      this.work.putArtifact({
        runId: prepared.runId,
        name: 'browser-effect-receipt',
        kind: 'receipt',
        mediaType: 'application/json',
        body: JSON.stringify(receipt),
        idempotencyKey: `browser:receipt:${prepared.idempotencyKey}`,
      });
      this.work.putArtifact({
        runId: prepared.runId,
        name: 'browser-submit-trace',
        kind: 'report',
        mediaType: 'application/json',
        body: redactRuntimeText(result.trace),
        idempotencyKey: `browser:submit-trace:${prepared.idempotencyKey}`,
      });
      this.work.putArtifact({
        runId: prepared.runId,
        name: 'browser-submit-screenshot',
        kind: 'media',
        mediaType: 'text/plain',
        body: redactRuntimeText(result.screenshot),
        idempotencyKey: `browser:submit-screenshot:${prepared.idempotencyKey}`,
      });
      this.work.recordStep({
        runId: prepared.runId,
        key: `browser-effect:${prepared.idempotencyKey}`,
        label: 'Submit approved browser action',
        status: 'done',
        detail: `test endpoint returned ${result.status}`,
        idempotencyKey: `browser:effect-step:${prepared.idempotencyKey}`,
      });
      return receipt;
    } catch (error) {
      const current = await this.claims.read(claimed.record.claimId);
      if (current?.state === 'claimed') {
        await this.claims.markUncertain(claimed.record.claimId, 'browser submit interrupted');
      }
      throw error;
    } finally {
      await session.close();
    }
  }

  private assertApproval(prepared: PreparedBrowserAction): WorkApproval {
    const approval = this.work.getApproval(prepared.approvalId);
    const run = this.work.getRun(prepared.runId);
    if (!approval || !run) throw new BrowserApprovalError('Approval or run is missing');
    if (approval.status !== 'approved') throw new BrowserApprovalError('Approval is not approved');
    if (approval.runId !== prepared.runId || approval.workspaceId !== prepared.runtime.authority.workspaceId) {
      throw new BrowserApprovalError('Approval scope mismatch');
    }
    if (
      approval.actionHash !== prepared.actionHash
      || computeActionHash(approval.binding) !== approval.actionHash
      || canonicalJson(approval.binding.input)
        !== canonicalJson(browserApprovalInput(prepared.draftBody))
      || approval.binding.idempotencyKey !== prepared.idempotencyKey
      || approval.binding.target !== prepared.submitUrl
      || approval.binding.planHash !== run.planHash
      || (approval.binding.contextSnapshotId ?? null) !== (run.contextSnapshotId ?? null)
      || Date.parse(approval.expiresAt) <= this.clock().getTime()
    ) {
      throw new BrowserApprovalError('Approval binding is stale or tampered');
    }
    const artifact = this.work.listArtifacts(prepared.runId).find(
      (item) => item.id === prepared.artifactId && item.version === prepared.artifactVersion,
    );
    if (
      !artifact
      || approval.binding.artifactId !== prepared.artifactId
      || approval.binding.artifactVersion !== prepared.artifactVersion
    ) {
      throw new BrowserApprovalError('Approved artifact is stale');
    }
    return approval;
  }
}

function browserApprovalInput(input: unknown): unknown {
  assertNoApprovalReservedKeys(input);
  const redacted = redactDeep(input);
  if (canonicalJson(redacted.value) !== canonicalJson(input)) {
    throw new BrowserApprovalError('Browser action body contains data that cannot be approval-bound');
  }
  return redacted.value !== null
    && typeof redacted.value === 'object'
    && !Array.isArray(redacted.value)
    ? { ...(redacted.value as Record<string, unknown>), _redacted: redacted.kinds }
    : redacted.value;
}

function browserEffectBody(approvalInput: unknown): unknown {
  if (Array.isArray(approvalInput)) {
    assertNoApprovalReservedKeys(approvalInput, 'approval.binding.input');
    return approvalInput;
  }
  if (
    approvalInput !== null
    && typeof approvalInput === 'object'
  ) {
    const record = approvalInput as Record<string, unknown>;
    const auditMetadata = record._redacted;
    if (
      !Array.isArray(auditMetadata)
      || auditMetadata.some((item) => typeof item !== 'string')
    ) {
      throw new BrowserApprovalError('Persisted approval redaction metadata is invalid');
    }
    for (const key of Object.keys(record)) {
      if (key === '_redacted') continue;
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        throw new BrowserApprovalError(`Persisted approval input uses reserved key: ${key}`);
      }
    }
    const { _redacted: _auditMetadata, ...body } = record;
    assertNoApprovalReservedKeys(body, 'approval.binding.input');
    return body;
  }
  return approvalInput;
}

function assertNoApprovalReservedKeys(value: unknown, trail = 'draftBody'): void {
  if (Array.isArray(value)) {
    for (const key of Object.keys(value)) {
      if (
        key === '__proto__'
        || key === 'constructor'
        || key === 'prototype'
        || key === '_redacted'
      ) {
        throw new BrowserApprovalError(`Browser action body uses reserved key: ${trail}.${key}`);
      }
      assertNoApprovalReservedKeys(
        (value as unknown as Record<string, unknown>)[key],
        `${trail}.${key}`,
      );
    }
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (
      key === '__proto__'
      || key === 'constructor'
      || key === 'prototype'
      || key === '_redacted'
    ) {
      throw new BrowserApprovalError(`Browser action body uses reserved key: ${trail}.${key}`);
    }
    assertNoApprovalReservedKeys(
      (value as Record<string, unknown>)[key],
      `${trail}.${key}`,
    );
  }
}

export function browserStateKey(spec: BrowserRuntimeSpec): string {
  const identity = canonicalJson({
    schemaVersion: 1,
    tenantId: spec.authority.tenantId,
    userId: spec.authority.userId,
    workspaceId: spec.authority.workspaceId,
    packageId: spec.authority.packageId,
    integrationId: spec.authority.integrationId,
    grantId: spec.authority.grantId,
    storageStateRef: {
      store: spec.storageStateRef.store,
      ref: spec.storageStateRef.ref,
      scopes: spec.storageStateRef.scopes ?? [],
    },
  });
  return `browser-state-v1-${createHash('sha256').update(identity, 'utf8').digest('hex')}`;
}

const stateKey = browserStateKey;
