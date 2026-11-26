/**
 * Agent Profiles S3 (docs/MYGRAPH-AGENT-MEMORY.md §5):
 *  1. Hourly auto-scheduler: triggers `AgentProfileService.refresh()` ONLY when:
 *     - >= 20 hours elapsed since last scheduled run for this account,
 *     - machine has been idle >= 5 minutes (or wake/start catch-up once due & idle),
 *     - signed-in account has new activity (cheaply skipped by `refresh()` otherwise),
 *     - respects HTTP 402 quota stop & daily caps.
 *     Default mode stays `review` (drafts await owner approval in Memory → Hồ sơ agent).
 *  2. Fingerprint-guarded Cloud MyGraph mirror:
 *     - Mirrors ONLY owner-approved agent profiles (`Hồ sơ agent · <tên>`) at stable URLs.
 *     - At most 1 write per ~20h per agent when SHA-256 fingerprint actually changed.
 *     - Never duplicates: checks cached `graph_nodes`, then 1 fresh `readNodes()` (skips
 *       create if list hits PostgREST 1000-row cap); `queueOnOffline: false`.
 *     - Double PII/secret gate (`redactPersonalData` + `containsSensitiveMaterial`) fail-closed.
 *
 * @module main/agents/memory/agent-profile-s3
 */

import { createHash } from 'node:crypto';
import type { AgentProfilesResult } from '../../../shared/agent-profile-types';
import type { GraphNode, GraphReadResult } from '../../../shared/graph-types';
import { containsSensitiveMaterial } from '../../../shared/secret-pii-gate';
import { redactPersonalData } from './memory-redact';

export const AGENT_PROFILE_S3_CHECK_MS = 60 * 60 * 1000;
export const AGENT_PROFILE_S3_FIRST_CHECK_MS = 90 * 1000;
export const AGENT_PROFILE_S3_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000;
export const AGENT_PROFILE_S3_IDLE_SECONDS = 5 * 60;
export const AGENT_PROFILE_GRAPH_NODE_CAP = 1000;

const GRAPH_URL = 'https://izziapi.com/aibase/graph';
const MIRROR_COLOR = '#7c4dff';
const STATE_PREFIX = 'agent_profile_s3:v1';

interface MirrorNodeState {
  fingerprint: string;
  writtenAt: number;
}

export interface AgentProfileGraphWriter {
  readNodes(): Promise<GraphReadResult<GraphNode>>;
  createNode(
    input: { title: string; content: string; color: string; nodeType: string; url: string; metadata: Record<string, unknown> },
    options: { queueOnOffline: boolean },
  ): Promise<GraphNode | { error: string }>;
  updateNode(
    id: string,
    patch: { title: string; content: string; color: string; nodeType: string; metadata: Record<string, unknown> },
    options: { queueOnOffline: boolean },
  ): Promise<{ ok: true } | { error: string }>;
}

export interface AgentProfileS3Options {
  profileService: {
    getState(): AgentProfilesResult;
    refresh(): Promise<AgentProfilesResult>;
  };
  graph: AgentProfileGraphWriter;
  readCachedNodes: () => unknown;
  currentOwnerId: () => string | null;
  getSystemIdleSeconds: () => number;
  store: { getSetting(key: string): string | null; setSetting(key: string, value: string): void };
  isEnabled?: () => boolean;
  now?: () => number;
  log?: (message: string) => void;
}

function hashKey(parts: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex');
}

function ownerHash(ownerId: string): string {
  return hashKey([STATE_PREFIX, 'owner', ownerId]).slice(0, 16);
}

function slugAgent(agentId: string): string {
  return agentId
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'agent';
}

export function agentProfileNodeUrl(ownerId: string, agentId: string): string {
  return `${GRAPH_URL}?agent-profile=${ownerHash(ownerId)}&agent=${slugAgent(agentId)}`;
}

function autoRunKey(ownerId: string): string {
  return `${STATE_PREFIX}:autorun:${hashKey([STATE_PREFIX, 'autorun', ownerId])}`;
}

function mirrorKey(ownerId: string, agentId: string): string {
  return `${STATE_PREFIX}:mirror:${hashKey([STATE_PREFIX, 'mirror', ownerId, agentId])}`;
}

function parseMirrorState(raw: string | null): MirrorNodeState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.fingerprint === 'string' &&
      typeof parsed.writtenAt === 'number' &&
      Number.isFinite(parsed.writtenAt)
    ) {
      return { fingerprint: parsed.fingerprint, writtenAt: parsed.writtenAt };
    }
    return null;
  } catch {
    return null;
  }
}

function indexByUrl(nodes: unknown, urls: ReadonlySet<string>): Map<string, string> {
  const best = new Map<string, { id: string; updatedMs: number }>();
  if (!Array.isArray(nodes)) return new Map();
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const { id, url, updatedAt } = node as Record<string, unknown>;
    if (typeof id !== 'string' || !id || typeof url !== 'string' || !urls.has(url)) continue;
    const updatedMs = typeof updatedAt === 'string' && Number.isFinite(Date.parse(updatedAt)) ? Date.parse(updatedAt) : 0;
    const cur = best.get(url);
    if (!cur || updatedMs > cur.updatedMs) best.set(url, { id, updatedMs });
  }
  return new Map([...best].map(([u, v]) => [u, v.id]));
}

export class AgentProfileS3Coordinator {
  private firstTimer: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private readonly now: () => number;

  constructor(private readonly options: AgentProfileS3Options) {
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.firstTimer || this.timer) return;
    this.firstTimer = setTimeout(() => {
      this.firstTimer = null;
      void this.tick();
      this.timer = setInterval(() => {
        void this.tick();
      }, AGENT_PROFILE_S3_CHECK_MS);
    }, AGENT_PROFILE_S3_FIRST_CHECK_MS);
  }

  stop(): void {
    if (this.firstTimer) clearTimeout(this.firstTimer);
    if (this.timer) clearInterval(this.timer);
    this.firstTimer = null;
    this.timer = null;
  }

  /** Catch-up hook when the machine wakes from sleep or unlocks. */
  onSystemWake(): void {
    void this.tick();
  }

  /** Single-flight hourly check: auto-distill when >= 20h & >= 5m idle, then mirror approved profiles. */
  async tick(): Promise<{ distilled: boolean; mirrored: number }> {
    if (this.running) return { distilled: false, mirrored: 0 };
    if (this.options.isEnabled && !this.options.isEnabled()) return { distilled: false, mirrored: 0 };
    const ownerId = this.options.currentOwnerId();
    if (!ownerId) return { distilled: false, mirrored: 0 };

    this.running = true;
    let distilled = false;
    let mirrored = 0;

    try {
      const nowMs = this.now();
      const lastRaw = this.options.store.getSetting(autoRunKey(ownerId));
      const lastRunMs = lastRaw !== null && Number.isFinite(Number(lastRaw)) ? Number(lastRaw) : 0;
      const idleSec = this.options.getSystemIdleSeconds();

      if (nowMs - lastRunMs >= AGENT_PROFILE_S3_MIN_INTERVAL_MS && idleSec >= AGENT_PROFILE_S3_IDLE_SECONDS) {
        const res = await this.options.profileService.refresh();
        if (res.ok || res.error === 'quota' || res.error === 'daily_limit') {
          this.options.store.setSetting(autoRunKey(ownerId), String(nowMs));
        }
        if (res.ok) distilled = true;
      }

      mirrored = await this.mirrorApprovedProfilesToGraph(ownerId);
    } catch {
      this.options.log?.('agent profile S3 tick failed');
    } finally {
      this.running = false;
    }

    return { distilled, mirrored };
  }

  /** Mirror owner-approved agent profiles to Cloud MyGraph (0% PII, fingerprint-deduped, <= 1/day). */
  async mirrorApprovedProfilesToGraph(explicitOwnerId?: string): Promise<number> {
    const ownerId = explicitOwnerId ?? this.options.currentOwnerId();
    if (!ownerId) return 0;

    const stateRes = this.options.profileService.getState();
    if (!stateRes.ok) return 0;

    const nowMs = this.now();
    const candidates: Array<{
      agentId: string;
      url: string;
      title: string;
      content: string;
      fingerprint: string;
      metadata: Record<string, unknown>;
    }> = [];

    for (const agent of stateRes.state.profiles) {
      if (!agent.approved?.text) continue;
      const cleanName = redactPersonalData(agent.agentName || agent.agentId).trim().slice(0, 60);
      const cleanText = redactPersonalData(agent.approved.text).trim();
      if (!cleanText || containsSensitiveMaterial({ cleanName, cleanText })) {
        continue; // Fail-closed: never mirror PII/secret-bearing profile to Cloud MyGraph!
      }

      const title = `Hồ sơ agent · ${cleanName}`;
      const content = `# ${title}\n\n${cleanText}`;
      const url = agentProfileNodeUrl(ownerId, agent.agentId);
      const fingerprint = hashKey([title, content]);
      const prev = parseMirrorState(this.options.store.getSetting(mirrorKey(ownerId, agent.agentId)));

      if (prev && prev.fingerprint === fingerprint) continue;
      if (prev && nowMs - prev.writtenAt < AGENT_PROFILE_S3_MIN_INTERVAL_MS) continue;

      candidates.push({
        agentId: agent.agentId,
        url,
        title,
        content,
        fingerprint,
        metadata: {
          kind: 'agent-profile-mirror',
          schema: 1,
          agentId: agent.agentId,
          tags: ['agent-profile', slugAgent(agent.agentId)],
        },
      });
    }

    if (candidates.length === 0) return 0;

    const wantedUrls = new Set(candidates.map((c) => c.url));
    let idByUrl = indexByUrl(this.options.readCachedNodes(), wantedUrls);
    let listCapped = false;

    if (candidates.some((c) => !idByUrl.has(c.url))) {
      const fresh = await this.options.graph.readNodes();
      if (fresh.data === null) return 0; // Fail-closed: never risk creating duplicates on read failure.
      listCapped = fresh.data.length >= AGENT_PROFILE_GRAPH_NODE_CAP;
      idByUrl = indexByUrl(fresh.data, wantedUrls);
    }

    let written = 0;
    for (const c of candidates) {
      if (this.options.currentOwnerId() !== ownerId) break;
      const existingId = idByUrl.get(c.url);
      if (existingId) {
        const res = await this.options.graph.updateNode(
          existingId,
          { title: c.title, content: c.content, color: MIRROR_COLOR, nodeType: 'wiki', metadata: c.metadata },
          { queueOnOffline: false },
        );
        if ('error' in res) continue;
      } else {
        if (listCapped) continue; // Cannot prove node absent when list hit 1000-row cap.
        const res = await this.options.graph.createNode(
          { title: c.title, content: c.content, color: MIRROR_COLOR, nodeType: 'wiki', url: c.url, metadata: c.metadata },
          { queueOnOffline: false },
        );
        if ('error' in res) continue;
      }

      this.options.store.setSetting(
        mirrorKey(ownerId, c.agentId),
        JSON.stringify({ fingerprint: c.fingerprint, writtenAt: nowMs } satisfies MirrorNodeState),
      );
      written += 1;
    }

    return written;
  }
}
