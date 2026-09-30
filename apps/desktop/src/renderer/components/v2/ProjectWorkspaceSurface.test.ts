import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAgentGatewayStore } from '../../store/agentGateway';
import {
  createProjectWorkspaceStore,
  useProjectWorkspaceStore,
  type ProjectMeta,
  type ProjectWorkspaceStorage,
} from '../../store/projectWorkspace';
import type { AgentChatSession } from '../../types/agent-registry';
import { ProjectHeader } from './ProjectHeader';
import { ProjectWorkspaceSurface } from './ProjectWorkspaceSurface';

// zustand's SSR snapshot is getInitialState(); these hooks read live state.
vi.mock('../../store/projectWorkspace', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/projectWorkspace')>();
  const store = actual.useProjectWorkspaceStore;
  type State = ReturnType<typeof store.getState>;
  return { ...actual, useProjectWorkspaceStore: Object.assign(<T>(select: (state: State) => T) => select(store.getState()), store) };
});
vi.mock('../../store/agentGateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../store/agentGateway')>();
  const store = actual.useAgentGatewayStore;
  type State = ReturnType<typeof store.getState>;
  return { ...actual, useAgentGatewayStore: Object.assign(<T>(select: (state: State) => T) => select(store.getState()), store) };
});

const noop = () => undefined;

function project(id: string, name: string, overrides: Partial<ProjectMeta> = {}): ProjectMeta {
  return {
    id,
    name,
    description: '',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    pinned: false,
    archived: false,
    activeSurface: 'overview',
    sessionIds: [],
    ...overrides,
  };
}

/** A real gateway turn: the user prompt, then the agent reply with its steps. */
function session(id: string, prompt: string, reply: string, stepStatus: 'done' | 'error' = 'done'): AgentChatSession {
  return {
    id,
    agentId: 'izzi',
    agentName: 'Izzi',
    agentIcon: '🤖',
    model: 'izzi-smart',
    provider: 'izzi',
    createdAt: '2026-09-02T00:00:00.000Z',
    isActive: true,
    messages: [
      { id: `${id}-m0`, sessionId: id, agentId: 'izzi', role: 'user', content: prompt, state: 'done', createdAt: '2026-09-02T00:01:00.000Z' },
      {
        id: `${id}-m1`,
        sessionId: id,
        agentId: 'izzi',
        role: 'assistant',
        content: reply,
        state: 'done',
        createdAt: '2026-09-02T00:02:00.000Z',
        steps: [{ id: `${id}-step`, kind: 'tool', label: `buoc-${id}`, status: stepStatus }],
      },
    ] as AgentChatSession['messages'],
  };
}

function seed(projects: ProjectMeta[], sessions: AgentChatSession[], activeProjectId: string | null = null) {
  useProjectWorkspaceStore.setState({ projects, activeProjectId });
  useAgentGatewayStore.setState({ sessions });
}

function render(): string {
  return renderToStaticMarkup(createElement(ProjectWorkspaceSurface, { onSelectSurface: noop }));
}

const A_SESSION = session('s-a', 'prompt-cua-A', 'tra-loi-cua-A', 'error');
const B_SESSION = session('s-b', 'prompt-cua-B', 'tra-loi-cua-B');
const GLOBAL_SESSION = session('s-global', 'prompt-chua-gan', 'tra-loi-chua-gan');

function seedAB(activeSurfaceA: ProjectMeta['activeSurface'], activeProjectId = 'a') {
  seed(
    [
      project('a', 'Dự án A', { activeSurface: activeSurfaceA, sessionIds: ['s-a'] }),
      project('b', 'Dự án B', { activeSurface: 'activity', sessionIds: ['s-b'] }),
    ],
    [A_SESSION, B_SESSION, GLOBAL_SESSION],
    activeProjectId,
  );
}

function expectOnlyA(html: string) {
  expect(html).not.toContain('cua-B');
  expect(html).not.toContain('buoc-s-b');
  expect(html).not.toContain('chua-gan');
}

afterEach(() => {
  seed([], []);
});

describe('ProjectWorkspaceSurface (M3-B1)', () => {
  it('shows an empty state when no project is selected', () => {
    seed([project('a', 'Dự án A')], []);
    const html = render();
    expect(html).toContain('Chưa chọn dự án nào.');
    expect(html).not.toContain('role="tablist"');
  });

  it('renders seven tabs with a single selected, focusable tab bound to the panel', () => {
    seedAB('runs');
    const html = render();
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(7);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html.match(/tabindex="0"/g)).toHaveLength(2); // selected tab + tabpanel
    expect(html).toMatch(/id="v2-project-tab-runs"[^>]*aria-selected="true"[^>]*tabindex="0"/);
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('aria-labelledby="v2-project-tab-runs"');
  });

  it('remembers the tab of each project separately', () => {
    seedAB('runs');
    expect(render()).toMatch(/id="v2-project-tab-runs"[^>]*aria-selected="true"/);

    useProjectWorkspaceStore.getState().selectProject('b');
    expect(render()).toMatch(/id="v2-project-tab-activity"[^>]*aria-selected="true"/);

    useProjectWorkspaceStore.getState().setSurface('a', 'chat');
    const projects = useProjectWorkspaceStore.getState().projects;
    expect(projects.find((item) => item.id === 'a')?.activeSurface).toBe('chat');
    expect(projects.find((item) => item.id === 'b')?.activeSurface).toBe('activity');

    useProjectWorkspaceStore.getState().selectProject('a');
    expect(render()).toMatch(/id="v2-project-tab-chat"[^>]*aria-selected="true"/);
  });

  it('builds Overview only from sessions assigned to the active project', () => {
    seedAB('overview');
    const html = render();
    expect(html).toContain('1 phiên');
    expect(html).toContain('1 mục cần xử lý');
    expect(html).toContain('prompt-cua-A');
    expectOnlyA(html);
  });

  it('lists Runs as agent turns with real steps in user wording', () => {
    seedAB('runs');
    const html = render();
    expect(html).toContain('Lượt agent · Izzi');
    expect(html).toContain('Chưa có lịch sử chạy lưu lâu dài.');
    expect(html).not.toContain('AgentRun');
    expect(html).toContain('buoc-s-a · error');
    expect(html).toContain('prompt-cua-A');
    expectOnlyA(html);
  });

  it('builds Activity only from the active project messages and steps', () => {
    seedAB('activity');
    const html = render();
    expect(html).toContain('tra-loi-cua-A');
    expectOnlyA(html);
  });

  it('shows the other project data after switching, never both', () => {
    seedAB('runs', 'b');
    useProjectWorkspaceStore.getState().setSurface('b', 'runs');
    const html = render();
    expect(html).toContain('buoc-s-b');
    expect(html).not.toContain('cua-A');
    expect(html).not.toContain('chua-gan');
  });

  it('marks Approvals, Files and Tasks as unlinked without any session data', () => {
    for (const surface of ['approvals', 'files', 'tasks'] as const) {
      seedAB(surface);
      const html = render();
      expect(html, surface).toContain('data-link-state="unlinked"');
      expect(html, surface).toContain('chưa được liên kết với dự án.');
      expect(html, surface).not.toContain('cua-A');
      expectOnlyA(html);
    }
  });

  it('closes the workspace when the active project is archived', () => {
    seedAB('runs');
    useProjectWorkspaceStore.getState().archiveProject('a', true);
    expect(useProjectWorkspaceStore.getState().activeProjectId).toBeNull();
    expect(render()).toContain('Chưa chọn dự án nào.');

    useProjectWorkspaceStore.getState().selectProject('a');
    expect(useProjectWorkspaceStore.getState().activeProjectId).toBeNull();
  });

  it('shows an archived project as empty even if it is still marked active', () => {
    seed([project('a', 'Dự án A', { archived: true, sessionIds: ['s-a'] })], [A_SESSION], 'a');
    const html = render();
    expect(html).toContain('Chưa chọn dự án nào.');
    expect(html).not.toContain('cua-A');
  });
});

describe('project workspace identity reset (M3-B1)', () => {
  function memoryStorage(): ProjectWorkspaceStorage {
    const values = new Map<string, string>();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => void values.set(key, value) };
  }

  it('drops the previous account projects and tab memory, and restores them per account', () => {
    let counter = 0;
    const store = createProjectWorkspaceStore({ storage: memoryStorage(), userId: 'user-a', newId: () => `p-${++counter}` });
    const id = store.getState().createProject('Dự án A');
    expect(id).not.toBeNull();
    store.getState().selectProject(id);
    store.getState().setSurface(id!, 'runs');

    store.getState().setIdentity('user-b');
    expect(store.getState().projects).toEqual([]);
    expect(store.getState().activeProjectId).toBeNull();

    store.getState().setIdentity(null);
    expect(store.getState().projects).toEqual([]);

    store.getState().setIdentity('user-a');
    expect(store.getState().projects.find((item) => item.id === id)?.activeSurface).toBe('runs');
  });
});

describe('ProjectHeader with the project workspace open (M3-B1)', () => {
  it('shows the workspace under Projects in the breadcrumb without a status pill', () => {
    seed([project('a', 'Dự án A')], [], 'a');
    const html = renderToStaticMarkup(
      createElement(ProjectHeader, {
        currentPage: 'chat',
        activeSurface: 'project',
        isNavigatorOpen: true,
        isInspectorOpen: false,
        onToggleNavigator: noop,
        onToggleInspector: noop,
      }),
    );
    expect(html).toContain('<li aria-current="page">Projects</li>');
    expect(html).not.toContain('v2-header__status');
  });
});
