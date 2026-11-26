/**
 * Vault / wiki / daily-note conventions on top of GraphNode.
 * Backend stays /api/aibase — we only specialize nodeType + metadata.
 */

import type { GraphNode, NodeCreatePayload } from './graph-types';
import { uniqueWikilinkTargets } from './wikilink';

export const VAULT_NODE_TYPES = ['note', 'wiki', 'daily'] as const;
export type VaultNodeType = (typeof VAULT_NODE_TYPES)[number];

export const VAULT_KIND = 'vault-note' as const;

export interface VaultNoteMetadata {
  kind: typeof VAULT_KIND;
  format: 'markdown';
  wikilinks?: string[];
  path?: string;
  /** ISO date YYYY-MM-DD for daily notes */
  dailyDate?: string;
  frontmatter?: { tags?: string[] };
}

export function isVaultNodeType(t: string): t is VaultNodeType {
  return (VAULT_NODE_TYPES as readonly string[]).includes(t);
}

/** Own-property read of metadata (no prototype chain). */
export function readVaultMeta(node: Pick<GraphNode, 'metadata'> | null | undefined): VaultNoteMetadata | null {
  const m = node?.metadata;
  if (m === null || m === undefined || typeof m !== 'object' || Array.isArray(m)) return null;
  const obj = m as Record<string, unknown>;
  if (!Object.hasOwn(obj, 'kind') || obj.kind !== VAULT_KIND) {
    // Still treat plain notes with content as vault-capable
    return null;
  }
  return {
    kind: VAULT_KIND,
    format: 'markdown',
    wikilinks: Array.isArray(obj.wikilinks)
      ? obj.wikilinks.filter((x): x is string => typeof x === 'string')
      : undefined,
    path: typeof obj.path === 'string' ? obj.path : undefined,
    dailyDate: typeof obj.dailyDate === 'string' ? obj.dailyDate : undefined,
    frontmatter:
      obj.frontmatter && typeof obj.frontmatter === 'object' && !Array.isArray(obj.frontmatter)
        ? (obj.frontmatter as { tags?: string[] })
        : undefined,
  };
}

/** Build metadata for a vault note from markdown body. */
export function buildVaultMetadata(input: {
  content: string;
  dailyDate?: string;
  path?: string;
  tags?: string[];
  existing?: Record<string, unknown> | null;
}): Record<string, unknown> {
  const base: Record<string, unknown> =
    input.existing && typeof input.existing === 'object' && !Array.isArray(input.existing)
      ? { ...input.existing }
      : {};
  base.kind = VAULT_KIND;
  base.format = 'markdown';
  base.wikilinks = uniqueWikilinkTargets(input.content);
  if (input.dailyDate) base.dailyDate = input.dailyDate;
  if (input.path) base.path = input.path;
  if (input.tags) {
    base.frontmatter = {
      ...(typeof base.frontmatter === 'object' && base.frontmatter && !Array.isArray(base.frontmatter)
        ? (base.frontmatter as object)
        : {}),
      tags: input.tags,
    };
  }
  return base;
}

/** Daily note title convention (stable for idempotent lookup). */
export function dailyNoteTitle(dateIso: string): string {
  const d = normalizeDailyDate(dateIso);
  return `Daily ${d}`;
}

/** Normalize to YYYY-MM-DD or throw-safe empty. */
export function normalizeDailyDate(input?: string | Date): string {
  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    return input.toISOString().slice(0, 10);
  }
  const s = String(input ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

/**
 * Find existing daily node or return create payload.
 * Pure — caller performs GraphClient create.
 */
export function getOrCreateDailyPlan(
  nodes: ReadonlyArray<Pick<GraphNode, 'id' | 'title' | 'nodeType' | 'metadata'>>,
  date?: string | Date,
): { existingId: string } | { create: NodeCreatePayload } {
  const dailyDate = normalizeDailyDate(date);
  const title = dailyNoteTitle(dailyDate);

  for (const n of nodes) {
    if (n.nodeType === 'daily') {
      const meta = n.metadata;
      if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
        const dd = (meta as Record<string, unknown>).dailyDate;
        if (dd === dailyDate) return { existingId: n.id };
      }
    }
    if (n.title.trim() === title) return { existingId: n.id };
  }

  const content = `# ${title}\n\n`;
  return {
    create: {
      title,
      nodeType: 'daily',
      color: '#6B8F71',
      content,
      metadata: buildVaultMetadata({ content, dailyDate, path: `daily/${dailyDate}.md` }),
    },
  };
}

/** Suggested vault path for a node. */
export function suggestVaultPath(nodeType: string, title: string, dailyDate?: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'untitled';
  if (nodeType === 'daily' && dailyDate) return `daily/${dailyDate}.md`;
  if (nodeType === 'wiki') return `wiki/${slug}.md`;
  return `notes/${slug}.md`;
}
