/**
 * Personal Office shell — navigation state.
 *
 * Deliberately separate from `agentWorkspace` (legacy, compatibility read-only
 * for this loop) and from work data (see shell/workAdapter). This store holds
 * only where the operator is and which overlays are open.
 *
 * The remembered workspace is a convenience, never a router: landing is always
 * Today so an urgent approval cannot be skipped by restoring a deep route.
 *
 * @module renderer/store/personalOffice
 */

import { create } from 'zustand';
import type { WorkspaceInstanceId } from '../../shared/personal-office';
import {
  DEFAULT_ROUTE,
  type ShellRoute,
  type WorkspaceSurface,
  WORKSPACE_SURFACES,
} from '../shell/types';

const LAST_WORKSPACE_KEY = 'izzi.shell.lastWorkspaceId';

function readLastWorkspace(): WorkspaceInstanceId | null {
  try {
    const raw = window.localStorage.getItem(LAST_WORKSPACE_KEY);
    return raw ? (raw as WorkspaceInstanceId) : null;
  } catch {
    return null;
  }
}

function persistLastWorkspace(id: WorkspaceInstanceId): void {
  try {
    window.localStorage.setItem(LAST_WORKSPACE_KEY, id);
  } catch {
    // Storage denied (private mode / disabled). Remembering is optional.
  }
}

export interface PersonalOfficeState {
  route: ShellRoute;
  workspaceId: WorkspaceInstanceId | null;
  workspaceSurface: WorkspaceSurface;
  /** Legacy page id currently hosted by the adapter route, if any. */
  legacyPage: string | null;
  isPaletteOpen: boolean;
  isNavSheetOpen: boolean;
  isSetupDrawerOpen: boolean;

  navigate: (route: ShellRoute) => void;
  openWorkspace: (id: WorkspaceInstanceId, surface?: WorkspaceSurface) => void;
  setWorkspaceSurface: (surface: WorkspaceSurface) => void;
  openLegacy: (page: string) => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  setNavSheetOpen: (open: boolean) => void;
  setSetupDrawerOpen: (open: boolean) => void;
  reset: () => void;
}

export const usePersonalOfficeStore = create<PersonalOfficeState>((set, get) => ({
  route: DEFAULT_ROUTE,
  workspaceId: readLastWorkspace(),
  workspaceSurface: WORKSPACE_SURFACES[0],
  legacyPage: null,
  isPaletteOpen: false,
  isNavSheetOpen: false,
  isSetupDrawerOpen: false,

  navigate: (route) =>
    set({
      route,
      // Leaving a workspace closes its drawer; overlays never survive a route change.
      isNavSheetOpen: false,
      isPaletteOpen: false,
      isSetupDrawerOpen: route === 'workspace' ? get().isSetupDrawerOpen : false,
      legacyPage: route === 'legacy' ? get().legacyPage : null,
    }),

  openWorkspace: (id, surface) => {
    persistLastWorkspace(id);
    set({
      route: 'workspace',
      workspaceId: id,
      workspaceSurface: surface ?? WORKSPACE_SURFACES[0],
      isNavSheetOpen: false,
      isPaletteOpen: false,
    });
  },

  setWorkspaceSurface: (surface) => set({ workspaceSurface: surface }),

  openLegacy: (page) =>
    set({ route: 'legacy', legacyPage: page, isNavSheetOpen: false, isPaletteOpen: false }),

  setPaletteOpen: (open) => set({ isPaletteOpen: open }),
  togglePalette: () => set({ isPaletteOpen: !get().isPaletteOpen }),
  setNavSheetOpen: (open) => set({ isNavSheetOpen: open }),
  setSetupDrawerOpen: (open) => set({ isSetupDrawerOpen: open }),

  reset: () =>
    set({
      route: DEFAULT_ROUTE,
      workspaceSurface: WORKSPACE_SURFACES[0],
      legacyPage: null,
      isPaletteOpen: false,
      isNavSheetOpen: false,
      isSetupDrawerOpen: false,
    }),
}));
