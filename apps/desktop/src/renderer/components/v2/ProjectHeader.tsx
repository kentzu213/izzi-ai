import React, { useMemo } from 'react';
import { filterProjects, useProjectWorkspaceStore } from '../../store/projectWorkspace';
import type { UiShellV2Theme } from '../../uiShellV2';
import { RAIL_PRIMARY, findNavItem, type V2PageId, type V2Surface } from './navModel';

/*
 * ProjectHeader (spec/03): breadcrumb + project switcher + panel toggles;
 * Home shows only the toggles. No <h1> — each page or surface renders its own heading.
 * Picking a project in the switcher selects it and opens its workspace (M3-B1);
 * collaborator avatars and the tab row are still pending.
 */

interface ProjectHeaderProps {
  currentPage: V2PageId;
  /** Open V2 surface (Home/Projects); null while a legacy page is shown. */
  activeSurface?: V2Surface | null;
  onSelectSurface?: (surface: V2Surface) => void;
  isNavigatorOpen: boolean;
  isInspectorOpen: boolean;
  onToggleNavigator: () => void;
  onToggleInspector: () => void;
  navigatorToggleRef?: React.Ref<HTMLButtonElement>;
  extensionUpdateCount?: number;
  /** Current V2 theme; the switch renders only when onToggleTheme is given. */
  theme?: UiShellV2Theme;
  onToggleTheme?: () => void;
}

export function ProjectHeader({
  currentPage,
  activeSurface = null,
  onSelectSurface,
  isNavigatorOpen,
  isInspectorOpen,
  onToggleNavigator,
  onToggleInspector,
  navigatorToggleRef,
  extensionUpdateCount = 0,
  theme = 'dark',
  onToggleTheme,
}: ProjectHeaderProps) {
  const projects = useProjectWorkspaceStore((state) => state.projects);
  const activeProjectId = useProjectWorkspaceStore((state) => state.activeProjectId);
  const selectProject = useProjectWorkspaceStore((state) => state.selectProject);
  const openProjects = useMemo(() => filterProjects(projects, 'active', ''), [projects]);
  const switcherValue = openProjects.some((project) => project.id === activeProjectId) ? (activeProjectId ?? '') : '';

  // A project workspace sits under Projects in the breadcrumb; a Home conversation under Home.
  const railSurface =
    activeSurface === 'project' ? 'projects' : activeSurface === 'conversation' ? 'home' : activeSurface;
  const surfaceLabel = railSurface ? RAIL_PRIMARY.find((item) => item.surface === railSurface)?.label : undefined;
  const match = surfaceLabel ? undefined : findNavItem(currentPage);
  // The navigator badge is hidden while the navigator is closed; surface it here.
  const hasHiddenUpdates = !isNavigatorOpen && extensionUpdateCount > 0;
  const navigatorLabel = isNavigatorOpen ? 'Ẩn danh mục trang' : 'Hiện danh mục trang';
  // Home carries its own greeting; the breadcrumb and project switcher stay out of it.
  const isHome = activeSurface === 'home';

  const switchProject = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const id = event.target.value || null;
    selectProject(id);
    if (id) onSelectSurface?.('project');
  };

  return (
    <header className="v2-header">
      <button
        ref={navigatorToggleRef}
        type="button"
        className="v2-header__toggle"
        aria-label={hasHiddenUpdates ? `${navigatorLabel}, ${extensionUpdateCount} bản cập nhật extension` : navigatorLabel}
        aria-expanded={isNavigatorOpen}
        onClick={onToggleNavigator}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
          <path d="M9 4.5v15" />
        </svg>
        {hasHiddenUpdates ? <span className="v2-header__dot" aria-hidden="true" /> : null}
      </button>

      {isHome ? null : (
        <nav className="v2-header__breadcrumb" aria-label="Vị trí">
          <ol>
            <li>Izzi AI</li>
            {match ? <li>{match.group.label}</li> : null}
            <li aria-current="page">{surfaceLabel ?? match?.item.label ?? currentPage}</li>
          </ol>
        </nav>
      )}

      <div className="v2-header__actions">
        {isHome ? null : (
          <label className="v2-header__project">
            <span className="v2-visually-hidden">Dự án đang chọn</span>
            <select className="v2-header__project-select" value={switcherValue} onChange={switchProject}>
              <option value="">Chưa chọn dự án</option>
              {openProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {onToggleTheme ? (
          <button
            type="button"
            className="v2-header__toggle"
            aria-label="Giao diện sáng"
            aria-pressed={theme === 'light'}
            onClick={onToggleTheme}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
            </svg>
          </button>
        ) : null}

        <button
          type="button"
          className="v2-header__toggle"
          aria-label="Bảng thông tin trang"
          aria-pressed={isInspectorOpen}
          onClick={onToggleInspector}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
            <path d="M15 4.5v15" />
          </svg>
        </button>
      </div>
    </header>
  );
}
