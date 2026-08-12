import { createHash } from 'node:crypto';
import { safeStorage } from 'electron';
import type { CustomerMarketingSafeStorage } from './customer-marketing-credential-vault';

interface TelegramSandboxSettingsStore {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
  deleteSetting(key: string): void;
}

interface TelegramSandboxEnvelopeV1 {
  version: 1;
  workspaceHash: string;
  privateSandboxChatId: string;
}

const STORAGE_PREFIX = 'customer_marketing_telegram_sandbox:v1';
const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_SANDBOX_CHAT_ID_PATTERN = /^-100[1-9][0-9]{5,19}$/;

function hashWorkspaceId(workspaceId: string): string {
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new Error('Invalid customer marketing workspace.');
  }
  return createHash('sha256').update(workspaceId.toLowerCase(), 'utf8').digest('hex');
}

function assertPrivateSandboxChatId(value: string): void {
  if (!PRIVATE_SANDBOX_CHAT_ID_PATTERN.test(value)) {
    throw new Error('Invalid Telegram private sandbox chat.');
  }
}

export class CustomerMarketingTelegramSandboxConfigStore {
  constructor(
    private readonly db: TelegramSandboxSettingsStore,
    private readonly encryption: CustomerMarketingSafeStorage = safeStorage,
  ) {}

  setPrivateSandboxChatId(workspaceId: string, privateSandboxChatId: string): void {
    const workspaceHash = hashWorkspaceId(workspaceId);
    assertPrivateSandboxChatId(privateSandboxChatId);
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error('Telegram sandbox encryption is unavailable.');
    }
    const envelope: TelegramSandboxEnvelopeV1 = {
      version: 1,
      workspaceHash,
      privateSandboxChatId,
    };
    let ciphertext: Buffer;
    try {
      ciphertext = this.encryption.encryptString(JSON.stringify(envelope));
    } catch {
      throw new Error('Telegram sandbox encryption failed.');
    }
    if (!Buffer.isBuffer(ciphertext) || ciphertext.length === 0) {
      throw new Error('Telegram sandbox encryption failed.');
    }
    this.db.setSetting(this.storageKey(workspaceHash), ciphertext.toString('base64'));
  }

  getPrivateSandboxChatId(workspaceId: string): string | null {
    const workspaceHash = hashWorkspaceId(workspaceId);
    if (!this.encryption.isEncryptionAvailable()) return null;
    const stored = this.db.getSetting(this.storageKey(workspaceHash));
    if (!stored) return null;
    try {
      const decrypted = this.encryption.decryptString(Buffer.from(stored, 'base64'));
      const parsed = JSON.parse(decrypted) as Partial<TelegramSandboxEnvelopeV1>;
      if (parsed.version !== 1
        || parsed.workspaceHash !== workspaceHash
        || typeof parsed.privateSandboxChatId !== 'string'
        || !PRIVATE_SANDBOX_CHAT_ID_PATTERN.test(parsed.privateSandboxChatId)) {
        return null;
      }
      return parsed.privateSandboxChatId;
    } catch {
      return null;
    }
  }

  isConfigured(workspaceId: string): boolean {
    return this.getPrivateSandboxChatId(workspaceId) !== null;
  }

  clear(workspaceId: string): boolean {
    const workspaceHash = hashWorkspaceId(workspaceId);
    const key = this.storageKey(workspaceHash);
    const existed = this.db.getSetting(key) !== null;
    this.db.deleteSetting(key);
    return existed;
  }

  private storageKey(workspaceHash: string): string {
    return `${STORAGE_PREFIX}:${workspaceHash}`;
  }
}
