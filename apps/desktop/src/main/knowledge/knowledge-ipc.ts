/**
 * Knowledge IPC registration — bridges the renderer Review Inbox and Quick Capture
 * to the main-process SQLite `KnowledgeStore`.
 *
 * @module main/knowledge/knowledge-ipc
 */

import { ipcMain } from 'electron';
import { isTrustedMarketingSender as isTrustedRendererSender } from '../marketing/marketing-ipc';
import type { KnowledgeStore } from './knowledge-store';
import type {
  KnowledgeCaptureInput,
  KnowledgePromoteInput,
  KnowledgeScope,
  KnowledgeSensitivity,
  KnowledgeState,
} from '../../shared/knowledge-types';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : 'Knowledge operation failed';
}

export function registerKnowledgeIpc(
  store: KnowledgeStore,
  onMutated?: () => void,
): void {
  ipcMain.handle('knowledge:capture', (e, input: KnowledgeCaptureInput) => {
    if (!isTrustedRendererSender(e)) return { ok: false, error: 'untrusted-sender' };
    try {
      const record = store.capture(input);
      onMutated?.();
      return { ok: true, record };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  });

  ipcMain.handle('knowledge:promote', (e, input: KnowledgePromoteInput) => {
    if (!isTrustedRendererSender(e)) return { ok: false, error: 'untrusted-sender' };
    try {
      const record = store.promote(input);
      onMutated?.();
      return { ok: true, record };
    } catch (err) {
      return { ok: false, error: errMsg(err) };
    }
  });

  ipcMain.handle(
    'knowledge:supersede',
    (e, input: { oldId: string; newId: string; reviewer?: string; reason: string }) => {
      if (!isTrustedRendererSender(e)) return { ok: false, error: 'untrusted-sender' };
      try {
        const record = store.supersede(
          input.oldId,
          input.newId,
          input.reviewer || 'user',
          input.reason,
        );
        onMutated?.();
        return { ok: true, record };
      } catch (err) {
        return { ok: false, error: errMsg(err) };
      }
    },
  );

  ipcMain.handle(
    'knowledge:retract',
    (e, input: { id: string; actor?: string; reason: string }) => {
      if (!isTrustedRendererSender(e)) return { ok: false, error: 'untrusted-sender' };
      try {
        const record = store.retract(input.id, input.actor || 'user', input.reason);
        onMutated?.();
        return { ok: true, record };
      } catch (err) {
        return { ok: false, error: errMsg(err) };
      }
    },
  );

  ipcMain.handle(
    'knowledge:list',
    (
      e,
      filter?: {
        state?: KnowledgeState;
        scope?: KnowledgeScope;
        workspaceId?: string;
        sensitivity?: KnowledgeSensitivity;
        includeInactive?: boolean;
        limit?: number;
      },
    ) => (isTrustedRendererSender(e) ? store.list(filter) : []),
  );

  ipcMain.handle(
    'knowledge:recall',
    (
      e,
      opts?: { workspaceId?: string; agent?: string; query?: string; limit?: number },
    ) => (isTrustedRendererSender(e) ? store.recall(opts) : []),
  );

  ipcMain.handle('knowledge:search', (e, query: string, limit?: number) =>
    isTrustedRendererSender(e) ? store.search(query, limit) : [],
  );

  ipcMain.handle('knowledge:stats', (e) =>
    isTrustedRendererSender(e)
      ? store.getStats()
      : { total: 0, candidate: 0, active: 0, superseded: 0, retracted: 0, shareable: 0, conflicts: 0 },
  );
}
