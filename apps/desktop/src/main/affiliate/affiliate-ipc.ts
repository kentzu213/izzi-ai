/**
 * Affiliate IPC registration — wires the renderer-facing channels to the
 * main-process `AffiliateClient`. Lives in the Electron MAIN process.
 *
 * Security: every handler delegates straight to the client and returns ONLY
 * plain DTOs / results. The JWT lives only inside AffiliateClient and NEVER
 * crosses the IPC boundary.
 */

import { ipcMain, shell } from 'electron';
import { shortError } from './affiliate-client';
import type { AffiliateClient, WithdrawInput } from './affiliate-client';

export function registerAffiliateIpc(client: AffiliateClient): void {
  ipcMain.handle('affiliate:stats', () => client.getStats());
  ipcMain.handle('affiliate:commissions', () => client.listCommissions());
  ipcMain.handle('affiliate:withdrawals', () => client.listWithdrawals());
  ipcMain.handle('affiliate:withdraw', (_e, input: WithdrawInput) => client.withdraw(input));
  ipcMain.handle('affiliate:convertCredit', (_e, amount: number) => client.convertCredit(amount));

  // Ledger #25: a rejected openExternal must not reach the renderer (it calls this fire-and-forget)
  // and the log keeps only the error class, never the message.
  ipcMain.handle('affiliate:openWeb', async () => {
    const url = client.affiliateWebUrl();
    try {
      await shell.openExternal(url);
      return { ok: true, url };
    } catch (err) {
      console.warn(`[AffiliateIpc] openWeb: ${shortError(err)}`);
      return { ok: false };
    }
  });
}
