import { describe, expect, it, vi } from 'vitest';
import type {
  NativeMarketingClient,
  NativeMarketingWorkspaceSummary,
} from '../marketing/native-marketing-client';
import { NativeMarketingIntegrationAuthorityGateway } from './customer-marketing-integration-authority';

const WORKSPACE_A: NativeMarketingWorkspaceSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Izzi Marketing A',
  role: 'owner',
  plan: 'pro',
  creditsLimit: 100,
  creditsUsed: 12,
};

const WORKSPACE_B: NativeMarketingWorkspaceSummary = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Izzi Marketing B',
  role: 'manager',
  plan: 'starter',
  creditsLimit: null,
  creditsUsed: null,
};

function gateway(result: Awaited<ReturnType<NativeMarketingClient['listWorkspaces']>>) {
  const listWorkspaces = vi.fn(async () => result);
  return {
    authority: new NativeMarketingIntegrationAuthorityGateway({ listWorkspaces }),
    listWorkspaces,
  };
}

describe('NativeMarketingIntegrationAuthorityGateway', () => {
  it('uses the only native workspace when the local record is not bound yet', async () => {
    const context = gateway({ ok: true, workspaces: [WORKSPACE_A] });

    await expect(context.authority.resolve('customer-local-binding')).resolves.toEqual({
      status: 'synced',
      workspace: {
        id: WORKSPACE_A.id,
        name: WORKSPACE_A.name,
        role: 'owner',
        plan: 'pro',
        quota: { creditsLimit: 100, creditsUsed: 12 },
      },
    });
    expect(context.listWorkspaces).toHaveBeenCalledTimes(1);
  });

  it('uses an exact persisted binding when more than one workspace is available', async () => {
    const context = gateway({ ok: true, workspaces: [WORKSPACE_A, WORKSPACE_B] });

    await expect(context.authority.resolve(WORKSPACE_B.id)).resolves.toEqual({
      status: 'synced',
      workspace: {
        id: WORKSPACE_B.id,
        name: WORKSPACE_B.name,
        role: 'manager',
        plan: 'starter',
        quota: null,
      },
    });
  });

  it('fails closed when multiple workspaces have no exact binding', async () => {
    const context = gateway({ ok: true, workspaces: [WORKSPACE_A, WORKSPACE_B] });

    await expect(context.authority.resolve('customer-local-binding')).resolves.toEqual({
      status: 'unavailable',
      workspace: null,
    });
  });

  it('reports an empty native workspace list without inventing local authority', async () => {
    const context = gateway({ ok: true, workspaces: [] });

    await expect(context.authority.resolve()).resolves.toEqual({
      status: 'not_found',
      workspace: null,
    });
  });

  it('preserves a bounded forbidden result and hides all other native failures', async () => {
    const forbidden = gateway({ ok: false, error: 'forbidden' });
    const network = gateway({ ok: false, error: 'network-error' });

    await expect(forbidden.authority.resolve()).resolves.toEqual({
      status: 'forbidden',
      workspace: null,
    });
    await expect(network.authority.resolve()).resolves.toEqual({
      status: 'unavailable',
      workspace: null,
    });
  });

  it('fails closed when the native client throws', async () => {
    const listWorkspaces = vi.fn(async () => {
      throw new Error('sensitive transport detail');
    });
    const authority = new NativeMarketingIntegrationAuthorityGateway({ listWorkspaces });

    await expect(authority.resolve()).resolves.toEqual({
      status: 'unavailable',
      workspace: null,
    });
  });
});
