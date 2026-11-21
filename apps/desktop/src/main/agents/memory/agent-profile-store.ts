/**
 * Local store for agent profiles (docs/MYGRAPH-AGENT-MEMORY.md, S2). One settings row per account under
 * a hashed key, so profiles never cross accounts on a shared machine and no table changes are needed.
 * State changes return new objects; the stored JSON is re-validated on every load.
 *
 * Each agent has its own watermark (the newest activity already distilled). Watermarks only move
 * forward, and one in the future (clock skew) is read as now.
 *
 * There is no daily or monthly cap (owner's decision, 2026-11-21). Instead a loop record guards
 * background runs only: the inputs already sent, the newest activity sent per agent, the background
 * runs in a row that had nothing new, and a pause that only the owner's "Tiếp tục" clears.
 *
 * @module main/agents/memory/agent-profile-store
 */
import { createHash } from 'node:crypto';
import type {
  AgentProfilesPause,
  AgentProfilesPauseReason,
  AgentProfileVersion,
  AgentProfilesState,
} from '../../../shared/agent-profile-types';
import { PROFILE_MAX_CHARS, type DistilledProfile } from './agent-profile-digest';

/** A background run that would be this many in a row with no new activity pauses instead of calling. */
export const AGENT_PROFILES_LOOP_IDLE_RUNS = 3;
const KEY_PREFIX = 'agent_profiles:v1';
const MAX_AGENTS = 50;
const MAX_NAME_CHARS = 100;
const MAX_FINGERPRINTS = 20;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const PAUSE_REASONS: readonly AgentProfilesPauseReason[] = ['repeat_input', 'idle_runs', 'quota'];

/** Who asked for a run: the owner's click, or a background job (the only kind the loop detector stops). */
export type AgentProfilesTrigger = 'owner' | 'background';

export interface StoredAgentProfile {
  agentName: string;
  approved: AgentProfileVersion | null;
  pending: AgentProfileVersion | null;
}

export interface StoredProfiles {
  version: 1;
  lastRunAt: string | null;
  /** Per agent: the newest activity already distilled (ISO). */
  watermarks: Record<string, string>;
  /** Per agent: the newest activity already sent to the model (ISO), answered or not. */
  sent: Record<string, string>;
  /** sha256 of recent inputs sent to the model, newest last. */
  fingerprints: string[];
  /** Background runs in a row that sent only activity already sent. */
  idleRuns: number;
  /** Background runs are paused until the owner presses "Tiếp tục". */
  pause: AgentProfilesPause | null;
  agents: Record<string, StoredAgentProfile>;
}

export function emptyProfiles(): StoredProfiles {
  return { version: 1, lastRunAt: null, watermarks: {}, sent: {}, fingerprints: [], idleRuns: 0, pause: null, agents: {} };
}

type Fields = Record<string, unknown>;

function record(value: unknown): Fields | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Fields : null;
}

function own(obj: Fields, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && ISO.test(value) && Number.isFinite(Date.parse(value));
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** undefined = invalid; null = absent. */
function parseVersion(value: unknown): AgentProfileVersion | null | undefined {
  if (value === null || value === undefined) return null;
  const obj = record(value);
  if (!obj) return undefined;
  const text = own(obj, 'text');
  const at = own(obj, 'at');
  if (typeof text !== 'string' || !text.trim() || text.length > PROFILE_MAX_CHARS || !isIso(at)) return undefined;
  return { text, at };
}

function parseAgents(value: unknown): Record<string, StoredAgentProfile> {
  const agents: Record<string, StoredAgentProfile> = {};
  for (const [agentId, raw] of Object.entries(record(value) ?? {}).slice(0, MAX_AGENTS)) {
    const agent = record(raw);
    const agentName = agent ? own(agent, 'agentName') : undefined;
    const approved = agent ? parseVersion(own(agent, 'approved')) : undefined;
    const pending = agent ? parseVersion(own(agent, 'pending')) : undefined;
    if (typeof agentName !== 'string' || !agentName || agentName.length > MAX_NAME_CHARS) continue;
    if (approved === undefined || pending === undefined || agentId.length > MAX_NAME_CHARS) continue;
    agents[agentId] = { agentName, approved, pending };
  }
  return agents;
}

/** Per-agent ISO marks (watermarks, sent marks). */
function parseMarks(value: unknown): Record<string, string> {
  const marks: Record<string, string> = {};
  for (const [agentId, at] of Object.entries(record(value) ?? {}).slice(0, MAX_AGENTS)) {
    if (agentId.length <= MAX_NAME_CHARS && isIso(at)) marks[agentId] = at;
  }
  return marks;
}

function parseFingerprints(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && FINGERPRINT.test(item)).slice(-MAX_FINGERPRINTS);
}

function parsePause(value: unknown): AgentProfilesPause | null {
  const obj = record(value);
  if (!obj) return null;
  const reason = PAUSE_REASONS.find((known) => known === own(obj, 'reason'));
  const at = own(obj, 'at');
  return reason && isIso(at) ? { reason, at } : null;
}

function parseStored(raw: string | null): StoredProfiles {
  if (raw === null) return emptyProfiles();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyProfiles();
  }
  const root = record(parsed);
  if (!root || own(root, 'version') !== 1) return emptyProfiles();
  const lastRunAt = own(root, 'lastRunAt');
  return {
    version: 1,
    lastRunAt: isIso(lastRunAt) ? lastRunAt : null,
    watermarks: parseMarks(own(root, 'watermarks')),
    sent: parseMarks(own(root, 'sent')),
    fingerprints: parseFingerprints(own(root, 'fingerprints')),
    idleRuns: count(own(root, 'idleRuns')),
    pause: parsePause(own(root, 'pause')),
    agents: parseAgents(own(root, 'agents')),
  };
}

export class AgentProfileStore {
  constructor(private readonly settings: { getSetting(key: string): string | null; setSetting(key: string, value: string): void }) {}

  load(ownerId: string): StoredProfiles {
    try {
      return parseStored(this.settings.getSetting(this.key(ownerId)));
    } catch {
      return emptyProfiles();
    }
  }

  save(ownerId: string, data: StoredProfiles): boolean {
    try {
      this.settings.setSetting(this.key(ownerId), JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  private key(ownerId: string): string {
    const scope = createHash('sha256').update(JSON.stringify([KEY_PREFIX, ownerId]), 'utf8').digest('hex');
    return `${KEY_PREFIX}:${scope}`;
  }
}

/** New distilled profiles wait for review; an approved profile stays in use until the owner approves. */
export function setPendingProfiles(
  data: StoredProfiles,
  profiles: readonly DistilledProfile[],
  names: Readonly<Record<string, string>>,
  nowMs: number,
): StoredProfiles {
  const at = new Date(nowMs).toISOString();
  const agents = { ...data.agents };
  for (const profile of profiles) {
    const current = Object.hasOwn(agents, profile.agentId) ? agents[profile.agentId] : undefined;
    agents[profile.agentId] = {
      agentName: (names[profile.agentId] ?? current?.agentName ?? profile.agentId).slice(0, MAX_NAME_CHARS),
      approved: current?.approved ?? null,
      pending: { text: profile.text, at },
    };
  }
  return { ...data, agents };
}

export function approveProfile(data: StoredProfiles, agentId: string, nowMs: number): StoredProfiles | null {
  const current = Object.hasOwn(data.agents, agentId) ? data.agents[agentId] : undefined;
  if (!current?.pending) return null;
  const approved = { text: current.pending.text, at: new Date(nowMs).toISOString() };
  return { ...data, agents: { ...data.agents, [agentId]: { ...current, approved, pending: null } } };
}

export function discardProfile(data: StoredProfiles, agentId: string): StoredProfiles | null {
  const current = Object.hasOwn(data.agents, agentId) ? data.agents[agentId] : undefined;
  if (!current?.pending) return null;
  return { ...data, agents: { ...data.agents, [agentId]: { ...current, pending: null } } };
}

/** Stops using the approved profile; a pending one stays for review. An agent left with nothing is dropped. */
export function forgetProfile(data: StoredProfiles, agentId: string): StoredProfiles | null {
  const current = Object.hasOwn(data.agents, agentId) ? data.agents[agentId] : undefined;
  if (!current?.approved) return null;
  const agents = { ...data.agents };
  if (current.pending) agents[agentId] = { ...current, approved: null };
  else delete agents[agentId];
  return { ...data, agents };
}

function advanceMarks(marks: Readonly<Record<string, string>>, newest: Readonly<Record<string, number>>): Record<string, string> {
  const next = { ...marks };
  for (const [agentId, ms] of Object.entries(newest)) {
    const current = Object.hasOwn(next, agentId) ? Date.parse(next[agentId]) : -Infinity;
    if (Number.isFinite(ms) && ms > current) next[agentId] = new Date(ms).toISOString();
  }
  return next;
}

/** Watermarks move forward only. */
export function advanceWatermarks(data: StoredProfiles, newest: Readonly<Record<string, number>>): StoredProfiles {
  return { ...data, watermarks: advanceMarks(data.watermarks, newest) };
}

/** The agent's watermark in ms, never later than now; null when the agent was never distilled. */
export function watermarkMs(data: StoredProfiles, agentId: string, nowMs: number): number | null {
  if (!Object.hasOwn(data.watermarks, agentId)) return null;
  return Math.min(Date.parse(data.watermarks[agentId]), nowMs);
}

/** A run whose answer landed (profiles or an unusable answer): that activity is done. */
export function recordRun(data: StoredProfiles, nowMs: number, newest: Readonly<Record<string, number>>): StoredProfiles {
  return advanceWatermarks({ ...data, lastRunAt: new Date(nowMs).toISOString() }, newest);
}

/** True when some agent has activity newer than anything sent to the model before. */
function hasNewActivity(data: StoredProfiles, newest: Readonly<Record<string, number>>): boolean {
  return Object.entries(newest).some(([agentId, ms]) => !Object.hasOwn(data.sent, agentId) || ms > Date.parse(data.sent[agentId]));
}

/** Why a background run must not call the model, or null when it may. Never asked for the owner's click. */
export function backgroundLoopReason(
  data: StoredProfiles,
  fingerprint: string,
  newest: Readonly<Record<string, number>>,
): AgentProfilesPauseReason | null {
  if (data.fingerprints.includes(fingerprint)) return 'repeat_input';
  if (!hasNewActivity(data, newest) && data.idleRuns + 1 >= AGENT_PROFILES_LOOP_IDLE_RUNS) return 'idle_runs';
  return null;
}

/** Recorded before a run's first model call, whatever comes back. Only background runs count as idle. */
export function recordSend(
  data: StoredProfiles,
  fingerprint: string,
  newest: Readonly<Record<string, number>>,
  trigger: AgentProfilesTrigger,
): StoredProfiles {
  const idleRuns = hasNewActivity(data, newest) ? 0 : data.idleRuns + (trigger === 'background' ? 1 : 0);
  const fingerprints = [...data.fingerprints.filter((known) => known !== fingerprint), fingerprint].slice(-MAX_FINGERPRINTS);
  return { ...data, fingerprints, idleRuns, sent: advanceMarks(data.sent, newest) };
}

export function pauseBackground(data: StoredProfiles, reason: AgentProfilesPauseReason, nowMs: number): StoredProfiles {
  return { ...data, pause: { reason, at: new Date(nowMs).toISOString() } };
}

/** "Tiếp tục": background runs may call again, each remembered input allowed once more. */
export function resumeBackground(data: StoredProfiles): StoredProfiles {
  return { ...data, pause: null, idleRuns: 0, fingerprints: [] };
}

export function toProfilesState(data: StoredProfiles): AgentProfilesState {
  const profiles = Object.entries(data.agents)
    .map(([agentId, agent]) => ({ agentId, agentName: agent.agentName, approved: agent.approved, pending: agent.pending }))
    .sort((a, b) => a.agentName.localeCompare(b.agentName, 'vi'));
  return { profiles, lastRunAt: data.lastRunAt, backgroundPause: data.pause };
}
