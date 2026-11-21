/**
 * Agent profiles, S2 of docs/MYGRAPH-AGENT-MEMORY.md: on the owner's request, distil the account's new
 * activity into one short profile per agent, kept for review on this machine. Nothing here writes to
 * MyGraph; approved profiles reach agents through agent-profile-context (S4).
 *
 * Credit guard (no fixed daily or monthly cap; owner's decision, 2026-11-21):
 * - a model call only when there is new activity; an unusable or cut-off answer still moves the agents'
 *   watermarks, so the same input is never paid for twice;
 * - `gpt-6-luna` first (the owner's choice, served by codex-lb, cheap; it reasons by default, so it gets
 *   room for that), one fallback to `gpt-4o-mini` on another provider (it still answers when the codex-lb
 *   pool is down), and a stop on a 402 answer with no fallback;
 * - at most 4 agents per run, output budget sized to them, and each call abandoned after 90 s even if the
 *   transport ignores the abort;
 * - a loop detector for background runs only: an input already sent, or the third background run in a row
 *   with no new activity, pauses background runs (so does a 402 in the background) until the owner presses
 *   "Tiếp tục". The owner's "Cập nhật hồ sơ ngay" is never paused.
 * Single-flight; approve/discard/resume wait for a run to finish. An account switch discards the answer.
 *
 * @module main/agents/memory/agent-profile-service
 */
import { createHash } from 'node:crypto';
import type { AgentProfilesError, AgentProfilesPauseReason, AgentProfilesResult } from '../../../shared/agent-profile-types';
import {
  buildProfilePrompt,
  collectChatActivity,
  collectMarketingOutcomes,
  parseProfileOutput,
  type AgentActivity,
} from './agent-profile-digest';
import {
  approveProfile,
  backgroundLoopReason,
  discardProfile,
  forgetProfile,
  pauseBackground,
  recordRun,
  recordSend,
  resumeBackground,
  setPendingProfiles,
  toProfilesState,
  watermarkMs,
  type AgentProfilesTrigger,
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

type ChatResult = Awaited<ReturnType<AgentProfileChat>>;

type ModelOutcome =
  | { reply: string; truncated: boolean }
  | { error: 'quota' | 'model_unavailable' | 'auth' };

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

/** The same prompt always gives the same fingerprint; the model is not part of the input. */
function inputFingerprint(prompt: { systemPrompt: string; message: string }): string {
  return createHash('sha256').update(JSON.stringify([prompt.systemPrompt, prompt.message]), 'utf8').digest('hex');
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
    return { ok: true, state: toProfilesState(this.options.store.load(owner)) };
  }

  /** The owner's "Cập nhật hồ sơ ngay" by default; a background job passes 'background'. */
  async refresh(trigger: AgentProfilesTrigger = 'owner'): Promise<AgentProfilesResult> {
    const owner = this.owner();
    if (!owner) return failure('auth');
    if (this.running) return failure('busy');
    this.running = true;
    try {
      return await this.distil(owner, trigger);
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

  /** "Tiếp tục": background runs may call the model again. */
  async resume(): Promise<AgentProfilesResult> {
    const owner = this.owner();
    if (!owner) return failure('auth');
    if (this.running) return failure('busy');
    const next = resumeBackground(this.options.store.load(owner));
    if (!this.options.store.save(owner, next)) return failure('storage');
    return { ok: true, state: toProfilesState(next) };
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

  private async distil(owner: string, trigger: AgentProfilesTrigger): Promise<AgentProfilesResult> {
    const startMs = this.now();
    const data = this.options.store.load(owner);
    // The loop detector holds background runs only; the owner's own click always goes through.
    if (trigger === 'background' && data.pause) return failure('paused');
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
    const prompt = buildProfilePrompt(activities, previous);
    const fingerprint = inputFingerprint(prompt);
    const newest = Object.fromEntries(activities.map((activity) => [activity.agentId, activity.newestMs]));
    const sendData = this.options.store.load(owner);
    const loop = trigger === 'background' ? backgroundLoopReason(sendData, fingerprint, newest) : null;
    if (loop) return this.pauseBackgroundRuns(owner, loop);
    // Recorded before the call: a crash or a timeout after the server accepted it still counts. A background
    // run that cannot record it could not see itself repeat, so it spends nothing.
    const recorded = this.options.store.save(owner, recordSend(sendData, fingerprint, newest, trigger));
    if (!recorded && trigger === 'background') return failure('storage');

    const outcome = await this.callModel(owner, prompt, activities.length);
    // The account may have changed while the model was answering: its result belongs to nobody now.
    if (this.owner() !== owner) return failure('auth');
    if ('error' in outcome) {
      // Nobody watches a background run: a 402 there holds background runs until the owner continues.
      if (outcome.error === 'quota' && trigger === 'background') this.pauseBackgroundRuns(owner, 'quota');
      return failure(outcome.error);
    }

    const nowMs = this.now();
    // Re-read: the send record changed, and nothing else may have been lost meanwhile.
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
    return { ok: true, state: toProfilesState(next), updated: parsed.profiles.length };
  }

  private pauseBackgroundRuns(owner: string, reason: AgentProfilesPauseReason): AgentProfilesResult {
    this.options.store.save(owner, pauseBackground(this.options.store.load(owner), reason, this.now()));
    this.log(`agent profiles background paused: ${reason}`);
    return failure(reason === 'quota' ? 'quota' : 'paused');
  }

  private async callModel(
    owner: string,
    prompt: { systemPrompt: string; message: string },
    agentCount: number,
  ): Promise<ModelOutcome> {
    let lastQuota = false;
    for (const model of [AGENT_PROFILE_MODEL, AGENT_PROFILE_FALLBACK_MODEL]) {
      if (this.owner() !== owner) return { error: 'auth' };
      const result = await this.callOnce({ ...prompt, model, enableTools: false, maxTokens: maxTokensFor(model, agentCount) });
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

  /** One call, abandoned after 90 s even when the transport ignores the abort signal. */
  private async callOnce(payload: Parameters<AgentProfileChat>[0]): Promise<ChatResult> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<ChatResult>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ reply: '', error: 'timeout' });
      }, CALL_TIMEOUT_MS);
    });
    try {
      return await Promise.race([this.options.chat(payload, controller.signal), deadline]);
    } catch {
      return { reply: '', error: 'network' };
    } finally {
      clearTimeout(timer);
    }
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
    return { ok: true, state: toProfilesState(next) };
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
