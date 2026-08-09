import { describe, expect, it, vi } from 'vitest';
import { createCustomerVoiceStudioRepair } from './customer-marketing-voice-studio-runtime';

function trustedExtension() {
  return {
    id: 'ext-voice-studio',
    name: 'voice-studio',
    state: 'installed',
    manifest: {
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
