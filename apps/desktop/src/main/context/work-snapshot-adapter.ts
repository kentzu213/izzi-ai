import {
  PERSONAL_OFFICE_SCHEMA_VERSION,
  canonicalJson,
} from '../../shared/personal-office';
import type {
  CompiledWorkspaceContext,
  ContextKernelInput,
} from '../../shared/context';
import type {
  UpsertContextSnapshotInput,
} from '../work/run-repository';
import type { WorkContextSnapshot } from '../work/work-types';
import { sha256Hex } from '../work/work-hash';
import { ContextCompilationError } from './context-error';
import { verifyCompiledWorkspaceContext } from './prompt-kernel';

const SNAPSHOT_SOURCE = 'personal-office-context-kernel';

export interface ContextSnapshotWriter {
  upsertContextSnapshot(input: UpsertContextSnapshotInput): WorkContextSnapshot;
}

export interface CaptureCompiledContextInput extends ContextKernelInput {
  readonly runId?: string;
}

function snapshotIdFor(
  compiled: CompiledWorkspaceContext,
  runId: string | undefined,
): string {
  return `ctx-${sha256Hex(
    canonicalJson({
      artifactKind: compiled.artifactKind,
      contentHash: compiled.contentHash,
      ownerId: compiled.scope.ownerId,
      runId: runId ?? null,
      workspaceId: compiled.scope.workspaceId,
    }),
  ).slice(0, 32)}`;
}

export class WorkContextSnapshotAdapter {
  constructor(private readonly writer: ContextSnapshotWriter) {}

  capture(input: CaptureCompiledContextInput): WorkContextSnapshot {
    verifyCompiledWorkspaceContext(input.compiled);
    if (
      input.scope.workspaceId !== input.compiled.scope.workspaceId ||
      input.scope.ownerId !== input.compiled.scope.ownerId
    ) {
      throw new ContextCompilationError(
        'scope-mismatch',
        'Snapshot scope does not match the compiled workspace and owner.',
      );
    }
    const id = snapshotIdFor(input.compiled, input.runId);
    const summary = `Personal Office context: ${input.compiled.budget.usedItems} system items, ${input.compiled.budget.usedBytes} bytes`;
    const ref = `personal-office-context:${input.compiled.contentHash}`;
    const snapshot = this.writer.upsertContextSnapshot({
      id,
      workspaceId: input.scope.workspaceId,
      ...(input.runId === undefined ? {} : { runId: input.runId }),
      contentHash: input.compiled.contentHash,
      source: SNAPSHOT_SOURCE,
      summary,
      ref,
    });
    if (
      snapshot.id !== id ||
      snapshot.workspaceId !== input.scope.workspaceId ||
      snapshot.runId !== input.runId ||
      snapshot.contentHash !== input.compiled.contentHash ||
      snapshot.source !== SNAPSHOT_SOURCE ||
      snapshot.summary !== summary ||
      snapshot.ref !== ref ||
      snapshot.schemaVersion !== PERSONAL_OFFICE_SCHEMA_VERSION
    ) {
      throw new ContextCompilationError(
        'snapshot-authority-mismatch',
        'Work Engine returned a mismatched context snapshot.',
      );
    }
    return snapshot;
  }
}
