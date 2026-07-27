/**
 * Scheduled Sessions IPC registration — wires the renderer-facing channels to the main-process
 * `ScheduleService`. Lives in the Electron MAIN process.
 *
 * Security (security-baseline B/D): handlers return plain models only. Playbooks are picked by id
 * from the built-in templates, so the renderer can never hand main a command string to execute
 * (Requirement R5.1). No credential ever crosses this bridge (R5.2).
 *
 * @module main/scheduler/schedule-ipc
 * @see .kiro/specs/scheduled-sessions/requirements.md
 */
import { ipcMain } from 'electron';
import type { ScheduleService, CreateSessionInput } from './schedule-service';

export function registerScheduleIpc(service: ScheduleService): void {
  ipcMain.handle('schedule:playbooks', () => service.listPlaybooks());

  ipcMain.handle('schedule:list', () => service.list());

  ipcMain.handle('schedule:create', (_event, input: CreateSessionInput) => service.create(input));

  ipcMain.handle('schedule:setEnabled', (_event, id: string, enabled: boolean) =>
    service.setEnabled(id, enabled),
  );

  ipcMain.handle('schedule:remove', (_event, id: string) => service.remove(id));

  ipcMain.handle('schedule:runNow', async (_event, id: string) => service.runNow(id));

  ipcMain.handle('schedule:runs', (_event, id: string, limit?: number) => service.runs(id, limit));

  ipcMain.handle('schedule:profileHealth', () => service.profileHealth());

  ipcMain.handle('schedule:openProfile', (_event, profileDir: string, url?: string) =>
    service.openProfileForLogin(profileDir, url),
  );
}
