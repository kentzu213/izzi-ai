import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { isTrustedMarketingSender } from '../marketing/marketing-ipc';
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

function assertTrustedRuntimeSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedMarketingSender(event)) {
    throw new Error('Runtime IPC sender is not trusted');
  }
}

export function registerRuntimeIpc(
  manager: RuntimeManager,
  authority: RuntimeIpcAuthority,
): void {
  ipcMain.handle(
    RUNTIME_IPC_CHANNELS.listHealth,
    (event, input: RuntimeListHealthInput) => {
      assertTrustedRuntimeSender(event);
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
