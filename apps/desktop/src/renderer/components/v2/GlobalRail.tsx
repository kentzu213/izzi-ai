import React from 'react';
import {
  AffiliateIcon,
  AppLogoMark,
  ChatIcon,
  CostIcon,
  ExtensionIcon,
  GraphIcon,
  MarketplaceIcon,
  MemoryIcon,
  OverviewIcon,
  PlanningIcon,
  RefreshIcon,
  SettingsIcon,
  SparkIcon,
  TasksIcon,
  TrendUpIcon,
} from '../AppIcons';
import { useProjectWorkspaceStore } from '../../store/projectWorkspace';
import {
  RAIL_CAPABILITIES,
  RAIL_PRIMARY,
  RAIL_SETTINGS,
  isRailItemActive,
  type RailIcon,
  type RailItem,
  type V2PageId,
  type V2Surface,
} from './navModel';

/*
 * GlobalRail (spec/03, prototype 01): labeled sidebar. One main list (Home,
 * Projects and the four Tier B capabilities), then "Thư viện" and "Công cụ"
 * with existing legacy pages only, then settings and the user card.
 * Capabilities without a legacy page or V2 surface are focusable but
 * aria-disabled. The search entry is only shown while the navigator search is
 * hidden (≤1023px, where shell-responsive.css collapses the rail to icons).
 */

function SearchGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

const ICONS: Record<RailIcon, (props: { className?: string }) => React.JSX.Element> = {
  home: OverviewIcon,
  projects: PlanningIcon,
  'agent-marketing': TrendUpIcon,
  'knowlead-market': MarketplaceIcon,
  affiliate: AffiliateIcon,
  mygraph: GraphIcon,
  search: SearchGlyph,
  settings: SettingsIcon,
};

/** Vietnamese display names from the prototype; navModel ids and breadcrumbs keep theirs. */
const DISPLAY_LABELS: Partial<Record<string, string>> = {
  home: 'Trang chủ',
  projects: 'Dự án của tôi',
  settings: 'Cài đặt',
};

interface PageLink {
  page: V2PageId;
  label: string;
  Icon: (props: { className?: string }) => React.JSX.Element;
}

/** "Thư viện" group: existing legacy pages only. */
const LIBRARY_ITEMS: PageLink[] = [
  { page: 'chat', label: 'Cuộc trò chuyện', Icon: ChatIcon },
  { page: 'tasks', label: 'Tác vụ', Icon: TasksIcon },
  { page: 'memory', label: 'Bộ nhớ', Icon: MemoryIcon },
  { page: 'scheduled-sessions', label: 'Phiên định kỳ', Icon: RefreshIcon },
];

/** "Công cụ" group: existing legacy pages only, labels unchanged. */
const TOOL_ITEMS: PageLink[] = [
  { page: 'marketplace', label: 'Marketplace', Icon: ExtensionIcon },
  { page: 'connections', label: 'Models & API', Icon: SparkIcon },
  { page: 'costs', label: 'Cost / Usage', Icon: CostIcon },
];

export interface RailUser {
  name?: string;
  avatar?: unknown;
  plan?: string;
}

interface GlobalRailProps {
  currentPage: V2PageId;
  /** Open V2 surface (Home/Projects); null while a legacy page is shown. */
  activeSurface?: V2Surface | null;
  onNavigate: (page: V2PageId) => void;
  onSelectSurface?: (surface: V2Surface) => void;
  onSearch: () => void;
  user?: RailUser | null;
}

function userInitials(user: RailUser | null | undefined): string {
  if (typeof user?.avatar === 'string' && user.avatar.length > 0 && user.avatar.length <= 2) return user.avatar;
  const name = user?.name || 'User';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

interface RailButtonProps {
  item: RailItem;
  currentPage: V2PageId;
  activeSurface: V2Surface | null;
  onNavigate: (page: V2PageId) => void;
  onSelectSurface: (surface: V2Surface) => void;
  count?: number;
}

function RailButton({ item, currentPage, activeSurface, onNavigate, onSelectSurface, count }: RailButtonProps) {
  const Icon = ICONS[item.icon];
  const isActive = isRailItemActive(item, currentPage, activeSurface);
  const isPlaceholder = item.page === undefined && item.surface === undefined;
  const name = DISPLAY_LABELS[item.id] ?? item.label;
  const label = isPlaceholder && item.placeholderHint ? `${name} (${item.placeholderHint})` : name;
  const className = ['v2-rail__item', isActive ? 'is-active' : '', isPlaceholder ? 'is-placeholder' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      aria-disabled={isPlaceholder ? 'true' : undefined}
      data-rail-id={item.id}
      onClick={() => {
        if (item.surface) onSelectSurface(item.surface);
        else if (item.page) onNavigate(item.page);
      }}
    >
      <Icon className="v2-rail__icon" />
      <span className="v2-rail__label" aria-hidden="true">
        {name}
      </span>
      {isPlaceholder ? (
        <span className="v2-rail__tag" aria-hidden="true">
          Sắp có
        </span>
      ) : null}
      {count !== undefined && count > 0 ? (
        <span className="v2-rail__count" aria-hidden="true">
          {count}
        </span>
      ) : null}
      <span className="v2-rail__tooltip" aria-hidden="true">
        {label}
      </span>
    </button>
  );
}

interface PageGroupProps {
  title: string;
  items: PageLink[];
  currentPage: V2PageId;
  activeSurface: V2Surface | null;
  onNavigate: (page: V2PageId) => void;
}

function PageGroup({ title, items, currentPage, activeSurface, onNavigate }: PageGroupProps) {
  return (
    <>
      <div className="v2-rail__section-title" aria-hidden="true">
        {title}
      </div>
      <div className="v2-rail__section" role="group" aria-label={title}>
        {items.map(({ page, label, Icon }) => {
          const isActive = !activeSurface && currentPage === page;
          return (
            <button
              key={page}
              type="button"
              className={isActive ? 'v2-rail__item is-active' : 'v2-rail__item'}
              aria-label={label}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onNavigate(page)}
            >
              <Icon className="v2-rail__icon" />
              <span className="v2-rail__label" aria-hidden="true">
                {label}
              </span>
              <span className="v2-rail__tooltip" aria-hidden="true">
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

export function GlobalRail({ currentPage, activeSurface = null, onNavigate, onSelectSurface, onSearch, user }: GlobalRailProps) {
  const initials = userInitials(user);
  const displayName = user?.name || 'User';
  const plan = user?.plan || 'Free';
  const profileLabel = `${displayName} · ${plan}`;
  const railProps = { currentPage, activeSurface, onNavigate, onSelectSurface: onSelectSurface ?? (() => undefined) };
  const openProjectCount = useProjectWorkspaceStore((state) => state.projects.filter((project) => !project.archived).length);

  return (
    <nav className="v2-rail" aria-label="Điều hướng chính">
      <div className="v2-rail__brand">
        <div className="v2-rail__logo" aria-hidden="true">
          <AppLogoMark className="v2-rail__logo-mark" />
        </div>
        <span className="v2-rail__brand-name">Izzi AI</span>
      </div>

      <div className="v2-rail__scroll">
        <div className="v2-rail__section" role="group" aria-label="Năng lực chính">
          {RAIL_PRIMARY.map((item) => (
            <RailButton key={item.id} item={item} count={item.id === 'projects' ? openProjectCount : undefined} {...railProps} />
          ))}
          {RAIL_CAPABILITIES.map((item) => (
            <RailButton key={item.id} item={item} {...railProps} />
          ))}
          <button type="button" className="v2-rail__item v2-rail__item--search" aria-label="Tìm trang (Ctrl+K)" onClick={onSearch}>
            <SearchGlyph className="v2-rail__icon" />
            <span className="v2-rail__label" aria-hidden="true">
              Tìm kiếm
            </span>
            <span className="v2-rail__tooltip" aria-hidden="true">
              Tìm trang (Ctrl+K)
            </span>
          </button>
        </div>

        <PageGroup title="Thư viện" items={LIBRARY_ITEMS} currentPage={currentPage} activeSurface={activeSurface} onNavigate={onNavigate} />
        <PageGroup title="Công cụ" items={TOOL_ITEMS} currentPage={currentPage} activeSurface={activeSurface} onNavigate={onNavigate} />
      </div>

      <div className="v2-rail__footer">
        <RailButton item={RAIL_SETTINGS} {...railProps} />
        <div className="v2-rail__user">
          <div className="v2-rail__avatar" role="img" aria-label={profileLabel} title={profileLabel}>
            {initials}
          </div>
          <div className="v2-rail__user-text" aria-hidden="true">
            <span className="v2-rail__user-name">{displayName}</span>
            <span className="v2-rail__user-plan">{plan}</span>
          </div>
        </div>
      </div>
    </nav>
  );
}
