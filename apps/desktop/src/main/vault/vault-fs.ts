/**
 * Local-First Obsidian Vault filesystem & Markdown codec.
 *
 * Security (security-baseline A/C/D):
 *  - `safeChild()` enforces strict root containment and rejects any symlink or
 *    Windows junction along the path (ported from `project-memory.py`).
 *  - `writeFileAtomic()` writes exclusively to a sibling temp file, fsyncs, and
 *    atomically replaces the target so crashes never corrupt user notes.
 *  - Frontmatter serialization uses JSON-encoded YAML scalars (never arbitrary
 *    unquoted strings that could inject YAML directives), and parsing uses
 *    own-property assignment only.
 *
 * @module main/vault/vault-fs
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { GraphNode } from '../../shared/graph-types';
import type { KnowledgeRecord } from '../../shared/knowledge-types';
import type {
  InsightNodeView,
  ProcedureNodeView,
  SessionMemoryNodeView,
} from '../../shared/memory-loop-types';
import type { VaultManifest } from '../../shared/vault-sync-types';
import { readVaultMeta, suggestVaultPath } from '../../shared/vault-types';

const MANIFEST_FILENAME = '.vault-manifest.json';

export function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Resolve `relativePath` strictly inside `rootDir`. Rejects absolute paths,
 * `..` traversal, root escapes, and any symlink/junction segment on disk.
 */
export function safeChild(rootDir: string, relativePath: string): string {
  const normalizedRel = String(relativePath ?? '').replace(/\\/g, '/').trim();
  if (!normalizedRel || path.isAbsolute(normalizedRel) || normalizedRel.startsWith('/')) {
    throw new Error('Unsafe vault path: must be relative');
  }
  const parts = normalizedRel.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((p) => p === '.' || p === '..' || p.includes('\0'))) {
    throw new Error('Unsafe vault path: traversal segment rejected');
  }

  const resolvedRoot = path.resolve(rootDir);
  const target = path.resolve(resolvedRoot, ...parts);
  const relBack = path.relative(resolvedRoot, target);
  if (relBack.startsWith('..') || path.isAbsolute(relBack)) {
    throw new Error('Unsafe vault path: escapes vault root');
  }

  // Reject symlinks/junctions on every existing ancestor from root to target.
  let cursor = resolvedRoot;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor)) {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink()) {
        throw new Error('Unsafe vault path: symlink/junction rejected');
      }
    }
  }

  return target;
}

/** Atomic UTF-8 file write (temp file + fsync + rename). */
export function writeFileAtomic(targetPath: string, content: string): void {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${targetPath}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  let fd: number | null = null;
  try {
    fd = fs.openSync(tempPath, 'wx');
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempPath, targetPath);
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // ignore
    }
  }
}

export function readVaultManifest(vaultDir: string): VaultManifest {
  const manifestPath = safeChild(vaultDir, MANIFEST_FILENAME);
  if (!fs.existsSync(manifestPath)) {
    return {
      schemaVersion: 1,
      vaultRoot: path.resolve(vaultDir),
      lastSyncAt: null,
      entries: {},
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    const entriesRaw =
      raw && typeof raw === 'object' && Object.hasOwn(raw, 'entries') && raw.entries && typeof raw.entries === 'object'
        ? (raw.entries as VaultManifest['entries'])
        : {};
    const lastSyncAt =
      raw && typeof raw === 'object' && Object.hasOwn(raw, 'lastSyncAt') && typeof raw.lastSyncAt === 'string'
        ? raw.lastSyncAt
        : null;
    return {
      schemaVersion: 1,
      vaultRoot: path.resolve(vaultDir),
      lastSyncAt,
      entries: entriesRaw,
    };
  } catch {
    return {
      schemaVersion: 1,
      vaultRoot: path.resolve(vaultDir),
      lastSyncAt: null,
      entries: {},
    };
  }
}

export function writeVaultManifest(vaultDir: string, manifest: VaultManifest): void {
  const manifestPath = safeChild(vaultDir, MANIFEST_FILENAME);
  writeFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function sanitizeSlug(raw: string): string {
  return (
    String(raw ?? '')
      .trim()
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'untitled'
  );
}

/** Determine deterministic relative `.md` path for a cloud `GraphNode`. */
export function relativePathForNode(
  node: Pick<GraphNode, 'id' | 'title' | 'nodeType' | 'metadata'>,
): string {
  const meta = readVaultMeta(node);
  if (meta?.path) {
    const clean = meta.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (clean.endsWith('.md') && !clean.includes('..')) return clean;
  }

  const shortId = sanitizeSlug(node.id).slice(-8) || 'node';
  if (node.nodeType === 'daily') {
    return suggestVaultPath('daily', node.title, meta?.dailyDate);
  }
  if (node.nodeType === 'wiki') {
    return `wiki/${sanitizeSlug(node.title)}-${shortId}.md`;
  }
  if (node.nodeType === 'agent-session') {
    return `sessions/cloud-${sanitizeSlug(node.title).slice(0, 40)}-${shortId}.md`;
  }
  if (node.nodeType === 'topic') {
    return `topics/${sanitizeSlug(node.title)}-${shortId}.md`;
  }
  return `notes/${sanitizeSlug(node.title)}-${shortId}.md`;
}

function extractTagsFromMetadata(metadata: Record<string, unknown> | undefined): string[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const out: string[] = [];
  const push = (t: unknown) => {
    if (typeof t === 'string' && t.trim() && !out.includes(t.trim())) out.push(t.trim());
  };
  if (Object.hasOwn(metadata, 'tags') && Array.isArray(metadata.tags)) {
    for (const t of metadata.tags) push(t);
  }
  if (
    Object.hasOwn(metadata, 'frontmatter') &&
    metadata.frontmatter &&
    typeof metadata.frontmatter === 'object' &&
    !Array.isArray(metadata.frontmatter)
  ) {
    const fm = metadata.frontmatter as Record<string, unknown>;
    if (Object.hasOwn(fm, 'tags') && Array.isArray(fm.tags)) {
      for (const t of fm.tags) push(t);
    }
  }
  return out;
}

function formatFrontmatter(fields: Record<string, unknown>): string {
  const lines = ['---'];
  for (const key of Object.keys(fields)) {
    const val = fields[key];
    if (val === undefined) continue;
    lines.push(`${key}: ${JSON.stringify(val)}`);
  }
  lines.push('---', '');
  return `${lines.join('\n')}\n`;
}

/** Render a `GraphNode` into an Obsidian-compatible Markdown note with YAML frontmatter. */
export function renderGraphNodeMarkdown(
  node: GraphNode,
  opts: { sensitivity?: 'local' | 'shareable'; linkedTitles?: string[] } = {},
): string {
  const tags = extractTagsFromMetadata(node.metadata);
  const fm = formatFrontmatter({
    id: node.id,
    title: node.title,
    nodeType: node.nodeType || 'note',
    tags,
    sensitivity: opts.sensitivity ?? 'shareable',
    url: node.url || undefined,
    updatedAt: node.updatedAt || node.createdAt || '',
  });

  const body = (node.content ?? '').replace(/\r\n?/g, '\n').trimEnd();
  const hasH1 = /^#\s+/.test(body);
  const heading = hasH1 ? '' : `# ${node.title}\n\n`;
  const linked = (opts.linkedTitles ?? []).filter(Boolean);
  const linkSection =
    linked.length > 0
      ? `\n\n## Liên kết\n${linked.map((t) => `- [[${t}]]`).join('\n')}\n`
      : '\n';

  return `${fm}${heading}${body}${linkSection}`;
}

export interface ParsedVaultMarkdown {
  frontmatter: Record<string, unknown>;
  title: string;
  body: string;
  tags: string[];
}

/** Parse YAML-subset JSON-scalar frontmatter + body from a vault `.md` file safely. */
export function parseVaultMarkdown(raw: string): ParsedVaultMarkdown {
  const normalized = String(raw ?? '').replace(/\r\n?/g, '\n');
  const frontmatter: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  let body = normalized;

  if (normalized.startsWith('---\n')) {
    const endIdx = normalized.indexOf('\n---\n', 4);
    if (endIdx !== -1) {
      const fmBlock = normalized.slice(4, endIdx);
      body = normalized.slice(endIdx + 5).replace(/^\n+/, '');
      for (const line of fmBlock.split('\n')) {
        const sep = line.indexOf(':');
        if (sep <= 0) continue;
        const key = line.slice(0, sep).trim();
        if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        const rawVal = line.slice(sep + 1).trim();
        try {
          frontmatter[key] = JSON.parse(rawVal);
        } catch {
          frontmatter[key] = rawVal.replace(/^['"]|['"]$/g, '');
        }
      }
    }
  }

  // Strip generated trailing "## Liên kết" block when reading back body for cloud PATCH.
  const linkMarker = '\n\n## Liên kết\n';
  const linkIdx = body.lastIndexOf(linkMarker);
  const cleanBody = linkIdx >= 0 ? body.slice(0, linkIdx).trimEnd() : body.trimEnd();

  let title = typeof frontmatter.title === 'string' ? frontmatter.title.trim() : '';
  if (!title) {
    const h1 = cleanBody.match(/^#\s+(.+)$/m);
    if (h1) title = h1[1].trim();
  }

  const tags: string[] = [];
  if (Array.isArray(frontmatter.tags)) {
    for (const t of frontmatter.tags) {
      if (typeof t === 'string' && t.trim()) tags.push(t.trim());
    }
  } else if (typeof frontmatter.tags === 'string') {
    for (const part of frontmatter.tags.split(',')) {
      if (part.trim()) tags.push(part.trim());
    }
  }

  return { frontmatter, title, body: cleanBody, tags };
}

/** Render an active `KnowledgeRecord` into `knowledge/<scope>/<id>.md`. */
export function renderKnowledgeRecordMarkdown(record: KnowledgeRecord): string {
  const fm = formatFrontmatter({
    memory_id: record.id,
    scope: record.scope,
    workspace_id: record.workspaceId,
    kind: record.kind,
    topic_key: record.topicKey,
    status: record.state,
    sensitivity: record.sensitivity,
    tags: ['izzi-knowledge', record.kind, record.state],
    review_after: record.reviewAfter,
  });

  const lines = [
    `# ${record.title}`,
    '',
    record.summary,
    '',
    '## Bằng chứng & Nguồn',
    '',
    `- Nguồn: \`${record.source.uri}\` (${record.source.type})`,
    `- Độ tin cậy: ${record.confidence} · Loại: ${record.evidence}`,
    `- Rà soát sau: ${record.reviewAfter}`,
    `- Trạng thái: **${record.state}** · Phạm vi chia sẻ: **${record.sensitivity}**`,
    `- Nguồn còn hợp lệ: ${record.sourceCurrent} · Hết hạn: ${record.expired} · Xung đột: ${record.conflicts.length}`,
  ];
  if (record.relations.length > 0) {
    lines.push('', '## Quan hệ', '');
    for (const rel of record.relations) {
      lines.push(`- ${rel.type}: [[${rel.target}]]`);
    }
  }
  return `${fm}${lines.join('\n')}\n`;
}

/** Render an L4 Insight node into a read-only Obsidian Markdown file. */
export function renderInsightMarkdown(insight: InsightNodeView): string {
  const fm = formatFrontmatter({
    id: insight.id,
    layer: 'L4-insight',
    themes: insight.themes,
    createdAt: insight.createdAt,
    tags: ['l4-insight', ...insight.themes],
    readOnly: true,
  });
  return [
    fm,
    `# Bài học đúc kết (L4) · ${insight.id}`,
    '',
    insight.summary,
    '',
    insight.sourceSessionIds.length > 0
      ? `Nguồn phiên: ${insight.sourceSessionIds.map((s) => `\`${s}\``).join(', ')}`
      : '',
    '',
  ].join('\n');
}

/** Render an L5 Procedure node into a read-only Obsidian Markdown file. */
export function renderProcedureMarkdown(proc: ProcedureNodeView): string {
  const fm = formatFrontmatter({
    id: proc.id,
    layer: 'L5-procedure',
    featureSpec: proc.featureSpec,
    createdAt: proc.createdAt,
    tags: ['l5-procedure', ...(proc.featureSpec ? [proc.featureSpec] : [])],
    readOnly: true,
  });
  const steps = proc.steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
  return `${fm}# Quy trình đã học (L5): ${proc.intent}\n\n## Các bước\n${steps || '_Chưa có bước chi tiết_'}\n`;
}

/** Render an episodic session node into a read-only Obsidian Markdown file. */
export function renderSessionMarkdown(session: SessionMemoryNodeView): string {
  const fm = formatFrontmatter({
    id: session.id,
    layer: 'episodic-session',
    outcome: session.outcome,
    specs: session.specsTouched,
    createdAt: session.createdAt,
    tags: ['agent-session', session.outcome],
    readOnly: true,
  });
  const parts = [`# ${session.summary}`, ''];
  if (session.decisions.length > 0) {
    parts.push('## Quyết định', ...session.decisions.map((d) => `- ${d}`), '');
  }
  if (session.followUps.length > 0) {
    parts.push('## Việc tiếp theo', ...session.followUps.map((f) => `- [ ] ${f}`), '');
  }
  if (session.filesTouched.length > 0) {
    parts.push('## File liên quan', ...session.filesTouched.map((f) => `- \`${f}\``), '');
  }
  return `${fm}${parts.join('\n')}\n`;
}
