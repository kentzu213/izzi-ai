import React, { useCallback, useEffect, useRef, useState } from 'react';
import '../../styles/v2/tokens.css';
import '../../styles/v2/shell.css';
import '../../styles/v2/skin.css';
import '../../styles/v2/legacy.css';
import './shell-responsive.css';
import {
  getUiShellV2NavigatorPinned,
  getUiShellV2Theme,
  setUiShellV2NavigatorPinned,
  setUiShellV2Theme,
  type UiShellV2Theme,
} from '../../uiShellV2';
import { ContextNavigator } from './ContextNavigator';
import { ConversationSurface } from './ConversationSurface';
import { GlobalRail, type RailUser } from './GlobalRail';
import { Inspector } from './Inspector';
import { HomeSurface } from './HomeSurface';
import type { V2PageId, V2Surface } from './navModel';
import { ProjectHeader } from './ProjectHeader';
import { ProjectsSurface } from './ProjectsSurface';
import { ProjectWorkspaceSurface } from './ProjectWorkspaceSurface';

/*
 * AppShellV2 (spec/03): TitleBar → GlobalRail → ContextNavigator → Workspace →
 * Inspector. Rendered only when the `uiShellV2` flag is ON; legacy pages are
 * mounted unchanged as `children` inside the workspace.
 *
 * M3-A: Home and Projects are V2 surfaces that replace `children` while open.
 * Chat keeps its draft in the gateway store and the Home draft lives here, so
 * unmounting either loses nothing; navigating to any legacy page closes the
 * surface again.
 *
 * M3-B1: 'project' opens the active project's workspace (ProjectWorkspaceSurface).
 * 'conversation' opens one chat inside Home (ConversationSurface), so users keep
 * working from Home without jumping to the Project page.
 *
 * spec/04: at ≤1023px the navigator becomes a drawer over the workspace,
 * closed by default, closed again by Escape, the close button, the scrim or
 * navigating. Keep the query in sync with shell-responsive.css.
 */

export const COMPACT_QUERY = '(max-width: 1023px)';

function matchCompact(): MediaQueryList | null {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(COMPACT_QUERY)
    : null;
}

function useIsCompact(): boolean {
  const [isCompact, setIsCompact] = useState(() => matchCompact()?.matches ?? false);

  useEffect(() => {
    const query = matchCompact();
    if (!query) return undefined;
    const handleChange = () => setIsCompact(query.matches);
    handleChange();
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  return isCompact;
}

interface AppShellV2Props {
  currentPage: V2PageId;
  onNavigate: (page: V2PageId) => void;
  user?: RailUser | null;
  theme?: UiShellV2Theme;
  extensionUpdateCount?: number;
  /** Surface shown on first render; the prototype opens on Home. */
  initialSurface?: V2Surface | null;
  children: React.ReactNode;
}

export function AppShellV2({
  currentPage,
  onNavigate,
  user,
  theme,
  extensionUpdateCount = 0,
  initialSurface = null,
  children,
}: AppShellV2Props) {
  const [resolvedTheme, setResolvedTheme] = useState<UiShellV2Theme>(() => theme ?? getUiShellV2Theme());
  const isCompact = useIsCompact();
  const [isNavigatorPinned, setIsNavigatorPinned] = useState(() => getUiShellV2NavigatorPinned());
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [searchRequest, setSearchRequest] = useState(0);
  const [activeSurface, setActiveSurface] = useState<V2Surface | null>(initialSurface);
  const [homeDraft, setHomeDraft] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const navigatorToggleRef = useRef<HTMLButtonElement>(null);
  const isNavigatorOpen = isCompact ? isDrawerOpen : isNavigatorPinned;

  // Crossing the breakpoint never leaves a drawer covering the workspace.
  useEffect(() => {
    setIsDrawerOpen(false);
  }, [isCompact]);

  // The desktop collapse choice survives reload; the compact drawer never persists.
  const pinNavigator = useCallback((pinned: boolean) => {
    setIsNavigatorPinned(pinned);
    setUiShellV2NavigatorPinned(pinned);
  }, []);

  const requestSearch = useCallback(() => {
    if (isCompact) setIsDrawerOpen(true);
    else pinNavigator(true);
    setSearchRequest((count) => count + 1);
  }, [isCompact, pinNavigator]);

  const closeDrawer = () => {
    setIsDrawerOpen(false);
    navigatorToggleRef.current?.focus();
  };

  const toggleNavigator = () => {
    if (!isCompact) pinNavigator(!isNavigatorPinned);
    else if (isDrawerOpen) closeDrawer();
    else requestSearch();
  };

  const navigate = (page: V2PageId) => {
    setActiveSurface(null);
    onNavigate(page);
    if (isCompact) closeDrawer();
  };

  const selectSurface = (surface: V2Surface) => {
    setActiveSurface(surface);
    if (isCompact) closeDrawer();
  };

  // Only data-theme changes: nothing remounts, so drafts, surface and page stay.
  const toggleTheme = () => {
    const next: UiShellV2Theme = resolvedTheme === 'light' ? 'dark' : 'light';
    setResolvedTheme(next);
    setUiShellV2Theme(next);
  };

  // Focus after the navigator has re-rendered open.
  useEffect(() => {
    if (searchRequest > 0) searchRef.current?.focus();
  }, [searchRequest]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        requestSearch();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [requestSearch]);

  return (
    <div className="izzi-v2 v2-shell" data-theme={resolvedTheme === 'light' ? 'light' : undefined}>
      <GlobalRail
        currentPage={currentPage}
        activeSurface={activeSurface}
        onNavigate={navigate}
        onSelectSurface={selectSurface}
        onSearch={requestSearch}
        user={user}
      />
      {isNavigatorOpen ? (
        <ContextNavigator
          currentPage={currentPage}
          activeSurface={activeSurface}
          onNavigate={navigate}
          onSelectSurface={selectSurface}
          searchRef={searchRef}
          extensionUpdateCount={extensionUpdateCount}
          onClose={isCompact ? closeDrawer : undefined}
        />
      ) : null}
      {isCompact && isDrawerOpen ? <div className="v2-drawer-scrim" aria-hidden="true" onClick={closeDrawer} /> : null}
      <div className="v2-stage">
        <ProjectHeader
          currentPage={currentPage}
          activeSurface={activeSurface}
          onSelectSurface={selectSurface}
          isNavigatorOpen={isNavigatorOpen}
          isInspectorOpen={isInspectorOpen}
          onToggleNavigator={toggleNavigator}
          onToggleInspector={() => setIsInspectorOpen((open) => !open)}
          navigatorToggleRef={navigatorToggleRef}
          extensionUpdateCount={extensionUpdateCount}
          theme={resolvedTheme}
          onToggleTheme={toggleTheme}
        />
        {/* The surface modifier paints the V2 backdrop; legacy pages keep theirs. */}
        <main
          className={activeSurface ? 'main-content v2-workspace v2-workspace--surface' : 'main-content v2-workspace'}
          role="main"
          aria-label="Nội dung chính"
        >
          {activeSurface === 'home' ? (
            <HomeSurface
              draft={homeDraft}
              onDraftChange={setHomeDraft}
              onNavigate={navigate}
              onSelectSurface={selectSurface}
              isNavigatorOpen={isNavigatorOpen}
              onToggleNavigator={toggleNavigator}
            />
          ) : activeSurface === 'conversation' ? (
            <ConversationSurface
              onSelectSurface={selectSurface}
              isNavigatorOpen={isNavigatorOpen}
              onToggleNavigator={toggleNavigator}
            />
          ) : activeSurface === 'projects' ? (
            <ProjectsSurface onNavigate={navigate} onOpenProject={() => selectSurface('project')} />
          ) : activeSurface === 'project' ? (
            <ProjectWorkspaceSurface onSelectSurface={selectSurface} />
          ) : (
            children
          )}
        </main>
      </div>
      {isInspectorOpen ? <Inspector currentPage={currentPage} onClose={() => setIsInspectorOpen(false)} /> : null}
    </div>
  );
}
