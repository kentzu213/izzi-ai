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
import type { LegacyPageId } from '../shell/legacySurfaces';
import {
  DEFAULT_ROUTE,
  FIRST_WORKSPACE_SURFACE,
  type ShellView,
  type WorkspaceSurface,
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
  /** Where the operator is. Includes the two non-nav destinations. */
  view: ShellView;
  workspaceId: WorkspaceInstanceId | null;
  workspaceSurface: WorkspaceSurface;
  /** Legacy page currently hosted by the adapter route, if any. */
  legacyPage: LegacyPageId | null;
  isPaletteOpen: boolean;
  isNavSheetOpen: boolean;
  isSetupDrawerOpen: boolean;

  navigate: (view: ShellView) => void;
  openWorkspace: (id: WorkspaceInstanceId, surface?: WorkspaceSurface) => void;
  setWorkspaceSurface: (surface: WorkspaceSurface) => void;
  openLegacy: (page: LegacyPageId) => void;
  setPaletteOpen: (open: boolean) => void;
  togglePalette: () => void;
  setNavSheetOpen: (open: boolean) => void;
  setSetupDrawerOpen: (open: boolean) => void;
  reset: () => void;
}

export const usePersonalOfficeStore = create<PersonalOfficeState>((set, get) => ({
  view: DEFAULT_ROUTE,
  workspaceId: readLastWorkspace(),
  workspaceSurface: FIRST_WORKSPACE_SURFACE,
  legacyPage: null,
  isPaletteOpen: false,
  isNavSheetOpen: false,
  isSetupDrawerOpen: false,

  navigate: (view) =>
    set({
      view,
      // Overlays never survive a route change; the drawer belongs to a workspace.
      isNavSheetOpen: false,
      isPaletteOpen: false,
      isSetupDrawerOpen: view === 'workspace' ? get().isSetupDrawerOpen : false,
      legacyPage: view === 'legacy' ? get().legacyPage : null,
    }),

  openWorkspace: (id, surface) => {
    persistLastWorkspace(id);
    set({
      view: 'workspace',
      workspaceId: id,
      workspaceSurface: surface ?? FIRST_WORKSPACE_SURFACE,
      isNavSheetOpen: false,
      isPaletteOpen: false,
    });
  },

  setWorkspaceSurface: (surface) => set({ workspaceSurface: surface }),

  openLegacy: (page) =>
    set({ view: 'legacy', legacyPage: page, isNavSheetOpen: false, isPaletteOpen: false }),

  setPaletteOpen: (open) => set({ isPaletteOpen: open }),
  togglePalette: () => set({ isPaletteOpen: !get().isPaletteOpen }),
  setNavSheetOpen: (open) => set({ isNavSheetOpen: open }),
  setSetupDrawerOpen: (open) => set({ isSetupDrawerOpen: open }),

  reset: () =>
    set({
      view: DEFAULT_ROUTE,
      workspaceSurface: FIRST_WORKSPACE_SURFACE,
      legacyPage: null,
      isPaletteOpen: false,
      isNavSheetOpen: false,
      isSetupDrawerOpen: false,
    }),
}));
