/**
 * Agent profiles, S2 of docs/MYGRAPH-AGENT-MEMORY.md: on the owner's request, distil the account's new
 * activity into one short profile per agent, kept for review on this machine. Nothing here writes to
 * MyGraph; approved profiles reach agents through agent-profile-context (S4).
 *
 * Credit guard:
 * - `gpt-6-luna` first (the owner's choice, served by codex-lb, cheap; it reasons by default, so it gets
 *   room for that), one fallback to `gpt-4o-mini` on another provider (it still answers when the codex-lb
 *   pool is down), and a stop on an out-of-credit answer;
 * - at most 4 agents per run, output budget sized to them, and a 90 s timeout per call;
 * - at most `AGENT_PROFILES_MAX_RUNS_PER_DAY` runs and `AGENT_PROFILES_MAX_CALLS_PER_DAY` model calls a day
 *   (every call is counted before it is made, so a failure cannot slip past the cap);
 * - no call when there is no new activity; an unusable or cut-off answer still moves the agents'
 *   watermarks, so the same input is never paid for twice.
 * Single-flight; approve/discard wait for a run to finish. An account switch discards the answer.
 *
 * @module main/agents/memory/agent-profile-service
 */
import type { AgentProfilesError, AgentProfilesResult } from '../../../shared/agent-profile-types';
import {
  buildProfilePrompt,
  collectChatActivity,
  collectMarketingOutcomes,
  parseProfileOutput,
  type AgentActivity,
} from './agent-profile-digest';
import {
  AGENT_PROFILES_MAX_CALLS_PER_DAY,
  AGENT_PROFILES_MAX_RUNS_PER_DAY,
  approveProfile,
  callsToday,
  countCall,
  discardProfile,
  forgetProfile,
  recordRun,
  runsToday,
  setPendingProfiles,
  toProfilesState,
  watermarkMs,
  type AgentProfileStore,
  type StoredProfiles,
} from './agent-profile-store';

/** The owner's choice (2026-11-19): GPT-6 Luna, served by codex-lb. */
export const AGENT_PROFILE_MODEL = 'gpt-6-luna';
/** Another provider, so a degraded codex-lb pool does not stop the run. */
export const AGENT_PROFILE_FALLBACK_MODEL = 'gpt-4o-mini';
export const AGENT_PROFILES_MAX_AGENTS_PER_RUN = 4;
const OUTPUT_TOKENS_BASE = 400;
const OUTPUT_TOKENS_PER_AGENT = 700;
/** gpt-6-luna reasons at its default effort; those tokens come out of the same budget. */
const REASONING_TOKENS = 3000;
const CALL_TIMEOUT_MS = 90_000;
const MAX_AGENT_ID_CHARS = 100;
const QUOTA_ERROR = /\b402\b|insufficient|quota/i;

export type AgentProfileChat = (
  payload: { systemPrompt: string; message: string; model: string; enableTools: false; maxTokens: number },
  signal: AbortSignal,
) => Promise<{ reply: string; error?: string; truncated?: boolean }>;

export interface AgentProfileServiceOptions {
  store: AgentProfileStore;
  /** The signed-in account, resolved in main. */
  currentOwnerId: () => string | null;
  /** The account's saved persona chat sessions (gateway history). */
  readChatSessions: (ownerId: string) => unknown;
  /** The account's marketing snapshot; may throw (no workspace, signed out). */
  readMarketingSnapshot: () => Promise<unknown>;
  /** A direct, tool-free model call that is never recorded as an agent session. */
  chat: AgentProfileChat;
  now?: () => number;
  /** Fixed diagnostics only. */
  log?: (message: string) => void;
}

type ModelOutcome =
  | { reply: string; truncated: boolean }
  | { error: 'quota' | 'model_unavailable' | 'daily_limit' | 'auth' };

function failure(error: AgentProfilesError): AgentProfilesResult {
  return { ok: false, error };
}

function parseActionInput(input: unknown): string | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const agentId = Object.hasOwn(input, 'agentId') ? (input as { agentId?: unknown }).agentId : undefined;
  return typeof agentId === 'string' && agentId.length > 0 && agentId.length <= MAX_AGENT_ID_CHARS ? agentId : null;
}

export function maxTokensFor(model: string, agentCount: number): number {
  const output = OUTPUT_TOKENS_BASE + OUTPUT_TOKENS_PER_AGENT * Math.max(1, agentCount);
  return model === AGENT_PROFILE_MODEL ? output + REASONING_TOKENS : output;
}

export class AgentProfileService {
  private running = false;
  private readonly now: () => number;

  constructor(private readonly options: AgentProfileServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  getState(): AgentProfilesResult {
    const owner = this.owner();
    if (!owner) return failure('auth');
    return { ok: true, state: toProfilesState(this.options.store.load(owner), this.now()) };
  }

  async refresh(): Promise<AgentProfilesResult> {
    const owner = this.owner();
    if (!owner) return failure('auth');
    if (this.running) return failure('busy');
    this.running = true;
    try {
      return await this.distil(owner);
    } catch {
      this.log('agent profiles run failed');
      return failure('model_unavailable');
    } finally {
      this.running = false;
    }
  }

  async approve(input: unknown): Promise<AgentProfilesResult> {
    return this.change(input, (data, agentId) => approveProfile(data, agentId, this.now()));
  }

  async discard(input: unknown): Promise<AgentProfilesResult> {
    return this.change(input, (data, agentId) => discardProfile(data, agentId));
  }

  /** "Ngừng dùng": the agent stops using its approved profile. */
  async forget(input: unknown): Promise<AgentProfilesResult> {
    return this.change(input, (data, agentId) => forgetProfile(data, agentId));
  }

  /**
   * The approved profile text of the signed-in account for this agent, or null. Never a pending draft.
   * With `ownerId`, also null unless that account is the one signed in (a run planned for another account).
   */
  approvedProfile(agentId: string, ownerId?: string): string | null {
    if (typeof agentId !== 'string' || agentId.length === 0 || agentId.length > MAX_AGENT_ID_CHARS) return null;
    const owner = this.owner();
    if (!owner || (ownerId !== undefined && ownerId !== owner)) return null;
    const data = this.options.store.load(owner);
    return Object.hasOwn(data.agents, agentId) ? data.agents[agentId].approved?.text ?? null : null;
  }

  private async distil(owner: string): Promise<AgentProfilesResult> {
    const startMs = this.now();
    const data = this.options.store.load(owner);
    if (runsToday(data, startMs) >= AGENT_PROFILES_MAX_RUNS_PER_DAY) return failure('daily_limit');
    if (callsToday(data, startMs) >= AGENT_PROFILES_MAX_CALLS_PER_DAY) return failure('daily_limit');
    const sinceFor = (agentId: string) => watermarkMs(data, agentId, startMs);
    const chatActivity = collectChatActivity(this.readSessions(owner), sinceFor);
    const marketingActivity = collectMarketingOutcomes(await this.readMarketing(), sinceFor);
    if (this.owner() !== owner) return failure('auth');
    // The work that has waited longest goes first; agents left out keep their watermark for next time.
    const activities = [...marketingActivity, ...chatActivity]
      .sort((a, b) => a.oldestMs - b.oldestMs)
      .slice(0, AGENT_PROFILES_MAX_AGENTS_PER_RUN);
    if (activities.length === 0) return failure('no_activity');

    // Only what the owner approved seeds the rewrite; an unreviewed or discarded draft never does.
    const previous: Record<string, string> = {};
    for (const activity of activities) {
      const approved = Object.hasOwn(data.agents, activity.agentId) ? data.agents[activity.agentId].approved : null;
      if (approved) previous[activity.agentId] = approved.text;
    }
    const outcome = await this.callModel(owner, buildProfilePrompt(activities, previous), activities.length);
    // The account may have changed while the model was answering: its result belongs to nobody now.
    if (this.owner() !== owner) return failure('auth');
    if ('error' in outcome) return failure(outcome.error);

    const nowMs = this.now();
    const newest = Object.fromEntries(activities.map((activity) => [activity.agentId, activity.newestMs]));
    // Re-read: the call counter changed, and nothing else may have been lost meanwhile.
    const counted = recordRun(this.options.store.load(owner), nowMs, newest);
    const parsed = outcome.truncated ? null : parseProfileOutput(outcome.reply, new Set(activities.map((activity) => activity.agentId)));
    if (!parsed || (parsed.profiles.length === 0 && parsed.dropped > 0)) {
      // Paid for, so it counts, and this activity is done: the same input is never sent again.
      this.options.store.save(owner, counted);
      this.log(outcome.truncated ? 'agent profiles answer cut off' : 'agent profiles answer unusable');
      return failure('invalid_output');
    }
    if (parsed.dropped > 0) this.log('agent profiles dropped invalid entries');
    const next = setPendingProfiles(counted, parsed.profiles, agentNames(activities), nowMs);
    this.options.store.save(owner, next);
    return { ok: true, state: toProfilesState(next, nowMs), updated: parsed.profiles.length };
  }

  private async callModel(
    owner: string,
    prompt: { systemPrompt: string; message: string },
    agentCount: number,
  ): Promise<ModelOutcome> {
    let lastQuota = false;
    for (const model of [AGENT_PROFILE_MODEL, AGENT_PROFILE_FALLBACK_MODEL]) {
      if (this.owner() !== owner) return { error: 'auth' };
      const data = this.options.store.load(owner);
      if (callsToday(data, this.now()) >= AGENT_PROFILES_MAX_CALLS_PER_DAY) return { error: 'daily_limit' };
      // Counted before the call: a crash or a timeout after the server accepted it still counts.
      this.options.store.save(owner, countCall(data, this.now()));
      let result: { reply: string; error?: string; truncated?: boolean };
      try {
        result = await this.options.chat(
          { ...prompt, model, enableTools: false, maxTokens: maxTokensFor(model, agentCount) },
          AbortSignal.timeout(CALL_TIMEOUT_MS),
        );
      } catch {
        result = { reply: '', error: 'network' };
      }
      if (typeof result.reply === 'string' && result.reply.trim().length > 0) {
        return { reply: result.reply, truncated: result.truncated === true };
      }
      lastQuota = QUOTA_ERROR.test(result.error ?? '');
      // Out of credit: a second model would be refused the same way, and must not be tried.
      if (lastQuota) break;
    }
    this.log(lastQuota ? 'agent profiles stopped: out of credit' : 'agent profiles model unavailable');
    return { error: lastQuota ? 'quota' : 'model_unavailable' };
  }

  private async change(
    input: unknown,
    update: (data: StoredProfiles, agentId: string) => StoredProfiles | null,
  ): Promise<AgentProfilesResult> {
    const agentId = parseActionInput(input);
    if (!agentId) return failure('invalid_input');
    const owner = this.owner();
    if (!owner) return failure('auth');
    // A run in progress may be rewriting this profile: decide after it lands.
    if (this.running) return failure('busy');
    const next = update(this.options.store.load(owner), agentId);
    if (!next) return failure('not_found');
    // Unsaved means unchanged: agents would keep reading the old state, so the owner must not see success.
    if (!this.options.store.save(owner, next)) return failure('storage');
    return { ok: true, state: toProfilesState(next, this.now()) };
  }

  private readSessions(owner: string): unknown {
    try {
      return this.options.readChatSessions(owner);
    } catch {
      return [];
    }
  }

  private async readMarketing(): Promise<unknown> {
    try {
      return await this.options.readMarketingSnapshot();
    } catch {
      return null;
    }
  }

  private owner(): string | null {
    try {
      const owner = this.options.currentOwnerId();
      return typeof owner === 'string' && owner.length > 0 ? owner : null;
    } catch {
      return null;
    }
  }

  private log(message: string): void {
    try {
      this.options.log?.(message);
    } catch {
      // Diagnostics never break a run.
    }
  }
}

function agentNames(activities: readonly AgentActivity[]): Record<string, string> {
  return Object.fromEntries(activities.map((activity) => [activity.agentId, activity.agentName]));
}
