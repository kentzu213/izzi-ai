/**
 * Agent profiles (docs/MYGRAPH-AGENT-MEMORY.md, S2): one short, distilled profile per agent, built on
 * this machine from the account's own activity. A new profile waits for the owner's review
 * ("Dùng" / "Bỏ") before anything may use it.
 */

export interface AgentProfileVersion {
  text: string;
  /** When the distiller wrote it (pending) or the owner approved it (approved). */
  at: string;
}

export interface AgentProfileView {
  agentId: string;
  agentName: string;
  approved: AgentProfileVersion | null;
  pending: AgentProfileVersion | null;
}

/**
 * Why background runs stopped on their own: an input already sent came up again, several runs in a row
 * had no new activity, or the account ran out of credit (402). The owner's own click is never paused.
 */
export type AgentProfilesPauseReason = 'repeat_input' | 'idle_runs' | 'quota';

export interface AgentProfilesPause {
  reason: AgentProfilesPauseReason;
  at: string;
}

export interface AgentProfilesState {
  profiles: AgentProfileView[];
  lastRunAt: string | null;
  /** Set while background runs are paused; "Tiếp tục" clears it. */
  backgroundPause: AgentProfilesPause | null;
}

/** Bounded failure codes; the renderer maps them to Vietnamese text. */
export type AgentProfilesError =
  | 'auth'
  | 'busy'
  | 'no_activity'
  | 'paused'
  | 'quota'
  | 'model_unavailable'
  | 'invalid_output'
  | 'invalid_input'
  | 'not_found'
  | 'storage';

export type AgentProfilesResult =
  | { ok: true; state: AgentProfilesState; updated?: number }
  | { ok: false; error: AgentProfilesError };

/**
 * Agents that never read their profile (S4): Hermes keeps its own memory, and the Content Agent writes
 * public posts. The profile may still be reviewed; it is simply not used.
 */
export const AGENT_IDS_NOT_READING_PROFILE: readonly string[] = ['hermes', 'customer-marketing-content'];

/** Renderer input for approve / discard / forget; main validates it. */
export interface AgentProfileActionInput {
  agentId: string;
}
