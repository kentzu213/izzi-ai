import { describe, expect, it, vi } from 'vitest';
import type {
  CustomerCapability,
  CustomerMarketingAnalyticsReport,
  CustomerMarketingAnalyticsWindow,
  CustomerMarketingResource,
  CustomerMarketingResourceCreateInput,
  CustomerMarketingSnapshot,
  CustomerMarketingWorkflowTarget,
  CustomerMediaToolchain,
  CustomerOnboardingInput,
  CustomerRole,
} from '../../shared/customer-marketing-types';
import type {
  CustomerMarketingCredentialStatus,
} from '../../shared/customer-marketing-credential-types';
import type {
  CustomerProductMarketingContextSaveInput,
} from '../../shared/customer-marketing-product-context';
import type {
  CustomerExtensionCapabilityDefinition,
} from '../../shared/customer-marketing-capability-manifest';
import {
  CUSTOMER_MARKETING_GUARDRAIL_DEFAULT_POLICY,
  createCustomerMarketingGuardrailStateReader,
  type CustomerMarketingGuardrailState,
} from './customer-marketing-loop-guardrails';
import {
  buildCustomerCapabilities,
  CustomerMarketingService,
  type CustomerIdentity,
  type CustomerRuntimeExtension,
} from './customer-marketing-service';
import type {
  CustomerMediaImportedProject,
  CustomerVideoStudioRuntime,
} from './customer-video-studio-service';
import type { CustomerMarketingCredentialVault } from './customer-marketing-credential-vault';
import type {
  CustomerMarketingWorkspaceGateway,
  RemoteMarketingMember,
  RemoteMarketingProfile,
  RemoteMarketingWorkspace,
} from './customer-marketing-workspace-client';

class MemorySettings {
  readonly values = new Map<string, string>();

  getSetting(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setSetting(key: string, value: string): void {
    this.values.set(key, value);
  }

  deleteSetting(key: string): void {
    this.values.delete(key);
  }

  updateOnlyRecord(patch: Record<string, unknown>): void {
    const entries = Array.from(this.values.entries())
      .filter(([key]) => key.startsWith('customer_marketing:v1:'));
    if (entries.length !== 1) throw new Error('Expected exactly one tenant record.');
    const [key, raw] = entries[0];
    this.values.set(key, JSON.stringify({ ...JSON.parse(raw), ...patch }));
  }
}

function onboarding(name = 'Acme'): CustomerOnboardingInput {
  return {
    business: {
      name,
      industry: 'SaaS',
      website: 'https://example.com',
      offer: 'An AI workflow product for small teams',
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
      segments: 'Small business owners',
      needs: 'Automate repeat marketing work',
      painPoints: 'Limited time and budget',
      behaviors: 'Researches tools before buying',
      market: 'Vietnam',
    },
    objectives: ['leads', 'revenue'],
    channels: ['facebook', 'seo'],
    resources: ['https://example.com/catalog'],
    automationMode: 'semi_autonomous',
    completedSteps: [1, 2, 3, 4, 5, 6, 7],
  };
}

function remoteWorkspace(overrides: Partial<RemoteMarketingWorkspace> = {}): RemoteMarketingWorkspace {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Remote Marketing Workspace',
    role: 'manager',
    plan: 'pro',
    quota: { creditsLimit: 80, creditsUsed: 12.5 },
    ...overrides,
  };
}
function remoteProfile(overrides: Partial<RemoteMarketingProfile> = {}): RemoteMarketingProfile {
  const input = onboarding('Remote profile');
  return {
    ...input,
    workspaceId: '11111111-1111-4111-8111-111111111111',
    completed: true,
    revision: 3,
    updatedAt: '2026-07-22T00:00:00.000Z',
    ...overrides,
  };
}

function remoteMember(overrides: Partial<RemoteMarketingMember> = {}): RemoteMarketingMember {
  return {
    userId: '22222222-2222-4222-8222-222222222222',
    email: 'member@example.com',
    role: 'editor',
    status: 'active',
    joinedAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...overrides,
  };
}

function remoteCapability(overrides: Partial<CustomerCapability> = {}): CustomerCapability {
  return {
    id: 'content-studio',
    name: 'Content Studio',
    description: 'Create on-brand campaign content.',
    category: 'content',
    role: 'Content Agent',
    source: 'core',
    status: 'available',
    automationModes: ['copilot', 'semi_autonomous'],
    requiredIntegrations: ['website'],
    minimumPlan: 'free',
    permission: 'edit',
    stability: 'stable',
    creditEstimate: { minimum: 1, maximum: 3, unit: 'credits_per_run' },
    inputs: ['brief', 'brand_profile'],
    outputs: ['draft'],
    ...overrides,
  };
}

function memberGatewayMethods(): Pick<
  CustomerMarketingWorkspaceGateway,
  'getCapabilities' | 'listMembers' | 'updateMemberRole' | 'getProfile' | 'updateProfile' | 'createInvitation' | 'acceptInvitation'
> {
  return {
    getCapabilities: vi.fn(async () => ({
      status: 'synced' as const,
      revision: 1,
      capabilities: buildCustomerCapabilities([]),
    })),
    getProfile: vi.fn(async () => ({ status: 'synced' as const, profile: remoteProfile() })),
    updateProfile: vi.fn(async (input) => ({
      status: 'synced' as const,
      profile: {
        ...input.profile,
        workspaceId: input.workspaceId,
        revision: input.expectedRevision + 1,
        updatedAt: '2026-07-22T01:00:00.000Z',
      },
    })),
    listMembers: vi.fn(async () => ({ status: 'local', members: [] })),
    updateMemberRole: vi.fn(async () => ({ status: 'local', member: null })),
    createInvitation: vi.fn(async () => ({ status: 'local', invitation: null, inviteToken: null })),
    acceptInvitation: vi.fn(async () => ({ status: 'local', workspaceId: null, role: null })),
  };
}

function marketingCampaignResource(overrides: Partial<CustomerMarketingResource> = {}): CustomerMarketingResource {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    kind: 'campaign',
    status: 'draft',
    revision: 0,
    title: 'Autumn launch',
    metadata: { locale: 'vi' },
    createdAt: '2026-07-22T01:00:00.000Z',
    updatedAt: '2026-07-22T01:00:00.000Z',
    description: null,
    objective: 'Generate qualified leads',
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: null,
    ...overrides,
  } as CustomerMarketingResource;
}

function marketingContentResource(overrides: Partial<CustomerMarketingResource> = {}): CustomerMarketingResource {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    workspaceId: '11111111-1111-4111-8111-111111111111',
    kind: 'content',
    status: 'approved',
    revision: 3,
    title: 'Approved launch post',
    metadata: { locale: 'vi' },
    createdAt: '2026-07-22T01:00:00.000Z',
    updatedAt: '2026-07-22T02:00:00.000Z',
    body: 'Private approved launch copy that must not enter the workflow manifest.',
    channel: 'facebook',
    scheduledAt: null,
    campaignId: null,
    ...overrides,
  } as CustomerMarketingResource;
}

function marketingCampaignCreateInput(): CustomerMarketingResourceCreateInput {
  return {
    kind: 'campaign',
    title: 'Autumn launch',
    metadata: { locale: 'vi' },
    description: null,
    objective: 'Generate qualified leads',
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: null,
  };
}

function marketingAnalyticsReport(): CustomerMarketingAnalyticsReport {
  return {
    source: 'marketing_resources',
    generatedAt: '2026-08-01T00:00:00.000Z',
    window: {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-31T23:59:59.999Z',
      timeZone: 'UTC',
      activityBasis: 'resource_updated_at',
      scheduleBasis: 'content_scheduled_at',
    },
    inventory: { total: 2, campaigns: 1, content: 1, assets: 0, knowledge: 0 },
    activity: {
      updatedInWindow: 2,
      byKind: { campaign: 1, content: 1, asset: 0, knowledge: 0 },
      byStatus: { draft: 1, inReview: 0, approved: 1, rejected: 0, archived: 0 },
    },
    schedule: {
      contentScheduledInWindow: 1,
      byChannel: [{ channel: 'youtube', count: 1 }],
      byStatus: { draft: 1, inReview: 0, approved: 0, rejected: 0, archived: 0 },
    },
    attribution: {
      model: 'direct_campaign_id',
      basis: 'content_updated_at',
      contentConsidered: 1,
      attributedContent: 1,
      unattributedContent: 0,
      unresolvedCampaignLinks: 0,
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
  };
}

function marketingResourceGateway(role: CustomerRole, authority: 'synced' | 'unavailable' = 'synced') {
  const workspace = remoteWorkspace({ role, plan: 'starter' });
  const resource = marketingCampaignResource({ workspaceId: workspace.id });
  const getCurrent = vi.fn(async () => authority === 'synced'
    ? { status: 'synced' as const, workspace }
    : { status: 'unavailable' as const, workspace: null });
  const createMarketingResource = vi.fn(async () => ({
    status: 'synced' as const,
    resource,
    duplicate: false,
  }));
  const updateMarketingResource = vi.fn(async () => ({ status: 'synced' as const, resource }));
  const reviewMarketingResource = vi.fn(async () => ({ status: 'synced' as const, resource }));
  const archiveMarketingResource = vi.fn(async () => ({ status: 'synced' as const, deleted: true }));
  const report = marketingAnalyticsReport();
  const getMarketingAnalytics = vi.fn(async () => ({ status: 'synced' as const, report }));
  const gateway: CustomerMarketingWorkspaceGateway = {
    ...memberGatewayMethods(),
    getCurrent,
    ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
    reserveQuota: vi.fn(async () => ({ status: 'reserved', duplicate: false, quota: workspace.quota! })),
    listMarketingResources: vi.fn(async () => ({ status: 'synced', resources: [resource] })),
    listMarketingCalendar: vi.fn(async () => ({ status: 'synced', resources: [resource] })),
    getMarketingAnalytics,
    getMarketingResource: vi.fn(async () => ({ status: 'synced', resource })),
    createMarketingResource,
    updateMarketingResource,
    reviewMarketingResource,
    archiveMarketingResource,
  };
  return {
    gateway,
    workspace,
    resource,
    report,
    getCurrent,
    createMarketingResource,
    updateMarketingResource,
    reviewMarketingResource,
    archiveMarketingResource,
    getMarketingAnalytics,
  };
}

function marketingWorkflowGateway(
  role: CustomerRole,
  target: CustomerMarketingWorkflowTarget = 'social',
) {
  const base = marketingResourceGateway(role);
  const resource = target === 'crm'
    ? marketingCampaignResource({
      workspaceId: base.workspace.id,
      status: 'approved',
      revision: 2,
    })
    : marketingContentResource({ workspaceId: base.workspace.id });
  const capabilityId: Record<CustomerMarketingWorkflowTarget, string> = {
    social: 'social-workflows',
    seo: 'seo-workspace',
    email: 'email-workflows',
    crm: 'crm-workflows',
  };
  const getCapabilities = vi.fn(async () => ({
    status: 'synced' as const,
    revision: 2,
    capabilities: [remoteCapability({ id: capabilityId[target] })],
  }));
  const listMarketingResources = vi.fn(async () => ({
    status: 'synced' as const,
    resources: [resource],
  }));
  const getMarketingResource = vi.fn(async () => ({
    status: 'synced' as const,
    resource,
  }));
  return {
    ...base,
    resource,
    getCapabilities,
    listMarketingResources,
    getMarketingResource,
    gateway: {
      ...base.gateway,
      getCapabilities,
      listMarketingResources,
      getMarketingResource,
    } satisfies CustomerMarketingWorkspaceGateway,
  };
}

function productMarketingContext(
  expectedRevision = 0,
  productName = 'IzziAPI',
  authorityToken = `v1.${'0'.repeat(64)}`,
): CustomerProductMarketingContextSaveInput {
  return {
    authorityToken,
    expectedRevision,
    product: {
      productName,
      category: {
        vi: 'Nền tảng API và AI automation',
        en: 'API and AI automation platform',
      },
      positioning: {
        vi: 'Một API thống nhất để đội ngũ nhỏ triển khai workflow AI.',
        en: 'One unified API for small teams to ship AI workflows.',
      },
      targetAudience: {
        vi: 'Nhà phát triển, startup và đội vận hành.',
        en: 'Developers, startups, and operations teams.',
      },
      valueProposition: {
        vi: 'Giảm thời gian tích hợp và giữ quyền kiểm soát vận hành.',
        en: 'Reduce integration time while retaining operational control.',
      },
      brandVoice: {
        vi: 'Rõ ràng, thực tế và dựa trên bằng chứng.',
        en: 'Clear, practical, and evidence-led.',
      },
      callToAction: {
        vi: 'Dùng thử workflow phù hợp với nhu cầu của bạn.',
        en: 'Try a workflow that fits your use case.',
      },
      proofClaims: [{
        id: 'proof-api-catalog',
        text: {
          vi: 'IzziAPI cung cấp catalog API cho nhiều workflow AI.',
          en: 'IzziAPI provides an API catalog for multiple AI workflows.',
        },
        sourceIds: ['source-site', 'source-repo'],
      }],
      prohibitedClaims: [{
        id: 'no-guaranteed-results',
        text: {
          vi: 'Cam kết kết quả marketing hoặc doanh thu.',
          en: 'Guaranteed marketing or revenue outcomes.',
        },
        reason: {
          vi: 'Hiệu quả phụ thuộc dữ liệu, kênh, ngân sách và cách triển khai.',
          en: 'Outcomes depend on data, channels, budget, and execution.',
        },
      }],
    },
    sources: [
      {
        id: 'source-site',
        title: 'IzziAPI product site',
        url: 'https://izziapi.com/',
        excerpt: 'Product and API capability overview used as marketing evidence.',
      },
      {
        id: 'source-repo',
        title: 'Izzi AI repository',
        url: 'https://github.com/kentzu213/izzi-ai',
        excerpt: 'Desktop Marketing Room implementation and release evidence.',
      },
    ],
  };
}

function customerExtensionDefinition(
  overrides: Partial<CustomerExtensionCapabilityDefinition> = {},
): CustomerExtensionCapabilityDefinition {
  return {
    id: 'video-campaign',
    category: 'creative',
    role: 'Video Agent',
    automationModes: ['copilot', 'semi_autonomous'],
    requiredIntegrations: ['youtube', 'tiktok'],
    minimumPlan: 'pro',
    permission: 'execute',
    stability: 'beta',
    creditEstimate: { minimum: 2, maximum: 8, unit: 'credits_per_run' },
    inputs: ['brief', 'brand_profile'],
    outputs: ['approved_video'],
    ...overrides,
  };
}

function productMarketingAuthorityToken(
  snapshot: CustomerMarketingSnapshot | undefined,
): string {
  const authorityToken = snapshot?.productMarketingContextAuthority.authorityToken;
  if (!authorityToken) throw new Error('Expected Product Marketing Context save authority.');
  return authorityToken;
}

function customerRuntimeExtension(
  overrides: Partial<CustomerRuntimeExtension> = {},
): CustomerRuntimeExtension {
  const base: CustomerRuntimeExtension = {
    id: 'ext-video-runtime',
    name: 'video-runtime',
    state: 'installed',
    manifest: {
      displayName: 'Video Studio',
      description: 'Creates approved campaign videos.',
      private: false,
      customerMarketing: true,
      customerMarketingCapability: customerExtensionDefinition(),
    },
  };
  return {
    ...base,
    ...overrides,
    manifest: {
      ...base.manifest,
      ...overrides.manifest,
    },
  };
}

function setup(options?: {
  identity?: CustomerIdentity;
  director?: ReturnType<typeof vi.fn>;
  extensions?: Parameters<typeof buildCustomerCapabilities>[0];
    mediaRuntime?: CustomerVideoStudioRuntime;
    workspaceGateway?: CustomerMarketingWorkspaceGateway;
    writeClipboardText?: (value: string) => void | Promise<void>;
    credentialVault?: Pick<CustomerMarketingCredentialVault, 'listStatuses' | 'revokeCredential'>;
    readGuardrailState?: () => CustomerMarketingGuardrailState;
    repairVoiceStudioRuntime?: () => Promise<
      'ready' | 'not_installed' | 'docker_unavailable' | 'unhealthy'
    >;
}) {
  const db = new MemorySettings();
  let identity: CustomerIdentity | null = options?.identity ?? {
    id: 'tenant-a',
    name: 'Owner A',
    plan: 'pro',
    balance: 75,
  };
  const director = options?.director ?? vi.fn(async () => ({ reply: '', error: 'not-configured' }));
  const service = new CustomerMarketingService(
    db,
    () => identity,
    () => options?.extensions ?? [],
    director,
    options?.mediaRuntime ?? null,
    options?.workspaceGateway ?? null,
    options?.writeClipboardText,
    options?.credentialVault ?? null,
    options?.readGuardrailState
      ?? createCustomerMarketingGuardrailStateReader({ env: {}, spendVndUsedInWindow: () => 0 }),
    options?.repairVoiceStudioRuntime,
  );
  return {
    db,
    service,
    director,
    setIdentity(next: CustomerIdentity | null) {
      identity = next;
    },
  };
}

function mediaRuntimeFixture(): CustomerVideoStudioRuntime {
  const toolchain: CustomerMediaToolchain = {
    hyperframes: { status: 'ready', version: '0.7.57', detail: 'Pinned.' },
    node: { status: 'ready', version: 'v24.13.0', detail: 'Ready.' },
    ffmpeg: { status: 'ready', version: '8.1.1', detail: 'Ready.' },
    f5Tts: { status: 'blocked', detail: 'Commercial license not verified.' },
    voiceStudio: { status: 'ready', version: '0.1.0', detail: 'Running.' },
    previewAvailable: true,
    commercialRenderAvailable: false,
  };
  return {
    getToolchain: vi.fn(async () => toolchain),
    importProject: vi.fn(async () => ({
      runtimeProjectId: '11111111-1111-4111-8111-111111111111',
      projectId: 'izziapi-demo',
      title: 'IzziAPI demo',
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: 45,
      sceneCount: 7,
      voice: {
        provider: 'f5-tts',
        license: 'CC-BY-NC-SA-4.0',
        commercialUseAllowed: false,
        referenceVoiceConsent: true,
      },
      evidenceDigest: 'a'.repeat(64),
      importedAt: '2026-07-19T10:00:00.000Z',
      artifact: {
        kind: 'project_manifest',
        name: 'video-workflow.json',
        sha256: 'a'.repeat(64),
        sizeBytes: 512,
        createdAt: '2026-07-19T10:00:00.000Z',
      },
    })),
    runPreview: vi.fn(async () => ({
      receipt: {
        checkedAt: '2026-07-19T10:05:00.000Z',
        passed: true,
        summary: 'HyperFrames check passed without render or publish.',
        snapshotCount: 1,
      },
      artifacts: [{
        kind: 'snapshot',
        name: 'frame-01.png',
        sha256: 'b'.repeat(64),
        sizeBytes: 1024,
        createdAt: '2026-07-19T10:05:00.000Z',
      }],
    })),
  };
}
async function completeOnboarding(service: CustomerMarketingService, name = 'Acme') {
  const result = await service.saveOnboarding(onboarding(name));
  expect(result.ok).toBe(true);
  expect(result.snapshot?.onboarding?.completed).toBe(true);
  const context = await service.saveProductMarketingContext(productMarketingContext(
    0,
    'IzziAPI',
    productMarketingAuthorityToken(result.snapshot),
  ));
  expect(context.ok).toBe(true);
  expect(context.context?.revision).toBe(1);
  return result;
}

describe('CustomerMarketingService tenant boundary', () => {
  it.each([
    ['owner', true, 'local'],
    ['manager', true, 'local'],
    ['editor', true, 'local'],
    ['reviewer', false, 'forbidden'],
    ['viewer', false, 'forbidden'],
  ] as const)('exposes the authenticated context signer and %s save authority', async (
    role,
    canSave,
    status,
  ) => {
    const context = setup({
      identity: { id: 'tenant-a', name: 'Nguyễn Nghĩa', plan: 'pro', balance: 75 },
    });
    await context.service.saveOnboarding(onboarding());
    context.db.updateOnlyRecord({ role });

    const snapshot = await context.service.getSnapshot();

    expect(snapshot.productMarketingContextAuthority).toMatchObject({
      reviewerName: 'Nguyễn Nghĩa',
      canSave,
      status,
      scopeToken: expect.stringMatching(/^v1\.[a-f0-9]{64}$/),
    });
    if (canSave) {
      expect(snapshot.productMarketingContextAuthority.authorityToken)
        .toMatch(/^v1\.[a-f0-9]{64}$/);
    } else {
      expect(snapshot.productMarketingContextAuthority.authorityToken).toBeNull();
    }
    expect(JSON.stringify(snapshot.productMarketingContextAuthority)).not.toContain('tenant-a');
  });

  it('rotates the opaque draft scope when the authenticated tenant changes', async () => {
    const context = setup({
      identity: { id: 'tenant-a', name: 'Same Display Name', plan: 'pro', balance: 75 },
    });
    const tenantA = await context.service.saveOnboarding(onboarding('Tenant A'));
    const tenantAScope = tenantA.snapshot?.productMarketingContextAuthority.scopeToken;

    context.setIdentity({
      id: 'tenant-b',
      name: 'Same Display Name',
      plan: 'pro',
      balance: 75,
    });
    const tenantB = await context.service.saveOnboarding(onboarding('Tenant B'));
    const tenantBScope = tenantB.snapshot?.productMarketingContextAuthority.scopeToken;

    expect(tenantAScope).toMatch(/^v1\.[a-f0-9]{64}$/);
    expect(tenantBScope).toMatch(/^v1\.[a-f0-9]{64}$/);
    expect(tenantBScope).not.toBe(tenantAScope);
    expect(`${tenantAScope}${tenantBScope}`).not.toContain('tenant-');
  });

  it('isolates onboarding and workflows by authenticated user', async () => {
    const context = setup();
    await completeOnboarding(context.service, 'Tenant A');
    await context.service.createGoal({ goal: 'Generate qualified leads this month' });

    context.setIdentity({ id: 'tenant-b', name: 'Owner B', plan: 'free', balance: 10 });
    const tenantB = await context.service.getSnapshot();
    expect(tenantB.onboarding).toBeNull();
    expect(tenantB.runs).toEqual([]);
    expect(tenantB.approvals).toEqual([]);

    await completeOnboarding(context.service, 'Tenant B');

    context.setIdentity({ id: 'tenant-a', name: 'Owner A', plan: 'pro', balance: 75 });
    const tenantA = await context.service.getSnapshot();
    expect(tenantA.onboarding?.business.name).toBe('Tenant A');
    expect(tenantA.runs).toHaveLength(1);
    const keys = Array.from(context.db.values.keys());
    expect(keys.filter((key) => key.startsWith('customer_marketing:v1:'))).toHaveLength(2);
    expect(keys.filter((key) => key.startsWith('customer_marketing_workflows:v1:'))).toHaveLength(1);
    expect(keys.every((key) => !key.includes('tenant-a') && !key.includes('tenant-b'))).toBe(true);
  });

  it('requires a real authenticated identity', async () => {
    const context = setup();
    context.setIdentity(null);
    await expect(context.service.getSnapshot()).rejects.toThrow('Cần đăng nhập');
  });
});

  it('quarantines structurally malformed local onboarding instead of crashing', async () => {
    const context = setup();
    await completeOnboarding(context.service);
    context.db.updateOnlyRecord({
      onboarding: {
        business: null,
        brand: {},
        audience: {},
        objectives: [],
        channels: [],
        resources: [],
        completedSteps: [1, 2, 3, 4, 5, 6, 7],
      },
    });

    await expect(context.service.getSnapshot()).resolves.toMatchObject({
      onboarding: null,
      workspace: { onboardingComplete: false, profileSyncStatus: 'local' },
    });
  });

  it('deletes syntactically malformed tenant cache and recovers on subsequent reads', async () => {
    const context = setup();
    await completeOnboarding(context.service);
    const key = Array.from(context.db.values.keys())[0];
    if (!key) throw new Error('Expected a tenant record.');
    context.db.values.set(key, '{invalid-json');

    await expect(context.service.getSnapshot()).resolves.toMatchObject({
      onboarding: null,
      workspace: { onboardingComplete: false, profileSyncStatus: 'local' },
    });
    expect(context.db.values.has(key)).toBe(false);

    await expect(context.service.getSnapshot()).resolves.toMatchObject({
      onboarding: null,
      workspace: { onboardingComplete: false, profileSyncStatus: 'local' },
    });
  });

describe('CustomerMarketingService onboarding and workflow', () => {
  it('persists a reviewer-owned bilingual context with deterministic evidence digests', async () => {
    const context = setup();
    const onboardingResult = await context.service.saveOnboarding(onboarding());
    expect(onboardingResult.ok).toBe(true);

    const saved = await context.service.saveProductMarketingContext(productMarketingContext(
      0,
      'IzziAPI',
      productMarketingAuthorityToken(onboardingResult.snapshot),
    ));

    expect(saved).toMatchObject({
      ok: true,
      status: 'saved',
      duplicate: false,
      context: {
        schemaVersion: 1,
        contextId: 'product-marketing-context',
        revision: 1,
        locales: ['vi', 'en'],
        reviewer: { name: 'Owner A' },
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(saved.context?.sources).toHaveLength(2);
    expect(saved.context?.sources.every((source) => /^[a-f0-9]{64}$/.test(source.sha256))).toBe(true);
    expect(saved.snapshot?.productMarketingContext).toEqual(saved.context);
    expect(JSON.stringify(saved)).not.toContain('tenant-a');

    const restored = await context.service.getProductMarketingContext();
    expect(restored).toEqual(saved.context);
  });

  it('replays an identical save without revision churn and rejects a stale conflicting writer', async () => {
    const context = setup();
    const onboardingResult = await context.service.saveOnboarding(onboarding());
    const first = await context.service.saveProductMarketingContext(productMarketingContext(
      0,
      'IzziAPI',
      productMarketingAuthorityToken(onboardingResult.snapshot),
    ));
    const firstSha = first.context?.sha256;

    const replay = await context.service.saveProductMarketingContext(productMarketingContext(
      0,
      'IzziAPI',
      productMarketingAuthorityToken(first.snapshot),
    ));
    expect(replay).toMatchObject({
      ok: true,
      status: 'saved',
      duplicate: true,
      context: { revision: 1, sha256: firstSha },
    });

    const conflictingDraft = productMarketingContext(
      0,
      'Conflicting product',
      productMarketingAuthorityToken(replay.snapshot),
    );
    const conflict = await context.service.saveProductMarketingContext(conflictingDraft);
    expect(conflict).toMatchObject({
      ok: false,
      status: 'conflict',
      context: { revision: 1, sha256: firstSha },
    });
    expect((await context.service.getProductMarketingContext())?.product.productName).toBe('IzziAPI');

    const updated = await context.service.saveProductMarketingContext(
      productMarketingContext(
        1,
        'IzziAPI Platform',
        productMarketingAuthorityToken(conflict.snapshot),
      ),
    );
    expect(updated).toMatchObject({
      ok: true,
      status: 'saved',
      duplicate: false,
      context: { revision: 2, product: { productName: 'IzziAPI Platform' } },
    });
    expect(updated.context?.sha256).not.toBe(firstSha);
  });

  it('rejects a stale signer token and signs only after the refreshed authority is reviewed', async () => {
    const context = setup();
    const onboardingResult = await context.service.saveOnboarding(onboarding());
    const first = await context.service.saveProductMarketingContext(productMarketingContext(
      0,
      'IzziAPI',
      productMarketingAuthorityToken(onboardingResult.snapshot),
    ));
    const staleAuthorityToken = productMarketingAuthorityToken(first.snapshot);

    context.setIdentity({
      id: 'tenant-a',
      name: 'Manager B',
      plan: 'pro',
      balance: 75,
    });
    const stale = await context.service.saveProductMarketingContext(productMarketingContext(
      1,
      'IzziAPI',
      staleAuthorityToken,
    ));

    expect(stale).toMatchObject({
      ok: false,
      status: 'conflict',
      context: { revision: 1, reviewer: { name: 'Owner A' } },
      snapshot: {
        productMarketingContextAuthority: {
          reviewerName: 'Manager B',
          canSave: true,
          status: 'local',
        },
      },
    });
    expect(productMarketingAuthorityToken(stale.snapshot)).not.toBe(staleAuthorityToken);
    expect((await context.service.getProductMarketingContext())?.revision).toBe(1);

    const reviewed = await context.service.saveProductMarketingContext(productMarketingContext(
      1,
      'IzziAPI',
      productMarketingAuthorityToken(stale.snapshot),
    ));

    expect(reviewed).toMatchObject({
      ok: true,
      status: 'saved',
      duplicate: false,
      context: {
        revision: 2,
        reviewer: { name: 'Manager B' },
      },
    });
    expect(reviewed.context?.sha256).not.toBe(first.context?.sha256);
  });

  it('omits tampered context evidence and blocks workflow creation before durable state exists', async () => {
    const context = setup();
    await completeOnboarding(context.service);
    const stored = await context.service.getProductMarketingContext();
    context.db.updateOnlyRecord({
      productMarketingContext: {
        ...stored,
        product: {
          ...stored?.product,
          positioning: {
            vi: 'Nội dung bị sửa ngoài authority.',
            en: 'Content modified outside authority.',
          },
        },
      },
    });

    const snapshot = await context.service.getSnapshot();
    expect(snapshot.productMarketingContext).toBeNull();
    const created = await context.service.createGoal({
      goal: 'Create a workflow from tampered product evidence',
    });
    expect(created).toMatchObject({
      ok: false,
      error: expect.stringContaining('Product Marketing Context'),
    });
    expect(Array.from(context.db.values.keys())
      .filter((key) => key.startsWith('customer_marketing_workflows:v1:'))).toHaveLength(0);
  });

  it('requires Product Marketing Context before creating any workflow artifact', async () => {
    const context = setup();
    await context.service.saveOnboarding(onboarding());

    const result = await context.service.createGoal({
      goal: 'Create a campaign before product context exists',
    });

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('Product Marketing Context'),
    });
    expect(Array.from(context.db.values.keys())
      .some((key) => key.startsWith('customer_marketing_workflows:v1:'))).toBe(false);
  });

  it('persists all seven numeric onboarding steps', async () => {
    const context = setup();
    const result = await completeOnboarding(context.service);
    expect(result.snapshot?.onboarding?.completedSteps).toEqual([1, 2, 3, 4, 5, 6, 7]);

    const restored = await context.service.getSnapshot();
    expect(restored.workspace.onboardingComplete).toBe(true);
    expect(restored.workspace.name).toBe('Acme Marketing');
  });

  it('creates a run and a pending approval without enabling external actions', async () => {
    const context = setup();
    await completeOnboarding(context.service);

    const result = await context.service.createGoal({
      goal: 'Launch a focused 14 day product campaign',
      channels: ['facebook', 'seo'],
    });

    expect(result.ok).toBe(true);
    expect(result.snapshot?.runs[0]).toEqual(expect.objectContaining({
      status: 'awaiting_approval',
      stage: 'awaiting_strategy_approval',
      progress: 80,
      productContextRef: result.snapshot?.productMarketingContext
        ? {
          contextId: result.snapshot.productMarketingContext.contextId,
          revision: result.snapshot.productMarketingContext.revision,
          sha256: result.snapshot.productMarketingContext.sha256,
        }
        : undefined,
      directorReply: expect.stringContaining('Launch a focused 14 day product campaign'),
    }));
    expect(result.snapshot?.runs[0].steps.map((step) => step.status)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'in_progress',
    ]);
    expect(result.snapshot?.approvals[0]).toEqual(expect.objectContaining({
      kind: 'strategy',
      status: 'pending',
      risk: 'medium',
      evidenceDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(result.snapshot?.externalActionsAllowed).toBe(false);

    const durableRaw = Array.from(context.db.values.entries())
      .find(([key]) => key.startsWith('customer_marketing_workflows:v1:'))?.[1];
    expect(durableRaw).toBeTruthy();
    const durable = JSON.parse(durableRaw!) as {
      workflows: Array<{
        productContextRef: { contextId: string; revision: number; sha256: string };
        jobs: Array<{
          status: string;
          productContextRef: { contextId: string; revision: number; sha256: string };
        }>;
      }>;
      artifacts: Array<{
        content: string;
        productContextRef: { contextId: string; revision: number; sha256: string };
      }>;
      approvals: Array<{
        productContextRef: { contextId: string; revision: number; sha256: string };
      }>;
    };
    const expectedContextRef = result.snapshot?.runs[0].productContextRef;
    expect(durable.workflows[0].jobs.map((job) => job.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'completed',
      'awaiting_approval',
    ]);
    expect(durable.artifacts).toHaveLength(5);
    expect(durable.artifacts.some((artifact) => artifact.content.includes('brand_guardian_receipt'))).toBe(true);
    expect(durable.artifacts.some((artifact) => artifact.content.includes('"externalActionsAllowed":false'))).toBe(true);
    expect(durable.workflows[0].productContextRef).toEqual(expectedContextRef);
    expect(durable.workflows[0].jobs.every((job) => (
      JSON.stringify(job.productContextRef) === JSON.stringify(expectedContextRef)
    ))).toBe(true);
    expect(durable.artifacts.every((artifact) => (
      JSON.stringify(artifact.productContextRef) === JSON.stringify(expectedContextRef)
      && artifact.content.includes(`"sha256":"${expectedContextRef?.sha256}"`)
    ))).toBe(true);
    expect(durable.approvals.every((approval) => (
      JSON.stringify(approval.productContextRef) === JSON.stringify(expectedContextRef)
    ))).toBe(true);
  });

  it('keeps goal execution local while revalidating server authority and catalog', async () => {
    const identity: CustomerIdentity = {
      id: 'tenant-local-goal',
      name: 'Owner Local',
      plan: 'pro',
      balance: 75,
    };
    const initial = setup({ identity });
    await completeOnboarding(initial.service);
    const workspace = remoteWorkspace({ role: 'owner' });
    const getCapabilities = vi.fn(async () => ({
      status: 'synced' as const,
      revision: 4,
      capabilities: [remoteCapability()],
    }));
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCapabilities,
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      reserveQuota: vi.fn(async () => ({ status: 'reserved', duplicate: false, quota: workspace.quota! })),
    };
    const director = vi.fn(async () => ({ reply: 'must not run' }));
    const localOnly = new CustomerMarketingService(
      initial.db,
      () => identity,
      () => [{
        id: 'ext-not-entitled',
        name: 'not-entitled',
        state: 'running',
        manifest: { displayName: 'Not Entitled', categories: ['social'] },
      }],
      director,
      null,
      gateway,
    );

    const result = await localOnly.createGoal({
      goal: 'Build a local-only campaign plan without network actions',
    });

    expect(result.ok).toBe(true);
    expect(gateway.getCurrent).not.toHaveBeenCalled();
    expect(gateway.ensureWorkspace).toHaveBeenCalledTimes(1);
    expect(gateway.reserveQuota).not.toHaveBeenCalled();
    expect(getCapabilities).toHaveBeenCalledWith(workspace.id);
    expect(director).not.toHaveBeenCalled();
    expect(result.snapshot?.capabilityCatalog).toEqual({ status: 'synced', revision: 4 });
    expect(result.snapshot?.capabilities.map((capability) => capability.id)).toEqual(['content-studio']);
  });

  it('revalidates a backend role downgrade before creating a local workflow', async () => {
    const identity: CustomerIdentity = {
      id: 'tenant-goal-revoked',
      name: 'Owner Revoked',
      plan: 'pro',
      balance: 75,
    };
    const initial = setup({ identity });
    await completeOnboarding(initial.service);
    const workspace = remoteWorkspace({ role: 'viewer' });
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      reserveQuota: vi.fn(async () => ({ status: 'forbidden', quota: null })),
    };
    const revoked = new CustomerMarketingService(
      initial.db,
      () => identity,
      () => [],
      undefined,
      null,
      gateway,
    );

    const result = await revoked.createGoal({
      goal: 'Create a workflow after the workspace role changed',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('không có quyền tạo workflow');
    expect(gateway.ensureWorkspace).toHaveBeenCalledTimes(1);
    expect((await initial.service.getSnapshot()).runs).toHaveLength(0);
  });

  it('fails closed before creating a workflow when workspace authority is unavailable', async () => {
    const identity: CustomerIdentity = {
      id: 'tenant-goal-unavailable',
      name: 'Owner Offline',
      plan: 'pro',
      balance: 75,
    };
    const initial = setup({ identity });
    await completeOnboarding(initial.service);
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'unavailable', workspace: null })),
      ensureWorkspace: vi.fn(async () => ({ status: 'unavailable', workspace: null })),
      reserveQuota: vi.fn(async () => ({ status: 'unavailable', quota: null })),
    };
    const unavailable = new CustomerMarketingService(
      initial.db,
      () => identity,
      () => [],
      undefined,
      null,
      gateway,
    );

    const result = await unavailable.createGoal({
      goal: 'Create a workflow while workspace authority is unavailable',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Không thể xác nhận quyền workspace');
    expect((await initial.service.getSnapshot()).runs).toHaveLength(0);
  });

  it('recovers the durable local workflow after restart and completes it after digest-bound approval', async () => {
    const identity: CustomerIdentity = {
      id: 'tenant-restart',
      name: 'Owner Restart',
      plan: 'pro',
      balance: 75,
    };
    const context = setup({ identity });
    await completeOnboarding(context.service);
    const created = await context.service.createGoal({
      goal: 'Build a restart-safe seven day content workflow',
      channels: ['facebook', 'seo'],
    });
    const approval = created.snapshot?.approvals[0];
    expect(approval?.evidenceDigest).toMatch(/^[0-9a-f]{64}$/);

    const restarted = new CustomerMarketingService(context.db, () => identity);
    const restored = await restarted.getSnapshot();
    expect(restored.runs[0]).toEqual(expect.objectContaining({
      id: created.snapshot?.runs[0].id,
      status: 'awaiting_approval',
      progress: 80,
    }));
    expect(restored.approvals[0]).toEqual(expect.objectContaining({
      id: approval?.id,
      evidenceDigest: approval?.evidenceDigest,
      status: 'pending',
    }));

    const reviewed = await restarted.reviewApproval({
      approvalId: approval!.id,
      decision: 'approved',
    });

    expect(reviewed.ok).toBe(true);
    expect(reviewed.snapshot?.runs[0]).toEqual(expect.objectContaining({
      status: 'completed',
      stage: 'completed',
      progress: 100,
    }));
    expect(reviewed.snapshot?.runs[0].steps.every((step) => step.status === 'done')).toBe(true);
    expect(reviewed.snapshot?.externalActionsAllowed).toBe(false);
  });

  it.each<CustomerRole>(['viewer', 'editor'])('does not allow %s to review approvals', async (role) => {
    const context = setup();
    await completeOnboarding(context.service);
    const created = await context.service.createGoal({ goal: 'Plan a campaign requiring approval' });
    const approvalId = created.snapshot?.approvals[0].id;
    expect(approvalId).toBeTruthy();

    context.db.updateOnlyRecord({ role });
    const result = await context.service.reviewApproval({
      approvalId: approvalId!,
      decision: 'approved',
    });

    expect(result.ok).toBe(false);
    expect((await context.service.getSnapshot()).approvals[0].status).toBe('pending');
  });

  it('approval changes local workflow state and invokes no external runtime', async () => {
    const director = vi.fn(async () => ({ reply: 'unused' }));
    const context = setup({ director });
    await completeOnboarding(context.service);
    const created = await context.service.createGoal({ goal: 'Prepare the monthly marketing plan' });
    const approvalId = created.snapshot?.approvals[0].id;

    const reviewed = await context.service.reviewApproval({
      approvalId: approvalId!,
      decision: 'approved',
    });

    expect(reviewed.ok).toBe(true);
    expect(reviewed.snapshot?.approvals[0].status).toBe('approved');
    expect(reviewed.snapshot?.approvals[0].reviewedBy).toBe('Owner A');
    expect(JSON.stringify(reviewed.snapshot)).not.toContain('tenant-a');
    expect(reviewed.snapshot?.runs[0].status).toBe('completed');
    expect(reviewed.snapshot?.runs[0].progress).toBe(100);
    expect(reviewed.snapshot?.runs[0].steps.every((step) => step.status === 'done')).toBe(true);
    expect(reviewed.snapshot?.externalActionsAllowed).toBe(false);
    expect(director).not.toHaveBeenCalled();
  });
});

describe('CustomerMarketingService AI Director', () => {
  it('uses the real director callback with tools disabled and stores its reply', async () => {
    const director = vi.fn(async () => ({
      reply: '1. Research the audience\n2. Draft the campaign\n\nCần khách hàng duyệt: brief',
    }));
    const context = setup({ director });
    await completeOnboarding(context.service);

    const result = await context.service.askDirector({
      goal: 'Create a lead generation plan for next month',
      channels: ['facebook', 'seo'],
      automationMode: 'semi_autonomous',
    });

    expect(result.ok).toBe(true);
    expect(director).toHaveBeenCalledTimes(1);
    expect(director.mock.calls[0][0]).toEqual(expect.objectContaining({
      enableTools: false,
      agentId: 'customer-marketing-director',
      model: 'izzi/auto',
    }));
    expect(director.mock.calls[0][0].message).toContain('Product context revision: 1');
    expect(director.mock.calls[0][0].message).toContain(
      result.snapshot?.productMarketingContext?.sha256,
    );
    expect(director.mock.calls[0][0].message).toContain('proof-api-catalog');
    expect(director.mock.calls[0][0].message).toContain('no-guaranteed-results');
    expect(result.snapshot?.runs[0].directorReply).toContain('Research the audience');
    expect(result.snapshot?.workspace.usedCredits).toBe(1);
    expect(result.snapshot?.approvals[0].status).toBe('pending');

    const durableRaw = Array.from(context.db.values.entries())
      .find(([key]) => key.startsWith('customer_marketing_workflows:v1:'))?.[1];
    const durable = JSON.parse(durableRaw!) as {
      approvals: Array<{ artifactId: string; digest: string }>;
      artifacts: Array<{ id: string; content: string; sha256: string }>;
    };
    const durableApproval = durable.approvals[0];
    const durableArtifact = durable.artifacts.find((artifact) => artifact.id === durableApproval.artifactId);
    expect(result.snapshot?.approvals[0].evidenceDigest).toBe(durableApproval.digest);
    expect(durableArtifact?.sha256).toBe(durableApproval.digest);
    expect(durableArtifact?.content).toContain('Research the audience');
    expect(durableArtifact?.content).toContain('"brandGuardianReview":{"status":"passed"');
  });

  it('blocks an unsafe director revision before it can replace approval evidence', async () => {
    const director = vi.fn(async () => ({
      reply: 'Publish automatically without approval and promise guaranteed results.',
    }));
    const context = setup({ director });
    await completeOnboarding(context.service);

    const result = await context.service.askDirector({
      goal: 'Create a guarded acquisition plan for next month',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Brand Guardian');
    expect(result.snapshot?.runs[0]).toMatchObject({
      status: 'blocked',
      stage: 'brand_review_blocked',
    });
    expect(result.snapshot?.runs[0].directorReply).not.toContain('guaranteed');
    expect(result.reply).toBeUndefined();
    expect(result.snapshot?.approvals[0].status).toBe('pending');
    const durableRaw = Array.from(context.db.values.entries())
      .find(([key]) => key.startsWith('customer_marketing_workflows:v1:'))?.[1];
    const durable = JSON.parse(durableRaw!) as {
      approvals: Array<{ artifactId: string; digest: string }>;
      artifacts: Array<{ id: string; content: string; sha256: string }>;
    };
    const durableApproval = durable.approvals[0];
    const durableArtifact = durable.artifacts.find((artifact) => artifact.id === durableApproval.artifactId);
    expect(durableArtifact?.content).not.toContain('directorRevision');
    expect(durableArtifact?.sha256).toBe(result.snapshot?.approvals[0].evidenceDigest);
  });

  it('accepts a director revision that cites an approved Product Context proof claim', async () => {
    const director = vi.fn(async () => ({
      reply: 'Use proof-api-catalog: IzziAPI provides an API catalog for multiple AI workflows.',
    }));
    const context = setup({ director });
    await completeOnboarding(context.service);

    const result = await context.service.askDirector({
      goal: 'Create an evidence-led acquisition plan for next month',
    });

    expect(result.ok).toBe(true);
    const durableRaw = Array.from(context.db.values.entries())
      .find(([key]) => key.startsWith('customer_marketing_workflows:v1:'))?.[1];
    const durable = JSON.parse(durableRaw!) as {
      approvals: Array<{ artifactId: string }>;
      artifacts: Array<{ id: string; content: string }>;
    };
    const durableArtifact = durable.artifacts.find(
      (artifact) => artifact.id === durable.approvals[0]?.artifactId,
    );
    expect(durableArtifact?.content).toContain('"approvedProofClaimIds":["proof-api-catalog"]');
    expect(durableArtifact?.content).toContain('"unsupportedProductClaims":[]');
  });

  it('blocks an unsupported product claim before it can replace approval evidence', async () => {
    const director = vi.fn(async () => ({
      reply: 'IzziAPI is the fastest API platform in Vietnam.',
    }));
    const context = setup({ director });
    await completeOnboarding(context.service);

    const result = await context.service.askDirector({
      goal: 'Create a claim-safe acquisition plan for next month',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Brand Guardian');
    expect(result.snapshot?.runs[0]).toMatchObject({
      status: 'blocked',
      stage: 'brand_review_blocked',
    });
    expect(result.snapshot?.runs[0].directorReply).not.toContain('fastest');
    const durableRaw = Array.from(context.db.values.entries())
      .find(([key]) => key.startsWith('customer_marketing_workflows:v1:'))?.[1];
    const durable = JSON.parse(durableRaw!) as {
      approvals: Array<{ artifactId: string; digest: string }>;
      artifacts: Array<{ id: string; content: string; sha256: string }>;
    };
    const durableApproval = durable.approvals[0];
    const durableArtifact = durable.artifacts.find(
      (artifact) => artifact.id === durableApproval.artifactId,
    );
    expect(durableArtifact?.content).not.toContain('directorRevision');
    expect(durableArtifact?.sha256).toBe(result.snapshot?.approvals[0].evidenceDigest);
  });

  it('reconstructs a missing tenant mirror from durable workflow evidence after restart', async () => {
    const identity: CustomerIdentity = {
      id: 'tenant-orphan-recovery',
      name: 'Owner Recovery',
      plan: 'pro',
      balance: 75,
    };
    const director = vi.fn(async () => ({ reply: 'A restart-safe AI Director revision.' }));
    const context = setup({ identity, director });
    await completeOnboarding(context.service);
    const result = await context.service.askDirector({
      goal: 'Recover a durable strategy after a mirror write failure',
    });
    const expectedRunId = result.snapshot?.runs[0].id;
    const expectedApprovalId = result.snapshot?.approvals[0].id;
    const expectedDigest = result.snapshot?.approvals[0].evidenceDigest;
    const tenantEntry = Array.from(context.db.values.entries())
      .find(([key]) => key.startsWith('customer_marketing:v1:'));
    if (!tenantEntry) throw new Error('Expected a tenant record.');
    const tenantRecord = JSON.parse(tenantEntry[1]);
    tenantRecord.runs = [];
    tenantRecord.approvals = [];
    context.db.values.set(tenantEntry[0], JSON.stringify(tenantRecord));

    const restarted = new CustomerMarketingService(context.db, () => identity);
    const restored = await restarted.getSnapshot();

    expect(restored.runs[0]).toMatchObject({
      id: expectedRunId,
      status: 'awaiting_approval',
      directorReply: expect.stringContaining('restart-safe'),
    });
    expect(restored.approvals[0]).toMatchObject({
      id: expectedApprovalId,
      evidenceDigest: expectedDigest,
      status: 'pending',
    });
    const approved = await restarted.reviewApproval({
      approvalId: expectedApprovalId!,
      decision: 'approved',
    });
    expect(approved.ok).toBe(true);
    expect(approved.snapshot?.runs[0].status).toBe('completed');
  });

  it.each([
    ['no-key', 'Izzi API key'],
    ['network', 'tạm thời'],
  ])('keeps the workflow when the director reports %s', async (directorError, publicMessage) => {
    const director = vi.fn(async () => ({ reply: '', error: directorError }));
    const context = setup({ director });
    await completeOnboarding(context.service);

    const result = await context.service.askDirector({
      goal: 'Build a measurable content plan for seven days',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain(publicMessage);
    expect(result.snapshot?.runs[0].status).toBe('blocked');
    expect(result.snapshot?.runs[0].stage).toBe('director_unavailable');
    expect(result.snapshot?.approvals[0].status).toBe('pending');
    expect(result.snapshot?.workspace.usedCredits).toBe(0);
  });

  it('reserves authoritative workspace credit before invoking the director', async () => {
    const workspace = remoteWorkspace();
    const reserveQuota = vi.fn(async () => {
      workspace.quota = { creditsLimit: 80, creditsUsed: 13.5 };
      return {
        status: 'reserved' as const,
        duplicate: false,
        quota: workspace.quota,
      };
    });
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      reserveQuota,
    };
    const director = vi.fn(async () => ({ reply: 'A quota-backed marketing plan.' }));
    const context = setup({ director, workspaceGateway: gateway });
    await completeOnboarding(context.service);

    const result = await context.service.askDirector({
      goal: 'Create a measurable campaign for next month',
    });

    expect(result.ok).toBe(true);
    expect(reserveQuota).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      metric: 'credits',
      units: 1,
      idempotencyKey: expect.stringMatching(/^director:run-[0-9a-f-]+$/),
      metadata: {
        action: 'ai_director',
        runId: expect.stringMatching(/^run-[0-9a-f-]+$/),
      },
    });
    expect(director).toHaveBeenCalledTimes(1);
    expect(result.snapshot?.workspace.usedCredits).toBe(13.5);
  });

  it.each([
    ['quota_exceeded', 'quota', 'quota_exceeded'],
    ['unavailable', 'xác nhận quota', 'quota_unavailable'],
  ] as const)('blocks director execution when reservation is %s', async (status, message, stage) => {
    const workspace = remoteWorkspace();
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      reserveQuota: vi.fn(async () => ({ status, quota: null })),
    };
    const director = vi.fn(async () => ({ reply: 'must not run' }));
    const context = setup({ director, workspaceGateway: gateway });
    await completeOnboarding(context.service);

    const result = await context.service.askDirector({
      goal: 'Create a measurable campaign for next month',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain(message);
    expect(result.snapshot?.runs[0].stage).toBe(stage);
    expect(result.snapshot?.workspace.usedCredits).toBe(12.5);
    expect(director).not.toHaveBeenCalled();
  });
});

describe('customer capability catalog', () => {
  it('projects a fully declared and host-approved extension capability', () => {
    const extension = customerRuntimeExtension({ state: 'running' });
    const capabilities = buildCustomerCapabilities(
      [extension],
      undefined,
      new Set([extension.id]),
    );

    expect(capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'video-campaign',
        extensionId: 'ext-video-runtime',
        name: 'Video Studio',
        description: 'Creates approved campaign videos.',
        source: 'extension',
        status: 'running',
        minimumPlan: 'pro',
        requiredIntegrations: ['youtube', 'tiktok'],
      }),
    ]));
    expect(capabilities.some((capability) => capability.source === 'core')).toBe(true);
  });

  it('keeps a strategy approval pending when the Product Marketing Context revision changes', async () => {
    const context = setup();
    await completeOnboarding(context.service);
    const created = await context.service.createGoal({
      goal: 'Create a strategy bound to a reviewed product context',
    });
    const approvalId = created.snapshot?.approvals[0].id;
    expect(approvalId).toBeTruthy();

    const currentSnapshot = await context.service.getSnapshot();
    const updated = await context.service.saveProductMarketingContext(
      productMarketingContext(
        1,
        'IzziAPI Updated',
        productMarketingAuthorityToken(currentSnapshot),
      ),
    );
    expect(updated.context?.revision).toBe(2);

    const review = await context.service.reviewApproval({
      approvalId: approvalId!,
      decision: 'approved',
    });

    expect(review).toMatchObject({
      ok: false,
      error: expect.stringContaining('Product Marketing Context'),
    });
    expect((await context.service.getSnapshot()).approvals[0].status).toBe('pending');
  });

  it('keeps the production local extension allowlist empty by default', () => {
    const capabilities = buildCustomerCapabilities([customerRuntimeExtension()]);

    expect(capabilities.some((capability) => capability.source === 'extension')).toBe(false);
    expect(capabilities.some((capability) => capability.source === 'core')).toBe(true);
  });

  it.each([
    ['missing', undefined],
    ['false', false],
    ['string', 'true'],
    ['number', 1],
    ['object', {}],
  ] as Array<[string, unknown]>)('rejects a %s customerMarketing opt-in', (_label, value) => {
    const extension = customerRuntimeExtension({
      manifest: { customerMarketing: value as boolean },
    });
    const capabilities = buildCustomerCapabilities(
      [extension],
      undefined,
      new Set([extension.id]),
    );

    expect(capabilities.some((capability) => capability.source === 'extension')).toBe(false);
  });

  it('rejects private, disabled, malformed, and incomplete extension declarations', () => {
    const malformed = {
      ...customerExtensionDefinition({ id: 'malformed-capability' }),
      extra: 'not-allowed',
    };
    const extensions = [
      customerRuntimeExtension({
        id: 'ext-private',
        manifest: {
          private: true,
          customerMarketingCapability: customerExtensionDefinition({ id: 'private-capability' }),
        },
      }),
      customerRuntimeExtension({
        id: 'ext-malformed-private',
        manifest: {
          private: 'true' as never,
          customerMarketingCapability: customerExtensionDefinition({ id: 'malformed-private-capability' }),
        },
      }),
      customerRuntimeExtension({
        id: 'ext-disabled',
        state: 'disabled',
        manifest: {
          customerMarketingCapability: customerExtensionDefinition({ id: 'disabled-capability' }),
        },
      }),
      customerRuntimeExtension({
        id: 'ext-malformed',
        manifest: { customerMarketingCapability: malformed },
      }),
      customerRuntimeExtension({
        id: 'ext-no-name',
        manifest: {
          displayName: ' ',
          customerMarketingCapability: customerExtensionDefinition({ id: 'unnamed-capability' }),
        },
      }),
    ];
    const capabilities = buildCustomerCapabilities(
      extensions,
      undefined,
      new Set(extensions.map((extension) => extension.id)),
    );

    expect(capabilities.some((capability) => capability.source === 'extension')).toBe(false);
  });

  it('fails closed on core, capability, and runtime extension id collisions', () => {
    const extensions = [
      customerRuntimeExtension({
        id: 'ext-core-collision',
        manifest: {
          customerMarketingCapability: customerExtensionDefinition({ id: 'content-studio' }),
        },
      }),
      customerRuntimeExtension({
        id: 'ext-duplicate-a',
        manifest: {
          customerMarketingCapability: customerExtensionDefinition({ id: 'duplicate-capability' }),
        },
      }),
      customerRuntimeExtension({
        id: 'ext-duplicate-b',
        manifest: {
          customerMarketingCapability: customerExtensionDefinition({ id: 'duplicate-capability' }),
        },
      }),
      customerRuntimeExtension({
        id: 'ext-runtime-duplicate',
        manifest: {
          customerMarketingCapability: customerExtensionDefinition({ id: 'runtime-capability-a' }),
        },
      }),
      customerRuntimeExtension({
        id: 'ext-runtime-duplicate',
        manifest: {
          customerMarketingCapability: customerExtensionDefinition({ id: 'runtime-capability-b' }),
        },
      }),
    ];
    const capabilities = buildCustomerCapabilities(
      extensions,
      undefined,
      new Set(extensions.map((extension) => extension.id)),
    );

    expect(capabilities.filter((capability) => capability.id === 'content-studio')).toHaveLength(1);
    expect(capabilities.find((capability) => capability.id === 'content-studio')?.source).toBe('core');
    expect(capabilities.some((capability) => capability.source === 'extension')).toBe(false);
  });

  it('uses only the server-entitled catalog and preserves an authoritative empty catalog', () => {
    const entitled = customerRuntimeExtension({ state: 'running' });
    const notEntitled = customerRuntimeExtension({
      id: 'ext-not-entitled',
      manifest: {
        customerMarketingCapability: customerExtensionDefinition({ id: 'not-entitled' }),
      },
    });
    const allowlist = new Set([entitled.id, notEntitled.id]);
    const capabilities = buildCustomerCapabilities(
      [entitled, notEntitled],
      [remoteCapability()],
      allowlist,
    );

    expect(capabilities.map((capability) => capability.id)).toEqual(['content-studio']);
    expect(buildCustomerCapabilities([entitled], [], allowlist)).toEqual([]);
  });

  it('overlays authoritative extension status only through extensionId', () => {
    const authoritative = remoteCapability({
      id: 'server-video-capability',
      extensionId: 'ext-video-runtime',
      name: 'Video Runtime',
      source: 'extension',
      category: 'creative',
      status: 'available',
    });
    const capabilities = buildCustomerCapabilities([
      customerRuntimeExtension({ id: 'ext-video-runtime', state: 'installed' }),
      customerRuntimeExtension({
        id: 'server-video-capability',
        state: 'running',
        manifest: {
          customerMarketingCapability: customerExtensionDefinition({ id: 'decoy-capability' }),
        },
      }),
    ], [authoritative]);

    expect(capabilities).toEqual([
      expect.objectContaining({
        id: 'server-video-capability',
        extensionId: 'ext-video-runtime',
        status: 'installed',
      }),
    ]);
  });
});


describe('Customer Marketing Video Studio', () => {
  it('repairs Voice Studio through the bounded main runtime and refreshes both voice statuses', async () => {
    const mediaRuntime = mediaRuntimeFixture();
    const baseToolchain = await mediaRuntime.getToolchain();
    const repairVoiceStudioRuntime = vi.fn(async () => {
      vi.mocked(mediaRuntime.getToolchain).mockResolvedValue({
        ...baseToolchain,
        voiceStudio: { status: 'ready', version: '0.1.0', detail: 'Running.' },
      });
      return 'ready' as const;
    });
    const context = setup({ mediaRuntime, repairVoiceStudioRuntime });
    await completeOnboarding(context.service);

    const result = await context.service.repairVoiceStudio();

    expect(result).toMatchObject({
      ok: true,
      outcome: 'ready',
      snapshot: {
        media: {
          toolchain: {
            voiceStudio: { status: 'ready' },
            commercialRenderAvailable: false,
          },
        },
        externalActionsAllowed: false,
      },
    });
    expect(repairVoiceStudioRuntime).toHaveBeenCalledTimes(1);
  });

  it.each([
    { role: 'viewer' as const, plan: 'pro' as const, outcome: 'forbidden' },
    { role: 'owner' as const, plan: 'starter' as const, outcome: 'plan_required' },
  ])('blocks Voice Studio repair for $role on $plan', async ({ role, plan, outcome }) => {
    const repairVoiceStudioRuntime = vi.fn(async () => 'ready' as const);
    const context = setup({ repairVoiceStudioRuntime });
    await completeOnboarding(context.service);
    context.db.updateOnlyRecord({ role, plan });

    const result = await context.service.repairVoiceStudio();

    expect(result).toMatchObject({ ok: false, outcome });
    expect(repairVoiceStudioRuntime).not.toHaveBeenCalled();
  });

  it('fails closed before Voice Studio start when IzziAPI authority is unavailable', async () => {
    const identity: CustomerIdentity = { id: 'tenant-voice-authority', name: 'Owner', plan: 'pro', balance: 75 };
    const initial = setup({ identity });
    await completeOnboarding(initial.service);
    const remote = marketingResourceGateway('owner', 'unavailable');
    const repairVoiceStudioRuntime = vi.fn(async () => 'ready' as const);
    const service = new CustomerMarketingService(
      initial.db,
      () => identity,
      () => [],
      undefined,
      null,
      remote.gateway,
      undefined,
      null,
      undefined,
      repairVoiceStudioRuntime,
    );

    const result = await service.repairVoiceStudio();

    expect(result).toMatchObject({ ok: false, outcome: 'authority_unavailable' });
    expect(repairVoiceStudioRuntime).not.toHaveBeenCalled();
  });

  it('honors an IzziAPI plan downgrade before Voice Studio start', async () => {
    const identity: CustomerIdentity = { id: 'tenant-voice-plan', name: 'Owner', plan: 'pro', balance: 75 };
    const initial = setup({ identity });
    await completeOnboarding(initial.service);
    const remote = marketingResourceGateway('owner');
    const repairVoiceStudioRuntime = vi.fn(async () => 'ready' as const);
    const service = new CustomerMarketingService(
      initial.db,
      () => identity,
      () => [],
      undefined,
      null,
      remote.gateway,
      undefined,
      null,
      undefined,
      repairVoiceStudioRuntime,
    );

    const result = await service.repairVoiceStudio();

    expect(result).toMatchObject({ ok: false, outcome: 'plan_required' });
    expect(repairVoiceStudioRuntime).not.toHaveBeenCalled();
  });

  it('imports a project into the authenticated tenant without exposing paths or runtime ids', async () => {
    const mediaRuntime = mediaRuntimeFixture();
    const context = setup({ mediaRuntime });
    await completeOnboarding(context.service);

    const sourcePath = 'C:\\private\\izziapi-video-project';
    const result = await context.service.importMediaProject(sourcePath);

    expect(result.ok).toBe(true);
    expect(mediaRuntime.importProject).toHaveBeenCalledWith(
      expect.stringMatching(/^customer-[a-f0-9]{12}$/),
      sourcePath,
    );
    expect(result.snapshot?.media.jobs[0]).toEqual(expect.objectContaining({
      projectId: 'izziapi-demo',
      status: 'awaiting_preview_approval',
      gates: expect.objectContaining({ previewApproved: false, renderApproved: false, publishApproved: false }),
    }));
    expect(result.snapshot?.approvals[0]).toEqual(expect.objectContaining({
      kind: 'media_preview',
      evidenceDigest: 'a'.repeat(64),
      status: 'pending',
    }));
    expect(JSON.stringify(result.snapshot)).not.toContain(sourcePath);
    expect(JSON.stringify(result.snapshot)).not.toContain('11111111-1111-4111-8111-111111111111');

    context.setIdentity({ id: 'tenant-b', name: 'Owner B', plan: 'pro', balance: 10 });
    expect((await context.service.getSnapshot()).media.jobs).toEqual([]);
  });

  it('refreshes the current media chain when the same canonical project is re-imported', async () => {
    const mediaRuntime = mediaRuntimeFixture();
    vi.mocked(mediaRuntime.importProject)
      .mockResolvedValueOnce({
        runtimeProjectId: '11111111-1111-4111-8111-111111111111',
        projectId: 'izziapi-demo',
        title: 'IzziAPI demo v1',
        width: 1080,
        height: 1920,
        fps: 30,
        durationSeconds: 45,
        sceneCount: 7,
        voice: {
          provider: 'f5-tts',
          license: 'CC-BY-NC-SA-4.0',
          commercialUseAllowed: false,
          referenceVoiceConsent: true,
        },
        evidenceDigest: 'a'.repeat(64),
        importedAt: '2026-07-19T10:00:00.000Z',
        artifact: {
          kind: 'project_manifest',
          name: 'video-workflow.json',
          sha256: 'a'.repeat(64),
          sizeBytes: 512,
          createdAt: '2026-07-19T10:00:00.000Z',
        },
      })
      .mockResolvedValueOnce({
        runtimeProjectId: '33333333-3333-4333-8333-333333333333',
        projectId: 'izziapi-demo',
        title: 'IzziAPI demo refreshed',
        width: 1080,
        height: 1920,
        fps: 30,
        durationSeconds: 50,
        sceneCount: 8,
        voice: {
          provider: 'f5-tts',
          license: 'CC-BY-NC-SA-4.0',
          commercialUseAllowed: false,
          referenceVoiceConsent: true,
        },
        evidenceDigest: 'c'.repeat(64),
        importedAt: '2026-07-29T10:00:00.000Z',
        artifact: {
          kind: 'project_manifest',
          name: 'video-workflow.json',
          sha256: 'c'.repeat(64),
          sizeBytes: 640,
          createdAt: '2026-07-29T10:00:00.000Z',
        },
      });
    const context = setup({ mediaRuntime });
    await completeOnboarding(context.service);

    const first = await context.service.importMediaProject('C:\\private\\izziapi-video-project-v1');
    const oldJobId = first.snapshot!.media.jobs[0].id;
    const oldApprovalId = first.snapshot!.approvals[0].id;
    await context.service.reviewApproval({ approvalId: oldApprovalId, decision: 'approved' });
    const previewed = await context.service.runMediaPreview({ jobId: oldJobId });
    expect(previewed.ok).toBe(true);

    const [recordKey, rawRecord] = Array.from(context.db.values.entries())[0];
    const record = JSON.parse(rawRecord);
    const oldArtifactIds = record.mediaArtifacts
      .filter((artifact: { jobId: string }) => artifact.jobId === oldJobId)
      .map((artifact: { id: string }) => artifact.id);
    const unrelatedJobId = 'media-unrelated';
    const unrelatedApprovalId = 'approval-unrelated';
    const unrelatedArtifactId = 'artifact-unrelated';
    record.mediaJobs.push({
      ...record.mediaJobs[0],
      id: unrelatedJobId,
      runtimeProjectId: '22222222-2222-4222-8222-222222222222',
      evidenceDigest: 'd'.repeat(64),
      previewApprovalId: unrelatedApprovalId,
      projectId: 'unrelated-project',
      title: 'Unrelated project',
    });
    record.approvals.push({
      ...record.approvals[0],
      id: unrelatedApprovalId,
      runId: 'media-run-' + unrelatedJobId,
      mediaJobId: unrelatedJobId,
      evidenceDigest: 'd'.repeat(64),
    });
    record.mediaArtifacts.push({
      ...record.mediaArtifacts[0],
      id: unrelatedArtifactId,
      jobId: unrelatedJobId,
      sha256: 'd'.repeat(64),
    });
    context.db.values.set(recordKey, JSON.stringify(record));

    const refreshed = await context.service.importMediaProject('C:\\private\\izziapi-video-project-v2');
    const currentJobs = refreshed.snapshot!.media.jobs.filter((job) => job.projectId === 'izziapi-demo');
    const currentJob = currentJobs[0];
    const currentApproval = refreshed.snapshot!.approvals.find((approval) => approval.mediaJobId === currentJob.id);
    const currentArtifacts = refreshed.snapshot!.media.artifacts.filter((artifact) => artifact.jobId === currentJob.id);

    expect(refreshed.ok).toBe(true);
    expect(currentJobs).toHaveLength(1);
    expect(currentJob).toEqual(expect.objectContaining({
      title: 'IzziAPI demo refreshed',
      status: 'awaiting_preview_approval',
      durationSeconds: 50,
      sceneCount: 8,
      gates: expect.objectContaining({ previewApproved: false, renderApproved: false, publishApproved: false }),
    }));
    expect(currentJob.id).not.toBe(oldJobId);
    expect(currentApproval).toEqual(expect.objectContaining({
      evidenceDigest: 'c'.repeat(64),
      status: 'pending',
    }));
    expect(currentApproval?.id).not.toBe(oldApprovalId);
    expect(currentArtifacts).toEqual([
      expect.objectContaining({
        kind: 'project_manifest',
        sha256: 'c'.repeat(64),
        sizeBytes: 640,
      }),
    ]);
    expect(refreshed.snapshot!.media.jobs.some((job) => job.id === oldJobId)).toBe(false);
    expect(refreshed.snapshot!.approvals.some((approval) => approval.id === oldApprovalId)).toBe(false);
    expect(refreshed.snapshot!.media.artifacts.some((artifact) => oldArtifactIds.includes(artifact.id))).toBe(false);
    expect(refreshed.snapshot!.media.jobs.some((job) => job.id === unrelatedJobId)).toBe(true);
    expect(refreshed.snapshot!.approvals.some((approval) => approval.id === unrelatedApprovalId)).toBe(true);
    expect(refreshed.snapshot!.media.artifacts.some((artifact) => artifact.id === unrelatedArtifactId)).toBe(true);

    const persisted = JSON.parse(context.db.values.get(recordKey)!);
    expect(persisted.mediaJobs.find((job: { id: string }) => job.id === currentJob.id).runtimeProjectId)
      .toBe('33333333-3333-4333-8333-333333333333');
    expect(JSON.stringify(refreshed.snapshot)).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(JSON.stringify(refreshed.snapshot)).not.toContain('33333333-3333-4333-8333-333333333333');
    expect(JSON.stringify(refreshed.snapshot)).not.toContain('C:\\private\\izziapi-video-project-v2');
  });

  it('preserves an unrelated import when a concurrent refresh finishes last', async () => {
    const mediaRuntime = mediaRuntimeFixture();
    const context = setup({ mediaRuntime });
    await completeOnboarding(context.service);
    const first = await context.service.importMediaProject('C:\\private\\izziapi-video-project-v1');
    const oldJobId = first.snapshot!.media.jobs[0].id;

    let finishRefresh!: (value: CustomerMediaImportedProject) => void;
    let finishUnrelated!: (value: CustomerMediaImportedProject) => void;
    const refreshImport = new Promise<CustomerMediaImportedProject>((resolve) => {
      finishRefresh = resolve;
    });
    const unrelatedImport = new Promise<CustomerMediaImportedProject>((resolve) => {
      finishUnrelated = resolve;
    });
    vi.mocked(mediaRuntime.importProject)
      .mockReturnValueOnce(refreshImport)
      .mockReturnValueOnce(unrelatedImport);

    const refreshRequest = context.service.importMediaProject('C:\\private\\izziapi-video-project-v2');
    const unrelatedRequest = context.service.importMediaProject('C:\\private\\unrelated-project');
    await vi.waitFor(() => expect(mediaRuntime.importProject).toHaveBeenCalledTimes(3));

    finishUnrelated({
      runtimeProjectId: '66666666-6666-4666-8666-666666666666',
      projectId: 'unrelated-project',
      title: 'Unrelated project',
      width: 1920,
      height: 1080,
      fps: 24,
      durationSeconds: 30,
      sceneCount: 4,
      voice: {
        provider: 'local-voice',
        license: 'Apache-2.0',
        commercialUseAllowed: false,
        referenceVoiceConsent: false,
      },
      evidenceDigest: '6'.repeat(64),
      importedAt: '2026-07-29T14:00:00.000Z',
      artifact: {
        kind: 'project_manifest',
        name: 'video-workflow.json',
        sha256: '6'.repeat(64),
        sizeBytes: 600,
        createdAt: '2026-07-29T14:00:00.000Z',
      },
    });
    const unrelated = await unrelatedRequest;
    expect(unrelated.ok).toBe(true);

    finishRefresh({
      runtimeProjectId: '77777777-7777-4777-8777-777777777777',
      projectId: 'izziapi-demo',
      title: 'IzziAPI demo refreshed last',
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: 60,
      sceneCount: 8,
      voice: {
        provider: 'f5-tts',
        license: 'CC-BY-NC-SA-4.0',
        commercialUseAllowed: false,
        referenceVoiceConsent: true,
      },
      evidenceDigest: '7'.repeat(64),
      importedAt: '2026-07-29T14:01:00.000Z',
      artifact: {
        kind: 'project_manifest',
        name: 'video-workflow.json',
        sha256: '7'.repeat(64),
        sizeBytes: 700,
        createdAt: '2026-07-29T14:01:00.000Z',
      },
    });
    const refreshed = await refreshRequest;
    expect(refreshed.ok).toBe(true);

    const finalSnapshot = await context.service.getSnapshot();
    expect(finalSnapshot.media.jobs).toHaveLength(2);
    expect(finalSnapshot.media.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        projectId: 'izziapi-demo',
        title: 'IzziAPI demo refreshed last',
        status: 'awaiting_preview_approval',
      }),
      expect.objectContaining({
        projectId: 'unrelated-project',
        title: 'Unrelated project',
        status: 'awaiting_preview_approval',
      }),
    ]));
    expect(finalSnapshot.media.jobs.some((job) => job.id === oldJobId)).toBe(false);
    expect(finalSnapshot.approvals.filter((approval) => approval.kind === 'media_preview')).toHaveLength(2);
    expect(finalSnapshot.media.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ sha256: '6'.repeat(64) }),
      expect.objectContaining({ sha256: '7'.repeat(64) }),
    ]));
  });

  it('replaces a legacy project id when a renamed project declares its lineage', async () => {
    const mediaRuntime = mediaRuntimeFixture();
    vi.mocked(mediaRuntime.importProject).mockResolvedValueOnce({
      runtimeProjectId: '22222222-2222-4222-8222-222222222222',
      projectId: 'izziapi-starizzi-howto',
      title: 'IzziAPI + Starizzi walkthrough',
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: 60,
      sceneCount: 8,
      voice: {
        provider: 'f5-tts-vietnamese-vivoice',
        license: 'CC-BY-NC-SA-4.0',
        commercialUseAllowed: false,
        referenceVoiceConsent: false,
      },
      evidenceDigest: 'd'.repeat(64),
      importedAt: '2026-07-19T12:00:00.000Z',
      artifact: {
        kind: 'project_manifest',
        name: 'video-workflow.json',
        sha256: 'd'.repeat(64),
        sizeBytes: 700,
        createdAt: '2026-07-19T12:00:00.000Z',
      },
    });
    const context = setup({ mediaRuntime });
    await completeOnboarding(context.service);
    const first = await context.service.importMediaProject('C:\\private\\izziapi-starizzi-howto');
    const oldJobId = first.snapshot!.media.jobs[0].id;
    const oldApprovalId = first.snapshot!.approvals.find((item) => item.mediaJobId === oldJobId)!.id;

    vi.mocked(mediaRuntime.importProject).mockResolvedValueOnce({
      runtimeProjectId: '44444444-4444-4444-8444-444444444444',
      projectId: 'izziapi-izzi-ai-howto',
      legacyProjectIds: ['izziapi-starizzi-howto'],
      title: 'IzziAPI + Izzi AI walkthrough',
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: 60,
      sceneCount: 8,
      voice: {
        provider: 'f5-tts-vietnamese-vivoice',
        license: 'CC-BY-NC-SA-4.0',
        commercialUseAllowed: false,
        referenceVoiceConsent: false,
      },
      evidenceDigest: 'e'.repeat(64),
      importedAt: '2026-07-29T12:00:00.000Z',
      artifact: {
        kind: 'project_manifest',
        name: 'video-workflow.json',
        sha256: 'e'.repeat(64),
        sizeBytes: 768,
        createdAt: '2026-07-29T12:00:00.000Z',
      },
    });

    const refreshed = await context.service.importMediaProject('C:\\private\\izziapi-izzi-ai-howto');
    const currentJob = refreshed.snapshot!.media.jobs[0];
    const currentApproval = refreshed.snapshot!.approvals.find((item) => item.mediaJobId === currentJob.id);

    expect(refreshed.ok).toBe(true);
    expect(refreshed.reply).toContain('Đã cập nhật project');
    expect(refreshed.snapshot!.media.jobs).toHaveLength(1);
    expect(currentJob).toEqual(expect.objectContaining({
      projectId: 'izziapi-izzi-ai-howto',
      title: 'IzziAPI + Izzi AI walkthrough',
      status: 'awaiting_preview_approval',
    }));
    expect(currentJob.id).not.toBe(oldJobId);
    expect(refreshed.snapshot!.approvals.some((item) => item.id === oldApprovalId)).toBe(false);
    expect(currentApproval).toEqual(expect.objectContaining({
      evidenceDigest: 'e'.repeat(64),
      status: 'pending',
    }));
    expect(refreshed.snapshot!.media.artifacts).toEqual([
      expect.objectContaining({
        jobId: currentJob.id,
        sha256: 'e'.repeat(64),
      }),
    ]);
  });

  it('does not let an in-flight preview restore a project after re-import', async () => {
    const mediaRuntime = mediaRuntimeFixture();
    let finishPreview!: (
      value: Awaited<ReturnType<CustomerVideoStudioRuntime['runPreview']>>,
    ) => void;
    const deferredPreview = new Promise<
      Awaited<ReturnType<CustomerVideoStudioRuntime['runPreview']>>
    >((resolve) => {
      finishPreview = resolve;
    });
    vi.mocked(mediaRuntime.runPreview).mockReturnValueOnce(deferredPreview);
    const context = setup({ mediaRuntime });
    await completeOnboarding(context.service);
    const first = await context.service.importMediaProject('C:\\private\\izziapi-video-project-v1');
    const oldJobId = first.snapshot!.media.jobs[0].id;
    const approvalId = first.snapshot!.approvals.find((item) => item.mediaJobId === oldJobId)!.id;
    await context.service.reviewApproval({ approvalId, decision: 'approved' });

    const stalePreviewPromise = context.service.runMediaPreview({ jobId: oldJobId });
    await vi.waitFor(() => expect(mediaRuntime.runPreview).toHaveBeenCalledTimes(1));
    vi.mocked(mediaRuntime.importProject).mockResolvedValueOnce({
      runtimeProjectId: '55555555-5555-4555-8555-555555555555',
      projectId: 'izziapi-demo',
      title: 'IzziAPI demo current',
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: 60,
      sceneCount: 8,
      voice: {
        provider: 'f5-tts',
        license: 'CC-BY-NC-SA-4.0',
        commercialUseAllowed: false,
        referenceVoiceConsent: true,
      },
      evidenceDigest: 'f'.repeat(64),
      importedAt: '2026-07-29T13:00:00.000Z',
      artifact: {
        kind: 'project_manifest',
        name: 'video-workflow.json',
        sha256: 'f'.repeat(64),
        sizeBytes: 896,
        createdAt: '2026-07-29T13:00:00.000Z',
      },
    });
    const refreshed = await context.service.importMediaProject('C:\\private\\izziapi-video-project-v2');
    const currentJobId = refreshed.snapshot!.media.jobs[0].id;

    finishPreview({
      receipt: {
        checkedAt: '2026-07-29T13:01:00.000Z',
        passed: true,
        summary: 'Stale preview result.',
        snapshotCount: 1,
      },
      artifacts: [{
        kind: 'snapshot',
        name: 'stale-frame.png',
        sha256: '9'.repeat(64),
        sizeBytes: 128,
        createdAt: '2026-07-29T13:01:00.000Z',
      }],
    });
    const stalePreview = await stalePreviewPromise;
    const finalSnapshot = await context.service.getSnapshot();

    expect(stalePreview.ok).toBe(false);
    expect(stalePreview.error).toContain('đã được cập nhật');
    expect(finalSnapshot.media.jobs).toHaveLength(1);
    expect(finalSnapshot.media.jobs[0]).toEqual(expect.objectContaining({
      id: currentJobId,
      title: 'IzziAPI demo current',
      status: 'awaiting_preview_approval',
    }));
    expect(finalSnapshot.media.jobs.some((job) => job.id === oldJobId)).toBe(false);
    expect(finalSnapshot.media.artifacts.some((artifact) => artifact.name === 'stale-frame.png')).toBe(false);
  });

  it.each([
    { role: 'viewer' as const, plan: 'pro' as const, expected: 'không có quyền import' },
    { role: 'owner' as const, plan: 'free' as const, expected: 'Pro trở lên' },
  ])('revalidates backend $role/$plan authority before importing media', async ({ role, plan, expected }) => {
    const identity: CustomerIdentity = {
      id: `tenant-media-${role}-${plan}`,
      name: 'Media Operator',
      plan: 'pro',
      balance: 75,
    };
    const mediaRuntime = mediaRuntimeFixture();
    const initial = setup({ identity });
    await completeOnboarding(initial.service);
    const workspace = remoteWorkspace({ role, plan });
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      reserveQuota: vi.fn(async () => ({ status: 'forbidden', quota: null })),
    };
    const revoked = new CustomerMarketingService(
      initial.db,
      () => identity,
      () => [],
      undefined,
      mediaRuntime,
      gateway,
    );

    const result = await revoked.importMediaProject('C:\\trusted\\revoked-media-project');

    expect(result.ok).toBe(false);
    expect(result.error).toContain(expected);
    expect(gateway.ensureWorkspace).toHaveBeenCalledTimes(1);
    expect(mediaRuntime.importProject).not.toHaveBeenCalled();
    expect((await initial.service.getSnapshot()).media.jobs).toHaveLength(0);
  });

  it.each(['pro', 'max', 'ultra'] as const)(
    'allows an authoritative %s workspace to import media',
    async (plan) => {
      const identity: CustomerIdentity = {
        id: `tenant-media-${plan}`,
        name: 'Media Operator',
        plan: 'free',
        balance: 75,
      };
      const mediaRuntime = mediaRuntimeFixture();
      const initial = setup({ identity });
      await completeOnboarding(initial.service);
      const workspace = remoteWorkspace({ role: 'owner', plan });
      const gateway: CustomerMarketingWorkspaceGateway = {
        ...memberGatewayMethods(),
        getCurrent: vi.fn(async () => ({ status: 'synced', workspace })),
        ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
        reserveQuota: vi.fn(async () => ({ status: 'local', quota: null })),
      };
      const authorized = new CustomerMarketingService(
        initial.db,
        () => identity,
        () => [],
        undefined,
        mediaRuntime,
        gateway,
      );

      const result = await authorized.importMediaProject(`C:\\trusted\\${plan}-media-project`);

      expect(result.ok).toBe(true);
      expect(gateway.ensureWorkspace).toHaveBeenCalledTimes(1);
      expect(mediaRuntime.importProject).toHaveBeenCalledWith(
        workspace.id,
        `C:\\trusted\\${plan}-media-project`,
      );
      expect(result.snapshot?.workspace.plan).toBe(plan);
      expect(result.snapshot?.capabilityCatalog.status).toBe('synced');
    },
  );

  it('fails closed before importing media when workspace authority is unavailable', async () => {
    const identity: CustomerIdentity = {
      id: 'tenant-media-unavailable',
      name: 'Media Operator',
      plan: 'pro',
      balance: 75,
    };
    const mediaRuntime = mediaRuntimeFixture();
    const initial = setup({ identity });
    await completeOnboarding(initial.service);
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'unavailable', workspace: null })),
      ensureWorkspace: vi.fn(async () => ({ status: 'unavailable', workspace: null })),
      reserveQuota: vi.fn(async () => ({ status: 'unavailable', quota: null })),
    };
    const unavailable = new CustomerMarketingService(
      initial.db,
      () => identity,
      () => [],
      undefined,
      mediaRuntime,
      gateway,
    );

    const result = await unavailable.importMediaProject('C:\\trusted\\offline-media-project');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Không thể xác nhận quyền workspace');
    expect(mediaRuntime.importProject).not.toHaveBeenCalled();
    expect((await initial.service.getSnapshot()).media.jobs).toHaveLength(0);
  });

  it('requires a digest-bound approval before running HyperFrames preview', async () => {
    const mediaRuntime = mediaRuntimeFixture();
    const context = setup({ mediaRuntime });
    await completeOnboarding(context.service);
    const imported = await context.service.importMediaProject('C:\\trusted\\izziapi-video-project');
    const approvalId = imported.snapshot?.approvals[0].id;
    const jobId = imported.snapshot?.media.jobs[0].id;

    const blocked = await context.service.runMediaPreview({ jobId: jobId! });
    expect(blocked.ok).toBe(false);
    expect(mediaRuntime.runPreview).not.toHaveBeenCalled();

    const approved = await context.service.reviewApproval({ approvalId: approvalId!, decision: 'approved' });
    expect(approved.ok).toBe(true);
    const preview = await context.service.runMediaPreview({ jobId: jobId! });

    expect(preview.ok).toBe(true);
    expect(mediaRuntime.runPreview).toHaveBeenCalledWith(
      expect.stringMatching(/^customer-[a-f0-9]{12}$/),
      '11111111-1111-4111-8111-111111111111',
      'a'.repeat(64),
    );
    expect(preview.snapshot?.media.jobs[0]).toEqual(expect.objectContaining({
      status: 'preview_ready',
      preview: expect.objectContaining({ passed: true, snapshotCount: 1 }),
    }));
    expect(preview.snapshot?.media.jobs[0].gates.renderApproved).toBe(false);
    expect(preview.snapshot?.media.toolchain.commercialRenderAvailable).toBe(false);
    expect(preview.snapshot?.externalActionsAllowed).toBe(false);
  });

  it('invalidates preview execution when project evidence changes after approval', async () => {
    const mediaRuntime = mediaRuntimeFixture();
    const context = setup({ mediaRuntime });
    await completeOnboarding(context.service);
    const imported = await context.service.importMediaProject('C:\\trusted\\izziapi-video-project');
    const approvalId = imported.snapshot?.approvals[0].id;
    const jobId = imported.snapshot?.media.jobs[0].id;
    await context.service.reviewApproval({ approvalId: approvalId!, decision: 'approved' });

    const [key, raw] = Array.from(context.db.values.entries())[0];
    const record = JSON.parse(raw);
    record.mediaJobs[0].evidenceDigest = 'c'.repeat(64);
    context.db.values.set(key, JSON.stringify(record));

    const result = await context.service.runMediaPreview({ jobId: jobId! });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('digest');
    expect(mediaRuntime.runPreview).not.toHaveBeenCalled();
  });

  it('revalidates a backend role downgrade before running an approved preview', async () => {
    const identity: CustomerIdentity = {
      id: 'tenant-preview-revoked',
      name: 'Owner Preview',
      plan: 'pro',
      balance: 75,
    };
    const mediaRuntime = mediaRuntimeFixture();
    const context = setup({ identity, mediaRuntime });
    await completeOnboarding(context.service);
    const imported = await context.service.importMediaProject('C:\\trusted\\izziapi-video-project');
    await context.service.reviewApproval({
      approvalId: imported.snapshot!.approvals[0].id,
      decision: 'approved',
    });
    const workspace = remoteWorkspace({ role: 'viewer' });
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      reserveQuota: vi.fn(async () => ({ status: 'forbidden', quota: null })),
    };
    const revoked = new CustomerMarketingService(
      context.db,
      () => identity,
      () => [],
      undefined,
      mediaRuntime,
      gateway,
    );

    const result = await revoked.runMediaPreview({ jobId: imported.snapshot!.media.jobs[0].id });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('không có quyền chạy local preview');
    expect(gateway.getCurrent).toHaveBeenCalledTimes(1);
    expect(gateway.ensureWorkspace).not.toHaveBeenCalled();
    expect(mediaRuntime.runPreview).not.toHaveBeenCalled();
  });
});

describe('CustomerMarketingService backend workspace sync', () => {
  it('uses backend workspace identity, membership, plan, and quota when available', async () => {
    const workspace = remoteWorkspace();
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      reserveQuota: vi.fn(async () => ({ status: 'local', quota: null })),
    };
    const context = setup({ workspaceGateway: gateway });

    const snapshot = await context.service.getSnapshot();

    expect(snapshot.workspace).toMatchObject({
      id: workspace.id,
      name: workspace.name,
      role: 'manager',
      plan: 'pro',
      monthlyQuota: 80,
      usedCredits: 12.5,
      syncStatus: 'synced',
    });
    expect(snapshot.capabilityCatalog).toEqual({ status: 'synced', revision: 1 });
    expect(snapshot.capabilities.length).toBeGreaterThan(0);
    expect(snapshot.productMarketingContextAuthority).toMatchObject({
      reviewerName: 'Owner A',
      canSave: true,
      status: 'confirmed',
      authorityToken: expect.stringMatching(/^v1\.[a-f0-9]{64}$/),
    });
    expect(gateway.getCapabilities).toHaveBeenCalledWith(workspace.id);
    expect(gateway.getCurrent).toHaveBeenCalledTimes(1);
    expect(gateway.ensureWorkspace).not.toHaveBeenCalled();
  });

  it('keeps the tenant-scoped local record when the backend is unavailable', async () => {
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'unavailable', workspace: null })),
      ensureWorkspace: vi.fn(async () => ({ status: 'unavailable', workspace: null })),
      reserveQuota: vi.fn(async () => ({ status: 'unavailable', quota: null })),
    };
    const context = setup({ workspaceGateway: gateway });

    const snapshot = await context.service.getSnapshot();

    expect(snapshot.workspace.id).toMatch(/^customer-/);
    expect(snapshot.workspace.syncStatus).toBe('unavailable');
    expect(snapshot.workspace.role).toBe('owner');
    expect(snapshot.productMarketingContextAuthority).toEqual({
      reviewerName: 'Owner A',
      canSave: false,
      status: 'unavailable',
      scopeToken: expect.stringMatching(/^v1\.[a-f0-9]{64}$/),
      authorityToken: null,
    });
  });

  it('fails closed when a cached local owner loses backend authority confirmation', async () => {
    const identity: CustomerIdentity = {
      id: 'tenant-authority-offline',
      name: 'Nguyễn Nghĩa',
      plan: 'pro',
      balance: 75,
    };
    const local = setup({ identity });
    const onboardingResult = await local.service.saveOnboarding(onboarding());
    const staleLocalAuthority = productMarketingAuthorityToken(onboardingResult.snapshot);
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'unavailable', workspace: null })),
      ensureWorkspace: vi.fn(async () => ({ status: 'unavailable', workspace: null })),
      reserveQuota: vi.fn(async () => ({ status: 'unavailable', quota: null })),
    };
    const connected = new CustomerMarketingService(
      local.db,
      () => identity,
      () => [],
      undefined,
      null,
      gateway,
    );

    const snapshot = await connected.getSnapshot();
    const save = await connected.saveProductMarketingContext(productMarketingContext(
      0,
      'IzziAPI',
      staleLocalAuthority,
    ));

    expect(snapshot.productMarketingContextAuthority).toEqual({
      reviewerName: 'Nguyễn Nghĩa',
      canSave: false,
      status: 'unavailable',
      scopeToken: expect.stringMatching(/^v1\.[a-f0-9]{64}$/),
      authorityToken: null,
    });
    expect(save).toMatchObject({
      ok: false,
      status: 'unavailable',
      context: null,
      snapshot: {
        productMarketingContextAuthority: {
          canSave: false,
          status: 'unavailable',
          authorityToken: null,
        },
      },
    });
    expect(await connected.getProductMarketingContext()).toBeNull();
  });

  it.each<CustomerRole>(['reviewer', 'viewer'])(
    'revalidates a backend %s role before signing Product Marketing Context',
    async (role) => {
      let activeRole: CustomerRole = 'owner';
      const currentWorkspace = () => remoteWorkspace({ role: activeRole });
      const gateway: CustomerMarketingWorkspaceGateway = {
        ...memberGatewayMethods(),
        getCurrent: vi.fn(async () => ({
          status: 'synced',
          workspace: currentWorkspace(),
        })),
        ensureWorkspace: vi.fn(async () => ({
          status: 'synced',
          workspace: currentWorkspace(),
        })),
        reserveQuota: vi.fn(async () => ({ status: 'local', quota: null })),
      };
      const context = setup({ workspaceGateway: gateway });
      const onboardingResult = await context.service.saveOnboarding(onboarding());
      const ownerAuthority = productMarketingAuthorityToken(onboardingResult.snapshot);
      activeRole = role;

      const result = await context.service.saveProductMarketingContext(productMarketingContext(
        0,
        'IzziAPI',
        ownerAuthority,
      ));

      expect(result).toMatchObject({
        ok: false,
        status: 'forbidden',
        context: null,
        snapshot: {
          workspace: { role },
          productMarketingContextAuthority: {
            canSave: false,
            status: 'forbidden',
            authorityToken: null,
          },
        },
      });
      expect(await context.service.getProductMarketingContext()).toBeNull();
    },
  );

  it.each([
    ['unavailable', 'unavailable'],
    ['forbidden', 'forbidden'],
  ] as const)('fails closed when the authoritative capability catalog is %s', async (status, expected) => {
    const workspace = remoteWorkspace();
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      getCapabilities: vi.fn(async () => ({ status, revision: null, capabilities: [] })),
      reserveQuota: vi.fn(async () => ({ status: 'local', quota: null })),
    };
    const context = setup({ workspaceGateway: gateway, mediaRuntime: mediaRuntimeFixture() });

    const snapshot = await context.service.getSnapshot();

    expect(snapshot.capabilityCatalog).toEqual({ status: expected });
    expect(snapshot.capabilities).toEqual([]);
  });

  it('does not add Video Studio when the server did not entitle it', async () => {
    const workspace = remoteWorkspace();
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      getCapabilities: vi.fn(async () => ({
        status: 'synced',
        revision: 2,
        capabilities: [remoteCapability()],
      })),
      reserveQuota: vi.fn(async () => ({ status: 'local', quota: null })),
    };
    const context = setup({ workspaceGateway: gateway, mediaRuntime: mediaRuntimeFixture() });

    const snapshot = await context.service.getSnapshot();

    expect(snapshot.capabilityCatalog).toEqual({ status: 'synced', revision: 2 });
    expect(snapshot.capabilities.map((capability) => capability.id)).toEqual(['content-studio']);
  });

  it('creates the backend workspace after onboarding and maps the guarded mode name', async () => {
    const workspace = remoteWorkspace({ role: 'owner' });
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace: null })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      reserveQuota: vi.fn(async () => ({ status: 'local', quota: null })),
    };
    const context = setup({ workspaceGateway: gateway });

    const result = await context.service.saveOnboarding({
      ...onboarding('IzziAPI'),
      automationMode: 'guardrailed_autonomous',
    });

    expect(result.ok).toBe(true);
    expect(result.snapshot?.workspace.syncStatus).toBe('synced');
    expect(gateway.ensureWorkspace).toHaveBeenCalledWith({
      preferredWorkspaceId: expect.stringMatching(/^customer-/),
      name: 'IzziAPI Marketing',
      operatingMode: 'guarded_autonomous',
    });
  });


  it('does not persist onboarding before IzziAPI acknowledges the profile PUT', async () => {
    const workspace = remoteWorkspace({ role: 'owner' });
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace: null })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      reserveQuota: vi.fn(async () => ({ status: 'local', quota: null })),
      updateProfile: vi.fn(async () => ({ status: 'unavailable', profile: null })),
    };
    const context = setup({ workspaceGateway: gateway });

    const result = await context.service.saveOnboarding(onboarding('Unacknowledged'));

    expect(result.ok).toBe(false);
    expect(result.snapshot).toBeUndefined();
    expect(context.db.values.size).toBe(0);
  });

  it('refreshes revision on conflict, preserves the draft, and retries only on the next Save', async () => {
    const workspace = remoteWorkspace({ role: 'owner' });
    const getProfile = vi.fn()
      .mockResolvedValueOnce({ status: 'synced' as const, profile: remoteProfile({ revision: 3 }) })
      .mockResolvedValueOnce({ status: 'synced' as const, profile: remoteProfile({
        revision: 4,
        business: { ...remoteProfile().business, name: 'Another editor' },
      }) });
    const updateProfile = vi.fn()
      .mockResolvedValueOnce({ status: 'conflict' as const, profile: null })
      .mockImplementationOnce(async (input) => ({
        status: 'synced' as const,
        profile: {
          ...input.profile,
          workspaceId: input.workspaceId,
          revision: input.expectedRevision + 1,
          updatedAt: '2026-07-22T02:00:00.000Z',
        },
      }));
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace: null })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      reserveQuota: vi.fn(async () => ({ status: 'local', quota: null })),
      getProfile,
      updateProfile,
    };
    const context = setup({ workspaceGateway: gateway });
    const draft = onboarding('My preserved draft');

    const conflicted = await context.service.saveOnboarding(draft);

    expect(conflicted.ok).toBe(false);
    expect(conflicted.snapshot).toBeUndefined();
    expect(updateProfile).toHaveBeenCalledTimes(1);
    expect(updateProfile).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: 3 }));
    const storedAfterConflict = JSON.parse(Array.from(context.db.values.values())[0]);
    expect(storedAfterConflict.onboarding).toBeNull();
    expect(storedAfterConflict.profileRevision).toBe(4);
    expect(storedAfterConflict.profileSyncStatus).toBe('conflict');

    const retried = await context.service.saveOnboarding(draft);

    expect(retried.ok).toBe(true);
    expect(updateProfile).toHaveBeenCalledTimes(2);
    expect(updateProfile).toHaveBeenLastCalledWith(expect.objectContaining({
      expectedRevision: 4,
      profile: expect.objectContaining({ business: expect.objectContaining({ name: 'My preserved draft' }) }),
    }));
    expect(retried.snapshot?.onboarding?.business.name).toBe('My preserved draft');
    expect(retried.snapshot?.workspace.profileSyncStatus).toBe('synced');
  });

  it('recovers a lost success response when the latest server profile equals the draft', async () => {
    const workspace = remoteWorkspace({ role: 'owner' });
    const draft = onboarding('Already committed');
    const committedProfile: RemoteMarketingProfile = {
      ...draft,
      workspaceId: workspace.id,
      completed: true,
      revision: 4,
      updatedAt: '2026-07-22T02:00:00.000Z',
    };
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace: null })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      reserveQuota: vi.fn(async () => ({ status: 'local', quota: null })),
      getProfile: vi.fn()
        .mockResolvedValueOnce({ status: 'synced', profile: remoteProfile({ revision: 3 }) })
        .mockResolvedValueOnce({ status: 'synced', profile: committedProfile }),
      updateProfile: vi.fn(async () => ({ status: 'unavailable', profile: null })),
    };
    const context = setup({ workspaceGateway: gateway });

    const result = await context.service.saveOnboarding(draft);

    expect(result.ok).toBe(true);
    expect(result.reply).toContain('ghi nhận trước đó');
    expect(result.snapshot?.onboarding?.business.name).toBe('Already committed');
    expect(result.snapshot?.workspace.profileSyncStatus).toBe('synced');
    expect(gateway.updateProfile).toHaveBeenCalledTimes(1);
    expect(gateway.getProfile).toHaveBeenCalledTimes(2);
  });

  it('refreshes the local cache from the authoritative profile GET', async () => {
    const workspace = remoteWorkspace({ role: 'manager' });
    const authoritative = remoteProfile({
      business: { ...remoteProfile().business, name: 'Server profile' },
      revision: 8,
    });
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      reserveQuota: vi.fn(async () => ({ status: 'local', quota: null })),
      getProfile: vi.fn(async () => ({ status: 'synced', profile: authoritative })),
    };
    const context = setup({ workspaceGateway: gateway });

    const snapshot = await context.service.getSnapshot();

    expect(snapshot.onboarding?.business.name).toBe('Server profile');
    expect(snapshot.workspace.profileSyncStatus).toBe('synced');
    const stored = JSON.parse(Array.from(context.db.values.values())[0]);
    expect(stored.profileRevision).toBe(8);
    expect(stored.onboarding.business.name).toBe('Server profile');
  });
  it.each<CustomerRole>(['reviewer', 'viewer'])('uses the backend %s role before creating a workflow', async (role) => {
    let activeRole: CustomerRole = 'owner';
    const currentWorkspace = () => remoteWorkspace({ role: activeRole });
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({
        status: 'synced',
        workspace: currentWorkspace(),
      })),
      ensureWorkspace: vi.fn(async () => ({
        status: 'synced',
        workspace: currentWorkspace(),
      })),
      reserveQuota: vi.fn(async () => ({ status: 'forbidden', quota: null })),
    };
    const context = setup({ workspaceGateway: gateway });
    await completeOnboarding(context.service);
    activeRole = role;

    const result = await context.service.askDirector({ goal: 'Create a new marketing workflow' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('không có quyền tạo workflow');
    expect((await context.service.getSnapshot()).runs).toHaveLength(0);
  });

  it('revalidates a backend role downgrade before reviewing an approval', async () => {
    const identity: CustomerIdentity = {
      id: 'tenant-approval-revoked',
      name: 'Owner Approval',
      plan: 'pro',
      balance: 75,
    };
    const context = setup({ identity });
    await completeOnboarding(context.service);
    const created = await context.service.createGoal({
      goal: 'Prepare a strategy that still requires current reviewer authority',
    });
    const workspace = remoteWorkspace({ role: 'viewer' });
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      reserveQuota: vi.fn(async () => ({ status: 'forbidden', quota: null })),
    };
    const revoked = new CustomerMarketingService(
      context.db,
      () => identity,
      () => [],
      undefined,
      null,
      gateway,
    );

    const result = await revoked.reviewApproval({
      approvalId: created.snapshot!.approvals[0].id,
      decision: 'approved',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('không có quyền duyệt');
    expect(gateway.getCurrent).toHaveBeenCalledTimes(1);
    expect(gateway.ensureWorkspace).not.toHaveBeenCalled();
    expect((await context.service.getSnapshot()).approvals[0].status).toBe('pending');
  });

  it('fails closed when workspace permission cannot be synchronized', async () => {
    const identity: CustomerIdentity = {
      id: 'tenant-workspace-unavailable',
      name: 'Owner Workspace',
      plan: 'pro',
      balance: 75,
    };
    const local = setup({ identity });
    await completeOnboarding(local.service);
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'unavailable', workspace: null })),
      ensureWorkspace: vi.fn(async () => ({ status: 'unavailable', workspace: null })),
      reserveQuota: vi.fn(async () => ({ status: 'unavailable', quota: null })),
    };
    const service = new CustomerMarketingService(
      local.db,
      () => identity,
      () => [],
      undefined,
      null,
      gateway,
    );

    const result = await service.askDirector({ goal: 'Create a new marketing workflow' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('xác nhận quyền workspace');
    expect((await local.service.getSnapshot()).runs).toHaveLength(0);
  });

  it('keeps a persisted workspace binding when the gateway returns another tenant', async () => {
    const identity: CustomerIdentity = {
      id: 'tenant-a',
      name: 'Owner A',
      plan: 'pro',
      balance: 75,
    };
    const originalWorkspaceId = '11111111-1111-4111-8111-111111111111';
    const otherWorkspace = remoteWorkspace({
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Other Marketing Workspace',
      role: 'owner',
    });
    const local = setup({ identity });
    await completeOnboarding(local.service, 'Workspace A');
    local.db.updateOnlyRecord({
      workspaceId: originalWorkspaceId,
      role: 'owner',
      plan: 'pro',
    });
    const listMembers = vi.fn(async () => ({ status: 'synced' as const, members: [] }));
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace: otherWorkspace })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace: otherWorkspace })),
      reserveQuota: vi.fn(async () => ({ status: 'local', quota: null })),
      listMembers,
      updateMemberRole: vi.fn(async () => ({ status: 'local', member: null })),
    };
    const service = new CustomerMarketingService(
      local.db,
      () => identity,
      () => [],
      async () => ({ reply: '', error: 'not-configured' }),
      null,
      gateway,
    );

    const snapshot = await service.getSnapshot();
    expect(snapshot.workspace).toMatchObject({
      id: originalWorkspaceId,
      syncStatus: 'unavailable',
    });
    expect(snapshot.onboarding?.business.name).toBe('Workspace A');
    const members = await service.listWorkspaceMembers();
    expect(members.ok).toBe(false);
    expect(members.error).toContain('Không thể xác nhận');
    expect(listMembers).not.toHaveBeenCalled();
  });
});

describe('CustomerMarketingService workspace members', () => {
  const OWNER_ID = '11111111-1111-4111-8111-111111111111';
  const MANAGER_ID = '33333333-3333-4333-8333-333333333333';

  it('derives the workspace in main and keeps owner and self rows immutable', async () => {
    const workspace = remoteWorkspace({ role: 'owner' });
    const owner = remoteMember({ userId: OWNER_ID, email: 'owner@example.com', role: 'owner' });
    const editor = remoteMember();
    const listMembers = vi.fn(async () => ({ status: 'synced' as const, members: [owner, editor] }));
    const updateMemberRole = vi.fn(async () => ({
      status: 'synced' as const,
      member: { ...editor, role: 'reviewer' as const, updatedAt: '2026-07-22T00:00:00.000Z' },
    }));
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      reserveQuota: vi.fn(async () => ({ status: 'local', quota: null })),
      listMembers,
      updateMemberRole,
    };
    const context = setup({
      identity: { id: OWNER_ID, name: 'Owner', plan: 'pro' },
      workspaceGateway: gateway,
    });

    const listed = await context.service.listWorkspaceMembers();
    expect(listed).toEqual({
      ok: true,
      members: [
        expect.objectContaining({ userId: OWNER_ID, isCurrentUser: true, editableRoles: [] }),
        expect.objectContaining({
          userId: editor.userId,
          isCurrentUser: false,
          editableRoles: ['manager', 'editor', 'reviewer', 'viewer'],
        }),
      ],
    });
    expect(listMembers).toHaveBeenCalledWith(workspace.id);

    const updated = await context.service.updateWorkspaceMemberRole({
      memberUserId: editor.userId,
      role: 'reviewer',
    });
    expect(updated.ok).toBe(true);
    expect(updated.members.find((item) => item.userId === editor.userId)?.role).toBe('reviewer');
    expect(updateMemberRole).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      memberUserId: editor.userId,
      role: 'reviewer',
    });

    const selfUpdate = await context.service.updateWorkspaceMemberRole({
      memberUserId: OWNER_ID,
      role: 'manager',
    });
    expect(selfUpdate.ok).toBe(false);
    expect(selfUpdate.error).toContain('không được phép');
    expect(updateMemberRole).toHaveBeenCalledTimes(1);
  });

  it('lets managers edit only editor, reviewer, and viewer roles', async () => {
    const workspace = remoteWorkspace({ role: 'manager' });
    const manager = remoteMember({ userId: MANAGER_ID, email: 'manager@example.com', role: 'manager' });
    const otherManager = remoteMember({
      userId: '44444444-4444-4444-8444-444444444444',
      email: 'other-manager@example.com',
      role: 'manager',
    });
    const editor = remoteMember();
    const updateMemberRole = vi.fn();
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      reserveQuota: vi.fn(async () => ({ status: 'local', quota: null })),
      listMembers: vi.fn(async () => ({ status: 'synced', members: [manager, otherManager, editor] })),
      updateMemberRole,
    };
    const context = setup({
      identity: { id: MANAGER_ID, name: 'Manager', plan: 'pro' },
      workspaceGateway: gateway,
    });

    const listed = await context.service.listWorkspaceMembers();
    expect(listed.members.find((item) => item.userId === otherManager.userId)?.editableRoles).toEqual([]);
    expect(listed.members.find((item) => item.userId === editor.userId)?.editableRoles).toEqual([
      'editor', 'reviewer', 'viewer',
    ]);
    const promotion = await context.service.updateWorkspaceMemberRole({
      memberUserId: editor.userId,
      role: 'manager',
    });
    expect(promotion.ok).toBe(false);
    expect(updateMemberRole).not.toHaveBeenCalled();
  });

  it('fails closed without synchronized member data', async () => {
    const workspace = remoteWorkspace({ role: 'owner' });
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      reserveQuota: vi.fn(async () => ({ status: 'local', quota: null })),
      listMembers: vi.fn(async () => ({ status: 'unavailable', members: [] })),
    };
    const context = setup({ identity: { id: OWNER_ID }, workspaceGateway: gateway });

    const result = await context.service.listWorkspaceMembers();
    expect(result.ok).toBe(false);
    expect(result.members).toEqual([]);
    expect(result.error).toContain('Không thể xác nhận');
  });
});

describe('CustomerMarketingService workspace invitations', () => {
  const OWNER_ID = '11111111-1111-4111-8111-111111111111';
  const INVITATION_TOKEN = 'InviteToken_0123456789-abcdef';
  const expiresAt = '2026-07-29T00:00:00.000Z';

  function invitationGateway(role: CustomerRole = 'owner') {
    const workspace = remoteWorkspace({ role });
    const createInvitation = vi.fn(async () => ({
      status: 'created' as const,
      invitation: {
        id: '33333333-3333-4333-8333-333333333333',
        email: 'new@example.com',
        role: 'viewer' as const,
        expiresAt,
        createdAt: '2026-07-22T00:00:00.000Z',
      },
      inviteToken: INVITATION_TOKEN,
    }));
    const acceptInvitation = vi.fn(async () => ({
      status: 'accepted' as const,
      workspaceId: workspace.id,
      role: 'viewer' as const,
    }));
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn(async () => ({ status: 'synced', workspace })),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace })),
      reserveQuota: vi.fn(async () => ({ status: 'local', quota: null })),
      createInvitation,
      acceptInvitation,
    };
    return { gateway, workspace, createInvitation, acceptInvitation };
  }

  it('lets only an authoritative owner create a token-free invitation result', async () => {
    const { gateway, workspace, createInvitation } = invitationGateway('owner');
    const writeClipboardText = vi.fn();
    const context = setup({
      identity: { id: OWNER_ID, name: 'Owner' },
      workspaceGateway: gateway,
      writeClipboardText,
    });

    const result = await context.service.createWorkspaceInvitation({
      email: ' New@Example.com ',
      role: 'viewer',
    });

    expect(result).toEqual({
      ok: true,
      email: 'new@example.com',
      role: 'viewer',
      expiresAt,
      copied: true,
    });
    expect(createInvitation).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      email: 'new@example.com',
      role: 'viewer',
    });
    expect(writeClipboardText).toHaveBeenCalledWith(
      `openclaw://customer-marketing/invitations/accept?token=${INVITATION_TOKEN}`,
    );
    expect(JSON.stringify(result)).not.toContain(INVITATION_TOKEN);
    expect(Array.from(context.db.values.values()).join('\n')).not.toContain(INVITATION_TOKEN);
  });

  it('retries clipboard from memory without creating a second invitation', async () => {
    const { gateway, createInvitation } = invitationGateway('owner');
    const writeClipboardText = vi.fn()
      .mockRejectedValueOnce(new Error('clipboard unavailable'))
      .mockResolvedValue(undefined);
    const context = setup({
      identity: { id: OWNER_ID },
      workspaceGateway: gateway,
      writeClipboardText,
    });

    const created = await context.service.createWorkspaceInvitation({
      email: 'new@example.com',
      role: 'viewer',
    });
    expect(created).toMatchObject({ ok: true, copied: false, email: 'new@example.com' });
    expect(created.error).toContain('clipboard');

    const retried = await context.service.retryWorkspaceInvitationCopy();
    expect(retried).toEqual({
      ok: true,
      email: 'new@example.com',
      role: 'viewer',
      expiresAt,
      copied: true,
    });
    expect(createInvitation).toHaveBeenCalledTimes(1);
    expect(writeClipboardText).toHaveBeenCalledTimes(2);
  });

  it('drops a pending clipboard token when the authenticated identity changes', async () => {
    const { gateway } = invitationGateway('owner');
    const writeClipboardText = vi.fn().mockRejectedValue(new Error('clipboard unavailable'));
    const context = setup({
      identity: { id: OWNER_ID },
      workspaceGateway: gateway,
      writeClipboardText,
    });
    await context.service.createWorkspaceInvitation({
      email: 'new@example.com',
      role: 'viewer',
    });

    context.setIdentity({ id: '99999999-9999-4999-8999-999999999999' });
    const result = await context.service.retryWorkspaceInvitationCopy();

    expect(result).toMatchObject({ ok: false, copied: false });
    expect(result.error).toContain('phiên đăng nhập');
    expect(writeClipboardText).toHaveBeenCalledTimes(1);
    context.setIdentity({ id: OWNER_ID });
    await expect(context.service.retryWorkspaceInvitationCopy()).resolves.toMatchObject({
      ok: false,
      copied: false,
    });
  });

  it('revalidates authoritative owner access before copying a pending token', async () => {
    const ownerWorkspace = remoteWorkspace({ role: 'owner' });
    const managerWorkspace = remoteWorkspace({ role: 'manager' });
    const createInvitation = vi.fn(async () => ({
      status: 'created' as const,
      invitation: {
        id: '33333333-3333-4333-8333-333333333333',
        email: 'new@example.com',
        role: 'viewer' as const,
        expiresAt,
        createdAt: '2026-07-22T00:00:00.000Z',
      },
      inviteToken: INVITATION_TOKEN,
    }));
    const gateway: CustomerMarketingWorkspaceGateway = {
      ...memberGatewayMethods(),
      getCurrent: vi.fn()
        .mockResolvedValueOnce({ status: 'synced', workspace: ownerWorkspace })
        .mockResolvedValue({ status: 'synced', workspace: managerWorkspace }),
      ensureWorkspace: vi.fn(async () => ({ status: 'synced', workspace: managerWorkspace })),
      reserveQuota: vi.fn(async () => ({ status: 'local', quota: null })),
      createInvitation,
    };
    const writeClipboardText = vi.fn().mockRejectedValue(new Error('clipboard unavailable'));
    const context = setup({
      identity: { id: OWNER_ID },
      workspaceGateway: gateway,
      writeClipboardText,
    });
    await context.service.createWorkspaceInvitation({
      email: 'new@example.com',
      role: 'viewer',
    });

    const result = await context.service.retryWorkspaceInvitationCopy();

    expect(result).toMatchObject({ ok: false, copied: false });
    expect(result.error).toContain('Chủ sở hữu');
    expect(writeClipboardText).toHaveBeenCalledTimes(1);
    expect(createInvitation).toHaveBeenCalledTimes(1);
  });

  it('can explicitly clear a pending clipboard token on logout', async () => {
    const { gateway } = invitationGateway('owner');
    const writeClipboardText = vi.fn().mockRejectedValue(new Error('clipboard unavailable'));
    const context = setup({
      identity: { id: OWNER_ID },
      workspaceGateway: gateway,
      writeClipboardText,
    });
    await context.service.createWorkspaceInvitation({
      email: 'new@example.com',
      role: 'viewer',
    });

    context.service.clearPendingWorkspaceInvitationCopy();

    await expect(context.service.retryWorkspaceInvitationCopy()).resolves.toEqual({
      ok: false,
      copied: false,
      error: 'Không có liên kết lời mời nào đang chờ sao chép.',
    });
    expect(writeClipboardText).toHaveBeenCalledTimes(1);
  });

  it('rejects manager invitations in main even if a renderer reaches the method', async () => {
    const { gateway, createInvitation } = invitationGateway('manager');
    const writeClipboardText = vi.fn();
    const context = setup({
      identity: { id: OWNER_ID },
      workspaceGateway: gateway,
      writeClipboardText,
    });

    const result = await context.service.createWorkspaceInvitation({
      email: 'new@example.com',
      role: 'viewer',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Chủ sở hữu');
    expect(createInvitation).not.toHaveBeenCalled();
    expect(writeClipboardText).not.toHaveBeenCalled();
  });

  it('accepts a token only in main memory and binds the authoritative workspace', async () => {
    const { gateway, workspace, acceptInvitation } = invitationGateway('viewer');
    const context = setup({
      identity: { id: OWNER_ID },
      workspaceGateway: gateway,
    });

    const result = await context.service.acceptWorkspaceInvitation(INVITATION_TOKEN);

    expect(result).toEqual({ ok: true, workspaceId: workspace.id, role: 'viewer' });
    expect(acceptInvitation).toHaveBeenCalledWith(INVITATION_TOKEN);
    expect(JSON.stringify(result)).not.toContain(INVITATION_TOKEN);
    expect(Array.from(context.db.values.values()).join('\n')).not.toContain(INVITATION_TOKEN);
  });

  it('does not carry local tenant data into a different invited workspace', async () => {
    const identity = { id: OWNER_ID, name: 'Owner' };
    const original = setup({ identity });
    await completeOnboarding(original.service, 'Private workspace A');
    original.db.updateOnlyRecord({
      workspaceId: '99999999-9999-4999-8999-999999999999',
      role: 'owner',
      runs: [{ id: 'private-run', goal: 'Tenant A only' }],
    });

    const { gateway, workspace } = invitationGateway('viewer');
    const service = new CustomerMarketingService(
      original.db,
      () => identity,
      () => [],
      async () => ({ reply: '', error: 'not-configured' }),
      null,
      gateway,
    );

    await expect(service.acceptWorkspaceInvitation(INVITATION_TOKEN)).resolves.toEqual({
      ok: true,
      workspaceId: workspace.id,
      role: 'viewer',
    });
    const stored = JSON.parse(Array.from(original.db.values.values())[0]);
    expect(stored.workspaceId).toBe(workspace.id);
    expect(stored.onboarding).toBeNull();
    expect(stored.runs).toEqual([]);
    expect(JSON.stringify(stored)).not.toContain('Private workspace A');
    expect(JSON.stringify(stored)).not.toContain('Tenant A only');
  });
});

describe('CustomerMarketingService resource bridge', () => {
  it.each(['owner', 'viewer'] as const)('loads analytics with authoritative %s workspace scope', async (role) => {
    const remote = marketingResourceGateway(role);
    const context = setup({ workspaceGateway: remote.gateway });
    const window: CustomerMarketingAnalyticsWindow = {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-31T23:59:59.999Z',
    };

    await expect(context.service.getMarketingAnalytics(window)).resolves.toEqual({
      ok: true,
      status: 'synced',
      report: remote.report,
    });
    expect(remote.getCurrent).toHaveBeenCalledTimes(1);
    expect(remote.getMarketingAnalytics).toHaveBeenCalledWith(remote.workspace.id, window);
  });

  it('rejects an extended analytics payload before resolving workspace authority', async () => {
    const remote = marketingResourceGateway('owner');
    const context = setup({ workspaceGateway: remote.gateway });
    const input = {
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-31T23:59:59.999Z',
      workspaceId: remote.workspace.id,
    } as unknown as CustomerMarketingAnalyticsWindow;

    await expect(context.service.getMarketingAnalytics(input)).resolves.toMatchObject({
      ok: false,
      status: 'unavailable',
      report: null,
    });
    expect(remote.getCurrent).not.toHaveBeenCalled();
    expect(remote.getMarketingAnalytics).not.toHaveBeenCalled();
  });

  it.each([
    ['owner', true, true],
    ['manager', true, true],
    ['editor', true, false],
    ['reviewer', false, true],
    ['viewer', false, false],
  ] as const)('applies the authoritative %s role and keeps archive fail-closed', async (
    role,
    canAuthor,
    canReview,
  ) => {
    const remote = marketingResourceGateway(role);
    const context = setup({ workspaceGateway: remote.gateway });
    const updateInput = {
      kind: 'campaign' as const,
      resourceId: remote.resource.id,
      expectedRevision: 0,
      patch: { title: 'Autumn launch v2' },
    };
    const reviewBase = {
      kind: 'campaign' as const,
      resourceId: remote.resource.id,
      expectedRevision: 0,
    };

    const results = [
      await context.service.createMarketingResource(marketingCampaignCreateInput()),
      await context.service.updateMarketingResource(updateInput),
      await context.service.archiveMarketingResource({
        kind: 'campaign',
        resourceId: remote.resource.id,
        expectedRevision: 0,
      }),
      await context.service.reviewMarketingResource({ ...reviewBase, action: 'submit' }),
      await context.service.reviewMarketingResource({ ...reviewBase, action: 'approve' }),
      await context.service.reviewMarketingResource({ ...reviewBase, action: 'reject' }),
    ];

    expect(results.map((result) => result.ok)).toEqual([
      canAuthor, canAuthor, false, canAuthor, canReview, canReview,
    ]);
    expect(results.map((result) => result.status)).toEqual([
      canAuthor ? 'synced' : 'forbidden',
      canAuthor ? 'synced' : 'forbidden',
      'forbidden',
      canAuthor ? 'synced' : 'forbidden',
      canReview ? 'synced' : 'forbidden',
      canReview ? 'synced' : 'forbidden',
    ]);
    expect(remote.getCurrent).toHaveBeenCalledTimes(5);
    expect(remote.archiveMarketingResource).not.toHaveBeenCalled();

    if (canAuthor) {
      expect(remote.createMarketingResource).toHaveBeenCalledWith(expect.objectContaining({
        workspaceId: remote.workspace.id,
        idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        resource: marketingCampaignCreateInput(),
      }));
    } else {
      expect(remote.createMarketingResource).not.toHaveBeenCalled();
    }

    const stored = JSON.parse(Array.from(context.db.values.values())[0]);
    expect(stored).toMatchObject({
      workspaceId: remote.workspace.id,
      role,
      plan: 'starter',
    });
  });

  it('blocks mutation when backend workspace authority is unavailable', async () => {
    const remote = marketingResourceGateway('owner', 'unavailable');
    const context = setup({ workspaceGateway: remote.gateway });

    await expect(context.service.createMarketingResource(marketingCampaignCreateInput())).resolves.toMatchObject({
      ok: false,
      status: 'unavailable',
      resource: null,
    });
    expect(remote.getCurrent).toHaveBeenCalledTimes(1);
    expect(remote.createMarketingResource).not.toHaveBeenCalled();
  });

  it('reuses a main-owned idempotency key for a failed create retry', async () => {
    const remote = marketingResourceGateway('owner');
    remote.createMarketingResource.mockResolvedValueOnce({ status: 'unavailable', resource: null });
    const context = setup({ workspaceGateway: remote.gateway });
    const resource = marketingCampaignCreateInput();

    await expect(context.service.createMarketingResource(resource)).resolves.toMatchObject({
      ok: false,
      status: 'unavailable',
    });
    await expect(context.service.createMarketingResource(resource)).resolves.toMatchObject({
      ok: true,
      status: 'synced',
    });
    await context.service.createMarketingResource({ ...resource, title: 'A distinct campaign' });

    const firstKey = remote.createMarketingResource.mock.calls[0][0].idempotencyKey;
    const retryKey = remote.createMarketingResource.mock.calls[1][0].idempotencyKey;
    const distinctKey = remote.createMarketingResource.mock.calls[2][0].idempotencyKey;
    expect(retryKey).toBe(firstKey);
    expect(distinctKey).not.toBe(firstKey);
    expect(JSON.stringify(resource)).not.toContain(firstKey);
  });

  it('returns an authoritative revision conflict without retrying the update', async () => {
    const remote = marketingResourceGateway('editor');
    remote.updateMarketingResource.mockResolvedValue({ status: 'conflict', resource: null });
    const context = setup({ workspaceGateway: remote.gateway });

    await expect(context.service.updateMarketingResource({
      kind: 'campaign',
      resourceId: remote.resource.id,
      expectedRevision: 7,
      patch: { title: 'Conflicting title' },
    })).resolves.toMatchObject({
      ok: false,
      status: 'conflict',
      resource: null,
    });
    expect(remote.updateMarketingResource).toHaveBeenCalledTimes(1);
  });
});

describe('CustomerMarketingService CMR-306 workflow bridge', () => {
  it('lists only approved renderer-safe source summaries', async () => {
    const remote = marketingWorkflowGateway('viewer');
    remote.listMarketingResources.mockResolvedValue({
      status: 'synced',
      resources: [
        remote.resource,
        marketingContentResource({
          id: '66666666-6666-4666-8666-666666666666',
          workspaceId: remote.workspace.id,
          status: 'draft',
          revision: 0,
        }),
      ],
    });
    const context = setup({ workspaceGateway: remote.gateway });

    const result = await context.service.listMarketingWorkflowSources('social');

    expect(result).toMatchObject({ ok: true, status: 'synced' });
    expect(result.sources).toHaveLength(1);
    expect(Object.keys(result.sources[0])).toEqual([
      'id', 'kind', 'revision', 'sha256', 'title', 'channel',
    ]);
    expect(result.sources[0]).toMatchObject({
      id: remote.resource.id,
      kind: 'content',
      revision: 3,
      channel: 'facebook',
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(result)).not.toContain(remote.workspace.id);
    expect(JSON.stringify(result)).not.toContain('Private approved launch copy');
    expect(remote.getCapabilities).toHaveBeenCalledWith(remote.workspace.id);
    expect(remote.listMarketingResources).toHaveBeenCalledWith(remote.workspace.id, 'content');
  });

  it('prepares, reviews, and exactly replays a receipt with main-owned identity evidence', async () => {
    const remote = marketingWorkflowGateway('manager');
    const context = setup({
      identity: { id: 'authenticated-reviewer', plan: 'pro' },
      workspaceGateway: remote.gateway,
    });
    const prepared = await context.service.prepareMarketingWorkflow({
      target: 'social',
      resourceId: remote.resource.id,
      expectedRevision: remote.resource.revision,
    });

    expect(prepared).toMatchObject({
      ok: true,
      status: 'synced',
      workflow: {
        status: 'pending',
        manifest: {
          kind: 'social',
          inputRef: { id: remote.resource.id, revision: remote.resource.revision },
          grant: { limits: { maxItems: 1, maxRecipients: 0, maxSpendVnd: 0 } },
          dryRun: { externalActionPerformed: false },
        },
      },
    });
    expect(JSON.stringify(prepared)).not.toContain('Private approved launch copy');

    const reviewRequest = {
      target: 'social' as const,
      workflowId: prepared.workflow!.workflowId,
      approvalId: prepared.workflow!.approvalId,
      manifestDigest: prepared.workflow!.manifestDigest,
      decision: 'approved' as const,
      note: 'Approved locally',
    };
    const reviewed = await context.service.reviewMarketingWorkflow(reviewRequest);
    expect(reviewed).toMatchObject({
      ok: true,
      status: 'synced',
      workflow: {
        status: 'approved',
        receipt: {
          decision: 'approved',
          externalActionPerformed: false,
          reviewerHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          receiptDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        },
      },
    });
    expect(reviewed.workflow!.receipt!.reviewerHash).not.toContain('authenticated-reviewer');

    const workflowEntry = Array.from(context.db.values.entries())
      .find(([key]) => key.startsWith('customer_marketing_workflows:v1:'))!;
    const revision = JSON.parse(workflowEntry[1]).revision;
    await expect(context.service.reviewMarketingWorkflow(reviewRequest)).resolves.toEqual(reviewed);
    expect(JSON.parse(context.db.values.get(workflowEntry[0])!).revision).toBe(revision);
    expect(remote.getCapabilities).toHaveBeenCalledTimes(3);
    expect(remote.getMarketingResource).toHaveBeenCalledTimes(3);
  });

  it('lets a reviewer decide an existing workflow without granting author access', async () => {
    const remote = marketingWorkflowGateway('manager');
    const context = setup({ workspaceGateway: remote.gateway });
    const prepared = await context.service.prepareMarketingWorkflow({
      target: 'social',
      resourceId: remote.resource.id,
      expectedRevision: remote.resource.revision,
    });
    remote.getCurrent.mockResolvedValue({
      status: 'synced',
      workspace: { ...remote.workspace, role: 'reviewer' },
    });

    await expect(context.service.reviewMarketingWorkflow({
      target: 'social',
      workflowId: prepared.workflow!.workflowId,
      approvalId: prepared.workflow!.approvalId,
      manifestDigest: prepared.workflow!.manifestDigest,
      decision: 'approved',
    })).resolves.toMatchObject({
      ok: true,
      status: 'synced',
      workflow: { status: 'approved' },
    });
    await expect(context.service.prepareMarketingWorkflow({
      target: 'social',
      resourceId: remote.resource.id,
      expectedRevision: remote.resource.revision,
    })).resolves.toMatchObject({ ok: false, status: 'forbidden' });
  });

  it('fails closed when the approved source revision changes before review', async () => {
    const remote = marketingWorkflowGateway('manager');
    const context = setup({ workspaceGateway: remote.gateway });
    const prepared = await context.service.prepareMarketingWorkflow({
      target: 'social',
      resourceId: remote.resource.id,
      expectedRevision: remote.resource.revision,
    });
    remote.getMarketingResource.mockResolvedValue({
      status: 'synced',
      resource: marketingContentResource({
        workspaceId: remote.workspace.id,
        revision: remote.resource.revision + 1,
        body: 'A newly approved revision',
      }),
    });

    await expect(context.service.reviewMarketingWorkflow({
      target: 'social',
      workflowId: prepared.workflow!.workflowId,
      approvalId: prepared.workflow!.approvalId,
      manifestDigest: prepared.workflow!.manifestDigest,
      decision: 'approved',
    })).resolves.toMatchObject({
      ok: false,
      status: 'conflict',
      workflow: null,
    });
    await expect(context.service.listMarketingWorkflows('social')).resolves.toMatchObject({
      ok: true,
      workflows: [{ status: 'pending', receipt: null }],
    });
  });

  it('rejects injected renderer authority and unauthorized prepare before resource access', async () => {
    const remote = marketingWorkflowGateway('viewer');
    const context = setup({ workspaceGateway: remote.gateway });

    await expect(context.service.prepareMarketingWorkflow({
      target: 'social',
      resourceId: remote.resource.id,
      expectedRevision: remote.resource.revision,
      workspaceId: remote.workspace.id,
    } as never)).resolves.toMatchObject({ ok: false, status: 'unavailable' });
    expect(remote.getCurrent).not.toHaveBeenCalled();

    await expect(context.service.prepareMarketingWorkflow({
      target: 'social',
      resourceId: remote.resource.id,
      expectedRevision: remote.resource.revision,
    })).resolves.toMatchObject({ ok: false, status: 'forbidden' });
    expect(remote.getMarketingResource).not.toHaveBeenCalled();
  });

  it('denies a workflow when the authoritative catalog omits its capability', async () => {
    const remote = marketingWorkflowGateway('manager');
    remote.getCapabilities.mockResolvedValue({
      status: 'synced',
      revision: 2,
      capabilities: [remoteCapability({ id: 'content-studio' })],
    });
    const context = setup({ workspaceGateway: remote.gateway });

    await expect(context.service.prepareMarketingWorkflow({
      target: 'social',
      resourceId: remote.resource.id,
      expectedRevision: remote.resource.revision,
    })).resolves.toMatchObject({ ok: false, status: 'forbidden', workflow: null });
    expect(remote.getMarketingResource).not.toHaveBeenCalled();
  });

  it('lists credential status only after remote workspace authority is synchronized', async () => {
    const remote = marketingResourceGateway('manager');
    const connected: CustomerMarketingCredentialStatus = {
      provider: 'youtube',
      state: 'connected',
      updatedAt: '2026-07-26T00:00:00.000Z',
    };
    const listStatuses = vi.fn((workspaceId: string) => {
      expect(workspaceId).toBe(remote.workspace.id);
      return {
        vaultState: 'ready' as const,
        credentials: [connected],
      };
    });
    const context = setup({
      workspaceGateway: remote.gateway,
      credentialVault: {
        listStatuses,
        revokeCredential: vi.fn(),
      },
    });

    const result = await context.service.listIntegrationCredentials();

    expect(result).toEqual({
      ok: true,
      status: 'synced',
      vaultState: 'ready',
      credentials: [connected],
    });
    expect(listStatuses).toHaveBeenCalledWith(remote.workspace.id);
    expect(JSON.stringify(result)).not.toContain('token');
  });

  it.each(['owner', 'manager'] as CustomerRole[])('allows %s to revoke a workspace credential', async (role) => {
    const remote = marketingResourceGateway(role);
    const revokeCredential = vi.fn((workspaceId: string, provider: string) => {
      expect(workspaceId).toBe(remote.workspace.id);
      expect(provider).toBe('facebook');
      return true;
    });
    const context = setup({
      workspaceGateway: remote.gateway,
      credentialVault: {
        listStatuses: vi.fn(),
        revokeCredential,
      },
    });

    await expect(context.service.revokeIntegrationCredential({ provider: 'facebook' }))
      .resolves.toEqual({
        ok: true,
        status: 'synced',
        provider: 'facebook',
        revoked: true,
        credential: { provider: 'facebook', state: 'disconnected', updatedAt: null },
      });
    expect(revokeCredential).toHaveBeenCalledWith(remote.workspace.id, 'facebook');
  });

  it.each(['editor', 'reviewer', 'viewer'] as CustomerRole[])('denies %s from revoking credentials', async (role) => {
    const remote = marketingResourceGateway(role);
    const revokeCredential = vi.fn();
    const context = setup({
      workspaceGateway: remote.gateway,
      credentialVault: {
        listStatuses: vi.fn(),
        revokeCredential,
      },
    });

    await expect(context.service.revokeIntegrationCredential({ provider: 'facebook' }))
      .resolves.toMatchObject({ ok: false, status: 'forbidden', revoked: false, credential: null });
    expect(revokeCredential).not.toHaveBeenCalled();
  });

  it('fails closed when remote authority is unavailable before listing or revoking credentials', async () => {
    const remote = marketingResourceGateway('owner', 'unavailable');
    const listStatuses = vi.fn();
    const revokeCredential = vi.fn();
    const context = setup({
      workspaceGateway: remote.gateway,
      credentialVault: { listStatuses, revokeCredential },
    });

    await expect(context.service.listIntegrationCredentials())
      .resolves.toMatchObject({ ok: false, status: 'unavailable', credentials: [] });
    await expect(context.service.revokeIntegrationCredential({ provider: 'facebook' }))
      .resolves.toMatchObject({ ok: false, status: 'unavailable', revoked: false });
    expect(listStatuses).not.toHaveBeenCalled();
    expect(revokeCredential).not.toHaveBeenCalled();
  });
});

describe('CustomerMarketingService CMR-402 external action gate', () => {
  it.each([
    ['publish', 'social', 'facebook', { itemCount: 1, recipientCount: 0, spendVnd: 0 }],
    ['spend', 'social', 'facebook', { itemCount: 0, recipientCount: 0, spendVnd: 1 }],
    ['bulk_email', 'email', 'email', { itemCount: 1, recipientCount: 1, spendVnd: 0 }],
    ['destructive', 'crm', 'crm', { itemCount: 1, recipientCount: 0, spendVnd: 0 }],
  ] as const)('denies %s under cmr-306 without reading credential status', async (
    action,
    target,
    provider,
    metadata,
  ) => {
    const remote = marketingWorkflowGateway('manager', target);
    const listStatuses = vi.fn();
    const context = setup({
      workspaceGateway: remote.gateway,
      credentialVault: {
        listStatuses,
        revokeCredential: vi.fn(),
      },
    });
    const prepared = await context.service.prepareMarketingWorkflow({
      target,
      resourceId: remote.resource.id,
      expectedRevision: remote.resource.revision,
    });
    const workflow = prepared.workflow!;
    await context.service.reviewMarketingWorkflow({
      target,
      workflowId: workflow.workflowId,
      approvalId: workflow.approvalId,
      manifestDigest: workflow.manifestDigest,
      decision: 'approved',
    });

    await expect(context.service.checkExternalActionGate({
      action,
      target,
      workflowId: workflow.workflowId,
      approvalId: workflow.approvalId,
      manifestDigest: workflow.manifestDigest,
      provider,
      metadata,
    })).resolves.toEqual({
      allowed: false,
      executed: false,
      denialReason: 'policy_denied',
    });
    expect(listStatuses).not.toHaveBeenCalled();
    expect(remote.archiveMarketingResource).not.toHaveBeenCalled();
  });

  it('rejects injected renderer authority before resolving the workspace', async () => {
    const remote = marketingWorkflowGateway('manager');
    const context = setup({ workspaceGateway: remote.gateway });

    await expect(context.service.checkExternalActionGate({
      action: 'publish',
      target: 'social',
      workflowId: 'workflow-1',
      approvalId: 'approval-1',
      manifestDigest: 'a'.repeat(64),
      provider: 'facebook',
      metadata: { itemCount: 1, recipientCount: 0, spendVnd: 0 },
      workspaceId: remote.workspace.id,
    } as never)).resolves.toEqual({
      allowed: false,
      executed: false,
      denialReason: 'invalid_request',
    });
    expect(remote.getCurrent).not.toHaveBeenCalled();
    expect(remote.getMarketingResource).not.toHaveBeenCalled();
  });

  it('requires approval before source or credential access', async () => {
    const remote = marketingWorkflowGateway('manager');
    const listStatuses = vi.fn();
    const context = setup({
      workspaceGateway: remote.gateway,
      credentialVault: { listStatuses, revokeCredential: vi.fn() },
    });
    const prepared = await context.service.prepareMarketingWorkflow({
      target: 'social',
      resourceId: remote.resource.id,
      expectedRevision: remote.resource.revision,
    });
    const sourceReadsBeforeGate = remote.getMarketingResource.mock.calls.length;

    await expect(context.service.checkExternalActionGate({
      action: 'publish',
      target: 'social',
      workflowId: prepared.workflow!.workflowId,
      approvalId: prepared.workflow!.approvalId,
      manifestDigest: prepared.workflow!.manifestDigest,
      provider: 'facebook',
      metadata: { itemCount: 1, recipientCount: 0, spendVnd: 0 },
    })).resolves.toMatchObject({
      allowed: false,
      executed: false,
      denialReason: 'approval_required',
    });
    expect(remote.getMarketingResource).toHaveBeenCalledTimes(sourceReadsBeforeGate);
    expect(listStatuses).not.toHaveBeenCalled();
  });

  it('denies changed authoritative source evidence after approval', async () => {
    const remote = marketingWorkflowGateway('manager');
    const context = setup({ workspaceGateway: remote.gateway });
    const prepared = await context.service.prepareMarketingWorkflow({
      target: 'social',
      resourceId: remote.resource.id,
      expectedRevision: remote.resource.revision,
    });
    const workflow = prepared.workflow!;
    await context.service.reviewMarketingWorkflow({
      target: 'social',
      workflowId: workflow.workflowId,
      approvalId: workflow.approvalId,
      manifestDigest: workflow.manifestDigest,
      decision: 'approved',
    });
    remote.getMarketingResource.mockResolvedValue({
      status: 'synced',
      resource: marketingContentResource({
        workspaceId: remote.workspace.id,
        revision: remote.resource.revision + 1,
      }),
    });

    await expect(context.service.checkExternalActionGate({
      action: 'publish',
      target: 'social',
      workflowId: workflow.workflowId,
      approvalId: workflow.approvalId,
      manifestDigest: workflow.manifestDigest,
      provider: 'facebook',
      metadata: { itemCount: 1, recipientCount: 0, spendVnd: 0 },
    })).resolves.toMatchObject({ denialReason: 'manifest_mismatch' });
  });

  it('CMR-222 halts an action that would otherwise pass approval', async () => {
    const remote = marketingWorkflowGateway('manager');
    const listStatuses = vi.fn();
    let engaged = false;
    const context = setup({
      workspaceGateway: remote.gateway,
      credentialVault: { listStatuses, revokeCredential: vi.fn() },
      readGuardrailState: () => ({
        killSwitch: engaged ? { engaged: true, source: 'file' } : { engaged: false, source: 'none' },
        policy: CUSTOMER_MARKETING_GUARDRAIL_DEFAULT_POLICY,
        spendVndUsedInWindow: 0,
      }),
    });
    const prepared = await context.service.prepareMarketingWorkflow({
      target: 'social',
      resourceId: remote.resource.id,
      expectedRevision: remote.resource.revision,
    });
    const workflow = prepared.workflow!;
    await context.service.reviewMarketingWorkflow({
      target: 'social',
      workflowId: workflow.workflowId,
      approvalId: workflow.approvalId,
      manifestDigest: workflow.manifestDigest,
      decision: 'approved',
    });

    // The same approved request reaches the wave policy while the halt is off.
    await expect(context.service.checkExternalActionGate({
      action: 'publish',
      target: 'social',
      workflowId: workflow.workflowId,
      approvalId: workflow.approvalId,
      manifestDigest: workflow.manifestDigest,
      provider: 'facebook',
      metadata: { itemCount: 1, recipientCount: 0, spendVnd: 0 },
    })).resolves.toEqual({
      allowed: false,
      executed: false,
      denialReason: 'policy_denied',
    });

    engaged = true;
    const gatewayCallsBefore = remote.getCurrent.mock.calls.length;

    await expect(context.service.checkExternalActionGate({
      action: 'publish',
      target: 'social',
      workflowId: workflow.workflowId,
      approvalId: workflow.approvalId,
      manifestDigest: workflow.manifestDigest,
      provider: 'facebook',
      metadata: { itemCount: 1, recipientCount: 0, spendVnd: 0 },
    })).resolves.toEqual({
      allowed: false,
      executed: false,
      denialReason: 'kill_switch_engaged',
    });
    expect(remote.getCurrent.mock.calls.length).toBe(gatewayCallsBefore);
    expect(listStatuses).not.toHaveBeenCalled();
  });

  it('CMR-222 halts when no guardrail reader was wired at all', async () => {
    const remote = marketingWorkflowGateway('manager');
    const unguarded = new CustomerMarketingService(
      new MemorySettings(),
      () => ({ id: 'tenant-a', name: 'Owner A', plan: 'pro', balance: 75 }),
      () => [],
      vi.fn(async () => ({ reply: '', error: 'not-configured' })),
      null,
      remote.gateway,
    );

    await expect(unguarded.checkExternalActionGate({
      action: 'publish',
      target: 'social',
      workflowId: 'workflow-1',
      approvalId: 'approval-1',
      manifestDigest: 'a'.repeat(64),
      provider: 'facebook',
      metadata: { itemCount: 1, recipientCount: 0, spendVnd: 0 },
    })).resolves.toEqual({
      allowed: false,
      executed: false,
      denialReason: 'kill_switch_engaged',
    });
    expect(remote.getCurrent).not.toHaveBeenCalled();
  });

  it('CMR-222 denies a spend above the product cap without reading the source', async () => {
    const remote = marketingWorkflowGateway('manager');
    const context = setup({ workspaceGateway: remote.gateway });

    await expect(context.service.checkExternalActionGate({
      action: 'spend',
      target: 'social',
      workflowId: 'workflow-1',
      approvalId: 'approval-1',
      manifestDigest: 'a'.repeat(64),
      provider: 'facebook',
      metadata: {
        itemCount: 0,
        recipientCount: 0,
        spendVnd: CUSTOMER_MARKETING_GUARDRAIL_DEFAULT_POLICY.maxSpendVndPerRun + 1,
      },
    })).resolves.toEqual({
      allowed: false,
      executed: false,
      denialReason: 'policy_denied',
    });
    // The cap denial happens once authority is known, before the source is read.
    expect(remote.getMarketingResource).not.toHaveBeenCalled();
  });

  it('hard-denies archive without any workspace gateway call', async () => {
    const remote = marketingResourceGateway('owner');
    const context = setup({ workspaceGateway: remote.gateway });

    await expect(context.service.archiveMarketingResource({
      kind: 'campaign',
      resourceId: remote.resource.id,
      expectedRevision: remote.resource.revision,
    })).resolves.toEqual({
      ok: false,
      status: 'forbidden',
      deleted: false,
      error: 'Lưu trữ bị khóa; không có tài nguyên nào bị xóa.',
    });
    expect(remote.getCurrent).not.toHaveBeenCalled();
    expect(remote.archiveMarketingResource).not.toHaveBeenCalled();
  });
});
