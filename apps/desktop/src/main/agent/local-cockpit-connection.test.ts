import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildLocalCockpitConfig, resolveLocalCockpitKey } from './local-cockpit-connection';

const tempDirs: string[] = [];

function tempHome(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'izzi-cockpit-key-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('local Cockpit connection', () => {
  it('uses the live Cockpit state key before stale environment projections', () => {
    const homeDir = tempHome();
    const stateDir = path.join(homeDir, '.codex', 'cockpit-tools-data');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, 'codex_local_access.json'),
      JSON.stringify({ apiKey: 'state-key' }),
    );

    expect(resolveLocalCockpitKey({ homeDir, env: { CODEX_LB_API_KEY: 'stale-key' } })).toEqual({
      key: 'state-key',
      source: 'cockpit-state',
    });
  });

  it('falls back to an environment key when Cockpit state is unavailable', () => {
    expect(resolveLocalCockpitKey({
      homeDir: tempHome(),
      env: { COCKPIT_API_KEY: 'env-key' },
    })).toEqual({ key: 'env-key', source: 'environment' });
  });

  it('builds the exact Sol high loopback config', () => {
    expect(buildLocalCockpitConfig()).toEqual({
      baseUrl: 'http://127.0.0.1:51226/v1',
      authType: 'bearer',
      selectedModel: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    });
  });
});
