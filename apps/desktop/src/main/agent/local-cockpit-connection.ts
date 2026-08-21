import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LOCAL_COCKPIT_BASE_URL,
  LOCAL_COCKPIT_MODEL,
  LOCAL_COCKPIT_REASONING_EFFORT,
  isLocalCockpitBaseUrl,
} from '../../shared/local-cockpit';
import type { CustomProviderConfig } from './provider-settings-store';

export interface CockpitKeyOptions {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface CockpitKeyResolution {
  key: string;
  source: 'cockpit-state' | 'environment';
}

export function buildLocalCockpitConfig(): CustomProviderConfig {
  return {
    baseUrl: LOCAL_COCKPIT_BASE_URL,
    authType: 'bearer',
    selectedModel: LOCAL_COCKPIT_MODEL,
    reasoningEffort: LOCAL_COCKPIT_REASONING_EFFORT,
  };
}

export function resolveLocalCockpitKey(options: CockpitKeyOptions = {}): CockpitKeyResolution | null {
  const homeDir = options.homeDir ?? os.homedir();
  const statePath = path.join(homeDir, '.codex', 'cockpit-tools-data', 'codex_local_access.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as { apiKey?: unknown };
    const key = typeof parsed.apiKey === 'string' ? parsed.apiKey.trim() : '';
    if (key) return { key, source: 'cockpit-state' };
  } catch {
    // Cockpit may not be installed yet; environment fallback remains available.
  }

  const env = options.env ?? process.env;
  const key = [env.COCKPIT_API_KEY, env.CODEX_LB_API_KEY, env.CODEX_LB_KEY, env.OPENAI_API_KEY]
    .find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0)
    ?.trim();
  return key ? { key, source: 'environment' } : null;
}

export type CockpitHealStatus =
  | 'not-local'
  | 'unchanged'
  | 'rotated'
  | 'rotation-rejected'
  | 'no-canonical-key';

export interface CockpitHealResult {
  status: CockpitHealStatus;
  /** The key the caller should use for this turn — never logged, never sent to the renderer. */
  key: string | null;
  source?: CockpitKeyResolution['source'];
}

export interface HealLocalCockpitKeyOptions {
  config: Pick<CustomProviderConfig, 'baseUrl'>;
  /** The key currently stored in the SecretStore (may be stale after a rotation/restart). */
  currentKey: string | null;
  /** Bounded, authenticated probe against the loopback gateway with the candidate key. */
  probe: (candidateKey: string) => Promise<{ ok: boolean }>;
  /** Persists the healed key. Only called after the candidate probes successfully. */
  persist: (candidateKey: string, source: CockpitKeyResolution['source']) => void;
  resolveKey?: (options?: CockpitKeyOptions) => CockpitKeyResolution | null;
  keyOptions?: CockpitKeyOptions;
}

/**
 * Self-heals a rotated local Cockpit key from the canonical
 * `codex_local_access.json` before traffic. Bounded to exactly one authenticated
 * probe: an unchanged key never probes, and a candidate that fails the probe is
 * rejected without overwriting what is already stored (fail-closed, non-destructive).
 * Never logs or returns the secret to anything but the caller in main.
 */
export async function healLocalCockpitKey(
  options: HealLocalCockpitKeyOptions,
): Promise<CockpitHealResult> {
  const stored = typeof options.currentKey === 'string' ? options.currentKey.trim() : '';
  if (!isLocalCockpitBaseUrl(options.config?.baseUrl)) {
    return { status: 'not-local', key: stored || null };
  }

  const resolve = options.resolveKey ?? resolveLocalCockpitKey;
  const canonical = resolve(options.keyOptions);
  if (!canonical?.key) return { status: 'no-canonical-key', key: stored || null };
  if (canonical.key === stored) return { status: 'unchanged', key: stored, source: canonical.source };

  let probeOk = false;
  try {
    probeOk = (await options.probe(canonical.key)).ok === true;
  } catch {
    probeOk = false;
  }
  if (!probeOk) return { status: 'rotation-rejected', key: stored || null, source: canonical.source };

  options.persist(canonical.key, canonical.source);
  return { status: 'rotated', key: canonical.key, source: canonical.source };
}
