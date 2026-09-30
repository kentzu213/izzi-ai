import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAgentGatewayStore } from '../../store/agentGateway';
import { useProjectWorkspaceStore, type ProjectMeta } from '../../store/projectWorkspace';
import type { AgentChatSession } from '../../types/agent-registry';
import { AppShellV2 } from './AppShellV2';
import { ContextNavigator } from './ContextNavigator';
import { HANDOFF_MESSAGES, HomeSurface } from './HomeSurface';
import { ProjectHeader } from './ProjectHeader';
import { ProjectsSurface } from './ProjectsSurface';

/*
 * M3-A surface rendering. The flag default and its legacy opt-out are covered by
 * uiShellV2.test.ts; here the V2 shell itself must keep legacy children
 * mounted until a surface is explicitly opened.
 */

// zustand's SSR snapshot is getInitialState(), which setState never changes, so
// seed() would be invisible to renderToStaticMarkup. These hooks read live state.
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

function stubViewport() {
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    addEventListener: noop,
    removeEventListener: noop,
  });
}

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

function session(id: string, content: string): AgentChatSession {
  return {
    id,
    agentId: 'izzi',
    agentName: 'Izzi',
    agentIcon: '🤖',
    model: 'izzi-smart',
    provider: 'izzi',
    createdAt: '2026-09-02T00:00:00.000Z',
    isActive: true,
    messages: [{ id: `${id}-m0`, role: 'user', content, createdAt: '2026-09-02T00:01:00.000Z' }] as AgentChatSession['messages'],
  };
}

function seed(projects: ProjectMeta[], sessions: AgentChatSession[], activeProjectId: string | null = null) {
  useProjectWorkspaceStore.setState({ projects, activeProjectId });
  useAgentGatewayStore.setState({ sessions });
}

function renderNavigator(withSurfaces: boolean) {
  return renderToStaticMarkup(
    createElement(ContextNavigator, {
      currentPage: 'chat',
      onNavigate: noop,
      onSelectSurface: withSurfaces ? noop : undefined,
      searchRef: createRef<HTMLInputElement>(),
    }),
  );
}

afterEach(() => {
  seed([], []);
  vi.unstubAllGlobals();
});

describe('AppShellV2 surfaces', () => {
  it('keeps the legacy page mounted while no surface is open', () => {
    stubViewport();
    const html = renderToStaticMarkup(
      createElement(AppShellV2, {
        currentPage: 'chat',
        onNavigate: noop,
        theme: 'dark',
        children: createElement('div', { id: 'legacy-page' }, 'legacy'),
      }),
    );

    expect(html).toContain('id="legacy-page"');
    expect(html).not.toContain('v2-home');
    expect(html).toContain('v2-header__breadcrumb');
    expect(html).not.toContain('v2-header__status');
  });

  it('keeps the breadcrumb and project switcher out of the Home header', () => {
    const html = renderToStaticMarkup(
      createElement(ProjectHeader, {
        currentPage: 'chat',
        activeSurface: 'home',
        isNavigatorOpen: true,
        isInspectorOpen: false,
        onToggleNavigator: noop,
        onToggleInspector: noop,
        onToggleTheme: noop,
      }),
    );

    expect(html).not.toContain('v2-header__breadcrumb');
    expect(html).not.toContain('Chưa chọn dự án');
    expect(html).toContain('aria-label="Giao diện sáng"');
    expect(html).toContain('aria-label="Ẩn danh mục trang"');
  });
});

describe('HomeSurface', () => {
  it('renders the owned draft untouched with no error message', () => {
    const html = renderToStaticMarkup(
      createElement(HomeSurface, {
        draft: 'Giữ nguyên nội dung',
        onDraftChange: noop,
        onNavigate: noop,
        onSelectSurface: noop,
        isNavigatorOpen: true,
        onToggleNavigator: noop,
      }),
    );

    expect(html).toContain('Chào mừng đến với');
    expect(html).toContain('IZZI AI');
    expect(html).toMatch(/<textarea[^>]*id="v2-home-prompt"[^>]*>Giữ nguyên nội dung<\/textarea>/);
    expect(html).toContain('<p class="v2-surface__status" role="status"></p>');
    expect(html).not.toContain('role="alert"');
  });

  it('defaults to the unchanged Chat route and offers Agent Marketing as an explicit choice', () => {
    const html = renderToStaticMarkup(
      createElement(HomeSurface, {
        draft: '',
        onDraftChange: noop,
        onNavigate: noop,
        onSelectSurface: noop,
        isNavigatorOpen: true,
        onToggleNavigator: noop,
      }),
    );

    expect(html).toContain('Chức năng');
    expect(html).toMatch(/<option value="chat" selected="">Chat<\/option>/);
    expect(html).toContain('<option value="marketing">Agent Marketing</option>');
    expect(html).toContain('Agent đang dùng');
    expect(html).toContain('Chưa gán dự án');
    expect(html).toMatch(/<button type="submit"[^>]*aria-label="Mở trong Chat"/);
  });

  it('has a user-facing message for every non-success handoff status', () => {
    const statuses = ['empty', 'project-missing', 'project-full', 'busy', 'draft-occupied', 'no-session', 'error', 'in-flight'] as const;

    for (const status of statuses) {
      expect(HANDOFF_MESSAGES[status].trim().length).toBeGreaterThan(0);
    }
  });
});

describe('ProjectsSurface', () => {
  it('renders the filters and the first-project empty state', () => {
    const html = renderToStaticMarkup(createElement(ProjectsSurface, { onNavigate: noop }));

    for (const label of ['Đang làm', 'Đã ghim', 'Lưu trữ']) expect(html).toContain(label);
    expect(html).toContain('Chưa có dự án nào. Tạo dự án đầu tiên ở trên.');
  });

  it('blocks assigning an unassigned session until a project is selected', () => {
    seed([project('p1', 'Chiến dịch A')], [session('s1', 'xin chào')]);

    const html = renderToStaticMarkup(createElement(ProjectsSurface, { onNavigate: noop }));

    expect(html).toContain('Izzi · xin chào');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Gán vào dự án<\/button>/);
  });
});

describe('ProjectHeader switcher', () => {
  it('lists open projects only without a V2/Legacy status pill', () => {
    seed([project('p1', 'Chiến dịch A'), project('p2', 'Cũ', { archived: true })], []);

    const html = renderToStaticMarkup(
      createElement(ProjectHeader, {
        currentPage: 'chat',
        isNavigatorOpen: true,
        isInspectorOpen: false,
        onToggleNavigator: noop,
        onToggleInspector: noop,
      }),
    );

    expect(html).toContain('Chưa chọn dự án');
    expect(html).toContain('<option value="p1">Chiến dịch A</option>');
    expect(html).not.toContain('value="p2"');
    expect(html).not.toContain('v2-header__status');
  });
});

describe('ContextNavigator workspace groups', () => {
  it('shows projects, the unassigned count and recent sessions when surfaces are wired', () => {
    seed([project('p1', 'Chiến dịch A', { pinned: true })], [session('s1', 'xin   chào\nbạn')]);

    const html = renderNavigator(true);

    expect(html).toContain('Dự án gần đây');
    expect(html).toMatch(/Chiến dịch A<span class="v2-pin" role="img" aria-label="Đã ghim" title="Đã ghim">★<\/span>/);
    expect(html).toMatch(/class="v2-navigator__tile v2-tile--tone-[0-5]"/);
    expect(html).toContain('v2-navigator__entry v2-navigator__entry--recent');
    expect(html).toContain('Phiên chưa gán · 1');
    expect(html).toContain('Xem tất cả dự án');
    expect(html).toContain('Cuộc trò chuyện gần đây');
    expect(html).toContain('Izzi · xin chào bạn');
  });

  it('expands the active project into its conversations, the apps row and inline add actions', () => {
    seed(
      [project('p1', 'Chiến dịch A', { sessionIds: ['s1'] })],
      [session('s1', 'kế hoạch tuần'), session('s2', 'ngoài dự án')],
      'p1',
    );

    const html = renderNavigator(true);

    expect(html).toContain('aria-expanded="true" aria-controls="v2-nav-project-p1"');
    expect(html).toContain('<span class="v2-navigator__child-name">Izzi · kế hoạch tuần</span>');
    expect(html).not.toContain('<span class="v2-navigator__child-name">Izzi · ngoài dự án</span>');
    expect(html).toContain('<span class="v2-navigator__child-name">Ứng dụng</span>');
    expect(html).toContain('+ Hội thoại');
    expect(html).toContain('+ Ứng dụng');
    expect(html).toMatch(/class="v2-navigator__status v2-navigator__status--(running|attention|idle)"/);
  });

  it('keeps a non-active project collapsed', () => {
    seed([project('p1', 'Chiến dịch A', { sessionIds: ['s1'] })], [session('s1', 'kế hoạch tuần')]);

    const html = renderNavigator(true);

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Mở rộng Chiến dịch A"');
    expect(html).not.toContain('v2-navigator__children');
    expect(html).not.toContain('+ Hội thoại');
  });

  it('hides the workspace groups without a surface handler', () => {
    seed([project('p1', 'Chiến dịch A')], [session('s1', 'xin chào')]);

    const html = renderNavigator(false);

    expect(html).not.toContain('Phiên chưa gán');
    expect(html).not.toContain('Cuộc trò chuyện gần đây');
    expect(html).toContain('v2-navigator__item');
  });
});
