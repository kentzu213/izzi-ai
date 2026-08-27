import { describe, expect, it, vi } from 'vitest';
import { CustomerMarketingService, type CustomerIdentity } from './customer-marketing-service';
import type {
  CustomerMarketingWorkspaceGateway,
  RemoteMarketingWorkspace,
} from './customer-marketing-workspace-client';
import type { CustomerMarketingLegacyImportRegistry } from './customer-marketing-legacy-import';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const SELECTION_ID = '22222222-2222-4222-8222-222222222222';
const RECEIPT_ID = '33333333-3333-4333-8333-333333333333';
const MANIFEST_DIGEST = 'a'.repeat(64);
const RECEIPT_DIGEST = 'b'.repeat(64);
const MANIFEST_BYTES = Buffer.from('{"schema":"izzi-auto-post-migration","version":1}', 'utf8');

class MemorySettings {
  private readonly values = new Map<string, string>();

  getSetting(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setSetting(key: string, value: string): void {
    this.values.set(key, value);
  }

  deleteSetting(key: string): void {
    this.values.delete(key);
  }

  withSettingsTransaction<T>(operation: () => T): T {
    return operation();
  }
}

function remoteWorkspace(role: RemoteMarketingWorkspace['role'] = 'owner'): RemoteMarketingWorkspace {
  return {
    id: WORKSPACE_ID,
    name: 'IzziAPI Marketing',
    role,
    plan: 'pro',
    quota: { creditsLimit: 80, creditsUsed: 12 },
  };
}

function remoteReceipt(overrides: Record<string, unknown> = {}) {
  return {
    receiptId: RECEIPT_ID,
    workspaceId: WORKSPACE_ID,
    manifestDigest: MANIFEST_DIGEST,
    status: 'applied' as const,
    duplicate: false,
    schemaVersion: 'izzi-auto-post-migration.v1' as const,
    mapperVersion: 'nm-010c.2',
    counts: {
      campaigns: 1,
      content: 2,
      accountReconnectTasks: 3,
      mediaReuploadTasks: 1,
      scheduleReconnectTasks: 1,
      recordReviewTasks: 4,
    },
    occurredAt: '2026-08-24T04:00:00.000Z',
    receiptDigest: RECEIPT_DIGEST,
    ...overrides,
  };
}

function setup(options: {
  role?: RemoteMarketingWorkspace['role'];
  consumeResult?: { bytes: Buffer; manifestDigest: string } | null;
  postResult?: Record<string, unknown>;
  receiptResult?: Record<string, unknown>;
} = {}) {
  const workspace = remoteWorkspace(options.role);
  const getCurrent = vi.fn(async () => ({ status: 'synced' as const, workspace }));
  const importLegacyAutoPost = vi.fn(async () => options.postResult ?? ({
    status: 'synced' as const,
    receipt: remoteReceipt(),
    reconciliationRequired: false,
  }));
  const getLegacyAutoPostImportReceipt = vi.fn(async () => options.receiptResult ?? ({
    status: 'not_found' as const,
    receipt: null,
  }));
  const gateway = {
    getCurrent,
    importLegacyAutoPost,
    getLegacyAutoPostImportReceipt,
  } as unknown as CustomerMarketingWorkspaceGateway;
  const preview = vi.fn();
  const consume = vi.fn(async () => options.consumeResult === undefined
    ? { bytes: MANIFEST_BYTES, manifestDigest: MANIFEST_DIGEST }
    : options.consumeResult);
  const registry = { preview, consume } as Pick<CustomerMarketingLegacyImportRegistry, 'preview' | 'consume'>;
  const identity: CustomerIdentity = { id: 'tenant-import', name: 'Owner', plan: 'pro', balance: 75 };
  const service = new CustomerMarketingService(
    new MemorySettings(),
    () => identity,
    () => [],
    undefined,
    null,
    gateway,
    undefined,
    null,
    undefined,
    undefined,
    () => [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    null,
    registry,
  );
  return {
    service,
    getCurrent,
    importLegacyAutoPost,
    getLegacyAutoPostImportReceipt,
    consume,
  };
}

describe('CustomerMarketingService legacy Auto Post import mutation', () => {
  it.each(['owner', 'manager'] as const)('imports once for an authoritative %s and returns only a renderer-safe receipt', async (role) => {
    const context = setup({ role });

    const result = await context.service.importLegacyAutoPost({
      selectionId: SELECTION_ID,
      confirmed: true,
    });

    expect(context.consume).toHaveBeenCalledWith(SELECTION_ID);
    expect(context.importLegacyAutoPost).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      manifestDigest: MANIFEST_DIGEST,
      bytes: MANIFEST_BYTES,
    });
    expect(result).toEqual({
      ok: true,
      status: 'synced',
      receipt: {
        status: 'applied',
        duplicate: false,
        schemaVersion: 'izzi-auto-post-migration.v1',
        mapperVersion: 'nm-010c.2',
        counts: remoteReceipt().counts,
        occurredAt: '2026-08-24T04:00:00.000Z',
      },
      reconciled: false,
      reconciliationRequired: false,
    });
    const rendererPayload = JSON.stringify(result);
    expect(rendererPayload).not.toContain(WORKSPACE_ID);
    expect(rendererPayload).not.toContain(MANIFEST_DIGEST);
    expect(rendererPayload).not.toContain(RECEIPT_ID);
    expect(rendererPayload).not.toContain(RECEIPT_DIGEST);
  });

  it.each(['editor', 'reviewer', 'viewer'] as const)('denies %s before consuming a selection or dispatching POST', async (role) => {
    const context = setup({ role });

    await expect(context.service.importLegacyAutoPost({
      selectionId: SELECTION_ID,
      confirmed: true,
    })).resolves.toMatchObject({ ok: false, status: 'forbidden', reconciliationRequired: false });
    expect(context.consume).not.toHaveBeenCalled();
    expect(context.importLegacyAutoPost).not.toHaveBeenCalled();
  });

  it('fails closed for malformed confirmation and a changed, expired, unknown, or not-ready selection', async () => {
    const malformed = setup();
    await expect(malformed.service.importLegacyAutoPost({
      selectionId: SELECTION_ID,
      confirmed: false,
    } as never)).resolves.toMatchObject({ ok: false, status: 'unavailable' });
    expect(malformed.getCurrent).not.toHaveBeenCalled();
    expect(malformed.consume).not.toHaveBeenCalled();

    const unavailableSelection = setup({ consumeResult: null });
    await expect(unavailableSelection.service.importLegacyAutoPost({
      selectionId: SELECTION_ID,
      confirmed: true,
    })).resolves.toMatchObject({
      ok: false,
      status: 'conflict',
      receipt: null,
      reconciliationRequired: false,
    });
    expect(unavailableSelection.importLegacyAutoPost).not.toHaveBeenCalled();
  });

  it('performs exactly one GET reconciliation after an ambiguous POST outcome', async () => {
    const receipt = remoteReceipt({ duplicate: true });
    const context = setup({
      postResult: { status: 'unavailable', receipt: null, reconciliationRequired: true },
      receiptResult: { status: 'synced', receipt },
    });

    await expect(context.service.importLegacyAutoPost({
      selectionId: SELECTION_ID,
      confirmed: true,
    })).resolves.toMatchObject({
      ok: true,
      status: 'synced',
      receipt: { status: 'applied', duplicate: true },
      reconciled: true,
      reconciliationRequired: false,
    });
    expect(context.importLegacyAutoPost).toHaveBeenCalledTimes(1);
    expect(context.getLegacyAutoPostImportReceipt).toHaveBeenCalledTimes(1);
    expect(context.getLegacyAutoPostImportReceipt).toHaveBeenCalledWith(WORKSPACE_ID, MANIFEST_DIGEST);
  });

  it('returns an explicit uncertain state when GET cannot prove the ambiguous POST result', async () => {
    const context = setup({
      postResult: { status: 'unavailable', receipt: null, reconciliationRequired: true },
      receiptResult: { status: 'not_found', receipt: null },
    });

    await expect(context.service.importLegacyAutoPost({
      selectionId: SELECTION_ID,
      confirmed: true,
    })).resolves.toMatchObject({
      ok: false,
      status: 'unavailable',
      receipt: null,
      reconciled: false,
      reconciliationRequired: true,
    });
    expect(context.importLegacyAutoPost).toHaveBeenCalledTimes(1);
    expect(context.getLegacyAutoPostImportReceipt).toHaveBeenCalledTimes(1);
  });

  it('does not reconcile or retry a deterministic POST rejection', async () => {
    const context = setup({
      postResult: { status: 'forbidden', receipt: null, reconciliationRequired: false },
    });

    await expect(context.service.importLegacyAutoPost({
      selectionId: SELECTION_ID,
      confirmed: true,
    })).resolves.toMatchObject({
      ok: false,
      status: 'forbidden',
      receipt: null,
      reconciliationRequired: false,
    });
    expect(context.importLegacyAutoPost).toHaveBeenCalledTimes(1);
    expect(context.getLegacyAutoPostImportReceipt).not.toHaveBeenCalled();
  });
});
