import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LOCAL_COCKPIT_BASE_URL,
  LOCAL_COCKPIT_MODEL,
  LOCAL_COCKPIT_REASONING_EFFORT,
} from '../../shared/local-cockpit';
import type { CustomProviderConfig } from './provider-settings-store';

interface CockpitKeyOptions {
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
