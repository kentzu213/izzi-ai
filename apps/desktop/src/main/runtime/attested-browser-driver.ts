import type { BrowserRuntimeSpec } from '../../shared/runtime';
import type {
  IsolatedBrowserDriver,
  IsolatedBrowserSession,
} from './browser-runtime';

export interface BrowserDriverAttestation {
  readonly schemaVersion: 1;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly driver: 'playwright';
  readonly driverDigest: string;
  readonly packageId: string;
  readonly allowedOrigins: readonly string[];
  readonly verifiedAt: string;
  readonly expiresAt: string;
}

const DIGEST = /^sha256:[a-f0-9]{64}$/;

function exact(value: string, path: string): string {
  if (!value || value !== value.trim() || value.length > 256 || /[\0\r\n*]/.test(value)) {
    throw new Error(`${path}: invalid attestation value`);
  }
  return value;
}

function origin(value: string): string {
  const parsed = new URL(value);
  if (parsed.origin !== value || !['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('attestation.allowedOrigins: exact HTTP(S) origins required');
  }
  return value;
}

export class AttestedBrowserDriver implements IsolatedBrowserDriver {
  readonly idempotentReplaySafe = true;

  constructor(
    private readonly driver: IsolatedBrowserDriver,
    private readonly attestation: BrowserDriverAttestation,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (!driver.idempotentReplaySafe) {
      throw new Error('Browser driver must support idempotent replay');
    }
    this.validateAttestation();
  }

  async open(
    spec: BrowserRuntimeSpec,
    encryptedStorageState: string | null,
  ): Promise<IsolatedBrowserSession> {
    this.validateAttestation();
    if (!spec.visibleReviewMode) {
      throw new Error('Attested browser requires visible review mode');
    }
    if (spec.storageStateRef.store !== 'encrypted_file') {
      throw new Error('Attested browser requires encrypted storage state');
    }
    if (spec.authority.packageId !== this.attestation.packageId) {
      throw new Error('Runtime package does not match browser attestation');
    }
    const allowed = new Set(this.attestation.allowedOrigins);
    if (
      spec.network.mode !== 'allowlist'
      || spec.network.allowedOrigins.length === 0
      || spec.network.allowedOrigins.some((candidate) => !allowed.has(candidate))
    ) {
      throw new Error('Runtime origin allowlist exceeds browser attestation');
    }
    return this.driver.open(spec, encryptedStorageState);
  }

  private validateAttestation(): void {
    if (this.attestation.schemaVersion !== 1 || this.attestation.driver !== 'playwright') {
      throw new Error('Unsupported browser driver attestation');
    }
    exact(this.attestation.adapterId, 'attestation.adapterId');
    exact(this.attestation.adapterVersion, 'attestation.adapterVersion');
    exact(this.attestation.packageId, 'attestation.packageId');
    if (!DIGEST.test(this.attestation.driverDigest)) {
      throw new Error('attestation.driverDigest: sha256 digest required');
    }
    if (this.attestation.allowedOrigins.length === 0) {
      throw new Error('attestation.allowedOrigins: at least one origin required');
    }
    const origins = this.attestation.allowedOrigins.map(origin);
    if (new Set(origins).size !== origins.length) {
      throw new Error('attestation.allowedOrigins: duplicates are forbidden');
    }
    const verifiedAt = new Date(this.attestation.verifiedAt);
    const expiresAt = new Date(this.attestation.expiresAt);
    const now = this.clock();
    if (
      Number.isNaN(verifiedAt.getTime())
      || Number.isNaN(expiresAt.getTime())
      || verifiedAt > now
      || expiresAt <= now
    ) {
      throw new Error('Browser driver attestation is not currently valid');
    }
  }
}
