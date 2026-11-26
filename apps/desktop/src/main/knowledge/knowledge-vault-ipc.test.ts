import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';

const handlers = new Map<string, (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: {
    fromWebContents: (sender: { id: number }) => ({ webContents: { id: sender.id } }),
  },
  ipcMain: {
    handle: (channel: string, fn: (e: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    },
  },
  dialog: {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
  },
  shell: {
    openPath: vi.fn().mockResolvedValue(''),
  },
}));

import { registerKnowledgeIpc } from './knowledge-ipc';
import { registerVaultIpc } from '../vault/vault-ipc';
import type { KnowledgeStore } from './knowledge-store';
import type { VaultSyncEngine } from '../vault/vault-sync-engine';
import type { DatabaseManager } from '../db/database';

function makeEvent(url: string, hasParent = false): IpcMainInvokeEvent {
  return {
    sender: { id: 101, getURL: () => url },
    senderFrame: { url, parent: hasParent ? { url } : null },
  } as unknown as IpcMainInvokeEvent;
}

describe('knowledge:* & vault:* IPC sender-trust security gate', () => {
  const captureSpy = vi.fn();
  const listSpy = vi.fn(() => []);
  const syncSpy = vi.fn();
  const importMdSpy = vi.fn();

  beforeEach(() => {
    handlers.clear();
    captureSpy.mockReset();
    listSpy.mockReset().mockReturnValue([]);
    syncSpy.mockReset();
    importMdSpy.mockReset();

    const fakeStore = {
      capture: captureSpy,
      promote: vi.fn(),
      supersede: vi.fn(),
      retract: vi.fn(),
      list: listSpy,
      recall: vi.fn(() => []),
      search: vi.fn(() => []),
      getStats: vi.fn(() => ({
        total: 0,
        candidate: 0,
        active: 0,
        superseded: 0,
        retracted: 0,
        shareable: 0,
        conflicts: 0,
      })),
    } as unknown as KnowledgeStore;

    const fakeEngine = {
      getStatus: vi.fn(() => ({ vaultDir: '/tmp/v' })),
      syncNow: syncSpy,
      listLocalNodes: vi.fn(() => []),
      listLocalLinks: vi.fn(() => []),
      searchLocal: vi.fn(() => []),
      getVaultDir: vi.fn(() => '/tmp/v'),
      setVaultDir: vi.fn((d: string) => d),
      startWatching: vi.fn(),
      stopWatching: vi.fn(),
      importMarkdownFolder: importMdSpy,
      importCodexExports: vi.fn(),
    } as unknown as VaultSyncEngine;

    const fakeDb = { setSetting: vi.fn() } as unknown as DatabaseManager;

    registerKnowledgeIpc(fakeStore);
    registerVaultIpc(fakeEngine, fakeDb);
  });

  it('rejects untrusted external origins and nested frames fail-closed across knowledge & vault channels', async () => {
    const evilEvent = makeEvent('https://evil.example.com/phish');
    const iframeEvent = makeEvent('http://localhost:5173/#quick-capture', true);

    expect(await handlers.get('knowledge:capture')!(evilEvent, { title: 'x' })).toEqual({
      ok: false,
      error: 'untrusted-sender',
    });
    expect(await handlers.get('knowledge:capture')!(iframeEvent, { title: 'x' })).toEqual({
      ok: false,
      error: 'untrusted-sender',
    });
    expect(captureSpy).not.toHaveBeenCalled();

    expect(await handlers.get('knowledge:list')!(evilEvent)).toEqual([]);
    expect(listSpy).not.toHaveBeenCalled();

    expect(() => handlers.get('vault:sync')!(evilEvent)).toThrow(/untrusted-sender/);
    expect(syncSpy).not.toHaveBeenCalled();

    expect(await handlers.get('vault:importMarkdownFolder')!(evilEvent)).toEqual({
      ok: false,
      imported: 0,
      skipped: 0,
      blockedSecrets: 0,
      errors: ['untrusted-sender'],
    });
    expect(importMdSpy).not.toHaveBeenCalled();
  });

  it('allows the trusted desktop renderer origin', async () => {
    const trusted = makeEvent('http://localhost:5173/#quick-capture');
    await handlers.get('knowledge:list')!(trusted);
    expect(listSpy).toHaveBeenCalledTimes(1);

    await handlers.get('vault:sync')!(trusted);
    expect(syncSpy).toHaveBeenCalledTimes(1);
  });
});
