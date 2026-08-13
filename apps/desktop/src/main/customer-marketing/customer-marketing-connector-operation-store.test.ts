import { describe, expect, it } from 'vitest';
import {
  CustomerMarketingConnectorOperationStore,
  parseCustomerMarketingConnectorOperationInput,
} from './customer-marketing-connector-operation-store';

class MemorySettings {
  readonly values = new Map<string, string>();
  getSetting(key: string): string | null { return this.values.get(key) ?? null; }
  setSetting(key: string, value: string): void { this.values.set(key, value); }
}

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-08-13T09:00:00.000Z';
const SOURCE_RECEIPT_DIGEST = 'a'.repeat(64);

function healthInput(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'telegram',
    operation: 'health',
    outcome: 'ready',
    occurredAt: NOW,
    externalActionPerformed: false,
    sourceReceiptDigest: null,
    ...overrides,
  };
}

describe('CustomerMarketingConnectorOperationStore', () => {
  it('parses only exact redacted operation metadata', () => {
    expect(parseCustomerMarketingConnectorOperationInput(healthInput())).toEqual(healthInput());
    const rejected = [
      { ...healthInput(), provider: 'unknown' },
      { ...healthInput(), operation: 'execute' },
      { ...healthInput(), outcome: 'performed' },
      { ...healthInput(), occurredAt: 'not-a-time' },
      { ...healthInput(), externalActionPerformed: true },
      { ...healthInput(), token: 'secret-token' },
      { ...healthInput(), chatId: '-1001234567890' },
      { ...healthInput(), message: 'private text' },
      { ...healthInput(), endpoint: 'https://api.example.test' },
      { ...healthInput(), sourceReceiptDigest: 'bad' },
    ];
    rejected.forEach((value) => expect(parseCustomerMarketingConnectorOperationInput(value)).toBeNull());

    expect(parseCustomerMarketingConnectorOperationInput({
      ...healthInput(),
      operation: 'revoke',
      outcome: 'revoked',
    })).not.toBeNull();
    expect(parseCustomerMarketingConnectorOperationInput({
      ...healthInput(),
      operation: 'private_sandbox_send',
      outcome: 'performed',
      externalActionPerformed: true,
      sourceReceiptDigest: SOURCE_RECEIPT_DIGEST,
    })).not.toBeNull();
  });

  it('starts ready and empty without writing storage', () => {
    const settings = new MemorySettings();
    const store = new CustomerMarketingConnectorOperationStore(settings);

    expect(store.snapshot(WORKSPACE_ID)).toEqual({
      status: 'ready',
      revision: 0,
      receipts: [],
    });
    expect(settings.values.size).toBe(0);
  });

  it('persists a redacted receipt through restart with optimistic revision', () => {
    const settings = new MemorySettings();
    const first = new CustomerMarketingConnectorOperationStore(
      settings,
      () => 'connector-operation-0001',
    );

    const receipt = first.record(WORKSPACE_ID, 0, healthInput());
    expect(receipt).toEqual({
      id: 'connector-operation-0001',
      provider: 'telegram',
      operation: 'health',
      outcome: 'ready',
      occurredAt: NOW,
      externalActionPerformed: false,
      sourceReceiptDigest: null,
      stateRevision: 1,
      receiptDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });

    const afterRestart = new CustomerMarketingConnectorOperationStore(settings);
    expect(afterRestart.snapshot(WORKSPACE_ID)).toEqual({
      status: 'ready',
      revision: 1,
      receipts: [receipt],
    });
    const serialized = JSON.stringify([...settings.values]);
    expect(serialized).not.toContain(WORKSPACE_ID);
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('chatId');
    expect(serialized).not.toContain('message');
    expect(serialized).not.toContain('endpoint');
  });

  it('isolates workspaces and rejects stale revisions', () => {
    const settings = new MemorySettings();
    const store = new CustomerMarketingConnectorOperationStore(settings);
    store.record(WORKSPACE_ID, 0, healthInput());

    expect(store.snapshot(OTHER_WORKSPACE_ID)).toMatchObject({ revision: 0, receipts: [] });
    expect(() => store.record(WORKSPACE_ID, 0, healthInput({ provider: 'x' })))
      .toThrow('Connector operation state revision conflict.');
    expect(store.snapshot(WORKSPACE_ID).revision).toBe(1);
  });

  it('retains only the newest 50 receipts while revision keeps increasing', () => {
    const settings = new MemorySettings();
    let sequence = 0;
    const store = new CustomerMarketingConnectorOperationStore(
      settings,
      () => `connector-operation-${String(++sequence).padStart(4, '0')}`,
    );
    for (let index = 0; index < 55; index += 1) {
      store.record(WORKSPACE_ID, index, healthInput({
        provider: index % 2 === 0 ? 'telegram' : 'x',
        occurredAt: new Date(Date.parse(NOW) + index * 1_000).toISOString(),
      }));
    }

    const snapshot = store.snapshot(WORKSPACE_ID);
    expect(snapshot.revision).toBe(55);
    expect(snapshot.receipts).toHaveLength(50);
    expect(snapshot.receipts[0].stateRevision).toBe(6);
    expect(snapshot.receipts.at(-1)?.stateRevision).toBe(55);
  });

  it('fails closed on tampering and never overwrites damaged evidence', () => {
    const settings = new MemorySettings();
    const store = new CustomerMarketingConnectorOperationStore(settings);
    store.record(WORKSPACE_ID, 0, healthInput());
    const [key, raw] = [...settings.values.entries()][0];
    const parsed = JSON.parse(raw) as { receipts: Array<{ outcome: string }> };
    parsed.receipts[0].outcome = 'unavailable';
    settings.values.set(key, JSON.stringify(parsed));

    expect(store.snapshot(WORKSPACE_ID)).toEqual({
      status: 'unavailable',
      revision: 0,
      receipts: [],
    });
    expect(() => store.record(WORKSPACE_ID, 0, healthInput()))
      .toThrow('Connector operation store is unavailable.');
    expect(settings.values.get(key)).toBe(JSON.stringify(parsed));
  });

  it('fails closed on storage read or write errors', () => {
    const readFailure = new MemorySettings();
    readFailure.getSetting = () => { throw new Error('disk read failure'); };
    const reader = new CustomerMarketingConnectorOperationStore(readFailure);
    expect(reader.snapshot(WORKSPACE_ID).status).toBe('unavailable');
    expect(() => reader.record(WORKSPACE_ID, 0, healthInput()))
      .toThrow('Connector operation store is unavailable.');

    const writeFailure = new MemorySettings();
    writeFailure.setSetting = () => { throw new Error('disk write failure'); };
    const writer = new CustomerMarketingConnectorOperationStore(writeFailure);
    expect(() => writer.record(WORKSPACE_ID, 0, healthInput()))
      .toThrow('Connector operation persistence failed.');
    expect(writer.snapshot(WORKSPACE_ID)).toMatchObject({ revision: 0, receipts: [] });
  });
});
