import { create } from 'zustand';
import type { AgentChatSession } from '../types/agent-registry';

/*
 * Local project metadata for the V2 shell (spec/04 Screen A/B). Only names,
 * dates and flags are stored — never prompts, messages, tokens or keys.
 * Conversations stay in the gateway store; a project only lists session ids
 * that the user explicitly assigned to it.
 */

export const PROJECT_WORKSPACE_STORAGE_KEY = 'izziV2ProjectWorkspace';
export const PROJECT_WORKSPACE_VERSION = 1;
export const PROJECT_NAME_MAX = 80;
export const PROJECT_DESCRIPTION_MAX = 500;
export const SESSION_IDS_MAX = 500;
const USER_ID_MAX = 128;

export const PROJECT_SURFACES = ['overview', 'chat', 'runs', 'approvals', 'files', 'tasks', 'activity'] as const;
export type ProjectSurface = (typeof PROJECT_SURFACES)[number];
export const DEFAULT_PROJECT_SURFACE: ProjectSurface = 'overview';

export interface ProjectMeta {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  archived: boolean;
  activeSurface: ProjectSurface;
  sessionIds: string[];
}

export interface ProjectWorkspaceState {
  projects: ProjectMeta[];
  activeProjectId: string | null;
}

export type ProjectFilter = 'active' | 'pinned' | 'archived';

export type ProjectWorkspaceAction =
  | { type: 'create'; id: string; name: string; now: string }
  | { type: 'select'; id: string | null }
  | { type: 'togglePin'; id: string; now: string }
  | { type: 'archive'; id: string; archived: boolean; now: string }
  | { type: 'assignSession'; id: string; sessionId: string; now: string }
  | { type: 'unassignSession'; sessionId: string; now: string }
  | { type: 'setSurface'; id: string; surface: ProjectSurface; now: string };

export interface ProjectWorkspaceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function emptyState(): ProjectWorkspaceState {
  return { projects: [], activeProjectId: null };
}

function isProjectSurface(value: unknown): value is ProjectSurface {
  return typeof value === 'string' && (PROJECT_SURFACES as readonly string[]).includes(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value)) && /^\d{4}-\d{2}-\d{2}T/.test(value);
}

function updateProject(
  state: ProjectWorkspaceState,
  id: string,
  change: (project: ProjectMeta) => ProjectMeta,
): ProjectWorkspaceState {
  if (!state.projects.some((project) => project.id === id)) return state;
  return {
    ...state,
    projects: state.projects.map((project) => (project.id === id ? change(project) : project)),
  };
}

export function projectWorkspaceReducer(
  state: ProjectWorkspaceState,
  action: ProjectWorkspaceAction,
): ProjectWorkspaceState {
  switch (action.type) {
    case 'create': {
      const name = action.name.trim().slice(0, PROJECT_NAME_MAX);
      if (!name || !action.id || state.projects.some((project) => project.id === action.id)) return state;
      const project: ProjectMeta = {
        id: action.id,
        name,
        description: '',
        createdAt: action.now,
        updatedAt: action.now,
        pinned: false,
        archived: false,
        activeSurface: DEFAULT_PROJECT_SURFACE,
        sessionIds: [],
      };
      return { projects: [...state.projects, project], activeProjectId: project.id };
    }
    case 'select': {
      if (action.id === state.activeProjectId) return state;
      if (action.id === null) return { ...state, activeProjectId: null };
      const target = state.projects.find((project) => project.id === action.id);
      return target && !target.archived ? { ...state, activeProjectId: target.id } : state;
    }
    case 'togglePin':
      return updateProject(state, action.id, (project) => ({ ...project, pinned: !project.pinned, updatedAt: action.now }));
    case 'archive': {
      const next = updateProject(state, action.id, (project) => ({ ...project, archived: action.archived, updatedAt: action.now }));
      return action.archived && next.activeProjectId === action.id ? { ...next, activeProjectId: null } : next;
    }
    case 'assignSession': {
      const target = state.projects.find((project) => project.id === action.id);
      if (!target || !action.sessionId || target.sessionIds.includes(action.sessionId)) return state;
      // Same cap as reload (sanitizeProject), so an accepted assignment is never dropped later.
      if (target.sessionIds.length >= SESSION_IDS_MAX) return state;
      return {
        ...state,
        projects: state.projects.map((project) => {
          if (project.id === action.id) {
            return { ...project, sessionIds: [...project.sessionIds, action.sessionId], updatedAt: action.now };
          }
          return project.sessionIds.includes(action.sessionId)
            ? { ...project, sessionIds: project.sessionIds.filter((id) => id !== action.sessionId), updatedAt: action.now }
            : project;
        }),
      };
    }
    case 'unassignSession':
      if (!state.projects.some((project) => project.sessionIds.includes(action.sessionId))) return state;
      return {
        ...state,
        projects: state.projects.map((project) =>
          project.sessionIds.includes(action.sessionId)
            ? { ...project, sessionIds: project.sessionIds.filter((id) => id !== action.sessionId), updatedAt: action.now }
            : project,
        ),
      };
    case 'setSurface':
      if (!isProjectSurface(action.surface)) return state;
      return updateProject(state, action.id, (project) => ({ ...project, activeSurface: action.surface, updatedAt: action.now }));
    default:
      return state;
  }
}

export function filterProjects(projects: readonly ProjectMeta[], filter: ProjectFilter, query: string): ProjectMeta[] {
  const needle = query.trim().toLocaleLowerCase();
  return projects
    .filter((project) => {
      if (filter === 'archived') return project.archived;
      if (project.archived) return false;
      return filter === 'pinned' ? project.pinned : true;
    })
    .filter(
      (project) =>
        !needle ||
        project.name.toLocaleLowerCase().includes(needle) ||
        project.description.toLocaleLowerCase().includes(needle),
    )
    .sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

function lastActivity(session: AgentChatSession): string {
  return session.messages[session.messages.length - 1]?.createdAt ?? session.createdAt;
}

export function deriveRecentSessions(sessions: readonly AgentChatSession[], limit: number): AgentChatSession[] {
  return [...sessions].sort((a, b) => lastActivity(b).localeCompare(lastActivity(a))).slice(0, Math.max(0, limit));
}

export function deriveUnassignedSessions(
  sessions: readonly AgentChatSession[],
  projects: readonly ProjectMeta[],
): AgentChatSession[] {
  const assigned = new Set(projects.flatMap((project) => project.sessionIds));
  return deriveRecentSessions(sessions, sessions.length).filter((session) => !assigned.has(session.id));
}

// Whitelist: rebuilds each project from known fields only, so stray keys
// (tokens, keys, prompts) can never reach storage or come back from it.
function sanitizeProject(value: unknown): ProjectMeta | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !raw.id || raw.id.length > 128) return null;
  if (typeof raw.name !== 'string' || !raw.name.trim()) return null;
  if (!isIsoDate(raw.createdAt) || !isIsoDate(raw.updatedAt)) return null;
  const sessionIds = Array.isArray(raw.sessionIds)
    ? [...new Set(raw.sessionIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128))]
    : [];
  if (sessionIds.length > SESSION_IDS_MAX) {
    console.warn(
      `[projectWorkspace] Project ${raw.id} has ${sessionIds.length} sessions; keeping the first ${SESSION_IDS_MAX}.`,
    );
  }
  return {
    id: raw.id,
    name: raw.name.trim().slice(0, PROJECT_NAME_MAX),
    description: typeof raw.description === 'string' ? raw.description.slice(0, PROJECT_DESCRIPTION_MAX) : '',
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    pinned: raw.pinned === true,
    archived: raw.archived === true,
    activeSurface: isProjectSurface(raw.activeSurface) ? raw.activeSurface : DEFAULT_PROJECT_SURFACE,
    sessionIds: sessionIds.slice(0, SESSION_IDS_MAX),
  };
}

function sanitizeState(projectsValue: unknown, activeValue: unknown): ProjectWorkspaceState {
  const projects: ProjectMeta[] = [];
  const seen = new Set<string>();
  // A session belongs to at most one project; on conflict the first project keeps it.
  const claimed = new Set<string>();
  for (const entry of Array.isArray(projectsValue) ? projectsValue : []) {
    const project = sanitizeProject(entry);
    if (project && !seen.has(project.id)) {
      seen.add(project.id);
      const sessionIds = project.sessionIds.filter((id) => !claimed.has(id));
      sessionIds.forEach((id) => claimed.add(id));
      projects.push({ ...project, sessionIds });
    }
  }
  const active = projects.find((project) => project.id === activeValue && !project.archived);
  return { projects, activeProjectId: active ? active.id : null };
}

export function parseProjectWorkspace(raw: string | null): ProjectWorkspaceState {
  if (!raw) return emptyState();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return emptyState();
    const payload = parsed as Record<string, unknown>;
    if (payload.version !== PROJECT_WORKSPACE_VERSION) return emptyState();
    return sanitizeState(payload.projects, payload.activeProjectId);
  } catch {
    return emptyState();
  }
}

export function serializeProjectWorkspace(state: ProjectWorkspaceState): string {
  const clean = sanitizeState(state.projects, state.activeProjectId);
  return JSON.stringify({ version: PROJECT_WORKSPACE_VERSION, ...clean });
}

/** Stable account id from main (`User.id`), or null when it is missing or unusable. */
export function normalizeProjectUserId(userId: unknown): string | null {
  if (typeof userId !== 'string') return null;
  const trimmed = userId.trim();
  return trimmed && trimmed.length <= USER_ID_MAX ? trimmed : null;
}

/**
 * Per-account key. The bare legacy key has no known owner, so the app store
 * never reads it for a signed-in user (it would leak one account's projects
 * into another's).
 */
export function projectWorkspaceStorageKey(userId?: string): string {
  return userId === undefined ? PROJECT_WORKSPACE_STORAGE_KEY : `${PROJECT_WORKSPACE_STORAGE_KEY}:${userId}`;
}

export function loadProjectWorkspace(storage: ProjectWorkspaceStorage | null, userId?: string): ProjectWorkspaceState {
  if (!storage) return emptyState();
  try {
    return parseProjectWorkspace(storage.getItem(projectWorkspaceStorageKey(userId)));
  } catch (error) {
    console.warn('[projectWorkspace] Could not read saved projects; starting empty.', error);
    return emptyState();
  }
}

export function saveProjectWorkspace(
  state: ProjectWorkspaceState,
  storage: ProjectWorkspaceStorage | null,
  userId?: string,
): void {
  if (!storage) return;
  try {
    storage.setItem(projectWorkspaceStorageKey(userId), serializeProjectWorkspace(state));
  } catch (error) {
    // Metadata stays in memory for this session; nothing else depends on it.
    console.warn('[projectWorkspace] Could not save projects.', error);
  }
}

/** The open project that owns `sessionId`, or null when it is unassigned (or its project is archived). */
export function projectForSession(projects: readonly ProjectMeta[], sessionId: string): string | null {
  const owner = projects.find((project) => project.sessionIds.includes(sessionId));
  return owner && !owner.archived ? owner.id : null;
}

export interface ProjectWorkspaceStore extends ProjectWorkspaceState {
  createProject: (name: string) => string | null;
  selectProject: (id: string | null) => void;
  /** Makes the project context follow the session: its owner, or none when unassigned. */
  focusSession: (sessionId: string) => void;
  togglePin: (id: string) => void;
  archiveProject: (id: string, archived: boolean) => void;
  /** False when the project is missing or already holds SESSION_IDS_MAX sessions. */
  assignSession: (id: string, sessionId: string) => boolean;
  unassignSession: (sessionId: string) => void;
  setSurface: (id: string, surface: ProjectSurface) => void;
  /** Switches to another account's metadata; null (logout) clears it from memory. */
  setIdentity: (userId: string | null) => void;
}

interface ProjectWorkspaceStoreOptions {
  storage: ProjectWorkspaceStorage | null;
  /** Without an identity nothing is read from or written to storage. */
  userId?: string | null;
  now?: () => string;
  newId?: () => string;
}

function defaultId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `project-${crypto.randomUUID()}`;
  }
  return `project-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createProjectWorkspaceStore({
  storage,
  userId = null,
  now = () => new Date().toISOString(),
  newId = defaultId,
}: ProjectWorkspaceStoreOptions) {
  let identity = normalizeProjectUserId(userId);
  const loadFor = (owner: string | null): ProjectWorkspaceState =>
    owner ? loadProjectWorkspace(storage, owner) : emptyState();

  return create<ProjectWorkspaceStore>()((set, get) => {
    const dispatch = (action: ProjectWorkspaceAction) => {
      const current: ProjectWorkspaceState = { projects: get().projects, activeProjectId: get().activeProjectId };
      const next = projectWorkspaceReducer(current, action);
      if (next === current) return false;
      set(next);
      if (identity) saveProjectWorkspace(next, storage, identity);
      return true;
    };

    return {
      ...loadFor(identity),
      createProject: (name) => {
        const id = newId();
        return dispatch({ type: 'create', id, name, now: now() }) ? id : null;
      },
      selectProject: (id) => void dispatch({ type: 'select', id }),
      focusSession: (sessionId) => void dispatch({ type: 'select', id: projectForSession(get().projects, sessionId) }),
      togglePin: (id) => void dispatch({ type: 'togglePin', id, now: now() }),
      archiveProject: (id, archived) => void dispatch({ type: 'archive', id, archived, now: now() }),
      assignSession: (id, sessionId) =>
        dispatch({ type: 'assignSession', id, sessionId, now: now() }) || projectForSession(get().projects, sessionId) === id,
      unassignSession: (sessionId) => void dispatch({ type: 'unassignSession', sessionId, now: now() }),
      setSurface: (id, surface) => void dispatch({ type: 'setSurface', id, surface, now: now() }),
      setIdentity: (nextUserId) => {
        const next = normalizeProjectUserId(nextUserId);
        if (next === identity) return;
        identity = next;
        set(loadFor(next));
      },
    };
  });
}

function browserStorage(): ProjectWorkspaceStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export const useProjectWorkspaceStore = createProjectWorkspaceStore({ storage: browserStorage() });
