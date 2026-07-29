import {
  createWorkspaceProvisioningPlan,
  type WorkspaceBlueprintDescriptor,
  type WorkspaceProvisioningPlan,
  type WorkspaceProvisioningScopeInput,
} from '../../shared/workspace-blueprint';

/**
 * Main-process plan seam. It remains pure and plan-only so future IPC/runtime
 * owners cannot mistake this loop for operational provisioning.
 */
export function planWorkspaceBlueprint(
  blueprint: WorkspaceBlueprintDescriptor,
  scope: WorkspaceProvisioningScopeInput,
  plannedAt: string,
): WorkspaceProvisioningPlan {
  return createWorkspaceProvisioningPlan(blueprint, scope, plannedAt);
}
