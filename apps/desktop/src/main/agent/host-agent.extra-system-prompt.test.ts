import { afterEach, describe, expect, it, vi } from 'vitest';
import { runHostAgentTurn } from './host-agent';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function systemPromptSent(extraSystemPrompt?: string): Promise<string> {
  const fetchMock = vi.fn().mockRejectedValue(new Error('fetch failed: offline'));
  vi.stubGlobal('fetch', fetchMock);
  await runHostAgentTurn({
    config: { baseUrl: 'http://127.0.0.1:9/v1', authType: 'bearer', selectedModel: 'test-model' },
    apiKey: 'test-key',
    message: 'hi',
    history: [],
    images: [],
    mode: 'agent',
    workingDir: 'C:\\work',
    turnId: 'turn-1',
    requestApproval: async () => 'deny',
    extraSystemPrompt,
  });
  const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
  return body.messages[0].content as string;
}

describe('runHostAgentTurn extraSystemPrompt', () => {
  it('appends the extra prompt to the system message after the working dir', async () => {
    const content = await systemPromptSent('## Documentary channel mode: Test');
    expect(content).toContain('Your working directory is: C:\\work');
    expect(content.trimEnd().endsWith('## Documentary channel mode: Test')).toBe(true);
  });

  it('leaves the system message unchanged when absent', async () => {
    const content = await systemPromptSent(undefined);
    expect(content).not.toContain('Documentary channel mode');
  });
});
