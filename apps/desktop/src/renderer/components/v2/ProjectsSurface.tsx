import React, { useMemo, useState } from 'react';
import { useAgentGatewayStore } from '../../store/agentGateway';
import {
  PROJECT_NAME_MAX,
  SESSION_IDS_MAX,
  deriveUnassignedSessions,
  filterProjects,
  useProjectWorkspaceStore,
  type ProjectFilter,
} from '../../store/projectWorkspace';
import type { V2PageId } from './navModel';
import { sessionLabel } from './sessionLabel';

/*
 * Projects (spec/04, M3-A). Project metadata is local only; sessions come
 * from the gateway store. A session joins a project only through the explicit
 * "Gán vào dự án" action, never by inference.
 */

export const PROJECT_FILTERS: { id: ProjectFilter; label: string }[] = [
  { id: 'active', label: 'Đang làm' },
  { id: 'pinned', label: 'Đã ghim' },
  { id: 'archived', label: 'Lưu trữ' },
];

interface ProjectsSurfaceProps {
  onNavigate: (page: V2PageId) => void;
  onOpenProject?: () => void;
}

export function ProjectsSurface({ onNavigate, onOpenProject }: ProjectsSurfaceProps) {
  const sessions = useAgentGatewayStore((state) => state.sessions);
  const switchSession = useAgentGatewayStore((state) => state.switchSession);
  const projects = useProjectWorkspaceStore((state) => state.projects);
  const activeProjectId = useProjectWorkspaceStore((state) => state.activeProjectId);
  const createProject = useProjectWorkspaceStore((state) => state.createProject);
  const selectProject = useProjectWorkspaceStore((state) => state.selectProject);
  const togglePin = useProjectWorkspaceStore((state) => state.togglePin);
  const archiveProject = useProjectWorkspaceStore((state) => state.archiveProject);
  const assignSession = useProjectWorkspaceStore((state) => state.assignSession);
  const unassignSession = useProjectWorkspaceStore((state) => state.unassignSession);
  const focusSession = useProjectWorkspaceStore((state) => state.focusSession);

  const [filter, setFilter] = useState<ProjectFilter>('active');
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const visibleProjects = useMemo(() => filterProjects(projects, filter, query), [projects, filter, query]);
  const activeProject = projects.find((project) => project.id === activeProjectId && !project.archived) ?? null;
  const boundSessions = useMemo(
    () => (activeProject ? sessions.filter((session) => activeProject.sessionIds.includes(session.id)) : []),
    [activeProject, sessions],
  );
  const unassignedSessions = useMemo(() => deriveUnassignedSessions(sessions, projects), [sessions, projects]);

  const submitCreate = (event: React.FormEvent) => {
    event.preventDefault();
    const id = createProject(newName);
    if (id === null) {
      setMessage('Nhập tên dự án trước khi tạo.');
      return;
    }
    setNewName('');
    setFilter('active');
    setMessage(null);
  };

  const openSession = (id: string) => {
    switchSession(id);
    focusSession(id);
    onNavigate('chat');
  };

  const assignToActive = (sessionId: string) => {
    if (!activeProject) return;
    setMessage(
      assignSession(activeProject.id, sessionId) ? null : `Dự án đã đủ ${SESSION_IDS_MAX} phiên. Tạo dự án mới để gán thêm.`,
    );
  };

  return (
    <section className="v2-surface v2-projects" aria-labelledby="v2-projects-title">
      <header className="v2-surface__header">
        <h1 id="v2-projects-title" className="v2-surface__title">
          Dự án
        </h1>
        <form className="v2-projects__create" onSubmit={submitCreate}>
          <label className="v2-visually-hidden" htmlFor="v2-project-name">
            Tên dự án mới
          </label>
          <input
            id="v2-project-name"
            className="v2-field__input"
            value={newName}
            maxLength={PROJECT_NAME_MAX}
            placeholder="Tên dự án mới"
            onChange={(event) => setNewName(event.target.value)}
          />
          <button type="submit" className="v2-button v2-button--primary">
            Tạo dự án
          </button>
        </form>
      </header>
      <p className="v2-surface__status" role="status">
        {message}
      </p>

      <div className="v2-projects__toolbar">
        <div className="v2-tabs" role="group" aria-label="Lọc dự án">
          {PROJECT_FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={option.id === filter ? 'v2-tab is-active' : 'v2-tab'}
              aria-pressed={option.id === filter}
              onClick={() => setFilter(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="v2-visually-hidden" htmlFor="v2-project-search">
          Tìm dự án
        </label>
        <input
          id="v2-project-search"
          className="v2-field__input"
          type="search"
          value={query}
          placeholder="Tìm dự án"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {visibleProjects.length === 0 ? (
        <p className="v2-empty">{projects.length === 0 ? 'Chưa có dự án nào. Tạo dự án đầu tiên ở trên.' : 'Không có dự án khớp bộ lọc.'}</p>
      ) : (
        <ul className="v2-project-list">
          {visibleProjects.map((project) => (
            <li key={project.id} className={project.id === activeProject?.id ? 'v2-project-row is-active' : 'v2-project-row'}>
              <button
                type="button"
                className="v2-project-row__select"
                aria-current={project.id === activeProject?.id ? 'true' : undefined}
                disabled={project.archived}
                onClick={() => selectProject(project.id)}
              >
                <span className="v2-project-card__name">{project.name}</span>
                <span className="v2-project-card__meta">{project.sessionIds.length} phiên</span>
              </button>
              {project.archived ? null : (
                <button
                  type="button"
                  className="v2-button"
                  aria-label={`Mở không gian dự án ${project.name}`}
                  onClick={() => {
                    selectProject(project.id);
                    onOpenProject?.();
                  }}
                >
                  Mở
                </button>
              )}
              {project.archived ? null : (
                <button type="button" className="v2-button v2-button--ghost" aria-pressed={project.pinned} onClick={() => togglePin(project.id)}>
                  {project.pinned ? 'Bỏ ghim' : 'Ghim'}
                </button>
              )}
              <button
                type="button"
                className="v2-button v2-button--ghost"
                onClick={() => archiveProject(project.id, !project.archived)}
              >
                {project.archived ? 'Khôi phục' : 'Lưu trữ'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {activeProject ? (
        <section className="v2-surface__section" aria-labelledby="v2-project-sessions">
          <h2 id="v2-project-sessions" className="v2-surface__section-title">
            Phiên trong {activeProject.name}
          </h2>
          {boundSessions.length === 0 ? (
            <p className="v2-empty">Dự án chưa có phiên nào.</p>
          ) : (
            <ul className="v2-session-list">
              {boundSessions.map((session) => (
                <li key={session.id} className="v2-session-row">
                  <button type="button" className="v2-session-item" onClick={() => openSession(session.id)}>
                    {sessionLabel(session)}
                  </button>
                  <button type="button" className="v2-button v2-button--ghost" onClick={() => unassignSession(session.id)}>
                    Bỏ gán
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="v2-surface__section" aria-labelledby="v2-unassigned-sessions">
        <h2 id="v2-unassigned-sessions" className="v2-surface__section-title">
          Phiên chưa gán
        </h2>
        {unassignedSessions.length === 0 ? (
          <p className="v2-empty">Mọi phiên đều đã thuộc một dự án.</p>
        ) : (
          <ul className="v2-session-list">
            {unassignedSessions.map((session) => (
              <li key={session.id} className="v2-session-row">
                <button type="button" className="v2-session-item" onClick={() => openSession(session.id)}>
                  {sessionLabel(session)}
                </button>
                <button
                  type="button"
                  className="v2-button v2-button--ghost"
                  disabled={!activeProject}
                  title={activeProject ? undefined : 'Chọn một dự án trước'}
                  onClick={() => assignToActive(session.id)}
                >
                  Gán vào dự án
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
