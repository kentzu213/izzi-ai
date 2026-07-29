/**
 * Workspace/user-scoped vault note contracts and relative-path validation.
 */

import type { GraphNode, NodeCreatePayload } from './graph-types';
import type { LiveProfileScope } from './live-profile';
import { uniqueWikilinkTargets } from './wikilink';

export const VAULT_NODE_TYPES = ['note', 'wiki', 'daily'] as const;
export type VaultNodeType = (typeof VAULT_NODE_TYPES)[number];
export const VAULT_KIND = 'vault-note' as const;

export interface VaultNoteMetadata {
  readonly kind: typeof VAULT_KIND;
  readonly format: 'markdown';
  readonly scope: LiveProfileScope;
  readonly classification: 'personal_graph' | 'local_files';
  readonly path: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly wikilinks: readonly string[];
  readonly dailyDate?: string;
  readonly frontmatter?: {
    readonly tags?: readonly string[];
  };
}

const MAX_VAULT_PATH_LENGTH = 240;
const MAX_VAULT_SEGMENT_LENGTH = 100;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function assertScope(scope: LiveProfileScope): LiveProfileScope {
  const workspaceId = scope.workspaceId.normalize('NFC').trim();
  const ownerId = scope.ownerId.normalize('NFC').trim();
  if (!workspaceId || !ownerId || hasControlCharacter(workspaceId) || hasControlCharacter(ownerId)) {
    throw new Error('Vault scope requires valid workspaceId and ownerId values.');
  }
  return { workspaceId, ownerId };
}

export function normalizeVaultRelativePath(candidate: string): string {
  const value = String(candidate ?? '').normalize('NFC').trim();
  if (!value || value.length > MAX_VAULT_PATH_LENGTH || hasControlCharacter(value)) {
    throw new Error('Vault path is empty or invalid.');
  }
  if (value.startsWith('/') || value.startsWith('\\') || value.includes('\\')) {
    throw new Error('Vault paths must be POSIX-style relative paths.');
  }
  if (/^[A-Za-z]:/.test(value) || value.startsWith('//')) {
    throw new Error('Absolute and network vault paths are forbidden.');
  }
  const segments = value.split('/');
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.length > MAX_VAULT_SEGMENT_LENGTH ||
        segment.trim() !== segment ||
        segment.endsWith('.') ||
        /[<>:"|?*]/.test(segment) ||
        WINDOWS_RESERVED_NAME.test(segment),
    )
  ) {
    throw new Error('Vault path contains an unsafe segment.');
  }
  if (!segments[segments.length - 1].toLocaleLowerCase().endsWith('.md')) {
    throw new Error('Vault notes must use the .md extension.');
  }
  return segments.join('/');
}

export function isVaultNodeType(value: string): value is VaultNodeType {
  return (VAULT_NODE_TYPES as readonly string[]).includes(value);
}

export function normalizeDailyDate(input: string | Date): string {
  const value =
    input instanceof Date && !Number.isNaN(input.getTime())
      ? input.toISOString().slice(0, 10)
      : String(input ?? '').trim();
  const parts = value.split('-');
  if (parts.length !== 3 || parts[0].length !== 4 || parts[1].length !== 2 || parts[2].length !== 2) {
    throw new Error('Daily note date must use YYYY-MM-DD.');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Daily note date is invalid.');
  }
  return value;
}

export function dailyNoteTitle(input: string | Date): string {
  return `Daily ${normalizeDailyDate(input)}`;
}

function slugifyTitle(title: string): string {
  return (
    title
      .normalize('NFC')
      .trim()
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'untitled'
  );
}

export function suggestVaultPath(
  nodeType: string,
  title: string,
  dailyDate?: string,
): string {
  if (nodeType === 'daily') {
    if (!dailyDate) throw new Error('Daily notes require dailyDate.');
    return normalizeVaultRelativePath(`daily/${normalizeDailyDate(dailyDate)}.md`);
  }
  const folder = nodeType === 'wiki' ? 'wiki' : 'notes';
  return normalizeVaultRelativePath(`${folder}/${slugifyTitle(title)}.md`);
}

export function buildVaultMetadata(input: {
  readonly scope: LiveProfileScope;
  readonly content: string;
  readonly path: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly classification?: 'personal_graph' | 'local_files';
  readonly dailyDate?: string;
  readonly tags?: readonly string[];
}): Record<string, unknown> {
  const scope = assertScope(input.scope);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new Error('Vault revision must be a positive integer.');
  }
  if (Number.isNaN(Date.parse(input.updatedAt))) {
    throw new Error('Vault updatedAt must be an ISO timestamp.');
  }
  const metadata: VaultNoteMetadata = {
    kind: VAULT_KIND,
    format: 'markdown',
    scope,
    classification: input.classification ?? 'personal_graph',
    path: normalizeVaultRelativePath(input.path),
    revision: input.revision,
    updatedAt: input.updatedAt,
    wikilinks: uniqueWikilinkTargets(input.content),
    ...(input.dailyDate ? { dailyDate: normalizeDailyDate(input.dailyDate) } : {}),
    ...(input.tags
      ? {
          frontmatter: {
            tags: input.tags.map((tag) => tag.normalize('NFC').trim()).filter(Boolean),
          },
        }
      : {}),
  };
  return metadata as unknown as Record<string, unknown>;
}

function ownRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function readVaultMetadata(value: unknown): VaultNoteMetadata | null {
  const metadata = ownRecord(value);
  if (!metadata || metadata.kind !== VAULT_KIND || metadata.format !== 'markdown') return null;
  const scope = ownRecord(metadata.scope);
  if (
    !scope ||
    typeof scope.workspaceId !== 'string' ||
    typeof scope.ownerId !== 'string' ||
    typeof metadata.path !== 'string' ||
    typeof metadata.revision !== 'number' ||
    !Number.isSafeInteger(metadata.revision) ||
    metadata.revision < 1 ||
    typeof metadata.updatedAt !== 'string' ||
    Number.isNaN(Date.parse(metadata.updatedAt)) ||
    (metadata.classification !== 'personal_graph' && metadata.classification !== 'local_files') ||
    !Array.isArray(metadata.wikilinks) ||
    !metadata.wikilinks.every((item) => typeof item === 'string')
  ) {
    return null;
  }
  try {
    const parsed: VaultNoteMetadata = {
      kind: VAULT_KIND,
      format: 'markdown',
      scope: assertScope({ workspaceId: scope.workspaceId, ownerId: scope.ownerId }),
      classification: metadata.classification,
      path: normalizeVaultRelativePath(metadata.path),
      revision: metadata.revision,
      updatedAt: metadata.updatedAt,
      wikilinks: metadata.wikilinks,
      ...(typeof metadata.dailyDate === 'string'
        ? { dailyDate: normalizeDailyDate(metadata.dailyDate) }
        : {}),
    };
    return parsed;
  } catch {
    return null;
  }
}

export function isVaultMetadataForScope(
  value: unknown,
  expectedScope: LiveProfileScope,
): boolean {
  const metadata = readVaultMetadata(value);
  return (
    metadata !== null &&
    metadata.scope.workspaceId === expectedScope.workspaceId &&
    metadata.scope.ownerId === expectedScope.ownerId
  );
}

export function getOrCreateDailyPlan(
  scope: LiveProfileScope,
  nodes: ReadonlyArray<Pick<GraphNode, 'id' | 'title' | 'nodeType' | 'metadata'>>,
  date: string | Date,
  now: string,
): { readonly existingId: string } | { readonly create: NodeCreatePayload } {
  const dailyDate = normalizeDailyDate(date);
  const title = dailyNoteTitle(dailyDate);
  for (const node of nodes) {
    if (!isVaultMetadataForScope(node.metadata, scope)) continue;
    const metadata = readVaultMetadata(node.metadata);
    if (
      (node.nodeType === 'daily' && metadata?.dailyDate === dailyDate) ||
      node.title.trim() === title
    ) {
      return { existingId: node.id };
    }
  }
  const content = `# ${title}\n\n`;
  return {
    create: {
      title,
      nodeType: 'daily',
      color: '#6B8F71',
      content,
      metadata: buildVaultMetadata({
        scope,
        content,
        path: `daily/${dailyDate}.md`,
        revision: 1,
        updatedAt: now,
        dailyDate,
      }),
    },
  };
}
