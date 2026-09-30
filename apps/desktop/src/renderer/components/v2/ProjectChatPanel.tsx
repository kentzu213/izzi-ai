import React, { useMemo, useState } from 'react';
import { useAgentGatewayStore } from '../../store/agentGateway';
import { useProjectWorkspaceStore, type ProjectMeta } from '../../store/projectWorkspace';
import { ChatComposer } from '../ChatComposer';
import { ChatMessageList } from '../ChatMessageList';
import { createProjectSession, type ProjectSessionResult } from './composerHandoff';
import { projectSessions } from './projectWorkspaceData';
import { sessionLabel } from './sessionLabel';
import '../../styles/agent-gateway.css';
import '../../styles/agent-workspace.css';

/*
 * Project Chat tab (M3-B1). It reuses the existing gateway chat engine and the
 * legacy ChatMessageList/ChatComposer; it only scopes them to this project:
 * - selection lists only sessions in project.sessionIds;
 * - creation goes through createProjectSession (existing newGatewaySession,
 *   then an explicit assign to this project);
 * - send is allowed only while the gateway's active session belongs to it;
 * - Stop/Inject act only on a live turn of the viewed session in the open
 *   project, re-checked against both stores at click time;
 * - after a send, only the exact draft/images that were sent are cleared.
 */

type GatewayState = ReturnType<typeof useAgentGatewayStore.getState>;
type WorkspaceState = ReturnType<typeof useProjectWorkspaceStore.getState>;
type GatewayView = Pick<GatewayState, 'isSending' | 'currentTurnId' | 'activeSessionId' | 'sessions' | 'agents'>;
type WorkspaceView = Pick<WorkspaceState, 'projects' | 'activeProjectId'>;

/** 'ok': interruptible here; 'here': live here but the runtime cannot be interrupted. */
export type InterruptState = 'ok' | 'here' | 'elsewhere' | 'none';

export interface ComposerTicket {
  draft: string;
  images: string[];
  sessionId: string | null;
  projectId: string | null;
  owner: string | null;
}

const INTERRUPT_REFUSED = 'Lượt agent đang chạy thuộc phiên hoặc dự án khác; không thể dừng hoặc chèn từ đây.';
const BUSY_ELSEWHERE = 'Một lượt agent đang chạy ở phiên hoặc dự án khác; chờ lượt đó xong trước khi gửi.';

/** The session whose streaming reply is the live turn (the reply id is the turn id). */
export function liveTurnSessionId(sessions: GatewayState['sessions'], currentTurnId: string | null): string | null {
  if (!currentTurnId) return null;
  return sessions.find((session) => session.messages.some((message) => message.id === currentTurnId))?.id ?? null;
}

export function interruptState(gw: GatewayView, pw: WorkspaceView, projectId: string): InterruptState {
  if (!gw.isSending) return 'none';
  const live = liveTurnSessionId(gw.sessions, gw.currentTurnId);
  const owner = pw.projects.find((item) => item.id === projectId);
  const isHere =
    live !== null &&
    live === gw.activeSessionId &&
    pw.activeProjectId === projectId &&
    !!owner &&
    !owner.archived &&
    owner.sessionIds.includes(live);
  if (!isHere) return 'elsewhere';
  const agentId = gw.sessions.find((session) => session.id === live)?.agentId;
  return gw.agents.find((agent) => agent.id === agentId)?.runtime === 'izzi' ? 'here' : 'ok';
}

/** Re-reads both stores at click time; acts only when the live turn is interruptible here. */
export function interruptTurn(projectId: string, kind: 'stop' | 'inject', text = ''): boolean {
  const gw = useAgentGatewayStore.getState();
  if (interruptState(gw, useProjectWorkspaceStore.getState(), projectId) !== 'ok') return false;
  if (kind === 'stop') void gw.abortGateway();
  else void gw.injectGateway(text);
  return true;
}

export function composerTicket(gw: GatewayState, pw: WorkspaceView): ComposerTicket {
  return {
    draft: gw.composerDraft,
    images: gw.composerImages,
    sessionId: gw.activeSessionId,
    projectId: pw.activeProjectId,
    owner: gw.persistOwnerId,
  };
}

/** Clear only if the composer still holds exactly what was sent, in the same account/project/session. */
export function shouldClearComposer(ticket: ComposerTicket, gw: GatewayState, pw: WorkspaceView): boolean {
  const sameImages =
    gw.composerImages === ticket.images ||
    (gw.composerImages.length === ticket.images.length &&
      gw.composerImages.every((image, index) => image === ticket.images[index]));
  return (
    sameImages &&
    gw.composerDraft === ticket.draft &&
    gw.activeSessionId === ticket.sessionId &&
    pw.activeProjectId === ticket.projectId &&
    gw.persistOwnerId === ticket.owner
  );
}

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

export function ProjectChatPanel({ project }: { project: ProjectMeta }) {
  const sessions = useAgentGatewayStore((state) => state.sessions);
  const activeSessionId = useAgentGatewayStore((state) => state.activeSessionId);
  const agents = useAgentGatewayStore((state) => state.agents);
  const isSending = useAgentGatewayStore((state) => state.isSending);
  const currentTurnId = useAgentGatewayStore((state) => state.currentTurnId);
  const composerDraft = useAgentGatewayStore((state) => state.composerDraft);
  const composerImages = useAgentGatewayStore((state) => state.composerImages);
  const switchSession = useAgentGatewayStore((state) => state.switchSession);
  const sendGatewayMessage = useAgentGatewayStore((state) => state.sendGatewayMessage);
  const setComposerDraft = useAgentGatewayStore((state) => state.setComposerDraft);
  const setComposerImages = useAgentGatewayStore((state) => state.setComposerImages);
  const projects = useProjectWorkspaceStore((state) => state.projects);
  const activeProjectId = useProjectWorkspaceStore((state) => state.activeProjectId);
  const focusSession = useProjectWorkspaceStore((state) => state.focusSession);
  const [agentId, setAgentId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const owned = useMemo(() => projectSessions(sessions, project), [sessions, project]);
  const active = owned.find((session) => session.id === activeSessionId) ?? null;
  const interrupt = interruptState(
    { isSending, currentTurnId, activeSessionId, sessions, agents },
    { projects, activeProjectId },
    project.id,
  );
  const canInterrupt = interrupt === 'ok';

  function handleCancel() {
    if (!interruptTurn(project.id, 'stop')) setNotice(INTERRUPT_REFUSED);
  }

  function handleInject(text: string) {
    if (interruptTurn(project.id, 'inject', text)) return;
    setNotice(INTERRUPT_REFUSED);
    // ChatComposer clears its draft right after onInject; keep the refused note.
    queueMicrotask(() => useAgentGatewayStore.getState().setComposerDraft(text));
  }

  function openSession(sessionId: string) {
    switchSession(sessionId);
    focusSession(sessionId);
    setNotice(null);
  }

  function newSession() {
    const result = createProjectSession(handoffDeps, project.id, agentId || undefined);
    setNotice(result.status === 'created' ? null : CREATE_NOTICE[result.status]);
  }

  async function handleSubmit() {
    const text = composerDraft.trim();
    if (!text && composerImages.length === 0) return;
    // Re-check at send time: the active session may have changed elsewhere.
    const current = useAgentGatewayStore.getState().activeSessionId;
    const owner = useProjectWorkspaceStore.getState().projects.find((item) => item.id === project.id);
    if (!current || !owner || owner.archived || !owner.sessionIds.includes(current)) {
      setNotice('Chọn một phiên của dự án này trước khi gửi.');
      return;
    }
    const ticket = composerTicket(useAgentGatewayStore.getState(), useProjectWorkspaceStore.getState());
    const sent = await sendGatewayMessage(text, ticket.images);
    // The user may have edited the draft or switched session/project/account meanwhile.
    if (sent && shouldClearComposer(ticket, useAgentGatewayStore.getState(), useProjectWorkspaceStore.getState())) {
      setComposerDraft('');
      setComposerImages([]);
    }
  }

  return (
    <div className="v2-project-chat">
      <div className="v2-project-chat__bar">
        <label className="v2-project-chat__agent">
          <span className="v2-visually-hidden">Agent cho phiên mới</span>
          <select className="v2-project-chat__select" value={agentId} onChange={(event) => setAgentId(event.target.value)}>
            <option value="">Agent mặc định</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="v2-button v2-button--primary" onClick={newSession} disabled={isSending}>
          Phiên mới trong dự án
        </button>
      </div>
      {notice && (
        <p className="v2-surface__status" role="status">
          {notice}
        </p>
      )}
      {interrupt === 'elsewhere' && (
        <p className="v2-surface__status" role="status">
          {BUSY_ELSEWHERE}
        </p>
      )}
      {owned.length === 0 ? (
        <p className="v2-empty">Dự án chưa có phiên nào. Tạo phiên mới hoặc gán phiên từ trang Dự án.</p>
      ) : (
        <ul className="v2-session-list" aria-label="Phiên của dự án">
          {owned.map((session) => (
            <li key={session.id} className="v2-session-row">
              <button
                type="button"
                className="v2-session-item"
                aria-current={session.id === active?.id ? 'true' : undefined}
                onClick={() => openSession(session.id)}
              >
                {sessionLabel(session)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {active ? (
        <div className="v2-project-chat__thread">
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
        owned.length > 0 && <p className="v2-empty">Chọn một phiên của dự án để xem và gửi tin nhắn.</p>
      )}
    </div>
  );
}
