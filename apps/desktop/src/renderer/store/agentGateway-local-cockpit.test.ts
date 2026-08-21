import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentChatSession } from '../types/agent-registry';
import { useAgentGatewayStore } from './agentGateway';

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
