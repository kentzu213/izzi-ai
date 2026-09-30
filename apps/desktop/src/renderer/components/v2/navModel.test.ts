import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ALL_NAV_ITEMS,
  NAV_GROUPS,
  RAIL_CAPABILITIES,
  RAIL_PRIMARY,
  RAIL_SETTINGS,
  filterNavGroups,
  findNavItem,
  isRailItemActive,
  type V2PageId,
} from './navModel';

/*
 * Izzi AI V2 — M2 navigation coverage. Unlike navigationMap.test.ts (whose
 * literal regex skips hyphenated IDs), this parses `type Page` with
 * `[a-z-]+` so `scheduled-sessions` and `customer-marketing` are covered too.
 */

const appSource = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8');

function appPageIds(): string[] {
  const union = appSource.match(/type Page\s*=\s*([\s\S]*?);/)?.[1] ?? '';
  return [...union.matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);
}

describe('V2 navigation model', () => {
  it('covers every App.tsx Page ID, including hyphenated ones', () => {
    const appIds = appPageIds();

    expect(appIds).toHaveLength(18);
    expect(appIds).toContain('scheduled-sessions');
    expect(appIds).toContain('customer-marketing');
    expect(new Set(ALL_NAV_ITEMS.map((item) => item.page))).toEqual(new Set(appIds));
  });

  it('lists every page exactly once across the navigator groups', () => {
    const pages = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.page));

    expect(pages).toHaveLength(new Set(pages).size);
    expect(pages).toHaveLength(appPageIds().length);
  });

  it('points every rail entry at a real page, a V2 surface or marks it as a placeholder', () => {
    const appIds = new Set(appPageIds());
    const railItems = [...RAIL_PRIMARY, ...RAIL_CAPABILITIES, RAIL_SETTINGS];

    for (const item of railItems) {
      if (item.surface) {
        expect(item.page).toBeUndefined();
      } else if (item.page) {
        expect(appIds.has(item.page)).toBe(true);
      } else {
        expect(item.placeholderHint).toBeTruthy();
      }
    }
  });

  it('keeps the four required capabilities in the rail', () => {
    expect(RAIL_CAPABILITIES.map((item) => item.id)).toEqual([
      'agent-marketing',
      'knowlead-market',
      'affiliate',
      'mygraph',
    ]);
  });

  it('does not map Knowlead Market onto the legacy marketplace page', () => {
    const knowlead = RAIL_CAPABILITIES.find((item) => item.id === 'knowlead-market');

    expect(knowlead?.page).toBeUndefined();
    expect(knowlead?.placeholderHint).toBeTruthy();
  });

  it('resolves every page to its group and label', () => {
    for (const item of ALL_NAV_ITEMS) {
      expect(findNavItem(item.page)?.item).toBe(item);
    }
  });

  it('returns all groups for an empty query', () => {
    expect(filterNavGroups('   ')).toBe(NAV_GROUPS);
  });

  it('filters by label, note and page ID case-insensitively', () => {
    const marketingPages = filterNavGroups('MARKETING').flatMap((group) => group.items.map((item) => item.page));
    const notePages = filterNavGroups('knowleadmarket').flatMap((group) => group.items.map((item) => item.page));
    const idPages = filterNavGroups('scheduled-sessions').flatMap((group) => group.items.map((item) => item.page));

    expect(marketingPages).toEqual(expect.arrayContaining<V2PageId>(['customer-marketing', 'marketing']));
    expect(notePages).toEqual(['marketplace']);
    expect(idPages).toEqual(['scheduled-sessions']);
  });

  it('drops groups with no match', () => {
    expect(filterNavGroups('khong-co-trang-nay')).toEqual([]);
  });

  it('never marks a placeholder rail entry as active', () => {
    const knowlead = RAIL_CAPABILITIES.find((item) => item.id === 'knowlead-market');
    const agentMarketing = RAIL_CAPABILITIES.find((item) => item.id === 'agent-marketing');

    expect(knowlead && isRailItemActive(knowlead, 'marketplace')).toBe(false);
    expect(agentMarketing && isRailItemActive(agentMarketing, 'customer-marketing')).toBe(true);
  });

  it('opens Home and Projects as V2 surfaces and marks only the open surface active', () => {
    const [home, projects] = RAIL_PRIMARY;
    const agentMarketing = RAIL_CAPABILITIES.find((item) => item.id === 'agent-marketing');

    expect(RAIL_PRIMARY.map((item) => [item.id, item.surface])).toEqual([
      ['home', 'home'],
      ['projects', 'projects'],
    ]);
    expect(isRailItemActive(home, 'chat', 'home')).toBe(true);
    expect(isRailItemActive(projects, 'chat', 'home')).toBe(false);
    expect(isRailItemActive(home, 'chat', null)).toBe(false);
    expect(agentMarketing && isRailItemActive(agentMarketing, 'customer-marketing', 'projects')).toBe(false);
  });

  it('keeps Projects lit inside a project workspace without adding a rail entry (M3-B1)', () => {
    const [home, projects] = RAIL_PRIMARY;

    expect(isRailItemActive(projects, 'chat', 'project')).toBe(true);
    expect(isRailItemActive(home, 'chat', 'project')).toBe(false);
    expect(RAIL_PRIMARY.some((item) => item.surface === 'project')).toBe(false);
  });

  it('keeps Home lit while a conversation is open inside the Home workspace', () => {
    const [home, projects] = RAIL_PRIMARY;

    expect(isRailItemActive(home, 'chat', 'conversation')).toBe(true);
    expect(isRailItemActive(projects, 'chat', 'conversation')).toBe(false);
    expect(RAIL_PRIMARY.some((item) => item.surface === 'conversation')).toBe(false);
  });
});
