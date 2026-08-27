import { describe, it, expect, vi, afterEach } from 'vitest';
import { IzziAgent, rendererSafeIzziAgentChatResult } from './izzi-agent';
import type { ExtensionToolHost } from './extension-tools';

const auth = { getApiKey: () => 'izzi_key' } as any;

const toolHost: ExtensionToolHost = {
  getAllExtensions: () => [
    {
      id: 'ext-social-auto-poster',
      state: 'running',
      manifest: {
        displayName: 'Social Auto Poster',
        contributes: { commands: [{ id: 'social-auto-poster.postNow', title: 'Đăng ngay' }] },
      },
    },
  ],
  executeCommand: vi.fn(async () => ({ ok: true, result: { id: 'task_1' } })),
};

function mockFetchSequence(responses: any[]) {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i++;
    return { ok: true, json: async () => r } as any;
  });
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('IzziAgent tool-calling', () => {
  it('single-turn (tools disabled): no tools in request, returns content', async () => {
    const fetchMock = mockFetchSequence([{ choices: [{ message: { content: 'xin chào' } }] }]);
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent(auth, toolHost);
    const res = await agent.chat({ systemPrompt: 's', message: 'hi' });
    expect(res.reply).toBe('xin chào');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('izzi-smart');
    expect(body.tools).toBeUndefined();
  });

  it('preserves an explicit Grok route', async () => {
    const fetchMock = mockFetchSequence([{ choices: [{ message: { content: 'grok ok' } }] }]);
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent(auth, toolHost);

    await agent.chat({ systemPrompt: 's', message: 'hi', model: 'grok-4.5-high' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe('grok-4.5-high');
  });

  it('uses a main-owned idempotency key and returns bounded model usage provenance', async () => {
    const fetchMock = mockFetchSequence([{
      model: 'gpt-5.6-sol',
      usage: {
        prompt_tokens: 640,
        completion_tokens: 180,
        total_tokens: 820,
        prompt_tokens_details: { cached_tokens: 120 },
      },
      choices: [{ message: { content: '{"schemaVersion":1}' } }],
    }]);
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent(auth, toolHost);

    const result = await agent.chat(
      { systemPrompt: 's', message: 'draft', model: 'gpt-5.6-sol', enableTools: false },
      undefined,
      { idempotencyKey: 'marketing-draft:run-11111111-1111-4111-8111-111111111111' },
    );

    expect(fetchMock.mock.calls[0][1].headers['Idempotency-Key'])
      .toBe('marketing-draft:run-11111111-1111-4111-8111-111111111111');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'gpt-5.6-sol',
      reasoning_effort: 'high',
    });
    expect(result.execution).toEqual({
      requestedModel: 'gpt-5.6-sol',
      servedModel: 'gpt-5.6-sol',
      usage: {
        promptTokens: 640,
        completionTokens: 180,
        totalTokens: 820,
        cachedTokens: 120,
      },
    });
  });

  it('redacts internal execution provenance from the renderer result', () => {
    const result = rendererSafeIzziAgentChatResult({
      reply: 'draft ready',
      execution: {
        requestedModel: 'izzi-smart',
        servedModel: 'gpt-5.6-sol',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, cachedTokens: 0 },
      },
    });

    expect(result).toEqual({ reply: 'draft ready' });
    expect(result).not.toHaveProperty('execution');
  });

  it('enableTools: executes the tool_call, loops, returns final answer', async () => {
    const fetchMock = mockFetchSequence([
      // 1st turn: model asks to call the tool
      { choices: [{ message: { content: '', tool_calls: [{ id: 'c1', function: { name: 'social-auto-poster__postNow', arguments: '{"content":"Bài mới"}' } }] } }] },
      // 2nd turn: model gives the final answer after seeing the tool result
      { choices: [{ message: { content: 'Đã đăng bài lên Facebook Page ✅' } }] },
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent(auth, toolHost);
    const res = await agent.chat({ systemPrompt: 's', message: 'đăng giúp tôi', enableTools: true });

    expect(res.reply).toBe('Đã đăng bài lên Facebook Page ✅');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Tools were offered on the first turn
    const body0 = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(Array.isArray(body0.tools)).toBe(true);
    expect(body0.tool_choice).toBe('auto');
    // The extension command was actually invoked with parsed args
    expect(toolHost.executeCommand).toHaveBeenCalledWith('ext-social-auto-poster', 'social-auto-poster.postNow', { content: 'Bài mới' });
    // The 2nd turn included the tool result message
    const body1 = JSON.parse(fetchMock.mock.calls[1][1].body);
    const toolMsg = body1.messages.find((m: any) => m.role === 'tool');
    expect(toolMsg).toBeTruthy();
    expect(toolMsg.content).toContain('task_1');
  });

  it('no-key → error, no fetch', async () => {
    vi.stubEnv('OPENAI_API_KEY', ''); // ensure the env key doesn't satisfy resolveKey
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent({ getApiKey: () => null } as any, toolHost);
    const res = await agent.chat({ systemPrompt: 's', message: 'hi', enableTools: true });
    expect(res.error).toBe('no-key');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
