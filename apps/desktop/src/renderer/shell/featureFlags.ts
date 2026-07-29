/**
 * Personal Office shell — feature flag + rollback path.
 *
 * The new shell mounts behind `izzi.shell.personalOffice` (lease condition
 * LEASE-L02-SHELL-MOUNT-20260729). Turning it off restores the legacy Sidebar
 * shell with no code change, which is the rollback story for Loop 02.
 *
 * Resolution order (first match wins), so a QA/Playwright run can pin the shell
 * without touching a user's stored preference:
 *   1. `window.__IZZI_SHELL__`  — injected by tests
 *   2. `?shell=v2|legacy`       — shareable URL
 *   3. localStorage             — the user's own choice
 *   4. default                  — 'v2'
 *
 * @module renderer/shell/featureFlags
 */

export type ShellChoice = 'v2' | 'legacy';

export const PERSONAL_OFFICE_FLAG_KEY = 'izzi.shell.personalOffice';
export const MARKETING_WORKSPACE_REFERENCE_FLAG_KEY = 'izzi.marketing.workspaceReference';

/** Forced surface state, for capturing the interaction-state matrix. */
export type ForcedSurfaceState = 'loading' | 'empty' | 'error' | 'offline' | 'degraded';

const FORCED_STATES: readonly ForcedSurfaceState[] = [
  'loading',
  'empty',
  'error',
  'offline',
  'degraded',
];

declare global {
  interface Window {
    __IZZI_SHELL__?: ShellChoice;
    __IZZI_SHELL_DEMO__?: boolean;
    __IZZI_SHELL_STATE__?: ForcedSurfaceState;
  }
}

function readQuery(param: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get(param);
  } catch {
    return null;
  }
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private mode / denied storage: fall through to the default.
    return null;
  }
}

/** Resolve which shell should render. */
export function resolveShellChoice(): ShellChoice {
  if (typeof window === 'undefined') return 'v2';

  if (window.__IZZI_SHELL__ === 'legacy' || window.__IZZI_SHELL__ === 'v2') {
    return window.__IZZI_SHELL__;
  }

  const query = readQuery('shell');
  if (query === 'legacy' || query === 'v2') return query;

  return readStored(PERSONAL_OFFICE_FLAG_KEY) === 'off' ? 'legacy' : 'v2';
}

export function isPersonalOfficeShellEnabled(): boolean {
  return resolveShellChoice() === 'v2';
}

/**
 * Persist the choice. The caller reloads: the shell is chosen once at mount, so
 * flipping it live would leave half-mounted legacy state behind.
 */
export function setPersonalOfficeShellEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(PERSONAL_OFFICE_FLAG_KEY, enabled ? 'on' : 'off');
  } catch {
    // Non-fatal: the flag simply stays at its default next launch.
  }
}

export function isMarketingWorkspaceReferenceEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const query = readQuery('marketing');
  if (query === 'legacy') return false;
  if (query === 'reference') return true;
  return readStored(MARKETING_WORKSPACE_REFERENCE_FLAG_KEY) !== 'off';
}

export function setMarketingWorkspaceReferenceEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(
      MARKETING_WORKSPACE_REFERENCE_FLAG_KEY,
      enabled ? 'on' : 'off',
    );
  } catch {
    // Presentation rollback remains best-effort when storage is denied.
  }
}

/**
 * Demo mode. OFF by default and always badged in the UI, so an empty install
 * shows an honest empty state instead of fabricated work.
 */
export function isShellDemoMode(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.__IZZI_SHELL_DEMO__ === true) return true;
  return readQuery('demo') === '1';
}

/** A pinned state for screenshot/regression capture. */
export function getForcedSurfaceState(): ForcedSurfaceState | null {
  if (typeof window === 'undefined') return null;

  const injected = window.__IZZI_SHELL_STATE__;
  if (injected && FORCED_STATES.includes(injected)) return injected;

  const query = readQuery('state');
  const match = FORCED_STATES.find((state) => state === query);
  return match ?? null;
}
