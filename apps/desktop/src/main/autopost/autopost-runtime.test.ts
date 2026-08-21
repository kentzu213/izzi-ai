import { describe, expect, it, vi } from 'vitest';
import {
  AUTOPOST_BUNDLED_VERSION,
  createAutopostExtensionEnsurer,
} from './autopost-runtime';

function trustedExtension(version = AUTOPOST_BUNDLED_VERSION) {
  return {
    id: 'ext-social-auto-poster',
    name: 'social-auto-poster',
    state: 'installed',
    grantedPermissions: ['storage.local', 'ui.panel', 'net.http'],
    manifest: {
      version,
      permissions: ['storage.local', 'ui.notification', 'ui.panel', 'net.http'],
      service: { projectName: 'izzi-svc-social-auto-poster' },
    },
  };
}

describe('Auto Post bundled extension upgrade', () => {
  it('upgrades the stale running extension that has no managed service', async () => {
    const bundledOcxPath = 'C:\\Program Files\\Izzi AI\\social-auto-poster-0.3.0.ocx';
    const stale = {
      ...trustedExtension('0.1.0'),
      state: 'running',
      grantedPermissions: ['storage.local', 'system.shell'],
      manifest: {
        version: '0.1.0',
        permissions: ['storage.local', 'system.shell'],
        service: undefined,
      },
    };
    const stopExtension = vi.fn(async () => undefined);
    const installFromOcx = vi.fn(async () => trustedExtension());
    const ensure = createAutopostExtensionEnsurer({
      bundledOcxPath,
      bundledOcxExists: vi.fn(() => true),
      getExtension: vi.fn(() => stale),
      installFromOcx,
      stopExtension,
    });

    await expect(ensure()).resolves.toBeUndefined();
    expect(stopExtension).toHaveBeenCalledWith('ext-social-auto-poster');
    expect(installFromOcx).toHaveBeenCalledWith(bundledOcxPath, ['storage.local']);
  });

  it('installs the bundled extension when Auto Post is absent', async () => {
    const installFromOcx = vi.fn(async () => trustedExtension());
    const ensure = createAutopostExtensionEnsurer({
      bundledOcxPath: 'social-auto-poster-0.3.0.ocx',
      bundledOcxExists: vi.fn(() => true),
      getExtension: vi.fn(() => undefined),
      installFromOcx,
      stopExtension: vi.fn(async () => undefined),
    });

    await expect(ensure()).resolves.toBeUndefined();
    expect(installFromOcx).toHaveBeenCalledWith('social-auto-poster-0.3.0.ocx', undefined);
  });

  it('does not reinstall the current trusted bundled extension', async () => {
    const bundledOcxExists = vi.fn(() => true);
    const installFromOcx = vi.fn(async () => trustedExtension());
    const ensure = createAutopostExtensionEnsurer({
      bundledOcxPath: 'social-auto-poster-0.3.0.ocx',
      bundledOcxExists,
      getExtension: vi.fn(() => trustedExtension()),
      installFromOcx,
      stopExtension: vi.fn(async () => undefined),
    });

    await expect(ensure()).resolves.toBeUndefined();
    expect(bundledOcxExists).not.toHaveBeenCalled();
    expect(installFromOcx).not.toHaveBeenCalled();
  });

  it('rejects a missing or identity-mismatched bundled package', async () => {
    const missing = createAutopostExtensionEnsurer({
      bundledOcxPath: 'social-auto-poster-0.3.0.ocx',
      bundledOcxExists: vi.fn(() => false),
      getExtension: vi.fn(() => undefined),
      installFromOcx: vi.fn(async () => trustedExtension()),
      stopExtension: vi.fn(async () => undefined),
    });
    await expect(missing()).rejects.toThrow('unavailable');

    const mismatched = createAutopostExtensionEnsurer({
      bundledOcxPath: 'social-auto-poster-0.3.0.ocx',
      bundledOcxExists: vi.fn(() => true),
      getExtension: vi.fn(() => undefined),
      installFromOcx: vi.fn(async () => ({
        ...trustedExtension(),
        id: 'ext-unexpected',
      })),
      stopExtension: vi.fn(async () => undefined),
    });
    await expect(mismatched()).rejects.toThrow('identity does not match');
  });
});
