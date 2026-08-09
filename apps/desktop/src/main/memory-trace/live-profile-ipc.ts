// CMR-224 Slice 2 — Live.md IPC. Deliberately local-only.
//
// Live.md is classified `live_profile`, whose egress rule is `forbidden`: the
// body must never cross the machine edge, not even as metadata. So the graph UI
// reaches this file through these channels instead of `graph:create` — nothing
// here imports GraphClient or any other network client, and that absence is the
// point rather than an omission.
//
// Security (security-baseline B/C): every handler checks the sender first, then
// validates the payload. A body that is not a string is refused rather than
// coerced, because coercion here would silently overwrite what the operator
// wrote.

import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import type {
  LiveProfile,
  LiveProfileReadResult,
  LiveProfileWriteResult,
} from '../../shared/memory-trace/live-profile';
import type { LiveProfileStore } from './live-profile-store';
// The name is historical (it predates this slice) but the check is generic: it
// accepts only this app's own top-level renderer frame.
import { isTrustedMarketingSender as isTrustedRendererSender } from '../marketing/marketing-ipc';

export interface LiveProfileRevealResult {
  readonly ok: boolean;
  readonly filePath: string;
}

export interface LiveProfileIpcOptions {
  readonly onProfileWritten?: (profile: LiveProfile) => void;
}

/**
 * Register the `liveProfile:*` channels. `reveal` opens the file in the OS file
 * manager: the operator owning a real file they can edit in any editor is the
 * whole reason Live.md is a file and not a database row.
 */
export function registerLiveProfileIpc(
  store: LiveProfileStore,
  options: LiveProfileIpcOptions = {},
): void {
  ipcMain.handle('liveProfile:read', (event: IpcMainInvokeEvent): LiveProfileReadResult => {
    // Refuse rather than reveal whether a profile exists.
    if (!isTrustedRendererSender(event)) {
      return { status: 'unreadable', profile: null, filePath: store.path };
    }
    return store.ensure();
  });

  ipcMain.handle(
    'liveProfile:write',
    (event: IpcMainInvokeEvent, body: unknown): LiveProfileWriteResult => {
      if (!isTrustedRendererSender(event)) return { status: 'rejected', profile: null };
      if (typeof body !== 'string') return { status: 'rejected', profile: null };
      const result = store.write(body);
      if (result.status === 'ok' && result.profile && options.onProfileWritten) {
        try {
          options.onProfileWritten(result.profile);
        } catch {
          // Live.md is already durable. A secondary trace failure must not turn
          // a successful operator save into an ambiguous failed request.
          console.warn('[memory-trace] Live.md was saved but its trace revision was not recorded');
        }
      }
      return result;
    },
  );

  ipcMain.handle(
    'liveProfile:reveal',
    (event: IpcMainInvokeEvent): LiveProfileRevealResult => {
      if (!isTrustedRendererSender(event)) return { ok: false, filePath: store.path };
      // Create from the template when absent, so reveal never points at nothing.
      // An unreadable file is revealed too: that is precisely when the operator
      // needs to open it by hand.
      store.ensure();
      shell.showItemInFolder(store.path);
      return { ok: true, filePath: store.path };
    },
  );
}
