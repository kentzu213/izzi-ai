import { describe, expect, it } from 'vitest';
import type { GraphNode } from './graph-types';
import {
  planLiveProfileGraphProjection,
  readLiveGraphProjectionMetadata,
} from './live-graph';
import {
  applyUserDirective,
  createLiveProfileDocument,
  proposeLiveDirective,
} from './live-profile';

const scope = { workspaceId: 'personal', ownerId: 'owner-7' };
const at = '2026-07-29T08:00:00.000Z';
const projectedAt = '2026-07-29T09:00:00.000Z';

function graphNode(
  id: string,
  metadata: Record<string, unknown>,
): Pick<GraphNode, 'id' | 'title' | 'nodeType' | 'content' | 'metadata'> {
  return { id, title: 'Existing', nodeType: 'live-preference', content: 'Old', metadata };
}

describe('LiveProfile graph projection', () => {
  it('projects only effective directives with complete provenance', () => {
    const base = createLiveProfileDocument({
      scope,
      documentRef: 'Live.md',
      now: at,
      defaults: [
        {
          id: 'default-tone',
          kind: 'preference',
          key: 'tone',
          value: 'Concise.',
        },
      ],
    });
    const proposed = proposeLiveDirective(base, {
      expectedRevision: 1,
      actor: { kind: 'agent', id: 'agent-editor' },
      id: 'pending-language',
      kind: 'preference',
      key: 'language',
      value: 'English.',
      reason: 'Observed in recent work.',
      now: '2026-07-29T08:01:00.000Z',
    });
    const edited = applyUserDirective(proposed, {
      expectedRevision: 2,
      actor: { kind: 'user', id: scope.ownerId },
      id: 'user-tone',
      kind: 'preference',
      key: 'tone',
      value: 'Concise with examples.',
      now: '2026-07-29T08:02:00.000Z',
    });

    const plan = planLiveProfileGraphProjection(edited, [], projectedAt);

    expect(plan.creates).toHaveLength(1);
    expect(plan.updates).toEqual([]);
    expect(plan.creates[0]).toMatchObject({
      title: 'Preference · tone',
      nodeType: 'live-preference',
      content: 'Concise with examples.',
      metadata: {
        kind: 'live-profile-projection',
        scope,
        classification: 'personal_graph',
        source: {
          profileId: edited.profileId,
          documentRef: 'Live.md',
          directiveId: 'user-tone',
          directiveSource: 'user',
          directiveRevision: 3,
          sourceUpdatedAt: '2026-07-29T08:02:00.000Z',
        },
        projectedAt,
      },
    });
  });

  it('updates stale same-scope projections and never overwrites a newer revision', () => {
    const document = applyUserDirective(
      createLiveProfileDocument({ scope, documentRef: 'Live.md', now: at }),
      {
        expectedRevision: 1,
        actor: { kind: 'user', id: scope.ownerId },
        id: 'user-hours',
        kind: 'rule',
        key: 'working-hours',
        value: 'Start at 09:00.',
        now: '2026-07-29T08:02:00.000Z',
      },
    );
    const initial = planLiveProfileGraphProjection(document, [], projectedAt).creates[0];
    const metadata = readLiveGraphProjectionMetadata(initial?.metadata);
    expect(metadata).not.toBeNull();

    const stale = graphNode('stale', {
      ...initial?.metadata,
      source: { ...metadata?.source, directiveRevision: 1 },
    });
    const newer = graphNode('newer', {
      ...initial?.metadata,
      source: { ...metadata?.source, directiveRevision: 99 },
    });

    expect(planLiveProfileGraphProjection(document, [stale], projectedAt)).toMatchObject({
      creates: [],
      updates: [{ id: 'stale', patch: { content: 'Start at 09:00.' } }],
      skippedNewer: [],
    });
    expect(planLiveProfileGraphProjection(document, [newer], projectedAt)).toMatchObject({
      creates: [],
      updates: [],
      skippedNewer: ['newer'],
    });
  });

  it('does not adopt a matching source reference from another workspace', () => {
    const document = createLiveProfileDocument({
      scope,
      documentRef: 'Live.md',
      now: at,
      defaults: [{ id: 'focus', kind: 'rule', key: 'focus', value: 'Protect mornings.' }],
    });
    const projected = planLiveProfileGraphProjection(document, [], projectedAt).creates[0];
    const foreign = graphNode('foreign', {
      ...projected?.metadata,
      scope: { workspaceId: 'other', ownerId: scope.ownerId },
    });

    const plan = planLiveProfileGraphProjection(document, [foreign], projectedAt);

    expect(plan.creates).toHaveLength(1);
    expect(plan.updates).toEqual([]);
  });
});
