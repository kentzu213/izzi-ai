/**
 * Native Marketing account-health parser and client tests (NM-012).
 * All requests are offline through an injected fetch implementation.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  NativeMarketingClient,
  parseNativeMarketingAccountHealth,
  type NativeMarketingTokenProvider,
} from './native-marketing-client';

const ORIGIN = 'https://api.izziapi.com';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const FOREIGN_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'test-supabase-access-token';
const CHECKED_AT = '2026-08-27T10:00:00.000Z';

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

function healthEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    workspaceId: WORKSPACE_ID,
    checkedAt: CHECKED_AT,
    authority: 'backend_oauth',
    externalActionPerformed: false,
    accounts: [{
      id: ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      platform: 'youtube',
      externalAccountId: 'provider-channel-id',
      displayName: 'IzziAPI',
      scopes: ['youtube.upload'],
      accountStatus: 'connected',
      tokenExpiresAt: '2026-08-27T11:00:00.000Z',
      hasAccessToken: true,
      hasRefreshToken: true,
      readiness: 'ready',
      reason: 'account_connected',
      createdAt: '2026-08-20T10:00:00.000Z',
      updatedAt: '2026-08-27T09:00:00.000Z',
      accessToken: 'must-not-cross-ipc',
      providerPayload: { secret: 'must-not-cross-ipc' },
      localPath: 'F:\\private\\provider.json',
    }],
    ...overrides,
  };
}

describe('parseNativeMarketingAccountHealth', () => {
  it('allowlists one backend-authoritative token-free health snapshot', () => {
    const parsed = parseNativeMarketingAccountHealth(healthEnvelope(), WORKSPACE_ID);
    expect(parsed).toEqual({
      workspaceId: WORKSPACE_ID,
      checkedAt: CHECKED_AT,
      authority: 'backend_oauth',
      externalActionPerformed: false,
      accounts: [{
        id: ACCOUNT_ID,
        platform: 'youtube',
        name: 'IzziAPI',
        accountStatus: 'connected',
        tokenExpiresAt: '2026-08-27T11:00:00.000Z',
        hasAccessToken: true,
        hasRefreshToken: true,
        readiness: 'ready',
        reason: 'account_connected',
      }],
    });
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain('must-not-cross-ipc');
    expect(serialized).not.toContain('providerPayload');
    expect(serialized).not.toContain('localPath');
    expect(Object.keys(parsed?.accounts[0] ?? {}).sort()).toEqual([
      'accountStatus',
      'hasAccessToken',
      'hasRefreshToken',
      'id',
      'name',
      'platform',
      'readiness',
      'reason',
      'tokenExpiresAt',
    ]);
  });

  it('rejects the wrong tenant, authority, or any claimed external action', () => {
    expect(parseNativeMarketingAccountHealth(
      healthEnvelope({ success: false }),
      WORKSPACE_ID,
    )).toBeNull();
    expect(parseNativeMarketingAccountHealth(
      healthEnvelope({ workspaceId: FOREIGN_WORKSPACE_ID }),
      WORKSPACE_ID,
    )).toBeNull();
    expect(parseNativeMarketingAccountHealth(
      healthEnvelope({ authority: 'provider_live' }),
      WORKSPACE_ID,
    )).toBeNull();
    expect(parseNativeMarketingAccountHealth(
      healthEnvelope({ externalActionPerformed: true }),
      WORKSPACE_ID,
    )).toBeNull();
  });

  it('rejects malformed rows and cross-tenant account metadata', () => {
    const base = healthEnvelope().accounts[0] as Record<string, unknown>;
    for (const account of [
      { ...base, id: 'not-a-uuid' },
      { ...base, workspaceId: FOREIGN_WORKSPACE_ID },
      { ...base, platform: 'myspace' },
      { ...base, hasAccessToken: 'yes' },
      { ...base, readiness: 'probably' },
      { ...base, reason: 'provider-said-a-secret' },
    ]) {
      expect(parseNativeMarketingAccountHealth(
        healthEnvelope({ accounts: [account] }),
        WORKSPACE_ID,
      )).toBeNull();
    }
  });

  it('rejects readiness claims that contradict exact expiry or status', () => {
    const base = healthEnvelope().accounts[0] as Record<string, unknown>;
    for (const account of [
      { ...base, tokenExpiresAt: CHECKED_AT },
      { ...base, accountStatus: 'revoked' },
      { ...base, hasAccessToken: false },
      { ...base, readiness: 'expired', reason: 'account_connected' },
      { ...base, readiness: 'revoked', reason: 'account_revoked', accountStatus: 'connected' },
    ]) {
      expect(parseNativeMarketingAccountHealth(
        healthEnvelope({ accounts: [account] }),
        WORKSPACE_ID,
      )).toBeNull();
    }
  });

  it('accepts exact expiry only when the backend marks it expired', () => {
    const base = healthEnvelope().accounts[0] as Record<string, unknown>;
    const parsed = parseNativeMarketingAccountHealth(healthEnvelope({
      accounts: [{
        ...base,
        tokenExpiresAt: CHECKED_AT,
        readiness: 'expired',
        reason: 'token_expired',
      }],
    }), WORKSPACE_ID);
    expect(parsed?.accounts[0]).toMatchObject({
      readiness: 'expired',
      reason: 'token_expired',
      tokenExpiresAt: CHECKED_AT,
    });
  });
});

describe('NativeMarketingClient.listAccountHealth', () => {
  it('calls the read-only health route with JWT auth and no request body', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(healthEnvelope()));
    const client = new NativeMarketingClient(tokenProvider(), {
      baseUrl: ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await client.listAccountHealth(WORKSPACE_ID);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `${ORIGIN}/api/marketing/accounts/health?workspaceId=${WORKSPACE_ID}`,
    );
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(result).toEqual({
      ok: true,
      health: expect.objectContaining({
        authority: 'backend_oauth',
        externalActionPerformed: false,
        accounts: [expect.objectContaining({ readiness: 'ready' })],
      }),
    });
    expect(JSON.stringify(result)).not.toContain('must-not-cross-ipc');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('optionally narrows by an allowlisted platform', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(healthEnvelope()));
    const client = new NativeMarketingClient(tokenProvider(), {
      baseUrl: ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await client.listAccountHealth(WORKSPACE_ID, 'youtube');
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `${ORIGIN}/api/marketing/accounts/health?workspaceId=${WORKSPACE_ID}&platform=youtube`,
    );
  });

  it('rejects invalid workspace or platform before fetch', async () => {
    const fetchImpl = vi.fn();
    const client = new NativeMarketingClient(tokenProvider(), {
      baseUrl: ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.listAccountHealth('not-a-uuid'))
      .resolves.toEqual({ ok: false, error: 'invalid-workspace-id' });
    await expect(client.listAccountHealth(WORKSPACE_ID, 'myspace' as never))
      .resolves.toEqual({ ok: false, error: 'unsupported-platform' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed on a malformed health response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(healthEnvelope({
      externalActionPerformed: true,
    })));
    const client = new NativeMarketingClient(tokenProvider(), {
      baseUrl: ORIGIN,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(client.listAccountHealth(WORKSPACE_ID))
      .resolves.toEqual({ ok: false, error: 'invalid-response' });
  });
});
