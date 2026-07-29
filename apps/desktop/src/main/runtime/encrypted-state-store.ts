import * as fs from 'fs';
import * as path from 'path';

export interface RuntimeEncryptionProvider {
  isAvailable(): boolean;
  encrypt(plaintext: Buffer): Buffer;
  decrypt(ciphertext: Buffer): Buffer;
}
export class RuntimeEncryptionUnavailableError extends Error {
  constructor() {
    super('OS-backed runtime encryption is unavailable');
    this.name = 'RuntimeEncryptionUnavailableError';
  }
}

export class EncryptedBrowserStateStore {
  constructor(
    private readonly root: string,
    private readonly encryption: RuntimeEncryptionProvider,
  ) {}

  async write(scopeKey: string, storageState: string): Promise<void> {
    if (!this.encryption.isAvailable()) throw new RuntimeEncryptionUnavailableError();
    const file = this.fileFor(scopeKey);
    await fs.promises.mkdir(this.root, { recursive: true, mode: 0o700 });
    const ciphertext = this.encryption.encrypt(Buffer.from(storageState, 'utf8')).toString('base64');
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(temp, ciphertext, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.promises.rename(temp, file);
  }

  async read(scopeKey: string): Promise<string | null> {
    if (!this.encryption.isAvailable()) throw new RuntimeEncryptionUnavailableError();
    try {
      const encoded = await fs.promises.readFile(this.fileFor(scopeKey), 'utf8');
      return this.encryption.decrypt(Buffer.from(encoded, 'base64')).toString('utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private fileFor(scopeKey: string): string {
    if (!/^[a-zA-Z0-9._-]{3,160}$/.test(scopeKey)) throw new Error('Invalid browser state key');
    return path.join(this.root, `${scopeKey}.state`);
  }
}
