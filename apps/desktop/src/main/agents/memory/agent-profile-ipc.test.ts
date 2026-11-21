import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
const trusted = vi.hoisted(() => vi.fn(() => true));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn((name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler)) } }));
vi.mock('../../marketing/marketing-ipc', () => ({ isTrustedMarketingSender: trusted }));

import { registerAgentProfileIpc } from './agent-profile-ipc';
import type { AgentProfileService } from './agent-profile-service';

const OK = { ok: true, state: { profiles: [], lastRunAt: null, backgroundPause: null } };

function fakeService() {
  return {
    getState: vi.fn(() => OK),
    refresh: vi.fn(async () => OK),
    approve: vi.fn(async () => OK),
    discard: vi.fn(async () => OK),
    forget: vi.fn(async () => OK),
    resume: vi.fn(async () => OK),
  };
}

describe('registerAgentProfileIpc', () => {
  beforeEach(() => {
    handlers.clear();
    trusted.mockReturnValue(true);
  });

  it('passes each call to the service, including the renderer input', async () => {
    // Arrange
    const service = fakeService();
    registerAgentProfileIpc(service as unknown as AgentProfileService);

    // Act
    const results = await Promise.all([
      handlers.get('agentProfiles:get')!({}),
      handlers.get('agentProfiles:refresh')!({}),
      handlers.get('agentProfiles:approve')!({}, { agentId: 'socrates' }),
      handlers.get('agentProfiles:discard')!({}, { agentId: 'socrates' }),
      handlers.get('agentProfiles:forget')!({}, { agentId: 'socrates' }),
      handlers.get('agentProfiles:resume')!({}),
    ]);

    // Assert
    expect(results).toEqual([OK, OK, OK, OK, OK, OK]);
    expect(service.resume).toHaveBeenCalledTimes(1);
    expect(service.approve).toHaveBeenCalledWith({ agentId: 'socrates' });
    expect(service.discard).toHaveBeenCalledWith({ agentId: 'socrates' });
    expect(service.forget).toHaveBeenCalledWith({ agentId: 'socrates' });
  });

  it('[5] treats every refresh from the window as the owner clicking: the renderer cannot ask for a background run', async () => {
    // Arrange
    const service = fakeService();
    registerAgentProfileIpc(service as unknown as AgentProfileService);

    // Act
    await handlers.get('agentProfiles:refresh')!({}, 'background');

    // Assert
    expect(service.refresh).toHaveBeenCalledWith();
  });

  it('refuses every call from anything but the trusted app window, "Tiếp tục" included', async () => {
    // Arrange
    const service = fakeService();
    registerAgentProfileIpc(service as unknown as AgentProfileService);
    trusted.mockReturnValue(false);
    const channels = ['get', 'refresh', 'approve', 'discard', 'forget', 'resume'];

    // Act
    const results = await Promise.all(channels.map((name) => handlers.get(`agentProfiles:${name}`)!({}, { agentId: 'socrates' })));

    // Assert
    expect(results).toEqual(Array(channels.length).fill({ ok: false, error: 'auth' }));
    expect(service.resume).not.toHaveBeenCalled();
    for (const method of Object.values(service)) expect(method).not.toHaveBeenCalled();
  });
});
