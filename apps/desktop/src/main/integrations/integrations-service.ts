import axios from 'axios';
import { shell } from 'electron';
import { AuthManager } from '../auth/auth-manager';
import { DatabaseManager } from '../db/database';
import type { IntegrationConnection, IntegrationProvider } from '../agent/types';

const API_BASE_URL =
  process.env.OPENCLAW_API_URL ||
  'https://api.izziapi.com';

const DEFAULT_INTEGRATIONS_URL = `${API_BASE_URL}/api/integrations`;
const MOCK_INTEGRATIONS_KEY = 'mock_integrations_state';

function normalizeProvider(provider: unknown): IntegrationProvider | null {
  const value = String(provider ?? '').toLowerCase();
  if (value === 'telegram' || value === 'discord' || value === 'zalo') {
    return value;
  }
  return null;
}

function normalizeStatus(status: unknown): IntegrationConnection['status'] {
  const value = String(status ?? '').toLowerCase();
  if (value === 'connected' || value === 'disconnected' || value === 'pending' || value === 'error') {
    return value;
  }
  return 'disconnected';
}

function normalizeList(payload: unknown): IntegrationConnection[] {
  const rawList = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as { integrations?: unknown[] }).integrations)
      ? (payload as { integrations: unknown[] }).integrations
      : [];

  const seen = new Set<IntegrationProvider>();
  const normalized: IntegrationConnection[] = [];

  rawList.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;

    const data = entry as Record<string, unknown>;
    const provider = normalizeProvider(data.provider);
    if (!provider) return;

    seen.add(provider);
    normalized.push({
      provider,
      status: normalizeStatus(data.status),
      accountLabel: typeof data.accountLabel === 'string'
        ? data.accountLabel
        : typeof data.account_label === 'string'
          ? data.account_label
          : undefined,
      connectedAt: typeof data.connectedAt === 'string'
        ? data.connectedAt
        : typeof data.connected_at === 'string'
          ? data.connected_at
          : undefined,
      lastError: typeof data.lastError === 'string'
        ? data.lastError
        : typeof data.error === 'string'
          ? data.error
          : undefined,
    });
  });

  for (const provider of ['telegram', 'discord', 'zalo'] satisfies IntegrationProvider[]) {
    if (!seen.has(provider)) {
      normalized.push({ provider, status: 'disconnected' });
    }
  }

  return normalized.sort((left, right) => left.provider.localeCompare(right.provider));
}

function resolveConnectUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const data = payload as Record<string, unknown>;
  if (typeof data.url === 'string') return data.url;
  if (typeof data.connectUrl === 'string') return data.connectUrl;
  if (typeof data.connect_url === 'string') return data.connect_url;
  return null;
}

function isMockEnabled(): boolean {
  return process.env.OPENCLAW_MOCK_INTEGRATIONS === '1' || process.env.OPENCLAW_MOCK_INTEGRATIONS === 'true';
}

function defaultConnections(): IntegrationConnection[] {
  return (['telegram', 'discord', 'zalo'] satisfies IntegrationProvider[]).map((provider) => ({
    provider,
    status: 'disconnected',
  }));
}

export class IntegrationsService {
  private auth: AuthManager;
  private db: DatabaseManager;
  private baseUrl: string;
  private mockMode: boolean;

  constructor(auth: AuthManager, db: DatabaseManager, baseUrl = DEFAULT_INTEGRATIONS_URL) {
    this.auth = auth;
    this.db = db;
    this.baseUrl = baseUrl;
    this.mockMode = isMockEnabled();
  }

  private async getAuthHeaders() {
    const accessToken = await this.auth.getAccessToken();
    if (!accessToken) {
      throw new Error('Missing IzziAPI access token');
    }

    return {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    };
  }

  async list(): Promise<IntegrationConnection[]> {
    if (this.mockMode) {
      return this.readMockConnections();
    }

    const response = await axios.get(this.baseUrl, {
      headers: await this.getAuthHeaders(),
      validateStatus: () => true,
      timeout: 15000,
    });

    if (response.status === 404) {
      // The integrations API is not deployed on this host (404 even without a token).
      // Report "no connections" instead of rejecting the IPC call on every route open.
      return [];
    }
    if (response.status >= 400) {
      throw new Error(`Integrations endpoint returned HTTP ${response.status}`);
    }

    return normalizeList(response.data);
  }

  async beginConnect(provider: IntegrationProvider): Promise<{ provider: IntegrationProvider; url: string }> {
    if (this.mockMode) {
      const url = `https://izziapi.com/integrations/${provider}`;
      const next = this.readMockConnections().map((integration) =>
        integration.provider === provider
          ? {
              ...integration,
              status: 'connected' as const,
              accountLabel: `${provider} workspace`,
              connectedAt: new Date().toISOString(),
              lastError: undefined,
            }
          : integration,
      );
      this.writeMockConnections(next);
      await shell.openExternal(url);
      return { provider, url };
    }

    const response = await axios.get(`${this.baseUrl}/${provider}/connect-url`, {
      headers: await this.getAuthHeaders(),
      validateStatus: () => true,
      timeout: 15000,
    });

    if (response.status >= 400) {
      throw new Error(`Connect URL endpoint returned HTTP ${response.status}`);
    }

    const url = resolveConnectUrl(response.data);
    if (!url) {
      throw new Error(`Connect URL missing for ${provider}`);
    }

    await shell.openExternal(url);
    return { provider, url };
  }

  async disconnect(provider: IntegrationProvider): Promise<IntegrationConnection[]> {
    if (this.mockMode) {
      const next = this.readMockConnections().map((integration) =>
        integration.provider === provider
          ? {
              provider,
              status: 'disconnected' as const,
            }
          : integration,
      );
      this.writeMockConnections(next);
      return next;
    }

    const response = await axios.post(
      `${this.baseUrl}/${provider}/disconnect`,
      {},
      {
        headers: {
          ...(await this.getAuthHeaders()),
          'Content-Type': 'application/json',
        },
        validateStatus: () => true,
        timeout: 15000,
      },
    );

    if (response.status >= 400) {
      throw new Error(`Disconnect endpoint returned HTTP ${response.status}`);
    }

    return this.list();
  }

  private readMockConnections(): IntegrationConnection[] {
    const raw = this.db.getSetting(MOCK_INTEGRATIONS_KEY);
    if (!raw) {
      return defaultConnections();
    }

    try {
      return normalizeList(JSON.parse(raw));
    } catch {
      return defaultConnections();
    }
  }

  private writeMockConnections(connections: IntegrationConnection[]): void {
    this.db.setSetting(MOCK_INTEGRATIONS_KEY, JSON.stringify(connections));
  }
}
