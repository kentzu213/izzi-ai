import { ipcMain } from 'electron';

/*
 * Gateway chat history persistence, scoped to the signed-in account.
 *
 * The trusted owner is always resolved in main (AuthManager). The renderer must
 * echo the owner it believes is current; a null or mismatching owner fails
 * closed, so a late save after logout/account switch writes nothing.
 *
 * Rows live in `user_data` under a per-owner type, with a domain-separated row
 * id. Legacy bare `gateway_session` rows predate scoping and have no owner: the
 * first trusted account to list adopts them once (moved to its scope, legacy row
 * removed). A legacy row is claimed only when its stored id equals its session
 * id, that id is not itself scope-prefixed, and the target scoped row is free.
 *
 * `user_data` is keyed by id alone and its upsert rewrites `type`, so a write or
 * delete by id could hit a row of another type (legacy or otherwise) that
 * happens to share the id. Save/delete therefore touch a row only when it is
 * absent or already carries this owner's scope type; any other type is an id
 * collision and fails closed without touching that row.
 */

export interface GatewaySessionStore {
  getUserData(type: string): unknown[];
  cacheUserData(id: string, type: string, data: object): void;
  deleteUserData(id: string): void;
  /** Type of the row with this id, or null when there is none. */
  getUserDataType(id: string): string | null;
}

export interface GatewaySessionIpcDeps {
  store: GatewaySessionStore;
  /** Trusted current user id from main, or null when signed out. */
  currentUserId: () => string | null | undefined;
}

export const LEGACY_GATEWAY_SESSION_TYPE = 'gateway_session';
export const GATEWAY_SESSION_SCOPE_PREFIX = 'gateway_session:v1:';
export const OWNER_ID_MAX = 200;
export const SESSION_ID_MAX = 200;

function boundedId(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

// encodeURIComponent escapes ':', so the owner/session boundary is unambiguous.
export function gatewaySessionScope(owner: string): string {
  return `${GATEWAY_SESSION_SCOPE_PREFIX}${encodeURIComponent(owner)}`;
}

export function gatewaySessionRowId(owner: string, sessionId: string): string {
  return `${gatewaySessionScope(owner)}:${sessionId}`;
}

export function registerGatewaySessionIpc(deps: GatewaySessionIpcDeps): void {
  // The claimed owner only confirms intent; authority is the main-side user.
  const trustedOwner = (claimed: unknown): string | null => {
    const owner = boundedId(deps.currentUserId(), OWNER_ID_MAX);
    return owner !== null && claimed === owner ? owner : null;
  };

  // Main is single-threaded and the store is synchronous, so nothing can run
  // between this check and the write/delete that follows it.
  const ownsRowId = (rowId: string, scope: string): boolean => {
    const existing = deps.store.getUserDataType(rowId);
    return existing === null || existing === scope;
  };

  const claimLegacyRows = (owner: string, scope: string): void => {
    for (const row of deps.store.getUserData(LEGACY_GATEWAY_SESSION_TYPE)) {
      const id = row && typeof row === 'object' ? boundedId((row as { id?: unknown }).id, SESSION_ID_MAX) : null;
      if (!id || id.startsWith(GATEWAY_SESSION_SCOPE_PREFIX)) continue;
      if (deps.store.getUserDataType(id) !== LEGACY_GATEWAY_SESSION_TYPE) continue;
      const rowId = gatewaySessionRowId(owner, id);
      if (deps.store.getUserDataType(rowId) !== null) continue;
      deps.store.cacheUserData(rowId, scope, row as object);
      deps.store.deleteUserData(id);
    }
  };

  ipcMain.handle('gatewaySessions:list', (_event, ownerId: unknown) => {
    const owner = trustedOwner(ownerId);
    if (!owner) return [];
    const scope = gatewaySessionScope(owner);
    claimLegacyRows(owner, scope);
    return deps.store.getUserData(scope);
  });

  ipcMain.handle('gatewaySessions:save', (_event, ownerId: unknown, session: unknown) => {
    const owner = trustedOwner(ownerId);
    const sessionId =
      session && typeof session === 'object' ? boundedId((session as { id?: unknown }).id, SESSION_ID_MAX) : null;
    if (!owner || !sessionId) return { ok: false };
    const rowId = gatewaySessionRowId(owner, sessionId);
    const scope = gatewaySessionScope(owner);
    if (!ownsRowId(rowId, scope)) return { ok: false };
    deps.store.cacheUserData(rowId, scope, session as object);
    return { ok: true };
  });

  ipcMain.handle('gatewaySessions:delete', (_event, ownerId: unknown, sessionId: unknown) => {
    const owner = trustedOwner(ownerId);
    const id = boundedId(sessionId, SESSION_ID_MAX);
    if (!owner || !id) return { ok: false };
    const rowId = gatewaySessionRowId(owner, id);
    if (!ownsRowId(rowId, gatewaySessionScope(owner))) return { ok: false };
    deps.store.deleteUserData(rowId);
    return { ok: true };
  });
}
