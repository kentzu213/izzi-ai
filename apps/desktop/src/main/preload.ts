import { contextBridge, ipcRenderer } from 'electron';
import type {
  AgentBootstrapPayload,
  AgentMemory,
  AgentRun,
  AgentRunEntry,
  AgentRuntimeState,
  AgentSendMessageResult,
  AgentStreamEvent,
  AgentTask,
  AgentTaskStatus,
  ChatSession,
  DiagnosticEvent,
  IntegrationConnection,
  IntegrationProvider,
  OnboardingState,
} from './agent/types';
import type { DesktopUpdaterState } from './updater/types';
import type {
  NativeMarketingAccountListResult,
  NativeMarketingOAuthStateResult,
  NativeMarketingPlatform,
  NativeMarketingPostListResult,
  NativeMarketingPostResult,
  NativeMarketingWorkspaceListResult,
  NativeMarketingWorkspaceResult,
} from './marketing/native-marketing-client';
import type {
  GraphNode,
  GraphLink,
  MemoryItemDTO,
  GraphCommunity,
  GraphSearchHit,
  ImportUrlResult,
  ExtractDocumentResult,
  SynthesizeTopicResult,
} from '../shared/graph-types';
import type {
  LiveProfileReadResult,
  LiveProfileWriteResult,
} from '../shared/memory-trace/live-profile';
import type { ParsedClassification } from './graph/graph-agent-core';
import type { UniverseNodeDetail } from '../shared/universe-adapter';
import type { AgentTurnEvent } from '../shared/agent-turn-events';
import type {
  AffiliateStats,
  AffiliateCommission,
  AffiliateWithdrawal,
  WithdrawInput,
  MutationResult,
} from './affiliate/affiliate-client';
import type {
  MarketingPathSelectionResult,
  MarketingWorkspaceSnapshot,
} from '../shared/marketing-types';
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
  CustomerMarketingWorkflowListResult,
  CustomerMarketingWorkflowMutationResult,
  CustomerMarketingWorkflowPrepareRequest,
  CustomerMarketingWorkflowReviewRequest,
  CustomerMarketingWorkflowSourceListResult,
  CustomerMarketingWorkflowTarget,
  CustomerMarketingResourceReviewInput,
  CustomerMarketingResourceUpdateInput,
  CustomerMediaPreviewInput,
  CustomerMediaVideoPreviewInput,
  CustomerMediaVoicePreviewInput,
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
} from '../shared/customer-marketing-types';
import type {
  CustomerMarketingCredentialListResult,
  CustomerMarketingCredentialRevokeInput,
  CustomerMarketingCredentialRevokeResult,
} from '../shared/customer-marketing-credential-types';
import type {
  CustomerMarketingConnectorHealthInput,
  CustomerMarketingConnectorHealthResult,
  CustomerMarketingConnectorOperationListResult,
} from '../shared/customer-marketing-connector-operation-types';
import type {
  CustomerMarketingCanaryReadinessResult,
  CustomerMarketingTelegramCanaryCandidateRequest,
  CustomerMarketingTelegramCanaryCandidateResult,
  CustomerMarketingTelegramCanaryEnableRequest,
  CustomerMarketingTelegramCanaryEnableResult,
  CustomerMarketingTelegramCanaryNamedApprovalRequest,
  CustomerMarketingTelegramCanaryNamedApprovalResult,
  CustomerMarketingTelegramCanaryRollbackRequest,
  CustomerMarketingTelegramCanaryRollbackResult,
  CustomerMarketingTelegramCanarySendRequest,
  CustomerMarketingTelegramCanarySendResult,
  CustomerMarketingTelegramSandboxSetupInput,
  CustomerMarketingTelegramSandboxSetupResult,
} from '../shared/customer-marketing-canary-types';
import type {
  CustomerMarketingActionGateRequest,
  CustomerMarketingActionGateResult,
} from '../shared/customer-marketing-action-gate-types';
import type {
  CustomerMarketingPageSpeedInput,
  CustomerMarketingPageSpeedResult,
} from '../shared/customer-marketing-pagespeed';

const electronAPI = {
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  },

  auth: {
    login: (credentials: { email: string; password: string }) =>
      ipcRenderer.invoke('auth:login', credentials),
    loginWithGoogle: () => ipcRenderer.invoke('auth:loginWithGoogle'),
    signup: (data: { email: string; password: string; name: string }) =>
      ipcRenderer.invoke('auth:signup', data),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getUser: () => ipcRenderer.invoke('auth:getUser'),
    isAuthenticated: () => ipcRenderer.invoke('auth:isAuthenticated'),
    refreshProfile: () => ipcRenderer.invoke('auth:refreshProfile'),
    onProfileRefreshed: (listener: (user: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => listener(data);
      ipcRenderer.on('auth:profileRefreshed', handler);
      return () => { ipcRenderer.removeListener('auth:profileRefreshed', handler); };
    },
  },

  sync: {
    start: () => ipcRenderer.invoke('sync:start'),
    status: () => ipcRenderer.invoke('sync:status'),
  },

  extensions: {
    list: () => ipcRenderer.invoke('extensions:list'),
    install: (extensionId: string) => ipcRenderer.invoke('extensions:install', extensionId),
    uninstall: (extensionId: string) => ipcRenderer.invoke('extensions:uninstall', extensionId),
    marketplace: (query?: string) => ipcRenderer.invoke('extensions:marketplace', query),
  },

  extensionRuntime: {
    list: () => ipcRenderer.invoke('extensions:runtime:list'),
    start: (extensionId: string) => ipcRenderer.invoke('extensions:runtime:start', extensionId),
    stop: (extensionId: string) => ipcRenderer.invoke('extensions:runtime:stop', extensionId),
    enable: (extensionId: string) => ipcRenderer.invoke('extensions:runtime:enable', extensionId),
    disable: (extensionId: string) => ipcRenderer.invoke('extensions:runtime:disable', extensionId),
    permissions: (extensionId: string) => ipcRenderer.invoke('extensions:runtime:permissions', extensionId),
    grantPermissions: (extensionId: string, permissions: string[]) =>
      ipcRenderer.invoke('extensions:runtime:grantPermissions', extensionId, permissions),
    executeCommand: (extensionId: string, commandId: string, ...args: any[]) =>
      ipcRenderer.invoke('extensions:runtime:executeCommand', extensionId, commandId, ...args),
    getConfig: (extensionId: string) => ipcRenderer.invoke('extensions:runtime:getConfig', extensionId),
    setSetting: (extensionId: string, settingId: string, value: any) =>
      ipcRenderer.invoke('extensions:runtime:setSetting', extensionId, settingId, value),
    installOcx: () => ipcRenderer.invoke('extensions:runtime:installOcx'),
    installFromMarketplace: (extensionId: string) =>
      ipcRenderer.invoke('extensions:runtime:installFromMarketplace', extensionId),
    onUIRequest: (callback: (data: any) => void) => {
      ipcRenderer.on('extension:uiRequest', (_event, data) => callback(data));
    },
    // Managed local backend (the extension's `service` block).
    serviceStatus: (
      extensionId: string,
    ): Promise<{ success: boolean; hasService?: boolean; running?: boolean; healthy?: boolean; ports?: Record<string, number>; error?: string }> =>
      ipcRenderer.invoke('extensions:runtime:serviceStatus', extensionId),
    serviceStop: (extensionId: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('extensions:runtime:serviceStop', extensionId),
    serviceLogs: (extensionId: string, tail?: number): Promise<{ success: boolean; logs?: string; error?: string }> =>
      ipcRenderer.invoke('extensions:runtime:serviceLogs', extensionId, tail),
    onServiceLog: (callback: (data: { extensionId: string; line: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { extensionId: string; line: string }) => callback(data);
      ipcRenderer.on('extension:serviceLog', handler);
      return () => { ipcRenderer.removeListener('extension:serviceLog', handler); };
    },
    onServiceStatus: (callback: (data: { extensionId: string; running: boolean; baseUrl?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { extensionId: string; running: boolean; baseUrl?: string }) => callback(data);
      ipcRenderer.on('extension:serviceStatus', handler);
      return () => { ipcRenderer.removeListener('extension:serviceStatus', handler); };
    },
  },

  extensionUpdates: {
    checkForUpdates: () => ipcRenderer.invoke('extensions:updates:check'),
    getPending: () => ipcRenderer.invoke('extensions:updates:pending'),
  },

  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  },

  setup: {
    checkSystem: () => ipcRenderer.invoke('setup:checkSystem'),
    verifyApiKey: (apiKey: string) => ipcRenderer.invoke('setup:verifyApiKey', apiKey),
    executeSetup: (config: any) => ipcRenderer.invoke('setup:executeSetup', config),
    reinstall: () => ipcRenderer.invoke('setup:reinstall'),
    uninstall: (cleanupConfig: boolean) => ipcRenderer.invoke('setup:uninstall', cleanupConfig),
    versionCheck: () => ipcRenderer.invoke('setup:versionCheck'),
    scanConfig: () => ipcRenderer.invoke('setup:scanConfig'),
    onProgress: (callback: (progress: any) => void) => {
      ipcRenderer.on('setup:progress', (_event, data) => callback(data));
      return () => { ipcRenderer.removeAllListeners('setup:progress'); };
    },
  },

  system: {
    openclawQuickInstall: () => ipcRenderer.invoke('system:openclawQuickInstall'),
    buyApi: () => ipcRenderer.invoke('system:buyApi'),
  },

  dockerAgent: {
    isAvailable: (): Promise<boolean> => ipcRenderer.invoke('dockerAgent:isAvailable'),
    install: (payload: { id: string; dockerImage?: string; defaultPort: number; dockerComposeUrl?: string }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('dockerAgent:install', payload),
    start: (payload: { id: string; dockerImage?: string; defaultPort: number; dockerComposeUrl?: string }): Promise<{ ok: boolean; containerId?: string; error?: string }> =>
      ipcRenderer.invoke('dockerAgent:start', payload),
    stop: (payload: { id: string; dockerImage?: string; defaultPort: number; dockerComposeUrl?: string }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('dockerAgent:stop', payload),
    status: (payload: { id: string; dockerImage?: string; defaultPort: number; dockerComposeUrl?: string }): Promise<{ running: boolean; installed?: boolean; error?: string }> =>
      ipcRenderer.invoke('dockerAgent:status', payload),
    chat: (
      payload: { id: string; defaultPort: number; agentName?: string; reasoningEffort?: string; turnId?: string; images?: string[] },
      message: string,
    ): Promise<{ ok: boolean; reply?: string; error?: string }> =>
      ipcRenderer.invoke(
        'dockerAgent:chat',
        {
          id: payload.id,
          defaultPort: payload.defaultPort,
          agentName: payload.agentName,
          reasoningEffort: payload.reasoningEffort,
          turnId: payload.turnId,
          images: payload.images,
        },
        message,
      ),
    setReasoningEffort: (payload: { id: string; defaultPort: number }, effort: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('dockerAgent:setReasoningEffort', { id: payload.id, defaultPort: payload.defaultPort }, effort),
    healthCheck: (payload: { defaultPort: number; healthEndpoint?: string; timeoutMs?: number }): Promise<{ ok: boolean; status?: number; error?: string }> =>
      ipcRenderer.invoke('dockerAgent:healthCheck', payload),
    onProgress: (listener: (data: { agentId: string; line: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { agentId: string; line: string }) => listener(data);
      ipcRenderer.on('dockerAgent:progress', handler);
      return () => { ipcRenderer.removeListener('dockerAgent:progress', handler); };
    },
  },

  diagnostics: {
    getEvents: () => ipcRenderer.invoke('diagnostics:getEvents'),
  },

  agent: {
    bootstrap: (): Promise<AgentBootstrapPayload> => ipcRenderer.invoke('agent:bootstrap'),
    newSession: (): Promise<ChatSession> => ipcRenderer.invoke('agent:newSession'),
    sendMessage: (sessionId: string, text: string): Promise<AgentSendMessageResult> =>
      ipcRenderer.invoke('agent:sendMessage', sessionId, text),
    getStatus: (sessionId?: string): Promise<AgentRuntimeState> =>
      ipcRenderer.invoke('agent:getStatus', sessionId),
    listTasks: (sessionId?: string): Promise<AgentTask[]> =>
      ipcRenderer.invoke('agent:listTasks', sessionId),
    updateTaskStatus: (taskId: string, status: AgentTaskStatus): Promise<AgentTask | null> =>
      ipcRenderer.invoke('agent:updateTaskStatus', taskId, status),
    listMemories: (sessionId?: string): Promise<AgentMemory[]> =>
      ipcRenderer.invoke('agent:listMemories', sessionId),
    pinMemory: (memoryId: string, pinned: boolean): Promise<AgentMemory | null> =>
      ipcRenderer.invoke('agent:pinMemory', memoryId, pinned),
    deleteMemory: (memoryId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('agent:deleteMemory', memoryId),
    getDiagnostics: (limit?: number): Promise<DiagnosticEvent[]> =>
      ipcRenderer.invoke('agent:getDiagnostics', limit),
    onStream: (listener: (event: AgentStreamEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: AgentStreamEvent) => listener(data);
      ipcRenderer.on('agent:stream', handler);
      return () => {
        ipcRenderer.removeListener('agent:stream', handler);
      };
    },
  },

  customProvider: {
    getConfig: () => ipcRenderer.invoke('customProvider:getConfig'),
    saveConfig: (input: {
      baseUrl: string;
      authType: 'bearer' | 'x-api-key';
      selectedModel: string;
      reasoningEffort?: string;
      apiKey?: string;
    }) => ipcRenderer.invoke('customProvider:saveConfig', input),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('customProvider:setEnabled', enabled),
    deleteKey: () => ipcRenderer.invoke('customProvider:deleteKey'),
    autoConnectLocal: (): Promise<{ ok: boolean; enabled?: boolean; reason?: string }> =>
      ipcRenderer.invoke('customProvider:autoConnectLocal'),
    testConnection: (input?: { apiKey?: string }) =>
      ipcRenderer.invoke('customProvider:testConnection', input),
    listModels: (): Promise<{ ok: boolean; models?: string[]; error?: string }> =>
      ipcRenderer.invoke('customProvider:listModels'),
    chat: (payload: {
      message: string;
      history?: { role: 'system' | 'user' | 'assistant'; content: string }[];
      turnId?: string;
      images?: string[];
      reasoningEffort?: string;
    }): Promise<{ reply?: string; error?: string }> =>
      ipcRenderer.invoke('customProvider:chat', payload),
    abort: (turnId: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('customProvider:abort', turnId),
    inject: (turnId: string, text: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('customProvider:inject', turnId, text),
  },

  agentPermission: {
    getMode: (): Promise<'chat' | 'agent' | 'agent-full'> => ipcRenderer.invoke('agentPermission:getMode'),
    setMode: (
      mode: 'chat' | 'agent' | 'agent-full',
    ): Promise<{ ok: boolean; mode: 'chat' | 'agent' | 'agent-full' }> =>
      ipcRenderer.invoke('agentPermission:setMode', mode),
    getWorkingDir: (): Promise<{ dir: string }> => ipcRenderer.invoke('agentPermission:getWorkingDir'),
    pickWorkingDir: (): Promise<{ dir: string }> => ipcRenderer.invoke('agentPermission:pickWorkingDir'),
    clearWorkingDir: (): Promise<{ dir: string }> => ipcRenderer.invoke('agentPermission:clearWorkingDir'),
  },

  autopost: {
    getStatus: (): Promise<{
      enabled: boolean;
      connected: boolean;
      backendUrl: string;
      workspaceId: string | null;
      accounts: number | null;
    }> => ipcRenderer.invoke('autopost:getStatus'),
    setEnabled: (enabled: boolean): Promise<{ ok: boolean; enabled: boolean; error?: string }> =>
      ipcRenderer.invoke('autopost:setEnabled', enabled),
    listAccounts: (): Promise<{
      ok: boolean;
      accounts?: Array<{ id: string; platform: string; name: string; status: string; active: boolean }>;
      error?: string;
    }> =>
      ipcRenderer.invoke('autopost:listAccounts'),
    beginConnect: (platform: 'facebook' | 'youtube'): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('autopost:beginConnect', platform),
    listPosts: (status?: string): Promise<{ ok: boolean; posts?: unknown[]; error?: string }> =>
      ipcRenderer.invoke('autopost:listPosts', status),
    createDraft: (input: { content: string; title?: string }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('autopost:createDraft', input),
    openWeb: (): Promise<{ ok: boolean; url: string }> => ipcRenderer.invoke('autopost:openWeb'),
  },

  // Native Marketing (native-marketing): the in-app surface backed by IzziAPI
  // /api/marketing. Every result is an allowlisted summary or a bounded error
  // code — the izzi/Supabase access token stays in main and is never bridged.
  nativeMarketing: {
    listWorkspaces: (): Promise<NativeMarketingWorkspaceListResult> =>
      ipcRenderer.invoke('nativeMarketing:listWorkspaces'),
    createWorkspace: (
      input: { name: string; slug?: string },
    ): Promise<NativeMarketingWorkspaceResult> =>
      ipcRenderer.invoke('nativeMarketing:createWorkspace', input),
    listAccounts: (workspaceId: string): Promise<NativeMarketingAccountListResult> =>
      ipcRenderer.invoke('nativeMarketing:listAccounts', workspaceId),
    createOAuthState: (
      workspaceId: string,
      platform: NativeMarketingPlatform,
    ): Promise<NativeMarketingOAuthStateResult> =>
      ipcRenderer.invoke('nativeMarketing:createOAuthState', workspaceId, platform),
    listPosts: (workspaceId: string, status?: string): Promise<NativeMarketingPostListResult> =>
      ipcRenderer.invoke('nativeMarketing:listPosts', workspaceId, status),
    createDraftPost: (
      workspaceId: string,
      input: { platform: NativeMarketingPlatform; content: string; title?: string },
    ): Promise<NativeMarketingPostResult> =>
      ipcRenderer.invoke('nativeMarketing:createDraftPost', workspaceId, input),
  },

  integrations: {
    list: (): Promise<IntegrationConnection[]> => ipcRenderer.invoke('integrations:list'),
    beginConnect: (provider: IntegrationProvider): Promise<{ provider: IntegrationProvider; url: string }> =>
      ipcRenderer.invoke('integrations:beginConnect', provider),
    disconnect: (provider: IntegrationProvider): Promise<IntegrationConnection[]> =>
      ipcRenderer.invoke('integrations:disconnect', provider),
  },

  onboarding: {
    getState: (): Promise<OnboardingState> => ipcRenderer.invoke('onboarding:getState'),
    markSeen: (): Promise<OnboardingState> => ipcRenderer.invoke('onboarding:markSeen'),
    dismiss: (): Promise<OnboardingState> => ipcRenderer.invoke('onboarding:dismiss'),
    complete: (): Promise<OnboardingState> => ipcRenderer.invoke('onboarding:complete'),
  },

  updater: {
    getState: (): Promise<DesktopUpdaterState> => ipcRenderer.invoke('updater:getState'),
    check: (): Promise<DesktopUpdaterState> => ipcRenderer.invoke('updater:check'),
    download: (): Promise<DesktopUpdaterState> => ipcRenderer.invoke('updater:download'),
    quitAndInstall: (): Promise<{ success: boolean }> => ipcRenderer.invoke('updater:quitAndInstall'),
    onState: (listener: (state: DesktopUpdaterState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: DesktopUpdaterState) => listener(data);
      ipcRenderer.on('updater:state', handler);
      return () => {
        ipcRenderer.removeListener('updater:state', handler);
      };
    },
  },

  budget: {
    getStatus: () => ipcRenderer.invoke('budget:getStatus'),
    getLimits: () => ipcRenderer.invoke('budget:getLimits'),
    setLimits: (limits: { daily?: number; weekly?: number; monthly?: number }) =>
      ipcRenderer.invoke('budget:setLimits', limits),
    getAlerts: (since?: number) => ipcRenderer.invoke('budget:getAlerts', since),
    getAdvice: () => ipcRenderer.invoke('budget:getAdvice'),
    purge: (keepDays?: number) => ipcRenderer.invoke('budget:purge', keepDays),
    onAlert: (callback: (alert: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => callback(data);
      ipcRenderer.on('budget:alert', handler);
      return () => { ipcRenderer.removeListener('budget:alert', handler); };
    },
  },

  costGate: {
    evaluate: (request: {
      modelId: string;
      inputText: string;
      expectedOutputTokens?: number;
      isVietnamese?: boolean;
      taskType?: string;
    }) => ipcRenderer.invoke('costGate:evaluate', request),
    getConfig: () => ipcRenderer.invoke('costGate:getConfig'),
    setAutoDowngrade: (enabled: boolean) => ipcRenderer.invoke('costGate:setAutoDowngrade', enabled),
    setMaxCostPerRequest: (usd: number) => ipcRenderer.invoke('costGate:setMaxCostPerRequest', usd),
  },

  smartRouter: {
    route: (taskType: string, inputText: string, isVietnamese?: boolean) =>
      ipcRenderer.invoke('smartRouter:route', taskType, inputText, isVietnamese),
    getPreferences: () => ipcRenderer.invoke('smartRouter:getPreferences'),
    setPreferences: (prefs: any) => ipcRenderer.invoke('smartRouter:setPreferences', prefs),
  },

  agents: {
    list: (): Promise<any[]> => ipcRenderer.invoke('agents:list'),
    install: (params: { bundleId: string; secrets: Record<string, string>; config: Record<string, any> }): Promise<any> =>
      ipcRenderer.invoke('agents:install', params),
    uninstall: (agentId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('agents:uninstall', agentId),
    start: (agentId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('agents:start', agentId),
    stop: (agentId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('agents:stop', agentId),
    getStatus: (agentId: string): Promise<any> =>
      ipcRenderer.invoke('agents:getStatus', agentId),
    configure: (agentId: string, config: Record<string, any>): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('agents:configure', agentId, config),
    sendMessage: (agentId: string, message: string): Promise<any> =>
      ipcRenderer.invoke('agents:sendMessage', agentId, message),
    onEvent: (listener: (event: any) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any) => listener(data);
      ipcRenderer.on('agents:event', handler);
      return () => {
        ipcRenderer.removeListener('agents:event', handler);
      };
    },
  },

  // Live.md — the operator's own memory file. Local only: these channels never
  // reach the shared backend, because `live_profile` egress is forbidden.
  liveProfile: {
    read: (): Promise<LiveProfileReadResult> => ipcRenderer.invoke('liveProfile:read'),
    write: (body: string): Promise<LiveProfileWriteResult> =>
      ipcRenderer.invoke('liveProfile:write', body),
    reveal: (): Promise<{ ok: boolean; filePath: string }> =>
      ipcRenderer.invoke('liveProfile:reveal'),
  },

  graph: {
    list: (): Promise<GraphNode[]> => ipcRenderer.invoke('graph:list'),
    universe: (): Promise<{ nodes: GraphNode[]; links: GraphLink[] }> =>
      ipcRenderer.invoke('graph:universe'),
    nodeDetail: (id: string): Promise<UniverseNodeDetail | null> =>
      ipcRenderer.invoke('graph:nodeDetail', id),
    create: (input: Partial<GraphNode> & { title: string }): Promise<GraphNode | { error: string }> =>
      ipcRenderer.invoke('graph:create', input),
    update: (
      id: string,
      patch: Partial<GraphNode> & { isPublic?: boolean },
    ): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('graph:update', id, patch),
    remove: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('graph:remove', id),
    links: (): Promise<GraphLink[]> => ipcRenderer.invoke('graph:links'),
    createLink: (
      sourceId: string,
      targetId: string,
      label?: string,
      color?: string,
    ): Promise<GraphLink | { error: string }> =>
      ipcRenderer.invoke('graph:createLink', sourceId, targetId, label, color),
    removeLink: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('graph:removeLink', id),
    updateLink: (
      id: string,
      patch: { label?: string; color?: string },
    ): Promise<GraphLink | { error: string }> =>
      ipcRenderer.invoke('graph:updateLink', id, patch),
    openMyGraphWeb: (): Promise<{ ok: boolean; url?: string }> =>
      ipcRenderer.invoke('graph:openMyGraphWeb'),
    // Discovery / knowledge-universe ops (parity with web /aibase/graph).
    search: (query: string, limit?: number): Promise<GraphSearchHit[]> =>
      ipcRenderer.invoke('graph:search', query, limit),
    communities: (): Promise<GraphCommunity[]> =>
      ipcRenderer.invoke('graph:communities'),
    importUrl: (url: string): Promise<ImportUrlResult | { error: string }> =>
      ipcRenderer.invoke('graph:importUrl', url),
    extractDocument: (
      input: { url?: string; text?: string },
    ): Promise<ExtractDocumentResult | { error: string }> =>
      ipcRenderer.invoke('graph:extractDocument', input),
    synthesizeTopic: (
      input: { topic: string; rootTitle?: string; queries?: string[] },
    ): Promise<SynthesizeTopicResult | { error: string }> =>
      ipcRenderer.invoke('graph:synthesizeTopic', input),
  },

  memory: {
    list: (agentId: string, limit?: number): Promise<MemoryItemDTO[]> =>
      ipcRenderer.invoke('memory:list', agentId, limit),
  },
  run: {
    list: (): Promise<AgentRun[]> => ipcRenderer.invoke('run:list'),
    get: (id: string): Promise<{ run: AgentRun | null; entries: AgentRunEntry[] }> =>
      ipcRenderer.invoke('run:get', id),
    create: (goal: string, stage?: string): Promise<AgentRun | null> =>
      ipcRenderer.invoke('run:create', goal, stage),
    appendEntry: (input: {
      runId: string;
      kind?: string;
      stage?: string;
      agentId?: string;
      content: string;
    }): Promise<AgentRunEntry | null> => ipcRenderer.invoke('run:appendEntry', input),
    update: (id: string, patch: { goal?: string; stage?: string; status?: string }): Promise<AgentRun | null> =>
      ipcRenderer.invoke('run:update', id, patch),
  },

  graphAgent: {
    chat: (payload: {
      node: GraphNode;
      ancestors: GraphNode[];
      message: string;
    }): Promise<{ reply: string; classification: ParsedClassification | null }> =>
      ipcRenderer.invoke('graphAgent:chat', payload),
  },

  izziAgent: {
    chat: (payload: {
      systemPrompt: string;
      message: string;
      history?: { role: 'system' | 'user' | 'assistant'; content: string }[];
      model?: string;
      enableTools?: boolean;
      turnId?: string;
      agentId?: string;
      agentName?: string;
      images?: string[];
    }): Promise<{ reply: string; error?: string }> =>
      ipcRenderer.invoke('izziAgent:chat', payload),
  },

  // Live agent "process" stream (main → renderer): content/reasoning/step events
  // emitted during a chat turn, correlated to the assistant message by `turnId`.
  agentStream: {
    onEvent: (listener: (event: AgentTurnEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: AgentTurnEvent) => listener(data);
      ipcRenderer.on('agentStream:event', handler);
      return () => {
        ipcRenderer.removeListener('agentStream:event', handler);
      };
    },
  },

  // Gateway chat-history persistence (main SQLite `user_data`). Survives restart.
  // Sessions carry no secrets (the Izzi key never leaves main).
  gatewaySessions: {
    list: (): Promise<unknown[]> => ipcRenderer.invoke('gatewaySessions:list'),
    save: (session: unknown): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('gatewaySessions:save', session),
    delete: (id: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('gatewaySessions:delete', id),
  },

  marketing: {
    getSnapshot: (): Promise<MarketingWorkspaceSnapshot> =>
      ipcRenderer.invoke('marketing:getSnapshot'),
    selectWorkspace: (): Promise<MarketingPathSelectionResult> =>
      ipcRenderer.invoke('marketing:selectWorkspace'),
    selectVideoTemplate: (): Promise<MarketingPathSelectionResult> =>
      ipcRenderer.invoke('marketing:selectVideoTemplate'),
    openPath: (relativePath: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('marketing:openPath', relativePath),
  },

  customerMarketing: {
    getSnapshot: (): Promise<CustomerMarketingSnapshot> =>
      ipcRenderer.invoke('customerMarketing:getSnapshot'),
    refreshSnapshot: (): Promise<CustomerMarketingSnapshot> =>
      ipcRenderer.invoke('customerMarketing:refreshSnapshot'),
    measurePageSpeed: (
      input: CustomerMarketingPageSpeedInput,
    ): Promise<CustomerMarketingPageSpeedResult> =>
      ipcRenderer.invoke('customerMarketing:measurePageSpeed', input),
    getProductMarketingContext: (): Promise<CustomerProductMarketingContextV1 | null> =>
      ipcRenderer.invoke('customerMarketing:getProductMarketingContext'),
    saveProductMarketingContext: (
      input: CustomerProductMarketingContextSaveInput,
    ): Promise<CustomerProductMarketingContextMutationResult> =>
      ipcRenderer.invoke('customerMarketing:saveProductMarketingContext', input),
    listIntegrationCredentials: (): Promise<CustomerMarketingCredentialListResult> =>
      ipcRenderer.invoke('customerMarketing:listIntegrationCredentials'),
    revokeIntegrationCredential: (
      input: CustomerMarketingCredentialRevokeInput,
    ): Promise<CustomerMarketingCredentialRevokeResult> =>
      ipcRenderer.invoke('customerMarketing:revokeIntegrationCredential', input),
    listConnectorOperations: (): Promise<CustomerMarketingConnectorOperationListResult> =>
      ipcRenderer.invoke('customerMarketing:listConnectorOperations'),
    checkIntegrationHealth: (
      input: CustomerMarketingConnectorHealthInput,
    ): Promise<CustomerMarketingConnectorHealthResult> =>
      ipcRenderer.invoke('customerMarketing:checkIntegrationHealth', input),
    getCanaryReadiness: (): Promise<CustomerMarketingCanaryReadinessResult> =>
      ipcRenderer.invoke('customerMarketing:getCanaryReadiness'),
    configureTelegramSandbox: (
      input: CustomerMarketingTelegramSandboxSetupInput,
    ): Promise<CustomerMarketingTelegramSandboxSetupResult> =>
      ipcRenderer.invoke('customerMarketing:configureTelegramSandbox', input),
    prepareTelegramCanaryCandidate: (
      input: CustomerMarketingTelegramCanaryCandidateRequest,
    ): Promise<CustomerMarketingTelegramCanaryCandidateResult> =>
      ipcRenderer.invoke('customerMarketing:prepareTelegramCanaryCandidate', input),
    approveTelegramCanaryCandidate: (
      input: CustomerMarketingTelegramCanaryNamedApprovalRequest,
    ): Promise<CustomerMarketingTelegramCanaryNamedApprovalResult> =>
      ipcRenderer.invoke('customerMarketing:approveTelegramCanaryCandidate', input),
    enableTelegramCanary: (
      input: CustomerMarketingTelegramCanaryEnableRequest,
    ): Promise<CustomerMarketingTelegramCanaryEnableResult> =>
      ipcRenderer.invoke('customerMarketing:enableTelegramCanary', input),
    rollbackTelegramCanary: (
      input: CustomerMarketingTelegramCanaryRollbackRequest,
    ): Promise<CustomerMarketingTelegramCanaryRollbackResult> =>
      ipcRenderer.invoke('customerMarketing:rollbackTelegramCanary', input),
    sendTelegramCanary: (
      input: CustomerMarketingTelegramCanarySendRequest,
    ): Promise<CustomerMarketingTelegramCanarySendResult> =>
      ipcRenderer.invoke('customerMarketing:sendTelegramCanary', input),
    listMarketingResources: (kind: CustomerMarketingResourceKind): Promise<CustomerMarketingResourceListResult> =>
      ipcRenderer.invoke('customerMarketing:listMarketingResources', kind),
    listMarketingCalendar: (input?: CustomerMarketingCalendarInput): Promise<CustomerMarketingResourceListResult> =>
      ipcRenderer.invoke('customerMarketing:listMarketingCalendar', input),
    getMarketingAnalytics: (input: CustomerMarketingAnalyticsWindow): Promise<CustomerMarketingAnalyticsResult> =>
      ipcRenderer.invoke('customerMarketing:getMarketingAnalytics', input),
    listMarketingWorkflowSources: (target: CustomerMarketingWorkflowTarget): Promise<CustomerMarketingWorkflowSourceListResult> =>
      ipcRenderer.invoke('customerMarketing:listMarketingWorkflowSources', target),
    listMarketingWorkflows: (target: CustomerMarketingWorkflowTarget): Promise<CustomerMarketingWorkflowListResult> =>
      ipcRenderer.invoke('customerMarketing:listMarketingWorkflows', target),
    prepareMarketingWorkflow: (input: CustomerMarketingWorkflowPrepareRequest): Promise<CustomerMarketingWorkflowMutationResult> =>
      ipcRenderer.invoke('customerMarketing:prepareMarketingWorkflow', input),
    reviewMarketingWorkflow: (input: CustomerMarketingWorkflowReviewRequest): Promise<CustomerMarketingWorkflowMutationResult> =>
      ipcRenderer.invoke('customerMarketing:reviewMarketingWorkflow', input),
    checkExternalActionGate: (input: CustomerMarketingActionGateRequest): Promise<CustomerMarketingActionGateResult> =>
      ipcRenderer.invoke('customerMarketing:checkExternalActionGate', input),
    createMarketingResource: (input: CustomerMarketingResourceCreateInput): Promise<CustomerMarketingResourceMutationResult> =>
      ipcRenderer.invoke('customerMarketing:createMarketingResource', input),
    updateMarketingResource: (input: CustomerMarketingResourceUpdateInput): Promise<CustomerMarketingResourceMutationResult> =>
      ipcRenderer.invoke('customerMarketing:updateMarketingResource', input),
    reviewMarketingResource: (input: CustomerMarketingResourceReviewInput): Promise<CustomerMarketingResourceMutationResult> =>
      ipcRenderer.invoke('customerMarketing:reviewMarketingResource', input),
    archiveMarketingResource: (input: CustomerMarketingResourceArchiveInput): Promise<CustomerMarketingResourceArchiveResult> =>
      ipcRenderer.invoke('customerMarketing:archiveMarketingResource', input),
    listWorkspaceMembers: (): Promise<CustomerWorkspaceMembersResult> =>
      ipcRenderer.invoke('customerMarketing:listWorkspaceMembers'),
    updateWorkspaceMemberRole: (input: CustomerWorkspaceMemberRoleInput): Promise<CustomerWorkspaceMembersResult> =>
      ipcRenderer.invoke('customerMarketing:updateWorkspaceMemberRole', input),
    createWorkspaceInvitation: (input: CustomerWorkspaceInvitationInput): Promise<CustomerWorkspaceInvitationResult> =>
      ipcRenderer.invoke('customerMarketing:createWorkspaceInvitation', input),
    retryWorkspaceInvitationCopy: (): Promise<CustomerWorkspaceInvitationResult> =>
      ipcRenderer.invoke('customerMarketing:retryWorkspaceInvitationCopy'),
    consumeWorkspaceInvitationStatus: (): Promise<CustomerWorkspaceInvitationAcceptanceResult | null> =>
      ipcRenderer.invoke('customerMarketing:consumeWorkspaceInvitationStatus'),
    onWorkspaceInvitationStatus: (
      listener: (result: CustomerWorkspaceInvitationAcceptanceResult) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        result: CustomerWorkspaceInvitationAcceptanceResult,
      ) => listener(result);
      ipcRenderer.on('customerMarketing:invitationStatus', handler);
      return () => {
        ipcRenderer.removeListener('customerMarketing:invitationStatus', handler);
      };
    },
    saveOnboarding: (input: CustomerOnboardingInput): Promise<CustomerMutationResult> =>
      ipcRenderer.invoke('customerMarketing:saveOnboarding', input),
    createGoal: (input: CustomerGoalInput): Promise<CustomerMutationResult> =>
      ipcRenderer.invoke('customerMarketing:createGoal', input),
    askDirector: (input: CustomerDirectorInput): Promise<CustomerMutationResult> =>
      ipcRenderer.invoke('customerMarketing:askDirector', input),
    selectMediaProject: (): Promise<CustomerMediaProjectSelectionResult> =>
      ipcRenderer.invoke('customerMarketing:selectMediaProject'),
    repairVoiceStudio: (): Promise<CustomerVoiceStudioRepairResult> =>
      ipcRenderer.invoke('customerMarketing:repairVoiceStudio'),
    runMediaPreview: (input: CustomerMediaPreviewInput): Promise<CustomerMutationResult> =>
      ipcRenderer.invoke('customerMarketing:runMediaPreview', input),
    createMediaVoicePreview: (input: CustomerMediaVoicePreviewInput): Promise<CustomerMutationResult> =>
      ipcRenderer.invoke('customerMarketing:createMediaVoicePreview', input),
    createMediaVideoPreview: (input: CustomerMediaVideoPreviewInput): Promise<CustomerMutationResult> =>
      ipcRenderer.invoke('customerMarketing:createMediaVideoPreview', input),
    openMediaVideoPreview: (input: CustomerMediaVideoPreviewInput): Promise<CustomerMutationResult> =>
      ipcRenderer.invoke('customerMarketing:openMediaVideoPreview', input),
    reviewApproval: (input: CustomerReviewInput): Promise<CustomerMutationResult> =>
      ipcRenderer.invoke('customerMarketing:reviewApproval', input),
  },

  affiliate: {
    stats: (): Promise<AffiliateStats | null> => ipcRenderer.invoke('affiliate:stats'),
    commissions: (): Promise<AffiliateCommission[]> => ipcRenderer.invoke('affiliate:commissions'),
    withdrawals: (): Promise<AffiliateWithdrawal[]> => ipcRenderer.invoke('affiliate:withdrawals'),
    withdraw: (input: WithdrawInput): Promise<MutationResult> =>
      ipcRenderer.invoke('affiliate:withdraw', input),
    convertCredit: (amount: number): Promise<MutationResult> =>
      ipcRenderer.invoke('affiliate:convertCredit', amount),
    openWeb: (): Promise<{ ok: boolean; url?: string }> =>
      ipcRenderer.invoke('affiliate:openWeb'),
  },

  // Scheduled Sessions (spec: scheduled-sessions). The renderer picks a playbook by id plus a time;
  // it never passes a command, so this bridge cannot be used to run arbitrary shell input (R5.1).
  schedule: {
    playbooks: (): Promise<unknown[]> => ipcRenderer.invoke('schedule:playbooks'),
    list: (): Promise<unknown[]> => ipcRenderer.invoke('schedule:list'),
    create: (input: unknown): Promise<{ ok: boolean; session?: unknown; error?: string }> =>
      ipcRenderer.invoke('schedule:create', input),
    setEnabled: (id: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('schedule:setEnabled', id, enabled),
    remove: (id: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('schedule:remove', id),
    runNow: (id: string): Promise<{ ok: boolean; runId?: string; error?: string }> =>
      ipcRenderer.invoke('schedule:runNow', id),
    runs: (id: string, limit?: number): Promise<unknown[]> =>
      ipcRenderer.invoke('schedule:runs', id, limit),
    profileHealth: (): Promise<unknown[]> => ipcRenderer.invoke('schedule:profileHealth'),
    openProfile: (profileDir: string, url?: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke('schedule:openProfile', profileDir, url),
  },

  platform: {
    isElectron: true,
    os: process.platform,
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
