/**
 * Personal Office shell — snapshot hook.
 *
 * Owns the shell's data lifecycle: load once, expose one `WorkSnapshot`, and
 * offer `retry` + `delegate`. Keeps every component free of async concerns.
 *
 * The forced-state harness (`?state=`) exists so the interaction-state matrix
 * (loading / empty / error / offline / degraded) is screenshot-testable without
 * an engine. It only ever *presents* a state; it never fabricates work items.
 *
 * @module renderer/shell/useWorkSnapshot
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceInstanceId } from '../../shared/personal-office';
import { getForcedSurfaceState, isShellDemoMode } from './featureFlags';
import type { WorkSnapshot } from './types';
import {
  EMPTY_WORK_DATA,
  buildWorkSnapshot,
  resolveDataSource,
  type WorkData,
  type WorkDataSource,
} from './workAdapter';

/** Track connectivity so the offline state is real, not simulated. */
function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = (): void => setIsOnline(true);
    const goOffline = (): void => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return isOnline;
}

export interface UseWorkSnapshotResult {
  readonly snapshot: WorkSnapshot;
  readonly isDelegating: boolean;
  retry: () => void;
  delegate: (goal: string, workspaceId?: WorkspaceInstanceId) => Promise<boolean>;
}

export function useWorkSnapshot(): UseWorkSnapshotResult {
  const isOnline = useOnlineStatus();
  const forced = getForcedSurfaceState();
  const isDemo = isShellDemoMode();

  const sourceRef = useRef<WorkDataSource | null>(null);
  if (sourceRef.current === null) {
    sourceRef.current = resolveDataSource(isDemo);
  }

  const [data, setData] = useState<WorkData>(EMPTY_WORK_DATA);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [isDelegating, setIsDelegating] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const source = sourceRef.current;
    if (!source) return undefined;

    setIsLoading(true);
    setErrorMessage(undefined);

    source
      .load()
      .then((loaded) => {
        if (!cancelled) setData(loaded);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : 'Could not load your work.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const retry = useCallback(() => {
    setReloadToken((token) => token + 1);
  }, []);

  const delegate = useCallback(
    async (goal: string, workspaceId?: WorkspaceInstanceId): Promise<boolean> => {
      const source = sourceRef.current;
      const trimmed = goal.trim();
      if (!source || trimmed.length === 0) return false;

      setIsDelegating(true);
      try {
        await source.delegate({
          goal: trimmed,
          workspaceId: workspaceId ?? (data.workspaces[0]?.id as WorkspaceInstanceId),
        });
        const reloaded = await source.load();
        setData(reloaded);
        return true;
      } catch (error: unknown) {
        setErrorMessage(error instanceof Error ? error.message : 'Could not delegate that goal.');
        return false;
      } finally {
        setIsDelegating(false);
      }
    },
    [data.workspaces],
  );

  const snapshot = useMemo<WorkSnapshot>(() => {
    const base = buildWorkSnapshot({
      data: forced === 'empty' ? EMPTY_WORK_DATA : data,
      isLoading: forced === 'loading' ? true : isLoading,
      isOffline: forced === 'offline' ? true : !isOnline,
      isDemo,
      errorMessage:
        forced === 'error' ? 'We could not reach your work engine.' : errorMessage,
      degradedReason:
        forced === 'degraded' ? 'Live progress is unavailable, so counts may lag.' : undefined,
    });
    return base;
  }, [data, errorMessage, forced, isDemo, isLoading, isOnline]);

  return { snapshot, isDelegating, retry, delegate };
}
