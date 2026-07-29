import { DatabaseManager } from '../db/database';
import {
  hasAsciiControlCharacter,
  type ModelEndpointClass,
  type ModelRouteFailureReasonCode,
} from '../../shared/model-gateway';
import { isOfficialIzziApiUrl } from './izzi-request-headers';

// codex-lb model suggestions (validated loosely; the endpoint decides what exists).
// Verified against codex-lb /v1/models — GPT-5.6 (Sol/Terra/Luna) are the new flagships.
export const ALLOWED_MODELS = [
  'izzi-smart',
  'grok-4.5-high',
  'gcli/grok-4.5-high',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
] as const;
export type AllowedModel = (typeof ALLOWED_MODELS)[number];

export type AuthType = 'bearer' | 'x-api-key';
export type ActiveProvider = 'managed' | 'custom';

/** Non-secret custom provider configuration (persisted as JSON). */
export interface CustomProviderConfig {
  baseUrl: string;
  authType: AuthType;
  /** Model id to request. Any non-empty string (endpoint validates). */
  selectedModel: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  reasonCode?: Extract<
    ModelRouteFailureReasonCode,
    'custom-config-missing' | 'custom-config-invalid'
  >;
  config?: CustomProviderConfig;
  endpoint?: OpenAICompatibleEndpoint;
}

export interface OpenAICompatibleEndpoint {
  /** Canonical input shape: origin plus root, .../v1, or .../v1/chat/completions. */
  baseUrl: string;
  chatCompletionsUrl: string;
  modelsUrl: string;
  origin: string;
  endpointClass: ModelEndpointClass;
}

const CONFIG_KEY = 'custom_provider_config';
const ENABLED_KEY = 'custom_provider_enabled';
const LEGACY_CODEX_LB_MIGRATION_KEY = 'custom_provider_legacy_2455_migrated_v1';

const AUTH_TYPES: readonly AuthType[] = ['bearer', 'x-api-key'];
const HTTP_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const LEGACY_LOCAL_HOSTS = new Set([...HTTP_LOOPBACK_HOSTS, 'host.docker.internal']);

function rawAuthorityHost(value: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(value);
  if (!match || match[1].includes('@')) return null;
  const authority = match[1];
  if (authority.startsWith('[')) {
    const closingBracket = authority.indexOf(']');
    if (closingBracket < 0) return null;
    return authority.slice(0, closingBracket + 1).toLowerCase();
  }
  return authority.split(':', 1)[0].toLowerCase();
}

/** Only exact textual loopback hosts may use plain HTTP. */
function isLoopbackHost(value: string): boolean {
  const rawHost = rawAuthorityHost(value);
  return rawHost !== null && HTTP_LOOPBACK_HOSTS.has(rawHost);
}

function normalizeEndpointPath(pathname: string): {
  basePath: string;
  chatPath: string;
  modelsPath: string;
} | null {
  if (/%/i.test(pathname) || pathname.includes('//')) return null;
  const normalized = pathname === '/' ? '' : pathname.replace(/\/$/, '');
  if (normalized === '') {
    return {
      basePath: '',
      chatPath: '/v1/chat/completions',
      modelsPath: '/v1/models',
    };
  }

  if (!/^\/(?:[A-Za-z0-9._~-]+\/)*v1(?:\/chat\/completions)?$/.test(normalized)) {
    return null;
  }

  const apiBase = normalized.endsWith('/chat/completions')
    ? normalized.slice(0, -'/chat/completions'.length)
    : normalized;
  return {
    basePath: normalized,
    chatPath: `${apiBase}/chat/completions`,
    modelsPath: `${apiBase}/models`,
  };
}

/**
 * Parse one deterministic OpenAI-compatible endpoint shape.
 * Rejects userinfo, query, fragment, encoded separators, backslashes, dot
 * segments, non-HTTPS remote origins, and non-exact textual loopback aliases.
 */
export function parseOpenAICompatibleEndpoint(
  value: string,
): OpenAICompatibleEndpoint | null {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || hasAsciiControlCharacter(value)
    || value.includes('\\')
    || /\/\.{1,2}(?:\/|$)/.test(value)
  ) {
    return null;
  }

  try {
    const url = new URL(value);
    if (
      url.username
      || url.password
      || url.search
      || url.hash
      || (url.protocol !== 'https:' && url.protocol !== 'http:')
    ) {
      return null;
    }

    if (url.protocol === 'http:' && !isLoopbackHost(value)) {
      return null;
    }

    const paths = normalizeEndpointPath(url.pathname);
    if (!paths) return null;

    const chatCompletionsUrl = `${url.origin}${paths.chatPath}`;
    const endpointClass: ModelEndpointClass = isOfficialIzziApiUrl(chatCompletionsUrl)
      ? 'official-izzi-https'
      : url.protocol === 'https:'
        ? 'custom-https'
        : 'loopback-http';

    return Object.freeze({
      baseUrl: `${url.origin}${paths.basePath}`,
      chatCompletionsUrl,
      modelsUrl: `${url.origin}${paths.modelsPath}`,
      origin: url.origin,
      endpointClass,
    });
  } catch {
    return null;
  }
}

/** Exact legacy desktop preset: plain HTTP, loopback, and Codex-LB port 2455. */
export function isLegacyLocalCodexLbBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    const rawHost = rawAuthorityHost(baseUrl);
    return Boolean(
      url.protocol === 'http:'
      && url.port === '2455'
      && rawHost
      && LEGACY_LOCAL_HOSTS.has(rawHost),
    );
  } catch {
    return false;
  }
}

/**
 * Validate a candidate custom-provider config in the MAIN process (R5.5).
 * Returns the list of concise error reasons (Vietnamese) when invalid.
 */
export function validateCustomConfig(config: Partial<CustomProviderConfig> | null | undefined): ValidationResult {
  const errors: string[] = [];

  if (!config) {
    return {
      ok: false,
      errors: ['Thiếu cấu hình custom provider'],
      reasonCode: 'custom-config-missing',
    };
  }

  let endpoint: OpenAICompatibleEndpoint | null = null;
  if (!config.baseUrl || typeof config.baseUrl !== 'string') {
    errors.push('Base URL không được để trống');
  } else {
    endpoint = parseOpenAICompatibleEndpoint(config.baseUrl);
    if (!endpoint) errors.push('Base URL không hợp lệ hoặc có endpoint shape không được hỗ trợ');
  }

  // authType ∈ {bearer, x-api-key} (R5.4)
  if (!config.authType || !AUTH_TYPES.includes(config.authType)) {
    errors.push('Kiểu auth không hợp lệ (chỉ Bearer hoặc x-api-key)');
  }

  // selectedModel: any non-empty string (the endpoint decides which models exist).
  const selectedModel =
    typeof config.selectedModel === 'string' ? config.selectedModel.trim() : '';
  if (
    !selectedModel
    || selectedModel.length > 200
    || hasAsciiControlCharacter(selectedModel)
  ) {
    errors.push('Model không được để trống');
  }

  if (
    errors.length > 0
    || !endpoint
    || !config.authType
    || !AUTH_TYPES.includes(config.authType)
  ) {
    return { ok: false, errors, reasonCode: 'custom-config-invalid' };
  }

  return {
    ok: true,
    errors,
    config: Object.freeze({
      baseUrl: endpoint.baseUrl,
      authType: config.authType,
      selectedModel,
    }),
    endpoint,
  };
}

/**
 * ProviderSettingsStore — non-secret config + enabled flag, backed by the
 * SQLite settings table via DatabaseManager. Does NOT touch the API key.
 */
export class ProviderSettingsStore {
  private db: DatabaseManager;

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  private readStoredConfig(): Partial<CustomProviderConfig> | null {
    const raw = this.db.getSetting(CONFIG_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      return parsed as Partial<CustomProviderConfig>;
    } catch {
      return null;
    }
  }

  /**
   * Validate stored bytes without returning them. Typed route resolution uses
   * this method so malformed storage is not misclassified as merely missing.
   */
  getConfigValidation(): ValidationResult {
    const raw = this.db.getSetting(CONFIG_KEY);
    if (!raw) return validateCustomConfig(null);

    const config = this.readStoredConfig();
    if (!config) {
      return {
        ok: false,
        errors: ['Cấu hình custom provider đã lưu không hợp lệ'],
        reasonCode: 'custom-config-invalid',
      };
    }
    return validateCustomConfig(config);
  }

  /**
   * Returns only normalized, validated config. Invalid persisted bytes never
   * cross IPC or reach a provider/host caller.
   */
  getConfig(): CustomProviderConfig | null {
    return this.getConfigValidation().config ?? null;
  }

  /** Persist non-secret config (validation is the caller's responsibility). */
  saveConfig(config: CustomProviderConfig): void {
    this.db.setSetting(
      CONFIG_KEY,
      JSON.stringify({
        baseUrl: config.baseUrl,
        authType: config.authType,
        selectedModel: config.selectedModel,
      }),
    );
  }

  clearConfig(): void {
    this.db.deleteSetting(CONFIG_KEY);
  }

  isCustomEnabled(): boolean {
    return this.db.getSetting(ENABLED_KEY) === '1';
  }

  setEnabled(enabled: boolean): void {
    this.db.setSetting(ENABLED_KEY, enabled ? '1' : '0');
  }

  /**
   * One-time v1.12 migration for the retired automatic local Codex-LB route.
   *
   * Only an enabled loopback :2455 config is disabled. The config and encrypted
   * key are deliberately preserved so this migration is reversible, and the
   * marker ensures a later explicit user choice to re-enable local Codex-LB is
   * respected. No secret is read or returned by this method.
   */
  migrateLegacyLocalCodexLbConnection(): {
    migrated: boolean;
    reason: 'legacy-local-2455' | 'not-applicable' | 'already-completed';
  } {
    if (this.db.getSetting(LEGACY_CODEX_LB_MIGRATION_KEY) === '1') {
      return { migrated: false, reason: 'already-completed' };
    }

    const config = this.readStoredConfig();
    const shouldMigrate = Boolean(
      this.isCustomEnabled()
      && config
      && typeof config.baseUrl === 'string'
      && isLegacyLocalCodexLbBaseUrl(config.baseUrl),
    );
    if (shouldMigrate) {
      this.setEnabled(false);
    }
    this.db.setSetting(LEGACY_CODEX_LB_MIGRATION_KEY, '1');

    return shouldMigrate
      ? { migrated: true, reason: 'legacy-local-2455' }
      : { migrated: false, reason: 'not-applicable' };
  }
}
