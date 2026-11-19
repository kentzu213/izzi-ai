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

export interface AgentProfilesState {
  profiles: AgentProfileView[];
  lastRunAt: string | null;
  runsToday: number;
  maxRunsPerDay: number;
  /** Model calls today (fallbacks and failures included) against their own cap. */
  callsToday: number;
  maxCallsPerDay: number;
}

/** Bounded failure codes; the renderer maps them to Vietnamese text. */
export type AgentProfilesError =
  | 'auth'
  | 'busy'
  | 'no_activity'
  | 'daily_limit'
  | 'quota'
  | 'model_unavailable'
  | 'invalid_output'
  | 'invalid_input'
  | 'not_found';

export type AgentProfilesResult =
  | { ok: true; state: AgentProfilesState; updated?: number }
  | { ok: false; error: AgentProfilesError };

/** Renderer input for approve / discard; main validates it. */
export interface AgentProfileActionInput {
  agentId: string;
}
