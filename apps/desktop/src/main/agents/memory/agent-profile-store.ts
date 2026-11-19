/**
 * Local store for agent profiles (docs/MYGRAPH-AGENT-MEMORY.md, S2). One settings row per account under
 * a hashed key, so profiles never cross accounts on a shared machine and no table changes are needed.
 * State changes return new objects; the stored JSON is re-validated on every load.
 *
 * Each agent has its own watermark (the newest activity already distilled). Watermarks only move
 * forward, and one in the future (clock skew) is read as now.
 *
 * @module main/agents/memory/agent-profile-store
 */
import { createHash } from 'node:crypto';
import type { AgentProfileVersion, AgentProfilesState } from '../../../shared/agent-profile-types';
import { PROFILE_MAX_CHARS, type DistilledProfile } from './agent-profile-digest';

/** Credit cap: distil runs per account per Vietnam day. */
export const AGENT_PROFILES_MAX_RUNS_PER_DAY = 3;
/** Credit cap on model calls (fallbacks and failed calls included) per account per Vietnam day. */
export const AGENT_PROFILES_MAX_CALLS_PER_DAY = 6;
const KEY_PREFIX = 'agent_profiles:v1';
const MAX_AGENTS = 50;
const MAX_NAME_CHARS = 100;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export interface StoredAgentProfile {
  agentName: string;
  approved: AgentProfileVersion | null;
  pending: AgentProfileVersion | null;
}

export interface StoredProfiles {
  version: 1;
  lastRunAt: string | null;
  runDay: string | null;
  runsToday: number;
  callDay: string | null;
  callsToday: number;
  /** Per agent: the newest activity already distilled (ISO). */
  watermarks: Record<string, string>;
  agents: Record<string, StoredAgentProfile>;
}

export function emptyProfiles(): StoredProfiles {
  return { version: 1, lastRunAt: null, runDay: null, runsToday: 0, callDay: null, callsToday: 0, watermarks: {}, agents: {} };
}

/** The calendar day in Vietnam (UTC+7, no daylight saving), YYYY-MM-DD. */
export function vnDayKey(nowMs: number): string {
  return new Date(nowMs + VN_OFFSET_MS).toISOString().slice(0, 10);
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

function parseWatermarks(value: unknown): Record<string, string> {
  const watermarks: Record<string, string> = {};
  for (const [agentId, at] of Object.entries(record(value) ?? {}).slice(0, MAX_AGENTS)) {
    if (agentId.length <= MAX_NAME_CHARS && isIso(at)) watermarks[agentId] = at;
  }
  return watermarks;
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
  const runDay = own(root, 'runDay');
  const callDay = own(root, 'callDay');
  return {
    version: 1,
    lastRunAt: isIso(lastRunAt) ? lastRunAt : null,
    runDay: typeof runDay === 'string' && DAY.test(runDay) ? runDay : null,
    runsToday: count(own(root, 'runsToday')),
    callDay: typeof callDay === 'string' && DAY.test(callDay) ? callDay : null,
    callsToday: count(own(root, 'callsToday')),
    watermarks: parseWatermarks(own(root, 'watermarks')),
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

/** Watermarks move forward only. */
export function advanceWatermarks(data: StoredProfiles, newest: Readonly<Record<string, number>>): StoredProfiles {
  const watermarks = { ...data.watermarks };
  for (const [agentId, ms] of Object.entries(newest)) {
    const current = Object.hasOwn(watermarks, agentId) ? Date.parse(watermarks[agentId]) : -Infinity;
    if (Number.isFinite(ms) && ms > current) watermarks[agentId] = new Date(ms).toISOString();
  }
  return { ...data, watermarks };
}

/** The agent's watermark in ms, never later than now; null when the agent was never distilled. */
export function watermarkMs(data: StoredProfiles, agentId: string, nowMs: number): number | null {
  if (!Object.hasOwn(data.watermarks, agentId)) return null;
  return Math.min(Date.parse(data.watermarks[agentId]), nowMs);
}

/** A run that cost a model call and produced profiles or an unusable answer: counted against the cap. */
export function recordRun(data: StoredProfiles, nowMs: number, newest: Readonly<Record<string, number>>): StoredProfiles {
  const day = vnDayKey(nowMs);
  return advanceWatermarks({
    ...data,
    lastRunAt: new Date(nowMs).toISOString(),
    runDay: day,
    runsToday: data.runDay === day ? data.runsToday + 1 : 1,
  }, newest);
}

/** One model call, whatever its outcome. */
export function countCall(data: StoredProfiles, nowMs: number): StoredProfiles {
  const day = vnDayKey(nowMs);
  return { ...data, callDay: day, callsToday: data.callDay === day ? data.callsToday + 1 : 1 };
}

export function runsToday(data: StoredProfiles, nowMs: number): number {
  return data.runDay === vnDayKey(nowMs) ? data.runsToday : 0;
}

export function callsToday(data: StoredProfiles, nowMs: number): number {
  return data.callDay === vnDayKey(nowMs) ? data.callsToday : 0;
}

export function toProfilesState(data: StoredProfiles, nowMs: number): AgentProfilesState {
  const profiles = Object.entries(data.agents)
    .map(([agentId, agent]) => ({ agentId, agentName: agent.agentName, approved: agent.approved, pending: agent.pending }))
    .sort((a, b) => a.agentName.localeCompare(b.agentName, 'vi'));
  return {
    profiles,
    lastRunAt: data.lastRunAt,
    runsToday: runsToday(data, nowMs),
    maxRunsPerDay: AGENT_PROFILES_MAX_RUNS_PER_DAY,
    callsToday: callsToday(data, nowMs),
    maxCallsPerDay: AGENT_PROFILES_MAX_CALLS_PER_DAY,
  };
}
