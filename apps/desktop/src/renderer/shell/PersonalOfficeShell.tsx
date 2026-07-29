/**
 * Personal Office shell — the container.
 *
 * Owns the chrome (top bar, nav, palette), the route outlet, and the global
 * shortcuts. Mounted from App.tsx only when the shell flag is on; the legacy
 * sidebar shell is the rollback path.
 *
 * Legacy pages are NOT re-implemented here. `renderLegacy` is passed down from
 * App.tsx, so every pre-existing surface keeps rendering its own component
 * inside the new chrome. Nothing is deleted in this loop.
 *
 * @module renderer/shell/PersonalOfficeShell
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkspaceInstanceId } from '../../shared/personal-office';
import { usePersonalOfficeStore } from '../store/personalOffice';
import { useWorkSnapshot } from './useWorkSnapshot';
import { ShellSidebar, ShellSheetNav } from './ShellNav';
import { ShellTopBar } from './ShellTopBar';
import { CommandPalette, type PaletteCommand } from './CommandPalette';
import { TodayPage } from './TodayPage';
import { WorkspacesPage } from './WorkspacesPage';
import { WorkspaceHome } from './WorkspaceHome';
import { MyGraphRoute } from './MyGraphRoute';
import { ShellSettingsPanel } from './ShellSettingsPanel';
import { SurfaceNotice } from './SurfaceState';
import { LEGACY_SURFACES, type LegacyPageId } from './legacySurfaces';
import { TOP_LEVEL_ROUTES, WORKSPACE_SURFACES, type ShellRoute } from './types';
import '../styles/personal-office.css';

interface PersonalOfficeShellProps {
  /** Renders a legacy page by id, supplied by App.tsx. */
  readonly renderLegacy: (page: LegacyPageId) => React.ReactNode;
  /** Switches the whole app back to the legacy sidebar shell. */
  readonly onDisableShell: () => void;
}

/**
 * Narrow breakpoint, matching the CSS.
 *
 * Below this the sidebar is replaced by a full-screen sheet rather than a
 * shrunken rail, so the menu button only exists here. Kept in sync with the
 * `--po-narrow` breakpoint in personal-office.css by hand: a media query in JS
 * and one in CSS cannot share a token without a build step.
 */
const NARROW_QUERY = '(max-width: 899px)';

function useIsNarrow(): boolean {
  const [isNarrow, setIsNarrow] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(NARROW_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsNarrow(event.matches);
    query.addEventListener('change', onChange);
    setIsNarrow(query.matches);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return isNarrow;
}

/** Is the event target a field where "/" should type a slash instead of opening search? */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

export function PersonalOfficeShell({ renderLegacy, onDisableShell }: PersonalOfficeShellProps) {
  const view = usePersonalOfficeStore((state) => state.view);
  const workspaceId = usePersonalOfficeStore((state) => state.workspaceId);
  const workspaceSurface = usePersonalOfficeStore((state) => state.workspaceSurface);
  const legacyPage = usePersonalOfficeStore((state) => state.legacyPage);
  const isPaletteOpen = usePersonalOfficeStore((state) => state.isPaletteOpen);
  const isNavSheetOpen = usePersonalOfficeStore((state) => state.isNavSheetOpen);
  const navigate = usePersonalOfficeStore((state) => state.navigate);
  const openWorkspace = usePersonalOfficeStore((state) => state.openWorkspace);
  const setWorkspaceSurface = usePersonalOfficeStore((state) => state.setWorkspaceSurface);
  const openLegacy = usePersonalOfficeStore((state) => state.openLegacy);
  const setPaletteOpen = usePersonalOfficeStore((state) => state.setPaletteOpen);
  const setNavSheetOpen = usePersonalOfficeStore((state) => state.setNavSheetOpen);

  const { snapshot, retry, delegate, isDelegating } = useWorkSnapshot();
  const isNarrow = useIsNarrow();

  /**
   * Favourites are a per-device preference, not domain truth: W1's
   * `WorkspaceInstance` has no `favorite` field (raised as CR-UX-02). Holding
   * them here keeps the shell honest instead of inventing a contract field.
   */
  const [favorites, setFavorites] = useState<readonly string[]>([]);

  /* ── global shortcuts ── */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const isPaletteChord = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      if (isPaletteChord) {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      // "/" is a search affordance only when the operator is not typing.
      if (event.key === '/' && !isTypingTarget(event.target)) {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setPaletteOpen]);

  const handleOpenWorkspace = useCallback(
    (id: WorkspaceInstanceId) => {
      openWorkspace(id);
    },
    [openWorkspace],
  );

  const handleToggleFavorite = useCallback((id: WorkspaceInstanceId) => {
    setFavorites((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }, []);

  /* ── palette commands ── */
  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [];

    for (const route of TOP_LEVEL_ROUTES) {
      list.push({
        id: `go:${route.id}`,
        label: route.label,
        group: 'Go to',
        hint: route.description,
        run: () => navigate(route.id),
      });
    }

    for (const workspace of snapshot.workspaces) {
      list.push({
        id: `ws:${workspace.id}`,
        label: workspace.name,
        group: 'Workspaces',
        keywords: ['workspace', 'open', 'switch'],
        run: () => handleOpenWorkspace(workspace.id),
      });
    }

    if (workspaceId) {
      for (const surface of WORKSPACE_SURFACES) {
        list.push({
          id: `surface:${surface.id}`,
          label: `Workspace · ${surface.label}`,
          group: 'This workspace',
          run: () => setWorkspaceSurface(surface.id),
        });
      }
    }

    for (const surface of LEGACY_SURFACES) {
      list.push({
        id: `legacy:${surface.id}`,
        label: surface.label,
        group: 'Other surfaces',
        keywords: [surface.description],
        hint: surface.description,
        run: () => openLegacy(surface.id),
      });
    }

    return list;
  }, [
    snapshot.workspaces,
    workspaceId,
    navigate,
    handleOpenWorkspace,
    setWorkspaceSurface,
    openLegacy,
  ]);

  /* ── context label for the top bar ── */
  const activeWorkspace = workspaceId
    ? snapshot.workspaces.find((workspace) => workspace.id === workspaceId)
    : undefined;

  const contextLabel = useMemo(() => {
    if (view === 'workspace') {
      const surface = WORKSPACE_SURFACES.find((item) => item.id === workspaceSurface);
      return [activeWorkspace?.name ?? 'Workspace', surface?.label].filter(Boolean).join(' · ');
    }
    if (view === 'legacy' && legacyPage) {
      return LEGACY_SURFACES.find((surface) => surface.id === legacyPage)?.label ?? 'Surface';
    }
    return TOP_LEVEL_ROUTES.find((route) => route.id === view)?.label ?? 'Today';
  }, [view, workspaceSurface, activeWorkspace, legacyPage]);

  /* ── outlet ── */
  function renderOutlet() {
    switch (view) {
      case 'today':
        return (
          <TodayPage
            snapshot={snapshot}
            onRetry={retry}
            onDelegate={delegate}
            isDelegating={isDelegating}
            onOpenWorkspace={handleOpenWorkspace}
          />
        );
      case 'workspaces':
        return (
          <WorkspacesPage
            snapshot={snapshot}
            favorites={favorites}
            onOpen={handleOpenWorkspace}
            onToggleFavorite={handleToggleFavorite}
            onRetry={retry}
          />
        );
      case 'workspace':
        return (
          <WorkspaceHome
            workspace={activeWorkspace}
            snapshot={snapshot}
            surface={workspaceSurface}
            onSurfaceChange={setWorkspaceSurface}
            onRetry={retry}
            onBack={() => navigate('workspaces')}
          />
        );
      case 'mygraph':
        return <MyGraphRoute snapshot={snapshot} renderGraph={() => renderLegacy('knowledge')} />;
      case 'market':
        return (
          <section className="po-surface" aria-labelledby="po-market-heading">
            <header className="po-surface__head">
              <h1 id="po-market-heading" className="po-surface__title">
                Market
              </h1>
              <p className="po-surface__lede">Add capabilities to your office.</p>
            </header>
            {snapshot.isOffline ? (
              <SurfaceNotice
                kind="offline"
                message="Market needs a connection. Reconnect to browse and install capabilities."
              />
            ) : (
              <div className="po-embed">{renderLegacy('marketplace')}</div>
            )}
          </section>
        );
      case 'settings':
        return (
          <ShellSettingsPanel onDisableShell={onDisableShell} onOpenLegacy={openLegacy}>
            {renderLegacy('settings')}
          </ShellSettingsPanel>
        );
      case 'legacy':
        return (
          <section className="po-surface" aria-labelledby="po-legacy-heading">
            <header className="po-surface__head">
              <h1 id="po-legacy-heading" className="po-surface__title">
                {contextLabel}
              </h1>
              <p className="po-surface__lede">
                An existing surface, opened inside the new shell.
              </p>
            </header>
            <div className="po-embed">{legacyPage ? renderLegacy(legacyPage) : null}</div>
          </section>
        );
      default:
        return null;
    }
  }

  return (
    <div className="po-shell">
      <ShellTopBar
        title={contextLabel}
        snapshot={snapshot}
        showMenuButton={isNarrow}
        onOpenNav={() => setNavSheetOpen(true)}
        onOpenPalette={() => setPaletteOpen(true)}
      />

      <div className="po-shell__body">
        <ShellSidebar view={view} onNavigate={(route: ShellRoute) => navigate(route)} />
        <main className="po-shell__main" id="po-main">
          {renderOutlet()}
        </main>
      </div>

      <ShellSheetNav
        view={view}
        isOpen={isNavSheetOpen}
        onNavigate={(route: ShellRoute) => navigate(route)}
        onClose={() => setNavSheetOpen(false)}
      />

      <CommandPalette
        isOpen={isPaletteOpen}
        commands={commands}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}
