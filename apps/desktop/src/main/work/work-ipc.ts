/**
 * Narrow, workspace-scoped IPC surface for the unified work model (Loop 03).
 *
 * The renderer is a *viewer and a decider*, not an executor. So this bridge
 * exposes exactly:
 *
 * - read surfaces: list runs, one run's bundle, its events (per-run or since a
 *   global cursor), pending approvals, lineage;
 * - the two human actions a person legitimately takes: create a run from a
 *   brief, and decide an approval (approve / edit / reject);
 * - resume a paused run.
 *
 * It deliberately does NOT let the renderer append raw events, force a state
 * transition, mint an approval, or write an artifact — those are executor/main
 * concerns, and handing them to the renderer is how a forged event or a
 * self-approved action would get in (security gate C/D).
 *
 * Two things are decided HERE and never taken from the renderer:
 *
 *   1. `decidedBy` — derived from the authenticated identity, so a caller cannot
 *      claim to be someone else, and cannot approve while signed out.
 *   2. workspace scope — every read is intersected with the workspaces the
 *      session may actually see (`work-authz`). A run id the caller may not see
 *      is answered exactly like a run id that does not exist, so the bridge
 *      cannot be used to probe for work in another tenant's workspace.
 *
 * @module main/work/work-ipc
 */
import { createHash } from 'node:crypto';
import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { isTrustedMarketingSender } from '../marketing/marketing-ipc';
import type { WorkApprovalDecision, WorkEvent, WorkRun } from './work-types';
import type { WorkService } from './work-service';
import {
  accessibleWorkspaceIds,
  canAccessWorkspace,
  type WorkAuthContext,
} from './work-authz';
import {
  WORK_IPC_CHANNELS,
  type WorkCreateRunRequest,
  type WorkDecideApprovalRequest,
  type WorkIpcFailure,
  type WorkListEventsRequest,
  type WorkListEventsSinceRequest,
  type WorkListRunsRequest,
  type WorkPendingApprovalsRequest,
  type WorkRunRequest,
  type WorkWorkspaceRequest,
} from './work-preload-api';

export interface WorkIpcIdentity {
  /** Stable, non-PII reviewer reference derived from the signed-in user. */
  resolveReviewerHash(): string | null;
  /**
   * Tenant bindings include the reviewer that minted/resolved them. Keeping the
   * subject on the binding prevents a cached workspace from being joined to a
   * different account after an auth transition.
   */
  resolveTenantWorkspaceBindings?(): readonly WorkTenantWorkspaceBinding[];
}

export interface WorkTenantWorkspaceBinding {
  reviewerHash: string;
  workspaceId: string;
}

const MAX_BRIEF = 4_000;
const MAX_TITLE = 300;
const MAX_ID = 200;
const MAX_EVENT_CURSOR = Number.MAX_SAFE_INTEGER;

/** Opaque, stable reviewer reference. Never an email or a raw user id. */
export function reviewerHashFromUserId(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `rv-${createHash('sha256').update(userId).digest('hex').slice(0, 24)}`;
}

function cleanText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function isDecision(value: unknown): value is WorkApprovalDecision {
  return value === 'approve' || value === 'edit' || value === 'reject';
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function objectInput(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function deny(reason: WorkIpcFailure) {
  return { ok: false as const, reason };
}

function assertTrustedWorkSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedMarketingSender(event)) {
    throw new Error('Work IPC sender is not trusted');
  }
}

/** Resolve one atomic authorization context and discard stale account bindings. */
export function resolveWorkAuthContext(identity: WorkIpcIdentity): WorkAuthContext {
  const reviewerHash = identity.resolveReviewerHash();
  const tenantWorkspaceIds = reviewerHash
    ? (identity.resolveTenantWorkspaceBindings?.() ?? [])
        .filter((binding) => binding.reviewerHash === reviewerHash)
        .map((binding) => binding.workspaceId)
    : [];
  return { reviewerHash, tenantWorkspaceIds: [...new Set(tenantWorkspaceIds)] };
}

/**
 * Register the work IPC handlers.
 *
 * Every request names one workspace and every row-bearing operation verifies
 * both that the caller may access that workspace and that the requested row
 * belongs to it. Main never widens an invalid/forbidden request to another
 * workspace, including the personal workspace.
 */
export function registerWorkIpc(
  service: WorkService,
  identity: WorkIpcIdentity,
): void {
  // Bootstrap the one canonical local workspace once at main-process startup.
  // This is idempotent and keeps the renderer from inventing a workspace id or
  // mutating persistence from a nominal read operation.
  service.ensureWorkspace();

  /** The caller's authorization context, resolved fresh on every call. */
  const authContext = (): WorkAuthContext => resolveWorkAuthContext(identity);

  /** True when the caller may see `workspaceId`. */
  const allows = (workspaceId: string): boolean =>
    canAccessWorkspace(authContext(), workspaceId, service.repo.getWorkspace(workspaceId));

  const visibleWorkspace = (raw: unknown): string | null => {
    const workspaceId = cleanText(raw, MAX_ID);
    return workspaceId && allows(workspaceId) ? workspaceId : null;
  };

  /**
   * Resolve a run the caller is allowed to see. Returns null both for "no such
   * run" and "not yours" — the two must be indistinguishable, or the bridge
   * becomes an existence oracle for another workspace's run ids.
   */
  const visibleRun = (workspaceId: unknown, runId: unknown): WorkRun | null => {
    const requestedWorkspace = visibleWorkspace(workspaceId);
    const id = cleanText(runId, MAX_ID);
    if (!requestedWorkspace || !id) return null;
    const run = service.getRun(id);
    if (!run) return null;
    return run.workspaceId === requestedWorkspace ? run : null;
  };

  ipcMain.handle(WORK_IPC_CHANNELS.listWorkspaces, (event) => {
    assertTrustedWorkSender(event);
    const workspaces = service.listWorkspaces();
    const visibleIds = new Set(accessibleWorkspaceIds(authContext(), workspaces));
    return workspaces
      .filter((workspace) => visibleIds.has(workspace.id))
      .sort((left, right) => {
        if (left.id === 'personal') return -1;
        if (right.id === 'personal') return 1;
        return left.name.localeCompare(right.name);
      });
  });

  ipcMain.handle(WORK_IPC_CHANNELS.listRuns, (event, raw: unknown) => {
    assertTrustedWorkSender(event);
    const input = objectInput(raw) as unknown as WorkListRunsRequest;
    const workspaceId = visibleWorkspace(input.workspaceId);
    if (!workspaceId) return [];
    return service.listRuns({
      workspaceId,
      limit: boundedInteger(input.limit, 100, 1, 500),
    });
  });

  ipcMain.handle(WORK_IPC_CHANNELS.getRun, (event, raw: unknown) => {
    assertTrustedWorkSender(event);
    const input = objectInput(raw) as unknown as WorkRunRequest;
    const run = visibleRun(input.workspaceId, input.runId);
    return run ? service.getRunBundle(run.id) : null;
  });

  ipcMain.handle(WORK_IPC_CHANNELS.listEvents, (event, raw: unknown) => {
    assertTrustedWorkSender(event);
    const input = objectInput(raw) as unknown as WorkListEventsRequest;
    const run = visibleRun(input.workspaceId, input.runId);
    if (!run) return [];
    return service.listEvents(
      run.id,
      boundedInteger(input.afterRunSeq, 0, 0, MAX_EVENT_CURSOR),
      boundedInteger(input.limit, 1_000, 1, 5_000),
    );
  });

  ipcMain.handle(WORK_IPC_CHANNELS.listEventsSince, (event, raw: unknown) => {
    assertTrustedWorkSender(event);
    const input = objectInput(raw) as unknown as WorkListEventsSinceRequest;
    const workspaceId = visibleWorkspace(input.workspaceId);
    if (!workspaceId) return [];
    return service.listEventsSince(
      workspaceId,
      boundedInteger(input.afterSeq, 0, 0, MAX_EVENT_CURSOR),
      boundedInteger(input.limit, 500, 1, 2_000),
    );
  });

  ipcMain.handle(WORK_IPC_CHANNELS.latestEventSeq, (event, raw: unknown) => {
    assertTrustedWorkSender(event);
    const input = objectInput(raw) as unknown as WorkWorkspaceRequest;
    const workspaceId = visibleWorkspace(input.workspaceId);
    return workspaceId ? service.latestEventSeq(workspaceId) : 0;
  });

  ipcMain.handle(WORK_IPC_CHANNELS.listLineage, (event, raw: unknown) => {
    assertTrustedWorkSender(event);
    const input = objectInput(raw) as unknown as WorkRunRequest;
    const run = visibleRun(input.workspaceId, input.runId);
    if (!run) return [];
    return service.listLineage(run.id).filter((item) => item.workspaceId === run.workspaceId);
  });

  ipcMain.handle(WORK_IPC_CHANNELS.listPendingApprovals, (event, raw: unknown) => {
    assertTrustedWorkSender(event);
    const input = objectInput(raw) as unknown as WorkPendingApprovalsRequest;
    const workspaceId = visibleWorkspace(input.workspaceId);
    if (!workspaceId) return [];
    const runId = cleanText(input.runId, MAX_ID);
    if (runId) {
      const run = visibleRun(workspaceId, runId);
      return run ? service.listPendingApprovals(run.id) : [];
    }
    return service
      .listPendingApprovals()
      .filter((approval) => approval.workspaceId === workspaceId);
  });

  // A user starting a piece of work from a brief. Starts in `created` (no side
  // effects) — the acceptance-criteria entry point.
  ipcMain.handle(
    WORK_IPC_CHANNELS.createRun,
    (event, raw: unknown) => {
      assertTrustedWorkSender(event);
      const input = objectInput(raw) as unknown as WorkCreateRunRequest;
      const workspaceId = visibleWorkspace(input.workspaceId);
      const brief = cleanText(input?.brief, MAX_BRIEF);
      if (!workspaceId || !brief) return null;
      const title = cleanText(input?.title, MAX_TITLE) || brief.slice(0, 80);
      return service.createRun({
        title,
        brief,
        origin: 'manual',
        workspaceId,
      });
    },
  );

  // The human decision on an approval gate. `decidedBy` is resolved here from the
  // authenticated identity — the renderer cannot claim to be someone else, and it
  // cannot approve when signed out.
  ipcMain.handle(
    WORK_IPC_CHANNELS.decideApproval,
    (
      event,
      raw: unknown,
    ) => {
      assertTrustedWorkSender(event);
      const input = objectInput(raw) as unknown as WorkDecideApprovalRequest;
      const approvalId = cleanText(input.approvalId, MAX_ID);
      if (!approvalId || !isDecision(input?.decision)) return deny('invalid-request');

      const decidedBy = identity.resolveReviewerHash();
      // Fail-closed: an approval is a human accountability record, so it requires
      // a real identity even in the personal workspace.
      if (!decidedBy) return deny('not-authenticated');

      // Authorize against the approval's own workspace before touching it, so a
      // guessed approval id in another workspace cannot be decided.
      const workspaceId = visibleWorkspace(input.workspaceId);
      if (!workspaceId) return deny('forbidden');
      const approval = service.getApproval(approvalId);
      if (!approval || approval.workspaceId !== workspaceId) return deny('forbidden');

      const result = service.decideApproval({
        approvalId,
        decision: input.decision,
        decidedBy,
        ...(input.decision === 'edit' ? { editedInput: input.editedInput } : {}),
        ...(typeof input.note === 'string' ? { note: input.note } : {}),
      });

      if (result.ok) {
        return {
          ok: true as const,
          approval: result.approval,
          receipt: result.receipt,
          duplicate: result.duplicate,
        };
      }
      return { ok: false as const, reason: result.reason, approval: result.approval };
    },
  );

  ipcMain.handle(WORK_IPC_CHANNELS.resume, (event, raw: unknown) => {
    assertTrustedWorkSender(event);
    const input = objectInput(raw) as unknown as WorkRunRequest;
    const run = visibleRun(input.workspaceId, input.runId);
    if (!run) return deny('forbidden');
    try {
      const result = service.resume(run.id);
      return { ok: true as const, run: result.run, cursor: result.cursor };
    } catch {
      // The renderer gets a stable, non-sensitive code. The detailed invariant
      // failure remains in main where it cannot disclose schema or row details.
      return deny('invalid-state');
    }
  });
}

/**
 * Build the event sink that pushes committed events to the renderer.
 *
 * Scoped with the same predicate as the reads: an event the caller could not
 * have fetched must not arrive unsolicited either. Without `isVisible` the
 * forwarder stays personal-only, which is the fail-closed default.
 */
export function createWorkEventForwarder(
  getWebContents: () => WebContents | null,
  isVisible: (event: WorkEvent) => boolean,
): (event: WorkEvent) => void {
  return (event: WorkEvent) => {
    const wc = getWebContents();
    if (!wc || wc.isDestroyed()) return;
    if (!isVisible(event)) return;
    wc.send(WORK_IPC_CHANNELS.event, event);
  };
}

/**
 * The default visibility predicate for the live forwarder: the same workspace
 * scope the read handlers use, so subscribe and fetch cannot disagree.
 */
export function createWorkEventVisibility(
  service: WorkService,
  identity: WorkIpcIdentity,
): (event: WorkEvent) => boolean {
  return (event: WorkEvent) =>
    canAccessWorkspace(
      resolveWorkAuthContext(identity),
      event.workspaceId,
      service.repo.getWorkspace(event.workspaceId),
    );
}
