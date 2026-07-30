import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import {
  RUNTIME_IPC_CHANNELS,
  type RuntimeHealthSnapshot,
} from '../../shared/runtime';
import { filterAuthorizedRuntimeHealth } from './runtime-health-authorization';

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
  dialog: {},
  shell: {},
}));

import { registerRuntimeIpc } from './runtime-ipc';

const health: RuntimeHealthSnapshot = {
  schemaVersion: 1,
  runtimeId: 'runtime.health.test',
  kind: 'browser',
  tenantId: 'tenant-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  packageId: 'package-1',
  lifecycle: 'ready',
  healthy: true,
  updatedAt: '2026-07-29T00:00:00.000Z',
};

const authorizedScope = {
  tenantId: health.tenantId,
  userId: health.userId,
  workspaceId: health.workspaceId,
};

function senderEvent(options: { known?: boolean; child?: boolean } = {}): IpcMainInvokeEvent {
  const { known = true, child = false } = options;
  const url = 'http://localhost:5173/runtime';
  const sender = { id: 11, getURL: () => url };
  electronMocks.fromWebContents.mockReturnValue(
    known ? { webContents: { id: sender.id } } : null,
  );
  return {
    sender,
    senderFrame: {
      url,
      parent: child ? {} : null,
    },
  } as unknown as IpcMainInvokeEvent;
}

function setupIpc() {
  const manager = {
    listHealth: vi.fn(() => [health]),
  };
  const authority = {
    listAuthorizedRuntimeScopes: vi.fn(() => [authorizedScope]),
  };
  registerRuntimeIpc(manager as never, authority);
  const handler = electronMocks.handlers.get(RUNTIME_IPC_CHANNELS.listHealth);
  if (!handler) throw new Error(`${RUNTIME_IPC_CHANNELS.listHealth} handler was not registered`);
  return { manager, authority, handler };
}

beforeEach(() => {
  electronMocks.handlers.clear();
  electronMocks.handle.mockClear();
  electronMocks.fromWebContents.mockReset();
  electronMocks.isPackaged = false;
  delete process.env.OPENCLAW_FORCE_PROD_RENDERER;
});

describe('runtime health IPC authorization', () => {
  it('requires an exact tenant/user/workspace scope instead of workspace alone', () => {
    expect(filterAuthorizedRuntimeHealth([health], [{
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    }])).toEqual([health]);
    expect(filterAuthorizedRuntimeHealth([health], [{
      tenantId: 'tenant-forged',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    }])).toEqual([]);
    expect(filterAuthorizedRuntimeHealth([health], [{
      tenantId: 'tenant-1',
      userId: 'user-forged',
      workspaceId: 'workspace-1',
    }])).toEqual([]);
  });

  it('returns nothing when signed-out authority supplies no scopes', () => {
    expect(filterAuthorizedRuntimeHealth([health], [])).toEqual([]);
  });
});

describe('runtime health IPC sender trust', () => {
  it('accepts the trusted top-level renderer', () => {
    const { manager, authority, handler } = setupIpc();

    expect(handler(senderEvent(), { workspaceId: health.workspaceId })).toEqual([health]);
    expect(authority.listAuthorizedRuntimeScopes).toHaveBeenCalledOnce();
    expect(manager.listHealth).toHaveBeenCalledWith(health.workspaceId);
  });

  it('rejects an unknown sender before parsing input or resolving authority', () => {
    const { manager, authority, handler } = setupIpc();
    const unreadableInput = new Proxy({}, {
      get: () => {
        throw new Error('input was parsed');
      },
    });

    expect(() => handler(senderEvent({ known: false }), unreadableInput)).toThrow(
      'Runtime IPC sender is not trusted',
    );
    expect(authority.listAuthorizedRuntimeScopes).not.toHaveBeenCalled();
    expect(manager.listHealth).not.toHaveBeenCalled();
  });

  it('rejects a child frame before parsing input or resolving authority', () => {
    const { manager, authority, handler } = setupIpc();
    const unreadableInput = new Proxy({}, {
      get: () => {
        throw new Error('input was parsed');
      },
    });

    expect(() => handler(senderEvent({ child: true }), unreadableInput)).toThrow(
      'Runtime IPC sender is not trusted',
    );
    expect(authority.listAuthorizedRuntimeScopes).not.toHaveBeenCalled();
    expect(manager.listHealth).not.toHaveBeenCalled();
  });
});
