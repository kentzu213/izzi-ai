import { useProjectWorkspaceStore } from '../../store/projectWorkspace';
import { cancelPendingHandoff } from './composerHandoff';
import { cancelMarketingPrefill } from './marketingPrefill';

/**
 * Account switch or logout (`null`). A handoff started under the previous
 * account must never bind a session or write a draft after the switch, so it
 * is cancelled before the project metadata of the new account is loaded. The
 * same holds for a pending Marketing prefill.
 */
export function applyV2Identity(userId: unknown): void {
  cancelPendingHandoff();
  cancelMarketingPrefill();
  useProjectWorkspaceStore.getState().setIdentity(typeof userId === 'string' ? userId : null);
}
