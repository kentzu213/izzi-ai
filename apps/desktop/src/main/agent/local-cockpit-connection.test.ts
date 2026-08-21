import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLocalCockpitConfig, healLocalCockpitKey, resolveLocalCockpitKey } from './local-cockpit-connection';

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

describe('local Cockpit key self-heal', () => {
  const localConfig = { baseUrl: 'http://127.0.0.1:51226/v1' };

  it('adopts a rotated canonical key after one successful authenticated probe', async () => {
    const probe = vi.fn(async () => ({ ok: true }));
    const persist = vi.fn();

    const result = await healLocalCockpitKey({
      config: localConfig,
      currentKey: 'stale-key',
      probe,
      persist,
      resolveKey: () => ({ key: 'rotated-key', source: 'cockpit-state' }),
    });

    expect(result).toEqual({ status: 'rotated', key: 'rotated-key', source: 'cockpit-state' });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith('rotated-key');
    expect(persist).toHaveBeenCalledWith('rotated-key', 'cockpit-state');
  });

  it('keeps the stored key and never probes when the canonical key is unchanged', async () => {
    const probe = vi.fn(async () => ({ ok: true }));
    const persist = vi.fn();

    const result = await healLocalCockpitKey({
      config: localConfig,
      currentKey: 'same-key',
      probe,
      persist,
      resolveKey: () => ({ key: 'same-key', source: 'cockpit-state' }),
    });

    expect(result.status).toBe('unchanged');
    expect(result.key).toBe('same-key');
    expect(probe).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('rejects a candidate that fails the probe without overwriting the stored key', async () => {
    const probe = vi.fn(async () => ({ ok: false }));
    const persist = vi.fn();

    const result = await healLocalCockpitKey({
      config: localConfig,
      currentKey: 'stored-key',
      probe,
      persist,
      resolveKey: () => ({ key: 'bad-key', source: 'environment' }),
    });

    expect(result.status).toBe('rotation-rejected');
    expect(result.key).toBe('stored-key');
    expect(probe).toHaveBeenCalledTimes(1);
    expect(persist).not.toHaveBeenCalled();
  });

  it('treats a throwing probe as a rejected rotation', async () => {
    const persist = vi.fn();

    const result = await healLocalCockpitKey({
      config: localConfig,
      currentKey: 'stored-key',
      probe: async () => {
        throw new Error('ECONNREFUSED');
      },
      persist,
      resolveKey: () => ({ key: 'rotated-key', source: 'cockpit-state' }),
    });

    expect(result.status).toBe('rotation-rejected');
    expect(result.key).toBe('stored-key');
    expect(persist).not.toHaveBeenCalled();
  });

  it('never touches non-loopback endpoints or probes without a canonical key', async () => {
    const probe = vi.fn(async () => ({ ok: true }));
    const persist = vi.fn();

    const remote = await healLocalCockpitKey({
      config: { baseUrl: 'https://api.example.com/v1' },
      currentKey: 'remote-key',
      probe,
      persist,
      resolveKey: () => ({ key: 'rotated-key', source: 'cockpit-state' }),
    });
    expect(remote).toEqual({ status: 'not-local', key: 'remote-key' });

    const missing = await healLocalCockpitKey({
      config: localConfig,
      currentKey: 'stored-key',
      probe,
      persist,
      resolveKey: () => null,
    });
    expect(missing).toEqual({ status: 'no-canonical-key', key: 'stored-key' });

    expect(probe).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});
