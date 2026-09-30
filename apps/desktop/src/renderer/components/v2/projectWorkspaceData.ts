import type { AgentChatSession, AgentStep, GatewayChatMessage } from '../../types/agent-registry';
import type { ProjectMeta } from '../../store/projectWorkspace';

/*
 * Izzi AI V2 — M3-B1 project workspace data. Pure derivations over the real
 * gateway sessions explicitly assigned to one project (ProjectMeta.sessionIds).
 * Nothing here invents records: a "turn" is one assistant message of the
 * existing chat engine plus its live steps, not a durable AgentRun.
 */

export interface ProjectTurn {
  /** The assistant message id, which is the gateway turn id. */
  id: string;
  sessionId: string;
  agentName: string;
  prompt: string;
  state: GatewayChatMessage['state'];
  createdAt: string;
  steps: AgentStep[];
}

export interface AttentionItem {
  id: string;
  sessionId: string;
  agentName: string;
  label: string;
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  sessionId: string;
  kind: 'message' | 'step';
  label: string;
  detail: string;
  createdAt: string;
}

/** Only sessions whose id is assigned to this project, in assignment order. */
export function projectSessions(sessions: AgentChatSession[], project: Pick<ProjectMeta, 'sessionIds'>): AgentChatSession[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  return project.sessionIds.flatMap((id) => byId.get(id) ?? []);
}

const newestFirst = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);

/** Every assistant message as one agent turn, with the user prompt that opened it. */
export function agentTurns(sessions: AgentChatSession[]): ProjectTurn[] {
  return sessions
    .flatMap((session) =>
      session.messages.flatMap((message, index) => {
        if (message.role !== 'assistant') return [];
        const prompt = session.messages
          .slice(0, index)
          .reverse()
          .find((candidate) => candidate.role === 'user');
        return [
          {
            id: message.id,
            sessionId: session.id,
            agentName: session.agentName,
            prompt: prompt?.content ?? '',
            state: message.state,
            createdAt: message.createdAt,
            steps: message.steps ?? [],
          },
        ];
      }),
    )
    .sort(newestFirst);
}

/** Turns that failed or have a failed step. */
export function needsAttention(sessions: AgentChatSession[]): AttentionItem[] {
  return agentTurns(sessions).flatMap((turn) => {
    const failedSteps = turn.steps.filter((step) => step.status === 'error');
    if (turn.state !== 'error' && failedSteps.length === 0) return [];
    const label = turn.state === 'error' ? 'Lượt agent gặp lỗi' : `Bước lỗi: ${failedSteps[0].label}`;
    return [{ id: turn.id, sessionId: turn.sessionId, agentName: turn.agentName, label, createdAt: turn.createdAt }];
  });
}

/** Turns still pending or streaming, or with a running step. */
export function runningNow(sessions: AgentChatSession[]): ProjectTurn[] {
  return agentTurns(sessions).filter(
    (turn) =>
      turn.state === 'pending' || turn.state === 'streaming' || turn.steps.some((step) => step.status === 'running'),
  );
}

/** The latest messages across the project's sessions, newest first. */
export function recentContext(sessions: AgentChatSession[], limit: number): GatewayChatMessage[] {
  return sessions
    .flatMap((session) => session.messages)
    .sort(newestFirst)
    .slice(0, limit);
}

const ROLE_LABEL: Record<string, string> = { user: 'Bạn', assistant: 'Agent', system: 'System' };

/**
 * Messages and steps as a timeline, newest first. Steps carry no timestamp of
 * their own, so they are placed at their turn's time, after its message.
 */
export function activityFeed(sessions: AgentChatSession[], limit: number): ActivityItem[] {
  const items = sessions.flatMap((session) =>
    session.messages.flatMap((message): ActivityItem[] => [
      ...(message.steps ?? []).map((step) => ({
        id: `${message.id}:${step.id}`,
        sessionId: session.id,
        kind: 'step' as const,
        label: `${step.kind === 'tool' ? 'Công cụ' : 'Tiến trình'} · ${step.status}`,
        detail: step.label,
        createdAt: message.createdAt,
      })),
      {
        id: message.id,
        sessionId: session.id,
        kind: 'message',
        label: `${ROLE_LABEL[message.role] ?? message.role} · ${session.agentName}`,
        detail: message.content,
        createdAt: message.createdAt,
      },
    ]),
  );
  // Stable sort keeps a turn's steps right after its message at equal times.
  return items.sort(newestFirst).slice(0, limit);
}
