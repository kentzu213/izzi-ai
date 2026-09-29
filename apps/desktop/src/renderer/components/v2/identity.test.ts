import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentChatSession } from '../../types/agent-registry';
import { useProjectWorkspaceStore } from '../../store/projectWorkspace';
import { cancelPendingHandoff, createComposerHandoff, type HandoffGateway } from './composerHandoff';
import { applyV2Identity } from './identity';

function session(id: string, agentId: string): AgentChatSession {
  return {
    id,
    agentId,
    agentName: agentId,
    agentIcon: '',
    messages: [],
    model: 'izzi-smart',
    provider: 'izzi',
    createdAt: '2026-09-01T00:00:00.000Z',
    isActive: true,
  } as unknown as AgentChatSession;
}

// Hydrate stays pending until `release()`, so the identity change lands mid-handoff.
function pendingGateway() {
  let release: () => void = () => undefined;
  const state: HandoffGateway = {
    sessions: [session('s1', 'izzi')],
    activeSessionId: 's1',
    isSending: false,
    composerDraft: '',
    agents: [{ id: 'izzi' }] as HandoffGateway['agents'],
    hydrateFromDisk: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        }),
    ),
    switchSession: vi.fn((id: string) => {
      state.activeSessionId = id;
    }),
    newGatewaySession: vi.fn((agentId: string) => {
      const created = session(`gw-new-${agentId}`, agentId);
      state.sessions = [...state.sessions, created];
      state.activeSessionId = created.id;
    }),
    setComposerDraft: vi.fn((value: string) => {
      state.composerDraft = value;
    }),
  };
  return { gw: state, release: () => release() };
}

const handoffWith = (gw: HandoffGateway) =>
  createComposerHandoff({ gateway: () => gw, projects: () => useProjectWorkspaceStore.getState() });

// The default store has no storage under node, so every identity is RAM-only here.
afterEach(() => {
  cancelPendingHandoff();
  useProjectWorkspaceStore.getState().setIdentity(null);
});

describe('applyV2Identity', () => {
  it.each([
    ['an account switch', 'user-b'],
    ['logout', null],
  ])('cancels a pending Home handoff on %s before loading the new identity', async (_label, nextUserId) => {
    const { gw, release } = pendingGateway();
    useProjectWorkspaceStore.getState().setIdentity('user-a');
    const projectA = useProjectWorkspaceStore.getState().createProject('A')!;

    const stale = handoffWith(gw)({ text: 'cũ', projectId: projectA });
    applyV2Identity(nextUserId);
    release();

    expect((await stale).status).toBe('cancelled');
    expect(gw.setComposerDraft).not.toHaveBeenCalled();
    expect(gw.switchSession).not.toHaveBeenCalled();
    expect(gw.newGatewaySession).not.toHaveBeenCalled();
    expect(gw.activeSessionId).toBe('s1');
    expect(gw.composerDraft).toBe('');
    // No focus/assign leaked into the new identity's (empty) metadata.
    expect(useProjectWorkspaceStore.getState().projects).toEqual([]);
    expect(useProjectWorkspaceStore.getState().activeProjectId).toBeNull();
  });

  it('frees the coordinator so the next handoff under the new identity is not in-flight', async () => {
    const { gw, release } = pendingGateway();
    useProjectWorkspaceStore.getState().setIdentity('user-a');

    const stale = handoffWith(gw)({ text: 'cũ', projectId: null });
    applyV2Identity('user-b');
    gw.hydrateFromDisk = vi.fn(async () => undefined);
    const fresh = await handoffWith(gw)({ text: 'mới', projectId: null });
    release();

    expect((await stale).status).toBe('cancelled');
    expect(fresh.status).toBe('handed-off');
    expect(gw.setComposerDraft).toHaveBeenCalledTimes(1);
    expect(gw.setComposerDraft).toHaveBeenCalledWith('mới');
  });
});
