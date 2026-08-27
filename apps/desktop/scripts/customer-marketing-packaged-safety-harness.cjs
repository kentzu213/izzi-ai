const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const path = require('node:path');
const tls = require('node:tls');

const SUITE_VERSION = 'mkt-04.v1';
const SYNTHETIC_SECRET = 'synthetic-secret-must-not-leak';
const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-08-28T00:00:00.000Z');

class SafetySuiteError extends Error {
  constructor(code) {
    super(code);
    this.name = 'SafetySuiteError';
    this.code = code;
  }
}

class MemorySettings {
  constructor() {
    this.values = new Map();
  }

  getSetting(key) {
    return this.values.get(key) ?? null;
  }

  setSetting(key, value) {
    this.values.set(key, value);
  }

  setSettingIfAbsent(key, value) {
    if (this.values.has(key)) return false;
    this.values.set(key, value);
    return true;
  }

  deleteSetting(key) {
    this.values.delete(key);
  }

  withSettingsTransaction(operation) {
    const before = new Map(this.values);
    try {
      return operation();
    } catch (error) {
      this.values = before;
      throw error;
    }
  }
}

function ensure(value, code) {
  if (!value) throw new SafetySuiteError(code);
}

function installNetworkDeny(onAttempt) {
  const replacements = [
    [http, 'request'],
    [http, 'get'],
    [https, 'request'],
    [https, 'get'],
    [net, 'connect'],
    [net, 'createConnection'],
    [tls, 'connect'],
  ];
  const originals = replacements.map(([owner, key]) => [owner, key, owner[key]]);
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  const deny = () => {
    onAttempt();
    throw new SafetySuiteError('unexpected-network-attempt');
  };
  for (const [owner, key] of replacements) owner[key] = deny;
  globalThis.fetch = async () => deny();
  globalThis.WebSocket = class DeniedWebSocket {
    constructor() {
      deny();
    }
  };
  return () => {
    for (const [owner, key, original] of originals) owner[key] = original;
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
  };
}

function loadRuntime(appRoot) {
  const resolvedRoot = path.resolve(appRoot);
  const distRoot = path.join(resolvedRoot, 'dist');
  const packageJson = JSON.parse(fs.readFileSync(path.join(resolvedRoot, 'package.json'), 'utf8'));
  const actionGate = require(path.join(
    distRoot,
    'main/customer-marketing/customer-marketing-action-gate.js',
  ));
  const guardrails = require(path.join(
    distRoot,
    'main/customer-marketing/customer-marketing-loop-guardrails.js',
  ));
  const workflowStore = require(path.join(
    distRoot,
    'main/customer-marketing/customer-marketing-workflow-store.js',
  ));
  const workflowWrappers = require(path.join(
    distRoot,
    'main/customer-marketing/customer-marketing-workflow-wrappers.js',
  ));
  const service = require(path.join(
    distRoot,
    'main/customer-marketing/customer-marketing-service.js',
  ));
  const nativeMarketing = require(path.join(distRoot, 'main/marketing/native-marketing-client.js'));
  return {
    appVersion: packageJson.version,
    actionGate,
    guardrails,
    workflowStore,
    workflowWrappers,
    service,
    nativeMarketing,
  };
}

function actionRequest(action) {
  const variants = {
    publish: {
      target: 'social',
      provider: 'facebook',
      metadata: { itemCount: 1, recipientCount: 0, spendVnd: 0 },
    },
    spend: {
      target: 'social',
      provider: 'facebook',
      metadata: { itemCount: 0, recipientCount: 0, spendVnd: 1 },
    },
    bulk_email: {
      target: 'email',
      provider: 'email',
      metadata: { itemCount: 1, recipientCount: 1, spendVnd: 0 },
    },
    destructive: {
      target: 'crm',
      provider: 'crm',
      metadata: { itemCount: 1, recipientCount: 0, spendVnd: 0 },
    },
  };
  const variant = variants[action];
  return {
    action,
    target: variant.target,
    workflowId: `mkt04-${action}-workflow`,
    approvalId: `mkt04-${action}-approval`,
    manifestDigest: 'a'.repeat(64),
    provider: variant.provider,
    metadata: variant.metadata,
  };
}

function approvedWorkflow(request) {
  const sourceKind = request.target === 'crm' ? 'campaign' : 'content';
  return {
    workflowId: request.workflowId,
    approvalId: request.approvalId,
    manifestDigest: request.manifestDigest,
    status: 'approved',
    manifest: {
      kind: request.target,
      title: 'MKT-04 synthetic dry-run',
      workspaceHash: 'e'.repeat(64),
      inputRef: {
        id: `mkt04-${sourceKind}`,
        kind: sourceKind,
        revision: 1,
        sha256: 'b'.repeat(64),
      },
      grant: {
        operations: ['read', 'draft', 'validate'],
        channels: [request.target],
        limits: { maxItems: 1, maxRecipients: 0, maxSpendVnd: 0 },
        expiresAt: new Date(NOW + 60_000).toISOString(),
        policyRevision: 'cmr-306.v1',
      },
      dryRun: {
        steps: ['validate'],
        outputs: ['manifest'],
        warnings: ['Synthetic local-only check'],
        externalActionPerformed: false,
      },
      nonce: 'mkt04-nonce',
      createdAt: new Date(NOW - 60_000).toISOString(),
    },
    receipt: {
      id: `mkt04-${request.action}-receipt`,
      workflowId: request.workflowId,
      approvalId: request.approvalId,
      manifestDigest: request.manifestDigest,
      decision: 'approved',
      reviewerHash: 'c'.repeat(64),
      reviewedAt: new Date(NOW - 1_000).toISOString(),
      policyRevision: 'cmr-306.v1',
      externalActionPerformed: false,
      receiptDigest: 'd'.repeat(64),
    },
  };
}

function runActionGateChecks(runtime) {
  const results = {};
  for (const action of ['publish', 'spend', 'bulk_email', 'destructive']) {
    const request = actionRequest(action);
    const workflow = approvedWorkflow(request);
    const result = runtime.actionGate.evaluateCustomerMarketingActionGate({
      request,
      workflow,
      source: {
        ...workflow.manifest.inputRef,
        status: 'approved',
      },
      nowMs: NOW,
    });
    ensure(result.allowed === false, `${action}-unexpectedly-allowed`);
    ensure(result.executed === false, `${action}-unexpectedly-executed`);
    ensure(result.denialReason === 'policy_denied', `${action}-wrong-denial`);
    results[action] = result.denialReason;
  }
  const killSwitch = runtime.guardrails.evaluateCustomerMarketingKillSwitch({
    killSwitch: { engaged: true, source: 'file' },
  });
  ensure(killSwitch?.denialReason === 'kill_switch_engaged', 'kill-switch-not-enforced');
  const cap = runtime.guardrails.evaluateCustomerMarketingSpendAndVolumeCaps(
    actionRequest('spend'),
    {
      policy: {
        ...runtime.guardrails.CUSTOMER_MARKETING_GUARDRAIL_DEFAULT_POLICY,
        maxSpendVndPerRun: 1,
      },
      spendVndUsedInWindow: 2_000_000,
    },
  );
  ensure(cap?.denialReason === 'policy_denied', 'spend-window-cap-not-enforced');
  ensure(
    runtime.actionGate.CUSTOMER_MARKETING_ACTION_GATE_EXECUTOR_ENABLED === false,
    'action-executor-enabled',
  );
  return {
    ...results,
    killSwitch: killSwitch.denialReason,
    spendWindowCap: cap.denialReason,
    executorEnabled: false,
  };
}

function emptyConnectionCounts() {
  return { total: 0, ready: 0, expired: 0, needsReauth: 0, revoked: 0, invalid: 0 };
}

function providerRoutesEnvelope(nativeMarketing, overrides = {}) {
  const routeIds = nativeMarketing.NATIVE_MARKETING_PROVIDER_ROUTE_IDS;
  const routes = nativeMarketing.NATIVE_MARKETING_PROVIDER_ROUTE_RESOURCES.map((resource, index) => ({
    id: routeIds[index],
    resource,
    operations: [...nativeMarketing.NATIVE_MARKETING_PROVIDER_ALLOWED_OPERATIONS],
  }));
  const providers = nativeMarketing.NATIVE_MARKETING_PROVIDER_PLATFORMS.map((platform) => ({
    platform,
    adapter: platform === 'facebook' || platform === 'youtube' ? 'implemented' : 'not_implemented',
    connection: { state: 'disconnected', counts: emptyConnectionCounts() },
    routeIds: [...routeIds],
    workflowReady: true,
    liveReady: false,
    accessToken: SYNTHETIC_SECRET,
    providerPayload: { secret: SYNTHETIC_SECRET },
  }));
  return {
    success: true,
    contractVersion: 'marketing-provider-routes.v1',
    workspaceId: WORKSPACE_ID,
    checkedAt: new Date(NOW).toISOString(),
    authority: 'backend_oauth',
    policy: {
      allowedOperations: [...nativeMarketing.NATIVE_MARKETING_PROVIDER_ALLOWED_OPERATIONS],
      deniedOperations: [...nativeMarketing.NATIVE_MARKETING_PROVIDER_DENIED_OPERATIONS],
      externalExecution: 'blocked',
    },
    routes,
    providers,
    externalActionPerformed: false,
    rawProviderToken: SYNTHETIC_SECRET,
    ...overrides,
  };
}

function runProviderRouteChecks(runtime) {
  const nativeMarketing = runtime.nativeMarketing;
  const parsed = nativeMarketing.parseNativeMarketingProviderRoutes(
    providerRoutesEnvelope(nativeMarketing),
    WORKSPACE_ID,
  );
  ensure(parsed, 'provider-route-rejected-safe-envelope');
  ensure(parsed.policy.externalExecution === 'blocked', 'provider-execution-not-blocked');
  ensure(parsed.externalActionPerformed === false, 'provider-route-reported-action');
  ensure(parsed.providers.every((provider) => provider.liveReady === false), 'provider-live-ready');
  ensure(!JSON.stringify(parsed).includes(SYNTHETIC_SECRET), 'provider-secret-leaked');
  const unsafe = nativeMarketing.parseNativeMarketingProviderRoutes(
    providerRoutesEnvelope(nativeMarketing, {
      policy: {
        allowedOperations: [...nativeMarketing.NATIVE_MARKETING_PROVIDER_ALLOWED_OPERATIONS],
        deniedOperations: [...nativeMarketing.NATIVE_MARKETING_PROVIDER_DENIED_OPERATIONS],
        externalExecution: 'allowed',
      },
    }),
    WORKSPACE_ID,
  );
  ensure(unsafe === null, 'provider-route-accepted-external-execution');
  return {
    authority: parsed.authority,
    externalExecution: parsed.policy.externalExecution,
    providerCount: parsed.providers.length,
    workflowReadyCount: parsed.providers.filter((provider) => provider.workflowReady).length,
    liveReadyCount: parsed.providers.filter((provider) => provider.liveReady).length,
    unsafeEnvelopeRejected: true,
  };
}

function runWorkflowRecoveryChecks(runtime) {
  const settings = new MemorySettings();
  let clock = NOW;
  let sequence = 0;
  const makeStore = () => new runtime.workflowStore.CustomerMarketingWorkflowStore(
    settings,
    'mkt04-recovery-workspace',
    {
      now: () => clock,
      createId: () => `mkt04-lease-${++sequence}`,
      retryBaseDelayMs: 1_000,
    },
  );
  const first = makeStore();
  first.createWorkflow({ id: 'mkt04-recovery', jobs: [{ id: 'draft', maxAttempts: 3 }] });
  first.claimNextJob('mkt04-recovery', { workerId: 'worker-a', leaseMs: 500 });
  clock += 500;
  const second = makeStore();
  ensure(second.recoverStaleJobs() === 1, 'stale-lease-not-recovered');
  second.resumeWorkflow('mkt04-recovery');
  ensure(second.claimNextJob('mkt04-recovery', { workerId: 'worker-b' }) === null, 'retry-backoff-skipped');
  clock += 1_000;
  const resumed = second.claimNextJob('mkt04-recovery', { workerId: 'worker-b' });
  ensure(resumed?.attempts === 2 && resumed.status === 'running', 'recovered-job-not-resumed-once');

  const reviewSettings = new MemorySettings();
  let nonce = 0;
  const reviewStore = new runtime.workflowStore.CustomerMarketingWorkflowStore(
    reviewSettings,
    'mkt04-review-workspace',
    { now: () => NOW, createId: () => `mkt04-review-lease-${++sequence}` },
  );
  const wrappers = runtime.workflowWrappers.createCustomerMarketingWorkflowWrappers(
    reviewStore,
    'mkt04-review-workspace',
    { now: () => NOW, createId: () => `mkt04-nonce-${++nonce}` },
  );
  const prepared = wrappers.social.prepare({
    target: 'social',
    inputRef: {
      id: 'mkt04-content',
      workspaceId: 'mkt04-review-workspace',
      kind: 'content',
      revision: 1,
      sha256: 'f'.repeat(64),
      title: 'MKT-04 synthetic content',
    },
  });
  const reviewInput = {
    workflowId: prepared.workflowId,
    approvalId: prepared.approvalId,
    manifestDigest: prepared.manifestDigest,
    decision: 'approved',
    reviewerHash: '9'.repeat(64),
  };
  const firstReview = wrappers.social.review(reviewInput);
  const revision = reviewStore.getSnapshot().revision;
  const replay = wrappers.social.review(reviewInput);
  ensure(JSON.stringify(replay) === JSON.stringify(firstReview), 'approval-replay-changed-result');
  ensure(reviewStore.getSnapshot().revision === revision, 'approval-replay-changed-revision');
  return {
    recoveredLeaseCount: 1,
    resumedAttemptCount: resumed.attempts,
    retryBackoffEnforced: true,
    approvalReplayIdempotent: true,
  };
}

function onboardingProfile() {
  return {
    business: {
      name: 'IzziAPI MKT-04',
      industry: 'API software',
      website: 'https://izziapi.com/',
      offer: 'A controlled API catalog for AI workflows',
      region: 'Vietnam',
    },
    brand: {
      logoUrl: '',
      primaryColor: '#18c7b5',
      accentColor: '#f0b35b',
      font: 'Inter',
      tone: 'Clear and practical',
      guidelines: 'Use evidence-backed claims.',
      wordsToUse: ['practical'],
      wordsToAvoid: ['guaranteed'],
    },
    audience: {
      segments: 'Developers and small operations teams',
      needs: 'Repeatable AI workflows',
      painPoints: 'Limited integration time and budget',
      behaviors: 'Reviews evidence before adoption',
      market: 'Vietnam and international',
    },
    objectives: ['leads'],
    channels: ['facebook'],
    resources: ['https://izziapi.com/'],
    automationMode: 'semi_autonomous',
    completedSteps: [1, 2, 3, 4, 5, 6, 7],
  };
}

function productContext(authorityToken) {
  return {
    authorityToken,
    expectedRevision: 0,
    product: {
      productName: 'IzziAPI',
      category: { vi: 'API platform', en: 'API platform' },
      positioning: {
        vi: 'One controlled API surface for AI workflows.',
        en: 'One controlled API surface for AI workflows.',
      },
      targetAudience: {
        vi: 'Developers and small operations teams.',
        en: 'Developers and small operations teams.',
      },
      valueProposition: {
        vi: 'Reduce integration time while retaining operational control.',
        en: 'Reduce integration time while retaining operational control.',
      },
      brandVoice: {
        vi: 'Clear, practical and evidence-led.',
        en: 'Clear, practical and evidence-led.',
      },
      callToAction: {
        vi: 'Try a workflow that fits your use case.',
        en: 'Try a workflow that fits your use case.',
      },
      proofClaims: [{
        id: 'proof-api-catalog',
        text: {
          vi: 'IzziAPI provides an API catalog for multiple AI workflows.',
          en: 'IzziAPI provides an API catalog for multiple AI workflows.',
        },
        sourceIds: ['source-site', 'source-repo'],
      }],
      prohibitedClaims: [{
        id: 'no-guaranteed-results',
        text: {
          vi: 'Guaranteed marketing or revenue outcomes.',
          en: 'Guaranteed marketing or revenue outcomes.',
        },
        reason: {
          vi: 'Outcomes depend on data, channels, budget and execution.',
          en: 'Outcomes depend on data, channels, budget and execution.',
        },
      }],
    },
    sources: [{
      id: 'source-site',
      title: 'IzziAPI product site',
      url: 'https://izziapi.com/',
      excerpt: 'Synthetic product evidence used by the packaged safety suite.',
    }, {
      id: 'source-repo',
      title: 'Izzi AI repository',
      url: 'https://github.com/kentzu213/izzi-ai',
      excerpt: 'Synthetic implementation evidence used by the packaged safety suite.',
    }],
  };
}

function modelReply() {
  return JSON.stringify({
    schemaVersion: 1,
    strategySummary: 'Create one evidence-led Facebook draft for reviewer approval.',
    contentDraft: {
      channel: 'facebook',
      locale: 'en',
      title: 'One controlled API surface for small AI teams',
      body: 'proof-api-catalog: Review the API catalog and select a workflow for your use case.',
      callToAction: 'Try a workflow that fits your use case.',
    },
    approvalNote: 'Review the proof claim and call to action before any external action.',
  });
}

function modelExecution() {
  return {
    requestedModel: 'gpt-5.6-sol',
    servedModel: 'gpt-5.6-sol',
    usage: { promptTokens: 640, completionTokens: 180, totalTokens: 820, cachedTokens: 120 },
  };
}

function findModelEvidence(settings) {
  for (const [key, value] of settings.values.entries()) {
    if (!key.startsWith('customer_marketing_workflows:v1:')) continue;
    const durable = JSON.parse(value);
    for (const approval of durable.approvals ?? []) {
      const artifact = durable.artifacts?.find((candidate) => candidate.id === approval.artifactId);
      if (!artifact?.content) continue;
      const evidence = JSON.parse(artifact.content);
      if (evidence.modelExecution) return evidence;
    }
  }
  return null;
}

async function runModelAndBillingChecks(runtime) {
  const settings = new MemorySettings();
  const profile = onboardingProfile();
  const workspace = {
    id: WORKSPACE_ID,
    name: 'MKT-04 synthetic workspace',
    role: 'manager',
    plan: 'pro',
    quota: { creditsLimit: 80, creditsUsed: 12.5 },
  };
  let reservationCount = 0;
  const reservationKeys = [];
  const directorCalls = [];
  const workspaceGateway = {
    getCurrent: async () => ({ status: 'synced', workspace }),
    ensureWorkspace: async () => ({ status: 'synced', workspace }),
    getCapabilities: async () => ({
      status: 'synced',
      revision: 1,
      capabilities: runtime.service.buildCustomerCapabilities([]),
    }),
    getProfile: async () => ({
      status: 'synced',
      profile: {
        ...profile,
        workspaceId: WORKSPACE_ID,
        completed: true,
        revision: 1,
        updatedAt: new Date(NOW).toISOString(),
      },
    }),
    updateProfile: async (input) => ({
      status: 'synced',
      profile: {
        ...input.profile,
        workspaceId: input.workspaceId,
        completed: true,
        revision: input.expectedRevision + 1,
        updatedAt: new Date(NOW).toISOString(),
      },
    }),
    listMembers: async () => ({ status: 'local', members: [] }),
    updateMemberRole: async () => ({ status: 'local', member: null }),
    createInvitation: async () => ({ status: 'local', invitation: null, inviteToken: null }),
    acceptInvitation: async () => ({ status: 'local', workspaceId: null, role: null }),
    reserveQuota: async (input) => {
      reservationCount += 1;
      reservationKeys.push(input.idempotencyKey);
      workspace.quota = { creditsLimit: 80, creditsUsed: 13.5 };
      return { status: 'reserved', duplicate: false, quota: workspace.quota };
    },
  };
  const director = async (payload, options) => {
    directorCalls.push({ payload, options });
    if (directorCalls.length === 1) return { reply: '', error: 'network' };
    return { reply: modelReply(), execution: modelExecution() };
  };
  const service = new runtime.service.CustomerMarketingService(
    settings,
    () => ({ id: 'mkt04-user', name: 'MKT-04 Reviewer', plan: 'pro', balance: 75 }),
    () => [],
    director,
    null,
    workspaceGateway,
    undefined,
    null,
    runtime.guardrails.createCustomerMarketingGuardrailStateReader({
      env: {},
      spendVndUsedInWindow: () => 0,
    }),
    undefined,
    () => [],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    null,
    { preview: async () => ({ status: 'unavailable' }) },
    null,
    true,
  );
  const onboarding = await service.saveOnboarding(profile);
  const authorityToken = onboarding.snapshot?.productMarketingContextAuthority?.authorityToken;
  ensure(onboarding.ok && authorityToken, 'synthetic-onboarding-failed');
  const context = await service.saveProductMarketingContext(productContext(authorityToken));
  ensure(context.ok, 'synthetic-product-context-failed');
  const result = await service.askDirector({
    goal: 'Create one evidence-led Facebook draft for the next seven days.',
    channels: ['facebook'],
    automationMode: 'semi_autonomous',
  });
  ensure(result.ok === true, 'model-draft-failed');
  const run = result.snapshot?.runs?.[0];
  const approval = result.snapshot?.approvals?.[0];
  const evidence = findModelEvidence(settings);
  const execution = evidence?.modelExecution;
  ensure(run?.status === 'awaiting_approval', 'model-run-not-awaiting-approval');
  ensure(approval?.status === 'pending', 'model-approval-not-pending');
  ensure(directorCalls.length === 2, 'model-retry-count-invalid');
  ensure(
    JSON.stringify(directorCalls[0]) === JSON.stringify(directorCalls[1]),
    'model-retry-payload-changed',
  );
  ensure(reservationCount === 1, 'quota-reserved-more-than-once');
  ensure(reservationKeys.length === 1, 'quota-idempotency-key-count-invalid');
  ensure(execution?.requestedModel === 'gpt-5.6-sol', 'model-requested-route-invalid');
  ensure(execution?.servedModel === 'gpt-5.6-sol', 'model-served-route-invalid');
  ensure(execution?.toolsEnabled === false, 'model-tools-enabled');
  ensure(execution?.externalActionPerformed === false, 'model-external-action-reported');
  ensure(execution?.cost?.reservedUnits === 1, 'model-reserved-cost-invalid');
  ensure(execution?.cost?.workspaceCreditsUsedAfterReservation === 13.5, 'model-cost-snapshot-invalid');
  ensure(result.snapshot.externalActionsAllowed === false, 'snapshot-external-actions-allowed');
  ensure(!JSON.stringify(evidence).includes('marketing-draft:'), 'raw-model-idempotency-key-leaked');
  const billingQuotaReconciled = workspace.quota.creditsUsed - 12.5 === 1
    && execution.cost.reservedUnits === 1
    && execution.cost.workspaceCreditsUsedAfterReservation === workspace.quota.creditsUsed;
  ensure(billingQuotaReconciled, 'billing-quota-reconciliation-failed');
  const modelDraftPendingApproval = run.status === 'awaiting_approval' && approval.status === 'pending';
  ensure(modelDraftPendingApproval, 'model-draft-pending-approval-failed');
  return {
    snapshot: result.snapshot,
    checks: {
      billingQuotaReconciled,
      modelDraftPendingApproval,
      reservationCount,
      reservedUnits: execution.cost.reservedUnits,
      creditsBefore: 12.5,
      creditsAfter: workspace.quota.creditsUsed,
      modelAttempts: directorCalls.length,
      retryPayloadStable: true,
      requestedModel: execution.requestedModel,
      servedModel: execution.servedModel,
      toolsEnabled: execution.toolsEnabled,
      provenanceHashesValid: [
        execution.promptSha256,
        execution.responseSha256,
        execution.idempotencyKeySha256,
      ].every((digest) => /^[a-f0-9]{64}$/.test(digest)),
      approvalStatus: approval.status,
      runStatus: run.status,
    },
  };
}

async function runSuite(appRoot, snapshotPath) {
  let externalNetworkAttempts = 0;
  const restoreNetwork = installNetworkDeny(() => {
    externalNetworkAttempts += 1;
  });
  try {
    const runtime = loadRuntime(appRoot);
    const actionGates = runActionGateChecks(runtime);
    const providerRoutes = runProviderRouteChecks(runtime);
    const workflowRecovery = runWorkflowRecoveryChecks(runtime);
    const model = await runModelAndBillingChecks(runtime);
    ensure(externalNetworkAttempts === 0, 'unexpected-network-attempt');
    const snapshotJson = JSON.stringify(model.snapshot);
    ensure(!snapshotJson.includes(SYNTHETIC_SECRET), 'snapshot-secret-leaked');
    if (snapshotPath) {
      const resolvedSnapshot = path.resolve(snapshotPath);
      fs.mkdirSync(path.dirname(resolvedSnapshot), { recursive: true });
      fs.writeFileSync(resolvedSnapshot, `${snapshotJson}\n`, { encoding: 'utf8', flag: 'wx' });
    }
    const receipt = {
      schemaVersion: 1,
      suite: 'customer-marketing-packaged-safety',
      suiteVersion: SUITE_VERSION,
      appVersion: runtime.appVersion,
      status: 'pass',
      checks: {
        actionGates,
        providerRoutes,
        workflowRecovery,
        billingQuota: {
          billingQuotaReconciled: model.checks.billingQuotaReconciled,
          reservationCount: model.checks.reservationCount,
          reservedUnits: model.checks.reservedUnits,
          creditsBefore: model.checks.creditsBefore,
          creditsAfter: model.checks.creditsAfter,
        },
        modelDraft: {
          modelDraftPendingApproval: model.checks.modelDraftPendingApproval,
          attempts: model.checks.modelAttempts,
          retryPayloadStable: model.checks.retryPayloadStable,
          requestedModel: model.checks.requestedModel,
          servedModel: model.checks.servedModel,
          toolsEnabled: model.checks.toolsEnabled,
          provenanceHashesValid: model.checks.provenanceHashesValid,
          approvalStatus: model.checks.approvalStatus,
          runStatus: model.checks.runStatus,
        },
        internalMarketingRoom: {
          snapshotReady: true,
          onboardingCompleted: model.snapshot.onboarding?.completed === true,
          externalActionsAllowed: model.snapshot.externalActionsAllowed,
        },
        secretLeakCount: 0,
        externalNetworkAttempts,
      },
      externalActionsPerformed: 0,
    };
    const serialized = JSON.stringify(receipt);
    ensure(!serialized.includes(SYNTHETIC_SECRET), 'receipt-secret-leaked');
    return receipt;
  } finally {
    restoreNetwork();
  }
}

async function main() {
  const appRoot = process.argv[2];
  const snapshotPath = process.argv[3] || null;
  if (!appRoot) throw new SafetySuiteError('app-root-required');
  const receipt = await runSuite(appRoot, snapshotPath);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    const code = error instanceof SafetySuiteError ? error.code : 'unclassified-failure';
    const receipt = {
      schemaVersion: 1,
      suite: 'customer-marketing-packaged-safety',
      suiteVersion: SUITE_VERSION,
      status: 'fail',
      failureCode: code,
      secretLeakCount: 0,
      externalActionsPerformed: 0,
    };
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    process.exitCode = 10;
  });
}

module.exports = { runSuite };
