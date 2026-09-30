import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAgentGatewayStore } from '../../store/agentGateway';
import { filterProjects, useProjectWorkspaceStore } from '../../store/projectWorkspace';
import { cancelPendingHandoff, createComposerHandoff, type HandoffResult } from './composerHandoff';
import { startConversation } from './ConversationSurface';
import { cancelMarketingPrefill, offerMarketingPrefill } from './marketingPrefill';
import type { V2PageId, V2Surface } from './navModel';
import { projectSessions } from './projectWorkspaceData';
import { projectTone } from './projectTone';
import { formatRelativeTime, lastActivity, sessionLabel } from './sessionLabel';

/*
 * Home (spec/04, M3-A, prototype 01). The composer never sends: it hands the
 * text to the Chat composer of the right session through composerHandoff,
 * then opens that conversation inside Home so the user sends it there.
 * Failed handoffs keep the text.
 *
 * The typed text is owned by AppShellV2 so switching surfaces keeps it.
 * Editing the text, opening something else or leaving Home cancels a pending
 * handoff, so a late result can never switch session or navigate.
 *
 * Capability "Agent Marketing" (M3) instead offers the text as a one-time
 * prefill for the existing Director textarea (marketingPrefill) and opens the
 * customer-marketing page. Nothing is submitted there; the draft is kept
 * until the textarea takes the text, and editing it drops the offer.
 *
 * Below the hero only real projects are listed; no metrics are invented.
 */

export const HOME_PROJECT_LIMIT = 6;

// A cancelled handoff was superseded by the user, so it shows nothing.
export const HANDOFF_MESSAGES: Record<Exclude<HandoffResult['status'], 'handed-off' | 'cancelled'>, string> = {
  empty: 'Nhập nội dung trước khi mở Chat.',
  'project-missing': 'Dự án này đã được lưu trữ hoặc không còn. Chọn dự án khác.',
  'project-full': 'Dự án đã đủ 500 phiên. Tạo dự án mới hoặc chọn dự án khác, nội dung vẫn được giữ.',
  busy: 'Agent đang trả lời. Chờ xong rồi thử lại, nội dung vẫn được giữ.',
  'draft-occupied': 'Chat đang có bản nháp chưa gửi. Gửi hoặc xoá bản nháp đó trước, nội dung ở đây vẫn được giữ.',
  'no-session': 'Không tạo được phiên chat cho agent đã chọn.',
  error: 'Không tải được các phiên đã lưu. Nội dung vẫn được giữ, hãy thử lại.',
  'in-flight': 'Đang chuyển nội dung sang Chat.',
};

// Prefill only: picking one never sends anything. `tone` picks the icon tile colour.
const QUICK_PROMPTS = [
  { text: 'Lên kế hoạch nội dung cho tuần này', tone: 'violet', icon: 'M5 6.5h14M5 12h14M5 17.5h9' },
  { text: 'Tóm tắt việc cần làm tiếp theo', tone: 'blue', icon: 'M5 12.5l4 4 10-10' },
  { text: 'Soạn tin nhắn chăm sóc khách hàng', tone: 'green', icon: 'M5 6h14v9H9l-4 3.5z' },
  { text: 'Phân tích đối thủ cạnh tranh', tone: 'amber', icon: 'M5 19V11M12 19V5M19 19v-6' },
] as const;

type Capability = 'chat' | 'marketing';

interface HomeSurfaceProps {
  draft: string;
  onDraftChange: (draft: string) => void;
  onNavigate: (page: V2PageId) => void;
  onSelectSurface: (surface: V2Surface) => void;
  isNavigatorOpen: boolean;
  onToggleNavigator: () => void;
}

const FolderIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
    <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </svg>
);

export function HomeSurface({
  draft,
  onDraftChange,
  onNavigate,
  onSelectSurface,
  isNavigatorOpen,
  onToggleNavigator,
}: HomeSurfaceProps) {
  const agents = useAgentGatewayStore((state) => state.agents);
  const sessions = useAgentGatewayStore((state) => state.sessions);
  const isSending = useAgentGatewayStore((state) => state.isSending);
  const switchSession = useAgentGatewayStore((state) => state.switchSession);
  const projects = useProjectWorkspaceStore((state) => state.projects);
  const activeProjectId = useProjectWorkspaceStore((state) => state.activeProjectId);
  const selectProject = useProjectWorkspaceStore((state) => state.selectProject);
  const focusSession = useProjectWorkspaceStore((state) => state.focusSession);

  const promptRef = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    // Back on Home before Marketing took the text: the draft is still here, so
    // the old offer must not land in a later Director textarea.
    cancelMarketingPrefill();
    return () => {
      mounted.current = false;
      cancelPendingHandoff();
    };
  }, []);

  const [capability, setCapability] = useState<Capability>('chat');
  const [agentId, setAgentId] = useState('');
  const [projectId, setProjectId] = useState(() => activeProjectId ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handoff = useMemo(
    () =>
      createComposerHandoff({
        gateway: useAgentGatewayStore.getState,
        projects: useProjectWorkspaceStore.getState,
      }),
    [],
  );
  const openProjects = useMemo(() => filterProjects(projects, 'active', ''), [projects]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (capability === 'marketing') {
      openInMarketing();
      return;
    }
    cancelMarketingPrefill();
    setIsSubmitting(true);
    setMessage(null);
    const result = await handoff({ text: draft, projectId: projectId || null, agentId: agentId || undefined });
    // Superseded: supersede() already reset the form, and a newer submit may be pending.
    if (!mounted.current || result.status === 'cancelled') return;
    setIsSubmitting(false);
    if (result.status === 'handed-off') {
      onDraftChange('');
      // The handed-off text waits in the conversation composer inside Home.
      onSelectSurface('conversation');
      return;
    }
    setMessage(HANDOFF_MESSAGES[result.status]);
  };

  // Any other user intent supersedes a pending handoff.
  const supersede = () => {
    if (!isSubmitting) return;
    cancelPendingHandoff();
    setIsSubmitting(false);
  };

  // Only types the text into the Director textarea; the draft is cleared when
  // it arrives there, never before.
  const openInMarketing = () => {
    setMessage(null);
    if (!offerMarketingPrefill(draft, () => onDraftChange(''))) {
      setMessage('Nhập nội dung trước khi mở Agent Marketing.');
      return;
    }
    onNavigate('customer-marketing');
  };

  const editDraft = (value: string) => {
    supersede();
    cancelMarketingPrefill();
    onDraftChange(value);
  };

  const changeCapability = (next: Capability) => {
    supersede();
    cancelMarketingPrefill();
    setMessage(null);
    setCapability(next);
  };

  // A changed agent or project is a new intent; the pending result must not apply.
  const changeAgent = (id: string) => {
    supersede();
    setAgentId(id);
  };

  const changeProject = (id: string) => {
    supersede();
    setProjectId(id);
  };

  const openProject = (id: string) => {
    supersede();
    selectProject(id);
    onSelectSurface('project');
  };

  // "+" opens a fresh conversation inside Home; a refusal stays on Home as a notice.
  const newConversation = () => {
    supersede();
    const notice = startConversation(agentId || undefined);
    if (notice) setMessage(notice);
    else onSelectSurface('conversation');
  };

  const openConversation = (sessionId: string) => {
    supersede();
    switchSession(sessionId);
    focusSession(sessionId);
    onSelectSurface('conversation');
  };

  const submitLabel = isSubmitting ? 'Đang mở…' : capability === 'marketing' ? 'Mở trong Agent Marketing' : 'Mở trong Chat';

  return (
    <section className="v2-surface v2-home" aria-labelledby="v2-home-title">
      <div className="v2-home__hero">
        <div className="v2-home__toolbar">
          <button type="button" className="v2-button v2-button--primary" onClick={newConversation} disabled={isSending}>
            <span aria-hidden="true">+</span> Cuộc trò chuyện mới
          </button>
          <button type="button" className="v2-button v2-home__collapse" aria-pressed={!isNavigatorOpen} onClick={onToggleNavigator}>
            {isNavigatorOpen ? 'Thu gọn' : 'Hiện danh mục'}
          </button>
        </div>
        <header className="v2-surface__header v2-home__header">
          <h1 id="v2-home-title" className="v2-surface__title v2-home__title">
            <span className="v2-home__welcome">Chào mừng đến với</span>
            <span className="v2-home__brand">IZZI AI</span>
          </h1>
          <p className="v2-home__subtitle">Trợ lý AI cho Marketing, Kinh doanh và Tăng trưởng</p>
        </header>

        <form className="v2-home__composer" onSubmit={submit}>
          <label className="v2-visually-hidden" htmlFor="v2-home-prompt">
            Nội dung cho agent
          </label>
          <textarea
            ref={promptRef}
            id="v2-home-prompt"
            className="v2-home__prompt"
            rows={3}
            value={draft}
            readOnly={isSubmitting}
            placeholder={
              capability === 'marketing'
                ? 'Mô tả mục tiêu marketing, Izzi điền sẵn vào Agent Marketing để bạn gửi...'
                : 'Hỏi bất cứ điều gì trong dự án của bạn...'
            }
            onChange={(event) => editDraft(event.target.value)}
          />
          <div className="v2-home__controls">
            <select
              className="v2-field__select v2-home__pill"
              aria-label="Chức năng"
              value={capability}
              onChange={(event) => changeCapability(event.target.value === 'marketing' ? 'marketing' : 'chat')}
            >
              <option value="chat">Chat</option>
              <option value="marketing">Agent Marketing</option>
            </select>
            {capability === 'chat' && (
              <>
                <select
                  className="v2-field__select v2-home__pill"
                  aria-label="Agent"
                  value={agentId}
                  onChange={(event) => changeAgent(event.target.value)}
                >
                  <option value="">Agent đang dùng</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.displayName || agent.name}
                    </option>
                  ))}
                </select>
                <select
                  className="v2-field__select v2-home__pill"
                  aria-label="Dự án"
                  value={projectId}
                  onChange={(event) => changeProject(event.target.value)}
                >
                  <option value="">Chưa gán dự án</option>
                  {openProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </>
            )}
            <button
              type="submit"
              className="v2-home__send"
              disabled={isSubmitting}
              aria-label={submitLabel}
              title={submitLabel}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 19V5M6 11l6-6 6 6" />
              </svg>
            </button>
          </div>
        </form>
        <p className="v2-surface__status" role="status">
          {message}
        </p>
        <div className="v2-home__quick" role="group" aria-label="Gợi ý nhanh">
          {QUICK_PROMPTS.map((prompt) => (
            <button key={prompt.text} type="button" className="v2-chip" onClick={() => editDraft(prompt.text)}>
              <span className={`v2-home__quick-icon v2-home__quick-icon--${prompt.tone}`} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d={prompt.icon} />
                </svg>
              </span>
              <span className="v2-home__quick-label">{prompt.text}</span>
            </button>
          ))}
        </div>
      </div>

      <section className="v2-surface__section v2-home__featured" aria-labelledby="v2-home-projects">
        <div className="v2-home__section-head">
          <h2 id="v2-home-projects" className="v2-surface__section-title">
            Dự án nổi bật
          </h2>
          <button type="button" className="v2-home__see-all" onClick={() => onSelectSurface('projects')}>
            Xem tất cả →
          </button>
        </div>
        {openProjects.length === 0 ? (
          <div className="v2-home__empty-card">
            <span className="v2-home__project-tile" aria-hidden="true">
              <FolderIcon />
            </span>
            <p>Chưa có dự án nào. Tạo dự án để gom các cuộc trò chuyện theo mục tiêu.</p>
            <button type="button" className="v2-button v2-button--primary" onClick={() => onSelectSurface('projects')}>
              Tạo dự án
            </button>
          </div>
        ) : (
          <ul className="v2-home__projects">
            {openProjects.slice(0, HOME_PROJECT_LIMIT).map((project) => {
              const isExpanded = expandedId === project.id;
              const panelId = `v2-home-project-${project.id}`;
              const projectChats = isExpanded ? projectSessions(sessions, project) : [];
              return (
              <li key={project.id} className={isExpanded ? 'v2-home__project-item is-expanded' : 'v2-home__project-item'}>
                <button
                  type="button"
                  className="v2-home__project"
                  aria-expanded={isExpanded}
                  aria-controls={panelId}
                  onClick={() => setExpandedId(isExpanded ? null : project.id)}
                >
                  <span className={`v2-home__project-tile v2-tile--tone-${projectTone(project.id)}`} aria-hidden="true">
                    <FolderIcon />
                  </span>
                  <span className="v2-home__project-name">
                    {project.name}
                    {project.pinned ? (
                      <span className="v2-pin" role="img" aria-label="Đã ghim" title="Đã ghim">
                        ★
                      </span>
                    ) : null}
                  </span>
                  {project.description ? <span className="v2-home__project-desc">{project.description}</span> : null}
                  <span className="v2-home__project-meta">
                    {`${project.sessionIds.length} cuộc trò chuyện`}
                    <span className="v2-home__project-chevron" aria-hidden="true">
                      ▾
                    </span>
                  </span>
                </button>
                {isExpanded ? (
                  <div id={panelId} className="v2-home__project-panel">
                    <p className="v2-home__panel-label">Cuộc trò chuyện</p>
                    {projectChats.length === 0 ? (
                      <p className="v2-home__panel-empty">Chưa có cuộc trò chuyện nào trong dự án này.</p>
                    ) : (
                      <ul className="v2-home__panel-list">
                        {projectChats.map((session) => (
                          <li key={session.id}>
                            <button type="button" className="v2-home__panel-row" onClick={() => openConversation(session.id)}>
                              <span className="v2-home__panel-title">{sessionLabel(session)}</span>
                              <span className="v2-home__panel-time">{formatRelativeTime(lastActivity(session))}</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="v2-home__panel-label">Ứng dụng</p>
                    <p className="v2-home__panel-empty">
                      Gắn ứng dụng từ Market vào dự án · <span className="v2-badge">Sắp có</span>
                    </p>
                    <div className="v2-home__panel-actions">
                      <button type="button" className="v2-button" onClick={() => openProject(project.id)}>
                        Mở dự án
                      </button>
                      <button type="button" className="v2-button" onClick={() => onNavigate('marketplace')}>
                        Xem Market
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}
