/*
 * Izzi AI V2 — M2 navigation model (spec/01 information architecture, spec/05).
 *
 * Pure data, no JSX, so it can be unit-tested in the node environment.
 *
 * V2PageId mirrors App.tsx `type Page` one-to-one: the V2 shell only changes
 * how legacy pages are reached, never which pages exist. Every page stays
 * reachable from the ContextNavigator; the GlobalRail adds the spec's Tier A
 * and Tier B entry points on top.
 */

export type V2PageId =
  | 'chat'
  | 'tasks'
  | 'memory'
  | 'status'
  | 'dashboard'
  | 'marketplace'
  | 'agents'
  | 'extensions'
  | 'settings'
  | 'setup'
  | 'costs'
  | 'knowledge'
  | 'connections'
  | 'autopost'
  | 'scheduled-sessions'
  | 'marketing'
  | 'customer-marketing'
  | 'affiliate';

export type RailIcon =
  | 'home'
  | 'projects'
  | 'agent-marketing'
  | 'knowlead-market'
  | 'affiliate'
  | 'mygraph'
  | 'search'
  | 'settings';

/**
 * V2-only surfaces rendered inside the workspace instead of a legacy page.
 * 'project' (M3-B1) is the workspace of the active project; it has no rail
 * entry of its own and lights up Projects.
 * 'conversation' is one chat opened inside the Home workspace; it lights up Home.
 */
export type V2Surface = 'home' | 'projects' | 'project' | 'conversation';

export interface RailItem {
  id: string;
  label: string;
  icon: RailIcon;
  /** Legacy page this entry opens; absent when the entry is a placeholder. */
  page?: V2PageId;
  /** V2 surface this entry opens instead of a legacy page. */
  surface?: V2Surface;
  /** Shown as tooltip/description when the entry is a disabled placeholder. */
  placeholderHint?: string;
}

export interface NavItem {
  page: V2PageId;
  label: string;
  /** Extra searchable text, e.g. the legacy sidebar label when it differs. */
  note?: string;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

/** Tier A (spec/01). Both open V2 surfaces (M3-A) instead of a legacy page. */
export const RAIL_PRIMARY: RailItem[] = [
  { id: 'home', label: 'Home', icon: 'home', surface: 'home' },
  { id: 'projects', label: 'Projects', icon: 'projects', surface: 'projects' },
];

/**
 * Tier B — the four capabilities that must always be visible (spec/01).
 * Knowlead Market is deliberately NOT mapped to the legacy `marketplace` page:
 * its business scope is still open, so it stays a visible placeholder.
 */
export const RAIL_CAPABILITIES: RailItem[] = [
  { id: 'agent-marketing', label: 'Agent Marketing', icon: 'agent-marketing', page: 'customer-marketing' },
  {
    id: 'knowlead-market',
    label: 'Knowlead Market',
    icon: 'knowlead-market',
    placeholderHint: 'Chưa chốt nghiệp vụ',
  },
  { id: 'affiliate', label: 'Affiliate', icon: 'affiliate', page: 'affiliate' },
  { id: 'mygraph', label: 'MyGraph', icon: 'mygraph', page: 'knowledge' },
];

export const RAIL_SETTINGS: RailItem = { id: 'settings', label: 'Settings', icon: 'settings', page: 'settings' };

/** Every legacy page exactly once. Tier C names follow spec/01. */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { page: 'chat', label: 'Chat agent' },
      { page: 'setup', label: 'Capture setup' },
      { page: 'knowledge', label: 'MyGraph' },
      { page: 'tasks', label: 'Replay tasks' },
      { page: 'memory', label: 'Recall library' },
      { page: 'status', label: 'Guardrails' },
      { page: 'dashboard', label: 'Operations' },
      { page: 'scheduled-sessions', label: 'Phiên đặt lịch' },
    ],
  },
  {
    id: 'growth',
    label: 'Growth',
    items: [
      { page: 'customer-marketing', label: 'Agent Marketing' },
      { page: 'marketing', label: 'Phòng Marketing' },
      { page: 'autopost', label: 'Auto-Post' },
      { page: 'affiliate', label: 'Affiliate' },
    ],
  },
  {
    id: 'agents',
    label: 'Agents',
    items: [
      { page: 'agents', label: 'Agent hub' },
      { page: 'extensions', label: 'Workflow imports' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [
      { page: 'marketplace', label: 'Marketplace', note: 'Knowleadmarket' },
      { page: 'connections', label: 'Models & API' },
      { page: 'costs', label: 'Cost / Usage' },
      { page: 'settings', label: 'Settings' },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

export function findNavItem(page: V2PageId): { group: NavGroup; item: NavItem } | undefined {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((candidate) => candidate.page === page);
    if (item) return { group, item };
  }
  return undefined;
}

export function filterNavGroups(query: string): NavGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return NAV_GROUPS;
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      [item.label, item.note ?? '', item.page].some((text) => text.toLowerCase().includes(needle)),
    ),
  })).filter((group) => group.items.length > 0);
}

export function isRailItemActive(item: RailItem, currentPage: V2PageId, activeSurface: V2Surface | null = null): boolean {
  if (item.surface !== undefined) {
    return (
      item.surface === activeSurface ||
      (item.surface === 'projects' && activeSurface === 'project') ||
      (item.surface === 'home' && activeSurface === 'conversation')
    );
  }
  return activeSurface === null && item.page !== undefined && item.page === currentPage;
}
