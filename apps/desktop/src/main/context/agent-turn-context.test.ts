import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PERSONAL_OFFICE_SCHEMA_VERSION,
} from '../../shared/personal-office';
import { LiveProfileFileService } from '../live/live-profile-service';
import type { UpsertContextSnapshotInput } from '../work/run-repository';
import type {
  WorkContextSnapshot,
  Workspace,
} from '../work/work-types';
import { appendCompiledContextToSystemPrompt } from './prompt-kernel';
import {
  PersonalOfficeAgentContextRuntime,
  personalOfficeLiveProfileRoot,
} from './agent-turn-context';

const at = '2026-07-29T12:00:00.000Z';
const scope = { workspaceId: 'personal', ownerId: 'rv-owner-hash' };
const safety = 'Trusted host safety prompt.';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })));
});

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'izzi-agent-context-'));
  roots.push(value);
  return value;
}

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'personal',
    name: 'Local workspace',
    kind: 'personal',
    schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function snapshotWriter() {
  const rows: UpsertContextSnapshotInput[] = [];
  return {
    rows,
    writer: {
      upsertContextSnapshot: vi.fn((input: UpsertContextSnapshotInput): WorkContextSnapshot => {
        rows.push(input);
        return {
          ...input,
          schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
          createdAt: at,
          updatedAt: at,
        };
      }),
    },
  };
}

function runtime(
  baseRoot: string,
  writer: ReturnType<typeof snapshotWriter>['writer'],
  resolveWorkspace: (workspaceId: string) => Workspace | null =
    (workspaceId) => workspaceId === 'personal' ? workspace() : null,
) {
  return new PersonalOfficeAgentContextRuntime({
    rootDir: baseRoot,
    resolveWorkspace,
    snapshotWriter: writer,
    now: () => new Date(at),
  });
}

describe('PersonalOfficeAgentContextRuntime', () => {
  it('initializes an exact scoped Live.md and captures metadata-only context evidence', async () => {
    const baseRoot = await root();
    const snapshots = snapshotWriter();
    const prepared = await runtime(baseRoot, snapshots.writer).prepare({
      scope,
      safetySystemPrompt: safety,
      rawRequest: 'Prepare the release brief. ',
    });

    expect(prepared.liveProfile).toMatchObject({
      scope,
      classification: 'personal_graph',
      revision: 1,
      documentRef: 'Live.md',
    });
    expect(prepared.context.compiled.items.map((item) => item.layer)).toEqual([
      'safety-system',
      'current-user-request',
      'workspace-policy',
    ]);
    expect(() => appendCompiledContextToSystemPrompt(
      safety,
      'Prepare the release brief. ',
      prepared.context,
    )).not.toThrow();
    expect(() => appendCompiledContextToSystemPrompt(
      safety,
      'Prepare the release brief.',
      prepared.context,
    )).toThrow(/current user request/i);

    expect(snapshots.rows).toHaveLength(1);
    expect(snapshots.rows[0]).toMatchObject({
      workspaceId: scope.workspaceId,
      contentHash: prepared.context.compiled.contentHash,
      source: 'personal-office-context-kernel',
    });
    expect(JSON.stringify(snapshots.rows[0])).not.toContain('release brief');
    expect(JSON.stringify(snapshots.rows[0])).not.toContain(safety);

    const scopedRoot = personalOfficeLiveProfileRoot(baseRoot, scope);
    expect(scopedRoot).not.toContain(scope.ownerId);
    const persisted = await new LiveProfileFileService({
      rootDir: scopedRoot,
      scope,
    }).read();
    expect(persisted).toEqual(prepared.liveProfile);
  });

  it('loads effective Live.md directives into the accepted precedence', async () => {
    const baseRoot = await root();
    const scopedRoot = personalOfficeLiveProfileRoot(baseRoot, scope);
    const profile = new LiveProfileFileService({ rootDir: scopedRoot, scope });
    const initial = await profile.initialize({
      now: at,
      classification: 'personal_graph',
    });
    await profile.applyUserDirective({
      expectedRevision: initial.revision,
      actor: { kind: 'user', id: scope.ownerId },
      id: 'tone',
      kind: 'preference',
      key: 'tone',
      value: 'concise',
      now: at,
    });

    const snapshots = snapshotWriter();
    const prepared = await runtime(baseRoot, snapshots.writer).prepare({
      scope,
      safetySystemPrompt: safety,
      rawRequest: 'Draft the update.',
    });

    expect(prepared.context.compiled.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        layer: 'global-live-profile',
        content: 'preference:tone=concise',
      }),
    ]));
  });

  it('rejects a foreign-scope Live.md before snapshot capture', async () => {
    const baseRoot = await root();
    const targetRoot = personalOfficeLiveProfileRoot(baseRoot, scope);
    const foreignScope = { workspaceId: 'personal', ownerId: 'rv-other-owner' };
    await new LiveProfileFileService({
      rootDir: targetRoot,
      scope: foreignScope,
    }).initialize({ now: at, classification: 'personal_graph' });
    const snapshots = snapshotWriter();

    await expect(runtime(baseRoot, snapshots.writer).prepare({
      scope,
      safetySystemPrompt: safety,
      rawRequest: 'Draft the update.',
    })).rejects.toThrow(/does not belong to the requested workspace and owner/i);
    expect(snapshots.writer.upsertContextSnapshot).not.toHaveBeenCalled();
  });

  it('rejects local-files egress before snapshot capture', async () => {
    const baseRoot = await root();
    await new LiveProfileFileService({
      rootDir: personalOfficeLiveProfileRoot(baseRoot, scope),
      scope,
    }).initialize({ now: at, classification: 'local_files' });
    const snapshots = snapshotWriter();

    await expect(runtime(baseRoot, snapshots.writer).prepare({
      scope,
      safetySystemPrompt: safety,
      rawRequest: 'Draft the update.',
    })).rejects.toThrow(/cannot enter model context/i);
    expect(snapshots.writer.upsertContextSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a missing or non-personal workspace before touching Live.md', async () => {
    const baseRoot = await root();
    const snapshots = snapshotWriter();
    const missing = runtime(baseRoot, snapshots.writer, () => null);
    const tenant = runtime(
      baseRoot,
      snapshots.writer,
      () => workspace({ kind: 'customer' }),
    );

    await expect(missing.prepare({
      scope,
      safetySystemPrompt: safety,
      rawRequest: 'Draft the update.',
    })).rejects.toThrow(/workspace is unavailable/i);
    await expect(tenant.prepare({
      scope,
      safetySystemPrompt: safety,
      rawRequest: 'Draft the update.',
    })).rejects.toThrow(/workspace is unavailable/i);
    expect(snapshots.writer.upsertContextSnapshot).not.toHaveBeenCalled();
  });

  it('guards abort and steering IPC before active-turn input use', async () => {
    const source = await readFile(
      join(process.cwd(), 'src', 'main', 'index.ts'),
      'utf8',
    );
    const abortStart = source.indexOf("ipcMain.handle('customProvider:abort'");
    const injectStart = source.indexOf("ipcMain.handle('customProvider:inject'");
    expect(abortStart).toBeGreaterThanOrEqual(0);
    expect(injectStart).toBeGreaterThan(abortStart);

    const abortHandler = source.slice(abortStart, injectStart);
    expect(abortHandler.indexOf('isTrustedMarketingSender(event)')).toBeGreaterThanOrEqual(0);
    expect(abortHandler.indexOf('isTrustedMarketingSender(event)')).toBeLessThan(
      abortHandler.indexOf('activeAgentTurns.get(turnId)'),
    );

    const injectHandler = source.slice(injectStart);
    expect(injectHandler.indexOf('isTrustedMarketingSender(event)')).toBeGreaterThanOrEqual(0);
    expect(injectHandler.indexOf('isTrustedMarketingSender(event)')).toBeLessThan(
      injectHandler.indexOf('activeAgentTurns.get(turnId)'),
    );
    expect(injectHandler.indexOf('isTrustedMarketingSender(event)')).toBeLessThan(
      injectHandler.indexOf('text.trim()'),
    );
  });
});
