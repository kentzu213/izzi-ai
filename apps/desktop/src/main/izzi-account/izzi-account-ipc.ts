/**
 * Izzi account IPC registration — wires the Settings → "API & Usage" channels
 * to the main-process `IzziAccountClient`. Lives in the Electron MAIN process.
 *
 * Security: handlers return only plain DTOs. The Supabase token and the stored
 * provider key never cross IPC; the URLs opened here are built in main.
 */

import { ipcMain, shell } from 'electron';
import { shortError } from '../affiliate/affiliate-client';
import { IZZI_WEB_BASE } from '../config/public-config';
import type { IzziAccountClient } from './izzi-account-client';

async function openWeb(op: string, url: string): Promise<{ ok: boolean }> {
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (err) {
    console.warn(`[IzziAccountIpc] ${op}: ${shortError(err)}`);
    return { ok: false };
  }
}

export function registerIzziAccountIpc(client: IzziAccountClient): void {
  ipcMain.handle('izziAccount:overview', () => client.getOverview());
  ipcMain.handle('izziAccount:recentUsage', (_e, offset: number) => client.getRecentUsage(offset));
  ipcMain.handle('izziAccount:createKey', (_e, name: string) => client.createKey(name));
  ipcMain.handle('izziAccount:revokeKey', (_e, id: string) => client.revokeKey(id));
  ipcMain.handle('izziAccount:openDashboard', () => openWeb('openDashboard', `${IZZI_WEB_BASE}/dashboard`));
  ipcMain.handle('izziAccount:openTopUp', () => openWeb('openTopUp', `${IZZI_WEB_BASE}/dashboard/billing`));
}
