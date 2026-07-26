import { describe, expect, it } from 'vitest';
import {
  parseCustomerExtensionCapabilityDefinition,
  type CustomerExtensionCapabilityDefinition,
} from './customer-marketing-capability-manifest';

function definition(
  overrides: Partial<CustomerExtensionCapabilityDefinition> = {},
): CustomerExtensionCapabilityDefinition {
  return {
    id: 'social-publisher',
    category: 'social',
    role: 'Social Media Agent',
    automationModes: ['copilot', 'semi_autonomous'],
    requiredIntegrations: ['facebook'],
    minimumPlan: 'starter',
    permission: 'execute',
    stability: 'beta',
    creditEstimate: { minimum: 1, maximum: 3, unit: 'credits_per_run' },
    inputs: ['approved_content'],
    outputs: ['publish_preview'],
    ...overrides,
  };
}

describe('parseCustomerExtensionCapabilityDefinition', () => {
  it('accepts and returns the complete public metadata contract', () => {
    expect(parseCustomerExtensionCapabilityDefinition(definition())).toEqual(definition());
  });

  it('rejects extra top-level and nested keys', () => {
    expect(parseCustomerExtensionCapabilityDefinition({
      ...definition(),
      internalPrompt: 'hidden',
    })).toBeNull();
    expect(parseCustomerExtensionCapabilityDefinition({
      ...definition(),
      creditEstimate: {
        ...definition().creditEstimate,
        internalRate: 42,
      },
    })).toBeNull();
  });

  it('rejects invalid ids, duplicate lists, and invalid credit ranges', () => {
    expect(parseCustomerExtensionCapabilityDefinition(
      definition({ id: 'a'.repeat(65) }),
    )).toBeNull();
    expect(parseCustomerExtensionCapabilityDefinition(
      definition({ inputs: ['brief', 'brief'] }),
    )).toBeNull();
    expect(parseCustomerExtensionCapabilityDefinition(
      definition({
        creditEstimate: { minimum: 5, maximum: 4, unit: 'credits_per_run' },
      }),
    )).toBeNull();
  });
});
