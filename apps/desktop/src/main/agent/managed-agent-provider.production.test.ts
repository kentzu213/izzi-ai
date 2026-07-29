import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedProviderStreamChunk } from './types';

const mocks = vi.hoisted(() => ({
  axiosRequest: vi.fn(),
  localConfig: null as Record<string, unknown> | null,
  configReadCount: 0,
}));

vi.mock('axios', () => ({ default: { request: (...args: any[]) => mocks.axiosRequest(...args) } }));
vi.mock('fs', () => ({
  existsSync: () => mocks.localConfig !== null,
  readFileSync: () => {
    mocks.configReadCount += 1;
    return JSON.stringify(mocks.localConfig);
  },
}));

function fakeStream(chunks: string[]): NodeJS.ReadableStream {
  return (async function* () {
    for (const chunk of chunks) yield Buffer.from(chunk, 'utf8');
  })() as unknown as NodeJS.ReadableStream;
}

async function collect(gen: AsyncGenerator<ManagedProviderStreamChunk>): Promise<ManagedProviderStreamChunk[]> {
  const events: ManagedProviderStreamChunk[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

afterEach(() => {
  mocks.axiosRequest.mockReset();
  mocks.localConfig = null;
  mocks.configReadCount = 0;
  vi.resetModules();
});

describe('ManagedAgentProvider production Izzi routing', () => {
  it('preserves direct GPT-5.6 Sol', async () => {
    const { normalizeManagedModel } = await import('./managed-agent-provider');
    expect(normalizeManagedModel('gpt-5.6-sol')).toBe('gpt-5.6-sol');
  });

  it('ignores gateway auth and retries the fixed-price 400 with one request identity', async () => {
    mocks.localConfig = {
      models: { providers: { ninerouter: { baseUrl: 'https://api.izziapi.com/v1' } } },
      agents: { defaults: { model: { primary: 'gpt-5.6-sol' } } },
      gateway: { auth: { token: 'gateway-token-fixture' } },
    };
    mocks.axiosRequest
      .mockResolvedValueOnce({
        status: 400,
        headers: { 'content-type': 'application/json' },
        data: fakeStream([
          '{"error":{"message":"Streaming is temporarily unavailable for fixed-price models; retry with stream=false."}}',
        ]),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/json' },
        data: { choices: [{ message: { content: 'SOL_OK' } }] },
      });
    const { ManagedAgentProvider } = await import('./managed-agent-provider');
    const provider = new ManagedAgentProvider({ getAccessToken: async () => 'session-token-fixture' });

    const events = await collect(provider.streamChat({ sessionId: 's', message: 'hi', history: [] }));

    expect(mocks.axiosRequest.mock.calls.map((call: any[]) => call[0].data.stream)).toEqual([true, false]);
    expect(mocks.axiosRequest.mock.calls[1][0].url).toBe(
      mocks.axiosRequest.mock.calls[0][0].url,
    );
    expect(mocks.axiosRequest.mock.calls[1][0].data.messages).toBe(
      mocks.axiosRequest.mock.calls[0][0].data.messages,
    );
    const first = mocks.axiosRequest.mock.calls[0][0].headers;
    const retry = mocks.axiosRequest.mock.calls[1][0].headers;
    expect(first['x-api-key']).toBeUndefined();
    expect(first.Authorization).toBe('Bearer session-token-fixture');
    expect(first['X-Source-Platform']).toBe('starizzi');
    expect(first['Idempotency-Key']).toBeTruthy();
    expect(retry['Idempotency-Key']).toBe(first['Idempotency-Key']);
    expect(events.some((event) => event.type === 'assistant_delta' && event.delta === 'SOL_OK')).toBe(true);
    expect(mocks.configReadCount).toBe(1);
  });

  it('does not forward the logged-in token to a configured non-Izzi origin', async () => {
    mocks.localConfig = {
      models: { providers: { ninerouter: { baseUrl: 'https://custom.example.dev/v1' } } },
      gateway: { auth: { token: 'gateway-token-fixture' } },
    };
    const { ManagedAgentProvider } = await import('./managed-agent-provider');
    const provider = new ManagedAgentProvider({ getAccessToken: async () => 'session-token-fixture' });

    await expect(
      collect(provider.streamChat({ sessionId: 's', message: 'hi', history: [] })),
    ).rejects.toThrow(/official Izzi HTTPS endpoint/i);
    expect(mocks.axiosRequest).not.toHaveBeenCalled();
  });

  it('rejects a configured non-Izzi origin even when it has a local key', async () => {
    mocks.localConfig = {
      models: { providers: { ninerouter: { baseUrl: 'https://custom.example.dev/v1', apiKey: 'local-key-fixture' } } },
    };
    const { ManagedAgentProvider } = await import('./managed-agent-provider');
    const provider = new ManagedAgentProvider({ getAccessToken: async () => 'session-token-fixture' });

    await expect(
      collect(provider.streamChat({ sessionId: 's', message: 'hi', history: [] })),
    ).rejects.toThrow(/official Izzi HTTPS endpoint/i);
    expect(mocks.axiosRequest).not.toHaveBeenCalled();
  });

  it('fails closed when the persisted managed route shape is invalid', async () => {
    mocks.localConfig = {
      models: { providers: { ninerouter: { baseUrl: 42 } } },
    };
    const { ManagedAgentProvider } = await import('./managed-agent-provider');
    const provider = new ManagedAgentProvider({ getAccessToken: async () => 'session-token-fixture' });

    await expect(
      collect(provider.streamChat({ sessionId: 's', message: 'hi', history: [] })),
    ).rejects.toThrow(/configuration is unreadable or invalid/i);
    expect(mocks.axiosRequest).not.toHaveBeenCalled();
  });

  it('does not retry broad streaming text that is not an exact known JSON error', async () => {
    mocks.localConfig = {
      models: {
        providers: {
          ninerouter: {
            baseUrl: 'https://api.izziapi.com/v1',
            apiKey: 'local-key-fixture',
          },
        },
      },
      agents: { defaults: { model: { primary: 'gpt-5.6-sol' } } },
    };
    mocks.axiosRequest.mockResolvedValue({
      status: 400,
      headers: { 'content-type': 'application/json' },
      data: fakeStream(['streaming temporarily unavailable for this model']),
    });
    const { ManagedAgentProvider } = await import('./managed-agent-provider');
    const provider = new ManagedAgentProvider({ getAccessToken: async () => 'session-token-fixture' });

    await expect(
      collect(provider.streamChat({ sessionId: 's', message: 'hi', history: [] })),
    ).rejects.toThrow('Managed provider returned HTTP 400.');
    expect(mocks.axiosRequest).toHaveBeenCalledTimes(1);
  });

  it('does not surface raw error text from a successful structured stream', async () => {
    mocks.localConfig = {
      models: {
        providers: {
          ninerouter: {
            baseUrl: 'https://api.izziapi.com/v1',
            apiKey: 'local-key-fixture',
          },
        },
      },
    };
    mocks.axiosRequest.mockResolvedValue({
      status: 200,
      headers: { 'content-type': 'application/x-ndjson' },
      data: fakeStream(['{"type":"error","error":"raw-secret-trace"}\n']),
    });
    const { ManagedAgentProvider } = await import('./managed-agent-provider');
    const provider = new ManagedAgentProvider({ getAccessToken: async () => null });

    const events = await collect(
      provider.streamChat({ sessionId: 's', message: 'hi', history: [] }),
    );
    expect(events).toEqual([
      { type: 'error', error: 'Managed provider stream failed.' },
    ]);
    expect(JSON.stringify(events)).not.toContain('raw-secret-trace');
  });
});
