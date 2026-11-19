import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn((name: string, handler: (...args: unknown[]) => unknown) => handlers.set(name, handler)) } }));

import { registerIzziAgentIpc, type IzziAgent, type IzziAgentChatPayload } from './izzi-agent';
import type { SessionRecorder } from './agent-session-recorder';

const EVENT = { sender: { send: vi.fn() } };

function fakeAgent() {
  return { chat: vi.fn(async (_payload: IzziAgentChatPayload) => ({ reply: 'Chào bạn' })) };
}

function fakeRecorder() {
  return { record: vi.fn() };
}

const PAYLOAD: IzziAgentChatPayload = {
  systemPrompt: 'Bạn là Socrates.',
  message: 'Viết caption giúp tôi',
  agentId: 'socrates',
  agentName: 'Socrates',
  turnId: 'turn-1',
};

describe('registerIzziAgentIpc', () => {
  beforeEach(() => handlers.clear());

  it('sends the persona prompt with what main adds, and records the original request', async () => {
    // Arrange
    const agent = fakeAgent();
    const recorder = fakeRecorder();
    const augment = vi.fn((prompt: string, agentId: string | undefined) => `${prompt}\n[hồ sơ ${agentId}]`);
    registerIzziAgentIpc(agent as unknown as IzziAgent, recorder as unknown as SessionRecorder, { augmentSystemPrompt: augment });

    // Act
    const result = await handlers.get('izziAgent:chat')!(EVENT, PAYLOAD);

    // Assert
    expect(result).toMatchObject({ reply: 'Chào bạn' });
    expect(augment).toHaveBeenCalledWith('Bạn là Socrates.', 'socrates');
    expect(agent.chat.mock.calls[0][0]).toEqual({ ...PAYLOAD, systemPrompt: 'Bạn là Socrates.\n[hồ sơ socrates]' });
    expect(recorder.record).toHaveBeenCalledWith(expect.objectContaining({ request: 'Viết caption giúp tôi', agentId: 'socrates' }));
  });

  it('sends the payload unchanged without the hook, or when the hook fails', async () => {
    // Arrange
    const plain = fakeAgent();
    registerIzziAgentIpc(plain as unknown as IzziAgent);
    const plainHandler = handlers.get('izziAgent:chat')!;
    const failing = fakeAgent();
    registerIzziAgentIpc(failing as unknown as IzziAgent, undefined, {
      augmentSystemPrompt: () => { throw new Error('store'); },
    });
    const failingHandler = handlers.get('izziAgent:chat')!;

    // Act
    await plainHandler(EVENT, PAYLOAD);
    await failingHandler(EVENT, PAYLOAD);

    // Assert
    expect(plain.chat.mock.calls[0][0]).toBe(PAYLOAD);
    expect(failing.chat.mock.calls[0][0]).toEqual(PAYLOAD);
  });
});
