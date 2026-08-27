import type {
  NativeMarketingClient,
  NativeMarketingErrorCode,
  NativeMarketingWorkspaceSummary,
} from '../marketing/native-marketing-client';
import type { CustomerMarketingBridgeStatus } from '../../shared/customer-marketing-types';
import type { RemoteMarketingWorkspace } from './customer-marketing-workspace-client';

export type CustomerMarketingIntegrationAuthorityState =
  | { status: 'synced'; workspace: RemoteMarketingWorkspace }
  | {
    status: Exclude<CustomerMarketingBridgeStatus, 'synced'>;
    workspace: null;
  };

export interface CustomerMarketingIntegrationAuthorityGateway {
  resolve(preferredWorkspaceId?: string): Promise<CustomerMarketingIntegrationAuthorityState>;
}

type NativeMarketingWorkspaceSource = Pick<NativeMarketingClient, 'listWorkspaces'>;

const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failureStatus(error: NativeMarketingErrorCode): 'forbidden' | 'not_found' | 'unavailable' {
  if (error === 'forbidden') return 'forbidden';
  if (error === 'not-found') return 'not_found';
  return 'unavailable';
}

function toRemoteWorkspace(workspace: NativeMarketingWorkspaceSummary): RemoteMarketingWorkspace {
  const quota = workspace.creditsLimit !== null && workspace.creditsUsed !== null
    ? { creditsLimit: workspace.creditsLimit, creditsUsed: workspace.creditsUsed }
    : null;
  return {
    id: workspace.id,
    name: workspace.name,
    role: workspace.role,
    plan: workspace.plan,
    quota,
  };
}

/**
 * Resolves only the authority needed by the local Provider Vault. It deliberately
 * exposes none of the broader Customer Marketing resource/workflow API surface.
 */
export class NativeMarketingIntegrationAuthorityGateway
implements CustomerMarketingIntegrationAuthorityGateway {
  constructor(private readonly source: NativeMarketingWorkspaceSource) {}

  async resolve(preferredWorkspaceId?: string): Promise<CustomerMarketingIntegrationAuthorityState> {
    let result: Awaited<ReturnType<NativeMarketingWorkspaceSource['listWorkspaces']>>;
    try {
      result = await this.source.listWorkspaces();
    } catch {
      return { status: 'unavailable', workspace: null };
    }
    if (!result.ok) return { status: failureStatus(result.error), workspace: null };
    if (result.workspaces.length === 0) return { status: 'not_found', workspace: null };

    const binding = typeof preferredWorkspaceId === 'string' ? preferredWorkspaceId.trim() : '';
    const exact = binding
      ? result.workspaces.find((workspace) => workspace.id === binding)
      : undefined;
    if (exact) return { status: 'synced', workspace: toRemoteWorkspace(exact) };

    // Never silently replace a persisted remote binding with another tenant.
    if (WORKSPACE_ID_PATTERN.test(binding)) return { status: 'unavailable', workspace: null };
    if (result.workspaces.length !== 1) return { status: 'unavailable', workspace: null };
    return { status: 'synced', workspace: toRemoteWorkspace(result.workspaces[0]) };
  }
}
