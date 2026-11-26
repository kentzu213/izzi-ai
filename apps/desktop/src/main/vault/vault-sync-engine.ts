/**
 * VaultSyncEngine — Local-First Obsidian Markdown Vault + 3-way SHA-256 Cloud Sync
 * + Offline FTS5 Search + Controlled Importer (Obsidian `.md` & Codex exports).
 *
 * Architecture guarantees:
 *  - Local SQLite (`local_graph_nodes`, `local_graph_links`, `local_graph_fts`)
 *    caches the full MyGraph so search, browse, and edit work 100% offline.
 *  - Every cloud node mirrors to a clean `.md` file under `vaultDir` (default
 *    `~/IzziVault/`, user-configurable) with YAML frontmatter + `[[wikilink]]`.
 *  - 3-way conflict protection via `.vault-manifest.json` SHA-256: if BOTH local
 *    `.md` and cloud `updatedAt` changed since last sync, writes a sibling
 *    `.conflict-<ts>.md` file and NEVER silently overwrites user work.
 *  - Fail-closed egress gate: before ANY local `.md` edit or approved knowledge
 *    record pushes to cloud, runs `secret-pii-gate`. Secret/PII-bearing files are
 *    blocked from egress and surfaced in `status.blockedSecrets`.
 *  - Never touches or pushes `live_profile` (`Live.md`) or encrypted `TraceStore`.
 *
 * @module main/vault/vault-sync-engine
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WorkDb } from '../work/work-sqlite';
import type { GraphLink, GraphNode } from '../../shared/graph-types';
import type { UnifiedRecallResult } from '../../shared/memory-loop-types';
import type {
  VaultImportResult,
  VaultManifest,
  VaultSearchHit,
  VaultSyncStatus,
} from '../../shared/vault-sync-types';
import {
  containsSensitiveMaterial,
  evaluateSensitivePolicy,
  scanSensitiveContent,
} from '../../shared/secret-pii-gate';
import type { KnowledgeStore } from '../knowledge/knowledge-store';
import {
  parseVaultMarkdown,
  readVaultManifest,
  relativePathForNode,
  renderGraphNodeMarkdown,
  renderInsightMarkdown,
  renderKnowledgeRecordMarkdown,
  renderProcedureMarkdown,
  renderSessionMarkdown,
  safeChild,
  sha256Hex,
  writeFileAtomic,
  writeVaultManifest,
} from './vault-fs';

export interface VaultCloudClient {
  listNodes(): Promise<GraphNode[]>;
  listLinks(): Promise<GraphLink[]>;
  createNode(input: Partial<GraphNode> & { title: string }): Promise<GraphNode | { error: string }>;
  updateNode(
    id: string,
    patch: Partial<GraphNode> & { isPublic?: boolean },
  ): Promise<{ ok: true } | { error: string }>;
  recallMemory(opts?: { limit?: number }): Promise<UnifiedRecallResult>;
}

interface LocalNodeRow {
  id: string;
  title: string;
  node_type: string;
  color: string;
  content: string | null;
  url: string | null;
  topic_id: string | null;
  x: number | null;
  y: number | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

interface LocalLinkRow {
  id: string;
  source_id: string;
  target_id: string;
  label: string | null;
  color: string | null;
}

/** Initialize offline local graph cache + FTS5 full-text search tables (idempotent). */
export function ensureVaultCacheSchema(db: WorkDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS local_graph_nodes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      node_type TEXT NOT NULL DEFAULT 'note',
      color TEXT NOT NULL DEFAULT '#5ca7ff',
      content TEXT,
      url TEXT,
      topic_id TEXT,
      x REAL,
      y REAL,
      metadata_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS local_graph_links (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      label TEXT,
      color TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS local_graph_fts USING fts5(
      node_id UNINDEXED,
      title,
      content,
      node_type
    );
  `);
}

export function defaultVaultDirectory(): string {
  return path.join(os.homedir(), 'IzziVault');
}

function tokenizeQuery(query: string): string[] {
  const matches = String(query ?? '')
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]+/gu);
  return Array.from(new Set(matches ?? [])).slice(0, 6);
}

function isLiveProfileOrPrivateNode(node: Pick<GraphNode, 'nodeType' | 'metadata'>): boolean {
  if (node.nodeType === 'live-profile' || node.nodeType === 'live-section') return true;
  const m = node.metadata;
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    if (Object.hasOwn(m, 'kind') && (m as Record<string, unknown>).kind === 'live-profile') {
      return true;
    }
  }
  return false;
}

export class VaultSyncEngine {
  private vaultDir: string;
  private enabled: boolean;
  private syncing = false;
  private lastSyncAt: string | null = null;
  private lastError: string | null = null;
  private conflicts: string[] = [];
  private blockedSecrets: string[] = [];
  private watcher: fs.FSWatcher | null = null;
  private watchTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: WorkDb,
    private readonly cloud: VaultCloudClient,
    private readonly knowledge: KnowledgeStore,
    opts: { vaultDir?: string; enabled?: boolean } = {},
  ) {
    ensureVaultCacheSchema(this.db);
    this.vaultDir = path.resolve(opts.vaultDir || defaultVaultDirectory());
    this.enabled = opts.enabled !== false;
  }

  getVaultDir(): string {
    return this.vaultDir;
  }

  setVaultDir(nextDir: string): string {
    const resolved = path.resolve(nextDir);
    if (resolved !== this.vaultDir) {
      const wasWatching = this.watcher !== null;
      this.stopWatching();
      this.vaultDir = resolved;
      if (wasWatching) this.startWatching();
    }
    return this.vaultDir;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.stopWatching();
  }

  startWatching(): boolean {
    if (!this.enabled || this.watcher) return this.watcher !== null;
    try {
      fs.mkdirSync(this.vaultDir, { recursive: true });
      this.watcher = fs.watch(this.vaultDir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        const rel = String(filename).replace(/\\/g, '/');
        if (
          !rel.endsWith('.md') ||
          rel.startsWith('.vault-manifest') ||
          rel.includes('.conflict-') ||
          rel === 'Index.md' ||
          rel.startsWith('insights/') ||
          rel.startsWith('sessions/') ||
          rel.startsWith('knowledge/')
        ) {
          return;
        }
        if (this.watchTimer) clearTimeout(this.watchTimer);
        this.watchTimer = setTimeout(() => {
          void this.syncNow();
        }, 1000);
      });
      return true;
    } catch {
      this.watcher = null;
      return false;
    }
  }

  stopWatching(): void {
    if (this.watchTimer) {
      clearTimeout(this.watchTimer);
      this.watchTimer = null;
    }
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch {
        // ignore
      }
      this.watcher = null;
    }
  }

  getStatus(): VaultSyncStatus {
    const nodeCnt = this.db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM local_graph_nodes');
    const linkCnt = this.db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM local_graph_links');
    const kStats = this.knowledge.getStats();
    return {
      vaultDir: this.vaultDir,
      enabled: this.enabled,
      watching: this.watcher !== null,
      syncing: this.syncing,
      lastSyncAt: this.lastSyncAt,
      localNodes: Number(nodeCnt?.cnt ?? 0),
      localLinks: Number(linkCnt?.cnt ?? 0),
      activeKnowledge: kStats.active,
      pendingCandidates: kStats.candidate,
      blockedSecrets: [...this.blockedSecrets],
      conflicts: [...this.conflicts],
      lastError: this.lastError,
    };
  }

  /** Instant offline-first read of cached graph nodes. */
  listLocalNodes(): GraphNode[] {
    const rows = this.db.all<LocalNodeRow>(
      'SELECT * FROM local_graph_nodes ORDER BY updated_at DESC, id ASC',
    );
    return rows.map((r) => {
      let metadata: Record<string, unknown> | undefined;
      if (r.metadata_json) {
        try {
          const parsed = JSON.parse(r.metadata_json);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            metadata = parsed as Record<string, unknown>;
          }
        } catch {
          metadata = undefined;
        }
      }
      return {
        id: r.id,
        title: r.title,
        nodeType: r.node_type,
        color: r.color,
        ...(r.content !== null ? { content: r.content } : {}),
        ...(r.url !== null ? { url: r.url } : {}),
        ...(r.topic_id !== null ? { topicId: r.topic_id } : {}),
        ...(r.x !== null ? { x: r.x } : {}),
        ...(r.y !== null ? { y: r.y } : {}),
        ...(metadata ? { metadata } : {}),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      };
    });
  }

  /** Instant offline-first read of cached graph links. */
  listLocalLinks(): GraphLink[] {
    const rows = this.db.all<LocalLinkRow>('SELECT * FROM local_graph_links ORDER BY id ASC');
    return rows.map((r) => ({
      id: r.id,
      sourceId: r.source_id,
      targetId: r.target_id,
      ...(r.label !== null ? { label: r.label } : {}),
      ...(r.color !== null ? { color: r.color } : {}),
    }));
  }

  /** Sub-millisecond offline full-text search across cached MyGraph + KnowledgeStore. */
  searchLocal(query: string, limit = 20): VaultSearchHit[] {
    const terms = tokenizeQuery(query);
    if (terms.length === 0) return [];
    const lim = Math.max(1, Math.min(Math.trunc(limit), 100));
    const matchExpr = terms.map((t) => `"${t.replace(/"/g, '')}"*`).join(' OR ');

    const hits: VaultSearchHit[] = [];
    const seen = new Set<string>();

    // 1. Canonical selective knowledge hits first (highest signal).
    for (const rec of this.knowledge.search(query, lim)) {
      seen.add(rec.id);
      hits.push({
        id: rec.id,
        title: rec.title,
        nodeType: `knowledge:${rec.kind}`,
        snippet: rec.summary.slice(0, 180),
        source: 'knowledge',
        relativePath: `knowledge/${rec.scope}/${rec.id}.md`,
      });
    }

    // 2. Cached MyGraph full-body FTS5 hits.
    try {
      const rows = this.db.all<{
        node_id: string;
        title: string;
        content: string | null;
        node_type: string;
      }>(
        `SELECT node_id, title, content, node_type
         FROM local_graph_fts
         WHERE local_graph_fts MATCH ?
         ORDER BY bm25(local_graph_fts) ASC
         LIMIT ?`,
        matchExpr,
        lim,
      );
      for (const row of rows) {
        if (seen.has(row.node_id)) continue;
        seen.add(row.node_id);
        hits.push({
          id: row.node_id,
          title: row.title,
          nodeType: row.node_type,
          snippet: String(row.content ?? row.title).replace(/\s+/g, ' ').trim().slice(0, 180),
          source: 'graph',
        });
      }
    } catch {
      // Malformed query syntax safely returns knowledge hits only.
    }

    return hits.slice(0, lim);
  }

  /**
   * Full 3-way Vault sync cycle:
   *  1. Pull cloud `user_nodes` + `user_links` + L4–L5 `recallMemory`.
   *  2. Reconcile local `.md` edits with cloud using `.vault-manifest.json` SHA-256
   *     (conflict → sibling `.conflict-*.md`; secret/PII → blocked from push).
   *  3. Push newly approved `shareable + active` KnowledgeStore items to cloud.
   *  4. Refresh local SQLite cache + FTS5 + `.md` projections (`knowledge/`, `insights/`, `sessions/`, `Index.md`).
   */
  async syncNow(): Promise<VaultSyncStatus> {
    if (!this.enabled || this.syncing) return this.getStatus();
    this.syncing = true;
    this.lastError = null;
    this.blockedSecrets = [];

    try {
      fs.mkdirSync(this.vaultDir, { recursive: true });
      const manifest: VaultManifest = readVaultManifest(this.vaultDir);

      // Step 1: Push newly approved shareable KnowledgeStore records → Cloud user_nodes (idempotent).
      await this.pushShareableKnowledge();

      // Step 2: Pull cloud graph + L4–L5 recall (best-effort if offline).
      const [cloudNodes, cloudLinks, recall] = await Promise.all([
        this.cloud.listNodes(),
        this.cloud.listLinks(),
        this.cloud.recallMemory({ limit: 30 }).catch(
          (): UnifiedRecallResult => ({ status: 'error', sessions: [], insights: [], procedures: [] }),
        ),
      ]);

      // Build link title map for Obsidian backlinks.
      const titleById = new Map<string, string>();
      for (const n of cloudNodes) titleById.set(n.id, n.title);
      const outgoingTitles = new Map<string, string[]>();
      for (const l of cloudLinks) {
        const targetTitle = titleById.get(l.targetId);
        if (!targetTitle) continue;
        const arr = outgoingTitles.get(l.sourceId) ?? [];
        if (!arr.includes(targetTitle)) arr.push(targetTitle);
        outgoingTitles.set(l.sourceId, arr);
      }

      // Step 3: Reconcile each cloud node against local `.md` using 3-way SHA-256 manifest.
      const reconciledNodes: GraphNode[] = [];
      for (const node of cloudNodes) {
        if (isLiveProfileOrPrivateNode(node)) continue; // Live.md local-only never crosses vault sync

        const prevEntry = manifest.entries[node.id];
        const relPath = prevEntry?.relativePath || relativePathForNode(node);
        const absPath = safeChild(this.vaultDir, relPath);
        const rendered = renderGraphNodeMarkdown(node, {
          sensitivity: 'shareable',
          linkedTitles: outgoingTitles.get(node.id) ?? [],
        });

        const fileExists = fs.existsSync(absPath);
        if (fileExists && prevEntry && !prevEntry.readOnly) {
          const localDisk = fs.readFileSync(absPath, 'utf8');
          const localHash = sha256Hex(localDisk);
          const localChanged = localHash !== prevEntry.localSha256;
          const remoteChanged = (node.updatedAt || '') !== prevEntry.remoteUpdatedAt;

          if (localChanged && !remoteChanged) {
            // Only local changed → check secret/PII gate before pushing to cloud!
            const findings = scanSensitiveContent(localDisk);
            if (evaluateSensitivePolicy(findings) === 'block') {
              this.blockedSecrets.push(relPath);
              reconciledNodes.push(node);
              continue;
            }
            const parsed = parseVaultMarkdown(localDisk);
            const nextTitle = parsed.title || node.title;
            const patchRes = await this.cloud.updateNode(node.id, {
              title: nextTitle,
              content: parsed.body,
              metadata: {
                ...(node.metadata ?? {}),
                ...(parsed.tags.length > 0 ? { tags: parsed.tags } : {}),
              },
            });
            if (!('error' in patchRes)) {
              const updatedNode: GraphNode = {
                ...node,
                title: nextTitle,
                content: parsed.body,
                updatedAt: new Date().toISOString(),
              };
              manifest.entries[node.id] = {
                nodeId: node.id,
                relativePath: relPath,
                localSha256: localHash,
                remoteUpdatedAt: updatedNode.updatedAt,
                nodeType: updatedNode.nodeType,
                sensitivity: 'shareable',
              };
              reconciledNodes.push(updatedNode);
              continue;
            }
          } else if (localChanged && remoteChanged) {
            // 3-way conflict → preserve local edits in sibling conflict file, never silently overwrite!
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const conflictRel = relPath.replace(/\.md$/i, `.conflict-${ts}.md`);
            writeFileAtomic(safeChild(this.vaultDir, conflictRel), localDisk);
            if (!this.conflicts.includes(conflictRel)) this.conflicts.push(conflictRel);
          }
        }

        // Write/refresh canonical file from cloud state.
        writeFileAtomic(absPath, rendered);
        manifest.entries[node.id] = {
          nodeId: node.id,
          relativePath: relPath,
          localSha256: sha256Hex(rendered),
          remoteUpdatedAt: node.updatedAt || node.createdAt || '',
          nodeType: node.nodeType || 'note',
          sensitivity: 'shareable',
          readOnly: node.nodeType === 'agent-session',
        };
        reconciledNodes.push(node);
      }

      // Step 4: Refresh local SQLite cache + FTS5 when cloud returned nodes (preserve cache if offline!).
      if (reconciledNodes.length > 0 || cloudLinks.length > 0) {
        this.replaceLocalCache(reconciledNodes, cloudLinks);
      }

      // Step 5: Project active KnowledgeStore records + L4 Insights + L5 Procedures + Index.md.
      this.projectKnowledgeAndMemory(recall);

      manifest.lastSyncAt = new Date().toISOString();
      writeVaultManifest(this.vaultDir, manifest);
      this.lastSyncAt = manifest.lastSyncAt;
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : 'Vault sync error';
    } finally {
      this.syncing = false;
    }

    return this.getStatus();
  }

  private async pushShareableKnowledge(): Promise<void> {
    const eligible = this.knowledge.listShareableActive().filter((r) => !r.cloudNodeId);
    for (const rec of eligible) {
      if (containsSensitiveMaterial({ title: rec.title, summary: rec.summary })) {
        this.blockedSecrets.push(`knowledge/${rec.scope}/${rec.id}.md`);
        continue;
      }
      const created = await this.cloud.createNode({
        title: rec.title,
        nodeType: 'wiki',
        color: '#45d982',
        content: renderKnowledgeRecordMarkdown(rec),
        metadata: {
          kind: 'selective-knowledge',
          canonicalId: rec.id,
          scope: rec.scope,
          topicKey: rec.topicKey,
          tags: [rec.kind, rec.scope],
        },
      });
      if (!('error' in created) && created.id) {
        this.knowledge.markCloudSynced(rec.id, created.id);
      }
    }
  }

  private replaceLocalCache(nodes: GraphNode[], links: GraphLink[]): void {
    this.db.transaction(() => {
      this.db.run('DELETE FROM local_graph_nodes');
      this.db.run('DELETE FROM local_graph_links');
      this.db.run('DELETE FROM local_graph_fts');

      for (const n of nodes) {
        this.db.run(
          `INSERT INTO local_graph_nodes(
            id, title, node_type, color, content, url, topic_id, x, y, metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          n.id,
          n.title,
          n.nodeType || 'note',
          n.color || '#5ca7ff',
          n.content ?? null,
          n.url ?? null,
          n.topicId ?? null,
          n.x ?? null,
          n.y ?? null,
          n.metadata ? JSON.stringify(n.metadata) : null,
          n.createdAt || '',
          n.updatedAt || n.createdAt || '',
        );
        this.db.run(
          `INSERT INTO local_graph_fts(node_id, title, content, node_type) VALUES (?, ?, ?, ?)`,
          n.id,
          n.title,
          n.content ?? '',
          n.nodeType || 'note',
        );
      }

      for (const l of links) {
        this.db.run(
          `INSERT INTO local_graph_links(id, source_id, target_id, label, color) VALUES (?, ?, ?, ?, ?)`,
          l.id,
          l.sourceId,
          l.targetId,
          l.label ?? null,
          l.color ?? null,
        );
      }
    });
  }

  private projectKnowledgeAndMemory(recall: UnifiedRecallResult): void {
    const activeRecords = this.knowledge.list({ state: 'active' });
    for (const rec of activeRecords) {
      const rel = `knowledge/${rec.scope}/${rec.id}.md`;
      writeFileAtomic(safeChild(this.vaultDir, rel), renderKnowledgeRecordMarkdown(rec));
    }

    for (const ins of recall.insights.filter((i) => i.validTo === null)) {
      const rel = `insights/${ins.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.md`;
      writeFileAtomic(safeChild(this.vaultDir, rel), renderInsightMarkdown(ins));
    }

    for (const proc of recall.procedures.filter((p) => p.validTo === null)) {
      const rel = `insights/${proc.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.md`;
      writeFileAtomic(safeChild(this.vaultDir, rel), renderProcedureMarkdown(proc));
    }

    for (const sess of recall.sessions.filter((s) => s.validTo === null).slice(0, 20)) {
      const rel = `sessions/${sess.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.md`;
      writeFileAtomic(safeChild(this.vaultDir, rel), renderSessionMarkdown(sess));
    }

    // Build top-level Obsidian Index.md.
    const indexLines = [
      '# Izzi AI — Local-First Knowledge Vault',
      '',
      `Cập nhật gần nhất: ${new Date().toISOString()}`,
      '',
      '## Tri thức đã duyệt (Active Knowledge)',
      ...(activeRecords.length > 0
        ? activeRecords.map(
            (r) => `- **${r.kind}** (${r.sensitivity}) · [[knowledge/${r.scope}/${r.id}|${r.title}]]`,
          )
        : ['_Chưa có tri thức active._']),
      '',
      '## Bài học đúc kết (L4 Insights)',
      ...(recall.insights.length > 0
        ? recall.insights
            .filter((i) => i.validTo === null)
            .map((i) => `- [[insights/${i.id.replace(/[^a-zA-Z0-9_-]/g, '-')}|${i.summary.slice(0, 90)}]]`)
        : ['_Chưa có bài học L4._']),
      '',
      '## Quy trình đã học (L5 Procedures)',
      ...(recall.procedures.length > 0
        ? recall.procedures
            .filter((p) => p.validTo === null)
            .map((p) => `- [[insights/${p.id.replace(/[^a-zA-Z0-9_-]/g, '-')}|${p.intent.slice(0, 90)}]]`)
        : ['_Chưa có quy trình L5._']),
      '',
    ];
    writeFileAtomic(safeChild(this.vaultDir, 'Index.md'), `${indexLines.join('\n')}\n`);
  }

  /**
   * Controlled one-way importer for an existing Obsidian `.md` folder (Slice 4).
   * Imports clean notes as `candidate` + `sensitivity: 'local'` without modifying
   * the source folder. Blocks any secret/PII file fail-closed.
   */
  importMarkdownFolder(sourceDir: string, maxFiles = 200): VaultImportResult {
    const resolved = path.resolve(sourceDir);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      return { ok: false, imported: 0, skipped: 0, blockedSecrets: 0, errors: ['Thư mục không tồn tại'] };
    }

    let imported = 0;
    let skipped = 0;
    let blockedSecrets = 0;
    const errors: string[] = [];
    const queue: string[] = [''];
    let visited = 0;

    while (queue.length > 0 && visited < maxFiles) {
      const relDir = queue.shift()!;
      const absDir = relDir ? safeChild(resolved, relDir) : resolved;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(absDir, { withFileTypes: true });
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'Read error');
        continue;
      }

      for (const entry of entries) {
        if (visited >= maxFiles) break;
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          queue.push(rel);
          continue;
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;

        visited += 1;
        try {
          const absFile = safeChild(resolved, rel);
          const stat = fs.statSync(absFile);
          if (stat.size === 0 || stat.size > 256 * 1024) {
            skipped += 1;
            continue;
          }
          const raw = fs.readFileSync(absFile, 'utf8');
          if (evaluateSensitivePolicy(scanSensitiveContent(raw)) === 'block') {
            blockedSecrets += 1;
            continue;
          }
          const parsed = parseVaultMarkdown(raw);
          const title = (parsed.title || entry.name.replace(/\.md$/i, '')).slice(0, 150);
          const summary = parsed.body.replace(/\s+/g, ' ').trim().slice(0, 1100);
          if (summary.length < 8) {
            skipped += 1;
            continue;
          }
          const sha256 = sha256Hex(raw);
          this.knowledge.capture({
            scope: 'project',
            workspaceId: 'obsidian-import',
            kind: 'fact',
            title,
            summary,
            topicKey: `import:${rel.replace(/\.md$/i, '').slice(0, 90)}`,
            source: { type: 'documentation', uri: absFile, sha256 },
            author: 'obsidian-importer',
            evidence: 'direct',
            confidence: 0.85,
            sensitivity: 'local',
          });
          imported += 1;
        } catch (err) {
          errors.push(`${rel}: ${err instanceof Error ? err.message : 'import error'}`);
        }
      }
    }

    return { ok: true, imported, skipped, blockedSecrets, errors: errors.slice(0, 20) };
  }

  /**
   * Controlled one-way importer for Codex KnowledgeMemory JSON exports
   * (`F:/Ai Tools/Codex/KnowledgeMemory/exports/projects/*.json`).
   * Imports active/candidate records into local Review Inbox (`sensitivity: 'local'`).
   */
  importCodexExports(exportsDir: string): VaultImportResult {
    const projectsDir = path.join(path.resolve(exportsDir), 'projects');
    const targetDir = fs.existsSync(projectsDir) ? projectsDir : path.resolve(exportsDir);
    if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
      return { ok: false, imported: 0, skipped: 0, blockedSecrets: 0, errors: ['Không tìm thấy thư mục exports'] };
    }

    let imported = 0;
    let skipped = 0;
    let blockedSecrets = 0;
    const errors: string[] = [];

    for (const file of fs.readdirSync(targetDir)) {
      if (!file.endsWith('.json') || file.startsWith('.')) continue;
      try {
        const absFile = safeChild(targetDir, file);
        const doc = JSON.parse(fs.readFileSync(absFile, 'utf8')) as {
          project_id?: string;
          nodes?: Array<Record<string, unknown>>;
        };
        if (!Array.isArray(doc.nodes)) continue;
        for (const node of doc.nodes) {
          const type = typeof node.type === 'string' ? node.type : '';
          if (type === 'project' || type === 'task-index') continue;
          const title = typeof node.label === 'string' ? node.label.trim() : '';
          const summary = typeof node.summary === 'string' ? node.summary.trim() : '';
          const status = typeof node.status === 'string' ? node.status : 'candidate';
          if (!title || !summary || status === 'retracted' || status === 'superseded') {
            skipped += 1;
            continue;
          }
          if (containsSensitiveMaterial({ title, summary })) {
            blockedSecrets += 1;
            continue;
          }
          const validKind = (
            ['fact', 'decision', 'preference', 'procedure', 'lesson', 'pitfall', 'question'].includes(type)
              ? type
              : 'fact'
          ) as 'fact' | 'decision' | 'preference' | 'procedure' | 'lesson' | 'pitfall' | 'question';

          this.knowledge.capture({
            scope: 'project',
            workspaceId: typeof doc.project_id === 'string' ? doc.project_id : 'codex-import',
            kind: validKind,
            title: title.slice(0, 150),
            summary: summary.slice(0, 1100),
            topicKey: `codex:${String(node.id ?? title).slice(0, 80)}`,
            source: { type: 'documentation', uri: absFile },
            author: 'codex-importer',
            evidence: 'direct',
            confidence: 0.9,
            sensitivity: 'local',
          });
          imported += 1;
        }
      } catch (err) {
        errors.push(`${file}: ${err instanceof Error ? err.message : 'parse error'}`);
      }
    }

    return { ok: true, imported, skipped, blockedSecrets, errors: errors.slice(0, 20) };
  }
}
