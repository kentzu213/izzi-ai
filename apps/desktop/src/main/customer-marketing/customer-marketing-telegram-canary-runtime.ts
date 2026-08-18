import type {
  CustomerMarketingConnectorExecuteInput,
  CustomerMarketingConnectorExecuteResult,
} from './customer-marketing-connector-sdk';
import type {
  CustomerMarketingTelegramCanarySendAttemptLedger,
  CustomerMarketingTelegramCanarySendReservationProof,
} from './customer-marketing-telegram-canary-send';
import type {
  CustomerMarketingCanaryController,
  CustomerMarketingCanaryDecision,
} from './customer-marketing-canary-controller';

export interface CustomerMarketingTelegramCanaryConnector {
  execute(input: CustomerMarketingConnectorExecuteInput): Promise<CustomerMarketingConnectorExecuteResult>;
}

export class CustomerMarketingTelegramCanaryRuntime {
  constructor(
    private readonly controller: Pick<CustomerMarketingCanaryController, 'authorize'>,
    private readonly connector: CustomerMarketingTelegramCanaryConnector,
    private readonly ledger: Pick<CustomerMarketingTelegramCanarySendAttemptLedger, 'verifyReservation'>,
  ) {
    if (!ledger || typeof ledger.verifyReservation !== 'function') {
      throw new Error('Telegram canary runtime requires a durable ledger.');
    }
  }

  async execute(
    input: CustomerMarketingConnectorExecuteInput,
    reservation: CustomerMarketingTelegramCanarySendReservationProof,
  ): Promise<CustomerMarketingConnectorExecuteResult> {
    const snapshot = snapshotExecuteInput(input);
    const reservationSnapshot = snapshotReservation(reservation);
    if (!snapshot || !reservationSnapshot
      || reservationSnapshot.workspaceHash !== snapshot.workspaceHash
      || reservationSnapshot.resourceDigest !== snapshot.resourceDigest
      || reservationSnapshot.attemptId !== snapshot.idempotencyKey) {
      return this.blockedDetail('request-invalid');
    }
    const decision = this.controller.authorize({
      provider: 'telegram',
      operation: 'private_sandbox_send',
      manifestDigest: snapshot.manifestDigest,
      resourceDigest: snapshot.resourceDigest,
      expectedRevision: snapshot.expectedRevision,
    });
    if (!decision.authorized) return this.blocked(decision);
    let reserved = false;
    try { reserved = this.ledger.verifyReservation(reservationSnapshot); } catch { reserved = false; }
    if (!reserved) return this.blockedDetail('attempt-ledger-unavailable');
    const repeatedDecision = this.controller.authorize({
      provider: 'telegram',
      operation: 'private_sandbox_send',
      manifestDigest: snapshot.manifestDigest,
      resourceDigest: snapshot.resourceDigest,
      expectedRevision: snapshot.expectedRevision,
    });
    if (!repeatedDecision.authorized) return this.blocked(repeatedDecision);
    return sanitizeConnectorResult(await this.connector.execute(snapshot), snapshot);
  }

  private blocked(decision: CustomerMarketingCanaryDecision): CustomerMarketingConnectorExecuteResult {
    return this.blockedDetail(decision.reason);
  }

  private blockedDetail(detail: string): CustomerMarketingConnectorExecuteResult {
    return {
      ok: false,
      status: 'blocked',
      provider: 'telegram',
      externalActionPerformed: false,
      receipt: null,
      detail,
    };
  }
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const ALLOWED_PLANS = new Set(['free', 'starter', 'pro', 'max', 'ultra']);
const SAFE_BLOCKED_DETAILS = new Set([
  'credential-unavailable',
  'credential-or-chat-unavailable',
  'request-invalid',
  'resource-digest-mismatch',
  'rate-limited',
  'execute-policy-blocked',
  'approval-invalid',
  'external-operation-failed',
]);

function snapshotExecuteInput(
  input: CustomerMarketingConnectorExecuteInput,
): Readonly<CustomerMarketingConnectorExecuteInput> | null {
  if (!input || typeof input !== 'object') return null;
  const authoritySource = input.authority;
  const rateLimitSource = authoritySource?.rateLimit;
  const approvalSource = input.approval;
  if (!authoritySource || !rateLimitSource || !approvalSource) return null;
  const rateLimit = Object.freeze({
    remaining: rateLimitSource.remaining,
    resetAt: rateLimitSource.resetAt,
  });
  const authority = Object.freeze({
    role: authoritySource.role,
    plan: authoritySource.plan,
    permission: authoritySource.permission,
    rateLimit,
  });
  const approval = Object.freeze({
    approvalId: approvalSource.approvalId,
    manifestDigest: approvalSource.manifestDigest,
    expiresAt: approvalSource.expiresAt,
  });
  const snapshot = {
    workspaceHash: input.workspaceHash,
    provider: input.provider,
    target: input.target,
    resourceDigest: input.resourceDigest,
    manifestDigest: input.manifestDigest,
    expectedRevision: input.expectedRevision,
    idempotencyKey: input.idempotencyKey,
    authority,
    operation: input.operation,
    approval,
  } as CustomerMarketingConnectorExecuteInput;
  if (!SHA256_PATTERN.test(snapshot.workspaceHash)
    || snapshot.provider !== 'telegram'
    || snapshot.target !== 'social'
    || !SHA256_PATTERN.test(snapshot.resourceDigest)
    || !SHA256_PATTERN.test(snapshot.manifestDigest)
    || !Number.isSafeInteger(snapshot.expectedRevision)
    || snapshot.expectedRevision < 0
    || !IDENTIFIER_PATTERN.test(snapshot.idempotencyKey)
    || (snapshot.authority.role !== 'owner' && snapshot.authority.role !== 'manager')
    || !ALLOWED_PLANS.has(snapshot.authority.plan)
    || snapshot.authority.permission !== 'execute'
    || !Number.isSafeInteger(snapshot.authority.rateLimit.remaining)
    || snapshot.authority.rateLimit.remaining < 1
    || !isCanonicalIsoTimestamp(snapshot.authority.rateLimit.resetAt)
    || snapshot.operation !== 'execute'
    || !IDENTIFIER_PATTERN.test(snapshot.approval.approvalId)
    || snapshot.approval.manifestDigest !== snapshot.manifestDigest
    || !isCanonicalIsoTimestamp(snapshot.approval.expiresAt)) return null;
  return Object.freeze(snapshot);
}

function snapshotReservation(
  input: CustomerMarketingTelegramCanarySendReservationProof,
): Readonly<CustomerMarketingTelegramCanarySendReservationProof> | null {
  if (!input || typeof input !== 'object') return null;
  const snapshot = {
    workspaceHash: input.workspaceHash,
    bindingDigest: input.bindingDigest,
    resourceDigest: input.resourceDigest,
    attemptId: input.attemptId,
  };
  if (!SHA256_PATTERN.test(snapshot.workspaceHash)
    || !SHA256_PATTERN.test(snapshot.bindingDigest)
    || !SHA256_PATTERN.test(snapshot.resourceDigest)
    || !IDENTIFIER_PATTERN.test(snapshot.attemptId)) return null;
  return Object.freeze(snapshot);
}

function sanitizeConnectorResult(
  result: unknown,
  input: Readonly<CustomerMarketingConnectorExecuteInput>,
): CustomerMarketingConnectorExecuteResult {
  try {
    if (!isPlainRecord(result) || result.provider !== 'telegram') return invalidConnectorResult();
    const receipt = sanitizeReceipt(result.receipt, input);
    if (result.status === 'executed') {
      if (result.ok !== true || result.externalActionPerformed !== true || !receipt) {
        return invalidConnectorResult();
      }
      return {
        ok: true,
        status: 'executed',
        provider: 'telegram',
        externalActionPerformed: true,
        receipt,
        detail: result.detail === 'sandbox-execute-complete'
          ? result.detail
          : 'sandbox-execute-complete',
      };
    }
    if (result.status === 'duplicate') {
      if (result.ok !== true || result.externalActionPerformed !== false || !receipt) {
        return invalidConnectorResult();
      }
      return {
        ok: true,
        status: 'duplicate',
        provider: 'telegram',
        externalActionPerformed: false,
        receipt,
        detail: 'duplicate-idempotent-replay',
      };
    }
    if ((result.status === 'blocked' || result.status === 'failed')
      && result.ok === false
      && result.externalActionPerformed === false
      && result.receipt === null) {
      return {
        ok: false,
        status: result.status,
        provider: 'telegram',
        externalActionPerformed: false,
        receipt: null,
        detail: typeof result.detail === 'string' && SAFE_BLOCKED_DETAILS.has(result.detail)
          ? result.detail
          : result.status === 'failed'
            ? 'external-operation-failed'
            : 'connector-blocked',
      };
    }
    return invalidConnectorResult();
  } catch {
    return invalidConnectorResult();
  }
}

function sanitizeReceipt(
  value: unknown,
  input: Readonly<CustomerMarketingConnectorExecuteInput>,
): CustomerMarketingConnectorExecuteResult['receipt'] {
  if (!isPlainRecord(value)
    || typeof value.id !== 'string'
    || !IDENTIFIER_PATTERN.test(value.id)
    || value.provider !== 'telegram'
    || value.operation !== 'execute'
    || value.workspaceHash !== input.workspaceHash
    || value.idempotencyKey !== input.idempotencyKey
    || value.resourceDigest !== input.resourceDigest
    || value.externalActionPerformed !== true
    || !isCanonicalIsoTimestamp(value.createdAt)
    || typeof value.receiptDigest !== 'string'
    || !SHA256_PATTERN.test(value.receiptDigest)) return null;
  return {
    id: value.id,
    provider: 'telegram',
    operation: 'execute',
    workspaceHash: input.workspaceHash,
    idempotencyKey: input.idempotencyKey,
    resourceDigest: input.resourceDigest,
    externalActionPerformed: true,
    createdAt: value.createdAt,
    receiptDigest: value.receiptDigest,
  };
}

function invalidConnectorResult(): CustomerMarketingConnectorExecuteResult {
  return {
    ok: false,
    status: 'blocked',
    provider: 'telegram',
    externalActionPerformed: false,
    receipt: null,
    detail: 'connector-result-invalid',
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}
