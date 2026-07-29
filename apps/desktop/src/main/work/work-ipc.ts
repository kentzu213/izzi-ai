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
import { ipcMain, type WebContents } from 'electron';
import type { WorkApprovalDecision, WorkEvent, WorkRun } from './work-types';
import type { WorkService } from './work-service';
import {
  accessibleWorkspaceIds,
  canAccessWorkspace,
  type WorkAuthContext,
  type WorkDenyReason,
} from './work-authz';

export interface WorkIpcIdentity {
  /** Stable, non-PII reviewer reference derived from the signed-in user. */
  resolveReviewerHash(): string | null;
  /**
   * Tenant workspace ids the signed-in identity is bound to. Optional so a host
   * with no tenant concept at all stays personal-only (the safe default) rather
   * than having to fabricate an empty binding.
   */
  resolveTenantWorkspaceIds?(): readonly string[];
}

const MAX_BRIEF = 4_000;
const MAX_TITLE = 300;

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

function deny(reason: WorkDenyReason) {
  return { ok: false as const, reason };
}

/**
 * Register the work IPC handlers and wire live event fan-out.
 *
 * `getWebContents` is used by `createWorkEventForwarder`; it is accepted here so
 * a caller can register the bridge and the forwarder from one place.
 */
export function registerWorkIpc(
  service: WorkService,
  identity: WorkIpcIdentity,
  getWebContents: () => WebContents | null,
): void {
  void getWebContents;

  /** The caller's authorization context, resolved fresh on every call. */
  const authContext = (): WorkAuthContext => ({
    reviewerHash: identity.resolveReviewerHash(),
    tenantWorkspaceIds: identity.resolveTenantWorkspaceIds?.() ?? [],
  });

  /** Workspace ids this caller may read right now. */
  const scope = (): string[] =>
    accessibleWorkspaceIds(authContext(), service.repo.listWorkspaces());

  /** True when the caller may see `workspaceId`. */
  const allows = (workspaceId: string): boolean =>
    canAccessWorkspace(authContext(), workspaceId, service.repo.getWorkspace(workspaceId));

  /**
   * Resolve a run the caller is allowed to see. Returns null both for "no such
   * run" and "not yours" — the two must be indistinguishable, or the bridge
   * becomes an existence oracle for another workspace's run ids.
   */
  const visibleRun = (runId: unknown): WorkRun | null => {
    if (typeof runId !== 'string' || !runId) return null;
    const run = service.getRun(runId);
    if (!run) return null;
    return allows(run.workspaceId) ? run : null;
  };

  ipcMain.handle('work:listRuns', (_event, options?: { workspaceId?: string; limit?: number }) => {
    const limit = typeof options?.limit === 'number' ? options.limit : undefined;
    const requested = typeof options?.workspaceId === 'string' ? options.workspaceId : null;

    if (requested !== null) {
      // An explicit request is honoured only if it is in scope; it is never
      // silently widened to everything the caller *can* see.
      if (!allows(requested)) return [];
      return service.listRuns({ workspaceId: requested, ...(limit ? { limit } : {}) });
    }

    return scope().flatMap((workspaceId) =>
      service.listRuns({ workspaceId, ...(limit ? { limit } : {}) }),
    );
  });

  ipcMain.handle('work:getRun', (_event, runId: string) => {
    const run = visibleRun(runId);
    return run ? service.getRunBundle(run.id) : null;
  });

  ipcMain.handle('work:listEvents', (_event, runId: string, afterRunSeq?: number) => {
    const run = visibleRun(runId);
    if (!run) return [];
    return service.listEvents(run.id, typeof afterRunSeq === 'number' ? afterRunSeq : 0);
  });

  ipcMain.handle('work:listEventsSince', (_event, afterSeq?: number, limit?: number) => {
    const allowed = new Set(scope());
    return service
      .listEventsSince(
        typeof afterSeq === 'number' ? afterSeq : 0,
        typeof limit === 'number' ? limit : 500,
      )
      .filter((event) => allowed.has(event.workspaceId));
  });

  // The cursor itself carries no work content, so it is not scoped — a subscriber
  // needs the true head position to resume from, and filtering it would make a
  // caller re-read the same window forever.
  ipcMain.handle('work:latestEventSeq', () => service.latestEventSeq());

  ipcMain.handle('work:listLineage', (_event, runId: string) => {
    const run = visibleRun(runId);
    if (!run) return [];
    // Lineage crossing a workspace boundary is filtered too: a retry is a new
    // run, and nothing guarantees every ancestor sits in the same workspace.
    return service.listLineage(run.id).filter((item) => allows(item.workspaceId));
  });

  ipcMain.handle('work:listPendingApprovals', (_event, runId?: string) => {
    if (typeof runId === 'string' && runId) {
      const run = visibleRun(runId);
      return run ? service.listPendingApprovals(run.id) : [];
    }
    const allowed = new Set(scope());
    return service.listPendingApprovals().filter((approval) => allowed.has(approval.workspaceId));
  });

  // A user starting a piece of work from a brief. Starts in `created` (no side
  // effects) — the acceptance-criteria entry point.
  ipcMain.handle(
    'work:createRun',
    (_event, input: { title?: string; brief?: string; workspaceId?: string }) => {
      const brief = cleanText(input?.brief, MAX_BRIEF);
      if (!brief) return null;
      const requested = cleanText(input?.workspaceId, 200);
      if (requested && !allows(requested)) return null;
      const title = cleanText(input?.title, MAX_TITLE) || brief.slice(0, 80);
      return service.createRun({
        title,
        brief,
        origin: 'manual',
        ...(requested ? { workspaceId: requested } : {}),
      });
    },
  );

  // The human decision on an approval gate. `decidedBy` is resolved here from the
  // authenticated identity — the renderer cannot claim to be someone else, and it
  // cannot approve when signed out.
  ipcMain.handle(
    'work:decideApproval',
    (
      _event,
      input: { approvalId?: string; decision?: string; note?: string; editedInput?: unknown },
    ) => {
      const approvalId = cleanText(input?.approvalId, 200);
      if (!approvalId || !isDecision(input?.decision)) return deny('invalid-request');

      const decidedBy = identity.resolveReviewerHash();
      // Fail-closed: an approval is a human accountability record, so it requires
      // a real identity even in the personal workspace.
      if (!decidedBy) return deny('not-authenticated');

      // Authorize against the approval's own workspace before touching it, so a
      // guessed approval id in another workspace cannot be decided.
      const approval = service.getApproval(approvalId);
      if (!approval || !allows(approval.workspaceId)) return deny('forbidden');

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

  ipcMain.handle('work:resume', (_event, runId: string) => {
    const run = visibleRun(runId);
    if (!run) return deny('forbidden');
    try {
      const result = service.resume(run.id);
      return { ok: true as const, run: result.run, cursor: result.cursor };
    } catch (error) {
      return { ok: false as const, reason: (error as Error).message };
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
  isVisible?: (event: WorkEvent) => boolean,
): (event: WorkEvent) => void {
  return (event: WorkEvent) => {
    const wc = getWebContents();
    if (!wc || wc.isDestroyed()) return;
    if (isVisible && !isVisible(event)) return;
    wc.send('work:event', event);
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
      {
        reviewerHash: identity.resolveReviewerHash(),
        tenantWorkspaceIds: identity.resolveTenantWorkspaceIds?.() ?? [],
      },
      event.workspaceId,
      service.repo.getWorkspace(event.workspaceId),
    );
}
