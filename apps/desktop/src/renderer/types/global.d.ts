import type { GraphNode, GraphLink, MemoryItemDTO } from '../../shared/graph-types';
import type {
  LiveProfileReadResult,
  LiveProfileWriteResult,
} from '../../shared/memory-trace/live-profile';
import type { BranchClassification } from './graph-workspace';
import type { UniverseNodeDetail } from '../../shared/universe-adapter';
import type {
  MarketingPathSelectionResult,
  MarketingWorkspaceSnapshot,
} from '../../shared/marketing-types';
import type {
  CustomerDirectorInput,
  CustomerGoalInput,
  CustomerMarketingSnapshot,
  CustomerMarketingAnalyticsResult,
  CustomerProductMarketingContextMutationResult,
  CustomerProductMarketingContextSaveInput,
  CustomerProductMarketingContextV1,
  CustomerMarketingAnalyticsWindow,
  CustomerMarketingCalendarInput,
  CustomerMarketingResourceArchiveInput,
  CustomerMarketingResourceArchiveResult,
  CustomerMarketingResourceCreateInput,
  CustomerMarketingResourceKind,
  CustomerMarketingResourceListResult,
  CustomerMarketingResourceMutationResult,
  CustomerMarketingResourceReviewInput,
  CustomerMarketingResourceUpdateInput,
  CustomerMarketingWorkflowListResult,
  CustomerMarketingWorkflowMutationResult,
  CustomerMarketingWorkflowPrepareRequest,
  CustomerMarketingWorkflowReviewRequest,
  CustomerMarketingWorkflowSourceListResult,
  CustomerMarketingWorkflowTarget,
  CustomerMediaPreviewInput,
  CustomerMediaProjectSelectionResult,
  CustomerMutationResult,
  CustomerOnboardingInput,
  CustomerReviewInput,
  CustomerWorkspaceMemberRoleInput,
  CustomerWorkspaceMembersResult,
  CustomerWorkspaceInvitationAcceptanceResult,
  CustomerWorkspaceInvitationInput,
  CustomerWorkspaceInvitationResult,
  CustomerVoiceStudioRepairResult,
} from '../../shared/customer-marketing-types';
import type {
  CustomerMarketingCredentialListResult,
  CustomerMarketingCredentialRevokeInput,
  CustomerMarketingCredentialRevokeResult,
} from '../../shared/customer-marketing-credential-types';
import type {
  CustomerMarketingActionGateRequest,
  CustomerMarketingActionGateResult,
} from '../../shared/customer-marketing-action-gate-types';

export {};

declare global {
  /** Renderer-facing graph IPC surface — mirrors the preload `graph` namespace (Req 7.1, 7.5). */
  interface ElectronGraphApi {
    list: () => Promise<GraphNode[]>;
    universe: () => Promise<{ nodes: GraphNode[]; links: GraphLink[] }>;
    nodeDetail: (id: string) => Promise<UniverseNodeDetail | null>;
    create: (input: Partial<GraphNode> & { title: string }) => Promise<GraphNode | { error: string }>;
    update: (
      id: string,
      patch: Partial<GraphNode> & { isPublic?: boolean },
    ) => Promise<{ ok: true } | { error: string }>;
    remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
    links: () => Promise<GraphLink[]>;
    createLink: (
      sourceId: string,
      targetId: string,
      label?: string,
      color?: string,
    ) => Promise<GraphLink | { error: string }>;
    removeLink: (id: string) => Promise<{ ok: boolean; error?: string }>;
    openMyGraphWeb: () => Promise<{ ok: boolean; url?: string }>;
  }

  /** Renderer-facing memory IPC surface — mirrors the preload `memory` namespace (Req 7.2, 7.5). */
  interface ElectronMemoryApi {
    list: (agentId: string, limit?: number) => Promise<MemoryItemDTO[]>;
  }

  /**
   * Renderer-facing Live.md surface — mirrors the preload `liveProfile`
   * namespace (CMR-224 Slice 2). Local only: `live_profile` egress is forbidden,
   * so nothing here reaches the shared backend.
   */
  interface ElectronLiveProfileApi {
    read: () => Promise<LiveProfileReadResult>;
    write: (body: string) => Promise<LiveProfileWriteResult>;
    reveal: () => Promise<{ ok: boolean; filePath: string }>;
  }

  /**
   * Renderer-facing graph-agent IPC surface — mirrors the preload `graphAgent`
   * namespace. The Izzi key stays in main; the renderer only sees the reply +
   * branch classification. `classification` is structurally the renderer
   * `BranchClassification` (same 5-type union, same fields).
   */
  interface ElectronGraphAgentApi {
    chat: (payload: {
      node: GraphNode;
      ancestors: GraphNode[];
      message: string;
    }) => Promise<{ reply: string; classification: BranchClassification | null }>;
  }

  /** Renderer-facing izzi-native agent IPC (Socrates/Orchestrator). Key stays in main. */
  interface ElectronIzziAgentApi {
    chat: (payload: {
      systemPrompt: string;
      message: string;
      history?: { role: 'system' | 'user' | 'assistant'; content: string }[];
      model?: string;
    }) => Promise<{ reply: string; error?: string }>;
  }

  /** Affiliate DTOs — mirror the main-process AffiliateClient (money flow). */
  interface AffiliateStats {
    code: string;
    referralLink: string;
    totalReferrals: number;
    pendingVnd: number;
    availableVnd: number;
    paidVnd: number;
    totalEarningsVnd: number;
  }
  interface AffiliateCommission {
    id: string;
    referred_email: string;
    amount_vnd: number;
    commission_vnd: number;
    status: string;
    available_at: string;
    created_at: string;
  }
  interface AffiliateWithdrawal {
    id: string;
    amount_vnd: number;
    method: string;
    status: string;
    created_at: string;
    admin_note?: string;
  }
  interface AffiliateWithdrawInput {
    amount: number;
    method: 'bank_transfer' | 'credit_convert';
    bankInfo?: { bank: string; accountNo: string; accountName: string };
  }
  type AffiliateMutationResult =
    | { success: true; creditsAdded?: number }
    | { success: false; error: string };

  /** Renderer-facing affiliate IPC surface — mirrors the preload `affiliate` namespace. */
  interface ElectronAffiliateApi {
    stats: () => Promise<AffiliateStats | null>;
    commissions: () => Promise<AffiliateCommission[]>;
    withdrawals: () => Promise<AffiliateWithdrawal[]>;
    withdraw: (input: AffiliateWithdrawInput) => Promise<AffiliateMutationResult>;
    convertCredit: (amount: number) => Promise<AffiliateMutationResult>;
    openWeb: () => Promise<{ ok: boolean; url?: string }>;
  }

  interface ElectronMarketingApi {
    getSnapshot: () => Promise<MarketingWorkspaceSnapshot>;
    selectWorkspace: () => Promise<MarketingPathSelectionResult>;
    selectVideoTemplate: () => Promise<MarketingPathSelectionResult>;
    openPath: (relativePath: string) => Promise<{ ok: boolean; error?: string }>;
  }

  interface ElectronCustomerMarketingApi {
    getSnapshot: () => Promise<CustomerMarketingSnapshot>;
    getProductMarketingContext: () => Promise<CustomerProductMarketingContextV1 | null>;
    saveProductMarketingContext: (
      input: CustomerProductMarketingContextSaveInput,
    ) => Promise<CustomerProductMarketingContextMutationResult>;
    listIntegrationCredentials: () => Promise<CustomerMarketingCredentialListResult>;
    revokeIntegrationCredential: (
      input: CustomerMarketingCredentialRevokeInput,
    ) => Promise<CustomerMarketingCredentialRevokeResult>;
    listMarketingResources: (kind: CustomerMarketingResourceKind) => Promise<CustomerMarketingResourceListResult>;
    listMarketingCalendar: (input?: CustomerMarketingCalendarInput) => Promise<CustomerMarketingResourceListResult>;
    getMarketingAnalytics: (input: CustomerMarketingAnalyticsWindow) => Promise<CustomerMarketingAnalyticsResult>;
    listMarketingWorkflowSources: (target: CustomerMarketingWorkflowTarget) => Promise<CustomerMarketingWorkflowSourceListResult>;
    listMarketingWorkflows: (target: CustomerMarketingWorkflowTarget) => Promise<CustomerMarketingWorkflowListResult>;
    prepareMarketingWorkflow: (input: CustomerMarketingWorkflowPrepareRequest) => Promise<CustomerMarketingWorkflowMutationResult>;
    reviewMarketingWorkflow: (input: CustomerMarketingWorkflowReviewRequest) => Promise<CustomerMarketingWorkflowMutationResult>;
    checkExternalActionGate: (input: CustomerMarketingActionGateRequest) => Promise<CustomerMarketingActionGateResult>;
    createMarketingResource: (input: CustomerMarketingResourceCreateInput) => Promise<CustomerMarketingResourceMutationResult>;
    updateMarketingResource: (input: CustomerMarketingResourceUpdateInput) => Promise<CustomerMarketingResourceMutationResult>;
    reviewMarketingResource: (input: CustomerMarketingResourceReviewInput) => Promise<CustomerMarketingResourceMutationResult>;
    archiveMarketingResource: (input: CustomerMarketingResourceArchiveInput) => Promise<CustomerMarketingResourceArchiveResult>;
    listWorkspaceMembers: () => Promise<CustomerWorkspaceMembersResult>;
    updateWorkspaceMemberRole: (input: CustomerWorkspaceMemberRoleInput) => Promise<CustomerWorkspaceMembersResult>;
    createWorkspaceInvitation: (input: CustomerWorkspaceInvitationInput) => Promise<CustomerWorkspaceInvitationResult>;
    retryWorkspaceInvitationCopy: () => Promise<CustomerWorkspaceInvitationResult>;
    consumeWorkspaceInvitationStatus: () => Promise<CustomerWorkspaceInvitationAcceptanceResult | null>;
    onWorkspaceInvitationStatus: (
      listener: (result: CustomerWorkspaceInvitationAcceptanceResult) => void,
    ) => () => void;
    saveOnboarding: (input: CustomerOnboardingInput) => Promise<CustomerMutationResult>;
    createGoal: (input: CustomerGoalInput) => Promise<CustomerMutationResult>;
    askDirector: (input: CustomerDirectorInput) => Promise<CustomerMutationResult>;
    selectMediaProject: () => Promise<CustomerMediaProjectSelectionResult>;
    repairVoiceStudio: () => Promise<CustomerVoiceStudioRepairResult>;
    runMediaPreview: (input: CustomerMediaPreviewInput) => Promise<CustomerMutationResult>;
    reviewApproval: (input: CustomerReviewInput) => Promise<CustomerMutationResult>;
  }
  /**
   * The renderer view of the preload `electronAPI`. The new graph/memory
   * namespaces are typed precisely from the shared models (Req 7.4); all other
   * existing namespaces stay loosely typed via the index signature so this
   * change is purely additive and never regresses existing call sites.
   */
  interface ElectronApi {
    graph?: ElectronGraphApi;
    memory?: ElectronMemoryApi;
    liveProfile?: ElectronLiveProfileApi;
    graphAgent?: ElectronGraphAgentApi;
    izziAgent?: ElectronIzziAgentApi;
    affiliate?: ElectronAffiliateApi;
    marketing?: ElectronMarketingApi;
    customerMarketing?: ElectronCustomerMarketingApi;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }

  interface Window {
    electronAPI?: ElectronApi;
  }
}
