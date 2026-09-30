import { describe, expect, it } from 'vitest';
import type { AgentChatSession } from '../types/agent-registry';
import {
  PROJECT_WORKSPACE_STORAGE_KEY,
  PROJECT_WORKSPACE_VERSION,
  SESSION_IDS_MAX,
  createProjectWorkspaceStore,
  deriveRecentSessions,
  deriveUnassignedSessions,
  filterProjects,
  loadProjectWorkspace,
  parseProjectWorkspace,
  projectForSession,
  projectWorkspaceReducer,
  projectWorkspaceStorageKey,
  saveProjectWorkspace,
  serializeProjectWorkspace,
  type ProjectWorkspaceState,
} from './projectWorkspace';

const EMPTY: ProjectWorkspaceState = { projects: [], activeProjectId: null };
const NOW = '2026-09-27T10:00:00.000Z';
const LATER = '2026-09-27T11:00:00.000Z';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

function session(id: string, createdAt: string, messageTimes: string[] = []): AgentChatSession {
  return {
    id,
    agentId: 'izzi',
    agentName: 'Izzi',
    agentIcon: '🤖',
    model: 'izzi-smart',
    provider: 'izzi',
    createdAt,
    isActive: true,
    messages: messageTimes.map((time, index) => ({
      id: `${id}-m${index}`,
      role: 'user',
      content: 'hello',
      createdAt: time,
    })) as AgentChatSession['messages'],
  };
}

function create(state: ProjectWorkspaceState, name: string, id = 'p1', now = NOW) {
  return projectWorkspaceReducer(state, { type: 'create', id, name, now });
}

describe('projectWorkspaceReducer', () => {
  it('creates a project with trimmed metadata and selects it', () => {
    const state = create(EMPTY, '  Chiến dịch Tết  ');

    expect(state.projects).toEqual([
      {
        id: 'p1',
        name: 'Chiến dịch Tết',
        description: '',
        createdAt: NOW,
        updatedAt: NOW,
        pinned: false,
        archived: false,
        activeSurface: 'overview',
        sessionIds: [],
      },
    ]);
    expect(state.activeProjectId).toBe('p1');
  });

  it('ignores a create with a blank name', () => {
    expect(create(EMPTY, '   ')).toBe(EMPTY);
  });

  it('never mutates the previous state', () => {
    const first = create(EMPTY, 'A');
    const snapshot = JSON.stringify(first);
    projectWorkspaceReducer(first, { type: 'togglePin', id: 'p1', now: LATER });
    projectWorkspaceReducer(first, { type: 'archive', id: 'p1', archived: true, now: LATER });

    expect(JSON.stringify(first)).toBe(snapshot);
  });

  it('selects only existing, unarchived projects, and clears with null', () => {
    const state = create(create(EMPTY, 'A'), 'B', 'p2');

    expect(projectWorkspaceReducer(state, { type: 'select', id: 'p1' }).activeProjectId).toBe('p1');
    expect(projectWorkspaceReducer(state, { type: 'select', id: 'missing' }).activeProjectId).toBe('p2');
    expect(projectWorkspaceReducer(state, { type: 'select', id: null }).activeProjectId).toBeNull();
  });

  it('pins and unpins, bumping updatedAt', () => {
    const pinned = projectWorkspaceReducer(create(EMPTY, 'A'), { type: 'togglePin', id: 'p1', now: LATER });

    expect(pinned.projects[0]).toMatchObject({ pinned: true, updatedAt: LATER });
    expect(projectWorkspaceReducer(pinned, { type: 'togglePin', id: 'p1', now: LATER }).projects[0].pinned).toBe(false);
  });

  it('archiving the active project deselects it; restoring keeps it deselected', () => {
    const archived = projectWorkspaceReducer(create(EMPTY, 'A'), { type: 'archive', id: 'p1', archived: true, now: LATER });

    expect(archived.projects[0].archived).toBe(true);
    expect(archived.activeProjectId).toBeNull();
    expect(projectWorkspaceReducer(archived, { type: 'select', id: 'p1' }).activeProjectId).toBeNull();

    const restored = projectWorkspaceReducer(archived, { type: 'archive', id: 'p1', archived: false, now: LATER });
    expect(restored.projects[0].archived).toBe(false);
    expect(restored.activeProjectId).toBeNull();
  });

  it('assigns a session only through the explicit action, once, to one project', () => {
    let state = create(create(EMPTY, 'A'), 'B', 'p2');
    state = projectWorkspaceReducer(state, { type: 'assignSession', id: 'p1', sessionId: 's1', now: LATER });
    state = projectWorkspaceReducer(state, { type: 'assignSession', id: 'p1', sessionId: 's1', now: LATER });

    expect(state.projects[0].sessionIds).toEqual(['s1']);

    state = projectWorkspaceReducer(state, { type: 'assignSession', id: 'p2', sessionId: 's1', now: LATER });
    expect(state.projects[0].sessionIds).toEqual([]);
    expect(state.projects[1].sessionIds).toEqual(['s1']);

    state = projectWorkspaceReducer(state, { type: 'unassignSession', sessionId: 's1', now: LATER });
    expect(state.projects[1].sessionIds).toEqual([]);
  });

  it('records the active surface per project', () => {
    const state = projectWorkspaceReducer(create(EMPTY, 'A'), { type: 'setSurface', id: 'p1', surface: 'chat', now: LATER });

    expect(state.projects[0].activeSurface).toBe('chat');
  });
});

describe('filterProjects', () => {
  const state = [
    ['p1', 'Tết', false],
    ['p2', 'SEO blog', true],
    ['p3', 'Đối thủ', false],
  ].reduce<ProjectWorkspaceState>((acc, [id, name, pin]) => {
    const next = create(acc, name as string, id as string);
    return pin ? projectWorkspaceReducer(next, { type: 'togglePin', id: id as string, now: LATER }) : next;
  }, EMPTY);
  const withArchive = projectWorkspaceReducer(state, { type: 'archive', id: 'p3', archived: true, now: LATER });

  it('lists active projects with pinned first', () => {
    expect(filterProjects(withArchive.projects, 'active', '').map((p) => p.id)).toEqual(['p2', 'p1']);
  });

  it('lists pinned and archived views', () => {
    expect(filterProjects(withArchive.projects, 'pinned', '').map((p) => p.id)).toEqual(['p2']);
    expect(filterProjects(withArchive.projects, 'archived', '').map((p) => p.id)).toEqual(['p3']);
  });

  it('matches the query case-insensitively on name and description', () => {
    expect(filterProjects(withArchive.projects, 'active', 'seo').map((p) => p.id)).toEqual(['p2']);
  });
});

describe('persistence', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage();
    const state = projectWorkspaceReducer(create(EMPTY, 'A'), { type: 'assignSession', id: 'p1', sessionId: 's1', now: LATER });

    saveProjectWorkspace(state, storage);

    expect(JSON.parse(storage.data.get(PROJECT_WORKSPACE_STORAGE_KEY) ?? '{}').version).toBe(PROJECT_WORKSPACE_VERSION);
    expect(loadProjectWorkspace(storage)).toEqual(state);
  });

  it.each([
    ['not JSON', '{oops'],
    ['wrong version', JSON.stringify({ version: 99, projects: [], activeProjectId: null })],
    ['array payload', '[]'],
    ['null', 'null'],
  ])('falls back to empty on %s', (_label, raw) => {
    expect(loadProjectWorkspace(memoryStorage({ [PROJECT_WORKSPACE_STORAGE_KEY]: raw }))).toEqual(EMPTY);
  });

  it('drops corrupt projects and unknown fields, keeping valid ones', () => {
    const raw = JSON.stringify({
      version: PROJECT_WORKSPACE_VERSION,
      activeProjectId: 'ghost',
      projects: [
        { id: 'ok', name: 'OK', description: 's', createdAt: NOW, updatedAt: NOW, pinned: true, archived: false, activeSurface: 'chat', sessionIds: ['s1', 7, 's1'], apiKey: 'sk-live-123', token: 'jwt' },
        { id: '', name: 'no id', createdAt: NOW, updatedAt: NOW },
        { id: 'bad-date', name: 'x', createdAt: 'yesterday', updatedAt: NOW },
        { id: 'ok', name: 'duplicate id', createdAt: NOW, updatedAt: NOW },
        'string',
      ],
    });

    const state = parseProjectWorkspace(raw);

    expect(state.projects.map((p) => p.id)).toEqual(['ok']);
    expect(state.projects[0].sessionIds).toEqual(['s1']);
    expect(Object.keys(state.projects[0]).sort()).toEqual(
      ['activeSurface', 'archived', 'createdAt', 'id', 'name', 'pinned', 'sessionIds', 'description', 'updatedAt'].sort(),
    );
    expect(state.activeProjectId).toBeNull();
  });

  it('keeps a session claimed by two stored projects only in the first one', () => {
    const project = (id: string, sessionIds: string[]) => ({ id, name: id, createdAt: NOW, updatedAt: NOW, sessionIds });
    const raw = JSON.stringify({
      version: PROJECT_WORKSPACE_VERSION,
      activeProjectId: null,
      projects: [project('a', ['s1', 's2']), project('b', ['s2', 's3']), project('c', ['s1'])],
    });

    const state = parseProjectWorkspace(raw);

    expect(state.projects.map((p) => [p.id, p.sessionIds])).toEqual([
      ['a', ['s1', 's2']],
      ['b', ['s3']],
      ['c', []],
    ]);
    expect(JSON.parse(serializeProjectWorkspace(state)).projects.flatMap((p: { sessionIds: string[] }) => p.sessionIds)).toEqual([
      's1',
      's2',
      's3',
    ]);
  });

  it('defaults an unknown surface and clamps long text', () => {
    const raw = JSON.stringify({
      version: PROJECT_WORKSPACE_VERSION,
      activeProjectId: 'p',
      projects: [{ id: 'p', name: 'n'.repeat(500), description: 's'.repeat(5000), createdAt: NOW, updatedAt: NOW, activeSurface: 'hack' }],
    });

    const project = parseProjectWorkspace(raw).projects[0];
    expect(project.activeSurface).toBe('overview');
    expect(project.name.length).toBeLessThanOrEqual(80);
    expect(project.description.length).toBeLessThanOrEqual(500);
  });

  it('serializes only whitelisted metadata', () => {
    const state = create(EMPTY, 'A');
    const leaky = { ...state, projects: [{ ...state.projects[0], apiKey: 'sk-live-123', jwt: 'eyJ.x.y' }] } as unknown as ProjectWorkspaceState;

    const raw = serializeProjectWorkspace(leaky);
    expect(raw).not.toContain('sk-live-123');
    expect(raw).not.toContain('eyJ');
  });

  it('survives storage that throws on read and write', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };

    expect(loadProjectWorkspace(broken)).toEqual(EMPTY);
    expect(() => saveProjectWorkspace(create(EMPTY, 'A'), broken)).not.toThrow();
  });

  it('works with no storage at all', () => {
    expect(loadProjectWorkspace(null)).toEqual(EMPTY);
  });
});

describe('derived conversations', () => {
  const sessions = [
    session('old', '2026-09-01T00:00:00.000Z'),
    session('talked', '2026-09-02T00:00:00.000Z', ['2026-09-27T09:00:00.000Z']),
    session('new', '2026-09-20T00:00:00.000Z'),
  ];

  it('orders recent sessions by their last activity', () => {
    expect(deriveRecentSessions(sessions, 10).map((s) => s.id)).toEqual(['talked', 'new', 'old']);
    expect(deriveRecentSessions(sessions, 2)).toHaveLength(2);
  });

  it('lists sessions that no project claims', () => {
    const state = projectWorkspaceReducer(create(EMPTY, 'A'), { type: 'assignSession', id: 'p1', sessionId: 'new', now: LATER });

    expect(deriveUnassignedSessions(sessions, state.projects).map((s) => s.id)).toEqual(['talked', 'old']);
  });

  it('does not mutate the gateway session list', () => {
    const copy = sessions.map((s) => s.id);
    deriveRecentSessions(sessions, 10);

    expect(sessions.map((s) => s.id)).toEqual(copy);
  });
});

describe('session ownership', () => {
  const assigned = projectWorkspaceReducer(create(EMPTY, 'A'), { type: 'assignSession', id: 'p1', sessionId: 's1', now: LATER });

  it('returns the open owner of a session, or null', () => {
    expect(projectForSession(assigned.projects, 's1')).toBe('p1');
    expect(projectForSession(assigned.projects, 'loose')).toBeNull();

    const archived = projectWorkspaceReducer(assigned, { type: 'archive', id: 'p1', archived: true, now: LATER });
    expect(projectForSession(archived.projects, 's1')).toBeNull();
  });

  it('refuses a 501st session at assign time, matching the reload cap', () => {
    const ids = Array.from({ length: SESSION_IDS_MAX }, (_, index) => `s${index}`);
    const full = { ...EMPTY, projects: [{ ...create(EMPTY, 'A').projects[0], sessionIds: ids }] };

    const next = projectWorkspaceReducer(full, { type: 'assignSession', id: 'p1', sessionId: 'extra', now: LATER });

    expect(next).toBe(full);
    expect(parseProjectWorkspace(serializeProjectWorkspace(full)).projects[0].sessionIds).toEqual(ids);
  });
});

describe('createProjectWorkspaceStore', () => {
  it('persists every change and reloads it for the same account', () => {
    const storage = memoryStorage();
    let tick = 0;
    const store = createProjectWorkspaceStore({ storage, userId: 'user-a', now: () => NOW, newId: () => `id-${++tick}` });

    store.getState().createProject('Launch');
    store.getState().togglePin('id-1');

    const reloaded = createProjectWorkspaceStore({ storage, userId: 'user-a', now: () => NOW, newId: () => 'x' });
    expect(reloaded.getState().projects[0]).toMatchObject({ id: 'id-1', name: 'Launch', pinned: true });
    expect(reloaded.getState().activeProjectId).toBe('id-1');
    expect(storage.data.has(projectWorkspaceStorageKey('user-a'))).toBe(true);
    expect(storage.data.has(PROJECT_WORKSPACE_STORAGE_KEY)).toBe(false);
  });

  it('keeps projects per account and rehydrates on an identity switch', () => {
    const storage = memoryStorage();
    const store = createProjectWorkspaceStore({ storage, userId: 'user-a', now: () => NOW, newId: () => 'pa' });
    store.getState().createProject('Của A');

    store.getState().setIdentity('user-b');
    expect(store.getState().projects).toEqual([]);
    expect(store.getState().activeProjectId).toBeNull();

    store.getState().setIdentity('user-a');
    expect(store.getState().projects.map((project) => project.name)).toEqual(['Của A']);
  });

  it('clears metadata from memory on logout and stops writing', () => {
    const storage = memoryStorage();
    const store = createProjectWorkspaceStore({ storage, userId: 'user-a', now: () => NOW, newId: () => 'pa' });
    store.getState().createProject('Của A');
    const saved = storage.data.get(projectWorkspaceStorageKey('user-a'));

    store.getState().setIdentity(null);
    store.getState().createProject('Không chủ');

    expect(store.getState().projects.map((project) => project.name)).toEqual(['Không chủ']);
    expect(storage.data.get(projectWorkspaceStorageKey('user-a'))).toBe(saved);
    expect([...storage.data.keys()]).toEqual([projectWorkspaceStorageKey('user-a')]);
  });

  it('never adopts legacy metadata that has no known owner', () => {
    const legacy = serializeProjectWorkspace(create(EMPTY, 'Legacy'));
    const storage = memoryStorage({ [PROJECT_WORKSPACE_STORAGE_KEY]: legacy });

    const store = createProjectWorkspaceStore({ storage, userId: 'new-user', now: () => NOW });
    expect(store.getState().projects).toEqual([]);

    const anonymous = createProjectWorkspaceStore({ storage, now: () => NOW });
    expect(anonymous.getState().projects).toEqual([]);
    expect(storage.data.get(PROJECT_WORKSPACE_STORAGE_KEY)).toBe(legacy);
  });

  it('focusSession selects the owner and clears the context for an unassigned session', () => {
    let tick = 0;
    const store = createProjectWorkspaceStore({ storage: memoryStorage(), userId: 'u', now: () => NOW, newId: () => `p${++tick}` });
    store.getState().createProject('A');
    store.getState().createProject('B');
    expect(store.getState().assignSession('p1', 's1')).toBe(true);
    expect(store.getState().activeProjectId).toBe('p2');

    store.getState().focusSession('s1');
    expect(store.getState().activeProjectId).toBe('p1');

    store.getState().focusSession('loose');
    expect(store.getState().activeProjectId).toBeNull();
  });

  it('reports a refused assignment when the project is full or missing', () => {
    const ids = Array.from({ length: SESSION_IDS_MAX }, (_, index) => `s${index}`);
    const full = { projects: [{ ...create(EMPTY, 'A').projects[0], sessionIds: ids }], activeProjectId: 'p1' };
    const storage = memoryStorage({ [projectWorkspaceStorageKey('u')]: serializeProjectWorkspace(full) });
    const store = createProjectWorkspaceStore({ storage, userId: 'u', now: () => NOW });

    expect(store.getState().assignSession('p1', 'extra')).toBe(false);
    expect(store.getState().assignSession('missing', 'extra')).toBe(false);
    expect(store.getState().assignSession('p1', 's0')).toBe(true);
    expect(projectForSession(store.getState().projects, 'extra')).toBeNull();
  });

  it('returns the new project id, or null for a blank name', () => {
    const store = createProjectWorkspaceStore({ storage: memoryStorage(), now: () => NOW, newId: () => 'fixed' });

    expect(store.getState().createProject('  ')).toBeNull();
    expect(store.getState().createProject('Real')).toBe('fixed');
  });
});
