/**
 * Pure scoped vault operation plans. Callers apply the returned creates/links
 * through an already-authorized graph adapter.
 */

import type { GraphLink, GraphNode, NodeCreatePayload } from './graph-types';
import type { LiveProfileScope } from './live-profile';
import {
  buildVaultMetadata,
  getOrCreateDailyPlan,
  isVaultMetadataForScope,
  suggestVaultPath,
} from './vault-types';
import {
  resolveScopedWikilinkTarget,
  uniqueWikilinkTargets,
} from './wikilink';

export type DailyOpenPlan =
  | { readonly action: 'select'; readonly id: string }
  | { readonly action: 'create'; readonly payload: NodeCreatePayload };

export function planOpenDaily(
  scope: LiveProfileScope,
  nodes: ReadonlyArray<Pick<GraphNode, 'id' | 'title' | 'nodeType' | 'metadata'>>,
  date: string | Date,
  now: string,
): DailyOpenPlan {
  const plan = getOrCreateDailyPlan(scope, nodes, date, now);
  return 'existingId' in plan
    ? { action: 'select', id: plan.existingId }
    : { action: 'create', payload: plan.create };
}

export interface WikilinkEnsureOp {
  readonly createStub?: NodeCreatePayload;
  readonly link: {
    readonly targetId?: string;
    readonly targetTitle: string;
    readonly label: 'wikilink';
  };
}

export function planEnsureWikilinks(
  scope: LiveProfileScope,
  source: Pick<GraphNode, 'id' | 'title' | 'metadata'>,
  body: string,
  nodes: ReadonlyArray<Pick<GraphNode, 'id' | 'title' | 'metadata'>>,
  links: ReadonlyArray<Pick<GraphLink, 'sourceId' | 'targetId' | 'label'>>,
  now: string,
): WikilinkEnsureOp[] {
  if (!isVaultMetadataForScope(source.metadata, scope)) return [];
  const operations: WikilinkEnsureOp[] = [];
  for (const target of uniqueWikilinkTargets(body)) {
    if (target.toLocaleLowerCase() === source.title.trim().toLocaleLowerCase()) continue;
    const existing = resolveScopedWikilinkTarget(target, nodes, scope);
    if (existing) {
      const alreadyLinked = links.some(
        (link) => link.sourceId === source.id && link.targetId === existing.id,
      );
      if (!alreadyLinked) {
        operations.push({
          link: {
            targetId: existing.id,
            targetTitle: existing.title,
            label: 'wikilink',
          },
        });
      }
      continue;
    }
    const content = `# ${target}\n\nStub created from a wikilink. Add content before relying on it.\n`;
    operations.push({
      createStub: {
        title: target,
        nodeType: 'wiki',
        color: '#8FA9B8',
        content,
        metadata: buildVaultMetadata({
          scope,
          content,
          path: suggestVaultPath('wiki', target),
          revision: 1,
          updatedAt: now,
        }),
      },
      link: { targetTitle: target, label: 'wikilink' },
    });
  }
  return operations;
}
