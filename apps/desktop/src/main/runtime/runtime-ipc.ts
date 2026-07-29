import { ipcMain } from 'electron';
import {
  RUNTIME_IPC_CHANNELS,
  type RuntimeListHealthInput,
} from '../../shared/runtime';
import type { RuntimeManager } from './runtime-manager';
import {
  filterAuthorizedRuntimeHealth,
  type RuntimeHealthScope,
} from './runtime-health-authorization';

export interface RuntimeIpcAuthority {
  readonly listAuthorizedRuntimeScopes: () => readonly RuntimeHealthScope[];
}

export function registerRuntimeIpc(
  manager: RuntimeManager,
  authority: RuntimeIpcAuthority,
): void {
  ipcMain.handle(
    RUNTIME_IPC_CHANNELS.listHealth,
    (_event, input: RuntimeListHealthInput) => {
      const requested = input?.workspaceId?.trim();
      const scopes = authority.listAuthorizedRuntimeScopes().filter((scope) => (
        Boolean(scope.tenantId.trim())
        && Boolean(scope.userId.trim())
        && Boolean(scope.workspaceId.trim())
      ));
      if (requested && !scopes.some((scope) => scope.workspaceId === requested)) {
        throw new Error('Runtime workspace is not authorized');
      }
      return filterAuthorizedRuntimeHealth(manager.listHealth(requested), scopes, requested);
    },
  );
}

export {
  filterAuthorizedRuntimeHealth,
  type RuntimeHealthScope,
} from './runtime-health-authorization';
