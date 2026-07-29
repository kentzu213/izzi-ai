import { describe, expect, it } from 'vitest';
import {
  SafeStorageRuntimeEncryptionError,
  SafeStorageRuntimeEncryptionProvider,
  type ElectronSafeStoragePort,
} from './safe-storage-encryption';

class FakeSafeStorage implements ElectronSafeStoragePort {
  constructor(
    private readonly available = true,
    private readonly tamper = false,
  ) {}
  isEncryptionAvailable() {
    return this.available;
  }
  encryptString(value: string) {
    return Buffer.from(`encrypted:${value}`, 'utf8');
  }
  decryptString(value: Buffer) {
    const decoded = value.toString('utf8').replace(/^encrypted:/, '');
    return this.tamper ? 'wrong-envelope' : decoded;
  }
}

describe('SafeStorageRuntimeEncryptionProvider', () => {
  it('round-trips bytes only through an OS-backed envelope', () => {
    const provider = new SafeStorageRuntimeEncryptionProvider(
      new FakeSafeStorage(),
    );
    const plaintext = Buffer.from('private browser evidence', 'utf8');
    const ciphertext = provider.encrypt(plaintext);
    expect(ciphertext.equals(plaintext)).toBe(false);
    expect(provider.decrypt(ciphertext)).toEqual(plaintext);
  });

  it('fails closed when safeStorage is unavailable or returns a bad envelope', () => {
    const unavailable = new SafeStorageRuntimeEncryptionProvider(
      new FakeSafeStorage(false),
    );
    expect(() => unavailable.encrypt(Buffer.from('evidence')))
      .toThrow(SafeStorageRuntimeEncryptionError);

    const tampered = new SafeStorageRuntimeEncryptionProvider(
      new FakeSafeStorage(true, true),
    );
    const ciphertext = tampered.encrypt(Buffer.from('evidence'));
    expect(() => tampered.decrypt(ciphertext))
      .toThrow(SafeStorageRuntimeEncryptionError);
  });

  it('rejects a provider that returns plaintext as ciphertext', () => {
    const noop: ElectronSafeStoragePort = {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(
        Buffer.from(value.slice('izzi-runtime:v1:'.length), 'base64'),
      ),
      decryptString: () => '',
    };
    expect(() => new SafeStorageRuntimeEncryptionProvider(noop)
      .encrypt(Buffer.from('evidence')))
      .toThrow(SafeStorageRuntimeEncryptionError);
  });
});
