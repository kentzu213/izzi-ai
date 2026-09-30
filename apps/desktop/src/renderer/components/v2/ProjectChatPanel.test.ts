import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentGatewayStore } from '../../store/agentGateway';
import { useProjectWorkspaceStore, type ProjectMeta } from '../../store/projectWorkspace';
import type { AgentChatSession } from '../../types/agent-registry';
import { composerTicket, interruptState, interruptTurn, shouldClearComposer } from './ProjectChatPanel';

type GatewayState = ReturnType<typeof useAgentGatewayStore.getState>;

function project(id: string, sessionIds: string[], overrides: Partial<ProjectMeta> = {}): ProjectMeta {
  return {
    id,
    name: `Dự án ${id}`,
    description: '',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    pinned: false,
    archived: false,
    activeSurface: 'chat',
    sessionIds,
    ...overrides,
  };
}

/** A session whose last message is the assistant reply (streaming = the live turn). */
function session(id: string, replyId: string, replyState: 'streaming' | 'done'): AgentChatSession {
  return {
    id,
    agentId: 'hermes',
    agentName: 'Hermes',
    agentIcon: '🤖',
    model: 'm',
    provider: 'custom',
    createdAt: '2026-09-02T00:00:00.000Z',
    isActive: true,
    messages: [
      { id: `${id}-m0`, sessionId: id, agentId: 'hermes', role: 'user', content: `prompt-${id}`, state: 'done', createdAt: '2026-09-02T00:01:00.000Z' },
      { id: replyId, sessionId: id, agentId: 'hermes', role: 'assistant', content: '', state: replyState, createdAt: '2026-09-02T00:02:00.000Z' },
    ] as AgentChatSession['messages'],
  };
}

function agents(runtime: 'local' | 'izzi'): GatewayState['agents'] {
  return [{ id: 'hermes', name: 'Hermes', runtime }] as unknown as GatewayState['agents'];
}

const abort = vi.fn(async (..._args: string[]) => ({ ok: true }));
const inject = vi.fn(async (..._args: string[]) => ({ ok: true }));

/** Project A has a live turn ('turn-a' in a1); B has an idle session b1. */
function seed(view: 'a' | 'b', runtime: 'local' | 'izzi' = 'local', projects?: ProjectMeta[]) {
  useProjectWorkspaceStore.setState({
    projects: projects ?? [project('a', ['a1']), project('b', ['b1'])],
    activeProjectId: view,
  });
  useAgentGatewayStore.setState({
    sessions: [session('a1', 'turn-a', 'streaming'), session('b1', 'b1-m1', 'done')],
    agents: agents(runtime),
    activeSessionId: view === 'a' ? 'a1' : 'b1',
    isSending: true,
    currentTurnId: 'turn-a',
  });
}

function views() {
  return [useAgentGatewayStore.getState(), useProjectWorkspaceStore.getState()] as const;
}

function messagesOf(id: string) {
  return useAgentGatewayStore.getState().sessions.find((item) => item.id === id)?.messages ?? [];
}

beforeEach(() => {
  vi.stubGlobal('window', { electronAPI: { customProvider: { abort, inject } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  abort.mockClear();
  inject.mockClear();
  useProjectWorkspaceStore.setState({ projects: [], activeProjectId: null });
  useAgentGatewayStore.setState({
    sessions: [],
    activeSessionId: null,
    isSending: false,
    currentTurnId: null,
    composerDraft: '',
    composerImages: [],
    persistOwnerId: null,
  });
});

describe('Project Chat Stop/Inject gating (M3-B1 audit)', () => {
  it('stops and injects the live turn of the viewed session in the open project', async () => {
    seed('a');
    expect(interruptState(...views(), 'a')).toBe('ok');

    expect(interruptTurn('a', 'stop')).toBe(true);
    expect(interruptTurn('a', 'inject', 'ghi-chu-A')).toBe(true);
    await Promise.resolve();

    expect(abort).toHaveBeenCalledWith('turn-a');
    expect(inject).toHaveBeenCalledWith('turn-a', 'ghi-chu-A');
    expect(messagesOf('a1').some((message) => message.content === 'ghi-chu-A')).toBe(true);
  });

  it('refuses to steer project A turn from project B chat and leaves B untouched', async () => {
    seed('b');
    const before = messagesOf('b1');
    expect(interruptState(...views(), 'b')).toBe('elsewhere');

    expect(interruptTurn('b', 'stop')).toBe(false);
    expect(interruptTurn('b', 'inject', 'B_MUST_NOT_STEER_A')).toBe(false);
    await Promise.resolve();

    expect(abort).not.toHaveBeenCalled();
    expect(inject).not.toHaveBeenCalled();
    expect(messagesOf('b1')).toBe(before);
    expect(JSON.stringify(useAgentGatewayStore.getState().sessions)).not.toContain('B_MUST_NOT_STEER_A');
  });

  it('re-checks the stores at click time when the view changed after render', async () => {
    seed('a');
    expect(interruptState(...views(), 'a')).toBe('ok');
    // The user switches to B before the stale A button handler runs.
    useProjectWorkspaceStore.setState({ activeProjectId: 'b' });
    useAgentGatewayStore.setState({ activeSessionId: 'b1' });

    expect(interruptTurn('a', 'stop')).toBe(false);
    expect(interruptTurn('a', 'inject', 'stale')).toBe(false);
    await Promise.resolve();
    expect(abort).not.toHaveBeenCalled();
    expect(inject).not.toHaveBeenCalled();
  });

  it('reports elsewhere when the panel project is not the open project', () => {
    seed('a');
    useProjectWorkspaceStore.setState({ activeProjectId: 'b' });
    expect(interruptState(...views(), 'a')).toBe('elsewhere');
    expect(interruptTurn('a', 'stop')).toBe(false);
  });

  it('reports elsewhere for an archived owner or a session not assigned to the project', () => {
    seed('a', 'local', [project('a', ['a1'], { archived: true }), project('b', ['b1'])]);
    expect(interruptState(...views(), 'a')).toBe('elsewhere');

    seed('a', 'local', [project('a', []), project('b', ['b1'])]);
    expect(interruptState(...views(), 'a')).toBe('elsewhere');
    expect(interruptTurn('a', 'stop')).toBe(false);
  });

  it('marks a live izzi-runtime turn as here but not interruptible', () => {
    seed('a', 'izzi');
    expect(interruptState(...views(), 'a')).toBe('here');
    expect(interruptTurn('a', 'stop')).toBe(false);
    expect(abort).not.toHaveBeenCalled();
  });

  it('reports none when nothing is sending', () => {
    seed('a');
    useAgentGatewayStore.setState({ isSending: false });
    expect(interruptState(...views(), 'a')).toBe('none');
    expect(interruptTurn('a', 'stop')).toBe(false);
  });
});

describe('Project Chat composer clear ticket (M3-B1 audit)', () => {
  const sentImages = ['img-1'];

  function ticketFromA() {
    seed('a');
    useAgentGatewayStore.setState({ composerDraft: 'hello', composerImages: sentImages, persistOwnerId: 'user-a' });
    return composerTicket(...views());
  }

  it('clears when the composer still holds exactly what was sent', () => {
    const ticket = ticketFromA();
    expect(shouldClearComposer(ticket, ...views())).toBe(true);

    useAgentGatewayStore.setState({ composerImages: ['img-1'] });
    expect(shouldClearComposer(ticket, ...views())).toBe(true);
  });

  it('keeps a draft edited in the same session after sending', () => {
    const ticket = ticketFromA();
    useAgentGatewayStore.setState({ composerDraft: 'hello, còn nữa' });
    expect(shouldClearComposer(ticket, ...views())).toBe(false);
  });

  it('keeps an image added after sending', () => {
    const ticket = ticketFromA();
    useAgentGatewayStore.setState({ composerImages: ['img-1', 'img-2'] });
    expect(shouldClearComposer(ticket, ...views())).toBe(false);
  });

  it('does not clear across a project, session or account change', () => {
    const ticket = ticketFromA();

    useProjectWorkspaceStore.setState({ activeProjectId: 'b' });
    expect(shouldClearComposer(ticket, ...views())).toBe(false);
    useProjectWorkspaceStore.setState({ activeProjectId: 'a' });

    useAgentGatewayStore.setState({ activeSessionId: 'b1' });
    expect(shouldClearComposer(ticket, ...views())).toBe(false);
    useAgentGatewayStore.setState({ activeSessionId: 'a1' });

    useAgentGatewayStore.setState({ persistOwnerId: 'user-b' });
    expect(shouldClearComposer(ticket, ...views())).toBe(false);
  });

  it('a stale A callback does not wipe the draft and image typed in B', () => {
    const ticket = ticketFromA();
    // While A is pending the user opens B and types a new message.
    useProjectWorkspaceStore.setState({ activeProjectId: 'b' });
    useAgentGatewayStore.setState({ activeSessionId: 'b1', composerDraft: 'ban-nhap-B', composerImages: ['img-B'] });

    // Same guard as handleSubmit after sendGatewayMessage resolves.
    if (shouldClearComposer(ticket, ...views())) {
      useAgentGatewayStore.getState().setComposerDraft('');
      useAgentGatewayStore.getState().setComposerImages([]);
    }
    expect(useAgentGatewayStore.getState().composerDraft).toBe('ban-nhap-B');
    expect(useAgentGatewayStore.getState().composerImages).toEqual(['img-B']);
  });
});
