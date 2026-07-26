import type {
  CustomerAutomationMode,
  CustomerCapabilityCategory,
  CustomerCapabilityPermission,
  CustomerCapabilityStability,
  CustomerMarketingPlan,
} from './customer-marketing-types';

export interface CustomerExtensionCapabilityDefinition {
  id: string;
  category: CustomerCapabilityCategory;
  role: string;
  automationModes: CustomerAutomationMode[];
  requiredIntegrations: string[];
  minimumPlan: CustomerMarketingPlan;
  permission: CustomerCapabilityPermission;
  stability: CustomerCapabilityStability;
  creditEstimate: {
    minimum: number;
    maximum: number;
    unit: 'credits_per_run';
  };
  inputs: string[];
  outputs: string[];
}

const DEFINITION_KEYS = new Set([
  'id',
  'category',
  'role',
  'automationModes',
  'requiredIntegrations',
  'minimumPlan',
  'permission',
  'stability',
  'creditEstimate',
  'inputs',
  'outputs',
]);
const CREDIT_KEYS = new Set(['minimum', 'maximum', 'unit']);
const CAPABILITY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CATEGORIES = new Set<CustomerCapabilityCategory>([
  'strategy',
  'content',
  'social',
  'creative',
  'analytics',
  'automation',
  'research',
  'customer_support',
]);
const AUTOMATION_MODES = new Set<CustomerAutomationMode>([
  'copilot',
  'semi_autonomous',
  'guardrailed_autonomous',
]);
const PLANS = new Set<CustomerMarketingPlan>(['free', 'starter', 'pro', 'max', 'ultra']);
const PERMISSIONS = new Set<CustomerCapabilityPermission>([
  'view',
  'edit',
  'execute',
  'approve',
  'manage',
]);
const STABILITIES = new Set<CustomerCapabilityStability>(['stable', 'beta', 'preview']);
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function parseText(value: unknown, maximumLength: number): string | null {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximumLength
    && value.trim() === value
    && !CONTROL_CHARACTER_PATTERN.test(value)
    ? value
    : null;
}

function parseTextList(
  value: unknown,
  minimumItems: number,
  maximumItems: number,
  maximumLength: number,
): string[] | null {
  if (!Array.isArray(value) || value.length < minimumItems || value.length > maximumItems) {
    return null;
  }
  const parsed = value.map((item) => parseText(item, maximumLength));
  if (parsed.some((item) => item === null)) return null;
  const items = parsed as string[];
  return new Set(items).size === items.length ? items : null;
}

export function parseCustomerExtensionCapabilityDefinition(
  raw: unknown,
): CustomerExtensionCapabilityDefinition | null {
  if (!isRecord(raw) || !hasExactKeys(raw, DEFINITION_KEYS)) return null;

  const id = parseText(raw.id, 64);
  const role = parseText(raw.role, 160);
  const category = raw.category as CustomerCapabilityCategory;
  const minimumPlan = raw.minimumPlan as CustomerMarketingPlan;
  const permission = raw.permission as CustomerCapabilityPermission;
  const stability = raw.stability as CustomerCapabilityStability;
  const automationModes = parseTextList(raw.automationModes, 1, 3, 32);
  const requiredIntegrations = parseTextList(raw.requiredIntegrations, 0, 20, 120);
  const inputs = parseTextList(raw.inputs, 1, 30, 160);
  const outputs = parseTextList(raw.outputs, 1, 30, 160);
  if (
    !id
    || !CAPABILITY_ID_PATTERN.test(id)
    || !role
    || !CATEGORIES.has(category)
    || !PLANS.has(minimumPlan)
    || !PERMISSIONS.has(permission)
    || !STABILITIES.has(stability)
    || !automationModes
    || automationModes.some((mode) => !AUTOMATION_MODES.has(mode as CustomerAutomationMode))
    || !requiredIntegrations
    || !inputs
    || !outputs
  ) return null;

  if (!isRecord(raw.creditEstimate) || !hasExactKeys(raw.creditEstimate, CREDIT_KEYS)) {
    return null;
  }
  const minimum = raw.creditEstimate.minimum;
  const maximum = raw.creditEstimate.maximum;
  if (
    typeof minimum !== 'number'
    || !Number.isFinite(minimum)
    || minimum < 0
    || typeof maximum !== 'number'
    || !Number.isFinite(maximum)
    || maximum < minimum
    || maximum > 1_000_000
    || raw.creditEstimate.unit !== 'credits_per_run'
  ) return null;

  return {
    id,
    category,
    role,
    automationModes: automationModes as CustomerAutomationMode[],
    requiredIntegrations,
    minimumPlan,
    permission,
    stability,
    creditEstimate: { minimum, maximum, unit: 'credits_per_run' },
    inputs,
    outputs,
  };
}
