import { createHash, randomUUID } from 'node:crypto';
import { safeStorage } from 'electron';
import type { CustomerMarketingSafeStorage } from './customer-marketing-credential-vault';

export interface CustomerMarketingCanaryNamedApprovalRequest {
  workflowId: string;
  manifestDigest: string;
  resourceDigest: string;
  expectedRevision: number;
}

export interface CustomerMarketingCanaryNamedApprovalReceipt {
  provider: 'telegram';
  operation: 'private_sandbox_send';
  workflowId: string;
  manifestDigest: string;
  resourceDigest: string;
  expectedRevision: number;
  approval: {
    approvalId: string;
    reviewer: string;
    reviewerHash: string;
    manifestDigest: string;
    expiresAt: string;
  };
  approvedAt: string;
  externalActionPerformed: false;
  receiptDigest: string;
}

interface NamedApprovalSettings {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  deleteSetting(key: string): void;
}

interface StoredNamedApprovalV1 {
  version: 1;
  workspaceHash: string;
  receipt: CustomerMarketingCanaryNamedApprovalReceipt;
}

const STORAGE_PREFIX = 'customer_marketing_canary_named_approval:v1';
const APPROVAL_TTL_MS = 15 * 60 * 1_000;
const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function parseCustomerMarketingCanaryNamedApprovalRequest(
  value: unknown,
): CustomerMarketingCanaryNamedApprovalRequest | null {
  if (!isExactPlainRecord(value, ['workflowId', 'manifestDigest', 'resourceDigest', 'expectedRevision'])
    || typeof value.workflowId !== 'string'
    || !IDENTIFIER_PATTERN.test(value.workflowId)
    || typeof value.manifestDigest !== 'string'
    || !SHA256_PATTERN.test(value.manifestDigest)
    || typeof value.resourceDigest !== 'string'
    || !SHA256_PATTERN.test(value.resourceDigest)
    || typeof value.expectedRevision !== 'number'
    || !Number.isSafeInteger(value.expectedRevision)
    || value.expectedRevision < 0) return null;
  return value as unknown as CustomerMarketingCanaryNamedApprovalRequest;
}

export class CustomerMarketingCanaryNamedApprovalStore {
  constructor(
    private readonly db: NamedApprovalSettings,
    private readonly encryption: CustomerMarketingSafeStorage = safeStorage,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createId: () => string = () => `approval-${randomUUID()}`,
  ) {}

  issue(
    workspaceId: string,
    requestValue: unknown,
    reviewerValue: string,
    reviewerIdentityId: string,
  ): CustomerMarketingCanaryNamedApprovalReceipt {
    const workspaceHash = hashWorkspaceId(workspaceId);
    const request = parseCustomerMarketingCanaryNamedApprovalRequest(requestValue);
    const approvedAt = this.now();
    const reviewer = normalizeReviewer(reviewerValue);
    const reviewerHash = hashReviewerIdentity(reviewerIdentityId);
    if (!request
      || !reviewer
      || !reviewerHash
      || !isCanonicalIsoTimestamp(approvedAt)) {
      throw new Error('Invalid canary named approval.');
    }
    const active = this.readActiveForWorkspace(workspaceId);
    if (active) {
      if (active.workflowId === request.workflowId
        && active.manifestDigest === request.manifestDigest
        && active.resourceDigest === request.resourceDigest
        && active.expectedRevision === request.expectedRevision
        && active.approval.reviewer === reviewer
        && active.approval.reviewerHash === reviewerHash) return active;
      throw new Error('Active canary named approval conflict.');
    }
    const approvalId = this.createId();
    if (!IDENTIFIER_PATTERN.test(approvalId)) throw new Error('Invalid canary named approval.');
    const canonical = {
      provider: 'telegram' as const,
      operation: 'private_sandbox_send' as const,
      workflowId: request.workflowId,
      manifestDigest: request.manifestDigest,
      resourceDigest: request.resourceDigest,
      expectedRevision: request.expectedRevision,
      approval: {
        approvalId,
        reviewer,
        reviewerHash,
        manifestDigest: request.manifestDigest,
        expiresAt: new Date(Date.parse(approvedAt) + APPROVAL_TTL_MS).toISOString(),
      },
      approvedAt,
      externalActionPerformed: false as const,
    };
    const receipt = { ...canonical, receiptDigest: digestReceipt(canonical) };
    const stored: StoredNamedApprovalV1 = { version: 1, workspaceHash, receipt };
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error('Canary named approval encryption is unavailable.');
    }
    let ciphertext: Buffer;
    try {
      ciphertext = this.encryption.encryptString(JSON.stringify(stored));
    } catch {
      throw new Error('Canary named approval encryption failed.');
    }
    if (!Buffer.isBuffer(ciphertext) || ciphertext.length === 0) {
      throw new Error('Canary named approval encryption failed.');
    }
    this.db.setSetting(this.storageKey(workspaceHash), ciphertext.toString('base64'));
    return receipt;
  }

  getActive(
    workspaceId: string,
    reviewerIdentityId: string,
  ): CustomerMarketingCanaryNamedApprovalReceipt | null {
    const reviewerHash = hashReviewerIdentity(reviewerIdentityId);
    if (!reviewerHash) return null;
    const receipt = this.readActiveForWorkspace(workspaceId);
    return receipt?.approval.reviewerHash === reviewerHash ? receipt : null;
  }

  private readActiveForWorkspace(
    workspaceId: string,
  ): CustomerMarketingCanaryNamedApprovalReceipt | null {
    const workspaceHash = hashWorkspaceId(workspaceId);
    const currentTime = this.now();
    if (!isCanonicalIsoTimestamp(currentTime)) return null;
    const key = this.storageKey(workspaceHash);
    const raw = this.db.getSetting(key);
    if (!raw || !this.encryption.isEncryptionAvailable()) return null;
    try {
      const decrypted = this.encryption.decryptString(Buffer.from(raw, 'base64'));
      const stored = JSON.parse(decrypted) as unknown;
      if (!isExactPlainRecord(stored, ['version', 'workspaceHash', 'receipt'])
        || stored.version !== 1
        || stored.workspaceHash !== workspaceHash
        || !validReceipt(stored.receipt)
        || Date.parse(stored.receipt.approval.expiresAt) <= Date.parse(currentTime)) return null;
      return stored.receipt;
    } catch {
      return null;
    }
  }

  consume(
    workspaceId: string,
    reviewerIdentityId: string,
    requestValue: unknown,
  ): CustomerMarketingCanaryNamedApprovalReceipt | null {
    const request = parseCustomerMarketingCanaryNamedApprovalRequest(requestValue);
    if (!request) return null;
    const receipt = this.getActive(workspaceId, reviewerIdentityId);
    if (!receipt
      || receipt.workflowId !== request.workflowId
      || receipt.manifestDigest !== request.manifestDigest
      || receipt.resourceDigest !== request.resourceDigest
      || receipt.expectedRevision !== request.expectedRevision) return null;
    const workspaceHash = hashWorkspaceId(workspaceId);
    this.db.deleteSetting(this.storageKey(workspaceHash));
    return receipt;
  }

  private storageKey(workspaceHash: string): string {
    return `${STORAGE_PREFIX}:${workspaceHash}`;
  }
}

function validReceipt(value: unknown): value is CustomerMarketingCanaryNamedApprovalReceipt {
  if (!isExactPlainRecord(value, [
    'provider', 'operation', 'workflowId', 'manifestDigest', 'resourceDigest', 'expectedRevision',
    'approval', 'approvedAt', 'externalActionPerformed', 'receiptDigest',
  ])
    || !isExactPlainRecord(value.approval, ['approvalId', 'reviewer', 'reviewerHash', 'manifestDigest', 'expiresAt'])
    || value.provider !== 'telegram'
    || value.operation !== 'private_sandbox_send'
    || !parseCustomerMarketingCanaryNamedApprovalRequest({
      workflowId: value.workflowId,
      manifestDigest: value.manifestDigest,
      resourceDigest: value.resourceDigest,
      expectedRevision: value.expectedRevision,
    })
    || typeof value.approval.approvalId !== 'string'
    || !IDENTIFIER_PATTERN.test(value.approval.approvalId)
    || normalizeReviewer(value.approval.reviewer) !== value.approval.reviewer
    || typeof value.approval.reviewerHash !== 'string'
    || !SHA256_PATTERN.test(value.approval.reviewerHash)
    || value.approval.manifestDigest !== value.manifestDigest
    || !isCanonicalIsoTimestamp(value.approval.expiresAt)
    || !isCanonicalIsoTimestamp(value.approvedAt)
    || value.externalActionPerformed !== false
    || typeof value.receiptDigest !== 'string'
    || !SHA256_PATTERN.test(value.receiptDigest)) return false;
  const { receiptDigest, ...canonical } = value;
  return receiptDigest === digestReceipt(canonical);
}

function normalizeReviewer(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().normalize('NFC');
  return normalized.length >= 1 && normalized.length <= 120 && !/[\u0000\u007f]/.test(normalized)
    ? normalized : null;
}

function hashReviewerIdentity(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 || /[\u0000\u007f]/.test(value)) return null;
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hashWorkspaceId(workspaceId: string): string {
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) throw new Error('Invalid customer marketing workspace.');
  return createHash('sha256').update(workspaceId.toLowerCase(), 'utf8').digest('hex');
}

function digestReceipt(value: object): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isExactPlainRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, any> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}
