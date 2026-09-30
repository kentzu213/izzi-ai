import React, { useMemo, useState } from 'react';
import { useAgentGatewayStore } from '../../store/agentGateway';
import { projectForSession, useProjectWorkspaceStore } from '../../store/projectWorkspace';
import { ChatComposer } from '../ChatComposer';
import { ChatMessageList } from '../ChatMessageList';
import { createProjectSession, type ProjectSessionResult } from './composerHandoff';
import type { V2Surface } from './navModel';
import { composerTicket, liveTurnSessionId, shouldClearComposer } from './ProjectChatPanel';
import { sessionLabel } from './sessionLabel';
import '../../styles/agent-gateway.css';
import '../../styles/agent-workspace.css';

/*
 * ConversationSurface: one chat opened inside the Home workspace. Picking a
 * conversation from Home or the navigator switches this content in place
 * instead of jumping to the legacy chat page or the Project workspace.
 */

type GatewayState = ReturnType<typeof useAgentGatewayStore.getState>;

const BUSY_ELSEWHERE = 'Một lượt agent đang chạy ở phiên khác; chờ lượt đó xong trước khi gửi.';
const INTERRUPT_REFUSED = 'Lượt agent đang chạy thuộc phiên khác; không thể dừng hoặc chèn từ đây.';
const NO_AGENT = 'Chưa có agent nào để tạo cuộc trò chuyện.';
const CREATE_NOTICE: Record<Exclude<ProjectSessionResult['status'], 'created'>, string> = {
  'project-missing': 'Dự án không còn hoạt động.',
  'project-full': 'Dự án đã đủ số phiên tối đa.',
  busy: 'Đang có lượt agent chạy, thử lại sau.',
  'no-session': 'Không tạo được phiên cho agent này.',
};

const handoffDeps = {
  gateway: () => useAgentGatewayStore.getState(),
  projects: () => useProjectWorkspaceStore.getState(),
};

/**
 * Opens a fresh conversation with the given agent (else the active one, else
 * the first). Returns a user-facing notice when nothing was created.
 */
export function startConversation(agentId?: string): string | null {
  const gw = useAgentGatewayStore.getState();
  if (gw.isSending) return CREATE_NOTICE.busy;
  const current = gw.sessions.find((session) => session.id === gw.activeSessionId);
  const target = agentId || current?.agentId || gw.agents[0]?.id;
  if (!target) return NO_AGENT;
  const before = gw.activeSessionId;
  gw.newGatewaySession(target);
  const after = useAgentGatewayStore.getState().activeSessionId;
  if (!after || after === before) return CREATE_NOTICE['no-session'];
  useProjectWorkspaceStore.getState().focusSession(after);
  return null;
}

/** 'ok': the live turn is this conversation and its runtime can be interrupted. */
function conversationInterrupt(gw: GatewayState): 'ok' | 'here' | 'elsewhere' | 'none' {
  if (!gw.isSending) return 'none';
  const live = liveTurnSessionId(gw.sessions, gw.currentTurnId);
  if (!live || live !== gw.activeSessionId) return 'elsewhere';
  const agentId = gw.sessions.find((session) => session.id === live)?.agentId;
  return gw.agents.find((agent) => agent.id === agentId)?.runtime === 'izzi' ? 'here' : 'ok';
}

interface ConversationSurfaceProps {
  onSelectSurface: (surface: V2Surface) => void;
  isNavigatorOpen: boolean;
  onToggleNavigator: () => void;
}

export function ConversationSurface({ onSelectSurface, isNavigatorOpen, onToggleNavigator }: ConversationSurfaceProps) {
  const sessions = useAgentGatewayStore((state) => state.sessions);
  const activeSessionId = useAgentGatewayStore((state) => state.activeSessionId);
  const agents = useAgentGatewayStore((state) => state.agents);
  const isSending = useAgentGatewayStore((state) => state.isSending);
  const currentTurnId = useAgentGatewayStore((state) => state.currentTurnId);
  const composerDraft = useAgentGatewayStore((state) => state.composerDraft);
  const composerImages = useAgentGatewayStore((state) => state.composerImages);
  const setComposerDraft = useAgentGatewayStore((state) => state.setComposerDraft);
  const setComposerImages = useAgentGatewayStore((state) => state.setComposerImages);
  const projects = useProjectWorkspaceStore((state) => state.projects);
  const selectProject = useProjectWorkspaceStore((state) => state.selectProject);
  const [agentId, setAgentId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const active = useMemo(() => sessions.find((session) => session.id === activeSessionId), [sessions, activeSessionId]);
  const projectId = active ? projectForSession(projects, active.id) : null;
  const project = projectId ? projects.find((item) => item.id === projectId) : undefined;
  const live = liveTurnSessionId(sessions, currentTurnId);
  const isBusyElsewhere = isSending && live !== null && live !== activeSessionId;
  const canInterrupt = conversationInterrupt(useAgentGatewayStore.getState()) === 'ok';

  const createConversation = () => {
    if (!projectId) {
      setNotice(startConversation(agentId || undefined));
      return;
    }
    const result = createProjectSession(handoffDeps, projectId, agentId || undefined);
    setNotice(result.status === 'created' ? null : CREATE_NOTICE[result.status]);
  };

  const openProject = () => {
    if (!projectId) return;
    selectProject(projectId);
    onSelectSurface('project');
  };

  const handleSubmit = async () => {
    const gw = useAgentGatewayStore.getState();
    const text = gw.composerDraft.trim();
    if (!text || !gw.activeSessionId || gw.activeSessionId !== activeSessionId) return;
    if (gw.isSending) {
      setNotice(BUSY_ELSEWHERE);
      return;
    }
    const ticket = composerTicket(gw, useProjectWorkspaceStore.getState());
    const sent = await gw.sendGatewayMessage(text, gw.composerImages);
    if (!sent) return;
    const after = useAgentGatewayStore.getState();
    if (shouldClearComposer(ticket, after, useProjectWorkspaceStore.getState())) {
      after.setComposerDraft('');
      after.setComposerImages([]);
    }
  };

  const handleCancel = () => {
    const gw = useAgentGatewayStore.getState();
    if (conversationInterrupt(gw) !== 'ok') {
      setNotice(INTERRUPT_REFUSED);
      return;
    }
    void gw.abortGateway();
  };

  const handleInject = (text: string) => {
    const gw = useAgentGatewayStore.getState();
    if (conversationInterrupt(gw) !== 'ok') {
      setNotice(INTERRUPT_REFUSED);
      queueMicrotask(() => useAgentGatewayStore.getState().setComposerDraft(text));
      return;
    }
    void gw.injectGateway(text);
  };

  return (
    <section className="v2-surface v2-conversation v2-project-chat" aria-labelledby="v2-conversation-title">
      <header className="v2-conversation__head">
        <div className="v2-conversation__heading">
          <p className="v2-conversation__crumb">{project ? project.name : 'Cuộc trò chuyện chưa thuộc dự án'}</p>
          <h1 id="v2-conversation-title" className="v2-surface__title">
            {active ? sessionLabel(active) : 'Cuộc trò chuyện'}
          </h1>
        </div>
        <div className="v2-conversation__actions">
          <label className="v2-project-chat__agent">
            <span className="v2-visually-hidden">Agent cho cuộc trò chuyện mới</span>
            <select className="v2-project-chat__select" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
              <option value="">Agent mặc định</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="v2-button v2-button--primary" onClick={createConversation} disabled={isSending}>
            <span aria-hidden="true">+</span> Cuộc trò chuyện mới
          </button>
          {projectId ? (
            <button type="button" className="v2-button" onClick={openProject}>
              Mở dự án
            </button>
          ) : null}
          <button type="button" className="v2-button v2-conversation__collapse" aria-pressed={!isNavigatorOpen} onClick={onToggleNavigator}>
            {isNavigatorOpen ? 'Thu gọn' : 'Hiện danh mục'}
          </button>
        </div>
      </header>

      {notice ? (
        <p className="v2-surface__status" role="status">
          {notice}
        </p>
      ) : null}
      {isBusyElsewhere ? (
        <p className="v2-surface__status" role="status">
          {BUSY_ELSEWHERE}
        </p>
      ) : null}

      {active ? (
        <div className="v2-project-chat__thread v2-conversation__thread">
          <ChatMessageList messages={active.messages as unknown as React.ComponentProps<typeof ChatMessageList>['messages']} />
          <ChatComposer
            value={composerDraft}
            images={composerImages}
            onChange={setComposerDraft}
            onImagesChange={setComposerImages}
            onSubmit={() => void handleSubmit()}
            isSubmitting={isSending}
            onCancel={canInterrupt ? handleCancel : undefined}
            onInject={canInterrupt ? handleInject : undefined}
          />
        </div>
      ) : (
        <p className="v2-empty">Chưa có cuộc trò chuyện nào đang mở. Bấm “+ Cuộc trò chuyện mới” để bắt đầu.</p>
      )}
    </section>
  );
}
