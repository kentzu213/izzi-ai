/**
 * IPC for agent profiles (docs/MYGRAPH-AGENT-MEMORY.md, S2). Only the app's own window may call; the
 * account always comes from main, never from the renderer.
 *
 * @module main/agents/memory/agent-profile-ipc
 */
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { AgentProfilesResult } from '../../../shared/agent-profile-types';
import { isTrustedMarketingSender } from '../../marketing/marketing-ipc';
import type { AgentProfileService } from './agent-profile-service';

const REFUSED: AgentProfilesResult = { ok: false, error: 'auth' };

export function registerAgentProfileIpc(service: AgentProfileService): void {
  const guard = <T extends unknown[]>(run: (...args: T) => AgentProfilesResult | Promise<AgentProfilesResult>) =>
    async (event: IpcMainInvokeEvent, ...args: T): Promise<AgentProfilesResult> =>
      (isTrustedMarketingSender(event) ? run(...args) : REFUSED);

  ipcMain.handle('agentProfiles:get', guard(() => service.getState()));
  ipcMain.handle('agentProfiles:refresh', guard(() => service.refresh()));
  ipcMain.handle('agentProfiles:approve', guard((input: unknown) => service.approve(input)));
  ipcMain.handle('agentProfiles:discard', guard((input: unknown) => service.discard(input)));
  ipcMain.handle('agentProfiles:forget', guard((input: unknown) => service.forget(input)));
}
