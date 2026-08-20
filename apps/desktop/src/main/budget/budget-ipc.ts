import { ipcMain } from 'electron';
import type { BudgetService } from './budget-service';

export function registerBudgetIpc(service: Pick<BudgetService, 'getStatus' | 'getLimits' | 'setLimits' | 'getAlerts' | 'getAdvice' | 'purge'>): void {
  ipcMain.handle('budget:getStatus', () => service.getStatus());
  ipcMain.handle('budget:getLimits', () => service.getLimits());
  ipcMain.handle('budget:setLimits', (_event, limits) => service.setLimits(limits));
  ipcMain.handle('budget:getAlerts', (_event, since?: number) => service.getAlerts(since));
  ipcMain.handle('budget:getAdvice', () => service.getAdvice());
  ipcMain.handle('budget:purge', (_event, keepDays?: number) => service.purge(keepDays));
}
