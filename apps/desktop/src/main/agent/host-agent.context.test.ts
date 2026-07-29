import { afterEach, describe, expect, it, vi } from 'vitest';
import { PERSONAL_OFFICE_SCHEMA_VERSION } from '../../shared/personal-office';
import type { ContextSourceInput } from '../../shared/context';
import { compileWorkspaceContext } from '../context/compiler';
import {
  buildHostAgentSystemPrompt,
  runHostAgentTurn,
} from './host-agent';

const scope = { workspaceId: 'workspace-7', ownerId: 'owner-7' };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function kernel(message: string) {
  const baseSystem = buildHostAgentSystemPrompt('');
  const sources: ContextSourceInput[] = [
    {
      id: 'safety',
      layer: 'safety-system',
      role: 'system',
      scope,
      classification: 'public_metadata',
      content: baseSystem,
      provenance: { sourceType: 'base-system', sourceId: 'host-agent' },
    },
    {
      id: 'request',
      layer: 'current-user-request',
      role: 'user',
      scope,
      classification: 'personal_graph',
      content: message,
      provenance: { sourceType: 'current-request', sourceId: 'turn-7' },
    },
    {
      id: 'policy',
      layer: 'workspace-policy',
      role: 'system',
      scope,
      classification: 'personal_graph',
      content: 'Use the workspace release checklist.',
      provenance: { sourceType: 'workspace-policy', sourceId: 'policy-7' },
    },
  ];
  return {
    scope,
    compiled: compileWorkspaceContext({
      schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
      scope,
      compiledAt: '2026-07-29T10:00:00.000Z',
      budget: { maxItems: 10, maxBytes: 8_000 },
      sources,
    }),
  };
}

describe('runHostAgentTurn context seam', () => {
  it('appends one delimited system segment and keeps the current request in user role', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const message = 'Prepare release evidence.\n ';

    const result = await runHostAgentTurn({
      config: {
        baseUrl: 'http://127.0.0.1:2455/v1',
        authType: 'bearer',
        selectedModel: 'gpt-5.6-sol',
      },
      apiKey: 'test-key',
      message,
      history: [],
      images: [],
      mode: 'agent',
      turnId: 'turn-context',
      requestApproval: async () => 'deny',
      context: kernel(message),
    });

    expect(result).toEqual({ reply: 'OK' });
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('<<<START_PERSONAL_OFFICE_CONTEXT>>>');
    expect(body.messages[0].content).toContain('Use the workspace release checklist.');
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: message });
    expect(
      body.messages[0].content.slice(
        body.messages[0].content.indexOf('<<<START_PERSONAL_OFFICE_CONTEXT>>>'),
      ),
    ).not.toContain(message);
  });

  it('fails before network access when the explicit scope does not match', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const message = 'Prepare release evidence.';
    const context = kernel(message);

    await expect(
      runHostAgentTurn({
        config: {
          baseUrl: 'http://127.0.0.1:2455/v1',
          authType: 'bearer',
          selectedModel: 'gpt-5.6-sol',
        },
        apiKey: 'test-key',
        message,
        history: [],
        images: [],
        mode: 'agent',
        turnId: 'turn-context-mismatch',
        requestApproval: async () => 'deny',
        context: {
          ...context,
          scope: { workspaceId: 'other-workspace', ownerId: scope.ownerId },
        },
      }),
    ).rejects.toThrow(/requested workspace and owner/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'trailing whitespace',
      'Prepare release evidence.',
      'Prepare release evidence. ',
    ],
    [
      'canonically equivalent Unicode',
      'Prepare Café release evidence.',
      'Prepare Cafe\u0301 release evidence.',
    ],
  ])(
    'fails before network access when %s changes the exact bound request bytes',
    async (_case, boundMessage, outgoingMessage) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      await expect(
        runHostAgentTurn({
          config: {
            baseUrl: 'http://127.0.0.1:2455/v1',
            authType: 'bearer',
            selectedModel: 'gpt-5.6-sol',
          },
          apiKey: 'test-key',
          message: outgoingMessage,
          history: [],
          images: [],
          mode: 'agent',
          turnId: 'turn-context-exact-request-mismatch',
          requestApproval: async () => 'deny',
          context: kernel(boundMessage),
        }),
      ).rejects.toThrow(/current user request/i);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('fails before network access when context is paired with an image', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const message = 'Describe the attached release evidence.';

    await expect(
      runHostAgentTurn({
        config: {
          baseUrl: 'http://127.0.0.1:2455/v1',
          authType: 'bearer',
          selectedModel: 'gpt-5.6-sol',
        },
        apiKey: 'test-key',
        message,
        history: [],
        images: ['data:image/png;base64,ZmFrZQ=='],
        mode: 'agent',
        turnId: 'turn-context-image',
        requestApproval: async () => 'deny',
        context: kernel(message),
      }),
    ).rejects.toThrow(/multimodal context binding is unsupported/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
