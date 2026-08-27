/**
 * Native Marketing provider-route parser and client tests (NM-015).
 * Every request is offline through an injected fetch implementation.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  NATIVE_MARKETING_PROVIDER_ALLOWED_OPERATIONS,
  NATIVE_MARKETING_PROVIDER_DENIED_OPERATIONS,
  NATIVE_MARKETING_PROVIDER_PLATFORMS,
  NATIVE_MARKETING_PROVIDER_ROUTE_IDS,
  NATIVE_MARKETING_PROVIDER_ROUTE_RESOURCES,
  NativeMarketingClient,
  parseNativeMarketingProviderRoutes,
  type NativeMarketingTokenProvider,
} from './native-marketing-client';

const ORIGIN = 'https://api.izziapi.com';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const FOREIGN_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const TOKEN = 'test-supabase-access-token';
const CHECKED_AT = '2026-08-28T10:00:00.000Z';

function tokenProvider(token: string | null = TOKEN): NativeMarketingTokenProvider {
  return { getAccessToken: async () => token };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function routeDefinitions() {
  return NATIVE_MARKETING_PROVIDER_ROUTE_RESOURCES.map((resource, index) => ({
    id: NATIVE_MARKETING_PROVIDER_ROUTE_IDS[index],
    resource,
    operations: [...NATIVE_MARKETING_PROVIDER_ALLOWED_OPERATIONS],
  }));
}

function emptyCounts() {
  return {
    total: 0,
    ready: 0,
    expired: 0,
    needsReauth: 0,
    revoked: 0,
    invalid: 0,
  };
}

function providerRows() {
  return NATIVE_MARKETING_PROVIDER_PLATFORMS.map((platform) => ({
    platform,
    adapter: platform === 'facebook' || platform === 'youtube'
      ? 'implemented'
      : 'not_implemented',
    connection: {
      state: platform === 'youtube' ? 'ready' : 'disconnected',
      counts: platform === 'youtube'
        ? { ...emptyCounts(), total: 1, ready: 1 }
        : emptyCounts(),
    },
    routeIds: [...NATIVE_MARKETING_PROVIDER_ROUTE_IDS],
    workflowReady: true,
    liveReady: false,
    accessToken: 'must-not-cross-ipc',
    providerPayload: { secret: 'must-not-cross-ipc' },
    localPath: 'F:\\private\\provider.json',
  }));
}

function routesEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    contractVersion: 'marketing-provider-routes.v1',
    workspaceId: WORKSPACE_ID,
    checkedAt: CHECKED_AT,
    authority: 'backend_oauth',
    policy: {
      allowedOperations: [...NATIVE_MARKETING_PROVIDER_ALLOWED_OPERATIONS],
      deniedOperations: [...NATIVE_MARKETING_PROVIDER_DENIED_OPERATIONS],
      externalExecution: 'blocked',
    },
    routes: routeDefinitions(),
    providers: providerRows(),
    externalActionPerformed: false,
    rawProviderToken: 'must-not-cross-ipc',
    ...overrides,
  };
}

describe('parseNativeMarketingProviderRoutes', () => {
  it('allowlists one complete internal-only route snapshot', () => {
    const parsed = parseNativeMarketingProviderRoutes(routesEnvelope(), WORKSPACE_ID);
    expect(parsed).toEqual({
      contractVersion: 'marketing-provider-routes.v1',
      workspaceId: WORKSPACE_ID,
      checkedAt: CHECKED_AT,
      authority: 'backend_oauth',
      policy: {
        allowedOperations: ['read', 'draft', 'validate'],
        deniedOperations: [
          'publish', 'schedule', 'send', 'bulk', 'spend', 'integration.write', 'contacts.write',
        ],
        externalExecution: 'blocked',
      },
      routes: routeDefinitions(),
      providers: providerRows().map(({ accessToken, providerPayload, localPath, ...provider }) => provider),
      externalActionPerformed: false,
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('must-not-cross-ipc');
    expect(serialized).not.toContain('rawProviderToken');
    expect(serialized).not.toContain('providerPayload');
    expect(serialized).not.toContain('localPath');
  });

  it('rejects tenant, authority, version, and external-execution contradictions', () => {
    for (const overrides of [
      { success: false },
      { workspaceId: FOREIGN_WORKSPACE_ID },
      { contractVersion: 'marketing-provider-routes.v2' },
      { authority: 'renderer_vault' },
      { externalActionPerformed: true },
      { policy: { ...routesEnvelope().policy as object, externalExecution: 'allowed' } },
    ]) {
      expect(parseNativeMarketingProviderRoutes(
        routesEnvelope(overrides),
        WORKSPACE_ID,
      )).toBeNull();
    }
  });

  it('rejects widened operations and malformed route definitions', () => {
    const basePolicy = routesEnvelope().policy as Record<string, unknown>;
    for (const overrides of [
      { policy: { ...basePolicy, allowedOperations: ['read', 'draft', 'validate', 'publish'] } },
      { policy: { ...basePolicy, deniedOperations: ['publish'] } },
      { routes: routeDefinitions().slice(0, 3) },
      { routes: routeDefinitions().map((route, index) => index === 0
        ? { ...route, operations: ['read', 'publish'] }
        : route) },
    ]) {
      expect(parseNativeMarketingProviderRoutes(
        routesEnvelope(overrides),
        WORKSPACE_ID,
      )).toBeNull();
    }
  });

  it('rejects duplicate, reordered, or contradictory provider summaries', () => {
    const providers = providerRows();
    for (const rows of [
      providers.slice(0, 6),
      [...providers].reverse(),
      providers.map((provider, index) => index === 0
        ? { ...provider, liveReady: true }
        : provider),
      providers.map((provider, index) => index === 1
        ? { ...provider, adapter: 'implemented' }
        : provider),
      providers.map((provider, index) => index === 0
        ? { ...provider, connection: { ...provider.connection, state: 'ready' } }
        : provider),
      providers.map((provider, index) => index === 3
        ? { ...provider, connection: { ...provider.connection, counts: { ...emptyCounts(), total: 2, ready: 1 } } }
        : provider),
    ]) {
      expect(parseNativeMarketingProviderRoutes(
        routesEnvelope({ providers: rows }),
        WORKSPACE_ID,
      )).toBeNull();
    }
  });
});

describe('NativeMarketingClient.listProviderRoutes', () => {
  it('calls the read-only provider route with JWT auth and no request body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(routesEnvelope()));
    const client = new NativeMarketingClient(tokenProvider(), {
      baseUrl: ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.listProviderRoutes(WORKSPACE_ID);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `${ORIGIN}/api/marketing/provider-routes?workspaceId=${WORKSPACE_ID}`,
    );
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(result).toEqual({
      ok: true,
      providerRoutes: expect.objectContaining({
        contractVersion: 'marketing-provider-routes.v1',
        externalActionPerformed: false,
        providers: expect.arrayContaining([
          expect.objectContaining({ platform: 'youtube', workflowReady: true, liveReady: false }),
        ]),
      }),
    });
    expect(JSON.stringify(result)).not.toContain('must-not-cross-ipc');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('rejects an invalid workspace before fetch and fails closed on malformed output', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(routesEnvelope({
      externalActionPerformed: true,
    })));
    const client = new NativeMarketingClient(tokenProvider(), {
      baseUrl: ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.listProviderRoutes('not-a-uuid'))
      .resolves.toEqual({ ok: false, error: 'invalid-workspace-id' });
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(client.listProviderRoutes(WORKSPACE_ID))
      .resolves.toEqual({ ok: false, error: 'invalid-response' });
  });
});
