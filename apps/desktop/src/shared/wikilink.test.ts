import { describe, expect, it } from 'vitest';
import {
  parseWikilinks,
  resolveScopedWikilinkTarget,
  uniqueWikilinkTargets,
} from './wikilink';
import { buildVaultMetadata } from './vault-types';

const scope = { workspaceId: 'personal', ownerId: 'owner-7' };
const otherScope = { workspaceId: 'other', ownerId: 'owner-7' };

describe('wikilink parsing and scoped resolution', () => {
  it('parses labels and de-duplicates normalized targets', () => {
    expect(parseWikilinks('See [[Pricing]] and [[pricing|Billing]].')).toMatchObject([
      { target: 'Pricing', label: 'Pricing' },
      { target: 'pricing', label: 'Billing' },
    ]);
    expect(uniqueWikilinkTargets('[[Pricing]] [[pricing|Billing]] [[Roadmap]]')).toEqual([
      'Pricing',
      'Roadmap',
    ]);
  });

  it.each(['[[../Live]]', '[[notes/secret]]', '[[C:\\secret]]', '[[https://example.com]]'])(
    'drops unsafe target in %s',
    (markdown) => {
      expect(parseWikilinks(markdown)).toEqual([]);
    },
  );

  it('never resolves a title from another workspace', () => {
    const local = {
      id: 'local',
      title: 'Pricing',
      metadata: buildVaultMetadata({
        scope,
        content: '',
        path: 'wiki/pricing.md',
        revision: 1,
        updatedAt: '2026-07-29T08:00:00.000Z',
      }),
    };
    const foreign = {
      id: 'foreign',
      title: 'Secrets',
      metadata: buildVaultMetadata({
        scope: otherScope,
        content: '',
        path: 'wiki/secrets.md',
        revision: 1,
        updatedAt: '2026-07-29T08:00:00.000Z',
      }),
    };

    expect(resolveScopedWikilinkTarget('pricing', [foreign, local], scope)?.id).toBe('local');
    expect(resolveScopedWikilinkTarget('Secrets', [foreign, local], scope)).toBeNull();
  });
});
