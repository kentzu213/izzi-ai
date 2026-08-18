import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronState = vi.hoisted(() => ({ userDataPath: '' }));

vi.mock('electron', () => ({
  app: { getPath: () => electronState.userDataPath },
}));

import { DatabaseManager } from './database';

describe('DatabaseManager atomic settings insert', () => {
  const managers: DatabaseManager[] = [];

  beforeEach(() => {
    electronState.userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'izzi-db-atomic-'));
  });

  afterEach(() => {
    for (const manager of managers.splice(0)) manager.close();
    fs.rmSync(electronState.userDataPath, { recursive: true, force: true });
  });

  it('allows exactly one insert across independent SQLite connections', () => {
    const first = new DatabaseManager();
    const second = new DatabaseManager();
    managers.push(first, second);
    first.initialize();
    second.initialize();

    expect(first.setSettingIfAbsent('canary-attempt', 'first-reservation')).toBe(true);
    expect(second.setSettingIfAbsent('canary-attempt', 'second-reservation')).toBe(false);
    expect(first.getSetting('canary-attempt')).toBe('first-reservation');
    expect(second.getSetting('canary-attempt')).toBe('first-reservation');
  });
});
