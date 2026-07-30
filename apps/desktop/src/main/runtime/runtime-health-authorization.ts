import type { RuntimeHealthSnapshot } from '../../shared/runtime';

export interface RuntimeHealthScope {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
}

export function filterAuthorizedRuntimeHealth(
  items: readonly RuntimeHealthSnapshot[],
  scopes: readonly RuntimeHealthScope[],
  requestedWorkspaceId?: string,
): readonly RuntimeHealthSnapshot[] {
  const requested = requestedWorkspaceId?.trim();
  return items.filter((item) => (
    (!requested || item.workspaceId === requested)
    && scopes.some((scope) => (
      scope.tenantId === item.tenantId
      && scope.userId === item.userId
      && scope.workspaceId === item.workspaceId
    ))
  ));
}
