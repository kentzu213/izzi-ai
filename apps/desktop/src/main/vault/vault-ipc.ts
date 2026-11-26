/**
 * Vault IPC registration — bridges the renderer MyGraph & Quick Capture Mini-Window
 * to the main-process `VaultSyncEngine`.
 *
 * Security (security-baseline A/B/D):
 *  - Folder selection uses OS native `dialog.showOpenDialog` (user-consented).
 *  - No credentials cross IPC; cloud sync uses GraphClient in main.
 *
 * @module main/vault/vault-ipc
 */

import * as fs from 'node:fs';
import { dialog, ipcMain, shell } from 'electron';
import { isTrustedMarketingSender as isTrustedRendererSender } from '../marketing/marketing-ipc';
import type { DatabaseManager } from '../db/database';
import type { VaultSyncEngine } from './vault-sync-engine';

const DEFAULT_CODEX_EXPORTS_DIR = 'F:\\Ai Tools\\Codex\\KnowledgeMemory\\exports';

export function registerVaultIpc(engine: VaultSyncEngine, db: DatabaseManager): void {
  ipcMain.handle('vault:status', (e) => {
    if (!isTrustedRendererSender(e)) throw new Error('untrusted-sender');
    return engine.getStatus();
  });
  ipcMain.handle('vault:sync', (e) => {
    if (!isTrustedRendererSender(e)) throw new Error('untrusted-sender');
    return engine.syncNow();
  });
  ipcMain.handle('vault:nodes', (e) => (isTrustedRendererSender(e) ? engine.listLocalNodes() : []));
  ipcMain.handle('vault:links', (e) => (isTrustedRendererSender(e) ? engine.listLocalLinks() : []));
  ipcMain.handle('vault:search', (e, query: string, limit?: number) =>
    isTrustedRendererSender(e) ? engine.searchLocal(query, limit) : [],
  );

  ipcMain.handle('vault:openFolder', async (e) => {
    if (!isTrustedRendererSender(e)) return { ok: false, path: '', error: 'untrusted-sender' };
    const dir = engine.getVaultDir();
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    return { ok: err === '', path: dir, ...(err ? { error: err } : {}) };
  });

  ipcMain.handle('vault:chooseFolder', async (e) => {
    if (!isTrustedRendererSender(e)) return { ok: false, canceled: true, path: '' };
    const picked = await dialog.showOpenDialog({
      title: 'Chọn thư mục Local Vault (tương thích Obsidian)',
      defaultPath: engine.getVaultDir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, canceled: true, path: engine.getVaultDir() };
    }
    const nextDir = engine.setVaultDir(picked.filePaths[0]);
    db.setSetting('vault.dir', nextDir);
    const status = await engine.syncNow();
    return { ok: true, path: nextDir, status };
  });

  ipcMain.handle('vault:setWatch', (e, enabled: boolean) => {
    if (!isTrustedRendererSender(e)) throw new Error('untrusted-sender');
    const on = enabled === true;
    db.setSetting('vault.watchEnabled', on ? 'true' : 'false');
    if (on) engine.startWatching();
    else engine.stopWatching();
    return engine.getStatus();
  });

  ipcMain.handle('vault:importMarkdownFolder', async (e) => {
    if (!isTrustedRendererSender(e)) {
      return { ok: false, imported: 0, skipped: 0, blockedSecrets: 0, errors: ['untrusted-sender'] };
    }
    const picked = await dialog.showOpenDialog({
      title: 'Chọn thư mục Obsidian Vault (.md) để nhập vào Hộp duyệt',
      properties: ['openDirectory'],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, imported: 0, skipped: 0, blockedSecrets: 0, errors: ['Đã hủy'] };
    }
    return engine.importMarkdownFolder(picked.filePaths[0]);
  });

  ipcMain.handle('vault:importCodexExports', async (e) => {
    if (!isTrustedRendererSender(e)) {
      return { ok: false, imported: 0, skipped: 0, blockedSecrets: 0, errors: ['untrusted-sender'] };
    }
    const picked = await dialog.showOpenDialog({
      title: 'Chọn thư mục Codex KnowledgeMemory exports',
      ...(fs.existsSync(DEFAULT_CODEX_EXPORTS_DIR) ? { defaultPath: DEFAULT_CODEX_EXPORTS_DIR } : {}),
      properties: ['openDirectory'],
    });
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, imported: 0, skipped: 0, blockedSecrets: 0, errors: ['Đã hủy'] };
    }
    return engine.importCodexExports(picked.filePaths[0]);
  });
}
