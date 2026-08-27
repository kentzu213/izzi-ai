const fs = require('node:fs');
const { contextBridge, ipcRenderer } = require('electron');

const snapshotPath = process.env.IZZI_MKT04_UI_SNAPSHOT;
if (!snapshotPath) throw new Error('MKT-04 UI snapshot path is required.');
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const workspaceId = snapshot.workspace.id;
const checkedAt = '2026-08-28T00:00:00.000Z';
const routeIds = [
  'marketing.workspace.campaign.v1',
  'marketing.workspace.content.v1',
  'marketing.workspace.asset.v1',
  'marketing.workspace.knowledge.v1',
];
const resources = ['campaign', 'content', 'asset', 'knowledge'];
const platforms = ['facebook', 'instagram', 'linkedin', 'threads', 'tiktok', 'x', 'youtube'];
const allowedOperations = ['read', 'draft', 'validate'];
const deniedOperations = [
  'publish',
  'schedule',
  'send',
  'bulk',
  'spend',
  'integration.write',
  'contacts.write',
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function externalActionAttempted(action) {
  ipcRenderer.send('mkt04-safety:external-action-attempted', action);
  return Promise.reject(new Error('External actions are disabled in the MKT-04 UI smoke.'));
}

const providerRoutes = {
  contractVersion: 'marketing-provider-routes.v1',
  workspaceId,
  checkedAt,
  authority: 'backend_oauth',
  policy: { allowedOperations, deniedOperations, externalExecution: 'blocked' },
  routes: resources.map((resource, index) => ({
    id: routeIds[index],
    resource,
    operations: allowedOperations,
  })),
  providers: platforms.map((platform) => ({
    platform,
    adapter: platform === 'facebook' || platform === 'youtube' ? 'implemented' : 'not_implemented',
    connection: {
      state: 'disconnected',
      counts: { total: 0, ready: 0, expired: 0, needsReauth: 0, revoked: 0, invalid: 0 },
    },
    routeIds,
    workflowReady: true,
    liveReady: false,
  })),
  externalActionPerformed: false,
};

const electronAPI = {
  auth: {
    isAuthenticated: async () => true,
    getUser: async () => ({
      id: 'mkt04-synthetic-user',
      name: 'MKT-04 Reviewer',
      email: 'mkt04@example.invalid',
      plan: 'pro',
      balance: 75,
      activeKeys: 0,
      role: 'user',
      avatar: 'M',
    }),
    onProfileRefreshed: () => () => undefined,
  },
  customerMarketing: {
    getSnapshot: async () => clone(snapshot),
    refreshSnapshot: async () => clone(snapshot),
    onWorkspaceInvitationStatus: () => () => undefined,
    consumeWorkspaceInvitationStatus: async () => null,
    listMarketingWorkflowSources: async () => ({ ok: true, status: 'synced', sources: [] }),
    listMarketingWorkflows: async () => ({ ok: true, status: 'synced', workflows: [] }),
    listIntegrationCredentials: async () => ({
      ok: true,
      status: 'synced',
      vaultState: 'ready',
      credentials: [],
      externalActionPerformed: false,
    }),
    listConnectorOperations: async () => ({
      ok: true,
      status: 'synced',
      receipts: [],
      externalActionPerformed: false,
    }),
    getCanaryReadiness: async () => ({
      ok: false,
      status: 'unavailable',
      credentialState: 'missing',
      privateSandboxChatConfigured: false,
      missingRequirements: ['credential', 'private_sandbox_chat', 'named_approval'],
      controlPlane: null,
      externalActionPerformed: false,
    }),
    checkExternalActionGate: async () => ({
      allowed: false,
      executed: false,
      denialReason: 'policy_denied',
    }),
    configureTelegramSandbox: () => externalActionAttempted('configure-telegram'),
    revokeIntegrationCredential: () => externalActionAttempted('revoke-credential'),
    enableTelegramCanary: () => externalActionAttempted('enable-telegram-canary'),
    sendTelegramCanary: () => externalActionAttempted('send-telegram-canary'),
  },
  nativeMarketing: {
    listWorkspaces: async () => ({
      ok: true,
      workspaces: [{
        id: workspaceId,
        name: 'MKT-04 synthetic workspace',
        role: 'manager',
        plan: 'pro',
        creditsLimit: 80,
        creditsUsed: 13.5,
      }],
    }),
    listAccountHealth: async () => ({
      ok: true,
      health: {
        workspaceId,
        checkedAt,
        authority: 'backend_oauth',
        externalActionPerformed: false,
        accounts: [],
      },
    }),
    listProviderRoutes: async () => ({ ok: true, providerRoutes: clone(providerRoutes) }),
    onOAuthStatus: () => () => undefined,
    createWorkspace: () => externalActionAttempted('create-native-workspace'),
    beginConnect: () => externalActionAttempted('begin-provider-oauth'),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
