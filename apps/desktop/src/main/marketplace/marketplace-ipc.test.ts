import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { MarketplaceOperationService } from './operation-service';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    electronMocks.handlers.set(channel, handler);
  }),
  fromWebContents: vi.fn(),
  isPackaged: false,
}));

vi.mock('electron', () => ({
  ipcMain: { handle: electronMocks.handle },
  BrowserWindow: { fromWebContents: electronMocks.fromWebContents },
  app: {
    get isPackaged() {
      return electronMocks.isPackaged;
    },
  },
}));

import {
  MARKETPLACE_IPC_CHANNELS,
} from '../../shared/marketplace';
import { registerMarketplaceIpc } from './marketplace-ipc';

function event(url = 'http://localhost:5173/marketplace'): IpcMainInvokeEvent {
  const sender = { id: 7, getURL: () => url };
  electronMocks.fromWebContents.mockReturnValue({ webContents: { id: 7 } });
  return {
    sender,
    senderFrame: { url, parent: null },
  } as unknown as IpcMainInvokeEvent;
}

function serviceMock() {
  return {
    loadCatalog: vi.fn(async () => ({
      schemaVersion: 1,
      catalogVersion: '1.0.0',
      generatedAt: '2026-07-29T23:00:00.000Z',
      source: {
        kind: 'cached',
        connection: 'offline',
        retrievedAt: '2026-07-29T23:01:00.000Z',
      },
      packages: [],
    })),
    createPlan: vi.fn(),
    requestInstall: vi.fn(),
    resumeInstall: vi.fn(),
  };
}

beforeEach(() => {
  electronMocks.handlers.clear();
  electronMocks.handle.mockClear();
  electronMocks.fromWebContents.mockReset();
  electronMocks.isPackaged = false;
});

describe('Marketplace IPC boundary', () => {
  it('rejects an untrusted sender before invoking the service', async () => {
    const service = serviceMock();
    registerMarketplaceIpc(service as unknown as MarketplaceOperationService);
    const handler = electronMocks.handlers.get(MARKETPLACE_IPC_CHANNELS.loadCatalog);
    const senderEvent = event();
    electronMocks.fromWebContents.mockReturnValue(null);

    await expect(handler!(senderEvent)).rejects.toThrow('sender is not trusted');
    expect(service.loadCatalog).not.toHaveBeenCalled();
  });

  it('rejects malformed package and resume inputs before service execution', async () => {
    const service = serviceMock();
    registerMarketplaceIpc(service as unknown as MarketplaceOperationService);
    const createPlan = electronMocks.handlers.get(MARKETPLACE_IPC_CHANNELS.createPlan);
    const resumeInstall = electronMocks.handlers.get(MARKETPLACE_IPC_CHANNELS.resumeInstall);

    await expect(createPlan!(event(), '   ')).resolves.toEqual({
      ok: false,
      reason: 'INVALID_PACKAGE_KEY',
    });
    await expect(resumeInstall!(event(), {
      plan: {},
      approvalId: 42,
    })).resolves.toEqual({
      ok: false,
      reason: 'INVALID_RESUME_REQUEST',
    });
    expect(service.createPlan).not.toHaveBeenCalled();
    expect(service.resumeInstall).not.toHaveBeenCalled();
  });
});
