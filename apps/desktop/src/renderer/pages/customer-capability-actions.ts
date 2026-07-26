import type {
  CustomerCapability,
  CustomerCapabilityPermission,
  CustomerMarketingPlan,
  CustomerRole,
} from '../../shared/customer-marketing-types';

export type CustomerCapabilityView =
  | 'director'
  | 'content'
  | 'channels'
  | 'approvals'
  | 'video'
  | 'capability';

export type CustomerCapabilityWorkbenchId =
  | 'creative-studio'
  | 'analytics-copilot'
  | 'brand-guardian'
  | 'automation-builder';

export type CustomerCapabilitySurfaceState =
  | 'surface_ready'
  | 'surface_setup'
  | 'surface_plan_required'
  | 'surface_permission_required'
  | 'surface_catalog_only';

export interface CustomerCapabilityAction {
  view: CustomerCapabilityView;
  label: string;
  capabilityId?: CustomerCapabilityWorkbenchId;
}

export interface CustomerCapabilitySurface {
  state: CustomerCapabilitySurfaceState;
  action: CustomerCapabilityAction | null;
}

interface ActionDefinition extends CustomerCapabilityAction {
  setupLabel?: string;
}

const CORE_ACTIONS: ReadonlyMap<string, ActionDefinition> = new Map([
  ['ai-marketing-director', { view: 'director', label: 'Giao mục tiêu' }],
  ['strategy-planning', { view: 'director', label: 'Tạo kế hoạch' }],
  ['content-studio', { view: 'content', label: 'Mở Nội dung & Lịch' }],
  ['social-workflows', { view: 'channels', label: 'Mở Kênh' }],
  ['seo-workspace', { view: 'channels', label: 'Mở Kênh' }],
  ['email-workflows', { view: 'channels', label: 'Mở Kênh' }],
  ['crm-workflows', { view: 'channels', label: 'Mở Kênh' }],
  ['approval-center', { view: 'approvals', label: 'Mở Phê duyệt' }],
  ['video-studio', {
    view: 'video',
    label: 'Mở Video Studio',
    setupLabel: 'Thiết lập Video Studio',
  }],
  ['creative-studio', {
    view: 'capability',
    capabilityId: 'creative-studio',
    label: 'Mở Creative Studio',
  }],
  ['analytics-copilot', {
    view: 'capability',
    capabilityId: 'analytics-copilot',
    label: 'Mở Analytics Copilot',
  }],
  ['brand-guardian', {
    view: 'capability',
    capabilityId: 'brand-guardian',
    label: 'Mở Brand Guardian',
  }],
  ['automation-builder', {
    view: 'capability',
    capabilityId: 'automation-builder',
    label: 'Mở Automation Builder',
  }],
]);

const PLAN_RANK: ReadonlyMap<CustomerMarketingPlan, number> = new Map([
  ['free', 0],
  ['starter', 1],
  ['pro', 2],
  ['max', 3],
  ['ultra', 4],
]);

const ROLE_PERMISSIONS: ReadonlyMap<
  CustomerRole,
  ReadonlySet<CustomerCapabilityPermission>
> = new Map([
  ['owner', new Set(['view', 'edit', 'execute', 'approve', 'manage'])],
  ['manager', new Set(['view', 'edit', 'execute', 'approve', 'manage'])],
  ['editor', new Set(['view', 'edit', 'execute'])],
  ['reviewer', new Set(['view', 'approve'])],
  ['viewer', new Set(['view'])],
]);

export function customerPlanMeetsMinimum(
  plan: string,
  minimumPlan: CustomerMarketingPlan,
): boolean {
  const planRank = PLAN_RANK.get(plan as CustomerMarketingPlan);
  const minimumPlanRank = PLAN_RANK.get(minimumPlan);
  return planRank !== undefined
    && minimumPlanRank !== undefined
    && planRank >= minimumPlanRank;
}

export function resolveCustomerCapabilitySurface(
  capability: Pick<
    CustomerCapability,
    'id' | 'source' | 'status' | 'minimumPlan' | 'permission'
  >,
  workspace: Pick<CustomerMarketingPlanAccess, 'plan' | 'role'>,
): CustomerCapabilitySurface {
  if (capability.source !== 'core') {
    return { state: 'surface_catalog_only', action: null };
  }

  const definition = CORE_ACTIONS.get(capability.id);
  if (!definition) {
    return { state: 'surface_catalog_only', action: null };
  }

  if (!customerPlanMeetsMinimum(workspace.plan, capability.minimumPlan)) {
    return { state: 'surface_plan_required', action: null };
  }

  const rolePermissions = ROLE_PERMISSIONS.get(workspace.role);
  if (!rolePermissions?.has(capability.permission)) {
    return { state: 'surface_permission_required', action: null };
  }

  const needsSetup = capability.status === 'needs_setup';
  return {
    state: needsSetup ? 'surface_setup' : 'surface_ready',
    action: {
      view: definition.view,
      label: needsSetup && definition.setupLabel ? definition.setupLabel : definition.label,
      ...(definition.capabilityId ? { capabilityId: definition.capabilityId } : {}),
    },
  };
}

interface CustomerMarketingPlanAccess {
  plan: string;
  role: CustomerRole;
}
