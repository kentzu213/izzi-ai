import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentChatSession } from '../types/agent-registry';
import { useAgentGatewayStore } from './agentGateway';

// The store reads the preload bridge off `window`; vitest runs these in node.
function stubBridge(electronAPI: unknown) {
  (globalThis as unknown as { window?: unknown }).window = { electronAPI };
}

function session(agentId: string, provider: 'izzi' | 'custom'): AgentChatSession {
  return {
    id: `session-${agentId}`,
    agentId,
    agentName: agentId,
    agentIcon: 'agent',
    messages: [],
    model: 'izzi-smart',
    provider,
    reasoningEffort: 'xhigh',
    createdAt: '2026-08-21T00:00:00.000Z',
    isActive: true,
  };
}

describe('local Cockpit session routing', () => {
  beforeEach(() => {
    useAgentGatewayStore.setState({
      sessions: [session('hermes', 'izzi'), session('socrates', 'izzi')],
      activeSessionId: 'session-hermes',
    });
  });

  it('moves external agents to Cockpit Sol high while preserving Izzi-native personas', () => {
    useAgentGatewayStore.getState().routeExternalSessionsToCustom('gpt-5.6-sol');

    const sessions = useAgentGatewayStore.getState().sessions;
    expect(sessions.find((item) => item.agentId === 'hermes')).toMatchObject({
      model: 'gpt-5.6-sol',
      provider: 'custom',
      reasoningEffort: 'high',
    });
    expect(sessions.find((item) => item.agentId === 'socrates')).toMatchObject({
      model: 'izzi-smart',
      provider: 'izzi',
      reasoningEffort: 'xhigh',
    });
  });
});

describe('enableCustomRouting probe gate', () => {
  beforeEach(() => {
    useAgentGatewayStore.setState({
      sessions: [session('hermes', 'izzi'), session('socrates', 'izzi')],
      activeSessionId: 'session-hermes',
      errorMessage: null,
    });
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    vi.restoreAllMocks();
  });

  it('never enables or reroutes when the connection probe fails', async () => {
    const setEnabled = vi.fn(async () => ({ ok: true }));
    stubBridge({
      customProvider: {
        testConnection: vi.fn(async () => ({ ok: false, message: '401 Unauthorized' })),
        setEnabled,
      },
    });

    const result = await useAgentGatewayStore.getState().enableCustomRouting('gpt-5.6-sol');

    expect(result.ok).toBe(false);
    // Fail closed: the flag is forced off before the probe and never turned on.
    expect(setEnabled).toHaveBeenCalledWith(false);
    expect(setEnabled).not.toHaveBeenCalledWith(true);
    expect(useAgentGatewayStore.getState().errorMessage).toContain('401 Unauthorized');
    expect(useAgentGatewayStore.getState().errorMessage).toContain('chưa được bật');
    expect(useAgentGatewayStore.getState().sessions.find((s) => s.agentId === 'hermes')).toMatchObject({
      model: 'izzi-smart',
      provider: 'izzi',
    });
  });

  it('enables and reroutes only after the probe succeeds', async () => {
    const setEnabled = vi.fn(async (_enabled: boolean) => ({ ok: true }));
    const testConnection = vi.fn(async () => ({ ok: true, model: 'gpt-5.6-sol' }));
    stubBridge({
      customProvider: {
        testConnection,
        setEnabled,
      },
    });

    const result = await useAgentGatewayStore.getState().enableCustomRouting('gpt-5.6-sol');

    expect(result.ok).toBe(true);
    // The gate disables first, probes, and only then re-enables.
    expect(setEnabled.mock.calls.map(([value]) => value)).toEqual([false, true]);
    expect(setEnabled.mock.invocationCallOrder[0]).toBeLessThan(
      testConnection.mock.invocationCallOrder[0],
    );
    expect(useAgentGatewayStore.getState().errorMessage).toBeNull();
    expect(useAgentGatewayStore.getState().sessions.find((s) => s.agentId === 'hermes')).toMatchObject({
      model: 'gpt-5.6-sol',
      provider: 'custom',
      reasoningEffort: 'high',
    });
  });

  it('fails closed when the app bridge is missing', async () => {
    stubBridge({});

    const result = await useAgentGatewayStore.getState().enableCustomRouting('gpt-5.6-sol');

    expect(result.ok).toBe(false);
    expect(useAgentGatewayStore.getState().sessions.find((s) => s.agentId === 'hermes')?.provider).toBe(
      'izzi',
    );
  });
});

describe('probe gate from an already-enabled connection', () => {
  const previousConfig = {
    baseUrl: 'http://127.0.0.1:51226/v1',
    authType: 'bearer',
    selectedModel: 'gpt-5.6-sol',
  };

  beforeEach(() => {
    useAgentGatewayStore.setState({
      sessions: [session('hermes', 'izzi'), session('socrates', 'izzi')],
      activeSessionId: 'session-hermes',
      errorMessage: null,
    });
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    vi.restoreAllMocks();
  });

  it('enableCustomRouting disables before probing and stays disabled on failure', async () => {
    const setEnabled = vi.fn(async (_enabled: boolean) => ({ ok: true }));
    const testConnection = vi.fn(async () => ({ ok: false, message: 'ECONNREFUSED 127.0.0.1:9999' }));
    stubBridge({ customProvider: { testConnection, setEnabled } });

    const result = await useAgentGatewayStore.getState().enableCustomRouting('gpt-5.6-sol');

    expect(result.ok).toBe(false);
    // The previously-enabled connection goes off BEFORE the probe runs...
    expect(setEnabled.mock.calls.map(([value]) => value)).toEqual([false]);
    expect(setEnabled.mock.invocationCallOrder[0]).toBeLessThan(
      testConnection.mock.invocationCallOrder[0],
    );
    // ...and is never re-enabled after the failed probe.
    expect(setEnabled).not.toHaveBeenCalledWith(true);
    expect(useAgentGatewayStore.getState().errorMessage).toContain('chưa được bật');
    // Sessions never rerouted to the broken connection.
    for (const s of useAgentGatewayStore.getState().sessions) {
      expect(s).toMatchObject({ model: 'izzi-smart', provider: 'izzi' });
    }
  });

  it('setActiveModel disables before saving, restores the prior config, and stays disabled on failure', async () => {
    const setEnabled = vi.fn(async (_enabled: boolean) => ({ ok: true }));
    const saveConfig = vi.fn(async (_input: unknown) => ({ ok: true }));
    const testConnection = vi.fn(async () => ({ ok: false, message: '401 Unauthorized' }));
    stubBridge({
      customProvider: {
        getConfig: vi.fn(async () => ({ config: previousConfig, enabled: true, hasKey: true })),
        saveConfig,
        testConnection,
        setEnabled,
      },
    });

    await useAgentGatewayStore.getState().setActiveModel('broken-model', 'custom');

    // Disabled before the new model config is saved or probed.
    expect(setEnabled.mock.calls.map(([value]) => value)).toEqual([false]);
    expect(setEnabled.mock.invocationCallOrder[0]).toBeLessThan(
      saveConfig.mock.invocationCallOrder[0],
    );
    expect(setEnabled).not.toHaveBeenCalledWith(true);
    // The prior config is restored after the failed probe.
    expect(saveConfig).toHaveBeenLastCalledWith(previousConfig);
    // Never claims success, never touches the session.
    expect(useAgentGatewayStore.getState().errorMessage).toContain('401 Unauthorized');
    expect(useAgentGatewayStore.getState().errorMessage).toContain('chưa được bật');
    expect(useAgentGatewayStore.getState().sessions.find((s) => s.agentId === 'hermes')).toMatchObject({
      model: 'izzi-smart',
      provider: 'izzi',
    });
  });

  it('setActiveModel enables only after the probe succeeds', async () => {
    const setEnabled = vi.fn(async (_enabled: boolean) => ({ ok: true }));
    const saveConfig = vi.fn(async (_input: unknown) => ({ ok: true }));
    const testConnection = vi.fn(async () => ({ ok: true, model: 'gpt-5.6-terra' }));
    stubBridge({
      customProvider: {
        getConfig: vi.fn(async () => ({ config: previousConfig, enabled: true, hasKey: true })),
        saveConfig,
        testConnection,
        setEnabled,
      },
    });

    await useAgentGatewayStore.getState().setActiveModel('gpt-5.6-terra', 'custom');

    expect(setEnabled.mock.calls.map(([value]) => value)).toEqual([false, true]);
    expect(testConnection.mock.invocationCallOrder[0]).toBeLessThan(
      setEnabled.mock.invocationCallOrder[1],
    );
    expect(useAgentGatewayStore.getState().errorMessage).toBeNull();
    expect(useAgentGatewayStore.getState().sessions.find((s) => s.agentId === 'hermes')).toMatchObject({
      model: 'gpt-5.6-terra',
      provider: 'custom',
    });
  });
});

describe('custom-bound sessions never fall through to Docker', () => {
  beforeEach(() => {
    useAgentGatewayStore.setState({
      sessions: [session('hermes', 'custom')],
      activeSessionId: 'session-hermes',
      isSending: false,
      currentTurnId: null,
      errorMessage: null,
    });
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
    vi.restoreAllMocks();
  });

  it('stops the turn with an actionable notice when the local Cockpit connection is off', async () => {
    const dockerChat = vi.fn(async () => ({ reply: 'from the container' }));
    const customChat = vi.fn(async () => ({ reply: 'from the endpoint' }));
    stubBridge({
      customProvider: {
        getConfig: vi.fn(async () => ({ enabled: false, hasKey: false, config: null })),
        chat: customChat,
      },
      dockerAgent: {
        chat: dockerChat,
        status: vi.fn(async () => ({ running: true })),
        start: vi.fn(async () => ({ ok: true })),
      },
    });

    const sent = await useAgentGatewayStore.getState().sendGatewayMessage('xin chào');

    expect(sent).toBe(true);
    expect(dockerChat).not.toHaveBeenCalled();
    expect(customChat).not.toHaveBeenCalled();

    const state = useAgentGatewayStore.getState();
    const messages = state.sessions.find((s) => s.agentId === 'hermes')?.messages ?? [];
    const assistant = messages[messages.length - 1];
    expect(assistant.role).toBe('assistant');
    expect(assistant.state).toBe('done');
    expect(assistant.content).toContain('Tin nhắn sẽ không được chuyển sang agent Docker.');
    expect(state.isSending).toBe(false);
    expect(state.currentTurnId).toBeNull();
  });
});
