/**
 * Personal Office shell — work data adapter.
 *
 * This is the ONE seam between the shell and the execution engine.
 *
 * W3 (Loop 03) owns `main/work/**` and the preload surface that will expose it.
 * That surface does not exist yet, and this loop may not touch `preload.ts`, so
 * the shell talks to a `WorkDataSource` interface and ships a fake in-memory
 * implementation behind the shell flag. When W3 lands, exactly one function
 * changes — `resolveDataSource()` — and no component or view model moves.
 *
 * Everything here projects W1's FROZEN contract types into the shell's read
 * models. It never redefines a domain entity and never mutates one.
 *
 * @module renderer/shell/workAdapter
 */

import {
  asId,
  newId,
  type Approval,
  type Artifact,
  type ArtifactId,
  type RunState,
  type WorkRun,
  type WorkRunId,
  type WorkStep,
  type WorkspaceInstance,
  type WorkspaceInstanceId,
  PERSONAL_OFFICE_SCHEMA_VERSION,
} from '../../shared/personal-office';
import {
  laneForRunState,
  type DeliverableView,
  type SurfaceStatus,
  type WorkItemView,
  type WorkSnapshot,
  type WorkspaceView,
} from './types';

/** Raw data one poll of the work engine returns. */
export interface WorkData {
  readonly workspaces: readonly WorkspaceInstance[];
  readonly runs: readonly WorkRun[];
  readonly steps: readonly WorkStep[];
  readonly artifacts: readonly Artifact[];
  readonly approvals: readonly Approval[];
}

/**
 * The seam. W3's preload-backed implementation must satisfy exactly this.
 *
 * `isReal` distinguishes a genuine engine from the fake, so the UI can badge
 * demo data honestly instead of passing fabricated runs off as real work.
 */
export interface WorkDataSource {
  readonly isReal: boolean;
  load(): Promise<WorkData>;
  delegate(input: { goal: string; workspaceId: WorkspaceInstanceId }): Promise<void>;
}

/* ─────────────────────────── redaction ─────────────────────────── */

const SECRET_SHAPED = /\b(?:sk|pk|izzi|ghp|gho|xox[abpsr])[-_][A-Za-z0-9_-]{8,}\b/gi;
const BEARER_SHAPED = /\b(?:bearer|token|api[-_]?key|password|secret)\b\s*[:=]?\s*\S+/gi;
const WINDOWS_PATH = /\b[A-Za-z]:[\\/][^\s"']*/g;
const POSIX_PATH = /(?:^|\s)(?:\/[^\s/"']+){2,}\/?/g;
const MAX_MESSAGE = 160;

/**
 * Reduce any engine-supplied string to something safe to render.
 *
 * Strips secret-shaped tokens and filesystem paths, collapses to one line, and
 * caps the length. Belt-and-braces: producers are supposed to redact, but the
 * shell cannot verify that, and a leaked token in a toast is unrecoverable.
 */
export function toSafeMessage(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const cleaned = raw
    .replace(SECRET_SHAPED, '[redacted]')
    .replace(BEARER_SHAPED, '[redacted]')
    .replace(WINDOWS_PATH, '[path]')
    .replace(POSIX_PATH, ' [path]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return undefined;
  return cleaned.length > MAX_MESSAGE ? `${cleaned.slice(0, MAX_MESSAGE - 1)}…` : cleaned;
}

/**
 * Basename of an artifact pointer.
 *
 * `Artifact.localRef` is an absolute local pointer. It must never reach the UI
 * intact: a screenshot of a primary surface would leak the operator's directory
 * layout. Only the final segment is ever shown.
 */
export function toFileLabel(name: string, localRef?: string): string {
  const source = name || localRef || '';
  const segments = source.split(/[\\/]/);
  const last = segments[segments.length - 1] ?? '';
  return last || 'untitled';
}

/* ─────────────────────────── projection ─────────────────────────── */

function stepProgress(
  runId: WorkRunId,
  steps: readonly WorkStep[],
): { done: number; total: number } | undefined {
  const mine = steps.filter((step) => step.runId === runId);
  if (mine.length === 0) return undefined;
  return { done: mine.filter((step) => step.status === 'done').length, total: mine.length };
}

function toWorkItem(
  run: WorkRun,
  workspaceName: string,
  steps: readonly WorkStep[],
): WorkItemView {
  const lane = laneForRunState(run.state);
  return {
    id: run.id,
    workspaceId: run.workspaceInstanceId,
    workspaceName,
    goal: run.goal,
    state: run.state,
    lane,
    updatedAt: run.updatedAt,
    progress: stepProgress(run.id, steps),
    detail: toSafeMessage(run.pausedReason ?? run.canceledReason),
    failureSummary: lane === 'attention' ? toSafeMessage(run.legacyStatusRaw) ?? 'Run failed' : undefined,
  };
}

function toDeliverable(artifact: Artifact): DeliverableView {
  return {
    id: artifact.id,
    runId: artifact.runId,
    name: artifact.name,
    fileLabel: toFileLabel(artifact.name, artifact.localRef),
    mimeType: artifact.mimeType,
    sizeBytes: artifact.sizeBytes,
    createdAt: artifact.createdAt,
  };
}

/** Resolve which of the six presentation states a surface is in. */
export function resolveStatus(input: {
  isLoading: boolean;
  isOffline: boolean;
  errorMessage?: string;
  degradedReason?: string;
  isEmpty: boolean;
}): SurfaceStatus {
  if (input.isLoading) return 'loading';
  if (input.errorMessage) return 'error';
  if (input.isOffline) return 'offline';
  if (input.degradedReason) return 'degraded';
  if (input.isEmpty) return 'empty';
  return 'ready';
}

export interface BuildSnapshotInput {
  readonly data: WorkData;
  readonly isLoading: boolean;
  readonly isOffline: boolean;
  readonly isDemo: boolean;
  readonly errorMessage?: string;
  readonly degradedReason?: string;
}

/** Project raw engine data into the single snapshot the shell renders. */
export function buildWorkSnapshot(input: BuildSnapshotInput): WorkSnapshot {
  const { data } = input;
  const nameById = new Map<WorkspaceInstanceId, string>(
    data.workspaces.map((workspace) => [workspace.id, workspace.displayName]),
  );

  const items = data.runs.map((run) =>
    toWorkItem(run, nameById.get(run.workspaceInstanceId) ?? 'Workspace', data.steps),
  );
  const inLane = (lane: string): WorkItemView[] => items.filter((item) => item.lane === lane);

  const active = inLane('active');
  const needsMe = inLane('needs_me');
  const delivered = inLane('delivered');
  const attention = inLane('attention');

  const workspaces: WorkspaceView[] = data.workspaces.map((workspace) => {
    const mine = (list: readonly WorkItemView[]): number =>
      list.filter((item) => item.workspaceId === workspace.id).length;
    return {
      id: workspace.id,
      name: workspace.displayName,
      isReady: workspace.provisioning === 'ready',
      isFavorite: false,
      activeCount: mine(active),
      needsMeCount: mine(needsMe),
      deliveredCount: mine(delivered),
    };
  });

  const isEmpty = items.length === 0 && data.workspaces.length === 0;

  return {
    status: resolveStatus({
      isLoading: input.isLoading,
      isOffline: input.isOffline,
      errorMessage: input.errorMessage,
      degradedReason: input.degradedReason,
      isEmpty,
    }),
    isDemo: input.isDemo,
    isOffline: input.isOffline,
    errorMessage: toSafeMessage(input.errorMessage),
    degradedReason: input.degradedReason,
    workspaces,
    active,
    needsMe,
    delivered,
    attention,
    approvals: data.approvals,
    deliverables: data.artifacts.map(toDeliverable),
  };
}

export const EMPTY_WORK_DATA: WorkData = Object.freeze({
  workspaces: Object.freeze([]) as readonly WorkspaceInstance[],
  runs: Object.freeze([]) as readonly WorkRun[],
  steps: Object.freeze([]) as readonly WorkStep[],
  artifacts: Object.freeze([]) as readonly Artifact[],
  approvals: Object.freeze([]) as readonly Approval[],
});

/* ─────────────────────── fake in-memory source ─────────────────────── */

const FAKE_WORKSPACE_ID = asId<'WorkspaceInstanceId'>('wsi_demo_personal');
const FAKE_BLUEPRINT_ID = asId<'WorkspaceBlueprintId'>('wbp_demo_personal');
const FAKE_OWNER_ID = asId<'OwnerId'>('own_demo');

function stamp(minutesAgo: number): string {
  return new Date(Date.now() - minutesAgo * 60_000).toISOString();
}

function fakeWorkspace(
  id: WorkspaceInstanceId,
  displayName: string,
  minutesAgo: number,
): WorkspaceInstance {
  return {
    schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
    id,
    blueprintId: FAKE_BLUEPRINT_ID,
    ownerId: FAKE_OWNER_ID,
    displayName,
    state: 'active',
    provisioning: 'ready',
    createdAt: stamp(minutesAgo + 600),
    updatedAt: stamp(minutesAgo),
  };
}

function fakeRun(
  id: string,
  workspaceInstanceId: WorkspaceInstanceId,
  goal: string,
  state: RunState,
  minutesAgo: number,
): WorkRun {
  const runId = asId<'WorkRunId'>(id);
  return {
    schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
    id: runId,
    workspaceInstanceId,
    goal,
    state,
    origin: 'manual',
    rootRunId: runId,
    lineageKind: 'original',
    attempt: 1,
    planVersion: 1,
    planHash: 'demo-plan-hash',
    appliedEventSequence: 4,
    createdAt: stamp(minutesAgo + 30),
    updatedAt: stamp(minutesAgo),
  };
}

function fakeStep(
  id: string,
  runId: WorkRunId,
  title: string,
  status: WorkStep['status'],
  ordinal: number,
): WorkStep {
  return {
    schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
    id: asId<'WorkStepId'>(id),
    runId,
    title,
    status,
    ordinal,
    requiresApproval: false,
    createdAt: stamp(60),
    updatedAt: stamp(5),
  };
}

/**
 * Demo data for screenshots and the interaction-state matrix.
 *
 * Every field is obviously fabricated: no real customer names, no real paths, no
 * secret-shaped strings. `isReal` is false, so the UI badges it as demo.
 */
export function createFakeWorkData(): WorkData {
  const second = asId<'WorkspaceInstanceId'>('wsi_demo_research');
  const runActive = fakeRun('wr_demo_1', FAKE_WORKSPACE_ID, 'Draft the Q3 launch announcement', 'running', 4);
  const runQueued = fakeRun('wr_demo_2', FAKE_WORKSPACE_ID, 'Summarise last week of support tickets', 'queued', 18);
  const runApproval = fakeRun('wr_demo_3', FAKE_WORKSPACE_ID, 'Publish the pricing page update', 'awaiting_approval', 9);
  const runExternal = fakeRun('wr_demo_4', second, 'Sync the research vault to the graph', 'waiting_external', 26);
  const runDone = fakeRun('wr_demo_5', FAKE_WORKSPACE_ID, 'Compile the competitor briefing', 'completed', 92);
  const runFailed = fakeRun('wr_demo_6', second, 'Refresh the analytics snapshot', 'failed', 140);

  const approval: Approval = {
    schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
    id: asId<'ApprovalId'>('apr_demo_1'),
    runId: runApproval.id,
    title: 'Publish pricing page update',
    summary: 'Replaces the current pricing table and pushes the page live.',
    risk: 'medium',
    state: 'requested',
    actionHash: 'demo-action-hash',
    binding: {
      target: 'izziapi.com / pricing (demo account)',
      input: null,
      artifactId: null,
      artifactVersion: null,
      estimatedSideEffect: 'Updates one public page. Reversible by re-publishing the previous version.',
      idempotencyKey: 'demo-idempotency-key',
      expiresAt: stamp(-120),
      planHash: 'demo-plan-hash',
      contextSnapshotId: null,
    },
    expiresAt: stamp(-120),
    createdAt: stamp(9),
    updatedAt: stamp(9),
  };

  const artifact: Artifact = {
    schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
    id: asId<'ArtifactId'>('art_demo_1'),
    runId: runDone.id,
    name: 'competitor-briefing.md',
    mimeType: 'text/markdown',
    sha256: 'demo-digest',
    sizeBytes: 18_420,
    localRef: 'competitor-briefing.md',
    classification: 'artifacts',
    createdAt: stamp(92),
    updatedAt: stamp(92),
  };

  return {
    workspaces: [
      fakeWorkspace(FAKE_WORKSPACE_ID, 'Personal office', 4),
      fakeWorkspace(second, 'Research', 26),
    ],
    runs: [runActive, runQueued, runApproval, runExternal, runDone, runFailed],
    steps: [
      fakeStep('wst_demo_1', runActive.id, 'Gather the release notes', 'done', 0),
      fakeStep('wst_demo_2', runActive.id, 'Draft the announcement', 'in_progress', 1),
      fakeStep('wst_demo_3', runActive.id, 'Check the claims', 'todo', 2),
    ],
    artifacts: [artifact],
    approvals: [approval],
  };
}

/**
 * In-memory source used until W3's preload surface lands.
 *
 * Deliberately dumb: it holds data in a closure, so a delegate shows up
 * immediately and the shell's happy path is exercisable end to end without an
 * engine. It is not a mock of engine *behaviour* — it does not advance states.
 */
export function createFakeDataSource(seed: WorkData = createFakeWorkData()): WorkDataSource {
  let data: WorkData = seed;
  return {
    isReal: false,
    load: () => Promise.resolve(data),
    delegate: ({ goal, workspaceId }) => {
      const run = fakeRun(newId<'WorkRunId'>('wr'), workspaceId, goal, 'queued', 0);
      data = { ...data, runs: [run, ...data.runs] };
      return Promise.resolve();
    },
  };
}

/** A source that reports nothing, for the honest first-run empty state. */
export function createEmptyDataSource(): WorkDataSource {
  return {
    isReal: false,
    load: () => Promise.resolve(EMPTY_WORK_DATA),
    delegate: () => Promise.resolve(),
  };
}

/**
 * The single line W3 changes.
 *
 * When the preload work API exists, this returns the real source and the fake
 * becomes demo-only. Until then the shell is honest about being unwired: the
 * default is the EMPTY source, so a first run shows a true empty state rather
 * than fabricated runs. Demo data is opt-in via the shell demo flag.
 */
export function resolveDataSource(isDemo: boolean): WorkDataSource {
  return isDemo ? createFakeDataSource() : createEmptyDataSource();
}

/** Placeholder workspace id used by the composer until a real one exists. */
export const FALLBACK_WORKSPACE_ID: WorkspaceInstanceId = FAKE_WORKSPACE_ID;

/** Type-only re-export so components need not reach into the contract barrel. */
export type { ArtifactId, WorkRunId };
