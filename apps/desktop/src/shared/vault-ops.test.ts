import { describe, expect, it } from 'vitest';
import type { GraphNode } from './graph-types';
import { planEnsureWikilinks, planOpenDaily } from './vault-ops';
import { buildVaultMetadata } from './vault-types';

const scope = { workspaceId: 'personal', ownerId: 'owner-7' };
const otherScope = { workspaceId: 'other', ownerId: 'owner-7' };
const at = '2026-07-29T08:00:00.000Z';

function vaultNode(
  id: string,
  title: string,
  nodeType: string,
  nodeScope = scope,
  dailyDate?: string,
): Pick<GraphNode, 'id' | 'title' | 'nodeType' | 'metadata'> {
  const content = `# ${title}\n`;
  return {
    id,
    title,
    nodeType,
    metadata: buildVaultMetadata({
      scope: nodeScope,
      content,
      path: dailyDate ? `daily/${dailyDate}.md` : `wiki/${id}.md`,
      revision: 1,
      updatedAt: at,
      ...(dailyDate ? { dailyDate } : {}),
    }),
  };
}

describe('vault operation plans', () => {
  it('opens an existing daily note only when its vault scope matches exactly', () => {
    const foreign = vaultNode('foreign-daily', 'Daily 2026-07-29', 'daily', otherScope, '2026-07-29');
    const local = vaultNode('local-daily', 'Daily 2026-07-29', 'daily', scope, '2026-07-29');

    expect(planOpenDaily(scope, [foreign, local], '2026-07-29', at)).toEqual({
      action: 'select',
      id: 'local-daily',
    });
    expect(planOpenDaily(scope, [foreign], '2026-07-29', at)).toMatchObject({
      action: 'create',
      payload: {
        title: 'Daily 2026-07-29',
        nodeType: 'daily',
        metadata: {
          scope,
          path: 'daily/2026-07-29.md',
          dailyDate: '2026-07-29',
        },
      },
    });
  });

  it('links same-scope targets, ignores duplicates, and stubs unresolved titles', () => {
    const source = vaultNode('source', 'Project Plan', 'note');
    const pricing = vaultNode('pricing', 'Pricing', 'wiki');
    const foreignSecret = vaultNode('foreign-secret', 'Secrets', 'wiki', otherScope);

    const operations = planEnsureWikilinks(
      scope,
      source,
      'See [[Pricing]], [[Roadmap]], [[Secrets]], and [[Project Plan]].',
      [source, pricing, foreignSecret],
      [{ sourceId: source.id, targetId: pricing.id, label: 'wikilink' }],
      at,
    );

    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({
      createStub: {
        title: 'Roadmap',
        nodeType: 'wiki',
        metadata: {
          scope,
          path: 'wiki/roadmap.md',
          wikilinks: [],
        },
      },
      link: { targetTitle: 'Roadmap', label: 'wikilink' },
    });
    expect(operations[1]).toMatchObject({
      createStub: {
        title: 'Secrets',
        metadata: {
          scope,
          path: 'wiki/secrets.md',
        },
      },
      link: { targetTitle: 'Secrets', label: 'wikilink' },
    });
  });

  it('does not plan writes when the source node is outside the requested scope', () => {
    const source = vaultNode('foreign-source', 'Foreign', 'note', otherScope);

    expect(planEnsureWikilinks(scope, source, '[[Roadmap]]', [], [], at)).toEqual([]);
  });
});
