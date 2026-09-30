import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentChatSession, AIProvider } from '../../types/agent-registry';
import {
  createProjectWorkspaceStore,
  SESSION_IDS_MAX,
  type ProjectWorkspaceStorage,
} from '../../store/projectWorkspace';
import {
  cancelPendingHandoff,
  createComposerHandoff,
  createProjectSession,
  type HandoffGateway,
} from './composerHandoff';

function session(id: string, agentId: string, createdAt: string, lastMessageAt?: string): AgentChatSession {
  return {
    id,
    agentId,
    agentName: agentId,
    agentIcon: '',
    messages: lastMessageAt ? [{ id: `${id}-m`, role: 'user', content: 'x', createdAt: lastMessageAt }] : [],
    model: 'izzi-smart',
    provider: 'izzi',
    createdAt,
    isActive: true,
  } as unknown as AgentChatSession;
}

interface FakeGatewayOptions {
  persisted?: AgentChatSession[];
  live?: AgentChatSession[];
  activeSessionId?: string | null;
  isSending?: boolean;
  composerDraft?: string;
  agents?: string[];
  /** Overrides the model application (the real store runs a connection probe for custom providers). */
  applyModel?: (sessionId: string, model: string, provider: AIProvider) => Promise<{ ok: boolean; message?: string }>;
}

// Mirrors the real store's contract: hydrate restores persisted sessions only
// when nothing was created first; newGatewaySession appends and activates;
// applySessionModel updates exactly the addressed session on success.
function fakeGateway(options: FakeGatewayOptions = {}) {
  let counter = 0;
  const state: HandoffGateway = {
    sessions: options.live ?? [],
    activeSessionId: options.activeSessionId ?? null,
    isSending: options.isSending ?? false,
    composerDraft: options.composerDraft ?? '',
    agents: (options.agents ?? ['izzi', 'hermes']).map((id) => ({ id })) as HandoffGateway['agents'],
    hydrateFromDisk: vi.fn(async () => {
      const persisted = options.persisted ?? [];
      if (persisted.length > 0 && state.sessions.length === 0) {
        state.sessions = persisted;
        state.activeSessionId = persisted[persisted.length - 1].id;
      }
    }),
    switchSession: vi.fn((id: string) => {
      state.activeSessionId = id;
    }),
    newGatewaySession: vi.fn((agentId: string) => {
      if (!state.agents.some((agent) => agent.id === agentId)) return;
      counter += 1;
      const created = session(`gw-new-${counter}`, agentId, '2026-09-27T12:00:00.000Z');
      state.sessions = [...state.sessions, created];
      state.activeSessionId = created.id;
    }),
    setComposerDraft: vi.fn((value: string) => {
      state.composerDraft = value;
    }),
    applySessionModel: vi.fn(async (sessionId: string, model: string, provider: AIProvider) => {
      if (options.applyModel) return options.applyModel(sessionId, model, provider);
      state.sessions = state.sessions.map((s) => (s.id === sessionId ? { ...s, model, provider } : s));
      return { ok: true };
    }),
  };
  return state;
}

function memoryStorage(initial?: string): ProjectWorkspaceStorage & { value: string | null } {
  const box = {
    value: initial ?? null,
    getItem: () => box.value,
    setItem: (_key: string, value: string) => {
      box.value = value;
    },
  };
  return box;
}

function projectsWith(storage = memoryStorage()) {
  let n = 0;
  return createProjectWorkspaceStore({
    storage,
    userId: 'user-a',
    now: () => '2026-09-27T10:00:00.000Z',
    newId: () => `p${++n}`,
  });
}

// The pending-handoff guard is module-level; never leak one test's pending run into the next.
afterEach(() => cancelPendingHandoff());

describe('composer hand-off', () => {
  it('awaits hydrate before creating a session so persisted sessions are not skipped', async () => {
    const order: string[] = [];
    const gw = fakeGateway({ persisted: [session('old', 'izzi', '2026-09-01T00:00:00.000Z')] });
    const hydrate = gw.hydrateFromDisk;
    gw.hydrateFromDisk = vi.fn(async () => {
      await Promise.resolve();
      await hydrate();
      order.push('hydrate');
    });
    const create = gw.newGatewaySession;
    gw.newGatewaySession = vi.fn((agentId: string) => {
      order.push('create');
      create(agentId);
    });
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({
      text: 'Viết kế hoạch',
      projectId: a,
    });

    expect(result.status).toBe('handed-off');
    expect(order).toEqual(['hydrate', 'create']);
    expect(gw.sessions.map((s) => s.id)).toEqual(['old', 'gw-new-1']);
  });

  it('keeps the prompt byte-for-byte and never auto-sends', async () => {
    const gw = fakeGateway();
    const projects = projectsWith();
    const text = '  Dòng 1\nDòng 2 — "quote" ✓  ';

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({ text });

    expect(result.status).toBe('handed-off');
    expect(gw.composerDraft).toBe(text);
    expect(gw.setComposerDraft).toHaveBeenCalledTimes(1);
    expect(gw).not.toHaveProperty('sendGatewayMessage');
  });

  it('switches to the most recent session bound to the project', async () => {
    const gw = fakeGateway({
      live: [
        session('s-a1', 'izzi', '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z'),
        session('s-a2', 'izzi', '2026-09-01T00:00:00.000Z', '2026-09-05T00:00:00.000Z'),
        session('s-other', 'izzi', '2026-09-06T00:00:00.000Z'),
      ],
      activeSessionId: 's-other',
    });
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;
    projects.getState().assignSession(a, 's-a1');
    projects.getState().assignSession(a, 's-a2');

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({
      text: 'tiếp tục',
      projectId: a,
    });

    expect(result).toEqual({ status: 'handed-off', sessionId: 's-a2' });
    expect(gw.activeSessionId).toBe('s-a2');
    expect(gw.newGatewaySession).not.toHaveBeenCalled();
  });

  it('never targets a session bound to another project, even when it is active for the same agent', async () => {
    const gw = fakeGateway({ live: [session('s-b', 'izzi', '2026-09-01T00:00:00.000Z')], activeSessionId: 's-b' });
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;
    const b = projects.getState().createProject('B')!;
    projects.getState().assignSession(b, 's-b');

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({
      text: 'cho A',
      projectId: a,
    });

    expect(result.status).toBe('handed-off');
    expect(result.status === 'handed-off' && result.sessionId).not.toBe('s-b');
    expect(gw.activeSessionId).toBe('gw-new-1');
    const byId = Object.fromEntries(projects.getState().projects.map((p) => [p.id, p.sessionIds]));
    expect(byId[a]).toEqual(['gw-new-1']);
    expect(byId[b]).toEqual(['s-b']);
  });

  it('does not reuse a project-bound active session when no project is selected', async () => {
    const gw = fakeGateway({ live: [session('s-b', 'izzi', '2026-09-01T00:00:00.000Z')], activeSessionId: 's-b' });
    const projects = projectsWith();
    const b = projects.getState().createProject('B')!;
    projects.getState().assignSession(b, 's-b');

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({ text: 'x' });

    expect(result).toEqual({ status: 'handed-off', sessionId: 'gw-new-1' });
    expect(projects.getState().projects[0].sessionIds).toEqual(['s-b']);
  });

  it('reuses the active unassigned session when no project is selected', async () => {
    const gw = fakeGateway({ live: [session('s-free', 'hermes', '2026-09-01T00:00:00.000Z')], activeSessionId: 's-free' });
    const projects = projectsWith();

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({ text: 'x' });

    expect(result).toEqual({ status: 'handed-off', sessionId: 's-free' });
    expect(gw.newGatewaySession).not.toHaveBeenCalled();
  });

  it('restores the binding after a cold reload (projects from storage, sessions from disk)', async () => {
    const storage = memoryStorage();
    const first = projectsWith(storage);
    const a = first.getState().createProject('A')!;
    first.getState().assignSession(a, 's-a');

    const reloadedProjects = projectsWith(storage);
    const gw = fakeGateway({
      persisted: [session('s-a', 'izzi', '2026-09-01T00:00:00.000Z'), session('s-x', 'izzi', '2026-09-02T00:00:00.000Z')],
    });

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => reloadedProjects.getState() })({
      text: 'sau khi mở lại',
      projectId: a,
    });

    expect(result).toEqual({ status: 'handed-off', sessionId: 's-a' });
    expect(gw.newGatewaySession).not.toHaveBeenCalled();
  });

  it('keeps the draft and changes nothing while the gateway is sending', async () => {
    const gw = fakeGateway({ live: [session('s1', 'izzi', '2026-09-01T00:00:00.000Z')], activeSessionId: 's1', isSending: true });
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({
      text: 'đợi',
      projectId: a,
    });

    expect(result.status).toBe('busy');
    expect(gw.setComposerDraft).not.toHaveBeenCalled();
    expect(gw.newGatewaySession).not.toHaveBeenCalled();
    expect(gw.activeSessionId).toBe('s1');
  });

  it('refuses to overwrite a different unsent chat draft', async () => {
    const gw = fakeGateway({ composerDraft: 'bản nháp cũ' });
    const projects = projectsWith();

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({ text: 'mới' });

    expect(result.status).toBe('draft-occupied');
    expect(gw.composerDraft).toBe('bản nháp cũ');
    expect(gw.newGatewaySession).not.toHaveBeenCalled();
  });

  it('reports an error and keeps state when no session can be created', async () => {
    const gw = fakeGateway({ agents: [] });
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({
      text: 'x',
      projectId: a,
    });

    expect(result.status).toBe('no-session');
    expect(gw.setComposerDraft).not.toHaveBeenCalled();
    expect(projects.getState().projects[0].sessionIds).toEqual([]);
  });

  it('reports an error when a store action throws, without setting the draft', async () => {
    const gw = fakeGateway();
    gw.hydrateFromDisk = vi.fn(async () => {
      throw new Error('disk');
    });
    const projects = projectsWith();

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({ text: 'x' });

    expect(result.status).toBe('error');
    expect(gw.setComposerDraft).not.toHaveBeenCalled();
  });

  it('rejects empty text and missing or archived projects', async () => {
    const gw = fakeGateway();
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;
    projects.getState().archiveProject(a, true);
    const handOff = createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() });

    expect((await handOff({ text: '   ' })).status).toBe('empty');
    expect((await handOff({ text: 'x', projectId: 'nope' })).status).toBe('project-missing');
    expect((await handOff({ text: 'x', projectId: a })).status).toBe('project-missing');
    expect(gw.setComposerDraft).not.toHaveBeenCalled();
  });

  it('creates a session for the chosen agent instead of reusing a project session of another agent', async () => {
    const gw = fakeGateway({
      live: [session('s-izzi', 'izzi', '2026-09-01T00:00:00.000Z', '2026-09-05T00:00:00.000Z')],
      activeSessionId: 's-izzi',
    });
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;
    projects.getState().assignSession(a, 's-izzi');

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({
      text: 'cho hermes',
      projectId: a,
      agentId: 'hermes',
    });

    expect(result).toEqual({ status: 'handed-off', sessionId: 'gw-new-1' });
    expect(gw.newGatewaySession).toHaveBeenCalledWith('hermes');
    expect(gw.sessions.find((s) => s.id === 'gw-new-1')?.agentId).toBe('hermes');
    expect(projects.getState().projects[0].sessionIds).toEqual(['s-izzi', 'gw-new-1']);
  });

  it('reuses the latest project session of the chosen agent, skipping newer ones of other agents', async () => {
    const gw = fakeGateway({
      live: [
        session('s-izzi', 'izzi', '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z'),
        session('s-hermes', 'hermes', '2026-09-01T00:00:00.000Z', '2026-09-09T00:00:00.000Z'),
      ],
      activeSessionId: 's-hermes',
    });
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;
    projects.getState().assignSession(a, 's-izzi');
    projects.getState().assignSession(a, 's-hermes');

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({
      text: 'cho izzi',
      projectId: a,
      agentId: 'izzi',
    });

    expect(result).toEqual({ status: 'handed-off', sessionId: 's-izzi' });
    expect(gw.activeSessionId).toBe('s-izzi');
    expect(gw.newGatewaySession).not.toHaveBeenCalled();
  });

  it.each([
    ['archived', (store: ReturnType<typeof projectsWith>, id: string) => store.getState().archiveProject(id, true)],
    [
      'removed',
      (store: ReturnType<typeof projectsWith>, id: string) =>
        store.setState({ projects: store.getState().projects.filter((p) => p.id !== id) }),
    ],
  ])('stops without side effects when the project is %s while hydrate is pending', async (_label, change) => {
    const gw = fakeGateway({ persisted: [session('old', 'izzi', '2026-09-01T00:00:00.000Z')] });
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;
    const hydrate = gw.hydrateFromDisk;
    gw.hydrateFromDisk = vi.fn(async () => {
      change(projects, a);
      await hydrate();
    });

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({
      text: 'giữ nguyên',
      projectId: a,
    });

    expect(result.status).toBe('project-missing');
    expect(gw.newGatewaySession).not.toHaveBeenCalled();
    expect(gw.switchSession).not.toHaveBeenCalled();
    expect(gw.setComposerDraft).not.toHaveBeenCalled();
    expect(projects.getState().projects.flatMap((p) => p.sessionIds)).toEqual([]);
  });

  it('handles a double submit once', async () => {
    const gw = fakeGateway();
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;
    const handOff = createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() });

    const [first, second] = await Promise.all([handOff({ text: 'x', projectId: a }), handOff({ text: 'x', projectId: a })]);

    expect([first.status, second.status].sort()).toEqual(['handed-off', 'in-flight']);
    expect(gw.newGatewaySession).toHaveBeenCalledTimes(1);
    expect(gw.setComposerDraft).toHaveBeenCalledTimes(1);
    expect(projects.getState().projects[0].sessionIds).toEqual(['gw-new-1']);
  });

  it('makes the target session owner the active project, and clears it for a loose session', async () => {
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;
    const b = projects.getState().createProject('B')!;
    projects.getState().assignSession(a, 's-a');
    projects.getState().selectProject(b);
    const bound = fakeGateway({ live: [session('s-a', 'izzi', '2026-09-01T00:00:00.000Z')], activeSessionId: 's-a' });

    await createComposerHandoff({ gateway: () => bound, projects: () => projects.getState() })({ text: 'x', projectId: a });
    expect(projects.getState().activeProjectId).toBe(a);

    const loose = fakeGateway({ live: [session('s-free', 'izzi', '2026-09-01T00:00:00.000Z')], activeSessionId: 's-free' });
    const result = await createComposerHandoff({ gateway: () => loose, projects: () => projects.getState() })({ text: 'y' });

    expect(result).toEqual({ status: 'handed-off', sessionId: 's-free' });
    expect(projects.getState().activeProjectId).toBeNull();
  });

  it('keeps one pending handoff across remounts, and a cancelled one never mutates state', async () => {
    const gw = fakeGateway({ live: [session('s1', 'izzi', '2026-09-01T00:00:00.000Z')], activeSessionId: 's1' });
    let release: () => void = () => undefined;
    gw.hydrateFromDisk = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        }),
    );
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;
    const deps = { gateway: () => gw, projects: () => projects.getState() };

    const stale = createComposerHandoff(deps)({ text: 'cũ', projectId: a });
    // A remounted Home creates a new handoff function; the pending one still blocks it.
    expect((await createComposerHandoff(deps)({ text: 'mới', projectId: a })).status).toBe('in-flight');

    cancelPendingHandoff();
    release();

    expect((await stale).status).toBe('cancelled');
    expect(gw.newGatewaySession).not.toHaveBeenCalled();
    expect(gw.switchSession).not.toHaveBeenCalled();
    expect(gw.setComposerDraft).not.toHaveBeenCalled();
    expect(gw.activeSessionId).toBe('s1');
    expect(projects.getState().projects[0].sessionIds).toEqual([]);
  });

  it('applies only the new intent after an agent/project change supersedes a pending handoff', async () => {
    const gw = fakeGateway({ live: [session('s1', 'izzi', '2026-09-01T00:00:00.000Z')], activeSessionId: 's1' });
    let release: () => void = () => undefined;
    gw.hydrateFromDisk = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve();
        }),
    );
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;
    const b = projects.getState().createProject('B')!;
    const deps = { gateway: () => gw, projects: () => projects.getState() };

    const stale = createComposerHandoff(deps)({ text: 'cũ', projectId: a, agentId: 'izzi' });
    // HomeSurface changeAgent/changeProject supersede the pending run before the new submit.
    cancelPendingHandoff();
    gw.hydrateFromDisk = vi.fn(async () => undefined);
    const fresh = await createComposerHandoff(deps)({ text: 'mới', projectId: b, agentId: 'hermes' });
    release();

    expect((await stale).status).toBe('cancelled');
    expect(fresh.status).toBe('handed-off');
    const freshId = fresh.status === 'handed-off' ? fresh.sessionId : '';
    expect(gw.newGatewaySession).toHaveBeenCalledTimes(1);
    expect(gw.newGatewaySession).toHaveBeenCalledWith('hermes');
    expect(gw.setComposerDraft).toHaveBeenCalledTimes(1);
    expect(gw.setComposerDraft).toHaveBeenCalledWith('mới');
    expect(gw.activeSessionId).toBe(freshId);
    expect(projects.getState().projects.find((project) => project.id === a)?.sessionIds).toEqual([]);
    expect(projects.getState().projects.find((project) => project.id === b)?.sessionIds).toEqual([freshId]);
    expect(projects.getState().activeProjectId).toBe(b);
  });

  it('refuses a full project before creating a session, keeping the draft', async () => {
    const gw = fakeGateway();
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;
    for (let i = 0; i < SESSION_IDS_MAX; i += 1) projects.getState().assignSession(a, `old-${i}`);

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({
      text: 'thêm',
      projectId: a,
    });

    expect(result.status).toBe('project-full');
    expect(gw.newGatewaySession).not.toHaveBeenCalled();
    expect(gw.setComposerDraft).not.toHaveBeenCalled();
    expect(projects.getState().projects[0].sessionIds).toHaveLength(SESSION_IDS_MAX);
  });
});

describe('composer hand-off model choice', () => {
  const modelOf = (gw: HandoffGateway, id: string) => {
    const target = gw.sessions.find((s) => s.id === id);
    return target ? { model: target.model, provider: target.provider } : null;
  };

  it('leaves session models alone when no model was picked on Home', async () => {
    const gw = fakeGateway({ live: [session('s-free', 'izzi', '2026-09-01T00:00:00.000Z')], activeSessionId: 's-free' });
    const projects = projectsWith();

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({ text: 'x' });

    expect(result).toEqual({ status: 'handed-off', sessionId: 's-free' });
    expect(gw.applySessionModel).not.toHaveBeenCalled();
    expect(modelOf(gw, 's-free')).toEqual({ model: 'izzi-smart', provider: 'izzi' });
  });

  it('applies the picked model to the newly created session before moving the draft', async () => {
    const gw = fakeGateway();
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({
      text: 'với model tuỳ chỉnh',
      projectId: a,
      model: 'gpt-5.6-terra',
      provider: 'custom',
    });

    expect(result).toEqual({ status: 'handed-off', sessionId: 'gw-new-1' });
    expect(gw.applySessionModel).toHaveBeenCalledTimes(1);
    expect(gw.applySessionModel).toHaveBeenCalledWith('gw-new-1', 'gpt-5.6-terra', 'custom');
    expect(modelOf(gw, 'gw-new-1')).toEqual({ model: 'gpt-5.6-terra', provider: 'custom' });
    expect(gw.composerDraft).toBe('với model tuỳ chỉnh');
    expect(projects.getState().projects[0].sessionIds).toEqual(['gw-new-1']);
  });

  it('applies the picked model to the reused project session, not to the previously active one', async () => {
    const gw = fakeGateway({
      live: [
        session('s-a2', 'izzi', '2026-09-01T00:00:00.000Z', '2026-09-05T00:00:00.000Z'),
        session('s-other', 'izzi', '2026-09-06T00:00:00.000Z'),
      ],
      activeSessionId: 's-other',
    });
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;
    projects.getState().assignSession(a, 's-a2');

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({
      text: 'tiếp tục',
      projectId: a,
      model: 'izzi-fast',
      provider: 'izzi',
    });

    expect(result).toEqual({ status: 'handed-off', sessionId: 's-a2' });
    expect(gw.applySessionModel).toHaveBeenCalledWith('s-a2', 'izzi-fast', 'izzi');
    expect(modelOf(gw, 's-a2')).toEqual({ model: 'izzi-fast', provider: 'izzi' });
    expect(modelOf(gw, 's-other')).toEqual({ model: 'izzi-smart', provider: 'izzi' });
    expect(gw.newGatewaySession).not.toHaveBeenCalled();
  });

  it('keeps the Home draft and reports the probe notice when the model cannot be applied', async () => {
    const message = 'Kết nối model thất bại: 401 Unauthorized. Kết nối chưa được bật.';
    const gw = fakeGateway({
      live: [session('s-free', 'izzi', '2026-09-01T00:00:00.000Z')],
      activeSessionId: 's-free',
      applyModel: async () => ({ ok: false, message }),
    });
    const projects = projectsWith();
    const b = projects.getState().createProject('B')!;
    projects.getState().selectProject(b);

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({
      text: 'giữ lại',
      model: 'gpt-5.6-terra',
      provider: 'custom',
    });

    expect(result).toEqual({ status: 'model-failed', message });
    expect(gw.setComposerDraft).not.toHaveBeenCalled();
    expect(gw.composerDraft).toBe('');
    expect(modelOf(gw, 's-free')).toEqual({ model: 'izzi-smart', provider: 'izzi' });
    // focusSession never ran: the active project is untouched.
    expect(projects.getState().activeProjectId).toBe(b);
  });

  it('treats an apply that reports ok without updating the session as a failure', async () => {
    const gw = fakeGateway({
      live: [session('s-free', 'izzi', '2026-09-01T00:00:00.000Z')],
      activeSessionId: 's-free',
      applyModel: async () => ({ ok: true }),
    });
    const projects = projectsWith();

    const result = await createComposerHandoff({ gateway: () => gw, projects: () => projects.getState() })({
      text: 'x',
      model: 'izzi-fast',
      provider: 'izzi',
    });

    expect(result).toEqual({ status: 'model-failed' });
    expect(gw.setComposerDraft).not.toHaveBeenCalled();
  });

  it('never moves the draft when the handoff is cancelled while the model is being applied', async () => {
    let release: () => void = () => undefined;
    const gw = fakeGateway({
      live: [session('s-free', 'izzi', '2026-09-01T00:00:00.000Z')],
      activeSessionId: 's-free',
      applyModel: (sessionId, model, provider) =>
        new Promise((resolve) => {
          release = () => {
            gw.sessions = gw.sessions.map((s) => (s.id === sessionId ? { ...s, model, provider } : s));
            resolve({ ok: true });
          };
        }),
    });
    const projects = projectsWith();
    const deps = { gateway: () => gw, projects: () => projects.getState() };

    const stale = createComposerHandoff(deps)({ text: 'cũ', model: 'gpt-5.6-terra', provider: 'custom' });
    await vi.waitFor(() => expect(gw.applySessionModel).toHaveBeenCalledTimes(1));
    // The user picked another model (or edited the draft) while the probe was pending.
    cancelPendingHandoff();
    release();

    expect((await stale).status).toBe('cancelled');
    expect(gw.setComposerDraft).not.toHaveBeenCalled();
    expect(gw.composerDraft).toBe('');
    expect(projects.getState().activeProjectId).toBeNull();
  });
});

describe('project workspace new session (M3-B1)', () => {
  const idsOf = (projects: ReturnType<typeof projectsWith>, id: string) =>
    projects.getState().projects.find((project) => project.id === id)?.sessionIds;

  it('creates a session for the chosen agent and binds it to this project only', () => {
    const gw = fakeGateway({ live: [session('s-b', 'izzi', '2026-09-01T00:00:00.000Z')], activeSessionId: 's-b' });
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;
    const b = projects.getState().createProject('B')!;
    projects.getState().assignSession(b, 's-b');

    const result = createProjectSession({ gateway: () => gw, projects: () => projects.getState() }, a, 'hermes');

    expect(result).toEqual({ status: 'created', sessionId: 'gw-new-1' });
    expect(gw.newGatewaySession).toHaveBeenCalledWith('hermes');
    expect(gw.activeSessionId).toBe('gw-new-1');
    expect(idsOf(projects, a)).toEqual(['gw-new-1']);
    expect(idsOf(projects, b)).toEqual(['s-b']);
    expect(projects.getState().activeProjectId).toBe(a);
  });

  it('creates nothing while sending, for an archived project or a full one', () => {
    const busy = fakeGateway({ isSending: true });
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;
    const archived = projects.getState().createProject('Archived')!;
    projects.getState().archiveProject(archived, true);
    const deps = (gw: HandoffGateway) => ({ gateway: () => gw, projects: () => projects.getState() });

    expect(createProjectSession(deps(busy), a, 'izzi').status).toBe('busy');
    const idle = fakeGateway();
    expect(createProjectSession(deps(idle), archived, 'izzi').status).toBe('project-missing');
    expect(createProjectSession(deps(idle), 'missing', 'izzi').status).toBe('project-missing');
    for (let i = 0; i < SESSION_IDS_MAX; i += 1) projects.getState().assignSession(a, `old-${i}`);
    expect(createProjectSession(deps(idle), a, 'izzi').status).toBe('project-full');

    expect(busy.newGatewaySession).not.toHaveBeenCalled();
    expect(idle.newGatewaySession).not.toHaveBeenCalled();
  });

  it('reports no-session and assigns nothing when the gateway has no agent', () => {
    const gw = fakeGateway({ agents: [] });
    const projects = projectsWith();
    const a = projects.getState().createProject('A')!;

    const result = createProjectSession({ gateway: () => gw, projects: () => projects.getState() }, a, 'izzi');

    expect(result.status).toBe('no-session');
    expect(idsOf(projects, a)).toEqual([]);
  });
});
