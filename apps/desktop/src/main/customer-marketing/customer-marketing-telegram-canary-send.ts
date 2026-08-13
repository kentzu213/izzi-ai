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
  ledger?: CustomerMarketingTelegramCanarySendAttemptLedger;
}

export interface CustomerMarketingTelegramCanarySendHandlers {
  confirm(input: CustomerMarketingTelegramCanarySendCoordinatorInput): Promise<boolean>;
  execute(input: CustomerMarketingTelegramCanarySendCoordinatorInput & {
    attemptId: string;
  }): Promise<{ outcome: CustomerMarketingTelegramCanarySendOutcome; detail?: string }>;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STORAGE_PREFIX = 'customer_marketing_telegram_canary_send:v1';

interface CustomerMarketingTelegramCanarySendSettings {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
}

interface CustomerMarketingTelegramCanarySendReservation {
  workspaceHash: string;
  bindingDigest: string;
  resourceDigest: string;
  attemptId: string;
  reservedAt: string;
}

export interface CustomerMarketingTelegramCanarySendAttemptLedger {
  reserve(input: CustomerMarketingTelegramCanarySendReservation): 'reserved' | 'consumed' | 'unavailable';
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
      if (this.settings.getSetting(key) !== null) return 'consumed';
      const value = JSON.stringify({ version: 1, ...input });
      this.settings.setSetting(key, value);
      return this.settings.getSetting(key) === value ? 'reserved' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  }
}

class CustomerMarketingInMemorySendLedger implements CustomerMarketingTelegramCanarySendAttemptLedger {
  private readonly keys = new Set<string>();

  reserve(input: CustomerMarketingTelegramCanarySendReservation): 'reserved' | 'consumed' {
    const key = `${input.workspaceHash}:${input.resourceDigest}`;
    if (this.keys.has(key)) return 'consumed';
    this.keys.add(key);
    return 'reserved';
  }
}

export class CustomerMarketingTelegramCanarySendCoordinator {
  private readonly consumed = new Set<string>();
  private readonly now: () => string;
  private readonly id: () => string;
  private readonly ledger: CustomerMarketingTelegramCanarySendAttemptLedger;

  constructor(options: CustomerMarketingTelegramCanarySendCoordinatorOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.id = options.id ?? (() => `canary-send-${randomUUID()}`);
    this.ledger = options.ledger ?? new CustomerMarketingInMemorySendLedger();
  }

  async send(
    input: CustomerMarketingTelegramCanarySendCoordinatorInput,
    handlers: CustomerMarketingTelegramCanarySendHandlers,
  ): Promise<Pick<CustomerMarketingTelegramCanarySendResult, 'ok' | 'outcome' | 'receipt' | 'detail'>> {
    this.assertInput(input);
    const key = `${input.workspaceHash}:${input.resourceDigest}`;
    if (this.consumed.has(key)) return this.notPerformed('attempt-already-consumed');
    if (!await handlers.confirm(input)) return this.notPerformed('operator-cancelled');
    if (this.consumed.has(key)) return this.notPerformed('attempt-already-consumed');

    const attemptId = this.id();
    const reservedAt = this.now();
    const reservation = this.ledger.reserve({
      workspaceHash: input.workspaceHash,
      bindingDigest: input.bindingDigest,
      resourceDigest: input.resourceDigest,
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
      outcome = await handlers.execute({ ...input, attemptId });
    } catch {
      outcome = { outcome: 'unknown', detail: 'external-outcome-unknown' };
    }
    if (outcome.outcome === 'not_performed') {
      return this.notPerformed(outcome.detail ?? 'preflight-changed-after-confirmation');
    }
    const canonical = {
      attemptId,
      bindingDigest: input.bindingDigest,
      resourceDigest: input.resourceDigest,
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
        : outcome.detail ?? 'external-outcome-unknown',
    };
  }

  private assertInput(input: CustomerMarketingTelegramCanarySendCoordinatorInput): void {
    if (!SHA256_PATTERN.test(input.workspaceHash)
      || !SHA256_PATTERN.test(input.bindingDigest)
      || !SHA256_PATTERN.test(input.resourceDigest)
      || input.text !== input.text.trim()
      || input.text.length < 1
      || input.text.length > 4_096
      || /[\u0000\u007f]/.test(input.text)) throw new Error('Invalid Telegram canary send input.');
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

function isCanonicalIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
