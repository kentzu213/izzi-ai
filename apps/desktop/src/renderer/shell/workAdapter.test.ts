import { describe, expect, it, vi } from 'vitest';
import type { WorkPreloadApi } from '../../main/work/work-preload-api';
import type { WorkRunBundle } from '../../main/work/work-service';
import {
  PERSONAL_OFFICE_SCHEMA_VERSION,
  type WorkApproval,
  type WorkArtifact,
  type WorkEvent,
  type WorkRun,
  type WorkStep,
  type Workspace,
} from '../../main/work/work-types';
import {
  buildWorkSnapshot,
  createPreloadWorkDataSource,
  createUnavailableDataSource,
} from './workAdapter';

const workspace: Workspace = {
  id: 'personal',
  name: 'Local workspace',
  kind: 'personal',
  schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:00:00.000Z',
};

const run: WorkRun = {
  id: 'run-1',
  workspaceId: workspace.id,
  title: 'Prepare the briefing',
  brief: 'Prepare the briefing from the approved notes.',
  state: 'created',
  origin: 'manual',
  planVersion: 1,
  planHash: 'plan-hash',
  rootRunId: 'run-1',
  lineageKind: 'original',
  attempt: 1,
  schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:01:00.000Z',
};

const step: WorkStep = {
  id: 'step-1',
  runId: run.id,
  workspaceId: workspace.id,
  seq: 1,
  key: 'draft',
  kind: 'plan',
  label: 'Draft the briefing',
  status: 'running',
  schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
  createdAt: '2026-07-29T00:00:00.000Z',
  updatedAt: '2026-07-29T00:01:00.000Z',
};

const artifact: WorkArtifact = {
  id: 'artifact-1',
  runId: run.id,
  workspaceId: workspace.id,
  name: 'briefing.md',
  kind: 'document_draft',
  mediaType: 'text/markdown',
  version: 1,
  sha256: 'digest',
  sizeBytes: 120,
  externalPath: 'C:\\Users\\operator\\private\\briefing.md',
  schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
  createdAt: '2026-07-29T00:02:00.000Z',
  updatedAt: '2026-07-29T00:02:00.000Z',
};

const approval: WorkApproval = {
  id: 'approval-1',
  runId: run.id,
  workspaceId: workspace.id,
  kind: 'external_publish',
  title: 'Publish briefing',
  summary: 'Publish the reviewed briefing.',
  risk: 'medium',
  status: 'pending',
  actionHash: 'action-hash',
  binding: {
    target: 'internal portal',
    input: { document: 'briefing.md' },
    artifactId: null,
    artifactVersion: null,
    estimatedSideEffect: 'Creates one internal page.',
    idempotencyKey: 'approval-1',
    expiresAt: '2026-07-30T00:00:00.000Z',
    planHash: run.planHash,
    contextSnapshotId: null,
  },
  expiresAt: '2026-07-30T00:00:00.000Z',
  schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
  createdAt: '2026-07-29T00:03:00.000Z',
  updatedAt: '2026-07-29T00:03:00.000Z',
};

const bundle: WorkRunBundle = {
  run,
  steps: [step],
  artifacts: [artifact],
  approvals: [approval],
  checkpoint: null,
};

function createApi(overrides: Partial<WorkPreloadApi> = {}): WorkPreloadApi {
  return {
    listWorkspaces: vi.fn(async () => [workspace]),
    listRuns: vi.fn(async () => [run]),
    getRun: vi.fn(async () => bundle),
    listEvents: vi.fn(async () => []),
    listEventsSince: vi.fn(async () => []),
    latestEventSeq: vi.fn(async () => 0),
    listLineage: vi.fn(async () => [run]),
    listPendingApprovals: vi.fn(async () => [approval]),
    createRun: vi.fn(async () => run),
    decideApproval: vi.fn(async () => ({
      ok: false as const,
      reason: 'invalid-request' as const,
    })),
    resume: vi.fn(async () => ({
      ok: false as const,
      reason: 'invalid-state' as const,
    })),
    onEvent: vi.fn(() => () => undefined),
    ...overrides,
  };
}

describe('preload Work datasource', () => {
  it('loads authorized engine rows into shell read models without exposing paths', async () => {
    const source = createPreloadWorkDataSource(createApi());
    const data = await source.load();
    const snapshot = buildWorkSnapshot({
      data,
      isLoading: false,
      isOffline: false,
      isDemo: false,
    });

    expect(source.isReal).toBe(true);
    expect(snapshot.workspaces).toEqual([
      expect.objectContaining({ id: 'personal', name: 'Local workspace', isReady: true }),
    ]);
    expect(snapshot.active).toEqual([
      expect.objectContaining({
        id: 'run-1',
        workspaceId: 'personal',
        goal: run.brief,
        progress: { done: 0, total: 1 },
      }),
    ]);
    expect(snapshot.deliverables).toEqual([
      expect.objectContaining({ fileLabel: 'briefing.md' }),
    ]);
    expect(JSON.stringify(data)).not.toContain('C:\\\\Users\\\\operator');
    expect(snapshot.approvals).toEqual([
      expect.objectContaining({ id: 'approval-1', state: 'requested' }),
    ]);
  });

  it('fails delegation when main declines the authorized create-run request', async () => {
    const source = createPreloadWorkDataSource(createApi({
      createRun: vi.fn(async () => null),
    }));

    await expect(source.delegate({
      goal: 'Do the work',
      workspaceId: 'personal' as never,
    })).rejects.toThrow('workspace is unavailable');
  });

  it('subscribes only after workspace discovery and removes listeners cleanly', async () => {
    let forwarded: ((event: WorkEvent) => void) | undefined;
    const remove = vi.fn();
    const api = createApi({
      onEvent: vi.fn((_workspaceId: string, listener: (event: WorkEvent) => void) => {
        forwarded = listener;
        return remove;
      }),
    });
    const source = createPreloadWorkDataSource(api);
    const listener = vi.fn();
    const unsubscribe = source.subscribe?.(listener);

    await source.load();
    expect(api.onEvent).toHaveBeenCalledWith('personal', expect.any(Function));

    forwarded?.({ workspaceId: 'personal' } as WorkEvent);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe?.();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('reports a missing Electron bridge as unavailable rather than empty', async () => {
    const source = createUnavailableDataSource();
    await expect(source.load()).rejects.toThrow('Work engine is unavailable');
    await expect(source.delegate({
      goal: 'Do the work',
      workspaceId: 'personal' as never,
    })).rejects.toThrow('Work engine is unavailable');
  });
});
