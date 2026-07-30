import type { RuntimeEncryptionProvider } from './encrypted-state-store';

const ENVELOPE_PREFIX = 'izzi-runtime:v1:';
const MAX_PLAINTEXT_BYTES = 1024 * 1024;

export interface ElectronSafeStoragePort {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export class SafeStorageRuntimeEncryptionError extends Error {
  constructor() {
    super('OS-backed runtime encryption is unavailable');
    this.name = 'SafeStorageRuntimeEncryptionError';
  }
}

/**
 * Production adapter for Electron safeStorage. The main composition root must
 * inject Electron's safeStorage object; tests and non-Electron processes never
 * import or initialize Electron through this module.
 */
export class SafeStorageRuntimeEncryptionProvider implements RuntimeEncryptionProvider {
  constructor(private readonly storage: ElectronSafeStoragePort) {}

  isAvailable(): boolean {
    try {
      return this.storage.isEncryptionAvailable() === true;
    } catch {
      return false;
    }
  }

  encrypt(plaintext: Buffer): Buffer {
    if (
      !this.isAvailable()
      || !Buffer.isBuffer(plaintext)
      || plaintext.length === 0
      || plaintext.length > MAX_PLAINTEXT_BYTES
    ) {
      throw new SafeStorageRuntimeEncryptionError();
    }
    try {
      const ciphertext = this.storage.encryptString(
        `${ENVELOPE_PREFIX}${plaintext.toString('base64')}`,
      );
      if (
        !Buffer.isBuffer(ciphertext)
        || ciphertext.length === 0
        || ciphertext.equals(plaintext)
      ) {
        throw new Error('invalid ciphertext');
      }
      return ciphertext;
    } catch {
      throw new SafeStorageRuntimeEncryptionError();
    }
  }

  decrypt(ciphertext: Buffer): Buffer {
    if (
      !this.isAvailable()
      || !Buffer.isBuffer(ciphertext)
      || ciphertext.length === 0
      || ciphertext.length > MAX_PLAINTEXT_BYTES * 2
    ) {
      throw new SafeStorageRuntimeEncryptionError();
    }
    try {
      const envelope = this.storage.decryptString(ciphertext);
      if (!envelope.startsWith(ENVELOPE_PREFIX)) {
        throw new Error('invalid envelope');
      }
      const encoded = envelope.slice(ENVELOPE_PREFIX.length);
      if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
        throw new Error('invalid base64');
      }
      const plaintext = Buffer.from(encoded, 'base64');
      if (
        plaintext.length === 0
        || plaintext.length > MAX_PLAINTEXT_BYTES
        || plaintext.toString('base64') !== encoded
      ) {
        throw new Error('non-canonical base64');
      }
      return plaintext;
    } catch {
      throw new SafeStorageRuntimeEncryptionError();
    }
  }
}
