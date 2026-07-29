import { describe, expect, it } from 'vitest';
import {
  buildVaultMetadata,
  isVaultMetadataForScope,
  normalizeVaultRelativePath,
  suggestVaultPath,
} from './vault-types';

const scope = { workspaceId: 'personal', ownerId: 'owner-7' };

describe('vault paths and metadata scope', () => {
  it('normalizes safe markdown paths', () => {
    expect(normalizeVaultRelativePath('notes/Project Plan.md')).toBe('notes/Project Plan.md');
    expect(suggestVaultPath('wiki', 'Pricing Page')).toBe('wiki/pricing-page.md');
  });

  it.each([
    '../Live.md',
    'notes/../../Live.md',
    '/absolute.md',
    'C:\\Users\\owner\\secret.md',
    '\\\\server\\share\\note.md',
    'notes/not-markdown.txt',
    'notes/\u0000bad.md',
    'notes/CON.md',
    'notes/bad:name.md',
  ])('rejects unsafe path %s', (candidate) => {
    expect(() => normalizeVaultRelativePath(candidate)).toThrow();
  });

  it('binds metadata to the exact workspace and owner', () => {
    const metadata = buildVaultMetadata({
      scope,
      content: 'See [[Pricing]].',
      path: 'notes/plan.md',
      revision: 4,
      updatedAt: '2026-07-29T08:00:00.000Z',
    });

    expect(isVaultMetadataForScope(metadata, scope)).toBe(true);
    expect(
      isVaultMetadataForScope(metadata, { workspaceId: 'other', ownerId: scope.ownerId }),
    ).toBe(false);
  });
});
