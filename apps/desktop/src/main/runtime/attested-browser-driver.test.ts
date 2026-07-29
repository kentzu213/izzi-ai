import { describe, expect, it, vi } from 'vitest';
import { secretRef } from '../../shared/personal-office';
import type { BrowserRuntimeSpec } from '../../shared/runtime';
import type { IsolatedBrowserDriver } from './browser-runtime';
import { AttestedBrowserDriver, type BrowserDriverAttestation } from './attested-browser-driver';

const NOW = new Date('2026-07-29T12:00:00.000Z');
const spec: BrowserRuntimeSpec = {
  schemaVersion: 1,
  id: 'runtime.browser.operational',
  kind: 'browser',
  authority: {
    tenantId: 'tenant:izzi',
    userId: 'user:operator',
    workspaceId: 'workspace:personal-office',
    packageId: 'skill-package:marketing',
    integrationId: 'google-calendar',
    grantId: 'grant:calendar',
    runId: 'run:marketing',
  },
  paths: {
    workDir: 'C:\\izzi\\work',
    tempDir: 'C:\\izzi\\temp',
    uploadDir: 'C:\\izzi\\upload',
    downloadDir: 'C:\\izzi\\download',
    allowedRoots: ['C:\\izzi'],
  },
  network: {
    mode: 'allowlist',
    bindHost: '127.0.0.1',
    allowedOrigins: ['https://calendar.google.com'],
    allowedPorts: [443],
  },
  budget: { cpuPercent: 25, memoryMb: 512, diskMb: 512, timeoutMs: 60_000 },
  env: [],
  visibleReviewMode: true,
  storageStateRef: secretRef('encrypted_file', 'browser/calendar/operator'),
};
const attestation: BrowserDriverAttestation = {
  schemaVersion: 1,
  adapterId: 'playwright:managed',
  adapterVersion: '1.0.0',
  driver: 'playwright',
  driverDigest: `sha256:${'a'.repeat(64)}`,
  packageId: spec.authority.packageId,
  allowedOrigins: ['https://calendar.google.com'],
  verifiedAt: '2026-07-29T10:00:00.000Z',
  expiresAt: '2026-07-30T10:00:00.000Z',
};

function driver(): IsolatedBrowserDriver {
  return {
    idempotentReplaySafe: true,
    open: vi.fn().mockResolvedValue({ close: vi.fn() }),
  };
}

describe('AttestedBrowserDriver', () => {
  it('opens only an exact package and origin-bounded visible runtime', async () => {
    const inner = driver();
    await new AttestedBrowserDriver(inner, attestation, () => NOW).open(spec, null);
    expect(inner.open).toHaveBeenCalledWith(spec, null);
  });

  it('rejects stale attestation before the underlying driver opens', async () => {
    const inner = driver();
    expect(() => new AttestedBrowserDriver(inner, {
      ...attestation,
      expiresAt: '2026-07-29T11:00:00.000Z',
    }, () => NOW)).toThrow(/not currently valid/);
    expect(inner.open).not.toHaveBeenCalled();
  });

  it('rejects package, hidden-mode and origin widening', async () => {
    const inner = driver();
    const wrapped = new AttestedBrowserDriver(inner, attestation, () => NOW);
    await expect(wrapped.open({
      ...spec,
      authority: { ...spec.authority, packageId: 'skill-package:other' },
    }, null)).rejects.toThrow(/package/);
    await expect(wrapped.open({ ...spec, visibleReviewMode: false }, null))
      .rejects.toThrow(/visible review/);
    await expect(wrapped.open({
      ...spec,
      network: { ...spec.network, allowedOrigins: ['https://evil.example'] },
    }, null)).rejects.toThrow(/allowlist/);
    expect(inner.open).not.toHaveBeenCalled();
  });

  it('rejects a driver that cannot deduplicate retries', () => {
    expect(() => new AttestedBrowserDriver({
      ...driver(),
      idempotentReplaySafe: false,
    }, attestation, () => NOW)).toThrow(/idempotent replay/);
  });
});
