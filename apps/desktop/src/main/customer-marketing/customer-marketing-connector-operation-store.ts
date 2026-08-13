import { createHash, randomUUID } from 'node:crypto';
import {
  isCustomerMarketingIntegrationProvider,
} from '../../shared/customer-marketing-credential-types';
import type {
  CustomerMarketingConnectorOperation,
  CustomerMarketingConnectorOperationInput,
  CustomerMarketingConnectorOperationOutcome,
  CustomerMarketingConnectorOperationReceipt,
  CustomerMarketingConnectorOperationSnapshot,
} from '../../shared/customer-marketing-connector-operation-types';

interface ConnectorOperationSettings {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
}

interface StoredConnectorOperationsV1 {
  version: 1;
  workspaceHash: string;
  revision: number;
  receipts: CustomerMarketingConnectorOperationReceipt[];
  stateDigest: string;
}

const STORAGE_PREFIX = 'customer_marketing_connector_operations:v1';
const MAX_RECEIPTS = 50;
const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const OPERATIONS = new Set<CustomerMarketingConnectorOperation>([
  'health', 'revoke', 'private_sandbox_send',
]);
const OUTCOMES = new Set<CustomerMarketingConnectorOperationOutcome>([
  'ready', 'unavailable', 'revoked', 'not_found', 'performed', 'unknown', 'not_performed',
]);

export function parseCustomerMarketingConnectorOperationInput(
  value: unknown,
): CustomerMarketingConnectorOperationInput | null {
  if (!isExactPlainRecord(value, [
    'provider', 'operation', 'outcome', 'occurredAt',
    'externalActionPerformed', 'sourceReceiptDigest',
  ])
    || !isCustomerMarketingIntegrationProvider(value.provider)
    || typeof value.operation !== 'string'
    || !OPERATIONS.has(value.operation as CustomerMarketingConnectorOperation)
    || typeof value.outcome !== 'string'
    || !OUTCOMES.has(value.outcome as CustomerMarketingConnectorOperationOutcome)
    || !isCanonicalIsoTimestamp(value.occurredAt)
    || (typeof value.externalActionPerformed !== 'boolean' && value.externalActionPerformed !== null)
    || (value.sourceReceiptDigest !== null
      && (typeof value.sourceReceiptDigest !== 'string'
        || !SHA256_PATTERN.test(value.sourceReceiptDigest)))) return null;

  const operation = value.operation as CustomerMarketingConnectorOperation;
  const outcome = value.outcome as CustomerMarketingConnectorOperationOutcome;
  if (!validOperationOutcome(operation, outcome, value.externalActionPerformed)) return null;
  if (operation === 'private_sandbox_send'
    && outcome === 'performed'
    && value.sourceReceiptDigest === null) return null;
  if (operation !== 'private_sandbox_send' && value.sourceReceiptDigest !== null) return null;
  return value as unknown as CustomerMarketingConnectorOperationInput;
}

export class CustomerMarketingConnectorOperationStore {
  constructor(
    private readonly settings: ConnectorOperationSettings,
    private readonly createId: () => string = () => `connector-operation-${randomUUID()}`,
  ) {}

  snapshot(workspaceId: string): CustomerMarketingConnectorOperationSnapshot {
    const workspaceHash = hashWorkspaceId(workspaceId);
    const result = this.read(workspaceHash);
    return result.status === 'missing'
      ? { status: 'ready', revision: 0, receipts: [] }
      : result.status === 'invalid'
        ? { status: 'unavailable', revision: 0, receipts: [] }
        : { status: 'ready', revision: result.value.revision, receipts: [...result.value.receipts] };
  }

  record(
    workspaceId: string,
    expectedRevision: number,
    inputValue: unknown,
  ): CustomerMarketingConnectorOperationReceipt {
    const workspaceHash = hashWorkspaceId(workspaceId);
    const input = parseCustomerMarketingConnectorOperationInput(inputValue);
    if (!input) throw new Error('Invalid connector operation metadata.');
    const current = this.read(workspaceHash);
    if (current.status === 'invalid') throw new Error('Connector operation store is unavailable.');
    const revision = current.status === 'missing' ? 0 : current.value.revision;
    if (!Number.isSafeInteger(expectedRevision)
      || expectedRevision < 0
      || expectedRevision !== revision) {
      throw new Error('Connector operation state revision conflict.');
    }
    const id = this.createId();
    if (!IDENTIFIER_PATTERN.test(id)) throw new Error('Invalid connector operation receipt id.');
    const canonical = { id, ...input, stateRevision: revision + 1 };
    const receipt = { ...canonical, receiptDigest: digest(canonical) };
    const receipts = [
      ...(current.status === 'missing' ? [] : current.value.receipts),
      receipt,
    ].slice(-MAX_RECEIPTS);
    const stateCanonical = {
      version: 1 as const,
      workspaceHash,
      revision: revision + 1,
      receipts,
    };
    const stored: StoredConnectorOperationsV1 = {
      ...stateCanonical,
      stateDigest: digest(stateCanonical),
    };
    const key = storageKey(workspaceHash);
    const serialized = JSON.stringify(stored);
    try {
      this.settings.setSetting(key, serialized);
      if (this.settings.getSetting(key) !== serialized) {
        throw new Error('verification failed');
      }
    } catch {
      throw new Error('Connector operation persistence failed.');
    }
    return receipt;
  }

  private read(workspaceHash: string):
    | { status: 'missing' }
    | { status: 'invalid' }
    | { status: 'ready'; value: StoredConnectorOperationsV1 } {
    let raw: string | null;
    try {
      raw = this.settings.getSetting(storageKey(workspaceHash));
    } catch {
      return { status: 'invalid' };
    }
    if (raw === null) return { status: 'missing' };
    try {
      const parsed = JSON.parse(raw) as unknown;
      return validStoredState(parsed, workspaceHash)
        ? { status: 'ready', value: parsed }
        : { status: 'invalid' };
    } catch {
      return { status: 'invalid' };
    }
  }
}

function validStoredState(
  value: unknown,
  expectedWorkspaceHash: string,
): value is StoredConnectorOperationsV1 {
  if (!isExactPlainRecord(value, [
    'version', 'workspaceHash', 'revision', 'receipts', 'stateDigest',
  ])
    || value.version !== 1
    || value.workspaceHash !== expectedWorkspaceHash
    || typeof value.revision !== 'number'
    || !Number.isSafeInteger(value.revision)
    || value.revision < 1
    || !Array.isArray(value.receipts)
    || value.receipts.length < 1
    || value.receipts.length > MAX_RECEIPTS
    || typeof value.stateDigest !== 'string'
    || !SHA256_PATTERN.test(value.stateDigest)) return false;
  const receipts = value.receipts as unknown[];
  if (receipts.some((receipt) => !validReceipt(receipt))) return false;
  const revisions = receipts.map((receipt) => (receipt as CustomerMarketingConnectorOperationReceipt).stateRevision);
  if (revisions.at(-1) !== value.revision
    || revisions.some((revision, index) => index > 0 && revision !== revisions[index - 1] + 1)) return false;
  const { stateDigest, ...canonical } = value;
  return stateDigest === digest(canonical);
}

function validReceipt(value: unknown): value is CustomerMarketingConnectorOperationReceipt {
  if (!isExactPlainRecord(value, [
    'id', 'provider', 'operation', 'outcome', 'occurredAt', 'externalActionPerformed',
    'sourceReceiptDigest', 'stateRevision', 'receiptDigest',
  ])
    || typeof value.id !== 'string'
    || !IDENTIFIER_PATTERN.test(value.id)
    || typeof value.stateRevision !== 'number'
    || !Number.isSafeInteger(value.stateRevision)
    || value.stateRevision < 1
    || typeof value.receiptDigest !== 'string'
    || !SHA256_PATTERN.test(value.receiptDigest)
    || !parseCustomerMarketingConnectorOperationInput({
      provider: value.provider,
      operation: value.operation,
      outcome: value.outcome,
      occurredAt: value.occurredAt,
      externalActionPerformed: value.externalActionPerformed,
      sourceReceiptDigest: value.sourceReceiptDigest,
    })) return false;
  const { receiptDigest, ...canonical } = value;
  return receiptDigest === digest(canonical);
}

function validOperationOutcome(
  operation: CustomerMarketingConnectorOperation,
  outcome: CustomerMarketingConnectorOperationOutcome,
  externalActionPerformed: boolean | null,
): boolean {
  if (operation === 'health') {
    return !externalActionPerformed && (outcome === 'ready' || outcome === 'unavailable');
  }
  if (operation === 'revoke') {
    return !externalActionPerformed && (outcome === 'revoked' || outcome === 'not_found');
  }
  if (outcome === 'performed') return externalActionPerformed === true;
  if (outcome === 'unknown') return externalActionPerformed === null;
  return outcome === 'not_performed' && externalActionPerformed === false;
}

function hashWorkspaceId(workspaceId: string): string {
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new Error('Invalid customer marketing workspace.');
  }
  return createHash('sha256').update(workspaceId.toLowerCase(), 'utf8').digest('hex');
}

function storageKey(workspaceHash: string): string {
  return `${STORAGE_PREFIX}:${workspaceHash}`;
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isExactPlainRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function digest(value: object): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
