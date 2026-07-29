import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EncryptedBrowserStateStore,
  RuntimeEncryptionUnavailableError,
  type RuntimeEncryptionProvider,
} from './encrypted-state-store';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
class TestEncryption implements RuntimeEncryptionProvider {
  constructor(private readonly available = true) {}
  isAvailable() {
    return this.available;
  }
  encrypt(plaintext: Buffer) {
    return Buffer.from([...plaintext].map((byte) => byte ^ 0xa5));
  }
  decrypt(ciphertext: Buffer) {
    return this.encrypt(ciphertext);
  }
}

describe('EncryptedBrowserStateStore', () => {
  it('never stores plaintext storageState', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'izzi-browser-state-'));
    roots.push(root);
    const store = new EncryptedBrowserStateStore(root, new TestEncryption());
    const plaintext = '{"cookies":[{"name":"session","value":"private-cookie"}]}';
    await store.write('workspace.package.integration', plaintext);
    const raw = fs.readFileSync(path.join(root, 'workspace.package.integration.state'), 'utf8');
    expect(raw).not.toContain('private-cookie');
    expect(await store.read('workspace.package.integration')).toBe(plaintext);
  });

  it('fails closed when OS-backed encryption is unavailable', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'izzi-browser-state-'));
    roots.push(root);
    const store = new EncryptedBrowserStateStore(root, new TestEncryption(false));
    await expect(store.write('workspace.package.integration', '{}')).rejects.toBeInstanceOf(
      RuntimeEncryptionUnavailableError,
    );
  });
});
