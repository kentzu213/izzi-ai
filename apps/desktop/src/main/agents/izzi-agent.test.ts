import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  IzziAgent,
  readIzziAgentHttpError,
  rendererSafeIzziAgentChatResult,
  resolveIzziAgentMaxTokens,
} from './izzi-agent';
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

  it('raises the output budget by default and lets a caller ask for more', async () => {
    const fetchMock = mockFetchSequence([{ choices: [{ message: { content: 'ok' } }] }]);
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent(auth, toolHost);

    await agent.chat({ systemPrompt: 's', message: 'hi' });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).max_tokens).toBe(4096);

    await agent.chat({ systemPrompt: 's', message: 'hi', maxTokens: 9000 });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).max_tokens).toBe(9000);
  });

  it('clamps an out-of-range output budget instead of trusting it', () => {
    expect(resolveIzziAgentMaxTokens(undefined)).toBe(4096);
    expect(resolveIzziAgentMaxTokens(0)).toBe(4096);
    expect(resolveIzziAgentMaxTokens(-5)).toBe(4096);
    expect(resolveIzziAgentMaxTokens(Number.NaN)).toBe(4096);
    expect(resolveIzziAgentMaxTokens(120)).toBe(120);
    expect(resolveIzziAgentMaxTokens(999999)).toBe(16000);
  });

  it('reports a budget-truncated answer instead of presenting it as final', async () => {
    const fetchMock = mockFetchSequence([
      { choices: [{ finish_reason: 'length', message: { content: 'một nửa câu' } }] },
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent(auth, toolHost);

    const res = await agent.chat({ systemPrompt: 's', message: 'hi' });

    expect(res.reply).toBe('một nửa câu');
    expect(res.truncated).toBe(true);
    expect(rendererSafeIzziAgentChatResult(res)).toEqual({ reply: 'một nửa câu', truncated: true });
  });

  it('does not flag a complete answer as truncated', async () => {
    const fetchMock = mockFetchSequence([
      { choices: [{ finish_reason: 'stop', message: { content: 'xong' } }] },
    ]);
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent(auth, toolHost);

    const res = await agent.chat({ systemPrompt: 's', message: 'hi' });

    expect(res.truncated).toBeUndefined();
    expect(rendererSafeIzziAgentChatResult(res)).toEqual({ reply: 'xong' });
  });

  it('surfaces the gateway error message instead of a bare status', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({
        error: { type: 'invalid_request_error', message: 'Unsupported model: izzi-smart' },
      }),
    }) as any);
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent(auth, toolHost);

    const res = await agent.chat({ systemPrompt: 's', message: 'hi' });

    expect(res.error).toBe('http 400: invalid_request_error: Unsupported model: izzi-smart');
  });

  it('falls back to the bare status when the error body carries nothing', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => { throw new Error('not json'); },
    }) as any);
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent(auth, toolHost);

    const res = await agent.chat({ systemPrompt: 's', message: 'hi' });

    expect(res.error).toBe('http 502');
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

describe('readIzziAgentHttpError', () => {
  it('handles a plain string error body', async () => {
    const text = await readIzziAgentHttpError({ status: 401, json: async () => ({ error: 'Unauthorized' }) });
    expect(text).toBe('http 401: Unauthorized');
  });

  it('handles a coded error body', async () => {
    const text = await readIzziAgentHttpError({
      status: 402,
      json: async () => ({ error: { code: 'insufficient_balance', message: 'Not enough credits' } }),
    });
    expect(text).toBe('http 402: insufficient_balance: Not enough credits');
  });

  it('never returns an unbounded message', async () => {
    const text = await readIzziAgentHttpError({
      status: 400,
      json: async () => ({ error: { type: 'invalid_request_error', message: 'x'.repeat(5000) } }),
    });
    expect(text.length).toBeLessThanOrEqual('http 400: '.length + 300);
  });
});

describe('IzziAgent credential resolution', () => {
  // The chat endpoint is pinned to the official IzziAPI gateway, which only accepts
  // `izzi-` keys. A foreign OPENAI_API_KEY on the host must not shadow the
  // authenticated desktop key, otherwise every turn fails with a bare HTTP 401.
  it('ignores a foreign OPENAI_API_KEY and uses the authenticated desktop key', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-foreign-openai-key');
    const fetchMock = mockFetchSequence([{ choices: [{ message: { content: 'ok' } }] }]);
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent({
      ensureDesktopApiKey: async () => 'izzi-desktop-key',
      getApiKey: () => null,
    } as any);

    const res = await agent.chat({ systemPrompt: 's', message: 'hi' });

    expect(res.error).toBeUndefined();
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer izzi-desktop-key');
  });

  it('honours an izzi- prefixed OPENAI_API_KEY override', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'izzi-env-override');
    const fetchMock = mockFetchSequence([{ choices: [{ message: { content: 'ok' } }] }]);
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent({
      ensureDesktopApiKey: async () => 'izzi-desktop-key',
      getApiKey: () => null,
    } as any);

    await agent.chat({ systemPrompt: 's', message: 'hi' });

    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer izzi-env-override');
  });

  it('falls back to no-key when the only credential is a foreign env key', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-foreign-openai-key');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const agent = new IzziAgent({ getApiKey: () => null } as any);

    const res = await agent.chat({ systemPrompt: 's', message: 'hi' });

    expect(res.error).toBe('no-key');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
