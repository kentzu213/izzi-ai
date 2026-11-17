import { createContext, useContext } from 'react';

/**
 * Whether the surrounding tab panel is on screen. Tab frames that keep hidden panels mounted (Agent
 * Marketing V2) provide it so pollers inside can pause; anywhere else a mounted panel is visible.
 */
export const PanelVisibleContext = createContext(true);

export function usePanelVisible(): boolean {
  return useContext(PanelVisibleContext);
}
