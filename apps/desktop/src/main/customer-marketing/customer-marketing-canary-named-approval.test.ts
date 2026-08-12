import { describe, expect, it } from 'vitest';
import type { CustomerMarketingSafeStorage } from './customer-marketing-credential-vault';
import {
  CustomerMarketingCanaryNamedApprovalStore,
  parseCustomerMarketingCanaryNamedApprovalRequest,
} from './customer-marketing-canary-named-approval';

class MemorySettings {
  readonly values = new Map<string, string>();
  getSetting(key: string): string | null { return this.values.get(key) ?? null; }
  setSetting(key: string, value: string): void { this.values.set(key, value); }
  deleteSetting(key: string): void { this.values.delete(key); }
}

class FakeSafeStorage implements CustomerMarketingSafeStorage {
  available = true;
  isEncryptionAvailable(): boolean { return this.available; }
  encryptString(value: string): Buffer { return Buffer.from(value, 'utf8').reverse(); }
  decryptString(value: Buffer): string { return Buffer.from(value).reverse().toString('utf8'); }
}

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const REQUEST = {
  workflowId: 'cmr306-social-workflow-1',
  manifestDigest: 'a'.repeat(64),
  resourceDigest: 'b'.repeat(64),
  expectedRevision: 3,
};
const NOW = '2026-08-12T15:00:00.000Z';

describe('Customer Marketing canary named approval store', () => {
  it('parses only the exact candidate binding supplied by the renderer', () => {
    expect(parseCustomerMarketingCanaryNamedApprovalRequest(REQUEST)).toEqual(REQUEST);
    expect(parseCustomerMarketingCanaryNamedApprovalRequest({ ...REQUEST, reviewer: 'renderer' })).toBeNull();
    expect(parseCustomerMarketingCanaryNamedApprovalRequest({ ...REQUEST, expiresAt: NOW })).toBeNull();
    expect(parseCustomerMarketingCanaryNamedApprovalRequest({ ...REQUEST, expectedRevision: -1 })).toBeNull();
  });

  it('persists a main-owned 15-minute approval without enabling or external action', () => {
    const db = new MemorySettings();
    const encryption = new FakeSafeStorage();
    const store = new CustomerMarketingCanaryNamedApprovalStore(
      db,
      encryption,
      () => NOW,
      () => 'approval-cmr230b-0001',
    );

    const receipt = store.issue(WORKSPACE_ID, REQUEST, 'Nguyễn Nghĩa', 'user-owner-1');

    expect(receipt).toMatchObject({
      provider: 'telegram',
      operation: 'private_sandbox_send',
      manifestDigest: REQUEST.manifestDigest,
      resourceDigest: REQUEST.resourceDigest,
      expectedRevision: 3,
      approval: {
        approvalId: 'approval-cmr230b-0001',
        reviewer: 'Nguyễn Nghĩa',
        reviewerHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        manifestDigest: REQUEST.manifestDigest,
        expiresAt: '2026-08-12T15:15:00.000Z',
      },
      approvedAt: NOW,
      externalActionPerformed: false,
      receiptDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(receipt)).not.toContain('enabled');
    expect(JSON.stringify([...db.values])).not.toContain('Nguyễn Nghĩa');
    expect(JSON.stringify([...db.values])).not.toContain(REQUEST.resourceDigest);

    const afterRestart = new CustomerMarketingCanaryNamedApprovalStore(db, encryption, () => NOW);
    expect(afterRestart.getActive(WORKSPACE_ID, 'user-owner-1')).toEqual(receipt);
    expect(afterRestart.getActive(WORKSPACE_ID, 'user-owner-2')).toBeNull();
  });

  it('isolates workspaces and fails closed on expiry or tampering', () => {
    const db = new MemorySettings();
    const encryption = new FakeSafeStorage();
    let now = NOW;
    const store = new CustomerMarketingCanaryNamedApprovalStore(
      db,
      encryption,
      () => now,
      () => 'approval-cmr230b-0002',
    );
    store.issue(WORKSPACE_ID, REQUEST, 'Owner A', 'user-owner-a');

    expect(store.getActive('22222222-2222-4222-8222-222222222222', 'user-owner-a')).toBeNull();
    const [key, raw] = [...db.values.entries()][0];
    db.values.set(key, `${raw.slice(0, -2)}xx`);
    expect(store.getActive(WORKSPACE_ID, 'user-owner-a')).toBeNull();

    store.issue(WORKSPACE_ID, REQUEST, 'Owner A', 'user-owner-a');
    now = '2026-08-12T15:15:00.000Z';
    expect(store.getActive(WORKSPACE_ID, 'user-owner-a')).toBeNull();
  });

  it('replays the same active approval and rejects a competing binding', () => {
    const db = new MemorySettings();
    const encryption = new FakeSafeStorage();
    let sequence = 0;
    const store = new CustomerMarketingCanaryNamedApprovalStore(
      db,
      encryption,
      () => NOW,
      () => `approval-cmr230b-${String(++sequence).padStart(4, '0')}`,
    );
    const first = store.issue(WORKSPACE_ID, REQUEST, 'Owner A', 'user-owner-a');

    expect(store.issue(WORKSPACE_ID, REQUEST, 'Owner A', 'user-owner-a')).toEqual(first);
    expect(sequence).toBe(1);
    expect(() => store.issue(WORKSPACE_ID, { ...REQUEST, resourceDigest: 'c'.repeat(64) }, 'Owner A', 'user-owner-a'))
      .toThrow('Active canary named approval conflict.');
    expect(store.getActive(WORKSPACE_ID, 'user-owner-a')).toEqual(first);
  });

  it('fails closed when the clock source is not canonical', () => {
    const db = new MemorySettings();
    const encryption = new FakeSafeStorage();
    const writer = new CustomerMarketingCanaryNamedApprovalStore(db, encryption, () => NOW, () => 'approval-clock-1');
    writer.issue(WORKSPACE_ID, REQUEST, 'Owner A', 'user-owner-a');
    const invalidClock = new CustomerMarketingCanaryNamedApprovalStore(db, encryption, () => 'not-a-time');
    expect(invalidClock.getActive(WORKSPACE_ID, 'user-owner-a')).toBeNull();
  });

  it('fails closed when OS encryption is unavailable and writes no plaintext', () => {
    const db = new MemorySettings();
    const encryption = new FakeSafeStorage();
    encryption.available = false;
    const store = new CustomerMarketingCanaryNamedApprovalStore(db, encryption, () => NOW);
    expect(() => store.issue(WORKSPACE_ID, REQUEST, 'Owner A', 'user-owner-a'))
      .toThrow('Canary named approval encryption is unavailable.');
    expect(db.values.size).toBe(0);
  });
});
