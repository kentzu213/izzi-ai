import { describe, expect, it, vi } from 'vitest';
import {
  MODEL_ROUTE_CONTRACT_VERSION,
  ModelRouteResolutionError,
  createModelRouteDecision,
} from '../../shared/model-gateway';
import type { ChatProvider } from './chat-provider';
import { AgentService } from './agent-service';
import type { ChatMessage, ManagedProviderStreamChunk } from './types';

vi.mock('axios', () => ({
  default: { request: vi.fn() },
}));

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}));

function createServiceHarness() {
  const diagnostics: Array<Record<string, unknown>> = [];
  const messageStates: Array<[string, string]> = [];
  const agentStates: Array<Record<string, unknown>> = [];
  const service = Object.create(AgentService.prototype) as any;

  service.db = {
    listChatMessages: () => [
      {
        id: 'user-message',
        role: 'user',
        content: 'hello',
      },
    ],
    appendDiagnosticEvent: (event: Record<string, unknown>) => diagnostics.push(event),
    setMessageState: (messageId: string, state: string) => {
      messageStates.push([messageId, state]);
    },
    appendAssistantDelta: vi.fn(),
    upsertAgentTask: vi.fn(),
    upsertAgentMemory: vi.fn(),
    upsertAgentState: (state: Record<string, unknown>) => {
      agentStates.push(state);
      return state;
    },
  };
  service.auth = { getCurrentUser: () => null };
  service.activeRequestId = 'request-1';
  service.emitStatus = vi.fn();
  service.emitStream = vi.fn();

  return { service, diagnostics, messageStates, agentStates };
}

const assistantMessage = {
  id: 'assistant-message',
} as ChatMessage;

describe('AgentService deterministic routing', () => {
  it('resolves once, records the secret-free decision, and uses only that provider', async () => {
    const { service, diagnostics, messageStates } = createServiceHarness();
    const streamChat = vi.fn(async function* (): AsyncGenerator<ManagedProviderStreamChunk> {
      yield { type: 'assistant_done' };
    });
    const provider: ChatProvider = {
      streamChat,
      getStatus: async () => null,
    };
    const decision = createModelRouteDecision({
      contractVersion: MODEL_ROUTE_CONTRACT_VERSION,
      routeKind: 'custom',
      providerKind: 'openai-compatible-custom',
      endpointOrigin: 'https://custom.example.dev',
      endpointClass: 'custom-https',
      modelId: 'gpt-5.4',
      capabilityDecision: {
        streaming: 'streaming-only',
        tools: 'unsupported',
      },
      creditPolicyClass: 'provider-native',
      retryPolicy: 'none',
      reasonCode: 'custom-enabled-valid-selected',
    });
    const resolveRoute = vi.fn(() => ({ provider, decision }));
    service.resolver = { resolveRoute };

    await service.runManagedRequest({
      requestId: 'request-1',
      sessionId: 'session-1',
      message: 'hello',
      assistantMessage,
    });

    expect(resolveRoute).toHaveBeenCalledTimes(1);
    expect(streamChat).toHaveBeenCalledTimes(1);
    expect(messageStates).toContainEqual(['assistant-message', 'done']);
    const routeDiagnostic = diagnostics.find((event) => event.type === 'agent.model-route');
    expect(routeDiagnostic).toMatchObject({
      status: 'info',
      meta: {
        sessionId: 'session-1',
        requestId: 'request-1',
        decision,
      },
    });
    expect(JSON.stringify(routeDiagnostic)).not.toContain('api-key-fixture');
  });

  it('surfaces a route rejection without invoking a managed fallback provider', async () => {
    const { service, diagnostics, messageStates, agentStates } = createServiceHarness();
    const managedFallback = {
      streamChat: vi.fn(),
    };
    service.provider = managedFallback;
    service.resolver = {
      resolveRoute: vi.fn(() => {
        throw new ModelRouteResolutionError('custom-key-missing');
      }),
    };

    await service.runManagedRequest({
      requestId: 'request-1',
      sessionId: 'session-1',
      message: 'hello',
      assistantMessage,
    });

    expect(managedFallback.streamChat).not.toHaveBeenCalled();
    expect(messageStates).toContainEqual(['assistant-message', 'error']);
    expect(agentStates.at(-1)).toMatchObject({
      sessionId: 'session-1',
      state: 'error',
      lastError: 'Custom provider is enabled but its credential is unavailable.',
    });
    expect(diagnostics.at(-1)).toMatchObject({
      type: 'agent.chat',
      status: 'error',
      detail: 'Custom provider is enabled but its credential is unavailable.',
    });
  });
});
