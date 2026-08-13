import { describe, expect, it, vi } from 'vitest';
import { CustomerMarketingWorkspaceClient } from './customer-marketing-workspace-client';
import type {
  CustomerMarketingAnalyticsReport,
  CustomerMarketingAnalyticsWindow,
  CustomerOnboardingProfile,
} from '../../shared/customer-marketing-types';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE_ID = '99999999-9999-4999-8999-999999999999';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const INVITATION_ID = '33333333-3333-4333-8333-333333333333';
const WORKFLOW_ID = '66666666-6666-4666-8666-666666666666';
const INVITATION_TOKEN = 'InviteToken_0123456789-abcdef';
const INVITATION_IDEMPOTENCY_KEY = 'A'.repeat(32);
const ANALYTICS_FROM = '2026-07-01T00:00:00.000Z';
const ANALYTICS_TO = '2026-07-31T23:59:59.999Z';
const FORBIDDEN_CAPABILITY_FIELDS = [
  'internalAction',
  'internalId',
  'systemPrompt',
  'toolName',
  'debugConfig',
  'secret',
  'credential',
  'monitoring',
  'runtimePath',
  'providerConfig',
  'modelConfig',
] as const;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function envelope() {
  return {
    workspace: {
      id: WORKSPACE_ID,
      name: 'IzziAPI Marketing',
      plan: 'pro',
    },
    membership: {
      role: 'manager',
      status: 'active',
    },
    quota: {
      credits_limit: '80',
      credits_used: 12.5,
    },
  };
}

function capability(overrides: Record<string, unknown> = {}) {
  return {
    id: 'content-studio',
    name: 'Content Studio',
    description: 'Create on-brand campaign content.',
    category: 'content',
    role: 'Content Agent',
    source: 'core',
    automationModes: ['copilot', 'semi_autonomous'],
    requiredIntegrations: ['website'],
    minimumPlan: 'free',
    permission: 'edit',
    stability: 'stable',
    creditEstimate: {
      minimum: 1,
      maximum: 3,
      unit: 'credits_per_run',
    },
    inputs: ['brief', 'brand_profile'],
    outputs: ['draft'],
    ...overrides,
  };
}

function capabilityEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE_ID,
    revision: 1,
    capabilities: [capability()],
    ...overrides,
  };
}

function member(overrides: Record<string, unknown> = {}) {
  return {
    userId: MEMBER_ID,
    email: 'member@example.com',
    role: 'editor',
    status: 'active',
    joinedAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

function onboardingProfile(overrides: Partial<CustomerOnboardingProfile> = {}): CustomerOnboardingProfile {
  return {
    business: {
      name: 'IzziAPI',
      industry: 'AI APIs',
      website: 'https://izziapi.com',
      offer: 'Unified AI API gateway',
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
      segments: 'Developers and AI teams',
      needs: 'Reliable model access',
      painPoints: 'Fragmented providers',
      behaviors: 'Compares APIs before integrating',
      market: 'Vietnam and international',
    },
    objectives: ['leads', 'revenue'],
    channels: ['seo', 'x'],
    resources: ['https://izziapi.com/docs'],
    automationMode: 'guardrailed_autonomous',
    completedSteps: [1, 2, 3, 4, 5, 6, 7],
    completed: true,
    updatedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

function profileEnvelope(overrides: Record<string, unknown> = {}) {
  const profile = onboardingProfile();
  return {
    workspaceId: WORKSPACE_ID,
    profile: {
      ...profile,
      automationMode: 'guarded_autonomous',
      revision: 4,
      ...overrides,
    },
  };
}

function campaignResource(overrides: Record<string, unknown> = {}) {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    workspaceId: WORKSPACE_ID,
    kind: 'campaign',
    status: 'draft',
    revision: 0,
    title: 'Autumn launch',
    metadata: { locale: 'vi', featured: true, score: 1, note: null },
    createdAt: '2026-07-22T01:00:00.000Z',
    updatedAt: '2026-07-22T01:00:00.000Z',
    description: null,
    objective: 'Generate qualified leads',
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: null,
    ...overrides,
  };
}

function analyticsReport(overrides: Record<string, unknown> = {}): CustomerMarketingAnalyticsReport {
  return {
    source: 'marketing_resources',
    generatedAt: '2026-08-01T00:00:00.000Z',
    window: {
      from: ANALYTICS_FROM,
      to: ANALYTICS_TO,
      timeZone: 'UTC',
      activityBasis: 'resource_updated_at',
      scheduleBasis: 'content_scheduled_at',
    },
    inventory: { total: 6, campaigns: 1, content: 3, assets: 1, knowledge: 1 },
    activity: {
      updatedInWindow: 5,
      byKind: { campaign: 1, content: 3, asset: 0, knowledge: 1 },
      byStatus: { draft: 2, inReview: 1, approved: 2, rejected: 0, archived: 0 },
    },
    schedule: {
      contentScheduledInWindow: 2,
      byChannel: [{ channel: 'youtube', count: 2 }],
      byStatus: { draft: 0, inReview: 1, approved: 1, rejected: 0, archived: 0 },
    },
    attribution: {
      model: 'direct_campaign_id',
      basis: 'content_updated_at',
      contentConsidered: 3,
      attributedContent: 1,
      unattributedContent: 1,
      unresolvedCampaignLinks: 1,
      campaigns: [{
        campaignId: '55555555-5555-4555-8555-555555555555',
        title: 'Tutorial launch',
        contentCount: 1,
        scheduledContentCount: 1,
      }],
    },
    dataAvailability: {
      performanceMetrics: {
        status: 'unavailable',
        reason: 'No verified external performance source is connected to this workspace report.',
        omittedMetrics: ['impressions', 'reach', 'clicks', 'conversions', 'revenue'],
      },
    },
    ...overrides,
  };
}

function campaignCreateInput() {
  return {
    kind: 'campaign' as const,
    title: 'Autumn launch',
    metadata: { locale: 'vi' },
    description: null,
    objective: 'Generate qualified leads',
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: null,
  };
}

function workflowRun(overrides: Record<string, unknown> = {}) {
  return {
    id: WORKFLOW_ID,
    workspaceId: WORKSPACE_ID,
    workflowKey: 'seven_day_content_v1',
    status: 'awaiting_customer_approval',
    revision: 4,
    objective: 'Teach developers to use IzziAPI safely',
    channels: ['website', 'x'],
    startsOn: '2026-08-12',
    planSnapshot: 'starter',
    currentStep: 4,
    steps: [
      { ordinal: 1, stepKey: 'brief', capabilityId: 'ai-marketing-director', status: 'completed', startedAt: '2026-08-11T00:00:00.000Z', completedAt: '2026-08-11T00:01:00.000Z' },
      { ordinal: 2, stepKey: 'strategy', capabilityId: 'strategy-planning', status: 'completed', startedAt: '2026-08-11T00:01:00.000Z', completedAt: '2026-08-11T00:02:00.000Z' },
      { ordinal: 3, stepKey: 'content_drafts', capabilityId: 'content-studio', status: 'completed', startedAt: '2026-08-11T00:02:00.000Z', completedAt: '2026-08-11T00:03:00.000Z' },
      { ordinal: 4, stepKey: 'brand_guardian', capabilityId: 'brand-guardian', status: 'completed', startedAt: '2026-08-11T00:03:00.000Z', completedAt: '2026-08-11T00:04:00.000Z' },
      { ordinal: 5, stepKey: 'customer_approval', capabilityId: 'approval-center', status: 'awaiting_approval', startedAt: '2026-08-11T00:04:00.000Z', completedAt: null },
    ],
    artifacts: [],
    approval: { status: 'pending', requestedAt: '2026-08-11T00:04:00.000Z', decidedAt: null },
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:04:00.000Z',
    ...overrides,
  };
}
describe('CustomerMarketingWorkspaceClient', () => {
  it('reports why the runtime bridge cannot reach an authoritative workspace', async () => {
    const disabled = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: false, fetchImpl: vi.fn<typeof fetch>() },
    );
    expect(disabled.getBridgeHealth()).toBe('disabled');

    const authRequired = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => null) },
      { enabled: true, baseUrl: 'https://api.example.test', fetchImpl: vi.fn<typeof fetch>() },
    );
    await authRequired.getCurrent();
    expect(authRequired.getBridgeHealth()).toBe('auth_required');

    const routeMissing = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      {
        enabled: true,
        baseUrl: 'https://api.example.test',
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 404)),
      },
    );
    await routeMissing.getCurrent();
    expect(routeMissing.getBridgeHealth()).toBe('route_missing');

    const tunnelUnavailable = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      {
        enabled: true,
        baseUrl: 'https://api.example.test',
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response('error code: 1033', { status: 530 })),
      },
    );
    await tunnelUnavailable.getCurrent();
    expect(tunnelUnavailable.getBridgeHealth()).toBe('tunnel_unavailable');

    const reachableButForbidden = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      {
        enabled: true,
        baseUrl: 'https://api.example.test',
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 403)),
      },
    );
    await reachableButForbidden.getCurrent();
    expect(reachableButForbidden.getBridgeHealth()).toBe('connected');
  });

  it('accepts only the reviewed HTTPS staging origin from runtime configuration', async () => {
    const auth = { getAccessToken: vi.fn(async () => 'test-token') };
    const missingUrlFetch = vi.fn<typeof fetch>();
    const missingUrl = new CustomerMarketingWorkspaceClient(auth, {
      env: { STARIZZI_CUSTOMER_MARKETING_API_ENABLED: 'true' },
      fetchImpl: missingUrlFetch,
    });
    await expect(missingUrl.getCurrent()).resolves.toEqual({ status: 'unavailable', workspace: null });
    expect(missingUrl.getBridgeHealth()).toBe('configuration_required');
    expect(missingUrlFetch).not.toHaveBeenCalled();

    const rejectedFetch = vi.fn<typeof fetch>();
    const rejected = new CustomerMarketingWorkspaceClient(auth, {
      env: {
        STARIZZI_CUSTOMER_MARKETING_API_ENABLED: 'true',
        STARIZZI_CUSTOMER_MARKETING_API_URL: 'https://api.izziapi.com',
      },
      fetchImpl: rejectedFetch,
    });
    await expect(rejected.getCurrent()).resolves.toEqual({ status: 'unavailable', workspace: null });
    expect(rejected.getBridgeHealth()).toBe('configuration_required');
    expect(rejectedFetch).not.toHaveBeenCalled();

    const acceptedFetch = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ workspaces: [] }));
    const accepted = new CustomerMarketingWorkspaceClient(auth, {
      env: {
        STARIZZI_CUSTOMER_MARKETING_API_ENABLED: 'true',
        STARIZZI_CUSTOMER_MARKETING_API_URL: 'https://marketing-staging.izziapi.com',
      },
      fetchImpl: acceptedFetch,
    });
    await accepted.getCurrent();
    expect(accepted.getBridgeHealth()).toBe('connected');
    expect(acceptedFetch).toHaveBeenCalledWith(
      'https://marketing-staging.izziapi.com/api/marketing/workspaces',
      expect.any(Object),
    );
  });

  it('does not make backend calls unless the customer API is enabled', async () => {
    const auth = { getAccessToken: vi.fn(async () => 'test-token') };
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new CustomerMarketingWorkspaceClient(auth, { enabled: false, fetchImpl });

    await expect(client.getCurrent()).resolves.toEqual({ status: 'local', workspace: null });
    await expect(client.getCapabilities(WORKSPACE_ID)).resolves.toEqual({
      status: 'local',
      revision: null,
      capabilities: [],
    });
    await expect(client.reserveQuota({
      workspaceId: WORKSPACE_ID,
      capabilityId: 'ai-marketing-director',
      metric: 'credits',
      units: 1,
      idempotencyKey: 'director:run-1234',
    })).resolves.toEqual({ status: 'local', quota: null });
    await expect(client.listMembers(WORKSPACE_ID)).resolves.toEqual({ status: 'local', members: [] });
    await expect(client.updateMemberRole({
      workspaceId: WORKSPACE_ID,
      memberUserId: MEMBER_ID,
      role: 'reviewer',
    })).resolves.toEqual({ status: 'local', member: null });
    await expect(client.createInvitation({
      workspaceId: WORKSPACE_ID,
      email: 'new@example.com',
      role: 'viewer',
      idempotencyKey: INVITATION_IDEMPOTENCY_KEY,
    })).resolves.toEqual({ status: 'local', invitation: null, inviteToken: null });
    await expect(client.acceptInvitation(INVITATION_TOKEN)).resolves.toEqual({
      status: 'local',
      workspaceId: null,
      role: null,
    });

    await expect(client.getProfile(WORKSPACE_ID)).resolves.toEqual({ status: 'local', profile: null });
    await expect(client.updateProfile({
      workspaceId: WORKSPACE_ID,
      expectedRevision: 0,
      profile: onboardingProfile(),
    })).resolves.toEqual({ status: 'local', profile: null });
    expect(auth.getAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('lists the authenticated user workspaces and normalizes numeric quota values', async () => {
    const auth = { getAccessToken: vi.fn(async () => 'test-token') };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ workspaces: [envelope()] }));
    const client = new CustomerMarketingWorkspaceClient(auth, {
      enabled: true,
      baseUrl: 'https://api.example.test/',
      fetchImpl,
    });

    await expect(client.getCurrent(WORKSPACE_ID)).resolves.toEqual({
      status: 'synced',
      workspace: {
        id: WORKSPACE_ID,
        name: 'IzziAPI Marketing',
        role: 'manager',
        plan: 'pro',
        quota: { creditsLimit: 80, creditsUsed: 12.5 },
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.example.test/api/marketing/workspaces',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
  });

  it('fails closed when a persisted workspace is absent instead of selecting another tenant', async () => {
    const otherWorkspace = envelope();
    otherWorkspace.workspace.id = OTHER_WORKSPACE_ID;
    otherWorkspace.workspace.name = 'Other Marketing Workspace';
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ workspaces: [otherWorkspace] }));
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      {
        enabled: true,
        baseUrl: 'https://api.example.test',
        fetchImpl,
      },
    );

    await expect(client.getCurrent(WORKSPACE_ID)).resolves.toEqual({
      status: 'unavailable',
      workspace: null,
    });
  });

  it('creates one workspace only when the authenticated account has none', async () => {
    const auth = { getAccessToken: vi.fn(async () => 'test-token') };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ workspaces: [] }))
      .mockResolvedValueOnce(jsonResponse({ workspace: envelope() }));
    const client = new CustomerMarketingWorkspaceClient(auth, {
      enabled: true,
      baseUrl: 'https://api.example.test',
      fetchImpl,
    });

    const result = await client.ensureWorkspace({
      name: 'IzziAPI Marketing',
      operatingMode: 'guarded_autonomous',
    });

    expect(result.status).toBe('synced');
    expect(result.workspace?.id).toBe(WORKSPACE_ID);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenLastCalledWith(
      'https://api.example.test/api/marketing/workspaces',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ name: 'IzziAPI Marketing', operatingMode: 'guarded_autonomous' }),
      }),
    );
  });

  it('parses the numeric authoritative catalog revision and public capability metadata', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(capabilityEnvelope()));
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, baseUrl: 'https://api.example.test', fetchImpl },
    );

    await expect(client.getCapabilities(WORKSPACE_ID)).resolves.toEqual({
      status: 'synced',
      revision: 1,
      capabilities: [{
        ...capability(),
        status: 'available',
      }],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.example.test/api/marketing/workspaces/${WORKSPACE_ID}/capabilities`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
  });

  it.each([
    ['wrong workspace', capabilityEnvelope({ workspaceId: OTHER_WORKSPACE_ID })],
    ['string revision', capabilityEnvelope({ revision: '1' })],
    ['zero revision', capabilityEnvelope({ revision: 0 })],
    ['duplicate ids', capabilityEnvelope({ capabilities: [capability(), capability()] })],
    ['unknown category', capabilityEnvelope({ capabilities: [capability({ category: 'internal' })] })],
    ['extension without extensionId', capabilityEnvelope({
      capabilities: [capability({ id: 'extension-capability', source: 'extension' })],
    })],
    ['core with extensionId', capabilityEnvelope({
      capabilities: [capability({ extensionId: 'ext-content-studio' })],
    })],
    ['unknown envelope metadata', capabilityEnvelope({ debugConfig: 'must-not-reach-renderer' })],
    ['unknown credit metadata', capabilityEnvelope({
      capabilities: [capability({
        creditEstimate: {
          minimum: 1,
          maximum: 3,
          unit: 'credits_per_run',
          internalRate: 'must-not-reach-renderer',
        },
      })],
    })],
    ['extension runtime metadata', capabilityEnvelope({
      capabilities: [capability({
        id: 'extension-content-studio',
        source: 'extension',
        extensionId: 'extension-content-studio',
        runtimePath: 'must-not-reach-renderer',
      })],
    })],
    ...FORBIDDEN_CAPABILITY_FIELDS.map((field) => [
      `forbidden capability field ${field}`,
      capabilityEnvelope({ capabilities: [capability({ [field]: 'must-not-reach-renderer' })] }),
    ] as const),
  ])('fails closed for a malformed capability catalog: %s', async (_case, body) => {
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)) },
    );

    await expect(client.getCapabilities(WORKSPACE_ID)).resolves.toEqual({
      status: 'unavailable',
      revision: null,
      capabilities: [],
    });
  });

  it.each([
    [403, 'forbidden'],
    [404, 'not_found'],
    [500, 'unavailable'],
  ] as const)('maps capability HTTP %i to %s without exposing an unverified catalog', async (status, expected) => {
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, status)) },
    );

    await expect(client.getCapabilities(WORKSPACE_ID)).resolves.toEqual({
      status: expected,
      revision: null,
      capabilities: [],
    });
  });


  it('reads an authoritative profile and maps the backend guardrail enum', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(profileEnvelope()));
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, baseUrl: 'https://api.example.test', fetchImpl },
    );

    await expect(client.getProfile(WORKSPACE_ID)).resolves.toEqual({
      status: 'synced',
      profile: {
        workspaceId: WORKSPACE_ID,
        revision: 4,
        ...onboardingProfile(),
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.example.test/api/marketing/workspaces/${WORKSPACE_ID}/profile`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
  });

  it('puts only the profile contract and maps the Desktop guardrail enum', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(profileEnvelope({
      revision: 5,
      updatedAt: '2026-07-22T01:00:00.000Z',
    })));
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, baseUrl: 'https://api.example.test', fetchImpl },
    );
    const profile = onboardingProfile();

    await expect(client.updateProfile({
      workspaceId: WORKSPACE_ID,
      expectedRevision: 4,
      profile,
    })).resolves.toEqual({
      status: 'synced',
      profile: {
        workspaceId: WORKSPACE_ID,
        ...profile,
        revision: 5,
        updatedAt: '2026-07-22T01:00:00.000Z',
      },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.example.test/api/marketing/workspaces/${WORKSPACE_ID}/profile`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision: 4,
          business: profile.business,
          brand: profile.brand,
          audience: profile.audience,
          objectives: profile.objectives,
          channels: profile.channels,
          resources: profile.resources,
          automationMode: 'guarded_autonomous',
          completedSteps: profile.completedSteps,
        }),
      }),
    );
  });

  it('maps revision conflicts without returning backend details', async () => {
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      {
        enabled: true,
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
          error: { code: 'profile_conflict', message: 'private database detail' },
        }, 409)),
      },
    );

    await expect(client.updateProfile({
      workspaceId: WORKSPACE_ID,
      expectedRevision: 4,
      profile: onboardingProfile(),
    })).resolves.toEqual({ status: 'conflict', profile: null });
  });

  it('does not classify an unrelated HTTP 409 as a profile revision conflict', async () => {
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      {
        enabled: true,
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
          error: { code: 'conflict', message: 'Another conflict type' },
        }, 409)),
      },
    );

    await expect(client.updateProfile({
      workspaceId: WORKSPACE_ID,
      expectedRevision: 4,
      profile: onboardingProfile(),
    })).resolves.toEqual({ status: 'unavailable', profile: null });
  });

  it('fails closed for cross-workspace or malformed profile responses', async () => {
    const crossWorkspaceClient = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      {
        enabled: true,
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
          ...profileEnvelope(),
          workspaceId: OTHER_WORKSPACE_ID,
        })),
      },
    );
    await expect(crossWorkspaceClient.getProfile(WORKSPACE_ID)).resolves.toEqual({
      status: 'unavailable',
      profile: null,
    });

    const malformedClient = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      {
        enabled: true,
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(profileEnvelope({
          completedSteps: [1, 1, 2, 3, 4, 5, 6],
          completed: true,
        }))),
      },
    );
    await expect(malformedClient.getProfile(WORKSPACE_ID)).resolves.toEqual({
      status: 'unavailable',
      profile: null,
    });
  });

  it('rejects incomplete fields, invalid URLs or colors, and invalid string lists', async () => {
    const base = onboardingProfile();
    const malformedProfiles: Record<string, unknown>[] = [
      {
        business: {
          industry: base.business.industry,
          website: base.business.website,
          offer: base.business.offer,
          region: base.business.region,
        },
      },
      {
        business: { ...base.business, website: 'javascript:alert(1)' },
      },
      {
        brand: { ...base.brand, primaryColor: 'cyan' },
      },
      {
        brand: { ...base.brand, wordsToUse: ['practical', 'practical'] },
      },
      {
        resources: [''],
      },
    ];

    for (const overrides of malformedProfiles) {
      const client = new CustomerMarketingWorkspaceClient(
        { getAccessToken: vi.fn(async () => 'test-token') },
        {
          enabled: true,
          fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(profileEnvelope(overrides))),
        },
      );
      await expect(client.getProfile(WORKSPACE_ID)).resolves.toEqual({
        status: 'unavailable',
        profile: null,
      });
    }
  });
  it('fails closed when authentication or the workspace route is unavailable', async () => {
    const noAuthFetch = vi.fn<typeof fetch>();
    const noAuthClient = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => null) },
      { enabled: true, fetchImpl: noAuthFetch },
    );
    await expect(noAuthClient.getCurrent()).resolves.toEqual({ status: 'unavailable', workspace: null });
    expect(noAuthFetch).not.toHaveBeenCalled();

    const missingRouteClient = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 404)) },
    );
    await expect(missingRouteClient.getCurrent()).resolves.toEqual({ status: 'unavailable', workspace: null });
  });

  it('lists and updates public member fields through authenticated workspace routes', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        workspaceId: WORKSPACE_ID,
        members: [member()],
      }))
      .mockResolvedValueOnce(jsonResponse({
        workspaceId: WORKSPACE_ID,
        member: member({ role: 'reviewer', updatedAt: '2026-07-22T00:00:00.000Z' }),
      }));
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, baseUrl: 'https://api.example.test', fetchImpl },
    );

    await expect(client.listMembers(WORKSPACE_ID)).resolves.toEqual({
      status: 'synced',
      members: [member()],
    });
    await expect(client.updateMemberRole({
      workspaceId: WORKSPACE_ID,
      memberUserId: MEMBER_ID,
      role: 'reviewer',
    })).resolves.toEqual({
      status: 'synced',
      member: member({ role: 'reviewer', updatedAt: '2026-07-22T00:00:00.000Z' }),
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `https://api.example.test/api/marketing/workspaces/${WORKSPACE_ID}/members`,
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `https://api.example.test/api/marketing/workspaces/${WORKSPACE_ID}/members/${MEMBER_ID}`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ role: 'reviewer' }),
      }),
    );
  });

  it('fails the whole member operation for malformed or cross-workspace responses', async () => {
    const malformedListClient = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      {
        enabled: true,
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
          workspaceId: WORKSPACE_ID,
          members: [member(), member({ userId: '../other-tenant' })],
        })),
      },
    );
    await expect(malformedListClient.listMembers(WORKSPACE_ID)).resolves.toEqual({
      status: 'unavailable',
      members: [],
    });

    const mismatchedListClient = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      {
        enabled: true,
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
          workspaceId: '33333333-3333-4333-8333-333333333333',
          members: [member()],
        })),
      },
    );
    await expect(mismatchedListClient.listMembers(WORKSPACE_ID)).resolves.toEqual({
      status: 'unavailable',
      members: [],
    });

    const mismatchedUpdateClient = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      {
        enabled: true,
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
          workspaceId: '33333333-3333-4333-8333-333333333333',
          member: member({ role: 'reviewer' }),
        })),
      },
    );
    await expect(mismatchedUpdateClient.updateMemberRole({
      workspaceId: WORKSPACE_ID,
      memberUserId: MEMBER_ID,
      role: 'reviewer',
    })).resolves.toEqual({ status: 'unavailable', member: null });

    const staleRoleClient = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      {
        enabled: true,
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
          workspaceId: WORKSPACE_ID,
          member: member({ role: 'editor' }),
        })),
      },
    );
    await expect(staleRoleClient.updateMemberRole({
      workspaceId: WORKSPACE_ID,
      memberUserId: MEMBER_ID,
      role: 'reviewer',
    })).resolves.toEqual({ status: 'unavailable', member: null });
  });

  it('creates and accepts invitations through authenticated routes with strict response parsing', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        invitation: {
          id: INVITATION_ID,
          email: 'new@example.com',
          role: 'viewer',
          expires_at: '2026-07-29T00:00:00.000Z',
          created_at: '2026-07-22T00:00:00.000Z',
        },
        inviteToken: INVITATION_TOKEN,
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        membership: {
          workspace_id: WORKSPACE_ID,
          user_id: MEMBER_ID,
          role: 'viewer',
          status: 'active',
          joined_at: '2026-07-22T00:00:00.000Z',
        },
      }));
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, baseUrl: 'https://api.example.test', fetchImpl },
    );

    await expect(client.createInvitation({
      workspaceId: WORKSPACE_ID,
      email: 'new@example.com',
      role: 'viewer',
      idempotencyKey: INVITATION_IDEMPOTENCY_KEY,
    })).resolves.toEqual({
      status: 'created',
      invitation: {
        id: INVITATION_ID,
        email: 'new@example.com',
        role: 'viewer',
        expiresAt: '2026-07-29T00:00:00.000Z',
        createdAt: '2026-07-22T00:00:00.000Z',
      },
      inviteToken: INVITATION_TOKEN,
    });
    await expect(client.acceptInvitation(INVITATION_TOKEN)).resolves.toEqual({
      status: 'accepted',
      workspaceId: WORKSPACE_ID,
      role: 'viewer',
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `https://api.example.test/api/marketing/workspaces/${WORKSPACE_ID}/invitations`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Idempotency-Key': INVITATION_IDEMPOTENCY_KEY,
        }),
        body: JSON.stringify({ email: 'new@example.com', role: 'viewer' }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      'https://api.example.test/api/marketing/workspaces/invitations/accept',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: INVITATION_TOKEN }),
      }),
    );
  });

  it('does not classify a missing workspace resource as a missing backend route', async () => {
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      {
        enabled: true,
        baseUrl: 'https://api.example.test',
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 404)),
      },
    );

    await expect(client.getProfile(WORKSPACE_ID)).resolves.toEqual({ status: 'not_found', profile: null });
    expect(client.getBridgeHealth()).toBe('connected');
  });

  it('rejects invalid invitation idempotency keys before reading auth or calling the backend', async () => {
    const auth = { getAccessToken: vi.fn(async () => 'test-token') };
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new CustomerMarketingWorkspaceClient(auth, {
      enabled: true,
      baseUrl: 'https://api.example.test',
      fetchImpl,
    });

    await expect(client.createInvitation({
      workspaceId: WORKSPACE_ID,
      email: 'new@example.com',
      role: 'viewer',
      idempotencyKey: 'too-short',
    })).resolves.toEqual({ status: 'unavailable', invitation: null, inviteToken: null });
    expect(auth.getAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails closed for malformed invitation envelopes and never returns a raw token from them', async () => {
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      {
        enabled: true,
        fetchImpl: vi.fn<typeof fetch>()
          .mockResolvedValueOnce(jsonResponse({
            invitation: {
              id: INVITATION_ID,
              email: 'other@example.com',
              role: 'viewer',
              expires_at: '2026-07-29T00:00:00.000Z',
              created_at: '2026-07-22T00:00:00.000Z',
            },
            inviteToken: INVITATION_TOKEN,
          }, 201))
          .mockResolvedValueOnce(jsonResponse({
            membership: {
              workspace_id: '../other-tenant',
              user_id: MEMBER_ID,
              role: 'viewer',
              status: 'active',
              joined_at: '2026-07-22T00:00:00.000Z',
            },
          })),
      },
    );

    const created = await client.createInvitation({
      workspaceId: WORKSPACE_ID,
      email: 'new@example.com',
      role: 'viewer',
      idempotencyKey: INVITATION_IDEMPOTENCY_KEY,
    });
    expect(created).toEqual({ status: 'unavailable', invitation: null, inviteToken: null });
    expect(JSON.stringify(created)).not.toContain(INVITATION_TOKEN);
    await expect(client.acceptInvitation(INVITATION_TOKEN)).resolves.toEqual({
      status: 'unavailable',
      workspaceId: null,
      role: null,
    });
  });

  it.each([
    [403, 'forbidden'],
    [404, 'not_found'],
    [500, 'unavailable'],
  ] as const)('maps member update HTTP %i to %s without exposing backend detail', async (status, expected) => {
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      {
        enabled: true,
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
          error: { code: expected, message: 'private backend detail' },
        }, status)),
      },
    );

    await expect(client.updateMemberRole({
      workspaceId: WORKSPACE_ID,
      memberUserId: MEMBER_ID,
      role: 'reviewer',
    })).resolves.toEqual({ status: expected, member: null });
  });

  it('reserves workspace quota and normalizes the authoritative quota snapshot', async () => {
    const auth = { getAccessToken: vi.fn(async () => 'test-token') };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      workspaceId: WORKSPACE_ID,
      reservation: {
        duplicate: false,
        quota: { credits_limit: '80', credits_used: 13.5 },
      },
    }));
    const client = new CustomerMarketingWorkspaceClient(auth, {
      enabled: true,
      baseUrl: 'https://api.example.test',
      fetchImpl,
    });

    await expect(client.reserveQuota({
      workspaceId: WORKSPACE_ID,
      capabilityId: 'ai-marketing-director',
      metric: 'credits',
      units: 1,
      idempotencyKey: 'director:run-1234',
      metadata: { action: 'ai_director', runId: 'run-1234' },
    })).resolves.toEqual({
      status: 'reserved',
      duplicate: false,
      quota: { creditsLimit: 80, creditsUsed: 13.5 },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.example.test/api/marketing/workspaces/${WORKSPACE_ID}/quota/reservations`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Marketing-Capability-Id': 'ai-marketing-director',
        }),
        body: JSON.stringify({
          metric: 'credits',
          units: 1,
          idempotencyKey: 'director:run-1234',
          metadata: { action: 'ai_director', runId: 'run-1234' },
        }),
      }),
    );
  });

  it.each([
    [429, 'quota_exceeded'],
    [403, 'forbidden'],
    [403, 'plan_required'],
    [404, 'unavailable'],
  ] as const)('maps reservation HTTP %i to %s without leaking the server message', async (status, expected) => {
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      {
        enabled: true,
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
          error: { code: expected, message: 'internal backend detail' },
        }, status)),
      },
    );

    await expect(client.reserveQuota({
      workspaceId: WORKSPACE_ID,
      capabilityId: 'ai-marketing-director',
      metric: 'credits',
      units: 1,
      idempotencyKey: 'director:run-1234',
    })).resolves.toEqual({ status: expected, quota: null });
  });

  it('returns only empty local resource state while the workspace API is disabled', async () => {
    const auth = { getAccessToken: vi.fn(async () => 'test-token') };
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new CustomerMarketingWorkspaceClient(auth, { enabled: false, fetchImpl });

    await expect(client.listMarketingResources(WORKSPACE_ID, 'campaign')).resolves.toEqual({
      status: 'local',
      resources: [],
    });
    await expect(client.listMarketingCalendar(WORKSPACE_ID)).resolves.toEqual({
      status: 'local',
      resources: [],
    });
    await expect(client.getMarketingAnalytics(WORKSPACE_ID, {
      from: ANALYTICS_FROM,
      to: ANALYTICS_TO,
    })).resolves.toEqual({ status: 'local', report: null });
    await expect(client.createMarketingResource({
      workspaceId: WORKSPACE_ID,
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
      resource: campaignCreateInput(),
    })).resolves.toEqual({ status: 'local', resource: null });
    expect(auth.getAccessToken).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ['cross-workspace envelope', { workspaceId: OTHER_WORKSPACE_ID, resources: [campaignResource()] }],
    ['cross-kind resource', { workspaceId: WORKSPACE_ID, resources: [campaignResource({ kind: 'content' })] }],
    ['private resource field', { workspaceId: WORKSPACE_ID, resources: [campaignResource({ storagePath: 'private/path' })] }],
    ['prototype metadata field', {
      workspaceId: WORKSPACE_ID,
      resources: [campaignResource({ metadata: JSON.parse('{"__proto__":"private"}') })],
    }],
    ['private envelope field', { workspaceId: WORKSPACE_ID, resources: [campaignResource()], token: 'private-token' }],
  ])('fails closed for %s in list responses', async (_label, body) => {
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)) },
    );

    await expect(client.listMarketingResources(WORKSPACE_ID, 'campaign')).resolves.toEqual({
      status: 'unavailable',
      resources: [],
    });
  });

  it('accepts PostgreSQL timestamps with microsecond precision', async () => {
    const resource = campaignResource({
      createdAt: '2026-07-22T01:00:00.123456+00:00',
      updatedAt: '2026-07-22T01:00:00.7Z',
    });
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      {
        enabled: true,
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
          workspaceId: WORKSPACE_ID,
          resources: [resource],
        })),
      },
    );

    await expect(client.listMarketingResources(WORKSPACE_ID, 'campaign')).resolves.toEqual({
      status: 'synced',
      resources: [resource],
    });
  });

  it('compares calendar ranges by timestamp when ISO offsets differ', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      workspaceId: WORKSPACE_ID,
      resources: [],
    }));
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, fetchImpl },
    );

    await expect(client.listMarketingCalendar(WORKSPACE_ID, {
      from: '2026-08-01T10:00:00+07:00',
      to: '2026-08-01T04:00:00Z',
    })).resolves.toEqual({ status: 'synced', resources: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('loads a strict analytics report through the authenticated workspace route', async () => {
    const report = analyticsReport();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      workspaceId: WORKSPACE_ID,
      report,
    }));
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, baseUrl: 'https://api.example.test', fetchImpl },
    );

    await expect(client.getMarketingAnalytics(WORKSPACE_ID, {
      from: ANALYTICS_FROM,
      to: ANALYTICS_TO,
    })).resolves.toEqual({ status: 'synced', report });

    expect(fetchImpl).toHaveBeenCalledWith(
      `https://api.example.test/api/marketing/workspaces/${WORKSPACE_ID}/analytics?from=${encodeURIComponent(ANALYTICS_FROM)}&to=${encodeURIComponent(ANALYTICS_TO)}`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      }),
    );
  });

  it.each([
    ['cross-workspace envelope', { workspaceId: OTHER_WORKSPACE_ID, report: analyticsReport() }],
    ['private report field', { workspaceId: WORKSPACE_ID, report: analyticsReport({ token: 'private-token' }) }],
    ['private nested field', {
      workspaceId: WORKSPACE_ID,
      report: analyticsReport({
        inventory: { ...analyticsReport().inventory, storageNamespace: 'private/path' },
      }),
    }],
    ['fabricated performance metric', {
      workspaceId: WORKSPACE_ID,
      report: analyticsReport({
        dataAvailability: {
          performanceMetrics: {
            ...analyticsReport().dataAvailability.performanceMetrics,
            clicks: 120,
          },
        },
      }),
    }],
    ['contradictory inventory total', {
      workspaceId: WORKSPACE_ID,
      report: analyticsReport({ inventory: { ...analyticsReport().inventory, total: 7 } }),
    }],
    ['mismatched report window', {
      workspaceId: WORKSPACE_ID,
      report: analyticsReport({
        window: { ...analyticsReport().window, from: '2026-06-01T00:00:00.000Z' },
      }),
    }],
  ])('fails closed for %s in analytics responses', async (_label, body) => {
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(body)) },
    );

    await expect(client.getMarketingAnalytics(WORKSPACE_ID, {
      from: ANALYTICS_FROM,
      to: ANALYTICS_TO,
    })).resolves.toEqual({ status: 'unavailable', report: null });
  });

  it('rejects non-UTC, overlong, and renderer-extended analytics windows before fetch', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, fetchImpl },
    );
    const invalidWindows: unknown[] = [
      { from: '2026-07-01T07:00:00.000+07:00', to: ANALYTICS_TO },
      { from: '2025-01-01T00:00:00.000Z', to: '2026-01-03T00:00:00.000Z' },
      { from: ANALYTICS_FROM, to: ANALYTICS_TO, workspaceId: OTHER_WORKSPACE_ID },
    ];

    for (const input of invalidWindows) {
      await expect(client.getMarketingAnalytics(
        WORKSPACE_ID,
        input as CustomerMarketingAnalyticsWindow,
      )).resolves.toEqual({ status: 'unavailable', report: null });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends a main-generated idempotency header without putting private fields in the create body', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      workspaceId: WORKSPACE_ID,
      resource: campaignResource(),
      duplicate: true,
    }));
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, baseUrl: 'https://api.example.test', fetchImpl },
    );

    await expect(client.createMarketingResource({
      workspaceId: WORKSPACE_ID,
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
      resource: campaignCreateInput(),
    })).resolves.toEqual({
      status: 'synced',
      resource: campaignResource(),
      duplicate: true,
    });

    const [, init] = fetchImpl.mock.calls[0];
    expect(init?.headers).toMatchObject({
      'Idempotency-Key': '55555555-5555-4555-8555-555555555555',
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      title: 'Autumn launch',
      metadata: { locale: 'vi' },
      description: null,
      objective: 'Generate qualified leads',
      startsAt: '2026-08-01T00:00:00.000Z',
      endsAt: null,
    });
  });

  it('maps revision conflicts and archives only through DELETE with expectedRevision JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'revision_conflict' } }, 409))
      .mockResolvedValueOnce(jsonResponse({ workspaceId: WORKSPACE_ID, deleted: true }));
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, fetchImpl },
    );

    await expect(client.updateMarketingResource({
      workspaceId: WORKSPACE_ID,
      kind: 'campaign',
      resourceId: campaignResource().id,
      expectedRevision: 0,
      patch: { title: 'Autumn launch v2' },
    })).resolves.toEqual({ status: 'conflict', resource: null });
    await expect(client.archiveMarketingResource({
      workspaceId: WORKSPACE_ID,
      kind: 'campaign',
      resourceId: campaignResource().id,
      expectedRevision: 0,
    })).resolves.toEqual({ status: 'synced', deleted: true });

    expect(fetchImpl.mock.calls[1][1]).toMatchObject({
      method: 'DELETE',
      body: JSON.stringify({ expectedRevision: 0 }),
    });
  });

  it('starts, reads, resumes, and reviews the backend-owned seven-day workflow', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ workspaceId: WORKSPACE_ID, run: workflowRun(), duplicate: false }, 201))
      .mockResolvedValueOnce(jsonResponse({ workspaceId: WORKSPACE_ID, run: workflowRun() }))
      .mockResolvedValueOnce(jsonResponse({ workspaceId: WORKSPACE_ID, run: workflowRun(), duplicate: false }))
      .mockResolvedValueOnce(jsonResponse({
        workspaceId: WORKSPACE_ID,
        run: workflowRun({ status: 'approved', revision: 5, approval: { status: 'approved', requestedAt: '2026-08-11T00:04:00.000Z', decidedAt: '2026-08-11T00:05:00.000Z' } }),
        duplicate: false,
      }));
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, baseUrl: 'https://api.example.test', fetchImpl },
    );

    await expect(client.startSevenDayWorkflow({
      workspaceId: WORKSPACE_ID,
      objective: 'Teach developers to use IzziAPI safely',
      channels: ['website', 'x'],
      startsOn: '2026-08-12',
      idempotencyKey: 'desktop-workflow-001',
    })).resolves.toMatchObject({ status: 'synced', run: { id: WORKFLOW_ID }, duplicate: false });
    await expect(client.getSevenDayWorkflow(WORKSPACE_ID, WORKFLOW_ID))
      .resolves.toMatchObject({ status: 'synced', run: { revision: 4 } });
    await expect(client.resumeSevenDayWorkflow({ workspaceId: WORKSPACE_ID, runId: WORKFLOW_ID, expectedRevision: 3 }))
      .resolves.toMatchObject({ status: 'synced', run: { currentStep: 4 }, duplicate: false });
    await expect(client.reviewSevenDayWorkflow({ workspaceId: WORKSPACE_ID, runId: WORKFLOW_ID, decision: 'approve', expectedRevision: 4 }))
      .resolves.toMatchObject({ status: 'synced', run: { status: 'approved', revision: 5 }, duplicate: false });

    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
      `https://api.example.test/api/marketing/workspaces/${WORKSPACE_ID}/workflows/seven-day`,
      `https://api.example.test/api/marketing/workspaces/${WORKSPACE_ID}/workflows/${WORKFLOW_ID}`,
      `https://api.example.test/api/marketing/workspaces/${WORKSPACE_ID}/workflows/${WORKFLOW_ID}/resume`,
      `https://api.example.test/api/marketing/workspaces/${WORKSPACE_ID}/workflows/${WORKFLOW_ID}/review`,
    ]);
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      headers: { 'Idempotency-Key': 'desktop-workflow-001' },
      body: JSON.stringify({
        objective: 'Teach developers to use IzziAPI safely',
        channels: ['website', 'x'],
        startsOn: '2026-08-12',
      }),
    });
    expect(fetchImpl.mock.calls[3][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ decision: 'approve', expectedRevision: 4 }),
    });
  });

  it('fails closed for mismatched or renderer-extended workflow responses', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ workspaceId: OTHER_WORKSPACE_ID, run: workflowRun(), duplicate: false }))
      .mockResolvedValueOnce(jsonResponse({ workspaceId: WORKSPACE_ID, run: workflowRun({ systemPrompt: 'must-not-enter-desktop' }) }));
    const client = new CustomerMarketingWorkspaceClient(
      { getAccessToken: vi.fn(async () => 'test-token') },
      { enabled: true, fetchImpl },
    );

    await expect(client.startSevenDayWorkflow({
      workspaceId: WORKSPACE_ID,
      objective: 'Teach developers to use IzziAPI safely',
      channels: ['website'],
      startsOn: '2026-08-12',
      idempotencyKey: 'desktop-workflow-002',
    })).resolves.toEqual({ status: 'unavailable', run: null });
    await expect(client.getSevenDayWorkflow(WORKSPACE_ID, WORKFLOW_ID))
      .resolves.toEqual({ status: 'unavailable', run: null });
  });
});
