/**
 * Background mode keeps the app alive in the system tray so the marketing schedule
 * keeps running on the customer's machine after the window is closed.
 */
export const START_HIDDEN_ARG = '--hidden';
export const OPEN_AT_LOGIN_SETTING_KEY = 'background.openAtLogin';

interface OpenAtLoginSettingsStore {
  getSetting(key: string): string | null;
  setSettingIfAbsent(key: string, value: string): boolean;
}

/** Launched by the OS login item: start in the tray without showing a window. */
export function shouldStartHidden(argv: readonly string[], wasOpenedAtLogin = false): boolean {
  return wasOpenedAtLogin || argv.includes(START_HIDDEN_ARG);
}

/** Start with the computer by default; the customer can turn it off from the tray menu. */
export function readOpenAtLogin(db: OpenAtLoginSettingsStore): boolean {
  db.setSettingIfAbsent(OPEN_AT_LOGIN_SETTING_KEY, '1');
  return db.getSetting(OPEN_AT_LOGIN_SETTING_KEY) !== '0';
}

export function buildLoginItemSettings(
  openAtLogin: boolean,
  platform: NodeJS.Platform,
): { openAtLogin: boolean; args?: string[]; openAsHidden?: boolean } {
  return platform === 'darwin'
    ? { openAtLogin, openAsHidden: true }
    : { openAtLogin, args: [START_HIDDEN_ARG] };
}
