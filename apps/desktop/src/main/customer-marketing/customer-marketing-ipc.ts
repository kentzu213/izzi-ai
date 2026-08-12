import { dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { isTrustedMarketingSender } from '../marketing/marketing-ipc';
import type {
  CustomerDirectorInput,
  CustomerGoalInput,
  CustomerMarketingSnapshot,
  CustomerMarketingAnalyticsResult,
  CustomerProductMarketingContextMutationResult,
  CustomerProductMarketingContextSaveInput,
  CustomerProductMarketingContextV1,
  CustomerMarketingResourceArchiveResult,
  CustomerMarketingResourceListResult,
  CustomerMarketingResourceMutationResult,
  CustomerMarketingWorkflowListResult,
  CustomerMarketingWorkflowMutationResult,
  CustomerMarketingWorkflowPrepareRequest,
  CustomerMarketingWorkflowReviewRequest,
  CustomerMarketingWorkflowSourceListResult,
  CustomerMediaPreviewInput,
  CustomerMediaVideoPreviewInput,
  CustomerMediaVoicePreviewInput,
  CustomerMediaProjectSelectionResult,
  CustomerMutationResult,
  CustomerOnboardingInput,
  CustomerReviewInput,
  CustomerWorkspaceMemberRoleInput,
  CustomerWorkspaceMembersResult,
  CustomerWorkspaceInvitationInput,
  CustomerWorkspaceInvitationResult,
  CustomerWorkspaceInvitationAcceptanceResult,
  CustomerVoiceStudioRepairResult,
} from '../../shared/customer-marketing-types';
import {
  parseCustomerProductMarketingContextSaveInput,
} from '../../shared/customer-marketing-product-context';
import type { CustomerMarketingService } from './customer-marketing-service';
import type {
  CustomerMarketingCredentialListResult,
  CustomerMarketingCredentialRevokeResult,
} from '../../shared/customer-marketing-credential-types';
import { parseCustomerMarketingCredentialRevokeInput } from '../../shared/customer-marketing-credential-types';
import type { CustomerMarketingCanaryReadinessResult } from '../../shared/customer-marketing-canary-types';
import {
  parseCustomerMarketingPageSpeedInput,
  type CustomerMarketingPageSpeedResult,
} from '../../shared/customer-marketing-pagespeed';
import {
  parseCustomerMarketingActionGateRequest,
  type CustomerMarketingActionGateResult,
} from '../../shared/customer-marketing-action-gate-types';
import {
  parseMarketingCalendarInput,
  parseMarketingAnalyticsWindow,
  parseMarketingResourceArchiveInput,
  parseMarketingResourceCreateInput,
  parseMarketingResourceKind,
  parseMarketingResourceReviewInput,
  parseMarketingResourceUpdateInput,
} from './customer-marketing-workspace-client';
import {
  parseCustomerMarketingWorkflowPrepareRequest,
  parseCustomerMarketingWorkflowReviewRequest,
  parseCustomerMarketingWorkflowTarget,
} from './customer-marketing-workflow-wrappers';

function trusted(event: IpcMainInvokeEvent): void {
  if (!isTrustedMarketingSender(event)) throw new Error('Customer Marketing IPC sender không hợp lệ.');
}

function objectPayload<T>(value: unknown): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Payload customer marketing không hợp lệ.');
  }
  return value as T;
}

function memberRolePayload(value: unknown): CustomerWorkspaceMemberRoleInput {
  const payload = objectPayload<Record<string, unknown>>(value);
  const keys = Object.keys(payload);
  if (
    keys.length !== 2
    || !keys.includes('memberUserId')
    || !keys.includes('role')
    || typeof payload.memberUserId !== 'string'
    || typeof payload.role !== 'string'
  ) {
    throw new Error('Payload cập nhật thành viên không hợp lệ.');
  }
  return {
    memberUserId: payload.memberUserId,
    role: payload.role as CustomerWorkspaceMemberRoleInput['role'],
  };
}

function invitationPayload(value: unknown): CustomerWorkspaceInvitationInput {
  const payload = objectPayload<Record<string, unknown>>(value);
  const keys = Object.keys(payload);
  if (
    keys.length !== 2
    || !keys.includes('email')
    || !keys.includes('role')
    || typeof payload.email !== 'string'
    || typeof payload.role !== 'string'
  ) {
    throw new Error('Payload lời mời không hợp lệ.');
  }
  return {
    email: payload.email,
    role: payload.role as CustomerWorkspaceInvitationInput['role'],
  };
}

function mediaVoicePreviewPayload(value: unknown): CustomerMediaVoicePreviewInput {
  const payload = objectPayload<Record<string, unknown>>(value);
  const keys = Object.keys(payload);
  if (
    keys.length !== 1
    || keys[0] !== 'jobId'
    || typeof payload.jobId !== 'string'
    || payload.jobId.length < 1
    || payload.jobId.length > 120
  ) {
    throw new Error('Payload voice preview không hợp lệ.');
  }
  return { jobId: payload.jobId };
}

function mediaVideoPreviewPayload(value: unknown): CustomerMediaVideoPreviewInput {
  const payload = objectPayload<Record<string, unknown>>(value);
  const keys = Object.keys(payload);
  if (
    keys.length !== 1
    || keys[0] !== 'jobId'
    || typeof payload.jobId !== 'string'
    || payload.jobId.length < 1
    || payload.jobId.length > 120
  ) {
    throw new Error('Payload video preview không hợp lệ.');
  }
  return { jobId: payload.jobId };
}

export interface CustomerMarketingIpcOptions {
  consumeInvitationStatus?: () => CustomerWorkspaceInvitationAcceptanceResult | null;
}

export function registerCustomerMarketingIpc(
  service: CustomerMarketingService,
  options: CustomerMarketingIpcOptions = {},
): void {
  ipcMain.handle('customerMarketing:getSnapshot', async (
    event,
    payload?: unknown,
  ): Promise<CustomerMarketingSnapshot> => {
    trusted(event);
    if (payload !== undefined) throw new Error('Payload snapshot không được phép.');
    return service.getInitialSnapshot();
  });

  ipcMain.handle('customerMarketing:refreshSnapshot', async (
    event,
    payload?: unknown,
  ): Promise<CustomerMarketingSnapshot> => {
    trusted(event);
    if (payload !== undefined) throw new Error('Payload snapshot không được phép.');
    return service.getSnapshot();
  });

  ipcMain.handle('customerMarketing:measurePageSpeed', async (
    event,
    payload: unknown,
  ): Promise<CustomerMarketingPageSpeedResult> => {
    trusted(event);
    const parsed = parseCustomerMarketingPageSpeedInput(payload);
    if (!parsed) throw new Error('Payload PageSpeed không hợp lệ.');
    return service.measurePageSpeed(parsed);
  });

  ipcMain.handle('customerMarketing:getProductMarketingContext', async (
    event,
    payload?: unknown,
  ): Promise<CustomerProductMarketingContextV1 | null> => {
    trusted(event);
    if (payload !== undefined) {
      throw new Error('Payload Product Marketing Context không được phép.');
    }
    return service.getProductMarketingContext();
  });

  ipcMain.handle('customerMarketing:saveProductMarketingContext', async (
    event,
    payload: unknown,
  ): Promise<CustomerProductMarketingContextMutationResult> => {
    trusted(event);
    const parsed = parseCustomerProductMarketingContextSaveInput(payload);
    if (!parsed) throw new Error('Payload Product Marketing Context không hợp lệ.');
    return service.saveProductMarketingContext(parsed);
  });

  ipcMain.handle('customerMarketing:listIntegrationCredentials', async (
    event,
    payload?: unknown,
  ): Promise<CustomerMarketingCredentialListResult> => {
    trusted(event);
    if (payload !== undefined) throw new Error('Payload credential không được phép.');
    return service.listIntegrationCredentials();
  });

  ipcMain.handle('customerMarketing:revokeIntegrationCredential', async (
    event,
    payload: unknown,
  ): Promise<CustomerMarketingCredentialRevokeResult> => {
    trusted(event);
    const parsed = parseCustomerMarketingCredentialRevokeInput(payload);
    if (!parsed) throw new Error('Payload thu hồi credential không hợp lệ.');
    return service.revokeIntegrationCredential(parsed);
  });

  ipcMain.handle('customerMarketing:getCanaryReadiness', async (
    event,
    payload?: unknown,
  ): Promise<CustomerMarketingCanaryReadinessResult> => {
    trusted(event);
    if (payload !== undefined) throw new Error('Payload canary không được phép.');
    return service.getCanaryReadiness();
  });

  ipcMain.handle('customerMarketing:listMarketingResources', async (
    event,
    kind: unknown,
  ): Promise<CustomerMarketingResourceListResult> => {
    trusted(event);
    const parsed = parseMarketingResourceKind(kind);
    if (!parsed) throw new Error('Payload loại tài nguyên marketing không hợp lệ.');
    return service.listMarketingResources(parsed);
  });

  ipcMain.handle('customerMarketing:listMarketingCalendar', async (
    event,
    payload?: unknown,
  ): Promise<CustomerMarketingResourceListResult> => {
    trusted(event);
    if (payload === undefined) return service.listMarketingCalendar();
    const parsed = parseMarketingCalendarInput(payload);
    if (!parsed) throw new Error('Payload lịch marketing không hợp lệ.');
    return service.listMarketingCalendar(parsed);
  });

  ipcMain.handle('customerMarketing:getMarketingAnalytics', async (
    event,
    payload: unknown,
  ): Promise<CustomerMarketingAnalyticsResult> => {
    trusted(event);
    const parsed = parseMarketingAnalyticsWindow(payload);
    if (!parsed) throw new Error('Payload analytics marketing khong hop le.');
    return service.getMarketingAnalytics(parsed);
  });

  ipcMain.handle('customerMarketing:listMarketingWorkflowSources', async (
    event,
    target: unknown,
  ): Promise<CustomerMarketingWorkflowSourceListResult> => {
    trusted(event);
    const parsed = parseCustomerMarketingWorkflowTarget(target);
    if (!parsed) throw new Error('Payload kênh workflow không hợp lệ.');
    return service.listMarketingWorkflowSources(parsed);
  });

  ipcMain.handle('customerMarketing:listMarketingWorkflows', async (
    event,
    target: unknown,
  ): Promise<CustomerMarketingWorkflowListResult> => {
    trusted(event);
    const parsed = parseCustomerMarketingWorkflowTarget(target);
    if (!parsed) throw new Error('Payload kênh workflow không hợp lệ.');
    return service.listMarketingWorkflows(parsed);
  });

  ipcMain.handle('customerMarketing:prepareMarketingWorkflow', async (
    event,
    payload: unknown,
  ): Promise<CustomerMarketingWorkflowMutationResult> => {
    trusted(event);
    const parsed = parseCustomerMarketingWorkflowPrepareRequest(payload);
    if (!parsed) throw new Error('Payload tạo dry-run không hợp lệ.');
    return service.prepareMarketingWorkflow(parsed);
  });

  ipcMain.handle('customerMarketing:reviewMarketingWorkflow', async (
    event,
    payload: unknown,
  ): Promise<CustomerMarketingWorkflowMutationResult> => {
    trusted(event);
    const parsed = parseCustomerMarketingWorkflowReviewRequest(payload);
    if (!parsed) throw new Error('Payload duyệt dry-run không hợp lệ.');
    return service.reviewMarketingWorkflow(parsed);
  });

  ipcMain.handle('customerMarketing:checkExternalActionGate', async (
    event,
    payload: unknown,
  ): Promise<CustomerMarketingActionGateResult> => {
    trusted(event);
    const parsed = parseCustomerMarketingActionGateRequest(payload);
    if (!parsed) throw new Error('Payload external action gate khong hop le.');
    return service.checkExternalActionGate(parsed);
  });

  ipcMain.handle('customerMarketing:createMarketingResource', async (
    event,
    payload: unknown,
  ): Promise<CustomerMarketingResourceMutationResult> => {
    trusted(event);
    const parsed = parseMarketingResourceCreateInput(payload);
    if (!parsed) throw new Error('Payload tài nguyên marketing không hợp lệ.');
    return service.createMarketingResource(parsed);
  });

  ipcMain.handle('customerMarketing:updateMarketingResource', async (
    event,
    payload: unknown,
  ): Promise<CustomerMarketingResourceMutationResult> => {
    trusted(event);
    const parsed = parseMarketingResourceUpdateInput(payload);
    if (!parsed) throw new Error('Payload cập nhật marketing không hợp lệ.');
    return service.updateMarketingResource(parsed);
  });

  ipcMain.handle('customerMarketing:reviewMarketingResource', async (
    event,
    payload: unknown,
  ): Promise<CustomerMarketingResourceMutationResult> => {
    trusted(event);
    const parsed = parseMarketingResourceReviewInput(payload);
    if (!parsed) throw new Error('Payload review marketing không hợp lệ.');
    return service.reviewMarketingResource(parsed);
  });

  ipcMain.handle('customerMarketing:archiveMarketingResource', async (
    event,
    payload: unknown,
  ): Promise<CustomerMarketingResourceArchiveResult> => {
    trusted(event);
    const parsed = parseMarketingResourceArchiveInput(payload);
    if (!parsed) throw new Error('Payload archive marketing không hợp lệ.');
    return service.archiveMarketingResource(parsed);
  });

  ipcMain.handle('customerMarketing:listWorkspaceMembers', async (event): Promise<CustomerWorkspaceMembersResult> => {
    trusted(event);
    return service.listWorkspaceMembers();
  });

  ipcMain.handle('customerMarketing:updateWorkspaceMemberRole', async (event, payload: unknown): Promise<CustomerWorkspaceMembersResult> => {
    trusted(event);
    return service.updateWorkspaceMemberRole(memberRolePayload(payload));
  });

  ipcMain.handle('customerMarketing:createWorkspaceInvitation', async (event, payload: unknown): Promise<CustomerWorkspaceInvitationResult> => {
    trusted(event);
    return service.createWorkspaceInvitation(invitationPayload(payload));
  });

  ipcMain.handle('customerMarketing:retryWorkspaceInvitationCopy', async (event): Promise<CustomerWorkspaceInvitationResult> => {
    trusted(event);
    return service.retryWorkspaceInvitationCopy();
  });

  ipcMain.handle('customerMarketing:consumeWorkspaceInvitationStatus', async (event): Promise<CustomerWorkspaceInvitationAcceptanceResult | null> => {
    trusted(event);
    return options.consumeInvitationStatus?.() ?? null;
  });

  ipcMain.handle('customerMarketing:saveOnboarding', async (event, payload: unknown): Promise<CustomerMutationResult> => {
    trusted(event);
    return service.saveOnboarding(objectPayload<CustomerOnboardingInput>(payload));
  });

  ipcMain.handle('customerMarketing:createGoal', async (event, payload: unknown): Promise<CustomerMutationResult> => {
    trusted(event);
    return service.createGoal(objectPayload<CustomerGoalInput>(payload));
  });

  ipcMain.handle('customerMarketing:askDirector', async (event, payload: unknown): Promise<CustomerMutationResult> => {
    trusted(event);
    return service.askDirector(objectPayload<CustomerDirectorInput>(payload));
  });

  ipcMain.handle('customerMarketing:selectMediaProject', async (event): Promise<CustomerMediaProjectSelectionResult> => {
    trusted(event);
    const selection = await dialog.showOpenDialog({
      title: 'Chọn HyperFrames project đáng tin cậy',
      properties: ['openDirectory'],
    });
    if (selection.canceled || !selection.filePaths[0]) return { canceled: true };
    try {
      return { canceled: false, result: await service.importMediaProject(selection.filePaths[0]) };
    } catch {
      return { canceled: false, error: 'Không import được media project.' };
    }
  });

  ipcMain.handle('customerMarketing:repairVoiceStudio', async (
    event,
    payload?: unknown,
  ): Promise<CustomerVoiceStudioRepairResult> => {
    trusted(event);
    if (payload !== undefined) throw new Error('Payload Voice Studio không được phép.');
    return service.repairVoiceStudio();
  });

  ipcMain.handle('customerMarketing:runMediaPreview', async (event, payload: unknown): Promise<CustomerMutationResult> => {
    trusted(event);
    return service.runMediaPreview(objectPayload<CustomerMediaPreviewInput>(payload));
  });
  ipcMain.handle('customerMarketing:createMediaVoicePreview', async (
    event,
    payload: unknown,
  ): Promise<CustomerMutationResult> => {
    trusted(event);
    return service.createMediaVoicePreview(mediaVoicePreviewPayload(payload));
  });
  ipcMain.handle('customerMarketing:createMediaVideoPreview', async (
    event,
    payload: unknown,
  ): Promise<CustomerMutationResult> => {
    trusted(event);
    return service.createMediaVideoPreview(mediaVideoPreviewPayload(payload));
  });
  ipcMain.handle('customerMarketing:openMediaVideoPreview', async (
    event,
    payload: unknown,
  ): Promise<CustomerMutationResult> => {
    trusted(event);
    return service.openMediaVideoPreview(mediaVideoPreviewPayload(payload));
  });
  ipcMain.handle('customerMarketing:reviewApproval', async (event, payload: unknown): Promise<CustomerMutationResult> => {
    trusted(event);
    return service.reviewApproval(objectPayload<CustomerReviewInput>(payload));
  });
}
