import { createHash, randomUUID } from 'node:crypto';
import type {
  CustomerMarketingTelegramCanarySendOutcome,
  CustomerMarketingTelegramCanarySendResult,
} from '../../shared/customer-marketing-canary-types';

export interface CustomerMarketingTelegramCanarySendCoordinatorInput {
  workspaceHash: string;
  bindingDigest: string;
  resourceDigest: string;
  text: string;
}

export interface CustomerMarketingTelegramCanarySendCoordinatorOptions {
  now?: () => string;
  id?: () => string;
  ledger: CustomerMarketingTelegramCanarySendAttemptLedger;
}

export interface CustomerMarketingTelegramCanarySendHandlers {
  confirm(input: CustomerMarketingTelegramCanarySendCoordinatorInput): Promise<boolean>;
  reauthorize(input: CustomerMarketingTelegramCanarySendCoordinatorInput): Promise<boolean>;
  execute(input: CustomerMarketingTelegramCanarySendCoordinatorInput & {
    attemptId: string;
  }): Promise<{ outcome: CustomerMarketingTelegramCanarySendOutcome; detail?: string }>;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STORAGE_PREFIX = 'customer_marketing_telegram_canary_send:v1';

interface CustomerMarketingTelegramCanarySendSettings {
  getSetting(key: string): string | null;
  setSettingIfAbsent(key: string, value: string): boolean;
}

export interface CustomerMarketingTelegramCanarySendReservation {
  workspaceHash: string;
  bindingDigest: string;
  resourceDigest: string;
  attemptId: string;
  reservedAt: string;
}

export type CustomerMarketingTelegramCanarySendReservationProof = Pick<
  CustomerMarketingTelegramCanarySendReservation,
  'workspaceHash' | 'bindingDigest' | 'resourceDigest' | 'attemptId'
>;

export interface CustomerMarketingTelegramCanarySendAttemptLedger {
  reserve(input: CustomerMarketingTelegramCanarySendReservation): 'reserved' | 'consumed' | 'unavailable';
  verifyReservation(input: CustomerMarketingTelegramCanarySendReservationProof): boolean;
}

export class CustomerMarketingTelegramCanarySendLedger
implements CustomerMarketingTelegramCanarySendAttemptLedger {
  constructor(private readonly settings: CustomerMarketingTelegramCanarySendSettings) {}

  reserve(input: CustomerMarketingTelegramCanarySendReservation): 'reserved' | 'consumed' | 'unavailable' {
    if (!SHA256_PATTERN.test(input.workspaceHash)
      || !SHA256_PATTERN.test(input.bindingDigest)
      || !SHA256_PATTERN.test(input.resourceDigest)
      || !isIdentifier(input.attemptId)
      || !isCanonicalIsoTimestamp(input.reservedAt)) return 'unavailable';
    const key = `${STORAGE_PREFIX}:${input.workspaceHash}:${input.resourceDigest}`;
    try {
      const value = JSON.stringify({ version: 1, ...input });
      if (this.settings.setSettingIfAbsent(key, value)) return 'reserved';
      return this.settings.getSetting(key) === null ? 'unavailable' : 'consumed';
    } catch {
      return 'unavailable';
    }
  }

  verifyReservation(input: CustomerMarketingTelegramCanarySendReservationProof): boolean {
    if (!SHA256_PATTERN.test(input.workspaceHash)
      || !SHA256_PATTERN.test(input.bindingDigest)
      || !SHA256_PATTERN.test(input.resourceDigest)
      || !isIdentifier(input.attemptId)) return false;
    try {
      const raw = this.settings.getSetting(
        `${STORAGE_PREFIX}:${input.workspaceHash}:${input.resourceDigest}`,
      );
      if (!raw) return false;
      const value = JSON.parse(raw) as unknown;
      if (!isPlainRecord(value)
        || !hasExactKeys(value, [
          'version', 'workspaceHash', 'bindingDigest', 'resourceDigest', 'attemptId', 'reservedAt',
        ])
        || value.version !== 1
        || value.workspaceHash !== input.workspaceHash
        || value.bindingDigest !== input.bindingDigest
        || value.resourceDigest !== input.resourceDigest
        || value.attemptId !== input.attemptId
        || !isCanonicalIsoTimestamp(value.reservedAt)) return false;
      return true;
    } catch {
      return false;
    }
  }
}

export class CustomerMarketingTelegramCanarySendCoordinator {
  private readonly consumed = new Set<string>();
  private readonly now: () => string;
  private readonly id: () => string;
  private readonly ledger: CustomerMarketingTelegramCanarySendAttemptLedger;

  constructor(options: CustomerMarketingTelegramCanarySendCoordinatorOptions) {
    if (!options?.ledger
      || typeof options.ledger.reserve !== 'function'
      || typeof options.ledger.verifyReservation !== 'function') {
      throw new Error('Telegram canary send requires a durable ledger.');
    }
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => `canary-send-${randomUUID()}`);
    this.ledger = options.ledger;
  }

  async send(
    input: CustomerMarketingTelegramCanarySendCoordinatorInput,
    handlers: CustomerMarketingTelegramCanarySendHandlers,
  ): Promise<Pick<CustomerMarketingTelegramCanarySendResult, 'ok' | 'outcome' | 'receipt' | 'detail'>> {
    const snapshot = this.snapshotInput(input);
    const key = `${snapshot.workspaceHash}:${snapshot.resourceDigest}`;
    if (this.consumed.has(key)) return this.notPerformed('attempt-already-consumed');
    if (!await handlers.confirm(snapshot)) return this.notPerformed('operator-cancelled');
    if (!await handlers.reauthorize(snapshot)) {
      return this.notPerformed('authority-changed-after-confirmation');
    }
    if (this.consumed.has(key)) return this.notPerformed('attempt-already-consumed');

    const attemptId = this.id();
    const reservedAt = this.now();
    const reservation = this.ledger.reserve({
      workspaceHash: snapshot.workspaceHash,
      bindingDigest: snapshot.bindingDigest,
      resourceDigest: snapshot.resourceDigest,
      attemptId,
      reservedAt,
    });
    if (reservation === 'consumed') {
      this.consumed.add(key);
      return this.notPerformed('attempt-already-consumed');
    }
    if (reservation !== 'reserved') return this.notPerformed('attempt-ledger-unavailable');
    this.consumed.add(key);
    let outcome: Awaited<ReturnType<CustomerMarketingTelegramCanarySendHandlers['execute']>>;
    try {
      outcome = await handlers.execute(Object.freeze({ ...snapshot, attemptId }));
    } catch {
      outcome = { outcome: 'unknown', detail: 'external-outcome-unknown' };
    }
    if (outcome.outcome === 'not_performed') {
      return this.notPerformed(safeNotPerformedDetail(outcome.detail));
    }
    const canonical = {
      attemptId,
      bindingDigest: snapshot.bindingDigest,
      resourceDigest: snapshot.resourceDigest,
      createdAt: reservedAt,
      outcome: outcome.outcome,
    };
    const receipt = {
      ...canonical,
      receiptDigest: createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex'),
    };
    return {
      ok: outcome.outcome === 'performed',
      outcome: outcome.outcome,
      receipt,
      detail: outcome.outcome === 'performed'
        ? 'private-canary-send-complete'
        : 'external-outcome-unknown',
    };
  }

  private snapshotInput(
    input: CustomerMarketingTelegramCanarySendCoordinatorInput,
  ): Readonly<CustomerMarketingTelegramCanarySendCoordinatorInput> {
    const snapshot = {
      workspaceHash: input.workspaceHash,
      bindingDigest: input.bindingDigest,
      resourceDigest: input.resourceDigest,
      text: input.text,
    };
    if (!SHA256_PATTERN.test(snapshot.workspaceHash)
      || !SHA256_PATTERN.test(snapshot.bindingDigest)
      || !SHA256_PATTERN.test(snapshot.resourceDigest)
      || snapshot.text !== snapshot.text.trim()
      || snapshot.text.length < 1
      || snapshot.text.length > 4_096
      || /[\u0000\u007f]/.test(snapshot.text)) throw new Error('Invalid Telegram canary send input.');
    return Object.freeze(snapshot);
  }

  private notPerformed(
    detail: string,
  ): Pick<CustomerMarketingTelegramCanarySendResult, 'ok' | 'outcome' | 'receipt' | 'detail'> {
    return { ok: false, outcome: 'not_performed', receipt: null, detail };
  }
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value);
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

const SAFE_NOT_PERFORMED_DETAILS = new Set([
  'authority-changed-after-confirmation',
  'state-changed-after-confirmation',
  'source-changed-after-confirmation',
  'credential-or-chat-unavailable',
  'request-invalid',
  'resource-digest-mismatch',
  'rate-limited',
  'execute-policy-blocked',
  'approval-invalid',
  'preflight-changed-after-confirmation',
]);

function safeNotPerformedDetail(value: string | undefined): string {
  return value && SAFE_NOT_PERFORMED_DETAILS.has(value)
    ? value
    : 'external-operation-not-performed';
}
