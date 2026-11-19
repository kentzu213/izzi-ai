/**
 * Keeps the Care nodes in the signed-in account's MyGraph up to date (design: docs/CARE-GRAPH-AGENTS.md),
 * so izzi agents can read the shop's Care process through the graph.
 *
 * Egress budget: every node write changes the graph ETag, and the next 5-minute sync then downloads the
 * whole node list again. So a node is written only when what it says changes (a fingerprint stored per
 * account, workspace and node), the results node at most once per ~6 hours, and its time is refreshed
 * once a day. Runs after a Care change, shortly after start, then every 6 hours.
 *
 * No duplicates: the backend inserts on every POST, so a node is looked up by its stable url, first in the
 * node list the sync already cached, then (only when one is missing there) in one fresh read. If that read
 * fails nothing is created. An existing node is PATCHed by id.
 *
 * Privacy: the snapshot and the lead summary hold counts, codes, times and the Page name only. Logs are
 * fixed strings. Writes never enter the offline queue; a failed run is simply retried later.
 *
 * @module main/customer-care/care-graph-publisher
 */
import { createHash } from 'node:crypto';
import type { GraphLink, GraphNode, GraphReadResult } from '../../shared/graph-types';
import {
  CARE_GRAPH_COLOR,
  CARE_GRAPH_KINDS,
  buildCareGraphNodes,
  careNodeUrl,
  careWorkspaceKey,
  type CareGraphKind,
  type CareGraphNodeDraft,
  type CareGraphSnapshot,
  type CareLeadSummary,
} from './care-graph-digest';

export const CARE_GRAPH_FIRST_RUN_MS = 2 * 60 * 1000;
export const CARE_GRAPH_REFRESH_MS = 6 * 60 * 60 * 1000;
/** A little under the refresh period, so timer drift never pushes a results write to the next period. */
export const CARE_GRAPH_RESULTS_MIN_MS = CARE_GRAPH_REFRESH_MS - 10 * 60 * 1000;
export const CARE_GRAPH_RESULTS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Lead counts come from the minute lead check; older ones mean it stopped (inbox off, signed out). */
export const CARE_GRAPH_LEADS_MAX_AGE_MS = 15 * 60 * 1000;
const STATE_PREFIX = 'care_graph:v1';
const LINK_LABELS: Partial<Record<CareGraphKind, string>> = { 'care-facts': 'dùng', 'care-results': 'kết quả' };

interface NodeFields {
  title: string;
  content: string;
  color: string;
  nodeType: string;
  metadata: Record<string, unknown>;
}

/** The GraphClient calls the publisher needs (structurally matches GraphClient). */
export interface CareGraphWriter {
  readNodes(): Promise<GraphReadResult<GraphNode>>;
  createNode(input: NodeFields & { url: string }, options: { queueOnOffline: boolean }): Promise<GraphNode | { error: string }>;
  updateNode(id: string, patch: NodeFields, options: { queueOnOffline: boolean }): Promise<{ ok: true } | { error: string }>;
  createLink(sourceId: string, targetId: string, label?: string, color?: string): Promise<GraphLink | { error: string }>;
}

export interface CareGraphPublisherOptions {
  graph: CareGraphWriter;
  /** Care of the signed-in account's active workspace; null when Care is unused, unreadable or not allowed. */
  readSnapshot: () => Promise<CareGraphSnapshot | null>;
  /** The node list the 5-minute sync cached (`graph_nodes`); read locally, may be stale or empty. */
  readCachedNodes: () => unknown;
  currentIdentityId: () => string | null;
  currentWorkspaceId: () => string | null;
  store: { getSetting(key: string): string | null; setSetting(key: string, value: string): void };
  now?: () => number;
  /** Fixed diagnostics only. */
  log?: (message: string) => void;
}

interface NodeState {
  fingerprint: string;
  writtenAt: number;
}

interface LeadNote {
  identityId: string;
  workspaceId: string;
  summary: CareLeadSummary;
  at: number;
}

function stateKey(identityId: string, wsKey: string, kind: CareGraphKind): string {
  const scope = createHash('sha256').update(JSON.stringify([STATE_PREFIX, identityId, wsKey, kind]), 'utf8').digest('hex');
  return `${STATE_PREFIX}:${scope}`;
}

function parseState(raw: string | null): NodeState | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== 'object') return null;
    const { fingerprint, writtenAt } = value as Record<string, unknown>;
    if (typeof fingerprint !== 'string' || typeof writtenAt !== 'number' || !Number.isFinite(writtenAt)) return null;
    return { fingerprint, writtenAt };
  } catch {
    return null;
  }
}

/** url → id of the most recently updated node with that url, among the wanted urls only. */
function indexByUrl(nodes: unknown, urls: ReadonlySet<string>): Map<string, string> {
  const best = new Map<string, { id: string; updatedMs: number }>();
  if (!Array.isArray(nodes)) return new Map();
  for (const node of nodes) {
    if (node === null || typeof node !== 'object') continue;
    const { id, url, updatedAt } = node as Record<string, unknown>;
    if (typeof id !== 'string' || !id || typeof url !== 'string' || !urls.has(url)) continue;
    const updatedMs = typeof updatedAt === 'string' && Number.isFinite(Date.parse(updatedAt)) ? Date.parse(updatedAt) : 0;
    const current = best.get(url);
    if (!current || updatedMs > current.updatedMs) best.set(url, { id, updatedMs });
  }
  return new Map([...best].map(([url, value]) => [url, value.id]));
}

export class CareGraphPublisher {
  private firstRun: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private rerun = false;
  private lead: LeadNote | null = null;
  private readonly now: () => number;

  constructor(private readonly options: CareGraphPublisherOptions) {
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.firstRun || this.timer) return;
    this.firstRun = setTimeout(() => {
      this.firstRun = null;
      void this.run();
      this.timer = setInterval(() => { void this.run(); }, CARE_GRAPH_REFRESH_MS);
    }, CARE_GRAPH_FIRST_RUN_MS);
  }

  stop(): void {
    if (this.firstRun) clearTimeout(this.firstRun);
    if (this.timer) clearInterval(this.timer);
    this.firstRun = null;
    this.timer = null;
    this.rerun = false;
  }

  /** From the minute lead check: counts only. Kept for the next run; never triggers a write by itself. */
  noteLeadSummary(identityId: string, workspaceId: string, summary: CareLeadSummary): void {
    this.lead = { identityId, workspaceId, summary: { ...summary }, at: this.now() };
  }

  /** Care setup or the automatic-reply switch changed: publish now (or right after the run in flight). */
  requestPublish(): void {
    this.rerun = true;
    void this.run();
  }

  /** Single-flight: a run that starts while another is going does nothing; a request queues one more. */
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.rerun = false;
    try {
      await this.publish();
    } catch {
      this.log('care graph run failed');
    } finally {
      this.running = false;
      if (this.rerun) void this.run();
    }
  }

  private async publish(): Promise<void> {
    const identityId = this.identity();
    if (!identityId) return;
    let snapshot: CareGraphSnapshot | null;
    try {
      snapshot = await this.options.readSnapshot();
    } catch {
      this.log('care graph read failed');
      return;
    }
    if (!snapshot || !this.isCurrent(identityId, snapshot)) return;

    const wsKey = careWorkspaceKey(snapshot.identityId, snapshot.workspaceId);
    const nowMs = this.now();
    const drafts = buildCareGraphNodes(
      { ...snapshot.source, leads: this.leadsFor(snapshot, nowMs) },
      wsKey,
      new Date(nowMs).toISOString(),
    );
    const due = drafts.filter((draft) => this.isDue(draft, parseState(this.read(stateKey(identityId, wsKey, draft.kind))), nowMs));
    if (due.length === 0) return;

    const existing = await this.findExisting(wsKey, due);
    if (!existing || !this.isCurrent(identityId, snapshot)) return;
    const ids = new Map<CareGraphKind, string>();
    for (const kind of CARE_GRAPH_KINDS) {
      const id = existing.get(careNodeUrl(kind, wsKey));
      if (id) ids.set(kind, id);
    }
    const created = new Set<CareGraphKind>();
    for (const draft of due) {
      // The account or workspace may have changed while an earlier node was written.
      if (!this.isCurrent(identityId, snapshot)) return;
      const written = await this.write(draft, ids.get(draft.kind));
      if (!written) return;
      ids.set(draft.kind, written.id);
      if (written.created) created.add(draft.kind);
      this.save(stateKey(identityId, wsKey, draft.kind), { fingerprint: draft.fingerprint, writtenAt: nowMs });
    }
    if (!this.isCurrent(identityId, snapshot)) return;
    await this.link(ids, created);
  }

  private isDue(draft: CareGraphNodeDraft, state: NodeState | null, nowMs: number): boolean {
    if (!state) return true;
    const age = nowMs - state.writtenAt;
    if (draft.kind !== 'care-results') return state.fingerprint !== draft.fingerprint;
    if (age >= CARE_GRAPH_RESULTS_MAX_AGE_MS) return true;
    return state.fingerprint !== draft.fingerprint && age >= CARE_GRAPH_RESULTS_MIN_MS;
  }

  /**
   * The ids of this workspace's Care nodes, by url. The synced cache answers when it holds every node about
   * to be written; otherwise one fresh read decides. Null when that read fails: better no write than a
   * duplicate node.
   */
  private async findExisting(wsKey: string, due: readonly CareGraphNodeDraft[]): Promise<Map<string, string> | null> {
    const urls = new Set(CARE_GRAPH_KINDS.map((kind) => careNodeUrl(kind, wsKey)));
    let cached: unknown;
    try {
      cached = this.options.readCachedNodes();
    } catch {
      cached = null;
    }
    const fromCache = indexByUrl(cached, urls);
    if (due.every((draft) => fromCache.has(draft.url))) return fromCache;
    try {
      const fresh = await this.options.graph.readNodes();
      if (fresh.data !== null) return indexByUrl(fresh.data, urls);
    } catch {
      // Reported below.
    }
    this.log('care graph read failed');
    return null;
  }

  private async write(draft: CareGraphNodeDraft, existingId: string | undefined): Promise<{ id: string; created: boolean } | null> {
    const fields: NodeFields = {
      title: draft.title,
      content: draft.content,
      color: draft.color,
      nodeType: draft.nodeType,
      metadata: { ...draft.metadata } as Record<string, unknown>,
    };
    try {
      if (existingId) {
        const updated = await this.options.graph.updateNode(existingId, fields, { queueOnOffline: false });
        if ('error' in updated) throw new Error('update failed');
        return { id: existingId, created: false };
      }
      const node = await this.options.graph.createNode({ ...fields, url: draft.url }, { queueOnOffline: false });
      if ('error' in node || typeof node.id !== 'string' || !node.id) throw new Error('create failed');
      return { id: node.id, created: true };
    } catch {
      this.log('care graph write failed');
      return null;
    }
  }

  /** New child nodes hang under the process node; a new process node takes every known child. */
  private async link(ids: Map<CareGraphKind, string>, created: Set<CareGraphKind>): Promise<void> {
    const processId = ids.get('care-process');
    if (!processId) return;
    for (const kind of ['care-facts', 'care-results'] as const) {
      const childId = ids.get(kind);
      if (!childId || !(created.has(kind) || created.has('care-process'))) continue;
      try {
        const link = await this.options.graph.createLink(processId, childId, LINK_LABELS[kind], CARE_GRAPH_COLOR);
        if ('error' in link) this.log('care graph link failed');
      } catch {
        this.log('care graph link failed');
      }
    }
  }

  private leadsFor(snapshot: CareGraphSnapshot, nowMs: number): CareLeadSummary | null {
    const lead = this.lead;
    if (!lead || lead.identityId !== snapshot.identityId || lead.workspaceId !== snapshot.workspaceId) return null;
    return nowMs - lead.at <= CARE_GRAPH_LEADS_MAX_AGE_MS ? lead.summary : null;
  }

  private isCurrent(identityId: string, snapshot: CareGraphSnapshot): boolean {
    if (snapshot.identityId !== identityId || this.identity() !== identityId) return false;
    try {
      return this.options.currentWorkspaceId() === snapshot.workspaceId;
    } catch {
      return false;
    }
  }

  private identity(): string | null {
    try {
      const identityId = this.options.currentIdentityId();
      return typeof identityId === 'string' && identityId ? identityId : null;
    } catch {
      return null;
    }
  }

  private read(key: string): string | null {
    try {
      return this.options.store.getSetting(key);
    } catch {
      return null;
    }
  }

  private save(key: string, state: NodeState): void {
    try {
      this.options.store.setSetting(key, JSON.stringify(state));
    } catch {
      this.log('care graph state not saved');
    }
  }

  private log(message: string): void {
    try {
      this.options.log?.(message);
    } catch {
      // Diagnostics must never break a run.
    }
  }
}
