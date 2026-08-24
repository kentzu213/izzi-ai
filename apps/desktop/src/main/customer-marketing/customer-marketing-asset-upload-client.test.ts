import { describe, expect, it, vi } from 'vitest';
import { CustomerMarketingWorkspaceClient } from './customer-marketing-workspace-client';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RESOURCE_ID = '22222222-2222-4222-8222-222222222222';
const CHECKSUM = 'a'.repeat(64);
const BYTES = new Uint8Array([1, 2, 3, 4]);

function body(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(BYTES);
      controller.close();
    },
  });
}

describe('CustomerMarketingWorkspaceClient private asset upload', () => {
  it('streams exact bytes to the fixed authenticated endpoint and validates public proof', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('PUT');
      expect(init?.redirect).toBe('error');
      expect(init?.headers).toEqual({
        Authorization: 'Bearer test-token',
        'Content-Type': 'video/mp4',
        'Content-Length': String(BYTES.byteLength),
        'X-Content-SHA256': CHECKSUM,
      });
      expect((init as RequestInit & { duplex?: string }).duplex).toBe('half');
      expect(new Uint8Array(await new Response(init?.body).arrayBuffer())).toEqual(BYTES);
      return new Response(JSON.stringify({
        status: 'uploaded',
        workspaceId: WORKSPACE_ID,
        resourceId: RESOURCE_ID,
        checksum: CHECKSUM,
        sizeBytes: BYTES.byteLength,
      }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, baseUrl: 'https://api.example.test', fetchImpl },
    );

    await expect(client.uploadMarketingAssetContent({
      workspaceId: WORKSPACE_ID,
      resourceId: RESOURCE_ID,
      mimeType: 'video/mp4',
      sizeBytes: BYTES.byteLength,
      checksum: CHECKSUM,
      body: body(),
    })).resolves.toEqual({
      status: 'synced',
      outcome: 'uploaded',
      reconciliationRequired: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.example.test/api/marketing/assets/${WORKSPACE_ID}/${RESOURCE_ID}/content`,
      expect.any(Object),
    );
  });

  it('preserves reconciliation-required conflicts without exposing provider details', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      status: 'blocked',
      reason: 'storage_conflict',
      reconciliationRequired: true,
      detail: 'private/storage/path',
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, fetchImpl },
    );

    const result = await client.uploadMarketingAssetContent({
      workspaceId: WORKSPACE_ID,
      resourceId: RESOURCE_ID,
      mimeType: 'video/mp4',
      sizeBytes: BYTES.byteLength,
      checksum: CHECKSUM,
      body: body(),
    });

    expect(result).toEqual({
      status: 'conflict',
      outcome: null,
      reason: 'storage_conflict',
      reconciliationRequired: true,
    });
    expect(JSON.stringify(result)).not.toContain('private/storage/path');
  });

  it('rejects malformed client metadata before reading auth or sending bytes', async () => {
    const auth = { getAccessToken: vi.fn(async () => 'test-token') };
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const client = new CustomerMarketingWorkspaceClient(auth, { enabled: true, fetchImpl });

    await expect(client.uploadMarketingAssetContent({
      workspaceId: `${WORKSPACE_ID}?redirect=https://attacker.example`,
      resourceId: RESOURCE_ID,
      mimeType: 'video/mp4; charset=utf-8',
      sizeBytes: 0,
      checksum: CHECKSUM.toUpperCase(),
      body: body(),
    })).resolves.toEqual({
      status: 'unavailable',
      outcome: null,
      reconciliationRequired: false,
    });
    expect(auth.getAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires reconciliation when transport fails after upload starts', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      await new Response(init?.body).arrayBuffer();
      throw new TypeError('connection reset after send');
    }) as unknown as typeof fetch;
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, fetchImpl },
    );

    await expect(client.uploadMarketingAssetContent({
      workspaceId: WORKSPACE_ID,
      resourceId: RESOURCE_ID,
      mimeType: 'video/mp4',
      sizeBytes: BYTES.byteLength,
      checksum: CHECKSUM,
      body: body(),
    })).resolves.toEqual({
      status: 'unavailable',
      outcome: null,
      reconciliationRequired: true,
    });
  });

  it('requires reconciliation when a success response cannot prove the stored bytes', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      status: 'uploaded',
      workspaceId: WORKSPACE_ID,
      resourceId: RESOURCE_ID,
      checksum: 'b'.repeat(64),
      sizeBytes: BYTES.byteLength,
    }), { status: 201, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, fetchImpl },
    );

    await expect(client.uploadMarketingAssetContent({
      workspaceId: WORKSPACE_ID,
      resourceId: RESOURCE_ID,
      mimeType: 'video/mp4',
      sizeBytes: BYTES.byteLength,
      checksum: CHECKSUM,
      body: body(),
    })).resolves.toEqual({
      status: 'unavailable',
      outcome: null,
      reconciliationRequired: true,
    });
  });

  it('reports upload rate limits without requiring reconciliation', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'rate_limited', message: 'Too many upload requests' },
    }), { status: 429, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, fetchImpl },
    );

    await expect(client.uploadMarketingAssetContent({
      workspaceId: WORKSPACE_ID,
      resourceId: RESOURCE_ID,
      mimeType: 'video/mp4',
      sizeBytes: BYTES.byteLength,
      checksum: CHECKSUM,
      body: body(),
    })).resolves.toEqual({
      status: 'quota_exceeded',
      outcome: null,
      reconciliationRequired: false,
    });
  });
});
