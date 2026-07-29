/**
 * Workspace-scoped authorization for the work IPC surface (Loop 03).
 *
 * The renderer asks for work by id. Ids are guessable, so "which runs may this
 * caller see" cannot be answered by the caller — it has to be decided in main,
 * against the signed-in identity, for every read and every command.
 *
 * The rule is deliberately asymmetric, because the two kinds of workspace are
 * not equally sensitive:
 *
 *   - `personal` — this machine's own local work. Readable without a session.
 *     Requiring sign-in here would break offline use and the Today page for a
 *     user who simply has not logged in, while protecting nothing: the data is
 *     already on their disk, under their OS account.
 *   - `customer` (and any other tenant-bound kind) — belongs to an external
 *     tenant. Requires an authenticated identity AND an explicit binding of that
 *     identity to the workspace. No session, or no binding, means no access.
 *
 * Everything fails CLOSED: an unresolvable workspace is denied rather than
 * assumed personal, and a denied read returns empty rather than throwing, so a
 * probe cannot distinguish "exists but forbidden" from "does not exist".
 *
 * @module main/work/work-authz
 */
import { DEFAULT_WORKSPACE_ID, type Workspace } from './work-types';

/** What main knows about the caller. Resolved from the session, never from IPC. */
export interface WorkAuthContext {
  /** Opaque reviewer reference, or null when signed out. */
  reviewerHash: string | null;
  /**
   * Tenant workspace ids this identity is bound to. Empty when signed out.
   * The personal workspace is never listed here — it is granted structurally.
   */
  tenantWorkspaceIds: readonly string[];
}

/** The always-available local workspace. */
export function isPersonalWorkspace(workspaceId: string): boolean {
  return workspaceId === DEFAULT_WORKSPACE_ID;
}

/**
 * May this caller see work in `workspaceId`?
 *
 * `workspace` is the resolved row when known. When it is null the workspace does
 * not exist in the store, and the answer is no — an id we cannot classify is not
 * silently treated as personal.
 */
export function canAccessWorkspace(
  ctx: WorkAuthContext,
  workspaceId: string,
  workspace: Workspace | null,
): boolean {
  if (!workspaceId) return false;
  if (isPersonalWorkspace(workspaceId)) return true;
  if (!workspace) return false;
  // A tenant workspace needs both a session and a binding to this identity.
  if (!ctx.reviewerHash) return false;
  return ctx.tenantWorkspaceIds.includes(workspaceId);
}

/** The workspace ids this caller may read, given every workspace in the store. */
export function accessibleWorkspaceIds(
  ctx: WorkAuthContext,
  workspaces: readonly Workspace[],
): string[] {
  const ids = new Set<string>([DEFAULT_WORKSPACE_ID]);
  if (ctx.reviewerHash) {
    for (const ws of workspaces) {
      if (ctx.tenantWorkspaceIds.includes(ws.id)) ids.add(ws.id);
    }
  }
  return [...ids];
}

/** Denial reasons the renderer may see. Deliberately coarse — no data leaks. */
export type WorkDenyReason = 'invalid-request' | 'not-authenticated' | 'forbidden';
