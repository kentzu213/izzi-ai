/**
 * Trusted-sender IPC handlers for AI Sales Coach & Closed-Loop Sales Distillation.
 *
 * @module main/customer-care/care-sales-coach-ipc
 */

import { ipcMain } from 'electron';
import { isTrustedMarketingSender } from '../marketing/marketing-ipc';
import type { CareSalesCoachService } from './care-sales-coach-service';

export function registerSalesCoachIpc(
  service: Pick<CareSalesCoachService, 'generateScript' | 'saveSalesLesson' | 'distillLessonsFromCrm'>,
): void {
  ipcMain.handle('salesCoach:generateScript', async (event, input: unknown) => {
    if (!isTrustedMarketingSender(event)) {
      return { ok: false, error: 'forbidden', message: 'Nguồn gọi không được tin cậy.' };
    }
    return service.generateScript(input);
  });

  ipcMain.handle('salesCoach:saveLesson', async (event, input: unknown) => {
    if (!isTrustedMarketingSender(event)) {
      return { ok: false, error: 'forbidden' };
    }
    return service.saveSalesLesson(input);
  });

  ipcMain.handle('salesCoach:distillFromCrm', async (event, input: unknown) => {
    if (!isTrustedMarketingSender(event)) {
      return { ok: false, error: 'forbidden' };
    }
    return service.distillLessonsFromCrm(input);
  });
}
