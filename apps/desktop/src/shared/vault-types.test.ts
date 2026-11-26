import { describe, expect, it } from 'vitest';
import {
  buildVaultMetadata,
  dailyNoteTitle,
  getOrCreateDailyPlan,
  isVaultNodeType,
  normalizeDailyDate,
  suggestVaultPath,
  VAULT_KIND,
} from './vault-types';

describe('vault-types', () => {
  it('recognizes vault node types', () => {
    expect(isVaultNodeType('note')).toBe(true);
    expect(isVaultNodeType('wiki')).toBe(true);
    expect(isVaultNodeType('daily')).toBe(true);
    expect(isVaultNodeType('session')).toBe(false);
  });

  it('builds metadata with wikilinks from content', () => {
    const meta = buildVaultMetadata({
      content: 'See [[Alpha]] and [[Beta|B]].',
      tags: ['izzi'],
    });
    expect(meta.kind).toBe(VAULT_KIND);
    expect(meta.format).toBe('markdown');
    expect(meta.wikilinks).toEqual(['Alpha', 'Beta']);
    expect((meta.frontmatter as { tags: string[] }).tags).toEqual(['izzi']);
  });

  it('normalizes daily date and title', () => {
    expect(normalizeDailyDate('2026-07-14')).toBe('2026-07-14');
    expect(dailyNoteTitle('2026-07-14')).toBe('Daily 2026-07-14');
  });

  it('getOrCreateDailyPlan returns existing by dailyDate', () => {
    const nodes = [
      {
        id: 'd1',
        title: 'Daily 2026-07-14',
        nodeType: 'daily',
        metadata: { kind: VAULT_KIND, dailyDate: '2026-07-14' },
      },
    ];
    const plan = getOrCreateDailyPlan(nodes, '2026-07-14');
    expect(plan).toEqual({ existingId: 'd1' });
  });

  it('getOrCreateDailyPlan creates when missing', () => {
    const plan = getOrCreateDailyPlan([], '2026-07-15');
    expect('create' in plan).toBe(true);
    if ('create' in plan) {
      expect(plan.create.title).toBe('Daily 2026-07-15');
      expect(plan.create.nodeType).toBe('daily');
      expect(plan.create.metadata).toMatchObject({
        kind: VAULT_KIND,
        dailyDate: '2026-07-15',
      });
    }
  });

  it('suggests vault paths', () => {
    expect(suggestVaultPath('daily', 'Daily 2026-07-14', '2026-07-14')).toBe('daily/2026-07-14.md');
    expect(suggestVaultPath('wiki', 'Pricing Page')).toMatch(/^wiki\//);
    expect(suggestVaultPath('note', 'Hello World')).toMatch(/^notes\//);
  });
});
