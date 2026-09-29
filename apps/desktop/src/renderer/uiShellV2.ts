/*
 * Izzi AI V2 — M2 shell feature flag (izzi-ai-redesign-handoff-v1 spec/05, 06).
 *
 * The V2 shell is opt-in and OFF by default. It is read once per render from
 * localStorage so a developer can flip it from DevTools and reload:
 *
 *   localStorage.setItem('uiShellV2', '1'); location.reload();   // ON
 *   localStorage.removeItem('uiShellV2'); location.reload();     // OFF
 *
 * Theme for the V2 shell (dark is the default):
 *
 *   localStorage.setItem('uiShellV2Theme', 'light');
 *
 * The header theme switch writes the same key, so the choice survives reload.
 */

export const UI_SHELL_V2_KEY = 'uiShellV2';
export const UI_SHELL_V2_THEME_KEY = 'uiShellV2Theme';
export const UI_SHELL_V2_NAV_KEY = 'uiShellV2Navigator';

export type UiShellV2Theme = 'dark' | 'light';

type FlagStorage = Pick<Storage, 'getItem'>;

function defaultStorage(): FlagStorage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage;
}

function readItem(key: string, storage: FlagStorage | undefined): string | null {
  try {
    // Resolve the default inside try: the window.localStorage getter itself can throw.
    return (storage ?? defaultStorage())?.getItem(key) ?? null;
  } catch {
    // Storage can throw (disabled storage, sandboxed frame); fall back to OFF.
    return null;
  }
}

export function isUiShellV2Enabled(storage?: FlagStorage): boolean {
  return readItem(UI_SHELL_V2_KEY, storage) === '1';
}

export function getUiShellV2Theme(storage?: FlagStorage): UiShellV2Theme {
  return readItem(UI_SHELL_V2_THEME_KEY, storage) === 'light' ? 'light' : 'dark';
}

/** Persists the runtime theme switch; returns false when storage refuses the write. */
export function setUiShellV2Theme(theme: UiShellV2Theme, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    if (!target) return false;
    target.setItem(UI_SHELL_V2_THEME_KEY, theme);
    return true;
  } catch {
    return false;
  }
}

/** Navigator pinned state (the Home "Thu gọn" button); open unless explicitly collapsed. */
export function getUiShellV2NavigatorPinned(storage?: FlagStorage): boolean {
  return readItem(UI_SHELL_V2_NAV_KEY, storage) !== '0';
}

/** Persists the navigator collapse choice; returns false when storage refuses the write. */
export function setUiShellV2NavigatorPinned(pinned: boolean, storage?: Pick<Storage, 'setItem'>): boolean {
  try {
    const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
    if (!target) return false;
    target.setItem(UI_SHELL_V2_NAV_KEY, pinned ? '1' : '0');
    return true;
  } catch {
    return false;
  }
}
