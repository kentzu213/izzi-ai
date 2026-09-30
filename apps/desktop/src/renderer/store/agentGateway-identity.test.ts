import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The persist subscription is registered at module load only when `window`
// exists, so each test stubs the bridge first and imports a fresh store.
type Store = typeof import('./agentGateway')['useAgentGatewayStore'];

const sess = (id: string, content = 'hi') => ({
  id,
  agentId: 'hermes',
  agentName: 'Hermes',
  agentIcon: 'agent',
  messages: [
    { id: `${id}-m1`, sessionId: id, agentId: 'hermes', role: 'user', content, state: 'done', createdAt: '2026-01-01T00:00:00Z' },
  ],
  model: 'gpt-5.5',
  provider: 'custom',
  createdAt: '2026-01-01T00:00:00Z',
  isActive: true,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// The chat bridge is read at call time, so tests attach it after loadStore.
function stubCustomProvider(getConfig: () => Promise<unknown>, chat: () => Promise<unknown>) {
  const provider = { getConfig: vi.fn(getConfig), chat: vi.fn(chat), abort: vi.fn(async () => ({ ok: true })) };
  (globalThis as unknown as { window: { electronAPI: Record<string, unknown> } }).window.electronAPI.customProvider =
    provider;
  return provider;
}

let bridge: {
  list: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};
let store: Store;

async function loadStore(): Promise<Store> {
  vi.resetModules();
  (globalThis as unknown as { window?: unknown }).window = { electronAPI: { gatewaySessions: bridge } };
  return (await import('./agentGateway')).useAgentGatewayStore;
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

beforeEach(async () => {
  bridge = {
    list: vi.fn(async () => []),
    save: vi.fn(async () => ({ ok: true })),
    delete: vi.fn(async () => ({ ok: true })),
  };
  store = await loadStore();
});

afterEach(() => {
  // An owner change cancels this module's pending debounced save, so it cannot
  // fire into the next test's freshly stubbed bridge.
  store.getState().setGatewayIdentity(null);
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe('gateway session identity scoping', () => {
  it('does not list persisted chats before an account is bound', async () => {
    await store.getState().hydrateFromDisk();

    expect(bridge.list).not.toHaveBeenCalled();
    expect(store.getState().hydrated).toBe(false);
  });

  it('hydrates with the bound owner and resets memory on an account switch', async () => {
    bridge.list.mockResolvedValueOnce([sess('a1', 'from A')]);
    store.getState().setGatewayIdentity('user-a');
    await flush();
    expect(bridge.list).toHaveBeenLastCalledWith('user-a');
    expect(store.getState().sessions.map((s) => s.id)).toEqual(['a1']);

    store.setState({ composerDraft: 'draft for A' });
    bridge.list.mockResolvedValueOnce([sess('b1', 'from B')]);
    store.getState().setGatewayIdentity('user-b');
    expect(store.getState().sessions).toEqual([]);
    expect(store.getState().composerDraft).toBe('');
    await flush();

    expect(bridge.list).toHaveBeenLastCalledWith('user-b');
    expect(store.getState().sessions.map((s) => s.id)).toEqual(['b1']);
    expect(store.getState().persistOwnerId).toBe('user-b');
  });

  it('drops a hydrate result that resolves after the account changed', async () => {
    const slowA = deferred<unknown[]>();
    bridge.list.mockReturnValueOnce(slowA.promise);
    store.getState().setGatewayIdentity('user-a');

    bridge.list.mockResolvedValueOnce([]);
    store.getState().setGatewayIdentity('user-b');
    await flush();
    slowA.resolve([sess('a1', 'from A')]);
    await flush();

    expect(store.getState().sessions).toEqual([]);
    expect(store.getState().persistOwnerId).toBe('user-b');
  });

  it('clears memory on logout without deleting anything on disk', async () => {
    bridge.list.mockResolvedValueOnce([sess('a1')]);
    store.getState().setGatewayIdentity('user-a');
    await flush();

    store.getState().setGatewayIdentity(null);

    expect(store.getState().sessions).toEqual([]);
    expect(store.getState().persistOwnerId).toBeNull();
    expect(bridge.delete).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 42, 'x'.repeat(201)])('treats %s as signed out', (claimed) => {
    store.getState().setGatewayIdentity(claimed);

    expect(store.getState().persistOwnerId).toBeNull();
    expect(bridge.list).not.toHaveBeenCalled();
  });

  it('deletes a closed chat only under the bound owner', async () => {
    store.getState().setGatewayIdentity('user-a');
    await flush();
    store.setState({ sessions: [sess('a1')] as never, activeSessionId: 'a1' });

    store.getState().closeAgentChat('a1');
    expect(bridge.delete).toHaveBeenCalledWith('user-a', 'a1');

    store.getState().setGatewayIdentity(null);
    store.setState({ sessions: [sess('x1')] as never, activeSessionId: 'x1' });
    store.getState().closeAgentChat('x1');
    expect(bridge.delete).toHaveBeenCalledTimes(1);
  });

  it('saves under the owner that scheduled the write', async () => {
    store.getState().setGatewayIdentity('user-a');
    await flush();
    vi.useFakeTimers();

    store.setState({ sessions: [sess('a1')] as never });
    vi.advanceTimersByTime(700);

    expect(bridge.save).toHaveBeenCalledTimes(1);
    expect(bridge.save.mock.calls[0][0]).toBe('user-a');
    expect((bridge.save.mock.calls[0][1] as { id: string }).id).toBe('a1');
  });

  it('drops a pending save when the account changes before it fires', async () => {
    store.getState().setGatewayIdentity('user-a');
    await flush();
    vi.useFakeTimers();

    store.setState({ sessions: [sess('a1')] as never });
    store.getState().setGatewayIdentity('user-b');
    vi.advanceTimersByTime(700);

    expect(bridge.save).not.toHaveBeenCalled();
  });

  it('drops an old hydrate success after A -> logout -> A', async () => {
    const oldA = deferred<unknown[]>();
    const newA = deferred<unknown[]>();
    bridge.list.mockReturnValueOnce(oldA.promise).mockReturnValueOnce(newA.promise);
    store.getState().setGatewayIdentity('user-a');
    store.getState().setGatewayIdentity(null);
    store.getState().setGatewayIdentity('user-a');
    expect(bridge.list).toHaveBeenCalledTimes(2);

    oldA.resolve([sess('a-old', 'stale')]);
    await flush();
    expect(store.getState().sessions).toEqual([]);
    expect(store.getState().hydrated).toBe(false);

    newA.resolve([sess('a-new', 'fresh')]);
    await flush();
    expect(store.getState().sessions.map((s) => s.id)).toEqual(['a-new']);
    expect(store.getState().hydrated).toBe(true);
  });

  it('drops an old hydrate error after A -> logout -> A', async () => {
    const oldA = deferred<unknown[]>();
    const newA = deferred<unknown[]>();
    bridge.list.mockReturnValueOnce(oldA.promise).mockReturnValueOnce(newA.promise);
    store.getState().setGatewayIdentity('user-a');
    store.getState().setGatewayIdentity(null);
    store.getState().setGatewayIdentity('user-a');

    oldA.reject(new Error('old list failed'));
    await flush();
    expect(store.getState().hydrated).toBe(false);

    newA.resolve([sess('a-new', 'fresh')]);
    await flush();
    expect(store.getState().sessions.map((s) => s.id)).toEqual(['a-new']);
    expect(store.getState().hydrated).toBe(true);
  });

  it('never sends the old payload when the account changes during the config read', async () => {
    store.getState().setGatewayIdentity('user-a');
    await flush();
    store.setState({ sessions: [sess('a1')] as never, activeSessionId: 'a1' });
    const config = deferred<unknown>();
    const provider = stubCustomProvider(() => config.promise, async () => ({ reply: 'late A' }));

    const sending = store.getState().sendGatewayMessage('secret from A');
    const turnA = store.getState().currentTurnId;
    expect(store.getState().isSending).toBe(true);
    expect(turnA).toBeTruthy();

    bridge.list.mockResolvedValueOnce([sess('b1', 'from B')]);
    store.getState().setGatewayIdentity('user-b');
    expect(store.getState().isSending).toBe(false);
    expect(store.getState().currentTurnId).toBeNull();
    await flush();
    expect(provider.abort).toHaveBeenCalledWith(turnA);

    config.resolve({ enabled: true, hasKey: true });
    await expect(sending).resolves.toBe(false);

    expect(provider.chat).not.toHaveBeenCalled();
    expect(store.getState().sessions.map((s) => s.id)).toEqual(['b1']);
    expect(store.getState().isSending).toBe(false);
    expect(store.getState().currentTurnId).toBeNull();
  });

  it('drops a chat reply that resolves after the account changed', async () => {
    store.getState().setGatewayIdentity('user-a');
    await flush();
    store.setState({ sessions: [sess('a1')] as never, activeSessionId: 'a1' });
    const reply = deferred<unknown>();
    const provider = stubCustomProvider(async () => ({ enabled: true, hasKey: true }), () => reply.promise);

    const sending = store.getState().sendGatewayMessage('secret from A');
    const turnA = store.getState().currentTurnId;
    await flush();
    expect(provider.chat).toHaveBeenCalledTimes(1);

    bridge.list.mockResolvedValueOnce([sess('b1', 'from B')]);
    store.getState().setGatewayIdentity('user-b');
    await flush();
    expect(provider.abort).toHaveBeenCalledWith(turnA);
    // B's own turn is in flight; A's late completion must not end it.
    store.setState({ isSending: true, currentTurnId: 'turn-b' });

    reply.resolve({ reply: 'late A' });
    await expect(sending).resolves.toBe(false);

    const state = store.getState();
    expect(state.isSending).toBe(true);
    expect(state.currentTurnId).toBe('turn-b');
    expect(state.sessions.map((s) => s.id)).toEqual(['b1']);
    expect(JSON.stringify(state.sessions)).not.toContain('late A');
  });

  it('never saves while signed out', () => {
    vi.useFakeTimers();

    store.setState({ sessions: [sess('x1')] as never });
    vi.advanceTimersByTime(700);

    expect(bridge.save).not.toHaveBeenCalled();
  });

  it('drops stale stream events for a restored turn after A -> logout -> A', async () => {
    store.getState().setGatewayIdentity('user-a');
    await flush();
    store.setState({ sessions: [sess('a1')] as never, activeSessionId: 'a1' });
    const reply = deferred<unknown>();
    stubCustomProvider(async () => ({ enabled: true, hasKey: true }), () => reply.promise);
    const sending = store.getState().sendGatewayMessage('question');
    const turnA = store.getState().currentTurnId as string;
    await flush();

    store.getState().setGatewayIdentity(null);
    const restored = sess('a1');
    restored.messages.push({ ...restored.messages[0], id: turnA, role: 'assistant', content: 'saved partial' });
    bridge.list.mockResolvedValueOnce([restored]);
    store.getState().setGatewayIdentity('user-a');
    await flush();
    const before = JSON.stringify(store.getState().sessions);
    expect(before).toContain('saved partial');
    expect(store.getState().currentTurnId).toBeNull();

    const { applyStreamEvent } = store.getState();
    applyStreamEvent({ turnId: turnA, kind: 'delta', text: ' late delta' });
    applyStreamEvent({ turnId: turnA, kind: 'reasoning', text: 'late reasoning' });
    applyStreamEvent({ turnId: turnA, kind: 'step', step: { id: 'st1', kind: 'tool', label: 'late', status: 'running' } });

    expect(JSON.stringify(store.getState().sessions)).toBe(before);
    expect(store.getState().currentTurnId).toBeNull();
    reply.resolve({ reply: 'late A' });
    await expect(sending).resolves.toBe(false);
    expect(JSON.stringify(store.getState().sessions)).toBe(before);
  });

  it('applies stream events to the live turn of the current identity only', async () => {
    store.getState().setGatewayIdentity('user-a');
    await flush();
    store.setState({ sessions: [sess('a1')] as never, activeSessionId: 'a1' });
    const reply = deferred<unknown>();
    stubCustomProvider(async () => ({ enabled: true, hasKey: true }), () => reply.promise);
    const sending = store.getState().sendGatewayMessage('question');
    const turn = store.getState().currentTurnId as string;
    await flush();

    const { applyStreamEvent } = store.getState();
    applyStreamEvent({ turnId: turn, kind: 'delta', text: 'Hel' });
    applyStreamEvent({ turnId: turn, kind: 'delta', text: 'lo' });
    applyStreamEvent({ turnId: turn, kind: 'reasoning', text: 'thinking' });
    applyStreamEvent({ turnId: turn, kind: 'step', step: { id: 'st1', kind: 'tool', label: 'search', status: 'running' } });
    applyStreamEvent({ turnId: turn, kind: 'step', step: { id: 'st1', kind: 'tool', label: 'search', status: 'done' } });
    applyStreamEvent({ turnId: 'other-turn', kind: 'delta', text: ' ignored' });

    const live = store.getState().sessions[0].messages.find((m) => m.id === turn)!;
    expect(live.content).toBe('Hello');
    expect(live.reasoning).toBe('thinking');
    expect(live.steps).toEqual([{ id: 'st1', kind: 'tool', label: 'search', status: 'done' }]);
    expect(live.state).toBe('streaming');

    reply.resolve({ reply: 'Hello' });
    await sending;
  });
});
