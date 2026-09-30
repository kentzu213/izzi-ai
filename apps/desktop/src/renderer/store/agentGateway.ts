/**
 * Agent Gateway Store — Zustand state for multi-agent chat gateway
 *
 * Manages chat sessions across multiple agents, model selection,
 * and agent status tracking.
 */
import { create } from 'zustand';
import type {
  AgentChatSession,
  AIProvider,
  ExternalAgent,
  ExternalAgentStatus,
  GatewayChatMessage,
} from '../types/agent-registry';
import { TOP_AGENTS } from '../types/agent-registry';
import { connectionActionForProvider, deriveEndpointLabel } from '../types/model-catalog';
import type { AgentTurnEvent } from '../../shared/agent-turn-events';
import { sanitizeStoredSessions, capForPersist, pickActiveId } from './gatewayPersist';
import { agentReplyErrorMessage, customEndpointErrorMessage } from './agentGateway-errors';
import { requiresCustomProviderRoute, shouldUseIzziApiRoute } from './agentGateway-routing';
import {
  LOCAL_COCKPIT_BASE_URL,
  LOCAL_COCKPIT_LABEL,
  LOCAL_COCKPIT_MODEL,
  LOCAL_COCKPIT_REASONING_EFFORT,
} from '../../shared/local-cockpit';

// Every call carries the owner the renderer believes is current; main re-checks
// it against its trusted user and fails closed on mismatch.
interface GatewayPersistApi {
  list?: (ownerId: string) => Promise<unknown[]>;
  save?: (ownerId: string, session: unknown) => Promise<unknown>;
  delete?: (ownerId: string, id: string) => Promise<unknown>;
}

const PERSIST_OWNER_MAX = 200;

function normalizePersistOwner(userId: unknown): string | null {
  return typeof userId === 'string' && userId.length > 0 && userId.length <= PERSIST_OWNER_MAX ? userId : null;
}

/** Access the main-process gateway persistence bridge (absent in browser dev). */
function gatewayPersistApi(): GatewayPersistApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { electronAPI?: { gatewaySessions?: GatewayPersistApi } }).electronAPI
    ?.gatewaySessions;
}

/** Renderer-safe notice for a failed connection probe (never claims success). */
function probeFailureNotice(message?: string): string {
  const detail = typeof message === 'string' && message.trim() ? message.trim() : 'không kết nối được endpoint';
  return `Kết nối model thất bại: ${detail}. Kết nối chưa được bật.`;
}

type ModelConnectionResult = { ok: boolean; message?: string };

/**
 * Shared connection step for picking a model (setActiveModel / applySessionModel).
 * Runs the custom-provider probe gate for 'custom' models and turns the custom
 * connection off for Izzi-hosted ones. Never touches any session: callers
 * update the session only when this reports ok. Failures are surfaced on
 * `errorMessage` and returned so a caller can show them in place.
 */
async function connectModelForProvider(
  model: string,
  provider: AIProvider,
  setError: (message: string | null) => void,
): Promise<ModelConnectionResult> {
  const fail = (message?: string): ModelConnectionResult => {
    const notice = probeFailureNotice(message);
    setError(notice);
    return { ok: false, message: notice };
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const api = typeof window === 'undefined' ? undefined : (window as any).electronAPI?.customProvider;
  const action = connectionActionForProvider(provider);
  if (action === 'enable-custom') {
    // Picking a custom model must never enable or reroute a broken endpoint:
    // point the connection at the model, prove it answers with the stored key,
    // and only then enable it. A failed probe restores the previous config and
    // leaves both the enabled flag and the session untouched.
    if (!api?.getConfig || !api?.saveConfig || !api?.testConnection || !api?.setEnabled) {
      return fail('thiếu cầu nối app để kiểm tra kết nối');
    }
    let previous: { baseUrl: string; authType: string; selectedModel?: string } | null = null;
    try {
      // The connection may already be enabled from an earlier config: turn it
      // off before the new model is saved so nothing routes through an
      // unproven endpoint while the probe runs.
      await api.setEnabled(false);
      const c = await api.getConfig();
      previous = c?.config ?? null;
      await api.saveConfig({
        baseUrl: previous?.baseUrl || LOCAL_COCKPIT_BASE_URL,
        authType: previous?.authType || 'bearer',
        selectedModel: model,
      });
      const probe = await api.testConnection();
      if (!probe?.ok) {
        if (previous) await api.saveConfig(previous);
        return fail(probe?.message);
      }
      await api.setEnabled(true);
      setError(null);
    } catch (err) {
      try {
        if (previous) await api.saveConfig(previous);
      } catch {
        /* best-effort restore — the probe already failed closed */
      }
      return fail(err instanceof Error ? err.message : undefined);
    }
  } else if (action === 'disable-custom' && api?.setEnabled) {
    // An Izzi-hosted model was picked (SmartRouter, Grok, or Sol): turn the
    // custom connection off. sendGatewayMessage then uses the authenticated
    // main-process Izzi bridge for both native and generic agents.
    try {
      await api.setEnabled(false);
    } catch {
      /* best-effort: still reflect the pick on the session */
    }
  }
  return { ok: true };
}

function createLocalId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface AgentGatewayState {
  // Agent registry
  agents: ExternalAgent[];

  // Chat sessions (one per active agent tab)
  sessions: AgentChatSession[];
  activeSessionId: string | null;

  // UI state
  isSending: boolean;
  /** turnId of the in-flight agent turn — powers the Stop button + mid-turn steering. */
  currentTurnId: string | null;
  /** Composer draft + attachments — kept in the store so they survive tab switches. */
  composerDraft: string;
  composerImages: string[];
  errorMessage: string | null;
  /** Session id currently being reconfigured (e.g. reasoning effort → container restart). */
  reconfiguringSessionId: string | null;

  /** True once chat history has been restored from disk (guards a double-load). */
  hydrated: boolean;
  /** Account whose chat history is loaded/persisted; null = signed out (RAM only). */
  persistOwnerId: string | null;

  /** Models discovered live from the enabled custom connection (codex-lb /v1/models). */
  availableModels: string[];
  availableModelsState: 'idle' | 'loading' | 'ok' | 'error';
  /** Human label for the local model group, derived from the connection base URL. */
  availableModelsLabel: string;

  // Actions — Agent management
  updateAgentStatus: (agentId: string, status: ExternalAgentStatus, version?: string) => void;
  refreshAgentStatuses: () => Promise<void>;

  /** Restore persisted chat sessions from the main-process store (once). */
  hydrateFromDisk: () => Promise<void>;
  /**
   * Bind chat history to the signed-in account. A change clears this account's
   * in-memory sessions (never deleting anything on disk) and rehydrates the new one.
   */
  setGatewayIdentity: (userId: unknown) => void;

  /** Apply a live turn event (content/reasoning/step) to its assistant message. */
  applyStreamEvent: (event: AgentTurnEvent) => void;

  // Actions — Chat gateway
  openAgentChat: (agentId: string) => void;
  closeAgentChat: (sessionId: string) => void;
  switchSession: (sessionId: string) => void;
  sendGatewayMessage: (text: string, images?: string[]) => Promise<boolean>;
  /** Stop the in-flight agent turn (Stop button) — keeps the partial answer. */
  abortGateway: () => Promise<void>;
  /** Inject a steering message into the running agent turn (adjust mid-work). */
  injectGateway: (text: string) => Promise<boolean>;
  /** Composer draft setters (persisted state above). */
  setComposerDraft: (value: string) => void;
  setComposerImages: (value: string[] | ((prev: string[]) => string[])) => void;
  newGatewaySession: (agentId: string) => void;
  setSessionModel: (sessionId: string, model: string, provider: AIProvider) => void;
  /** Refresh the live model list from the enabled custom connection (/v1/models). */
  refreshAvailableModels: () => Promise<void>;
  /**
   * Pick the active model: a 'custom' (codex-lb/local) model points+enables the
   * custom connection at it; an 'izzi' model disables it so generic agents use
   * izzi. Also reflects the pick on the active session. izzi persona agents route
   * izzi regardless (handled by sendGatewayMessage).
   */
  setActiveModel: (model: string, provider: AIProvider) => Promise<void>;
  /**
   * Same connection handling as setActiveModel, but for one explicit session
   * (the Home composer hand-off targets a session that may not be active).
   * The session is updated only after the connection step succeeded; a failed
   * probe leaves it untouched and reports a user-facing message.
   */
  applySessionModel: (
    sessionId: string,
    model: string,
    provider: AIProvider,
  ) => Promise<{ ok: boolean; message?: string }>;
  /**
   * Enable the custom connection and reroute sessions to it — but only after an
   * authenticated probe succeeds. A failed probe changes nothing and reports why.
   */
  enableCustomRouting: (model: string) => Promise<{ ok: boolean; message?: string }>;
  /** Route every non-Izzi agent session through the explicitly enabled local connection. */
  routeExternalSessionsToCustom: (model: string) => void;
  /** Change a Docker agent's reasoning effort (rewrites config + restarts container). */
  setReasoningEffort: (effort: string) => Promise<boolean>;

  // Getters
  activeSession: () => AgentChatSession | null;
  getAgentById: (agentId: string) => ExternalAgent | undefined;
}

// Bumped on every account change. Async work captures it before awaiting and
// drops its result when it moved, so A -> logout -> A cannot accept a stale
// hydrate or chat continuation that an owner-only check would let through.
let identityGeneration = 0;

export const useAgentGatewayStore = create<AgentGatewayState>((set, get) => ({
  agents: TOP_AGENTS.map((agent) => ({ ...agent })),
  sessions: [],
  activeSessionId: null,
  isSending: false,
  currentTurnId: null,
  composerDraft: '',
  composerImages: [],
  errorMessage: null,
  reconfiguringSessionId: null,
  hydrated: false,
  persistOwnerId: null,
  availableModels: [],
  availableModelsState: 'idle',
  availableModelsLabel: LOCAL_COCKPIT_LABEL,

  hydrateFromDisk: async () => {
    if (get().hydrated) return;
    // Signed out: nothing to restore; setGatewayIdentity hydrates on sign-in.
    const owner = get().persistOwnerId;
    if (!owner) return;
    const api = gatewayPersistApi();
    if (!api?.list) {
      set({ hydrated: true });
      return;
    }
    const gen = identityGeneration;
    const current = () => gen === identityGeneration && get().persistOwnerId === owner;
    try {
      const raw = await api.list(owner);
      // The identity changed while listing (even back to the same account):
      // this result belongs to a previous sign-in.
      if (!current()) return;
      const restored = sanitizeStoredSessions(raw);
      // Don't clobber sessions the user already opened this launch.
      if (restored.length > 0 && get().sessions.length === 0) {
        set({ sessions: restored, activeSessionId: pickActiveId(restored), hydrated: true });
      } else {
        set({ hydrated: true });
      }
    } catch {
      if (current()) set({ hydrated: true });
    }
  },

  setGatewayIdentity: (userId) => {
    const owner = normalizePersistOwner(userId);
    if (owner === get().persistOwnerId) return;
    identityGeneration += 1;
    // Stop the previous account's in-flight turn (best effort, existing API);
    // its continuation is also dropped by the generation check in send.
    const oldTurnId = get().currentTurnId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const providerApi = typeof window === 'undefined' ? undefined : (window as any).electronAPI?.customProvider;
    if (oldTurnId && providerApi?.abort) {
      Promise.resolve()
        .then(() => providerApi.abort(oldTurnId))
        .catch(() => {
          /* best-effort — the stale continuation is dropped regardless */
        });
    }
    // Drop the previous account's chats from memory only; its rows stay on disk.
    set({
      isSending: false,
      currentTurnId: null,
      sessions: [],
      activeSessionId: null,
      composerDraft: '',
      composerImages: [],
      errorMessage: null,
      reconfiguringSessionId: null,
      hydrated: false,
      persistOwnerId: owner,
    });
    if (owner) void get().hydrateFromDisk();
  },

  updateAgentStatus: (agentId, status, version) => {
    set((state) => ({
      agents: state.agents.map((a) =>
        a.id === agentId ? { ...a, status, version: version ?? a.version } : a,
      ),
    }));
  },

  refreshAgentStatuses: async () => {
    // Sync from the MAIN process (`docker ps` by container name) — reliable and
    // CORS-free. A renderer fetch to the agent's health endpoint is unreliable:
    // the store resets to 'not-installed' on every launch, and some agents (e.g.
    // Hermes' aiohttp server) reject browser-origin requests with 403 — so a
    // running agent would keep showing "Not Installed". `docker ps` sees the truth.
    const dockerApi = (typeof window !== 'undefined'
      ? (window as unknown as { electronAPI?: { dockerAgent?: { status?: (p: { id: string; defaultPort: number }) => Promise<{ running: boolean; installed?: boolean }> } } }).electronAPI?.dockerAgent
      : undefined);
    if (!dockerApi?.status) return; // no bridge (browser dev) — nothing to sync

    for (const agent of get().agents) {
      if (agent.runtime === 'izzi') continue; // izzi-native agents have no container
      if (agent.setupMethod !== 'docker') continue; // only docker agents have containers
      if (agent.status === 'installing') continue; // don't clobber an in-progress install

      try {
        const res = await dockerApi.status({ id: agent.id, defaultPort: agent.defaultPort });
        const running = !!res?.running;
        const installed = !!res?.installed;
        set((state) => ({
          agents: state.agents.map((a) => {
            if (a.id !== agent.id) return a;
            if (running) return { ...a, status: 'running' };
            // A container that exists but isn't running is INSTALLED + stopped
            // (e.g. Hermes crashed/exited) — show 'stopped', not 'not-installed'.
            if (installed) return { ...a, status: 'stopped' };
            // Truly absent: only downgrade a previously-'running' badge.
            if (a.status === 'running') return { ...a, status: 'stopped' };
            return a;
          }),
        }));
      } catch {
        // best-effort — leave the current status untouched
      }
    }
  },

  applyStreamEvent: (event) => {
    // Only the live turn may stream. setGatewayIdentity clears currentTurnId in
    // the same step that bumps the generation, so a match here is a turn of the
    // current identity; a late event from a previous sign-in (even the same
    // account, after hydrate restored that message) is dropped.
    const { isSending, currentTurnId } = get();
    if (!isSending || !currentTurnId || event.turnId !== currentTurnId) return;
    set((state) => ({
      sessions: state.sessions.map((s) => {
        if (!s.messages.some((m) => m.id === event.turnId)) return s;
        return {
          ...s,
          messages: s.messages.map((m) => {
            if (m.id !== event.turnId) return m;
            if (event.kind === 'delta') {
              return { ...m, content: m.content + event.text, state: 'streaming' as const };
            }
            if (event.kind === 'reasoning') {
              return { ...m, reasoning: (m.reasoning ?? '') + event.text, state: 'streaming' as const };
            }
            if (event.kind === 'step') {
              const steps = Array.isArray(m.steps) ? [...m.steps] : [];
              const idx = steps.findIndex((x) => x.id === event.step.id);
              if (idx >= 0) steps[idx] = event.step;
              else steps.push(event.step);
              return { ...m, steps, state: 'streaming' as const };
            }
            return m;
          }),
        };
      }),
    }));
  },

  openAgentChat: (agentId) => {
    const { sessions, agents } = get();

    // If session for this agent already exists, switch to it
    const existing = sessions.find((s) => s.agentId === agentId && s.isActive);
    if (existing) {
      set({ activeSessionId: existing.id });
      return;
    }

    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;

    const newSession: AgentChatSession = {
      id: createLocalId('gw-session'),
      agentId: agent.id,
      agentName: agent.displayName,
      agentIcon: agent.icon,
      messages: [],
      model: agent.id === 'hermes' ? LOCAL_COCKPIT_MODEL : 'izzi-smart',
      provider: agent.id === 'hermes' ? 'custom' : 'izzi',
      reasoningEffort: agent.id === 'hermes' ? LOCAL_COCKPIT_REASONING_EFFORT : undefined,
      createdAt: new Date().toISOString(),
      isActive: true,
    };

    set((state) => ({
      sessions: [...state.sessions, newSession],
      activeSessionId: newSession.id,
    }));
  },

  closeAgentChat: (sessionId) => {
    // Drop the persisted copy too, so a closed tab doesn't come back on restart.
    const owner = get().persistOwnerId;
    // Best-effort: an IPC failure must not surface as an unhandled rejection.
    if (owner) gatewayPersistApi()?.delete?.(owner, sessionId).catch(() => undefined);
    set((state) => {
      const nextSessions = state.sessions.filter((s) => s.id !== sessionId);
      const nextActiveId =
        state.activeSessionId === sessionId
          ? nextSessions[nextSessions.length - 1]?.id ?? null
          : state.activeSessionId;

      return {
        sessions: nextSessions,
        activeSessionId: nextActiveId,
      };
    });
  },

  switchSession: (sessionId) => {
    set({ activeSessionId: sessionId });
  },

  abortGateway: async () => {
    const turnId = get().currentTurnId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI?.customProvider;
    if (turnId && api?.abort) {
      try {
        await api.abort(turnId);
      } catch {
        /* best-effort — the turn will still finish on its own */
      }
    }
  },

  injectGateway: async (text) => {
    const t = text.trim();
    const turnId = get().currentTurnId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI?.customProvider;
    if (!t || !turnId || !api?.inject) return false;
    const session = get().activeSession();
    // Show the steering note in the thread (just above the in-progress reply).
    if (session) {
      const noteId = createLocalId('gw-user');
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === session.id
            ? {
                ...s,
                messages: [
                  ...s.messages.slice(0, -1),
                  {
                    id: noteId,
                    sessionId: session.id,
                    agentId: session.agentId,
                    role: 'user' as const,
                    content: t,
                    state: 'done' as const,
                    model: session.model,
                    createdAt: new Date().toISOString(),
                  },
                  ...s.messages.slice(-1),
                ],
              }
            : s,
        ),
      }));
    }
    try {
      const r = await api.inject(turnId, t);
      return !!r?.ok;
    } catch {
      return false;
    }
  },

  setComposerDraft: (value) => set({ composerDraft: value }),
  setComposerImages: (value) =>
    set((state) => ({
      composerImages: typeof value === 'function' ? value(state.composerImages) : value,
    })),

  sendGatewayMessage: async (text, images) => {
    const content = text.trim();
    // Accept base64 image data URLs only; an image-only message (no text) is allowed.
    const imgs = Array.isArray(images)
      ? images.filter((u) => typeof u === 'string' && u.startsWith('data:image/'))
      : [];
    if ((!content && imgs.length === 0) || get().isSending) return false;

    const session = get().activeSession();
    if (!session) return false;

    const agent = get().agents.find((a) => a.id === session.agentId);
    if (!agent) return false;

    const createdAt = new Date().toISOString();
    const userMsgId = createLocalId('gw-user');
    const assistantMsgId = createLocalId('gw-assistant');

    const userMessage: GatewayChatMessage = {
      id: userMsgId,
      sessionId: session.id,
      agentId: session.agentId,
      role: 'user',
      content,
      state: 'done',
      model: session.model,
      createdAt,
      images: imgs.length > 0 ? imgs : undefined,
    };

    const assistantMessage: GatewayChatMessage = {
      id: assistantMsgId,
      sessionId: session.id,
      agentId: session.agentId,
      role: 'assistant',
      content: '',
      state: 'streaming',
      model: session.model,
      createdAt,
    };

    // Every await below is followed by this check before any side effect or
    // set: an account change resets turn state, so the old turn must not touch
    // the new session list, isSending/currentTurnId, or send its payload.
    const gen = identityGeneration;
    const stale = () => gen !== identityGeneration;

    // Optimistic update
    set((state) => ({
      isSending: true,
      currentTurnId: assistantMsgId,
      errorMessage: null,
      sessions: state.sessions.map((s) =>
        s.id === session.id
          ? { ...s, messages: [...s.messages, userMessage, assistantMessage] }
          : s,
      ),
    }));

    // Try to call agent's chat API
    try {
      // Izzi-native personas and any agent whose selected model belongs to Izzi
      // run through the MAIN-process Izzi API bridge. This makes SmartRouter plus
      // direct Grok/Sol selection work consistently while the credential stays
      // out of the renderer.
      if (shouldUseIzziApiRoute(agent.runtime, session.provider)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const izziApi = (window as any).electronAPI?.izziAgent;
        if (izziApi?.chat) {
          const history = session.messages
            .filter((m) => m.state === 'done' && m.content)
            .slice(-8)
            .map((m) => ({ role: m.role, content: m.content }));
          const r = await izziApi.chat({
            systemPrompt: agent.systemPrompt ?? '',
            message: content,
            history,
            model: session.model,
            // Let izzi persona agents invoke installed utility commands (e.g. Social Auto Poster).
            enableTools: true,
            // Stream the process (tool steps) + capture the session into my-graph.
            turnId: assistantMsgId,
            agentId: session.agentId,
            agentName: agent.displayName,
            images: imgs,
          });
          if (stale()) return false;
          const reply = r?.reply
            ? r.reply
            : r?.error === 'no-key'
              ? '⚠️ Cần đăng nhập Izzi (hoặc cấu hình API key) để chat với agent này.'
              : `⚠️ ${agent.displayName} chưa trả lời được (${r?.error ?? 'không rõ'}).`;
          set((state) => ({
            isSending: false,
            sessions: state.sessions.map((s) =>
              s.id === session.id
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === assistantMsgId ? { ...m, content: reply, state: 'done' as const } : m,
                    ),
                  }
                : s,
            ),
          }));
          return true;
        }
        // No bridge (browser dev) — be honest, don't fake a reply.
        set((state) => ({
          isSending: false,
          sessions: state.sessions.map((s) =>
            s.id === session.id
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          content: 'ℹ️ Mở trong app Izzi (đã đăng nhập) để chat với agent này.',
                          state: 'done' as const,
                        }
                      : m,
                  ),
                }
              : s,
          ),
        }));
        return true;
      }

      // Direct model connection (codex-lb / 9router / any OpenAI-compatible):
      // if the user configured + enabled a connection in the "Kết nối Model" tab,
      // route non-izzi agents through it (main process → the endpoint) instead of
      // the local Docker container. This is the "connect the app to codex-lb" path.
      const customApi = (window as any).electronAPI?.customProvider;
      if (agent.runtime !== 'izzi' && customApi?.chat && customApi?.getConfig) {
        let connEnabled = false;
        try {
          const c = await customApi.getConfig();
          connEnabled = !!(c?.enabled && c?.hasKey);
        } catch {
          /* no bridge / not configured — fall through to the container path */
        }
        // The account changed while reading config: never send the old payload.
        if (stale()) return false;
        if (connEnabled) {
          const history = session.messages
            .filter((m) => m.state === 'done' && m.content)
            .slice(-8)
            .map((m) => ({ role: m.role, content: m.content }));
          const r = await customApi.chat({ message: content, history, turnId: assistantMsgId, images: imgs });
          if (stale()) return false;
          if (r?.reply) {
            set((state) => ({
              isSending: false,
              sessions: state.sessions.map((s) =>
                s.id === session.id
                  ? {
                      ...s,
                      messages: s.messages.map((m) =>
                        m.id === assistantMsgId
                          ? {
                              ...m,
                              content: m.content && m.content.length > 0 ? m.content : (r.reply as string),
                              state: 'done' as const,
                            }
                          : m,
                      ),
                    }
                  : s,
              ),
            }));
            return true;
          }
          const err = String(r?.error ?? 'không rõ');
          if (err === 'aborted') {
            // Stopped by the user — keep whatever streamed so far, mark it done.
            set((state) => ({
              isSending: false,
              currentTurnId: null,
              sessions: state.sessions.map((s) =>
                s.id === session.id
                  ? {
                      ...s,
                      messages: s.messages.map((m) =>
                        m.id === assistantMsgId
                          ? {
                              ...m,
                              content:
                                (m.content && m.content.trim().length > 0 ? m.content + '\n\n' : '') + '⏹️ Đã dừng.',
                              state: 'done' as const,
                            }
                          : m,
                      ),
                    }
                  : s,
              ),
            }));
            return true;
          }
          const connMsg = customEndpointErrorMessage(err, get().availableModelsLabel);
          set((state) => ({
            isSending: false,
            sessions: state.sessions.map((s) =>
              s.id === session.id
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === assistantMsgId ? { ...m, content: connMsg, state: 'done' as const } : m,
                    ),
                  }
                : s,
            ),
          }));
          return true;
        }
      }

      // Fail closed: this session is explicitly bound to the custom endpoint, but
      // the connection is missing, disabled or without a key. Answering from the
      // Docker container would silently swap the model and the auth the user
      // chose, so stop here with an actionable notice instead.
      if (requiresCustomProviderRoute(agent.runtime, session.provider)) {
        set((state) => ({
          isSending: false,
          currentTurnId: null,
          errorMessage: 'Kết nối model tùy chỉnh chưa sẵn sàng.',
          sessions: state.sessions.map((s) =>
            s.id === session.id
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          content:
                            '⚠️ Phiên này đang dùng kết nối model tùy chỉnh nhưng kết nối chưa bật hoặc chưa có API key.\n\n' +
                            'Mở tab "Kết nối Model", bấm "Lưu & Bật" để kiểm tra kết nối rồi thử lại. ' +
                            'Tin nhắn sẽ không được chuyển sang agent Docker.',
                          state: 'done' as const,
                        }
                      : m,
                  ),
                }
              : s,
          ),
        }));
        return true;
      }

      // Docker agents with an OpenAI-compatible endpoint (e.g. Hermes) route
      // through the main process via IPC — the API key stays in main and is
      // never exposed to the renderer.
      const dockerAgentApi = (window as any).electronAPI?.dockerAgent;
      const isOpenAiCompatible =
        agent.setupMethod === 'docker' && agent.chatEndpoint === '/v1/chat/completions';

      if (isOpenAiCompatible && dockerAgentApi?.chat) {
        // Patch just this turn's assistant message (used for startup status notes).
        const patchAssistant = (patch: Partial<GatewayChatMessage>) =>
          set((state) => ({
            sessions: state.sessions.map((s) =>
              s.id === session.id
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === assistantMsgId ? { ...m, ...patch } : m,
                    ),
                  }
                : s,
            ),
          }));

        // A stopped container is the usual "can't chat / ECONNREFUSED" cause — try
        // to (re)start it before sending so the user doesn't hit a dead connection.
        const dockerMeta = {
          id: agent.id,
          defaultPort: agent.defaultPort,
          dockerImage: agent.dockerImage,
          dockerComposeUrl: agent.dockerComposeUrl,
        };
        try {
          const st = await dockerAgentApi.status?.(dockerMeta);
          if (stale()) return false;
          if (st && st.running === false) {
            patchAssistant({
              content: `🚀 Đang khởi động ${agent.displayName}… (lần đầu có thể mất ~30–60s)`,
            });
            const started = await dockerAgentApi.start?.(dockerMeta);
            if (stale()) return false;
            if (!started?.ok) {
              const why = started?.error ? `\n\n**Chi tiết:** ${started.error}` : '';
              patchAssistant({
                content:
                  `⚠️ Chưa khởi động được ${agent.displayName}.${why}\n\n` +
                  'Kiểm tra Docker đang chạy, hoặc mở Agent Hub để cài/chạy lại agent rồi thử lại.',
                state: 'done',
              });
              set({ isSending: false });
              return true;
            }
            get().updateAgentStatus(agent.id, 'running');
            // Wait for /health before sending (the container needs a beat to listen).
            if (dockerAgentApi.healthCheck) {
              for (let i = 0; i < 20; i++) {
                try {
                  const h = await dockerAgentApi.healthCheck({
                    defaultPort: agent.defaultPort,
                    healthEndpoint: agent.healthEndpoint,
                    timeoutMs: 4000,
                  });
                  if (stale()) return false;
                  if (h?.ok) break;
                } catch {
                  /* keep polling */
                }
                await new Promise((res) => setTimeout(res, 2000));
                if (stale()) return false;
              }
            }
            patchAssistant({ content: '' }); // clear the note so the reply stream fills the bubble
          }
        } catch {
          // status/start bridge unavailable (e.g. Docker CLI missing) — fall through;
          // the chat call below surfaces the concrete error.
        }
        if (stale()) return false;

        const r = await dockerAgentApi.chat(
          {
            id: agent.id,
            defaultPort: agent.defaultPort,
            agentName: agent.displayName,
            reasoningEffort: session.reasoningEffort,
            // Stream the live process (Hermes emits tool progress as content) + capture to my-graph.
            turnId: assistantMsgId,
            images: imgs,
          },
          content,
        );
        if (stale()) return false;

        if (r.ok && r.reply) {
          set((state) => ({
            isSending: false,
            sessions: state.sessions.map((s) =>
              s.id === session.id
                ? {
                    ...s,
                    messages: s.messages.map((m) =>
                      m.id === assistantMsgId
                        ? {
                            ...m,
                            // Keep the text already streamed in; fall back to the full reply.
                            content: m.content && m.content.length > 0 ? m.content : (r.reply as string),
                            state: 'done' as const,
                          }
                        : m,
                    ),
                  }
                : s,
            ),
          }));
          return true;
        }

        // Honest error from the agent/provider (no fallback simulation).
        const rawErr = String(r.error ?? 'không rõ');
        const errReply = agentReplyErrorMessage(agent.displayName, rawErr);

        set((state) => ({
          isSending: false,
          errorMessage: null,
          sessions: state.sessions.map((s) =>
            s.id === session.id
              ? {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === assistantMsgId ? { ...m, content: errReply, state: 'done' as const } : m,
                  ),
                }
              : s,
          ),
        }));
        return true;
      }

      const url = `http://127.0.0.1:${agent.defaultPort}${agent.chatEndpoint}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: content,
          model: session.model,
          provider: session.provider,
          stream: false,
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (stale()) return false;

      if (!response.ok) {
        throw new Error(`Agent returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      if (stale()) return false;
      const reply = data.reply || data.message || data.content || data.answer || 'No response from agent.';

      set((state) => ({
        isSending: false,
        sessions: state.sessions.map((s) =>
          s.id === session.id
            ? {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === assistantMsgId ? { ...m, content: reply, state: 'done' as const } : m,
                ),
              }
            : s,
        ),
      }));

      return true;
    } catch (error) {
      void error; // External agent unreachable is expected; message handled below.
      if (stale()) return false;

      // Fallback: this is an external, self-hosted agent. Be honest — Izzi did not
      // install/run it; the user must start it themselves at the expected port.
      const fallbackReply = `⚠️ Chưa kết nối được tới ${agent.displayName} ở 127.0.0.1:${agent.defaultPort}.\n\n${agent.displayName} là agent mã nguồn mở bên ngoài — Izzi không tự cài/chạy nó. Bạn cần tự khởi chạy agent ở máy mình, sau đó mới chat được.\n\n**Cách kiểm tra:**\n1. Đảm bảo ${agent.displayName} đang chạy và lắng nghe ở port ${agent.defaultPort}\n2. Mở lại "${agent.displayName}" trong Agent Hub → bấm "Kiểm tra kết nối"\n3. Xem hướng dẫn cài đặt tại: ${agent.githubUrl}`;

      set((state) => ({
        isSending: false,
        errorMessage: null, // Don't show error banner for expected disconnects
        sessions: state.sessions.map((s) =>
          s.id === session.id
            ? {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === assistantMsgId ? { ...m, content: fallbackReply, state: 'done' as const } : m,
                ),
              }
            : s,
        ),
      }));

      return true;
    }
  },

  newGatewaySession: (agentId) => {
    const { agents } = get();
    const agent = agents.find((a) => a.id === agentId);
    if (!agent) return;

    // Mark old sessions for this agent as inactive
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.agentId === agentId ? { ...s, isActive: false } : s,
      ),
    }));

    // Create new session
    const newSession: AgentChatSession = {
      id: createLocalId('gw-session'),
      agentId: agent.id,
      agentName: agent.displayName,
      agentIcon: agent.icon,
      messages: [],
      model: agent.id === 'hermes' ? LOCAL_COCKPIT_MODEL : 'izzi-smart',
      provider: agent.id === 'hermes' ? 'custom' : 'izzi',
      reasoningEffort: agent.id === 'hermes' ? LOCAL_COCKPIT_REASONING_EFFORT : undefined,
      createdAt: new Date().toISOString(),
      isActive: true,
    };

    set((state) => ({
      sessions: [...state.sessions, newSession],
      activeSessionId: newSession.id,
    }));
  },

  setSessionModel: (sessionId, model, provider) => {
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, model, provider } : s,
      ),
    }));
  },

  refreshAvailableModels: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI?.customProvider;
    if (!api?.listModels) {
      set({ availableModels: [], availableModelsState: 'error' });
      return;
    }
    set({ availableModelsState: 'loading' });
    try {
      const [r, c] = await Promise.all([
        api.listModels(),
        api.getConfig ? api.getConfig() : Promise.resolve(null),
      ]);
      const label = deriveEndpointLabel(c?.config?.baseUrl);
      if (r?.ok && Array.isArray(r.models)) {
        set({ availableModels: r.models as string[], availableModelsLabel: label, availableModelsState: 'ok' });
      } else {
        set({ availableModels: [], availableModelsLabel: label, availableModelsState: 'error' });
      }
    } catch {
      set({ availableModels: [], availableModelsState: 'error' });
    }
  },

  setActiveModel: async (model, provider) => {
    const session = get().activeSession();
    const connected = await connectModelForProvider(model, provider, (errorMessage) =>
      set({ errorMessage }),
    );
    if (!connected.ok) return;
    if (session) get().setSessionModel(session.id, model, provider);
  },

  applySessionModel: async (sessionId, model, provider) => {
    if (!get().sessions.some((s) => s.id === sessionId)) {
      return { ok: false, message: 'Phiên chat không còn tồn tại.' };
    }
    const connected = await connectModelForProvider(model, provider, (errorMessage) =>
      set({ errorMessage }),
    );
    if (!connected.ok) return connected;
    // The session may have been removed while the probe ran; never resurrect it.
    if (!get().sessions.some((s) => s.id === sessionId)) {
      return { ok: false, message: 'Phiên chat không còn tồn tại.' };
    }
    get().setSessionModel(sessionId, model, provider);
    return { ok: true };
  },

  enableCustomRouting: async (model) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const api = (window as any).electronAPI?.customProvider;
    if (!api?.testConnection || !api?.setEnabled) {
      const message = 'thiếu cầu nối app để kiểm tra kết nối';
      set({ errorMessage: probeFailureNotice(message) });
      return { ok: false, message };
    }
    // The connection may already be enabled with an older config: turn it off
    // before probing so a broken endpoint/key never keeps serving traffic.
    try {
      await api.setEnabled(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ errorMessage: probeFailureNotice(message) });
      return { ok: false, message };
    }
    let probe: { ok?: boolean; message?: string } | undefined;
    try {
      probe = await api.testConnection();
    } catch (err) {
      probe = { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    // Fail closed: no enablement and no rerouting until the endpoint answers.
    if (!probe?.ok) {
      set({ errorMessage: probeFailureNotice(probe?.message) });
      return { ok: false, message: probe?.message };
    }
    try {
      await api.setEnabled(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set({ errorMessage: probeFailureNotice(message) });
      return { ok: false, message };
    }
    set({ errorMessage: null });
    get().routeExternalSessionsToCustom(model);
    return { ok: true };
  },

  routeExternalSessionsToCustom: (model) => {
    const agents = new Map(get().agents.map((agent) => [agent.id, agent]));
    set((state) => ({
      sessions: state.sessions.map((session) => {
        const agent = agents.get(session.agentId);
        if (!agent || agent.runtime === 'izzi') return session;
        return {
          ...session,
          model,
          provider: 'custom',
          reasoningEffort:
            model === LOCAL_COCKPIT_MODEL ? LOCAL_COCKPIT_REASONING_EFFORT : session.reasoningEffort,
        };
      }),
    }));
  },

  setReasoningEffort: async (effort) => {
    const session = get().activeSession();
    if (!session) return false;
    const agent = get().agents.find((a) => a.id === session.agentId);
    if (!agent || agent.setupMethod !== 'docker') return false;
    if (session.reasoningEffort === effort) return true; // no-op

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dockerApi = (window as any).electronAPI?.dockerAgent;
    if (!dockerApi?.setReasoningEffort) {
      set({ errorMessage: 'Không đổi được mức reasoning (thiếu cầu nối app).' });
      return false;
    }

    // An account change resets reconfiguringSessionId; a stale result must not
    // write back into the new account's state.
    const gen = identityGeneration;
    const stale = () => gen !== identityGeneration;
    set({ reconfiguringSessionId: session.id, errorMessage: null });
    try {
      const r = await dockerApi.setReasoningEffort(
        { id: agent.id, defaultPort: agent.defaultPort },
        effort,
      );
      if (stale()) return false;
      if (!r?.ok) {
        set({ reconfiguringSessionId: null, errorMessage: r?.error ?? 'Không đổi được mức reasoning.' });
        return false;
      }

      // The container was restarted — wait for /health before re-enabling chat.
      if (dockerApi.healthCheck) {
        for (let i = 0; i < 20; i++) {
          try {
            const h = await dockerApi.healthCheck({
              defaultPort: agent.defaultPort,
              healthEndpoint: agent.healthEndpoint,
              timeoutMs: 4000,
            });
            if (h?.ok) break;
          } catch {
            /* keep polling */
          }
          if (stale()) return false;
          await new Promise((res) => setTimeout(res, 3000));
        }
      }

      if (stale()) return false;
      set((state) => ({
        reconfiguringSessionId: null,
        sessions: state.sessions.map((s) =>
          s.id === session.id ? { ...s, reasoningEffort: effort } : s,
        ),
      }));
      return true;
    } catch {
      if (stale()) return false;
      set({ reconfiguringSessionId: null, errorMessage: 'Không đổi được mức reasoning.' });
      return false;
    }
  },

  activeSession: () => {
    const { sessions, activeSessionId } = get();
    return sessions.find((s) => s.id === activeSessionId) ?? null;
  },

  getAgentById: (agentId) => {
    return get().agents.find((a) => a.id === agentId);
  },
}));

// Subscribe once to the live agent "process" stream (main → renderer) and route
// each event to the matching assistant message. Guarded for the browser-dev case
// where the Electron bridge is absent.
if (typeof window !== 'undefined') {
  const streamApi = (
    window as unknown as {
      electronAPI?: { agentStream?: { onEvent?: (cb: (evt: AgentTurnEvent) => void) => void } };
    }
  ).electronAPI?.agentStream;
  streamApi?.onEvent?.((evt) => {
    useAgentGatewayStore.getState().applyStreamEvent(evt);
  });

  // Restore chat history once on load (survives app restart); a no-op until
  // setGatewayIdentity binds the signed-in account...
  void useAgentGatewayStore.getState().hydrateFromDisk();

  // ...and persist sessions (debounced) whenever they change, so history is durable.
  // A pending save is bound to the owner that scheduled it and dropped on an
  // account change, so one account's chats are never written under another.
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  useAgentGatewayStore.subscribe((state, prev) => {
    if (state.persistOwnerId !== prev.persistOwnerId) {
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = undefined;
      return;
    }
    if (state.sessions === prev.sessions) return;
    const owner = state.persistOwnerId;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = undefined;
    if (!owner) return;
    persistTimer = setTimeout(() => {
      const current = useAgentGatewayStore.getState();
      if (current.persistOwnerId !== owner) return;
      const api = gatewayPersistApi();
      if (!api?.save) return;
      // Best-effort: the next change retries, so a failed save is dropped rather than left unhandled.
      for (const s of capForPersist(current.sessions)) api.save(owner, s).catch(() => undefined);
    }, 700);
  });
}
