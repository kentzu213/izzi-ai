import { describe, expect, it } from 'vitest';
import type { CustomerCapability, CustomerRole } from '../../shared/customer-marketing-types';
import { resolveCustomerCapabilitySurface } from './customer-capability-actions';

function capability(overrides: Partial<CustomerCapability> = {}): CustomerCapability {
  return {
    id: 'content-studio',
    name: 'Content Studio',
    description: 'Create campaign content.',
    category: 'content',
    role: 'Content Agent',
    source: 'core',
    status: 'available',
    automationModes: ['copilot'],
    requiredIntegrations: [],
    minimumPlan: 'free',
    permission: 'edit',
    stability: 'stable',
    creditEstimate: { minimum: 1, maximum: 3, unit: 'credits_per_run' },
    inputs: ['brief'],
    outputs: ['draft'],
    ...overrides,
  };
}

const OWNER_MAX = { plan: 'max', role: 'owner' } as const;

describe('customer capability action adapter', () => {
  it.each([
    ['ai-marketing-director', 'director', 'Giao mục tiêu'],
    ['strategy-planning', 'director', 'Tạo kế hoạch'],
    ['content-studio', 'content', 'Mở Nội dung & Lịch'],
    ['social-workflows', 'channels', 'Mở Kênh'],
    ['email-workflows', 'channels', 'Mở Kênh'],
    ['crm-workflows', 'channels', 'Mở Kênh'],
    ['approval-center', 'approvals', 'Mở Phê duyệt'],
    ['video-studio', 'video', 'Mở Video Studio'],
  ] as const)('maps %s to its real customer workspace surface', (id, view, label) => {
    expect(resolveCustomerCapabilitySurface(capability({ id }), OWNER_MAX)).toEqual({
      state: 'surface_ready',
      action: { view, label },
    });
  });

  it('opens the real Video Studio setup surface when its runtime is not ready', () => {
    expect(resolveCustomerCapabilitySurface(capability({
      id: 'video-studio',
      status: 'needs_setup',
      minimumPlan: 'pro',
    }), OWNER_MAX)).toEqual({
      state: 'surface_setup',
      action: { view: 'video', label: 'Thiết lập Video Studio' },
    });
  });

  it.each([
    'seo-workspace',
    'creative-studio',
    'analytics-copilot',
    'brand-guardian',
    'automation-builder',
  ] as const)(
    'opens %s in its contextual capability workbench',
    (id) => {
      expect(resolveCustomerCapabilitySurface(capability({ id }), OWNER_MAX)).toMatchObject({
        state: 'surface_ready',
        action: {
          view: 'capability',
          capabilityId: id,
        },
      });
    },
  );

  it('retains the workbench id while the capability needs setup', () => {
    expect(resolveCustomerCapabilitySurface(capability({
      id: 'automation-builder',
      status: 'needs_setup',
    }), OWNER_MAX)).toMatchObject({
      state: 'surface_setup',
      action: {
        view: 'capability',
        capabilityId: 'automation-builder',
      },
    });
  });

  it('rejects an extension that spoofs a core capability id', () => {
    expect(resolveCustomerCapabilitySurface(capability({
      id: 'content-studio',
      source: 'extension',
      extensionId: 'content-studio',
    }), OWNER_MAX)).toEqual({ state: 'surface_catalog_only', action: null });
  });

  it('keeps inherited object keys catalog-only', () => {
    expect(resolveCustomerCapabilitySurface(capability({ id: 'constructor' }), OWNER_MAX)).toEqual({
      state: 'surface_catalog_only',
      action: null,
    });
  });

  it('does not expose an action below the minimum plan', () => {
    expect(resolveCustomerCapabilitySurface(capability({
      id: 'video-studio',
      minimumPlan: 'pro',
    }), { plan: 'starter', role: 'owner' })).toEqual({
      state: 'surface_plan_required',
      action: null,
    });
  });

  it('fails closed for an inherited or unknown workspace plan', () => {
    expect(resolveCustomerCapabilitySurface(capability(), {
      plan: 'constructor',
      role: 'owner',
    })).toEqual({
      state: 'surface_plan_required',
      action: null,
    });
  });

  it('does not expose an action when the local role lacks the public permission', () => {
    expect(resolveCustomerCapabilitySurface(capability({
      id: 'approval-center',
      permission: 'approve',
    }), { plan: 'max', role: 'editor' })).toEqual({
      state: 'surface_permission_required',
      action: null,
    });
  });

  it('fails closed for an inherited or unknown workspace role', () => {
    expect(resolveCustomerCapabilitySurface(capability(), {
      plan: 'max',
      role: 'constructor' as CustomerRole,
    })).toEqual({
      state: 'surface_permission_required',
      action: null,
    });
  });
});
