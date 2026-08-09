import { describe, expect, it, vi } from 'vitest';
import {
  createCustomerVoiceStudioExtensionEnsurer,
  createCustomerVoiceStudioRepair,
  createCustomerVoiceStudioSynthesizer,
  VOICE_STUDIO_BUNDLED_VERSION,
} from './customer-marketing-voice-studio-runtime';

function trustedExtension(version = VOICE_STUDIO_BUNDLED_VERSION) {
  return {
    id: 'ext-voice-studio',
    name: 'voice-studio',
    state: 'installed',
    grantedPermissions: ['storage.local', 'ui.panel', 'net.http'],
    manifest: {
      version,
      permissions: ['storage.local', 'ui.notification', 'ui.panel', 'net.http'],
      customerMarketing: true,
      customerMarketingCapability: {
        id: 'voice-studio-local-preview',
        minimumPlan: 'pro',
        permission: 'execute',
      },
      service: { projectName: 'izzi-svc-voice-studio' },
    },
  };
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    ensureCurrentExtension: vi.fn(async () => undefined),
    listExtensions: vi.fn(() => [trustedExtension()]),
    isDockerAvailable: vi.fn(async () => true),
    startExtension: vi.fn(async () => undefined),
    getServiceStatus: vi.fn(async () => ({
      hasService: true,
      running: true,
      healthy: true,
      ports: { api: 5111 },
    })),
    wait: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('Customer Marketing Voice Studio repair runtime', () => {
  it('installs the bundled extension when Voice Studio is absent before reading service status', async () => {
    let installed: ReturnType<typeof trustedExtension> | undefined;
    const bundledOcxPath = 'C:\\Program Files\\Izzi AI\\voice-studio-0.2.0.ocx';
    const installFromOcx = vi.fn(async (_filePath: string, permissions?: string[]) => {
      installed = trustedExtension();
      installed.grantedPermissions = permissions ?? installed.grantedPermissions;
      return installed;
    });
    const ensureCurrentExtension = createCustomerVoiceStudioExtensionEnsurer({
      bundledOcxPath,
      bundledOcxExists: vi.fn(() => true),
      getExtension: vi.fn(() => installed),
      installFromOcx,
      stopExtension: vi.fn(async () => undefined),
    });
    const deps = dependencies({
      ensureCurrentExtension,
      listExtensions: vi.fn(() => installed ? [installed] : []),
    });

    await expect(createCustomerVoiceStudioRepair(deps)()).resolves.toBe('ready');
    expect(installFromOcx).toHaveBeenCalledOnce();
    expect(installFromOcx).toHaveBeenCalledWith(bundledOcxPath, undefined);
    expect(deps.getServiceStatus).toHaveBeenCalledOnce();
  });

  it('upgrades an older running extension and preserves its granted permissions', async () => {
    const bundledOcxPath = 'C:\\Program Files\\Izzi AI\\voice-studio-0.2.0.ocx';
    const oldExtension = {
      ...trustedExtension('0.1.0'),
      state: 'running',
      grantedPermissions: ['storage.local', 'system.shell'],
    };
    const stopExtension = vi.fn(async () => undefined);
    const installFromOcx = vi.fn(async () => trustedExtension());
    const ensure = createCustomerVoiceStudioExtensionEnsurer({
      bundledOcxPath,
      bundledOcxExists: vi.fn(() => true),
      getExtension: vi.fn(() => oldExtension),
      installFromOcx,
      stopExtension,
    });

    await expect(ensure()).resolves.toBeUndefined();
    expect(stopExtension).toHaveBeenCalledWith('ext-voice-studio');
    expect(installFromOcx).toHaveBeenCalledWith(bundledOcxPath, ['storage.local']);
  });

  it('does not reinstall the current trusted bundled extension', async () => {
    const bundledOcxExists = vi.fn(() => true);
    const installFromOcx = vi.fn(async () => trustedExtension());
    const ensure = createCustomerVoiceStudioExtensionEnsurer({
      bundledOcxPath: 'voice-studio-0.2.0.ocx',
      bundledOcxExists,
      getExtension: vi.fn(() => trustedExtension()),
      installFromOcx,
      stopExtension: vi.fn(async () => undefined),
    });

    await expect(ensure()).resolves.toBeUndefined();
    expect(bundledOcxExists).not.toHaveBeenCalled();
    expect(installFromOcx).not.toHaveBeenCalled();
  });

  it('reinstalls the current version when it retains an undeclared permission', async () => {
    const current = {
      ...trustedExtension(),
      grantedPermissions: ['storage.local', 'system.shell'],
    };
    const installFromOcx = vi.fn(async () => trustedExtension());
    const ensure = createCustomerVoiceStudioExtensionEnsurer({
      bundledOcxPath: 'voice-studio-0.2.0.ocx',
      bundledOcxExists: vi.fn(() => true),
      getExtension: vi.fn(() => current),
      installFromOcx,
      stopExtension: vi.fn(async () => undefined),
    });

    await expect(ensure()).resolves.toBeUndefined();
    expect(installFromOcx).toHaveBeenCalledWith('voice-studio-0.2.0.ocx', ['storage.local']);
  });

  it('rejects a missing or mismatched bundled package before service startup', async () => {
    const missing = dependencies({
      ensureCurrentExtension: vi.fn(async () => { throw new Error('missing bundle'); }),
    });
    await expect(createCustomerVoiceStudioRepair(missing)()).resolves.toBe('not_installed');
    expect(missing.getServiceStatus).not.toHaveBeenCalled();
    expect(missing.isDockerAvailable).not.toHaveBeenCalled();

    const ensure = createCustomerVoiceStudioExtensionEnsurer({
      bundledOcxPath: 'voice-studio-0.2.0.ocx',
      bundledOcxExists: vi.fn(() => true),
      getExtension: vi.fn(() => undefined),
      installFromOcx: vi.fn(async () => ({
        ...trustedExtension(),
        id: 'ext-unexpected',
      })),
      stopExtension: vi.fn(async () => undefined),
    });
    await expect(ensure()).rejects.toThrow('identity does not match');
  });

  it('derives the trusted extension and coalesces concurrent starts', async () => {
    let finishStart!: () => void;
    const startPending = new Promise<void>((resolve) => { finishStart = resolve; });
    const deps = dependencies({
      startExtension: vi.fn(() => startPending),
      getServiceStatus: vi.fn()
        .mockResolvedValueOnce({ hasService: true, running: true })
        .mockResolvedValueOnce({ hasService: true, running: true, healthy: false })
        .mockResolvedValue({ hasService: true, running: true, healthy: true, ports: { api: 5111 } }),
    });
    const repair = createCustomerVoiceStudioRepair(deps);

    const first = repair();
    const second = repair();
    await vi.waitFor(() => expect(deps.startExtension).toHaveBeenCalledTimes(1));
    expect(deps.startExtension).toHaveBeenCalledWith('ext-voice-studio', { withService: true });
    finishStart();

    await expect(Promise.all([first, second])).resolves.toEqual(['ready', 'ready']);
    expect(deps.ensureCurrentExtension).toHaveBeenCalledTimes(1);
    expect(deps.getServiceStatus).toHaveBeenCalledTimes(4);
    expect(deps.wait).toHaveBeenCalledTimes(2);
    expect(deps.wait).toHaveBeenCalledWith(500);
  });

  it('does not restart a service that is already healthy in this app process', async () => {
    const deps = dependencies();
    const repair = createCustomerVoiceStudioRepair(deps);

    await expect(repair()).resolves.toBe('ready');
    expect(deps.isDockerAvailable).not.toHaveBeenCalled();
    expect(deps.startExtension).not.toHaveBeenCalled();
    expect(deps.getServiceStatus).toHaveBeenCalledTimes(1);
  });

  it('does not start a spoofed or incomplete extension contract', async () => {
    const deps = dependencies({
      listExtensions: vi.fn(() => [{
        ...trustedExtension(),
        id: 'ext-attacker-controlled',
      }]),
    });
    const repair = createCustomerVoiceStudioRepair(deps);

    await expect(repair()).resolves.toBe('not_installed');
    expect(deps.isDockerAvailable).not.toHaveBeenCalled();
    expect(deps.startExtension).not.toHaveBeenCalled();
  });

  it('separates an unavailable Docker daemon from an unhealthy service', async () => {
    const stopped = { hasService: true, running: false };
    const noDocker = dependencies({
      getServiceStatus: vi.fn(async () => stopped),
      isDockerAvailable: vi.fn(async () => false),
    });
    await expect(createCustomerVoiceStudioRepair(noDocker)()).resolves.toBe('docker_unavailable');
    expect(noDocker.startExtension).not.toHaveBeenCalled();

    const unhealthy = dependencies({
      getServiceStatus: vi.fn(async () => stopped),
      startExtension: vi.fn(async () => { throw new Error('private path'); }),
    });
    await expect(createCustomerVoiceStudioRepair(unhealthy)()).resolves.toBe('unhealthy');
  });
});

describe('Customer Marketing Voice Studio synthesis adapter', () => {
  it('repairs the trusted runtime before forwarding only text and voice to TTS', async () => {
    const repair = vi.fn(async () => 'ready' as const);
    const executeTts = vi.fn(async () => ({ ok: true, format: 'wav', audioB64: 'audio' }));
    const synthesize = createCustomerVoiceStudioSynthesizer({ repair, executeTts });

    await expect(synthesize({
      text: 'Hướng dẫn IzziAPI',
      voice: 'pham-tuyen',
      path: 'C:\\private',
    } as { text: string; voice: string; path: string })).resolves.toEqual({
      ok: true,
      format: 'wav',
      audioB64: 'audio',
    });

    expect(repair).toHaveBeenCalledOnce();
    expect(executeTts).toHaveBeenCalledWith({
      text: 'Hướng dẫn IzziAPI',
      voice: 'pham-tuyen',
    });
    expect(repair.mock.invocationCallOrder[0]).toBeLessThan(executeTts.mock.invocationCallOrder[0]);
  });

  it.each(['not_installed', 'docker_unavailable', 'unhealthy'] as const)(
    'does not execute TTS when repair returns %s',
    async (outcome) => {
      const executeTts = vi.fn();
      const synthesize = createCustomerVoiceStudioSynthesizer({
        repair: vi.fn(async () => outcome),
        executeTts,
      });

      await expect(synthesize({ text: 'IzziAPI', voice: 'pham-tuyen' }))
        .rejects.toThrow('runtime is not ready');
      expect(executeTts).not.toHaveBeenCalled();
    },
  );
});
