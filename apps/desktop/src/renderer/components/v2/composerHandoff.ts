import type { useAgentGatewayStore } from '../../store/agentGateway';
import { deriveRecentSessions, SESSION_IDS_MAX, type ProjectWorkspaceStore } from '../../store/projectWorkspace';
import type { AIProvider } from '../../types/agent-registry';

type GatewayState = ReturnType<typeof useAgentGatewayStore.getState>;

export type HandoffGateway = Pick<
  GatewayState,
  | 'hydrateFromDisk'
  | 'sessions'
  | 'activeSessionId'
  | 'isSending'
  | 'agents'
  | 'composerDraft'
  | 'switchSession'
  | 'newGatewaySession'
  | 'setComposerDraft'
  | 'applySessionModel'
>;

export type HandoffProjects = Pick<ProjectWorkspaceStore, 'projects' | 'assignSession' | 'focusSession'>;

export interface HandoffRequest {
  text: string;
  projectId?: string | null;
  agentId?: string;
  /** Model picked on Home; applied to the resolved session only at hand-off time. */
  model?: string;
  provider?: AIProvider;
}

export type HandoffResult =
  | { status: 'handed-off'; sessionId: string }
  /** The session was resolved but the requested model could not be applied; the draft stays on Home. */
  | { status: 'model-failed'; message?: string }
  | {
      status:
        | 'empty'
        | 'project-missing'
        | 'project-full'
        | 'busy'
        | 'draft-occupied'
        | 'no-session'
        | 'error'
        | 'in-flight'
        | 'cancelled';
    };

interface HandoffDeps {
  gateway: () => HandoffGateway;
  projects: () => HandoffProjects;
}

// Creates a session through the existing gateway action and returns its id only
// if a new one really appeared (newGatewaySession is a no-op for unknown agents).
function createSession(gateway: () => HandoffGateway, agentId: string | undefined): string | null {
  const before = gateway();
  const known = (id: string | undefined) => (id && before.agents.some((agent) => agent.id === id) ? id : undefined);
  const activeAgent = before.sessions.find((session) => session.id === before.activeSessionId)?.agentId;
  const target = known(agentId) ?? known(activeAgent) ?? before.agents[0]?.id;
  if (!target) return null;
  const previousIds = new Set(before.sessions.map((session) => session.id));
  before.newGatewaySession(target);
  const created = gateway().activeSessionId;
  return created && !previousIds.has(created) ? created : null;
}

type Resolved = { sessionId: string } | { status: 'no-session' | 'project-full' };

function fromId(sessionId: string | null): Resolved {
  return sessionId ? { sessionId } : { status: 'no-session' };
}

function resolveProjectSession(deps: HandoffDeps, projectId: string, agentId: string | undefined): Resolved {
  const gateway = deps.gateway();
  const project = deps.projects().projects.find((item) => item.id === projectId);
  // Only reuse a bound session of the chosen agent; otherwise a new one is created for it.
  const wanted = agentId && gateway.agents.some((agent) => agent.id === agentId) ? agentId : undefined;
  const bound = gateway.sessions.filter(
    (session) => project?.sessionIds.includes(session.id) && (!wanted || session.agentId === wanted),
  );
  const latest = deriveRecentSessions(bound, 1)[0];
  if (latest) {
    gateway.switchSession(latest.id);
    return { sessionId: latest.id };
  }
  // Refuse before creating, so a full project never leaves a stray loose session behind.
  if ((project?.sessionIds.length ?? 0) >= SESSION_IDS_MAX) return { status: 'project-full' };
  const created = createSession(deps.gateway, agentId);
  if (!created) return { status: 'no-session' };
  return deps.projects().assignSession(projectId, created) ? { sessionId: created } : { status: 'project-full' };
}

export type ProjectSessionResult =
  | { status: 'created'; sessionId: string }
  | { status: 'project-missing' | 'project-full' | 'busy' | 'no-session' };

/**
 * M3-B1 workspace "new session": creates a session for the chosen agent through
 * the existing gateway action and binds it to this project only. It never
 * reuses or reassigns a session, and refuses while a turn is sending.
 */
export function createProjectSession(deps: HandoffDeps, projectId: string, agentId: string | undefined): ProjectSessionResult {
  const project = deps.projects().projects.find((item) => item.id === projectId);
  if (!project || project.archived) return { status: 'project-missing' };
  if (project.sessionIds.length >= SESSION_IDS_MAX) return { status: 'project-full' };
  if (deps.gateway().isSending) return { status: 'busy' };
  const created = createSession(deps.gateway, agentId);
  if (!created) return { status: 'no-session' };
  if (!deps.projects().assignSession(projectId, created)) return { status: 'project-full' };
  deps.projects().focusSession(created);
  return { status: 'created', sessionId: created };
}

function resolveUnassignedSession(deps: HandoffDeps, agentId: string | undefined): Resolved {
  const gateway = deps.gateway();
  const assigned = new Set(deps.projects().projects.flatMap((project) => project.sessionIds));
  const active = gateway.sessions.find((session) => session.id === gateway.activeSessionId);
  if (active && !assigned.has(active.id) && (!agentId || active.agentId === agentId)) return { sessionId: active.id };
  return fromId(createSession(deps.gateway, agentId));
}

// Module-level so it outlives a HomeSurface remount: at most one handoff is
// pending app-wide, and a cancelled one can never mutate state after its hydrate.
const coordinator = { generation: 0, pending: null as number | null };

/** Invalidates the pending handoff (draft edited, surface unmounted, account switched). */
export function cancelPendingHandoff(): void {
  coordinator.generation += 1;
  coordinator.pending = null;
}

/**
 * Hands typed Home text to the chat composer of the right session. It waits for
 * persisted sessions first, never reuses a session bound to another project,
 * never overwrites a different unsent draft and never sends. The chosen
 * session's owner becomes the active project (none for a loose session).
 * When a model was picked on Home it is applied to exactly the resolved
 * session (through the store's connection gate) and verified before the draft
 * moves; a failed or cancelled application leaves the Home draft in place.
 */
export function createComposerHandoff(deps: HandoffDeps): (request: HandoffRequest) => Promise<HandoffResult> {
  const projectUsable = (projectId: string) => {
    const project = deps.projects().projects.find((item) => item.id === projectId);
    return Boolean(project && !project.archived);
  };

  return async ({ text, projectId, agentId, model, provider }) => {
    if (coordinator.pending !== null) return { status: 'in-flight' };
    if (!text.trim()) return { status: 'empty' };
    if (projectId && !projectUsable(projectId)) return { status: 'project-missing' };

    const ticket = ++coordinator.generation;
    coordinator.pending = ticket;
    try {
      await deps.gateway().hydrateFromDisk();
      if (coordinator.generation !== ticket) return { status: 'cancelled' };
      // The project may have been archived or removed while hydrate was pending.
      if (projectId && !projectUsable(projectId)) return { status: 'project-missing' };
      const gateway = deps.gateway();
      if (gateway.isSending) return { status: 'busy' };
      if (gateway.composerDraft.trim() && gateway.composerDraft !== text) return { status: 'draft-occupied' };

      const resolved = projectId
        ? resolveProjectSession(deps, projectId, agentId)
        : resolveUnassignedSession(deps, agentId);
      if (!('sessionId' in resolved)) return resolved;

      if (model && provider) {
        const applied = await deps.gateway().applySessionModel(resolved.sessionId, model, provider);
        // A supersede during the (possibly slow) connection probe must not move the draft.
        if (coordinator.generation !== ticket) return { status: 'cancelled' };
        if (!applied.ok) return { status: 'model-failed', message: applied.message };
        const target = deps.gateway().sessions.find((session) => session.id === resolved.sessionId);
        if (!target || target.model !== model || target.provider !== provider) return { status: 'model-failed' };
      }

      deps.gateway().setComposerDraft(text);
      deps.projects().focusSession(resolved.sessionId);
      return { status: 'handed-off', sessionId: resolved.sessionId };
    } catch {
      return coordinator.generation === ticket ? { status: 'error' } : { status: 'cancelled' };
    } finally {
      if (coordinator.pending === ticket) coordinator.pending = null;
    }
  };
}
