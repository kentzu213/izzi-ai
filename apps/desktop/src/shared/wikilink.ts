/**
 * Safe, title-based wikilinks for workspace-scoped vault notes.
 *
 * A wikilink target is never interpreted as a filesystem path or URL. Resolution
 * only considers nodes whose vault metadata matches both workspace and owner.
 */

import type { LiveProfileScope } from './live-profile';

export interface WikiLinkRef {
  readonly raw: string;
  readonly target: string;
  readonly label: string;
  readonly start: number;
  readonly end: number;
}

export interface ScopedWikilinkNode {
  readonly id: string;
  readonly title: string;
  readonly metadata?: Record<string, unknown>;
}

const MAX_WIKILINK_TARGET_LENGTH = 160;
const MAX_WIKILINK_LABEL_LENGTH = 240;

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function hasUriScheme(value: string): boolean {
  const colon = value.indexOf(':');
  if (colon <= 0) return false;
  const scheme = value.slice(0, colon);
  if (!/^[A-Za-z][A-Za-z0-9+.-]*$/.test(scheme)) return false;
  return true;
}

export function normalizeWikilinkTarget(value: string): string | null {
  const target = String(value ?? '').normalize('NFC').trim();
  if (!target || target.length > MAX_WIKILINK_TARGET_LENGTH) return null;
  if (hasControlCharacter(target)) return null;
  if (target.includes('/') || target.includes('\\')) return null;
  if (target === '.' || target === '..' || target.includes('../') || target.includes('..\\')) {
    return null;
  }
  if (hasUriScheme(target)) return null;
  return target;
}

function normalizeLabel(value: string, target: string): string {
  const label = value.normalize('NFC').trim();
  if (!label || label.length > MAX_WIKILINK_LABEL_LENGTH || hasControlCharacter(label)) {
    return target;
  }
  return label;
}

export function parseWikilinks(markdown: string): WikiLinkRef[] {
  const source = String(markdown ?? '');
  const links: WikiLinkRef[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('[[', cursor);
    if (start < 0) break;
    const endMarker = source.indexOf(']]', start + 2);
    if (endMarker < 0) break;
    const raw = source.slice(start + 2, endMarker).trim();
    cursor = endMarker + 2;
    if (!raw || raw.includes('[') || raw.includes(']')) continue;
    const separator = raw.indexOf('|');
    const targetPart = separator < 0 ? raw : raw.slice(0, separator);
    const labelPart = separator < 0 ? targetPart : raw.slice(separator + 1);
    const target = normalizeWikilinkTarget(targetPart);
    if (!target) continue;
    links.push({
      raw,
      target,
      label: normalizeLabel(labelPart, target),
      start,
      end: endMarker + 2,
    });
  }
  return links;
}

export function uniqueWikilinkTargets(markdown: string): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const link of parseWikilinks(markdown)) {
    const key = link.target.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(link.target);
  }
  return targets;
}

function ownRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function nodeMatchesScope(node: ScopedWikilinkNode, scope: LiveProfileScope): boolean {
  const metadata = ownRecord(node.metadata);
  if (!metadata || metadata.kind !== 'vault-note') return false;
  const nodeScope = ownRecord(metadata.scope);
  return (
    nodeScope !== null &&
    Object.hasOwn(nodeScope, 'workspaceId') &&
    Object.hasOwn(nodeScope, 'ownerId') &&
    nodeScope.workspaceId === scope.workspaceId &&
    nodeScope.ownerId === scope.ownerId
  );
}

export function resolveScopedWikilinkTarget(
  rawTarget: string,
  nodes: readonly ScopedWikilinkNode[],
  scope: LiveProfileScope,
): { id: string; title: string } | null {
  const target = normalizeWikilinkTarget(rawTarget);
  if (!target) return null;
  const scoped = nodes.filter((node) => nodeMatchesScope(node, scope));
  const byId = scoped.find((node) => node.id === target);
  if (byId) return { id: byId.id, title: byId.title };
  const normalized = target.toLocaleLowerCase();
  const byTitle = scoped.find((node) => node.title.trim().toLocaleLowerCase() === normalized);
  return byTitle ? { id: byTitle.id, title: byTitle.title } : null;
}
