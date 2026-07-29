/**
 * Compatibility adapters — the transition layer (Loop 03).
 *
 * The unified model is the destination, but nothing legacy is rewritten to reach
 * it. Instead these adapters translate, one direction at a time:
 *
 * - `importLegacyAgentTask` / `importLegacyAgentRun` — a legacy row becomes a
 *   unified run, once. The unified id is derived from the legacy id, so calling
 *   the importer again resolves to the same run instead of a duplicate.
 * - `ingestAgentTurnEvent` — the live `AgentTurnEvent` stream from `host-agent`
 *   is mapped onto unified steps + output deltas as it happens.
 * - `importCustomerRun` — a Customer Marketing run/approval snapshot becomes a
 *   unified run with its approval gate bound to an action hash.
 * - `toLegacyRun` / `toLegacyTask` — read-back shims so `agentWorkspace` /
 *   `agentGateway` keep rendering during the transition.
 *
 * Every adapter routes writes through `WorkService`, so redaction, ordering,
 * idempotency and the state machine apply to adapted data exactly as they do to
 * native data. Adapters never touch SQL directly.
 *
 * @module main/work/work-adapters
 */
import type {
  AgentRun as LegacyAgentRun,
  AgentRunEntry as LegacyAgentRunEntry,
  AgentRunStatus as LegacyAgentRunStatus,
  AgentTask as LegacyAgentTask,
  AgentTaskStatus as LegacyAgentTaskStatus,
} from '../agent/types';
import type { AgentTurnEvent } from '../../shared/agent-turn-events';
import type {
  CustomerApproval,
  CustomerApprovalKind,
  CustomerRun,
  CustomerRunStatus,
} from '../../shared/customer-marketing-types';
import {
  DEFAULT_WORKSPACE_ID,
  type RunCanceledReason,
  type RunPauseReason,
  type WorkApprovalKind,
  type WorkApprovalRisk,
  type WorkRun,
  type WorkRunState,
  type WorkStepStatus,
} from './work-types';
import { deterministicWorkId } from './work-hash';
import type { WorkService } from './work-service';

// ── Legacy AgentTask → unified run ─────────────────────────────────────────

/**
 * A legacy task board item is a tiny single-step run.
 *
 * Ruling MAP-BLOCKED: a legacy `blocked` task is the host-agent marking itself
 * stuck, or a guardrail refusing to continue. Both are *recoverable* — the run
 * can be re-entered — so the target is `paused`, never `failed` (which would
 * fabricate a hard error) and never `awaiting_approval` (which would fabricate a
 * pending human gate that no legacy row actually contains).
 */
const LEGACY_TASK_STATE: Record<LegacyAgentTaskStatus, WorkRunState> = {
  todo: 'queued',
  in_progress: 'running',
  blocked: 'paused',
  done: 'completed',
};

const LEGACY_TASK_STEP_STATUS: Record<LegacyAgentTaskStatus, WorkStepStatus> = {
  todo: 'pending',
  in_progress: 'running',
  blocked: 'blocked',
  done: 'done',
};

export function importLegacyAgentTask(service: WorkService, task: LegacyAgentTask): WorkRun {
  const runId = deterministicWorkId('run-task', task.id);
  const run = service.createRun({
    id: runId,
    title: task.title,
    brief: task.summary ?? task.title,
    origin: 'agent_task',
    originRef: task.id,
    createdAt: task.createdAt,
    plan: [{ key: 'task', label: task.title, status: LEGACY_TASK_STEP_STATUS[task.status] }],
  });

  reconcileState(service, run, LEGACY_TASK_STATE[task.status]);
  service.recordStep({
    runId,
    key: 'task',
    label: task.title,
    status: LEGACY_TASK_STEP_STATUS[task.status],
    kind: 'plan',
    idempotencyKey: `legacy-task:${task.id}:${task.status}:${task.updatedAt}`,
  });
  return service.getRun(runId) ?? run;
}

// ── Legacy AgentRun (durable blackboard) → unified run ─────────────────────

/**
 * The conclusion an adapter reached about an archived legacy run, and the
 * evidence it reached it from. Returned rather than applied directly so the
 * reasoning is testable in isolation and recorded verbatim in the audit event.
 */
export interface ArchivedOutcome {
  state: Extract<WorkRunState, 'completed' | 'failed' | 'canceled'>;
  /** Set only when the terminal state was NOT derived from conclusive evidence. */
  canceledReason?: RunCanceledReason;
  /** True when entries proved the outcome; false when it had to fall back. */
  conclusive: boolean;
  /** Human-readable justification, recorded in the migration audit event. */
  evidence: string;
}

/** Entry text that proves a run finished its work. */
const COMPLETION_EVIDENCE = /\b(?:completed?|finished|delivered|shipped|done|succeeded)\b/i;
/** Entry text that proves a run ended in failure. */
const FAILURE_EVIDENCE = /\b(?:failed|failure|aborted|crashed|fatal|unrecoverable)\b/i;

/**
 * Derive the terminal state of an archived legacy run from its entries
 * (MAP-ARCHIVED ruling, as amended by W0).
 *
 * The amendment matters: W1 originally proposed defaulting `archived → completed`.
 * That fabricates SUCCESS, which is the more damaging of the two possible errors
 * here — a false `completed` tells the operator work was delivered when it may
 * never have finished, and it inflates any throughput reporting built on run
 * state. A false `canceled` only invites a harmless second look. So without
 * conclusive evidence this returns `canceled` + `legacy_archived_outcome_unknown`,
 * asserting only "stopped without completing", which is true of every
 * archived-incomplete run.
 *
 * `failed` is never fabricated either: it is returned only when an entry
 * explicitly evidences failure.
 */
export function deriveArchivedOutcome(entries: readonly LegacyAgentRunEntry[]): ArchivedOutcome {
  // Latest entries first: a later fact supersedes an earlier one.
  const ordered = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  for (const entry of ordered) {
    const text = entry.content ?? '';
    if (FAILURE_EVIDENCE.test(text)) {
      return {
        state: 'failed',
        conclusive: true,
        evidence: `entry ${entry.id} evidences failure`,
      };
    }
    if (COMPLETION_EVIDENCE.test(text)) {
      return {
        state: 'completed',
        conclusive: true,
        evidence: `entry ${entry.id} evidences completion`,
      };
    }
  }

  // An artifact alone is not proof of completion — a run can emit a draft and
  // still be abandoned — so it deliberately does NOT count as conclusive.
  return {
    state: 'canceled',
    canceledReason: 'legacy_archived_outcome_unknown',
    conclusive: false,
    evidence:
      entries.length === 0
        ? 'no entries available to determine the outcome'
        : `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} present but none conclusive`,
  };
}

/**
 * Non-archived legacy statuses. `blocked` maps to `paused`, NEVER to `failed`
 * and never to `awaiting_approval` (MAP-BLOCKED ruling).
 *
 * `host-agent` instructs the model to mark work blocked "if stuck", and the
 * action gate sets it on a guardrail hit. Both are recoverable
 * cannot-proceed-now conditions, which is `paused`. No legacy path treats
 * `blocked` as terminal, and none of them carries a pending human gate, so
 * `awaiting_approval` would invent a reviewer who was never asked.
 */
const LEGACY_RUN_STATE: Record<Exclude<LegacyAgentRunStatus, 'archived'>, WorkRunState> = {
  active: 'running',
  done: 'completed',
  blocked: 'paused',
};

export interface ImportLegacyAgentRunOptions {
  /**
   * Entries for this run, used to derive the terminal state of an archived run.
   * Injected rather than queried so the derivation is unit-testable without a
   * live legacy database, and so the caller controls how much history it reads.
   */
  entries?: readonly LegacyAgentRunEntry[];
}

export function importLegacyAgentRun(
  service: WorkService,
  legacy: LegacyAgentRun,
  options: ImportLegacyAgentRunOptions = {},
): WorkRun {
  const runId = deterministicWorkId('run-legacy', legacy.id);
  const run = service.createRun({
    id: runId,
    title: legacy.goal.slice(0, 120),
    brief: legacy.goal,
    origin: 'agent_run',
    originRef: legacy.id,
    createdAt: legacy.createdAt,
    plan: [{ key: `stage:${legacy.stage}`, label: `Stage: ${legacy.stage}`, status: 'running' }],
  });

  if (legacy.status !== 'archived') {
    // `blocked` is recorded as a bare `paused`. `RunPauseReason` is
    // 'stuck' | 'guardrail' and a legacy row says which of the two it was, so
    // setting either would be a guess; W0's ruling is explicit that "until it
    // exists, paused alone is correct". The raw status is preserved instead.
    reconcileState(service, run, LEGACY_RUN_STATE[legacy.status], {
      ...(legacy.status === 'blocked' ? { legacyStatusRaw: legacy.status } : {}),
    });
    return service.getRun(runId) ?? run;
  }

  const outcome = deriveArchivedOutcome(options.entries ?? []);
  reconcileState(service, run, outcome.state, {
    // The tombstone is always set, whatever the derived outcome.
    archivedAt: legacy.updatedAt,
    legacyStatusRaw: 'archived',
    ...(outcome.canceledReason ? { canceledReason: outcome.canceledReason } : {}),
  });

  // Exactly one audit event per imported record. The service derives the
  // idempotency key from `(legacySource, legacyId)` alone — not from the outcome —
  // so a second import cannot multiply the event even if the evidence changed in
  // between; the first conclusion stands and stays inspectable.
  service.recordMigrationAudit({
    runId,
    legacySource: 'agent_run',
    legacyId: legacy.id,
    legacyStatusRaw: 'archived',
    derivedState: outcome.state,
    evidence: outcome.conclusive ? 'conclusive' : 'inconclusive',
    evidenceNote: outcome.evidence,
  });

  return service.getRun(runId) ?? run;
}

// ── Live host-agent turn events → unified steps + deltas ───────────────────

/**
 * Fold one live `AgentTurnEvent` into a run. `turnId` scopes the idempotency
 * keys, so a re-delivered event over a flaky channel does not create a second
 * step or a duplicate delta. Delta ordering is preserved by a per-turn counter
 * the caller keeps in `TurnIngestState`.
 */
export interface TurnIngestState {
  deltaIndex: number;
}

export function createTurnIngestState(): TurnIngestState {
  return { deltaIndex: 0 };
}

export function ingestAgentTurnEvent(
  service: WorkService,
  runId: string,
  event: AgentTurnEvent,
  state: TurnIngestState,
): void {
  switch (event.kind) {
    case 'delta':
      if (!event.text) return;
      service.recordOutputDelta(runId, event.text, `${event.turnId}:delta:${state.deltaIndex++}`);
      return;
    case 'reasoning':
      if (!event.text) return;
      service.recordOutputDelta(
        runId,
        event.text,
        `${event.turnId}:reasoning:${state.deltaIndex++}`,
      );
      return;
    case 'step':
      service.recordStep({
        runId,
        key: event.step.id,
        label: event.step.label,
        status: mapAgentStepStatus(event.step.status),
        kind: event.step.kind === 'tool' ? 'tool' : 'progress',
        detail: event.step.detail,
        idempotencyKey: `${event.turnId}:step:${event.step.id}:${event.step.status}`,
      });
      return;
    case 'done':
      // The turn's terminal state is owned by the caller (it knows success vs
      // error vs abort); the event only marks the stream end.
      return;
  }
}

function mapAgentStepStatus(status: 'running' | 'done' | 'error'): WorkStepStatus {
  return status === 'running' ? 'running' : status === 'error' ? 'error' : 'done';
}

// ── Customer Marketing run/approval → unified run ──────────────────────────

/**
 * Customer Marketing statuses. Note `blocked` maps to `waiting_external`, NOT to
 * `awaiting_approval` or `failed` (MAP-BLOCKED ruling).
 *
 * The distinction is source semantics, not taste. This surface sets `blocked`
 * when an *external* dependency stops the run — a runtime that is not ready, a
 * media toolchain that is missing, an integration quota that is exhausted. That
 * is precisely `waiting_external`. It is NOT `awaiting_approval`, because this
 * status carries no pending human gate (`awaiting_approval` already exists
 * separately in the same enum for that), and it is NOT `failed`, because the
 * condition is recoverable once the dependency returns.
 */
const CUSTOMER_RUN_STATE: Record<CustomerRunStatus, WorkRunState> = {
  queued: 'queued',
  in_progress: 'running',
  awaiting_approval: 'awaiting_approval',
  ready: 'running',
  completed: 'completed',
  blocked: 'waiting_external',
};

const CUSTOMER_STEP_STATUS: Record<CustomerRun['steps'][number]['status'], WorkStepStatus> = {
  todo: 'pending',
  in_progress: 'running',
  done: 'done',
  blocked: 'blocked',
};

const CUSTOMER_APPROVAL_KIND: Record<CustomerApprovalKind, WorkApprovalKind> = {
  strategy: 'strategy',
  media_preview: 'media_render',
  media_render: 'media_render',
  media_publish: 'external_publish',
};

export interface ImportCustomerRunInput {
  run: CustomerRun;
  approvals?: CustomerApproval[];
  workspaceId?: string;
  /** External tenant id, recorded on the workspace for traceability. */
  workspaceExternalRef?: string;
}

export function importCustomerRun(service: WorkService, input: ImportCustomerRunInput): WorkRun {
  const workspaceId = input.workspaceId ?? DEFAULT_WORKSPACE_ID;
  if (workspaceId !== DEFAULT_WORKSPACE_ID) {
    service.ensureWorkspace({
      id: workspaceId,
      name: workspaceId,
      kind: 'customer',
      ...(input.workspaceExternalRef ? { externalRef: input.workspaceExternalRef } : {}),
    });
  }

  const runId = deterministicWorkId('run-cmr', workspaceId, input.run.id);
  const plan = input.run.steps.map((step) => ({
    key: step.id,
    label: step.label,
    status: CUSTOMER_STEP_STATUS[step.status],
  }));

  const run = service.createRun({
    id: runId,
    workspaceId,
    title: input.run.goal.slice(0, 120),
    brief: input.run.goal,
    origin: 'customer_marketing',
    originRef: input.run.id,
    createdAt: input.run.createdAt,
    plan,
  });

  for (const step of input.run.steps) {
    service.recordStep({
      runId,
      key: step.id,
      label: step.label,
      status: CUSTOMER_STEP_STATUS[step.status],
      kind: step.requiresApproval ? 'approval' : 'plan',
      idempotencyKey: `cmr-step:${input.run.id}:${step.id}:${step.status}`,
    });
  }

  reconcileState(service, run, CUSTOMER_RUN_STATE[input.run.status]);

  // A pending Customer Marketing approval becomes a unified gate. The evidence
  // digest, when present, is what the reviewer is really consenting to, so it is
  // the artifact-shaped input the action hash binds.
  for (const approval of input.approvals ?? []) {
    if (approval.runId !== input.run.id || approval.status !== 'pending') continue;
    const existing = service
      .listApprovals(runId)
      .find((item) => item.binding.idempotencyKey === `cmr-approval:${approval.id}`);
    if (existing) continue;

    service.requestApproval({
      runId,
      kind: approval.kind ? CUSTOMER_APPROVAL_KIND[approval.kind] : 'strategy',
      title: approval.title,
      summary: approval.summary,
      risk: mapCustomerRisk(approval.risk),
      target: `customer-marketing/${workspaceId}`,
      input: {
        approvalId: approval.id,
        evidenceDigest: approval.evidenceDigest ?? null,
        mediaJobId: approval.mediaJobId ?? null,
      },
      estimatedSideEffect:
        approval.kind === 'media_publish'
          ? 'Publish marketing content to a customer channel'
          : 'Advance the marketing workflow past this gate',
      idempotencyKey: `cmr-approval:${approval.id}`,
      blockRun: false,
    });
  }

  return service.getRun(runId) ?? run;
}

function mapCustomerRisk(risk: CustomerApproval['risk']): WorkApprovalRisk {
  return risk === 'high' ? 'high' : risk === 'medium' ? 'medium' : 'low';
}

// ── Unified → legacy read shims ────────────────────────────────────────────

/**
 * Present a unified run as the legacy blackboard `AgentRun` the current
 * `agentWorkspace` store renders. Lossy on purpose — it is a read model, not a
 * round-trip.
 */
export function toLegacyRun(run: WorkRun): LegacyAgentRun {
  return {
    id: run.originRef && run.origin === 'agent_run' ? run.originRef : run.id,
    goal: run.brief || run.title,
    stage: run.title,
    status: toLegacyRunStatus(run.state),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function toLegacyRunStatus(state: WorkRunState): LegacyAgentRunStatus {
  switch (state) {
    case 'completed':
      return 'done';
    case 'canceled':
      return 'archived';
    case 'awaiting_approval':
    case 'waiting_external':
    case 'failed':
      return 'blocked';
    default:
      return 'active';
  }
}

/** Present a unified run as a legacy task-board item. */
export function toLegacyTask(run: WorkRun): LegacyAgentTask {
  return {
    id: run.originRef && run.origin === 'agent_task' ? run.originRef : run.id,
    title: run.title,
    status: toLegacyTaskStatus(run.state),
    summary: run.brief,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  };
}

function toLegacyTaskStatus(state: WorkRunState): LegacyAgentTaskStatus {
  switch (state) {
    case 'completed':
      return 'done';
    case 'running':
    case 'queued':
    case 'paused':
      return 'in_progress';
    case 'awaiting_approval':
    case 'waiting_external':
    case 'failed':
    case 'canceled':
      return 'blocked';
    default:
      return 'todo';
  }
}

/**
 * Walk a freshly-created run (always `created`) to a target state along legal
 * edges. A legacy status is a snapshot, not a path, so the adapter has to find a
 * route the state machine actually allows rather than forcing the value in.
 */
function reconcileState(
  service: WorkService,
  run: WorkRun,
  target: WorkRunState,
  /**
   * Additive discriminators to persist on the FINAL hop of the walk (the one that
   * actually lands the target state). Written only there because an intermediate
   * hop is a routing artefact, not a fact about the legacy record.
   */
  extras: {
    pausedReason?: RunPauseReason;
    canceledReason?: RunCanceledReason;
    archivedAt?: string;
    legacyStatusRaw?: string;
  } = {},
): void {
  const routes: Partial<Record<WorkRunState, WorkRunState[]>> = {
    queued: ['queued'],
    running: ['queued', 'running'],
    awaiting_approval: ['queued', 'running', 'awaiting_approval'],
    waiting_external: ['queued', 'running', 'waiting_external'],
    paused: ['queued', 'running', 'paused'],
    completed: ['queued', 'running', 'completed'],
    failed: ['queued', 'running', 'failed'],
    canceled: ['canceled'],
  };

  const path = routes[target] ?? [];
  let current = service.getRun(run.id)?.state ?? run.state;
  for (const [index, next] of path.entries()) {
    if (current === next) continue;
    // The discriminators describe the DESTINATION, so they ride only on the last
    // hop. Stamping them on an intermediate hop would claim, mid-walk, a reason
    // for a state the run is only passing through.
    const isFinalHop = index === path.length - 1;
    try {
      service.transition(run.id, next, {
        reason: 'legacy-import',
        ...(isFinalHop ? extras : {}),
      });
      current = next;
    } catch {
      // The current state already implies the target (e.g. re-import of a run
      // that has moved on). A read model must not fight the live state.
      break;
    }
  }
}
