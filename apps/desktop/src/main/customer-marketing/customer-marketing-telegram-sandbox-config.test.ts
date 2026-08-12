import { describe, expect, it } from 'vitest';
import type { CustomerMarketingSafeStorage } from './customer-marketing-credential-vault';
import { CustomerMarketingTelegramSandboxConfigStore } from './customer-marketing-telegram-sandbox-config';

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';
const CHAT_ID = '-1001234567890';

class MemorySettings {
  readonly values = new Map<string, string>();
  getSetting(key: string): string | null { return this.values.get(key) ?? null; }
  setSetting(key: string, value: string): void { this.values.set(key, value); }
  deleteSetting(key: string): void { this.values.delete(key); }
}

class FakeSafeStorage implements CustomerMarketingSafeStorage {
  available = true;
  throwOnEncrypt = false;
  isEncryptionAvailable(): boolean { return this.available; }
  encryptString(value: string): Buffer {
    if (this.throwOnEncrypt) throw new Error(value);
    return Buffer.from(value, 'utf8').reverse();
  }
  decryptString(value: Buffer): string { return Buffer.from(value).reverse().toString('utf8'); }
}

function fixture() {
  const db = new MemorySettings();
  const encryption = new FakeSafeStorage();
  const store = new CustomerMarketingTelegramSandboxConfigStore(db, encryption);
  return { db, encryption, store };
}

describe('CustomerMarketingTelegramSandboxConfigStore', () => {
  it('stores a private chat ID encrypted and workspace-scoped', () => {
    const { db, store } = fixture();
    store.setPrivateSandboxChatId(WORKSPACE_A, CHAT_ID);
    expect(db.values).toHaveLength(1);
    expect(JSON.stringify([...db.values])).not.toContain(CHAT_ID);
    expect(store.isConfigured(WORKSPACE_A)).toBe(true);
    expect(store.getPrivateSandboxChatId(WORKSPACE_A)).toBe(CHAT_ID);
    expect(store.getPrivateSandboxChatId(WORKSPACE_B)).toBeNull();
  });

  it('fails closed without OS encryption and leaves no plaintext', () => {
    const { db, encryption, store } = fixture();
    encryption.available = false;
    expect(() => store.setPrivateSandboxChatId(WORKSPACE_A, CHAT_ID))
      .toThrow('Telegram sandbox encryption is unavailable');
    expect(db.values.size).toBe(0);
    expect(store.isConfigured(WORKSPACE_A)).toBe(false);
  });

  it('preserves the previous encrypted value when replacement encryption fails', () => {
    const { db, encryption, store } = fixture();
    store.setPrivateSandboxChatId(WORKSPACE_A, CHAT_ID);
    const before = new Map(db.values);
    encryption.throwOnEncrypt = true;
    expect(() => store.setPrivateSandboxChatId(WORKSPACE_A, '-1009876543210'))
      .toThrow('Telegram sandbox encryption failed');
    expect(db.values).toEqual(before);
  });

  it('rejects malformed workspace and non-private chat IDs', () => {
    const { db, store } = fixture();
    expect(() => store.setPrivateSandboxChatId('renderer-workspace', CHAT_ID))
      .toThrow('Invalid customer marketing workspace');
    expect(() => store.setPrivateSandboxChatId(WORKSPACE_A, '123456789'))
      .toThrow('Invalid Telegram private sandbox chat');
    expect(db.values.size).toBe(0);
  });
});
