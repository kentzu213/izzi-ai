import { describe, expect, it } from 'vitest';
import {
  OPEN_AT_LOGIN_SETTING_KEY,
  START_HIDDEN_ARG,
  buildLoginItemSettings,
  readOpenAtLogin,
  shouldStartHidden,
} from './background-mode';

function settingsStore(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getSetting: (key: string) => values.get(key) ?? null,
    setSettingIfAbsent: (key: string, value: string) => {
      if (values.has(key)) return false;
      values.set(key, value);
      return true;
    },
  };
}

describe('background mode', () => {
  it('starts hidden only when launched by the login item', () => {
    expect(shouldStartHidden(['Izzi AI.exe', START_HIDDEN_ARG])).toBe(true);
    expect(shouldStartHidden(['Izzi AI.exe'], true)).toBe(true);
    expect(shouldStartHidden(['Izzi AI.exe', 'openclaw://auth'])).toBe(false);
  });

  it('turns start-with-computer on by default on first run', () => {
    const db = settingsStore();

    expect(readOpenAtLogin(db)).toBe(true);
    expect(db.values.get(OPEN_AT_LOGIN_SETTING_KEY)).toBe('1');
  });

  it('keeps the customer choice once they turned it off', () => {
    const db = settingsStore({ [OPEN_AT_LOGIN_SETTING_KEY]: '0' });

    expect(readOpenAtLogin(db)).toBe(false);
    expect(db.values.get(OPEN_AT_LOGIN_SETTING_KEY)).toBe('0');
  });

  it('passes the hidden flag on Windows and hides the app on macOS', () => {
    expect(buildLoginItemSettings(true, 'win32')).toEqual({ openAtLogin: true, args: [START_HIDDEN_ARG] });
    expect(buildLoginItemSettings(false, 'win32')).toEqual({ openAtLogin: false, args: [START_HIDDEN_ARG] });
    expect(buildLoginItemSettings(true, 'darwin')).toEqual({ openAtLogin: true, openAsHidden: true });
  });
});
