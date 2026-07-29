import { describe, expect, it, vi } from 'vitest';
import { PERSONAL_OFFICE_SCHEMA_VERSION } from '../../shared/personal-office';
import type { ContextSourceInput } from '../../shared/context';
import { compileWorkspaceContext } from './compiler';
import { WorkContextSnapshotAdapter } from './work-snapshot-adapter';

const scope = { workspaceId: 'workspace-7', ownerId: 'owner-7' };
const compiledAt = '2026-07-29T10:00:00.000Z';

function compiled() {
  const sources: ContextSourceInput[] = [
    {
      id: 'safety',
      layer: 'safety-system',
      role: 'system',
      scope,
      classification: 'public_metadata',
      content: 'Base safety.',
      provenance: { sourceType: 'base-system', sourceId: 'host' },
    },
    {
      id: 'request',
      layer: 'current-user-request',
      role: 'user',
      scope,
      classification: 'personal_graph',
      content: 'Do the work.',
      provenance: { sourceType: 'current-request', sourceId: 'turn-1' },
    },
  ];
  return compileWorkspaceContext({
    schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
    scope,
    compiledAt,
    budget: { maxItems: 10, maxBytes: 4_000 },
    sources,
  });
}

describe('WorkContextSnapshotAdapter', () => {
  it('stores only deterministic metadata through the Work Engine snapshot API', () => {
    const writer = {
      upsertContextSnapshot: vi.fn((input) => ({
        id: input.id,
        workspaceId: input.workspaceId,
        ...(input.runId ? { runId: input.runId } : {}),
        contentHash: input.contentHash,
        source: input.source,
        ...(input.summary ? { summary: input.summary } : {}),
        ...(input.ref ? { ref: input.ref } : {}),
        schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
        createdAt: compiledAt,
        updatedAt: compiledAt,
      })),
    };
    const adapter = new WorkContextSnapshotAdapter(writer);
    const value = compiled();
    const first = adapter.capture({ scope, compiled: value, runId: 'run-7' });
    const second = adapter.capture({ scope, compiled: value, runId: 'run-7' });
    const otherRun = adapter.capture({ scope, compiled: value, runId: 'run-8' });

    expect(first.id).toBe(second.id);
    expect(otherRun.id).not.toBe(first.id);
    expect(first.contentHash).toBe(value.contentHash);
    expect(writer.upsertContextSnapshot).toHaveBeenCalledTimes(3);
    const stored = writer.upsertContextSnapshot.mock.calls[0][0];
    expect(stored).not.toHaveProperty('body');
    expect(JSON.stringify(stored)).not.toContain('Base safety.');
    expect(JSON.stringify(stored)).not.toContain('Do the work.');
  });

  it('fails closed before storage when owner or workspace scope differs', () => {
    const writer = { upsertContextSnapshot: vi.fn() };
    const adapter = new WorkContextSnapshotAdapter(writer);
    expect(() =>
      adapter.capture({
        scope: { workspaceId: scope.workspaceId, ownerId: 'other-owner' },
        compiled: compiled(),
      }),
    ).toThrow(/scope does not match/i);
    expect(writer.upsertContextSnapshot).not.toHaveBeenCalled();
  });

  it('rejects a Work Engine response bound to different snapshot metadata', () => {
    const writer = {
      upsertContextSnapshot: vi.fn((input) => ({
        id: input.id,
        workspaceId: input.workspaceId,
        runId: 'other-run',
        contentHash: input.contentHash,
        source: input.source,
        summary: input.summary,
        ref: input.ref,
        schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
        createdAt: compiledAt,
        updatedAt: compiledAt,
      })),
    };
    const adapter = new WorkContextSnapshotAdapter(writer);

    expect(() =>
      adapter.capture({ scope, compiled: compiled(), runId: 'run-7' }),
    ).toThrow(/mismatched context snapshot/i);
  });
});
