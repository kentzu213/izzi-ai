import React, { useMemo, useState } from 'react';
import { useAgentGatewayStore } from '../../store/agentGateway';
import {
  deriveRecentSessions,
  deriveUnassignedSessions,
  filterProjects,
  useProjectWorkspaceStore,
} from '../../store/projectWorkspace';
import type { AgentChatSession } from '../../types/agent-registry';
import { startConversation } from './ConversationSurface';
import { filterNavGroups, type V2PageId, type V2Surface } from './navModel';
import { needsAttention, projectSessions, runningNow } from './projectWorkspaceData';
import { projectTone } from './projectTone';
import { formatRelativeTime, lastActivity, sessionLabel } from './sessionLabel';

/*
 * ContextNavigator (spec/03, prototype 01): search on top, then recent
 * projects and recent conversations from the real stores, then every legacy
 * page inside one "Tất cả trang" section, collapsed by default. Searching
 * filters projects, conversations and pages together and opens the section.
 * At 960–1023px (spec/04) it renders as a drawer: close button + Escape.
 */

export const NAV_PROJECT_LIMIT = 5;
export const NAV_RECENT_LIMIT = 5;
export const NAV_PROJECT_CHILD_LIMIT = 5;

type ProjectStatus = 'running' | 'attention' | 'idle';

const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  running: 'Đang chạy',
  attention: 'Cần chú ý',
  idle: 'Không có tác vụ đang chạy',
};

function projectStatus(sessions: AgentChatSession[]): ProjectStatus {
  if (runningNow(sessions).length > 0) return 'running';
  if (needsAttention(sessions).length > 0) return 'attention';
  return 'idle';
}

interface ContextNavigatorProps {
  currentPage: V2PageId;
  /** Open V2 surface; while set no legacy page is marked current. */
  activeSurface?: V2Surface | null;
  onNavigate: (page: V2PageId) => void;
  onSelectSurface?: (surface: V2Surface) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  extensionUpdateCount?: number;
  /** Set only in drawer mode. */
  onClose?: () => void;
}

function matchesSession(session: AgentChatSession, query: string): boolean {
  return sessionLabel(session).toLowerCase().includes(query.trim().toLowerCase());
}

const FolderIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </svg>
);

const ClockIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

const ChatIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5z" />
  </svg>
);

const CubeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7z" />
    <path d="M4.5 7.7L12 12l7.5-4.3M12 12v8.5" />
  </svg>
);

const ChevronIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M10 8l4 4-4 4" />
  </svg>
);

export function ContextNavigator({
  currentPage,
  activeSurface = null,
  onNavigate,
  onSelectSurface,
  searchRef,
  extensionUpdateCount = 0,
  onClose,
}: ContextNavigatorProps) {
  const [query, setQuery] = useState('');
  const [isAllOpen, setIsAllOpen] = useState(false);
  const [createNotice, setCreateNotice] = useState<string | null>(null);
  const [projectNotice, setProjectNotice] = useState<string | null>(null);
  const groups = filterNavGroups(query);
  const isDrawer = Boolean(onClose);

  const sessions = useAgentGatewayStore((state) => state.sessions);
  const activeSessionId = useAgentGatewayStore((state) => state.activeSessionId);
  const switchSession = useAgentGatewayStore((state) => state.switchSession);
  const projects = useProjectWorkspaceStore((state) => state.projects);
  const activeProjectId = useProjectWorkspaceStore((state) => state.activeProjectId);
  const selectProject = useProjectWorkspaceStore((state) => state.selectProject);
  const focusSession = useProjectWorkspaceStore((state) => state.focusSession);
  const assignSession = useProjectWorkspaceStore((state) => state.assignSession);
  // The active project starts expanded, like the Home tree (image 9).
  const [expandedIds, setExpandedIds] = useState<string[]>(() => (activeProjectId ? [activeProjectId] : []));
  const openProjects = useMemo(
    () => filterProjects(projects, 'active', query).slice(0, NAV_PROJECT_LIMIT),
    [projects, query],
  );
  const recentSessions = useMemo(() => {
    const matching = query ? sessions.filter((session) => matchesSession(session, query)) : sessions;
    return deriveRecentSessions(matching, NAV_RECENT_LIMIT);
  }, [sessions, query]);
  const unassignedCount = useMemo(() => deriveUnassignedSessions(sessions, projects).length, [sessions, projects]);
  const hasWorkspace = Boolean(onSelectSurface);
  // Without surfaces (tests, legacy callers) the pages are the only content.
  const isPagesExpanded = isAllOpen || Boolean(query) || !hasWorkspace;

  const openProject = (id: string) => {
    selectProject(id);
    onSelectSurface?.('project');
  };

  // With surfaces the chat opens inside Home; legacy callers keep the Chat page.
  const openSession = (id: string) => {
    switchSession(id);
    focusSession(id);
    if (onSelectSurface) onSelectSurface('conversation');
    else onNavigate('chat');
  };

  const newConversation = () => {
    const notice = startConversation();
    setCreateNotice(notice);
    if (!notice) onSelectSurface?.('conversation');
  };

  const toggleProject = (id: string) => {
    setExpandedIds((ids) => (ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]));
  };

  // New chat created straight inside a project, then opened.
  const addConversation = (projectId: string) => {
    const notice = startConversation();
    if (notice) {
      setProjectNotice(notice);
      return;
    }
    const sessionId = useAgentGatewayStore.getState().activeSessionId;
    if (!sessionId || !assignSession(projectId, sessionId)) {
      setProjectNotice('Đã tạo cuộc trò chuyện nhưng chưa gán được vào dự án (dự án đã đủ số hội thoại).');
    } else {
      setProjectNotice(null);
      focusSession(sessionId);
    }
    onSelectSurface?.('conversation');
  };

  // Apps come from the Marketplace; there is no installed-app data yet.
  const openMarketplace = () => onNavigate('marketplace');

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      const first = groups[0]?.items[0];
      if (first) onNavigate(first.page);
    } else if (event.key === 'Escape' && query) {
      event.preventDefault();
      setQuery('');
    }
  };

  // Escape that the search box did not consume closes the drawer.
  const handleDrawerKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !event.defaultPrevented && onClose) {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <aside
      className={isDrawer ? 'v2-navigator v2-navigator--drawer' : 'v2-navigator'}
      aria-label="Danh mục trang"
      onKeyDown={isDrawer ? handleDrawerKeyDown : undefined}
    >
      <div className="v2-navigator__search">
        <span className="v2-navigator__search-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <circle cx="11" cy="11" r="6.5" />
            <path d="M16 16l4 4" />
          </svg>
        </span>
        <input
          ref={searchRef}
          type="search"
          className="v2-navigator__input"
          aria-label="Tìm dự án, cuộc trò chuyện hoặc trang (Ctrl+K)"
          placeholder="Tìm dự án, cuộc trò chuyện..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {isDrawer ? (
          <button type="button" className="v2-navigator__close" aria-label="Đóng danh mục trang" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        ) : null}
      </div>

      <nav className="v2-navigator__groups" aria-label="Trang">
        {hasWorkspace ? (
          <section className="v2-navigator__group" aria-labelledby="v2-nav-group-projects">
            <div className="v2-navigator__group-head">
              <h2 id="v2-nav-group-projects" className="v2-navigator__group-title">
                Dự án gần đây
              </h2>
              <button type="button" className="v2-navigator__add" onClick={() => onSelectSurface?.('projects')}>
                + Tạo dự án
              </button>
            </div>
            {projectNotice ? (
              <p className="v2-navigator__hint" role="status">
                {projectNotice}
              </p>
            ) : null}
            {openProjects.length === 0 ? (
              <p className="v2-navigator__hint">{query ? 'Không có dự án phù hợp.' : 'Chưa có dự án nào.'}</p>
            ) : (
              <ul className="v2-navigator__list">
                {openProjects.map((project) => {
                  const ownSessions = projectSessions(sessions, project);
                  const status = projectStatus(ownSessions);
                  const isExpanded = expandedIds.includes(project.id);
                  const childrenId = `v2-nav-project-${project.id}`;
                  return (
                    <li key={project.id} className="v2-navigator__tree">
                      <div className="v2-navigator__tree-row">
                        <button
                          type="button"
                          className="v2-navigator__chevron"
                          aria-expanded={isExpanded}
                          aria-controls={childrenId}
                          aria-label={`${isExpanded ? 'Thu gọn' : 'Mở rộng'} ${project.name}`}
                          onClick={() => toggleProject(project.id)}
                        >
                          <ChevronIcon />
                        </button>
                        <button
                          type="button"
                          className="v2-navigator__entry"
                          aria-current={activeSurface === 'project' && project.id === activeProjectId ? 'true' : undefined}
                          onClick={() => openProject(project.id)}
                        >
                          <span className={`v2-navigator__tile v2-tile--tone-${projectTone(project.id)}`} aria-hidden="true">
                            <FolderIcon />
                          </span>
                          <span className="v2-navigator__entry-text">
                            <span className="v2-navigator__entry-name">
                              {project.name}
                              {project.pinned ? (
                                <span className="v2-pin" role="img" aria-label="Đã ghim" title="Đã ghim">
                                  ★
                                </span>
                              ) : null}
                            </span>
                            <span className="v2-navigator__entry-meta">
                              {`${project.sessionIds.length} cuộc trò chuyện • ${formatRelativeTime(project.updatedAt)}`}
                            </span>
                          </span>
                          <span
                            className={`v2-navigator__status v2-navigator__status--${status}`}
                            role="img"
                            aria-label={PROJECT_STATUS_LABEL[status]}
                            title={PROJECT_STATUS_LABEL[status]}
                          />
                        </button>
                      </div>
                      {isExpanded ? (
                        <ul id={childrenId} className="v2-navigator__children" aria-label={`Nội dung ${project.name}`}>
                          {ownSessions.length === 0 ? (
                            <li>
                              <p className="v2-navigator__hint">Chưa có hội thoại</p>
                            </li>
                          ) : (
                            deriveRecentSessions(ownSessions, NAV_PROJECT_CHILD_LIMIT).map((session) => (
                              <li key={session.id}>
                                <button
                                  type="button"
                                  className="v2-navigator__child"
                                  aria-current={
                                    activeSurface === 'conversation' && session.id === activeSessionId ? 'true' : undefined
                                  }
                                  onClick={() => openSession(session.id)}
                                >
                                  <ChatIcon />
                                  <span className="v2-navigator__child-name">{sessionLabel(session)}</span>
                                  <span className="v2-navigator__child-meta">{formatRelativeTime(lastActivity(session))}</span>
                                </button>
                              </li>
                            ))
                          )}
                          <li>
                            <button type="button" className="v2-navigator__child" onClick={openMarketplace}>
                              <CubeIcon />
                              <span className="v2-navigator__child-name">Ứng dụng</span>
                              <span className="v2-navigator__child-meta">Marketplace</span>
                            </button>
                          </li>
                          <li className="v2-navigator__child-actions">
                            <button
                              type="button"
                              className="v2-navigator__child-add"
                              aria-label={`Thêm hội thoại vào ${project.name}`}
                              onClick={() => addConversation(project.id)}
                            >
                              + Hội thoại
                            </button>
                            <button
                              type="button"
                              className="v2-navigator__child-add"
                              aria-label={`Thêm ứng dụng từ Marketplace vào ${project.name}`}
                              onClick={openMarketplace}
                            >
                              + Ứng dụng
                            </button>
                          </li>
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
            {query ? null : (
              <button type="button" className="v2-navigator__unassigned" onClick={() => onSelectSurface?.('projects')}>
                {`Phiên chưa gán · ${unassignedCount}`}
              </button>
            )}
            <button type="button" className="v2-navigator__more" onClick={() => onSelectSurface?.('projects')}>
              Xem tất cả dự án →
            </button>
          </section>
        ) : null}

        {hasWorkspace ? (
          <section className="v2-navigator__group" aria-labelledby="v2-nav-group-recent">
            <div className="v2-navigator__group-head">
              <h2 id="v2-nav-group-recent" className="v2-navigator__group-title">
                Cuộc trò chuyện gần đây
              </h2>
              <button
                type="button"
                className="v2-navigator__add"
                aria-label="Tạo cuộc trò chuyện mới"
                onClick={newConversation}
              >
                + Mới
              </button>
            </div>
            {createNotice ? (
              <p className="v2-navigator__hint" role="status">
                {createNotice}
              </p>
            ) : null}
            {recentSessions.length === 0 ? (
              <p className="v2-navigator__hint">
                {query ? 'Không có cuộc trò chuyện phù hợp.' : 'Chưa có cuộc trò chuyện nào.'}
              </p>
            ) : (
              <ul className="v2-navigator__list">
                {recentSessions.map((session) => (
                  <li key={session.id}>
                    <button
                      type="button"
                      className="v2-navigator__entry v2-navigator__entry--recent"
                      aria-current={activeSurface === 'conversation' && session.id === activeSessionId ? 'true' : undefined}
                      onClick={() => openSession(session.id)}
                    >
                      <span className="v2-navigator__tile v2-navigator__tile--chat" aria-hidden="true">
                        <ClockIcon />
                      </span>
                      <span className="v2-navigator__entry-text">
                        <span className="v2-navigator__entry-name">{sessionLabel(session)}</span>
                        <span className="v2-navigator__entry-meta">{formatRelativeTime(lastActivity(session))}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <div className="v2-navigator__all">
          {hasWorkspace ? (
            <button
              type="button"
              className="v2-navigator__all-toggle"
              aria-expanded={isPagesExpanded}
              aria-controls="v2-nav-all-pages"
              onClick={() => setIsAllOpen((open) => !open)}
            >
              <span>Tất cả trang</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <path d="M8 10l4 4 4-4" />
              </svg>
            </button>
          ) : null}
          <div id="v2-nav-all-pages" className="v2-navigator__all-pages" hidden={!isPagesExpanded}>
            {groups.length === 0 ? (
              <p className="v2-navigator__empty" role="status">
                Không có trang phù hợp
              </p>
            ) : (
              groups.map((group) => (
                <section key={group.id} className="v2-navigator__group" aria-labelledby={`v2-nav-group-${group.id}`}>
                  <h2 id={`v2-nav-group-${group.id}`} className="v2-navigator__group-title">
                    {group.label}
                  </h2>
                  <ul className="v2-navigator__list">
                    {group.items.map((item) => {
                      const isActive = !activeSurface && item.page === currentPage;
                      const updateCount = item.page === 'extensions' ? extensionUpdateCount : 0;
                      return (
                        <li key={item.page}>
                          <button
                            type="button"
                            className={isActive ? 'v2-navigator__item is-active' : 'v2-navigator__item'}
                            aria-current={isActive ? 'page' : undefined}
                            aria-label={updateCount > 0 ? `${item.label}, ${updateCount} bản cập nhật extension` : undefined}
                            data-page={item.page}
                            onClick={() => onNavigate(item.page)}
                          >
                            <span className="v2-navigator__label">{item.label}</span>
                            {item.note ? <span className="v2-navigator__note">{item.note}</span> : null}
                            {updateCount > 0 ? <span className="v2-navigator__badge">{`${updateCount} up`}</span> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))
            )}
          </div>
        </div>
      </nav>
    </aside>
  );
}
