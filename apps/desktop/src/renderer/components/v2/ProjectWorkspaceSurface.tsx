import React, { useMemo, useRef } from 'react';
import { useAgentGatewayStore } from '../../store/agentGateway';
import {
  PROJECT_SURFACES,
  useProjectWorkspaceStore,
  type ProjectMeta,
  type ProjectSurface,
} from '../../store/projectWorkspace';
import type { V2Surface } from './navModel';
import { ProjectChatPanel } from './ProjectChatPanel';
import {
  activityFeed,
  agentTurns,
  needsAttention,
  projectSessions,
  recentContext,
  runningNow,
} from './projectWorkspaceData';

/*
 * Izzi AI V2 — M3-B1 project workspace (spec Screen B). The active tab is
 * ProjectMeta.activeSurface, so each project remembers its own tab. Overview,
 * Chat, Runs and Activity read only the gateway sessions explicitly assigned to
 * this project. Approvals, Files and Tasks have no project link yet (PENDING).
 */

export const PROJECT_SURFACE_LABEL: Record<ProjectSurface, string> = {
  overview: 'Tổng quan',
  chat: 'Chat',
  runs: 'Lượt chạy',
  approvals: 'Phê duyệt',
  files: 'Tệp',
  tasks: 'Việc',
  activity: 'Hoạt động',
};

const UNLINKED: Partial<Record<ProjectSurface, string>> = {
  approvals: 'Phê duyệt chưa được liên kết với dự án.',
  files: 'Tệp chưa được liên kết với dự án.',
  tasks: 'Việc chưa được liên kết với dự án.',
};

const RECENT_LIMIT = 8;
const ACTIVITY_LIMIT = 50;
const PREVIEW_CHARS = 160;

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('vi-VN');
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat || '—';
}

export function ProjectWorkspaceSurface({ onSelectSurface }: { onSelectSurface: (surface: V2Surface) => void }) {
  const project = useProjectWorkspaceStore((state) =>
    state.projects.find((item) => item.id === state.activeProjectId && !item.archived),
  );
  const setSurface = useProjectWorkspaceStore((state) => state.setSurface);
  const tabRefs = useRef<Partial<Record<ProjectSurface, HTMLButtonElement | null>>>({});

  if (!project) {
    return (
      <section className="v2-surface v2-project-workspace">
        <p className="v2-empty">Chưa chọn dự án nào.</p>
        <button type="button" className="v2-button" onClick={() => onSelectSurface('projects')}>
          Xem danh sách dự án
        </button>
      </section>
    );
  }

  const active = project.activeSurface;

  function select(surface: ProjectSurface) {
    setSurface(project!.id, surface);
    tabRefs.current[surface]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const index = PROJECT_SURFACES.indexOf(active);
    const last = PROJECT_SURFACES.length - 1;
    const next =
      event.key === 'ArrowRight' ? (index + 1) % PROJECT_SURFACES.length
      : event.key === 'ArrowLeft' ? (index - 1 + PROJECT_SURFACES.length) % PROJECT_SURFACES.length
      : event.key === 'Home' ? 0
      : event.key === 'End' ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    select(PROJECT_SURFACES[next]);
  }

  return (
    <section className="v2-surface v2-project-workspace" aria-labelledby="v2-project-workspace-title">
      <header className="v2-surface__header">
        <h1 id="v2-project-workspace-title" className="v2-surface__title">
          {project.name}
        </h1>
        <button type="button" className="v2-button" onClick={() => onSelectSurface('projects')}>
          Tất cả dự án
        </button>
      </header>
      <div className="v2-project-tabs" role="tablist" aria-label="Khu vực dự án" onKeyDown={onKeyDown}>
        {PROJECT_SURFACES.map((surface) => (
          <button
            key={surface}
            ref={(node) => {
              tabRefs.current[surface] = node;
            }}
            type="button"
            role="tab"
            id={`v2-project-tab-${surface}`}
            className={`v2-tab${surface === active ? ' is-active' : ''}`}
            aria-selected={surface === active}
            aria-controls="v2-project-panel"
            tabIndex={surface === active ? 0 : -1}
            onClick={() => select(surface)}
          >
            {PROJECT_SURFACE_LABEL[surface]}
          </button>
        ))}
      </div>
      <div
        id="v2-project-panel"
        className="v2-project-panel"
        role="tabpanel"
        aria-labelledby={`v2-project-tab-${active}`}
        tabIndex={0}
      >
        <ProjectPanel project={project} surface={active} />
      </div>
    </section>
  );
}

function ProjectPanel({ project, surface }: { project: ProjectMeta; surface: ProjectSurface }) {
  const sessions = useAgentGatewayStore((state) => state.sessions);
  const owned = useMemo(() => projectSessions(sessions, project), [sessions, project]);

  if (surface === 'chat') return <ProjectChatPanel project={project} />;
  if (surface === 'overview') return <OverviewPanel sessions={owned} />;
  if (surface === 'runs') return <RunsPanel sessions={owned} />;
  if (surface === 'activity') return <ActivityPanel sessions={owned} />;
  return (
    <p className="v2-empty" data-link-state="unlinked">
      {UNLINKED[surface]} Chưa có dữ liệu nào được gán cho dự án này.
    </p>
  );
}

type SessionsProps = { sessions: ReturnType<typeof projectSessions> };

function OverviewPanel({ sessions }: SessionsProps) {
  const attention = needsAttention(sessions);
  const running = runningNow(sessions);
  const recent = recentContext(sessions, RECENT_LIMIT);

  return (
    <div className="v2-project-overview">
      <p className="v2-surface__status">
        {sessions.length} phiên · {running.length} lượt agent đang chạy · {attention.length} mục cần xử lý
      </p>
      <section className="v2-surface__section" aria-labelledby="v2-project-attention">
        <h2 id="v2-project-attention" className="v2-surface__section-title">
          Cần xử lý
        </h2>
        {attention.length === 0 ? (
          <p className="v2-empty">Không có lượt agent lỗi.</p>
        ) : (
          <ul className="v2-project-feed">
            {attention.map((item) => (
              <li key={item.id} className="v2-project-feed__item">
                <strong>{item.label}</strong>
                <span className="v2-project-feed__meta">
                  {item.agentName} · {formatTime(item.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="v2-surface__section" aria-labelledby="v2-project-running">
        <h2 id="v2-project-running" className="v2-surface__section-title">
          Đang chạy
        </h2>
        {running.length === 0 ? (
          <p className="v2-empty">Không có lượt agent nào đang chạy.</p>
        ) : (
          <ul className="v2-project-feed">
            {running.map((turn) => (
              <li key={turn.id} className="v2-project-feed__item">
                <strong>{preview(turn.prompt)}</strong>
                <span className="v2-project-feed__meta">
                  {turn.agentName} · {turn.state}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="v2-surface__section" aria-labelledby="v2-project-recent">
        <h2 id="v2-project-recent" className="v2-surface__section-title">
          Ngữ cảnh gần đây
        </h2>
        {recent.length === 0 ? (
          <p className="v2-empty">Chưa có tin nhắn trong các phiên của dự án.</p>
        ) : (
          <ul className="v2-project-feed">
            {recent.map((message) => (
              <li key={message.id} className="v2-project-feed__item">
                <span className="v2-project-feed__meta">
                  {message.role === 'user' ? 'Bạn' : 'Agent'} · {formatTime(message.createdAt)}
                </span>
                <span>{preview(message.content)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RunsPanel({ sessions }: SessionsProps) {
  const turns = agentTurns(sessions);
  return (
    <div className="v2-project-runs">
      <p className="v2-surface__status">
        Mỗi mục là một lượt trả lời của agent trong phiên chat của dự án. Chưa có lịch sử chạy lưu lâu dài.
      </p>
      {turns.length === 0 ? (
        <p className="v2-empty">Chưa có lượt agent nào.</p>
      ) : (
        <ul className="v2-project-feed">
          {turns.map((turn) => (
            <li key={turn.id} className="v2-project-feed__item">
              <strong>Lượt agent · {turn.agentName}</strong>
              <span className="v2-project-feed__meta">
                {turn.state} · {formatTime(turn.createdAt)}
              </span>
              <span>{preview(turn.prompt)}</span>
              {turn.steps.length > 0 && (
                <ol className="v2-project-steps">
                  {turn.steps.map((step) => (
                    <li key={step.id}>
                      {step.label} · {step.status}
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityPanel({ sessions }: SessionsProps) {
  const feed = activityFeed(sessions, ACTIVITY_LIMIT);
  if (feed.length === 0) return <p className="v2-empty">Chưa có hoạt động nào trong dự án.</p>;
  return (
    <ul className="v2-project-feed">
      {feed.map((item) => (
        <li key={item.id} className="v2-project-feed__item" data-kind={item.kind}>
          <span className="v2-project-feed__meta">
            {item.label} · {formatTime(item.createdAt)}
          </span>
          <span>{preview(item.detail)}</span>
        </li>
      ))}
    </ul>
  );
}
