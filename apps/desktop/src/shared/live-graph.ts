/**
 * Deterministic LiveProfile → MyGraph projection plans.
 *
 * This module never performs graph writes. It emits creates/updates for an
 * already-authorized graph adapter and preserves source, scope, classification,
 * timestamp, and revision provenance on every node.
 */

import type { GraphNode, NodeCreatePayload, NodePatchPayload } from './graph-types';
import {
  effectiveLiveDirectives,
  sameLiveProfileScope,
  validateLiveProfileDocument,
  type LiveDirective,
  type LiveDirectiveSource,
  type LiveProfileDocument,
  type LiveProfileScope,
} from './live-profile';

export const LIVE_GRAPH_PROJECTION_KIND = 'live-profile-projection' as const;

export interface LiveGraphProjectionSource {
  readonly profileId: string;
  readonly documentRef: string;
  readonly directiveId: string;
  readonly directiveSource: LiveDirectiveSource;
  readonly proposalId?: string;
  readonly sourceType?: LiveDirective['sourceType'];
  readonly sourceRef?: string;
  readonly expiresAt?: string;
  readonly directiveRevision: number;
  readonly sourceUpdatedAt: string;
}

export interface LiveGraphProjectionMetadata {
  readonly kind: typeof LIVE_GRAPH_PROJECTION_KIND;
  readonly scope: LiveProfileScope;
  readonly classification: 'personal_graph';
  readonly source: LiveGraphProjectionSource;
  readonly projectedAt: string;
}

export interface LiveGraphProjectionUpdate {
  readonly id: string;
  readonly patch: NodePatchPayload;
}

export interface LiveGraphProjectionPlan {
  readonly creates: readonly NodeCreatePayload[];
  readonly updates: readonly LiveGraphProjectionUpdate[];
  readonly skippedNewer: readonly string[];
  readonly blockedReason?: 'local-files-egress-forbidden';
}

function ownRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function readLiveGraphProjectionMetadata(
  value: unknown,
): LiveGraphProjectionMetadata | null {
  const metadata = ownRecord(value);
  if (
    !metadata ||
    metadata.kind !== LIVE_GRAPH_PROJECTION_KIND ||
    metadata.classification !== 'personal_graph' ||
    !validTimestamp(metadata.projectedAt)
  ) {
    return null;
  }
  const scope = ownRecord(metadata.scope);
  const source = ownRecord(metadata.source);
  if (
    !scope ||
    typeof scope.workspaceId !== 'string' ||
    typeof scope.ownerId !== 'string' ||
    !source ||
    typeof source.profileId !== 'string' ||
    typeof source.documentRef !== 'string' ||
    typeof source.directiveId !== 'string' ||
    (source.directiveSource !== 'workspace-default' &&
      source.directiveSource !== 'accepted-proposal' &&
      source.directiveSource !== 'user') ||
    typeof source.directiveRevision !== 'number' ||
    !Number.isSafeInteger(source.directiveRevision) ||
    source.directiveRevision < 1 ||
    !validTimestamp(source.sourceUpdatedAt)
  ) {
    return null;
  }
  if (
    (source.proposalId !== undefined && typeof source.proposalId !== 'string') ||
    (source.sourceType !== undefined &&
      source.sourceType !== 'email' &&
      source.sourceType !== 'browser' &&
      source.sourceType !== 'chat' &&
      source.sourceType !== 'file') ||
    (source.sourceRef !== undefined && typeof source.sourceRef !== 'string') ||
    ((source.sourceType === undefined) !== (source.sourceRef === undefined)) ||
    (source.expiresAt !== undefined && !validTimestamp(source.expiresAt))
  ) {
    return null;
  }
  return {
    kind: LIVE_GRAPH_PROJECTION_KIND,
    scope: { workspaceId: scope.workspaceId, ownerId: scope.ownerId },
    classification: 'personal_graph',
    source: {
      profileId: source.profileId,
      documentRef: source.documentRef,
      directiveId: source.directiveId,
      directiveSource: source.directiveSource,
      ...(typeof source.proposalId === 'string' ? { proposalId: source.proposalId } : {}),
      ...(source.sourceType === undefined
        ? {}
        : { sourceType: source.sourceType, sourceRef: source.sourceRef as string }),
      ...(typeof source.expiresAt === 'string' ? { expiresAt: source.expiresAt } : {}),
      directiveRevision: source.directiveRevision,
      sourceUpdatedAt: source.sourceUpdatedAt,
    },
    projectedAt: metadata.projectedAt,
  };
}

function nodeTypeFor(directive: LiveDirective): string {
  return directive.kind === 'preference' ? 'live-preference' : 'live-rule';
}

function titleFor(directive: LiveDirective): string {
  const label = directive.kind === 'preference' ? 'Preference' : 'Rule';
  return `${label} · ${directive.key}`;
}

function colorFor(directive: LiveDirective): string {
  return directive.kind === 'preference' ? '#6B8F71' : '#A77B5A';
}

function projectionMetadata(
  document: LiveProfileDocument,
  directive: LiveDirective,
  projectedAt: string,
): LiveGraphProjectionMetadata {
  return {
    kind: LIVE_GRAPH_PROJECTION_KIND,
    scope: document.scope,
    classification: 'personal_graph',
    source: {
      profileId: document.profileId,
      documentRef: document.documentRef,
      directiveId: directive.id,
      directiveSource: directive.source,
      ...(directive.proposalId === undefined ? {} : { proposalId: directive.proposalId }),
      ...(directive.sourceType === undefined
        ? {}
        : { sourceType: directive.sourceType, sourceRef: directive.sourceRef }),
      ...(directive.expiresAt === undefined ? {} : { expiresAt: directive.expiresAt }),
      directiveRevision: directive.revision,
      sourceUpdatedAt: directive.updatedAt,
    },
    projectedAt,
  };
}

function createPayload(
  document: LiveProfileDocument,
  directive: LiveDirective,
  projectedAt: string,
): NodeCreatePayload {
  return {
    title: titleFor(directive),
    nodeType: nodeTypeFor(directive),
    color: colorFor(directive),
    content: directive.value,
    metadata: projectionMetadata(document, directive, projectedAt) as unknown as Record<
      string,
      unknown
    >,
  };
}

function matchesDirective(
  metadata: LiveGraphProjectionMetadata,
  document: LiveProfileDocument,
  directive: LiveDirective,
): boolean {
  return (
    sameLiveProfileScope(metadata.scope, document.scope) &&
    metadata.source.profileId === document.profileId &&
    metadata.source.documentRef === document.documentRef &&
    metadata.source.directiveId === directive.id
  );
}

export function planLiveProfileGraphProjection(
  rawDocument: LiveProfileDocument,
  nodes: ReadonlyArray<Pick<GraphNode, 'id' | 'title' | 'nodeType' | 'content' | 'metadata'>>,
  projectedAt: string,
): LiveGraphProjectionPlan {
  const document = validateLiveProfileDocument(rawDocument);
  if (Number.isNaN(Date.parse(projectedAt))) {
    throw new Error('projectedAt must be an ISO timestamp.');
  }
  if (document.classification === 'local_files') {
    return {
      creates: [],
      updates: [],
      skippedNewer: [],
      blockedReason: 'local-files-egress-forbidden',
    };
  }

  const creates: NodeCreatePayload[] = [];
  const updates: LiveGraphProjectionUpdate[] = [];
  const skippedNewer: string[] = [];
  for (const directive of effectiveLiveDirectives(document, projectedAt)) {
    const existing = nodes.find((node) => {
      const metadata = readLiveGraphProjectionMetadata(node.metadata);
      return metadata ? matchesDirective(metadata, document, directive) : false;
    });
    if (!existing) {
      creates.push(createPayload(document, directive, projectedAt));
      continue;
    }
    const metadata = readLiveGraphProjectionMetadata(existing.metadata);
    if (!metadata) continue;
    if (metadata.source.directiveRevision > directive.revision) {
      skippedNewer.push(existing.id);
      continue;
    }
    if (
      metadata.source.directiveRevision === directive.revision &&
      existing.title === titleFor(directive) &&
      existing.nodeType === nodeTypeFor(directive) &&
      existing.content === directive.value
    ) {
      continue;
    }
    updates.push({
      id: existing.id,
      patch: {
        title: titleFor(directive),
        nodeType: nodeTypeFor(directive),
        color: colorFor(directive),
        content: directive.value,
        metadata: projectionMetadata(document, directive, projectedAt) as unknown as Record<
          string,
          unknown
        >,
      },
    });
  }
  return { creates, updates, skippedNewer };
}
