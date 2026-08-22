import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { CustomerMarketingService } from './customer-marketing-service';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    electronMocks.handlers.set(channel, handler);
  }),
  showOpenDialog: vi.fn(),
  fromWebContents: vi.fn(),
  openPath: vi.fn(),
  isPackaged: false,
}));

vi.mock('electron', () => ({
  ipcMain: { handle: electronMocks.handle },
  dialog: { showOpenDialog: electronMocks.showOpenDialog },
  BrowserWindow: { fromWebContents: electronMocks.fromWebContents },
  app: {
    get isPackaged() { return electronMocks.isPackaged; },
  },
  shell: { openPath: electronMocks.openPath },
}));

import { registerCustomerMarketingIpc } from './customer-marketing-ipc';
import { isTrustedMarketingSender } from '../marketing/marketing-ipc';

function event(url = 'http://localhost:5173/customer-marketing'): IpcMainInvokeEvent {
  const sender = { id: 7, getURL: () => url };
  electronMocks.fromWebContents.mockReturnValue({ webContents: { id: 7 } });
  return {
    sender,
    senderFrame: { url, parent: null },
  } as unknown as IpcMainInvokeEvent;
}

function serviceMock() {
  return {
    getInitialSnapshot: vi.fn(),
    getSnapshot: vi.fn(),
    listIntegrationCredentials: vi.fn(async () => ({
      ok: true,
      status: 'synced',
      vaultState: 'ready',
      credentials: [],
    })),
    revokeIntegrationCredential: vi.fn(async (input) => ({
      ok: true,
      status: 'synced',
      provider: input.provider,
      revoked: true,
      credential: { provider: input.provider, state: 'disconnected', updatedAt: null },
    })),
    listConnectorOperations: vi.fn(async () => ({
      ok: true,
      status: 'synced',
      revision: 1,
      receipts: [],
    })),
    checkIntegrationHealth: vi.fn(async (input) => ({
      ok: true,
      status: 'synced',
      provider: input.provider,
      health: 'ready',
      operationsRevision: 2,
      operationReceipt: null,
    })),
    getCanaryReadiness: vi.fn(async () => ({
      ok: true,
      status: 'synced',
      provider: 'telegram',
      controlPlane: { enabled: false, killSwitch: false, bindingDigest: null, stateRevision: 0 },
      credentialState: 'disconnected',
      liveReady: false,
      missingRequirements: ['credential', 'private_sandbox_chat', 'named_approval', 'canary_enablement'],
      externalActionPerformed: false,
    })),
    configureTelegramSandbox: vi.fn(async () => ({
      ok: true,
      status: 'synced',
      provider: 'telegram',
      credentialState: 'connected',
      privateSandboxChatConfigured: true,
      externalActionPerformed: false,
    })),
    prepareTelegramCanaryCandidate: vi.fn(async () => ({
      ok: true,
      status: 'synced',
      candidate: {
        provider: 'telegram',
        operation: 'private_sandbox_send',
        workflowId: 'cmr306-social-workflow-1',
        manifestDigest: 'a'.repeat(64),
        resourceId: '55555555-5555-4555-8555-555555555555',
        expectedRevision: 3,
        text: 'Approved launch copy.',
        resourceDigest: 'b'.repeat(64),
        externalActionPerformed: false,
      },
      externalActionPerformed: false,
    })),
    approveTelegramCanaryCandidate: vi.fn(async () => ({
      ok: true,
      status: 'synced',
      approval: {
        approvalId: 'approval-cmr230b-ipc-1', reviewer: 'Owner A',
        manifestDigest: 'a'.repeat(64), resourceDigest: 'b'.repeat(64), expectedRevision: 3,
        expiresAt: '2026-08-12T15:15:00.000Z', receiptDigest: 'c'.repeat(64),
        externalActionPerformed: false,
      },
      externalActionPerformed: false,
    })),
    enableTelegramCanary: vi.fn(async () => ({
      ok: true,
      status: 'synced',
      controlPlane: { enabled: true, killSwitch: false, bindingDigest: 'd'.repeat(64), stateRevision: 1 },
      receipt: {
        action: 'enabled', reason: 'named-approval-bound', bindingDigest: 'd'.repeat(64),
        stateRevision: 1, createdAt: '2026-08-13T00:00:00.000Z',
        externalActionPerformed: false, receiptDigest: 'e'.repeat(64),
      },
      externalActionPerformed: false,
    })),
    rollbackTelegramCanary: vi.fn(async () => ({
      ok: true,
      status: 'synced',
      controlPlane: { enabled: false, killSwitch: false, bindingDigest: null, stateRevision: 2 },
      receipt: {
        action: 'rolled_back', reason: 'operator-request', bindingDigest: 'd'.repeat(64),
        stateRevision: 2, createdAt: '2026-08-13T01:00:00.000Z',
        externalActionPerformed: false, receiptDigest: 'f'.repeat(64),
      },
      externalActionPerformed: false,
    })),
    sendTelegramCanary: vi.fn(async () => ({
      ok: true,
      status: 'synced',
      outcome: 'performed',
      controlPlane: { enabled: true, killSwitch: false, bindingDigest: 'd'.repeat(64), stateRevision: 1 },
      receipt: {
        attemptId: 'attempt-cmr230b-ipc-1', bindingDigest: 'd'.repeat(64),
        resourceDigest: 'b'.repeat(64), createdAt: '2026-08-13T01:30:00.000Z',
        outcome: 'performed', receiptDigest: '9'.repeat(64),
      },
      detail: 'Telegram private canary send completed.',
      externalActionPerformed: true,
    })),
    getProductMarketingContext: vi.fn(async () => null),
    saveProductMarketingContext: vi.fn(async (input) => ({
      ok: true,
      status: 'saved',
      context: {
        schemaVersion: 1,
        contextId: 'product-marketing-context',
        revision: 1,
        locales: ['vi', 'en'],
        product: input.product,
        sources: input.sources.map((source) => ({ ...source, sha256: 'a'.repeat(64) })),
        reviewer: {
          name: 'Owner A',
          reviewedAt: '2026-07-29T12:00:00.000Z',
        },
        sha256: 'b'.repeat(64),
      },
    })),
    saveOnboarding: vi.fn(),
    createGoal: vi.fn(),
    askDirector: vi.fn(),
    measurePageSpeed: vi.fn(async () => ({
      ok: false,
      reason: 'rate_limited',
      error: 'Google PageSpeed đang giới hạn số lần gọi.',
    })),
    reviewApproval: vi.fn(),
    listWorkspaceMembers: vi.fn(async () => ({ ok: true, members: [] })),
    updateWorkspaceMemberRole: vi.fn(async () => ({ ok: true, members: [] })),
    createWorkspaceInvitation: vi.fn(async () => ({
      ok: true,
      email: 'new@example.com',
      role: 'viewer',
      expiresAt: '2026-07-29T00:00:00.000Z',
      copied: true,
    })),
    retryWorkspaceInvitationCopy: vi.fn(async () => ({
      ok: true,
      email: 'new@example.com',
      role: 'viewer',
      expiresAt: '2026-07-29T00:00:00.000Z',
      copied: true,
    })),
    importMediaProject: vi.fn(async () => ({ ok: true })),
    runMediaPreview: vi.fn(async () => ({ ok: true })),
    createMediaVoicePreview: vi.fn(async () => ({ ok: true })),
    createMediaVideoPreview: vi.fn(async () => ({ ok: true })),
    openMediaVideoPreview: vi.fn(async () => ({ ok: true })),
    repairVoiceStudio: vi.fn(async () => ({ ok: true, outcome: 'ready' })),
    listMarketingResources: vi.fn(async () => ({ ok: true, status: 'synced', resources: [] })),
    listMarketingCalendar: vi.fn(async () => ({ ok: true, status: 'synced', resources: [] })),
    getMarketingAnalytics: vi.fn(async () => ({ ok: true, status: 'synced', report: null })),
    listMarketingWorkflowSources: vi.fn(async () => ({ ok: true, status: 'synced', sources: [] })),
    listMarketingWorkflows: vi.fn(async () => ({ ok: true, status: 'synced', workflows: [] })),
    prepareMarketingWorkflow: vi.fn(async () => ({ ok: true, status: 'synced', workflow: null })),
    reviewMarketingWorkflow: vi.fn(async () => ({ ok: true, status: 'synced', workflow: null })),
    checkExternalActionGate: vi.fn(async () => ({
      allowed: false,
      executed: false,
      denialReason: 'policy_denied',
    })),
    createMarketingResource: vi.fn(async () => ({ ok: true, status: 'synced', resource: null })),
    updateMarketingResource: vi.fn(async () => ({ ok: true, status: 'synced', resource: null })),
    reviewMarketingResource: vi.fn(async () => ({ ok: true, status: 'synced', resource: null })),
    archiveMarketingResource: vi.fn(async () => ({ ok: true, status: 'synced', deleted: true })),
    listMarketingResourceAudit: vi.fn(async () => ({ ok: true, status: 'synced', receipts: [] })),
  };
}

beforeEach(() => {
  electronMocks.handlers.clear();
  electronMocks.handle.mockClear();
  electronMocks.showOpenDialog.mockReset();
  electronMocks.fromWebContents.mockReset();
  electronMocks.isPackaged = false;
  delete process.env.OPENCLAW_FORCE_PROD_RENDERER;
});

describe('customer marketing snapshot IPC', () => {
  it('separates the fast initial snapshot from the full no-payload refresh', async () => {
    const service = serviceMock();
    service.getInitialSnapshot.mockResolvedValue({ kind: 'initial' });
    service.getSnapshot.mockResolvedValue({ kind: 'refreshed' });
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const initial = electronMocks.handlers.get('customerMarketing:getSnapshot');
    const refresh = electronMocks.handlers.get('customerMarketing:refreshSnapshot');

    await expect(initial!(event())).resolves.toEqual({ kind: 'initial' });
    await expect(refresh!(event())).resolves.toEqual({ kind: 'refreshed' });
    expect(service.getInitialSnapshot).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot).toHaveBeenCalledTimes(1);

    await expect(initial!(event(), { workspaceId: 'renderer-controlled' }))
      .rejects.toThrow('Payload snapshot không được phép');
    await expect(refresh!(event(), { token: 'renderer-controlled' }))
      .rejects.toThrow('Payload snapshot không được phép');
  });
});

describe('customer marketing PageSpeed IPC', () => {
  const auditInput = { url: 'https://izziapi.com/', strategy: 'mobile' } as const;

  it('passes only the exact read-only audit contract to the service', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:measurePageSpeed');

    await expect(handler!(event(), auditInput)).resolves.toMatchObject({
      ok: false,
      reason: 'rate_limited',
    });
    expect(service.measurePageSpeed).toHaveBeenCalledWith(auditInput);
  });

  it.each([
    { ...auditInput, token: 'renderer-secret' },
    { ...auditInput, workspaceId: 'renderer-workspace' },
    { ...auditInput, strategy: 'tablet' },
    'https://izziapi.com/',
  ])('rejects malformed or expanded input before service execution %#', async (payload) => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:measurePageSpeed');

    await expect(handler!(event(), payload)).rejects.toThrow('Payload PageSpeed không hợp lệ');
    expect(service.measurePageSpeed).not.toHaveBeenCalled();
  });

  it('rejects an untrusted renderer before parsing or service execution', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:measurePageSpeed');

    await expect(handler!(event('https://attacker.example/customer-marketing'), auditInput))
      .rejects.toThrow('sender không hợp lệ');
    expect(service.measurePageSpeed).not.toHaveBeenCalled();
  });
});

describe('customer marketing media IPC', () => {
  it('accepts no renderer-controlled Voice Studio selector or path', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:repairVoiceStudio');
    expect(handler).toBeTypeOf('function');

    await expect(handler!(event())).resolves.toEqual({ ok: true, outcome: 'ready' });
    expect(service.repairVoiceStudio).toHaveBeenCalledTimes(1);

    await expect(handler!(event(), { extensionId: 'ext-attacker', path: 'C:\\private' }))
      .rejects.toThrow('Payload Voice Studio không được phép');
    expect(service.repairVoiceStudio).toHaveBeenCalledTimes(1);
  });

  it('rejects an untrusted sender before Voice Studio service execution', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:repairVoiceStudio');

    await expect(handler!(event('https://attacker.example/customer-marketing')))
      .rejects.toThrow('sender không hợp lệ');
    expect(service.repairVoiceStudio).not.toHaveBeenCalled();
  });

  it('accepts the exact Starizzi dev origin only in an unpackaged dev renderer', () => {
    expect(isTrustedMarketingSender(event())).toBe(true);
    expect(isTrustedMarketingSender(event('http://127.0.0.1:5173/customer-marketing'))).toBe(true);
    expect(isTrustedMarketingSender(event('http://localhost:9999/customer-marketing'))).toBe(false);
    expect(isTrustedMarketingSender(event('https://localhost:5173/customer-marketing'))).toBe(false);
    electronMocks.isPackaged = true;
    expect(isTrustedMarketingSender(event())).toBe(false);
    electronMocks.isPackaged = false;
    process.env.OPENCLAW_FORCE_PROD_RENDERER = '1';
    expect(isTrustedMarketingSender(event())).toBe(false);
  });

  it('uses only the main-process dialog path for media import', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\trusted\\project'] });
    const handler = electronMocks.handlers.get('customerMarketing:selectMediaProject');
    expect(handler).toBeTypeOf('function');

    const result = await handler!(event(), 'C:\\renderer-controlled\\project');

    expect(service.importMediaProject).toHaveBeenCalledWith('C:\\trusted\\project');
    expect(service.importMediaProject).not.toHaveBeenCalledWith('C:\\renderer-controlled\\project');
    expect(result).toEqual({ canceled: false, result: { ok: true } });
  });

  it('does not mutate workspace when the dialog is canceled', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const handler = electronMocks.handlers.get('customerMarketing:selectMediaProject');

    await expect(handler!(event())).resolves.toEqual({ canceled: true });
    expect(service.importMediaProject).not.toHaveBeenCalled();
  });

  it('rejects non-object preview payloads before service execution', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:runMediaPreview');

    await expect(handler!(event(), 'media-job-id')).rejects.toThrow('Payload customer marketing không hợp lệ');
    expect(service.runMediaPreview).not.toHaveBeenCalled();
  });

  it('passes only an exact job id to the Voice Studio preview service', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:createMediaVoicePreview');

    await expect(handler!(event(), { jobId: 'media-job-1' })).resolves.toEqual({ ok: true });
    expect(service.createMediaVoicePreview).toHaveBeenCalledWith({ jobId: 'media-job-1' });
  });

  it.each([
    'media-job-1',
    { jobId: '' },
    { jobId: 'x'.repeat(121) },
    { jobId: 'media-job-1', text: 'renderer-controlled' },
    { jobId: 'media-job-1', voice: 'renderer-controlled' },
    { jobId: 'media-job-1', path: 'C:\\private' },
    { jobId: 'media-job-1', workspaceId: 'renderer-controlled' },
  ])('rejects expanded Voice Studio preview payloads before service execution %#', async (payload) => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:createMediaVoicePreview');

    await expect(handler!(event(), payload)).rejects.toThrow(/Payload (voice preview|customer marketing) không hợp lệ/);
    expect(service.createMediaVoicePreview).not.toHaveBeenCalled();
  });

  it('rejects an untrusted renderer before parsing a Voice Studio preview request', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:createMediaVoicePreview');

    await expect(handler!(
      event('https://attacker.example/customer-marketing'),
      { jobId: 'media-job-1', voice: 'attacker' },
    )).rejects.toThrow('sender không hợp lệ');
    expect(service.createMediaVoicePreview).not.toHaveBeenCalled();
  });

  it('passes only an exact job id to the local video preview service', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:createMediaVideoPreview');

    await expect(handler!(event(), { jobId: 'media-job-1' })).resolves.toEqual({ ok: true });
    expect(service.createMediaVideoPreview).toHaveBeenCalledWith({ jobId: 'media-job-1' });
  });

  it.each([
    'media-job-1',
    { jobId: '' },
    { jobId: 'x'.repeat(121) },
    { jobId: 'media-job-1', path: 'C:\\private' },
    { jobId: 'media-job-1', output: 'renderer-controlled.mp4' },
    { jobId: 'media-job-1', workspaceId: 'renderer-controlled' },
  ])('rejects expanded local video preview payloads before service execution %#', async (payload) => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:createMediaVideoPreview');

    await expect(handler!(event(), payload)).rejects.toThrow(/Payload (video preview|customer marketing) không hợp lệ/);
    expect(service.createMediaVideoPreview).not.toHaveBeenCalled();
  });

  it('passes only an exact job id to the local video opener', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:openMediaVideoPreview');

    await expect(handler!(event(), { jobId: 'media-job-1' })).resolves.toEqual({ ok: true });
    expect(service.openMediaVideoPreview).toHaveBeenCalledWith({ jobId: 'media-job-1' });
  });

  it.each([
    'media-job-1',
    { jobId: '' },
    { jobId: 'x'.repeat(121) },
    { jobId: 'media-job-1', path: 'C:\\private\\video.mp4' },
    { jobId: 'media-job-1', output: 'renderer-controlled.mp4' },
    { jobId: 'media-job-1', workspaceId: 'renderer-controlled' },
  ])('rejects expanded local video open payloads before service execution %#', async (payload) => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:openMediaVideoPreview');

    await expect(handler!(event(), payload)).rejects.toThrow(/Payload (video preview|customer marketing) không hợp lệ/);
    expect(service.openMediaVideoPreview).not.toHaveBeenCalled();
  });
});

describe('customer marketing Product Marketing Context IPC', () => {
  const input = {
    authorityToken: `v1.${'a'.repeat(64)}`,
    expectedRevision: 0,
    product: {
      productName: 'IzziAPI',
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
        sourceIds: ['source-site'],
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
    sources: [{
      id: 'source-site',
      title: 'IzziAPI product site',
      url: 'https://izziapi.com/',
      excerpt: 'Product and API capability overview used as marketing evidence.',
    }],
  };

  it('reads context only from a trusted sender and accepts no renderer payload', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:getProductMarketingContext');

    await expect(handler!(event())).resolves.toBeNull();
    await expect(handler!(event(), { workspaceId: 'renderer-controlled' }))
      .rejects.toThrow('Payload Product Marketing Context không được phép');
    await expect(handler!(event('http://localhost:9999/customer-marketing')))
      .rejects.toThrow('Customer Marketing IPC sender');
    expect(service.getProductMarketingContext).toHaveBeenCalledTimes(1);
  });

  it('passes only the strict context draft with an opaque main-issued authority token', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:saveProductMarketingContext');

    await expect(handler!(event(), input)).resolves.toMatchObject({
      ok: true,
      status: 'saved',
      context: { revision: 1 },
    });
    expect(service.saveProductMarketingContext).toHaveBeenCalledWith(input);

    await expect(handler!(event(), {
      ...input,
      authorityToken: 'renderer-controlled',
    })).rejects.toThrow('Payload Product Marketing Context không hợp lệ');
    await expect(handler!(event(), {
      ...input,
      workspaceId: 'renderer-controlled',
    })).rejects.toThrow('Payload Product Marketing Context không hợp lệ');
    await expect(handler!(event(), {
      ...input,
      reviewer: { name: 'Renderer reviewer' },
    })).rejects.toThrow('Payload Product Marketing Context không hợp lệ');
    await expect(handler!(event(), {
      ...input,
      sha256: 'c'.repeat(64),
    })).rejects.toThrow('Payload Product Marketing Context không hợp lệ');
    expect(service.saveProductMarketingContext).toHaveBeenCalledTimes(1);
  });
});

describe('customer marketing member IPC', () => {
  it('lists members without accepting a renderer workspace identifier', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:listWorkspaceMembers');

    await expect(handler!(event(), { workspaceId: 'renderer-workspace' })).resolves.toEqual({
      ok: true,
      members: [],
    });
    expect(service.listWorkspaceMembers).toHaveBeenCalledWith();
  });

  it('passes only an allowlisted member id and role to the service', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:updateWorkspaceMemberRole');
    const payload = {
      memberUserId: '22222222-2222-4222-8222-222222222222',
      role: 'reviewer',
    };

    await expect(handler!(event(), payload)).resolves.toEqual({ ok: true, members: [] });
    expect(service.updateWorkspaceMemberRole).toHaveBeenCalledWith(payload);
  });

  it('rejects injected workspace or actor identifiers before service execution', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:updateWorkspaceMemberRole');

    await expect(handler!(event(), {
      memberUserId: '22222222-2222-4222-8222-222222222222',
      role: 'reviewer',
      workspaceId: 'renderer-controlled',
    })).rejects.toThrow('Payload cập nhật thành viên không hợp lệ');
    await expect(handler!(event(), {
      memberUserId: '22222222-2222-4222-8222-222222222222',
      role: 'reviewer',
      actorUserId: 'renderer-controlled',
    })).rejects.toThrow('Payload cập nhật thành viên không hợp lệ');
    expect(service.updateWorkspaceMemberRole).not.toHaveBeenCalled();
  });
});

describe('customer marketing invitation IPC', () => {
  it('consumes a buffered token-free deep-link status without renderer input', async () => {
    const service = serviceMock();
    const consumeInvitationStatus = vi.fn(() => ({
      ok: true,
      workspaceId: '11111111-1111-4111-8111-111111111111',
      role: 'viewer' as const,
    }));
    registerCustomerMarketingIpc(
      service as unknown as CustomerMarketingService,
      { consumeInvitationStatus },
    );
    const handler = electronMocks.handlers.get('customerMarketing:consumeWorkspaceInvitationStatus');

    await expect(handler!(event(), { token: 'renderer-controlled' })).resolves.toEqual({
      ok: true,
      workspaceId: '11111111-1111-4111-8111-111111111111',
      role: 'viewer',
    });
    expect(consumeInvitationStatus).toHaveBeenCalledWith();
  });

  it('passes only allowlisted email and role fields to main', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:createWorkspaceInvitation');
    const payload = { email: 'new@example.com', role: 'viewer' };

    await expect(handler!(event(), payload)).resolves.toMatchObject({ ok: true, copied: true });
    expect(service.createWorkspaceInvitation).toHaveBeenCalledWith(payload);
  });

  it('rejects renderer workspace ids and tokens before invitation service execution', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:createWorkspaceInvitation');

    await expect(handler!(event(), {
      email: 'new@example.com',
      role: 'viewer',
      workspaceId: 'renderer-controlled',
    })).rejects.toThrow('Payload lời mời không hợp lệ');
    await expect(handler!(event(), {
      email: 'new@example.com',
      role: 'viewer',
      token: 'renderer-controlled',
    })).rejects.toThrow('Payload lời mời không hợp lệ');
    expect(service.createWorkspaceInvitation).not.toHaveBeenCalled();
  });

  it('retries the in-memory clipboard value without accepting renderer payload', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const handler = electronMocks.handlers.get('customerMarketing:retryWorkspaceInvitationCopy');

    await expect(handler!(event(), { token: 'renderer-controlled' })).resolves.toMatchObject({
      ok: true,
      copied: true,
    });
    expect(service.retryWorkspaceInvitationCopy).toHaveBeenCalledWith();
  });
});

describe('customer marketing resource IPC', () => {
  const createInput = {
    kind: 'campaign',
    title: 'Autumn launch',
    metadata: { locale: 'vi' },
    description: null,
    objective: 'Generate qualified leads',
    startsAt: '2026-08-01T00:00:00.000Z',
    endsAt: null,
  };

  it('exposes list, calendar, and analytics without a renderer workspace identifier', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const list = electronMocks.handlers.get('customerMarketing:listMarketingResources');
    const calendar = electronMocks.handlers.get('customerMarketing:listMarketingCalendar');
    const analytics = electronMocks.handlers.get('customerMarketing:getMarketingAnalytics');
    const window = {
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T23:59:59.000Z',
    };

    await expect(list!(event(), 'campaign')).resolves.toMatchObject({ ok: true, resources: [] });
    await expect(calendar!(event(), window)).resolves.toMatchObject({ ok: true, resources: [] });
    await expect(analytics!(event(), window)).resolves.toMatchObject({ ok: true, status: 'synced' });
    expect(service.listMarketingResources).toHaveBeenCalledWith('campaign');
    expect(service.listMarketingCalendar).toHaveBeenCalledWith(window);
    expect(service.getMarketingAnalytics).toHaveBeenCalledWith(window);
  });

  it('rejects untrusted or extended analytics payloads before service execution', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const analytics = electronMocks.handlers.get('customerMarketing:getMarketingAnalytics');
    const validWindow = {
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-31T23:59:59.000Z',
    };

    await expect(analytics!(event('http://localhost:9999/customer-marketing'), validWindow))
      .rejects.toThrow('Customer Marketing IPC sender');
    await expect(analytics!(event(), { ...validWindow, workspaceId: 'renderer-controlled' }))
      .rejects.toThrow('Payload analytics marketing khong hop le');
    await expect(analytics!(event(), {
      from: '2026-08-01T07:00:00.000+07:00',
      to: validWindow.to,
    })).rejects.toThrow('Payload analytics marketing khong hop le');
    await expect(analytics!(event(), {
      from: '2025-01-01T00:00:00.000Z',
      to: '2026-01-03T00:00:00.000Z',
    })).rejects.toThrow('Payload analytics marketing khong hop le');
    expect(service.getMarketingAnalytics).not.toHaveBeenCalled();
  });

  it('passes only the exact renderer-safe create contract to main', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const create = electronMocks.handlers.get('customerMarketing:createMarketingResource');

    await expect(create!(event(), createInput)).resolves.toMatchObject({ ok: true, status: 'synced' });
    expect(service.createMarketingResource).toHaveBeenCalledWith(createInput);

    await expect(create!(event(), { ...createInput, workspaceId: 'renderer-controlled' }))
      .rejects.toThrow('Payload tài nguyên marketing không hợp lệ');
    await expect(create!(event(), { ...createInput, idempotencyKey: 'renderer-controlled' }))
      .rejects.toThrow('Payload tài nguyên marketing không hợp lệ');
    await expect(create!(event(), { ...createInput, metadata: { token: 'renderer-controlled' } }))
      .rejects.toThrow('Payload tài nguyên marketing không hợp lệ');
    expect(service.createMarketingResource).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed update, review, and archive payloads before service execution', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const update = electronMocks.handlers.get('customerMarketing:updateMarketingResource');
    const review = electronMocks.handlers.get('customerMarketing:reviewMarketingResource');
    const archive = electronMocks.handlers.get('customerMarketing:archiveMarketingResource');
    const resourceId = '44444444-4444-4444-8444-444444444444';

    await expect(update!(event(), {
      kind: 'campaign',
      resourceId,
      expectedRevision: 0,
      patch: { title: 'Updated', storagePath: 'renderer-controlled' },
    })).rejects.toThrow('Payload cập nhật marketing không hợp lệ');
    await expect(review!(event(), {
      kind: 'asset',
      resourceId,
      action: 'approve',
      expectedRevision: 0,
    })).rejects.toThrow('Payload review marketing không hợp lệ');
    await expect(archive!(event(), {
      kind: 'campaign',
      resourceId,
      expectedRevision: 0,
      hardDelete: true,
    })).rejects.toThrow('Payload archive marketing không hợp lệ');

    expect(service.updateMarketingResource).not.toHaveBeenCalled();
    expect(service.reviewMarketingResource).not.toHaveBeenCalled();
    expect(service.archiveMarketingResource).not.toHaveBeenCalled();
  });
});

describe('customer marketing CMR-306 workflow IPC', () => {
  const prepareInput = {
    target: 'social',
    resourceId: '55555555-5555-4555-8555-555555555555',
    expectedRevision: 3,
  };
  const reviewInput = {
    target: 'social',
    workflowId: 'cmr-306-social-workflow',
    approvalId: 'cmr-306-social-approval',
    manifestDigest: 'a'.repeat(64),
    decision: 'approved',
  };

  it('lists sources and records from a target only, without renderer workspace scope', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const sources = electronMocks.handlers.get('customerMarketing:listMarketingWorkflowSources');
    const workflows = electronMocks.handlers.get('customerMarketing:listMarketingWorkflows');

    await expect(sources!(event(), 'social')).resolves.toMatchObject({ ok: true, sources: [] });
    await expect(workflows!(event(), 'social')).resolves.toMatchObject({ ok: true, workflows: [] });
    expect(service.listMarketingWorkflowSources).toHaveBeenCalledWith('social');
    expect(service.listMarketingWorkflows).toHaveBeenCalledWith('social');

    await expect(sources!(event(), { target: 'social', workspaceId: 'renderer-controlled' }))
      .rejects.toThrow('Payload kênh workflow không hợp lệ');
    expect(service.listMarketingWorkflowSources).toHaveBeenCalledTimes(1);
  });

  it('passes exact prepare and review contracts without authority or reviewer identity fields', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const prepare = electronMocks.handlers.get('customerMarketing:prepareMarketingWorkflow');
    const review = electronMocks.handlers.get('customerMarketing:reviewMarketingWorkflow');

    await expect(prepare!(event(), prepareInput)).resolves.toMatchObject({ ok: true, status: 'synced' });
    await expect(review!(event(), reviewInput)).resolves.toMatchObject({ ok: true, status: 'synced' });
    expect(service.prepareMarketingWorkflow).toHaveBeenCalledWith(prepareInput);
    expect(service.reviewMarketingWorkflow).toHaveBeenCalledWith(reviewInput);
  });

  it('rejects workspace, secret, path, contact, and reviewer-hash injection before service execution', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const prepare = electronMocks.handlers.get('customerMarketing:prepareMarketingWorkflow');
    const review = electronMocks.handlers.get('customerMarketing:reviewMarketingWorkflow');

    for (const injected of [
      { workspaceId: 'renderer-controlled' },
      { token: 'renderer-controlled' },
      { path: 'C:\\private' },
      { contactList: ['private@example.com'] },
    ]) {
      await expect(prepare!(event(), { ...prepareInput, ...injected }))
        .rejects.toThrow('Payload tạo dry-run không hợp lệ');
    }
    await expect(review!(event(), { ...reviewInput, reviewerHash: 'b'.repeat(64) }))
      .rejects.toThrow('Payload duyệt dry-run không hợp lệ');
    expect(service.prepareMarketingWorkflow).not.toHaveBeenCalled();
    expect(service.reviewMarketingWorkflow).not.toHaveBeenCalled();
  });

  it('rejects an untrusted sender before parsing or service execution', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const prepare = electronMocks.handlers.get('customerMarketing:prepareMarketingWorkflow');

    await expect(prepare!(event('http://localhost:9999/customer-marketing'), prepareInput))
      .rejects.toThrow('Customer Marketing IPC sender');
    expect(service.prepareMarketingWorkflow).not.toHaveBeenCalled();
  });
});

describe('customer marketing CMR-402 action gate IPC', () => {
  const gateInput = {
    action: 'publish',
    target: 'social',
    workflowId: 'cmr306-social-workflow',
    approvalId: 'cmr306-social-approval',
    manifestDigest: 'a'.repeat(64),
    provider: 'facebook',
    metadata: { itemCount: 1, recipientCount: 0, spendVnd: 0 },
  };

  it('passes only the exact check contract and exposes no execute handler', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const gate = electronMocks.handlers.get('customerMarketing:checkExternalActionGate');

    await expect(gate!(event(), gateInput)).resolves.toEqual({
      allowed: false,
      executed: false,
      denialReason: 'policy_denied',
    });
    expect(service.checkExternalActionGate).toHaveBeenCalledWith(gateInput);
    expect(electronMocks.handlers.has('customerMarketing:executeExternalAction')).toBe(false);
    expect(electronMocks.handlers.has('customerMarketing:publishExternalAction')).toBe(false);
  });

  it.each([
    ['workspaceId', 'renderer-workspace'],
    ['actorId', 'renderer-actor'],
    ['token', 'renderer-token'],
    ['secret', 'renderer-secret'],
    ['path', 'C:\\private'],
    ['contacts', ['private@example.com']],
    ['approvedBy', 'renderer-reviewer'],
  ])('rejects injected %s before service execution', async (key, value) => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const gate = electronMocks.handlers.get('customerMarketing:checkExternalActionGate');

    await expect(gate!(event(), { ...gateInput, [key]: value }))
      .rejects.toThrow('Payload external action gate khong hop le');
    expect(service.checkExternalActionGate).not.toHaveBeenCalled();
  });

  it('rejects an untrusted renderer before gate parsing or service execution', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const gate = electronMocks.handlers.get('customerMarketing:checkExternalActionGate');

    await expect(gate!(event('http://localhost:9999/customer-marketing'), gateInput))
      .rejects.toThrow('Customer Marketing IPC sender');
    expect(service.checkExternalActionGate).not.toHaveBeenCalled();
  });
});

describe('customer marketing CMR-401 credential IPC', () => {
  it('lists status without accepting renderer workspace or secret scope', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const list = electronMocks.handlers.get('customerMarketing:listIntegrationCredentials');

    await expect(list!(event())).resolves.toMatchObject({ ok: true, vaultState: 'ready' });
    expect(service.listIntegrationCredentials).toHaveBeenCalledTimes(1);
    await expect(list!(event(), { workspaceId: 'renderer-controlled' }))
      .rejects.toThrow('Payload credential');
    await expect(list!(event(), { token: 'renderer-controlled' }))
      .rejects.toThrow('Payload credential');
    expect(service.listIntegrationCredentials).toHaveBeenCalledTimes(1);
  });

  it('passes only the allowlisted provider to revoke and rejects token injection', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const revoke = electronMocks.handlers.get('customerMarketing:revokeIntegrationCredential');

    await expect(revoke!(event(), { provider: 'youtube' })).resolves.toMatchObject({
      ok: true,
      provider: 'youtube',
    });
    expect(service.revokeIntegrationCredential).toHaveBeenCalledWith({ provider: 'youtube' });
    await expect(revoke!(event(), { provider: 'youtube', token: 'renderer-controlled' }))
      .rejects.toThrow('Payload thu hồi credential');
    await expect(revoke!(event(), { provider: 'unknown' }))
      .rejects.toThrow('Payload thu hồi credential');
    expect(service.revokeIntegrationCredential).toHaveBeenCalledTimes(1);
  });

  it('rejects an untrusted renderer before credential service execution', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const revoke = electronMocks.handlers.get('customerMarketing:revokeIntegrationCredential');

    await expect(revoke!(event('http://localhost:9999/customer-marketing'), { provider: 'x' }))
      .rejects.toThrow('Customer Marketing IPC sender');
    expect(service.revokeIntegrationCredential).not.toHaveBeenCalled();
  });
});

describe('customer marketing CMR-232 connector operation IPC', () => {
  it('lists redacted receipts without accepting renderer-controlled scope', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const list = electronMocks.handlers.get('customerMarketing:listConnectorOperations');

    await expect(list!(event())).resolves.toMatchObject({ ok: true, revision: 1 });
    for (const payload of [
      { workspaceId: 'renderer-controlled' },
      { revision: 9 },
      { token: 'renderer-token' },
    ]) {
      await expect(list!(event(), payload)).rejects.toThrow('Payload connector operation');
    }
    expect(service.listConnectorOperations).toHaveBeenCalledTimes(1);
  });

  it('passes only the allowlisted provider to local health and rejects injected fields', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const health = electronMocks.handlers.get('customerMarketing:checkIntegrationHealth');

    await expect(health!(event(), { provider: 'telegram' })).resolves.toMatchObject({
      ok: true,
      provider: 'telegram',
      health: 'ready',
    });
    expect(service.checkIntegrationHealth).toHaveBeenCalledWith({ provider: 'telegram' });
    for (const payload of [
      { provider: 'telegram', workspaceId: 'renderer-controlled' },
      { provider: 'telegram', token: 'renderer-token' },
      { provider: 'telegram', chatId: '-1001234567890' },
      { provider: 'telegram', url: 'https://attacker.example' },
      { provider: 'unknown' },
    ]) {
      await expect(health!(event(), payload)).rejects.toThrow('Payload connector health');
    }
    expect(service.checkIntegrationHealth).toHaveBeenCalledTimes(1);
  });

  it('rejects untrusted renderers and exposes no generic connector execution channel', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const list = electronMocks.handlers.get('customerMarketing:listConnectorOperations');
    const health = electronMocks.handlers.get('customerMarketing:checkIntegrationHealth');
    const untrusted = event('https://attacker.example/customer-marketing');

    await expect(list!(untrusted)).rejects.toThrow('Customer Marketing IPC sender');
    await expect(health!(untrusted, { provider: 'x' }))
      .rejects.toThrow('Customer Marketing IPC sender');
    expect(service.listConnectorOperations).not.toHaveBeenCalled();
    expect(service.checkIntegrationHealth).not.toHaveBeenCalled();
    expect(electronMocks.handlers.has('customerMarketing:executeConnector')).toBe(false);
    expect(electronMocks.handlers.has('customerMarketing:executeConnectorOperation')).toBe(false);
  });
});

describe('customer marketing CMR-230 canary readiness IPC', () => {
  it('exposes read-only no-payload readiness status', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const readiness = electronMocks.handlers.get('customerMarketing:getCanaryReadiness');

    await expect(readiness!(event())).resolves.toMatchObject({
      ok: true,
      provider: 'telegram',
      liveReady: false,
      externalActionPerformed: false,
    });
    expect(service.getCanaryReadiness).toHaveBeenCalledTimes(1);
    await expect(readiness!(event(), { token: 'renderer-controlled', chatId: '-1001234567890' }))
      .rejects.toThrow('Payload canary');
    expect(service.getCanaryReadiness).toHaveBeenCalledTimes(1);
  });

  it('rejects an untrusted renderer before readiness service execution', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const readiness = electronMocks.handlers.get('customerMarketing:getCanaryReadiness');

    await expect(readiness!(event('https://attacker.example/customer-marketing')))
      .rejects.toThrow('sender không hợp lệ');
    expect(service.getCanaryReadiness).not.toHaveBeenCalled();
  });
});

describe('customer marketing CMR-230 Telegram setup IPC', () => {
  const input = {
    token: ['123456789', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef_123456'].join(':'),
    privateSandboxChatId: '-1001234567890',
  };

  it('passes only the exact bounded setup payload and returns redacted state', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const configure = electronMocks.handlers.get('customerMarketing:configureTelegramSandbox');

    const result = await configure!(event(), input);
    expect(result).toMatchObject({ ok: true, credentialState: 'connected', externalActionPerformed: false });
    expect(JSON.stringify(result)).not.toContain(input.token);
    expect(JSON.stringify(result)).not.toContain(input.privateSandboxChatId);
    expect(service.configureTelegramSandbox).toHaveBeenCalledWith(input);
    await expect(configure!(event(), { ...input, enabled: true }))
      .rejects.toThrow('Payload Telegram sandbox');
    await expect(configure!(event(), { ...input, workspaceId: 'renderer-controlled' }))
      .rejects.toThrow('Payload Telegram sandbox');
    expect(service.configureTelegramSandbox).toHaveBeenCalledTimes(1);
  });

  it('rejects an untrusted renderer before parsing sensitive setup input', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const configure = electronMocks.handlers.get('customerMarketing:configureTelegramSandbox');

    await expect(configure!(event('https://attacker.example/customer-marketing'), input))
      .rejects.toThrow('sender không hợp lệ');
    expect(service.configureTelegramSandbox).not.toHaveBeenCalled();
  });
});

describe('customer marketing CMR-230 Telegram candidate IPC', () => {
  const input = {
    workflowId: 'cmr306-social-workflow-1',
    manifestDigest: 'a'.repeat(64),
  };

  it('accepts only workflow identity and returns a non-executing candidate', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const prepare = electronMocks.handlers.get('customerMarketing:prepareTelegramCanaryCandidate');

    await expect(prepare!(event(), input)).resolves.toMatchObject({
      ok: true,
      candidate: { resourceDigest: 'b'.repeat(64), externalActionPerformed: false },
      externalActionPerformed: false,
    });
    expect(service.prepareTelegramCanaryCandidate).toHaveBeenCalledWith(input);
    await expect(prepare!(event(), { ...input, text: 'renderer-controlled' }))
      .rejects.toThrow('Payload Telegram canary candidate');
    await expect(prepare!(event(), { ...input, chatId: '-1001234567890' }))
      .rejects.toThrow('Payload Telegram canary candidate');
    expect(service.prepareTelegramCanaryCandidate).toHaveBeenCalledTimes(1);
  });

  it('rejects an untrusted renderer before candidate parsing', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const prepare = electronMocks.handlers.get('customerMarketing:prepareTelegramCanaryCandidate');

    await expect(prepare!(event('https://attacker.example/customer-marketing'), input))
      .rejects.toThrow('sender không hợp lệ');
    expect(service.prepareTelegramCanaryCandidate).not.toHaveBeenCalled();
  });
});

describe('customer marketing CMR-230 Telegram named approval IPC', () => {
  const input = {
    workflowId: 'cmr306-social-workflow-1', manifestDigest: 'a'.repeat(64),
    resourceDigest: 'b'.repeat(64), expectedRevision: 3,
  };

  it('accepts only the exact candidate binding and no reviewer or enablement', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const approve = electronMocks.handlers.get('customerMarketing:approveTelegramCanaryCandidate');

    await expect(approve!(event(), input)).resolves.toMatchObject({
      ok: true, approval: { reviewer: 'Owner A' }, externalActionPerformed: false,
    });
    expect(service.approveTelegramCanaryCandidate).toHaveBeenCalledWith(input);
    await expect(approve!(event(), { ...input, reviewer: 'renderer' })).rejects.toThrow('Payload named approval');
    await expect(approve!(event(), { ...input, enabled: true })).rejects.toThrow('Payload named approval');
    expect(service.approveTelegramCanaryCandidate).toHaveBeenCalledTimes(1);
  });

  it('rejects an untrusted renderer before approval parsing', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const approve = electronMocks.handlers.get('customerMarketing:approveTelegramCanaryCandidate');
    await expect(approve!(event('https://attacker.example/customer-marketing'), input))
      .rejects.toThrow('sender không hợp lệ');
    expect(service.approveTelegramCanaryCandidate).not.toHaveBeenCalled();
  });
});

describe('customer marketing CMR-230 Telegram canary enablement IPC', () => {
  const input = {
    workflowId: 'cmr306-social-workflow-1', manifestDigest: 'a'.repeat(64),
    resourceDigest: 'b'.repeat(64), expectedRevision: 3, expectedStateRevision: 0,
  };

  it('accepts only the exact binding and state revision without executing an external action', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const enable = electronMocks.handlers.get('customerMarketing:enableTelegramCanary');

    await expect(enable!(event(), input)).resolves.toMatchObject({
      ok: true, controlPlane: { enabled: true, stateRevision: 1 },
      receipt: { action: 'enabled', externalActionPerformed: false },
      externalActionPerformed: false,
    });
    expect(service.enableTelegramCanary).toHaveBeenCalledWith(input);
    await expect(enable!(event(), { ...input, reviewer: 'renderer' })).rejects.toThrow('Payload bật Telegram canary');
    await expect(enable!(event(), { ...input, send: true })).rejects.toThrow('Payload bật Telegram canary');
    await expect(enable!(event(), { ...input, expectedStateRevision: -1 })).rejects.toThrow('Payload bật Telegram canary');
    expect(service.enableTelegramCanary).toHaveBeenCalledTimes(1);
  });

  it('rejects an untrusted renderer before enablement parsing', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const enable = electronMocks.handlers.get('customerMarketing:enableTelegramCanary');

    await expect(enable!(event('https://attacker.example/customer-marketing'), input))
      .rejects.toThrow('sender không hợp lệ');
    expect(service.enableTelegramCanary).not.toHaveBeenCalled();
  });
});

describe('customer marketing CMR-230 Telegram canary rollback IPC', () => {
  const input = { expectedStateRevision: 1 };

  it('accepts only the exact state revision and returns a non-sending rollback receipt', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const rollback = electronMocks.handlers.get('customerMarketing:rollbackTelegramCanary');

    await expect(rollback!(event(), input)).resolves.toMatchObject({
      ok: true,
      controlPlane: { enabled: false, stateRevision: 2 },
      receipt: { action: 'rolled_back', reason: 'operator-request', externalActionPerformed: false },
      externalActionPerformed: false,
    });
    expect(service.rollbackTelegramCanary).toHaveBeenCalledWith(input);
    await expect(rollback!(event(), { ...input, reason: 'renderer' })).rejects.toThrow('Payload rollback');
    await expect(rollback!(event(), { ...input, workspaceId: 'renderer' })).rejects.toThrow('Payload rollback');
    await expect(rollback!(event(), { expectedStateRevision: -1 })).rejects.toThrow('Payload rollback');
    expect(service.rollbackTelegramCanary).toHaveBeenCalledTimes(1);
  });

  it('rejects an untrusted renderer before rollback parsing', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const rollback = electronMocks.handlers.get('customerMarketing:rollbackTelegramCanary');

    await expect(rollback!(event('https://attacker.example/customer-marketing'), input))
      .rejects.toThrow('sender không hợp lệ');
    expect(service.rollbackTelegramCanary).not.toHaveBeenCalled();
  });
});

describe('customer marketing CMR-230B Telegram one-shot send IPC', () => {
  const input = {
    workflowId: 'cmr306-social-workflow-1', manifestDigest: 'a'.repeat(64),
    resourceDigest: 'b'.repeat(64), expectedRevision: 3, expectedStateRevision: 1,
  };

  it('forwards exactly the bounded binding once and returns a redacted receipt', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const send = electronMocks.handlers.get('customerMarketing:sendTelegramCanary');

    await expect(send!(event(), input)).resolves.toMatchObject({
      ok: true,
      outcome: 'performed',
      receipt: { attemptId: 'attempt-cmr230b-ipc-1', outcome: 'performed' },
      externalActionPerformed: true,
    });
    expect(service.sendTelegramCanary).toHaveBeenCalledTimes(1);
    expect(service.sendTelegramCanary).toHaveBeenCalledWith(input);
  });

  it.each([
    ['token', '123456:renderer-secret'],
    ['chatId', '-1001234567890'],
    ['text', 'renderer-controlled'],
    ['reviewer', 'renderer'],
    ['confirmed', true],
    ['idempotencyKey', 'renderer-controlled-attempt'],
  ])('rejects renderer-owned %s before service execution', async (key, value) => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const send = electronMocks.handlers.get('customerMarketing:sendTelegramCanary');

    await expect(send!(event(), { ...input, [key]: value }))
      .rejects.toThrow('Payload gửi Telegram canary');
    expect(service.sendTelegramCanary).not.toHaveBeenCalled();
  });

  it('rejects an untrusted renderer before send payload parsing', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const send = electronMocks.handlers.get('customerMarketing:sendTelegramCanary');

    await expect(send!(event('https://attacker.example/customer-marketing'), input))
      .rejects.toThrow('sender không hợp lệ');
    expect(service.sendTelegramCanary).not.toHaveBeenCalled();
  });
});

describe('customer marketing CMR-407 resource audit IPC', () => {
  const input = {
    kind: 'campaign',
    resourceId: '44444444-4444-4444-8444-444444444444',
  };

  it('forwards exactly the kind and resource id, with no renderer workspace scope', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const audit = electronMocks.handlers.get('customerMarketing:listMarketingResourceAudit');
    expect(audit).toBeTypeOf('function');

    await expect(audit!(event(), input)).resolves.toEqual({
      ok: true,
      status: 'synced',
      receipts: [],
    });
    expect(service.listMarketingResourceAudit).toHaveBeenCalledTimes(1);
    expect(service.listMarketingResourceAudit).toHaveBeenCalledWith(input);
  });

  it.each([
    { ...input, workspaceId: '11111111-1111-4111-8111-111111111111' },
    { ...input, token: 'renderer-controlled' },
    { ...input, reviewerHash: 'a'.repeat(64) },
    { ...input, receiptDigest: 'b'.repeat(64) },
    { ...input, limit: 500 },
    { kind: 'asset', resourceId: input.resourceId },
    { kind: 'campaign', resourceId: 'not-a-uuid' },
    { kind: 'campaign' },
    { resourceId: input.resourceId },
    input.resourceId,
    null,
  ])('rejects extended or malformed audit payloads before service execution %#', async (payload) => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const audit = electronMocks.handlers.get('customerMarketing:listMarketingResourceAudit');

    await expect(audit!(event(), payload)).rejects.toThrow('Payload audit marketing');
    expect(service.listMarketingResourceAudit).not.toHaveBeenCalled();
  });

  it('rejects an untrusted renderer before audit payload parsing', async () => {
    const service = serviceMock();
    registerCustomerMarketingIpc(service as unknown as CustomerMarketingService);
    const audit = electronMocks.handlers.get('customerMarketing:listMarketingResourceAudit');

    await expect(audit!(event('https://attacker.example/customer-marketing'), input))
      .rejects.toThrow('sender không hợp lệ');
    expect(service.listMarketingResourceAudit).not.toHaveBeenCalled();
  });
});
