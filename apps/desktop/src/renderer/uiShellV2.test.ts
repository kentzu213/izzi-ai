import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UI_SHELL_V2_KEY,
  UI_SHELL_V2_THEME_KEY,
  getUiShellV2Theme,
  isUiShellV2Enabled,
  setUiShellV2Theme,
} from './uiShellV2';

function storageWith(values: Record<string, string>): Pick<Storage, 'getItem'> {
  return { getItem: (key) => values[key] ?? null };
}

const throwingStorage: Pick<Storage, 'getItem'> = {
  getItem: () => {
    throw new Error('storage blocked');
  },
};

describe('uiShellV2 flag', () => {
  it('is ON by default', () => {
    expect(isUiShellV2Enabled(storageWith({}))).toBe(true);
    expect(isUiShellV2Enabled(undefined)).toBe(true);
  });

  it('is OFF only for the exact opt-out value 0', () => {
    expect(isUiShellV2Enabled(storageWith({ [UI_SHELL_V2_KEY]: '0' }))).toBe(false);
    expect(isUiShellV2Enabled(storageWith({ [UI_SHELL_V2_KEY]: '1' }))).toBe(true);
    expect(isUiShellV2Enabled(storageWith({ [UI_SHELL_V2_KEY]: 'false' }))).toBe(true);
  });

  it('stays ON when storage throws', () => {
    expect(isUiShellV2Enabled(throwingStorage)).toBe(true);
  });
});

describe('uiShellV2 theme', () => {
  it('defaults to dark', () => {
    expect(getUiShellV2Theme(storageWith({}))).toBe('dark');
    expect(getUiShellV2Theme(storageWith({ [UI_SHELL_V2_THEME_KEY]: 'blue' }))).toBe('dark');
    expect(getUiShellV2Theme(throwingStorage)).toBe('dark');
  });

  it('returns light only when explicitly set', () => {
    expect(getUiShellV2Theme(storageWith({ [UI_SHELL_V2_THEME_KEY]: 'light' }))).toBe('light');
  });

  it('persists the runtime switch under the same key the reader uses', () => {
    const values: Record<string, string> = {};
    const storage = { ...storageWith(values), setItem: (key: string, value: string) => void (values[key] = value) };

    expect(setUiShellV2Theme('light', storage)).toBe(true);
    expect(getUiShellV2Theme(storage)).toBe('light');
    expect(setUiShellV2Theme('dark', storage)).toBe(true);
    expect(getUiShellV2Theme(storage)).toBe('dark');
  });

  it('reports failure instead of throwing when storage refuses the write', () => {
    const blocked = {
      setItem: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      },
    };

    expect(setUiShellV2Theme('light', blocked)).toBe(false);
  });
});

describe('uiShellV2 default window.localStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to ON/dark when the localStorage getter itself throws', () => {
    const blockedWindow = {};
    Object.defineProperty(blockedWindow, 'localStorage', {
      get() {
        throw new DOMException('Access is denied', 'SecurityError');
      },
    });
    vi.stubGlobal('window', blockedWindow);

    expect(isUiShellV2Enabled()).toBe(true);
    expect(getUiShellV2Theme()).toBe('dark');
  });

  it('reads the flag and theme from a working window.localStorage', () => {
    vi.stubGlobal('window', {
      localStorage: storageWith({ [UI_SHELL_V2_KEY]: '0', [UI_SHELL_V2_THEME_KEY]: 'light' }),
    });

    expect(isUiShellV2Enabled()).toBe(false);
    expect(getUiShellV2Theme()).toBe('light');
  });
});
