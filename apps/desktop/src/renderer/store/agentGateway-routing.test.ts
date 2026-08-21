import { describe, expect, it } from 'vitest';
import { requiresCustomProviderRoute, shouldUseIzziApiRoute } from './agentGateway-routing';

describe('shouldUseIzziApiRoute', () => {
  it('keeps Izzi-native personas on the managed Izzi API', () => {
    expect(shouldUseIzziApiRoute('izzi', 'custom')).toBe(true);
  });

  it('routes any agent through Izzi when the user selects SmartRouter or a direct Izzi model', () => {
    expect(shouldUseIzziApiRoute('local', 'izzi')).toBe(true);
    expect(shouldUseIzziApiRoute(undefined, 'izzi')).toBe(true);
  });

  it('preserves an explicitly configured direct custom endpoint', () => {
    expect(shouldUseIzziApiRoute('local', 'custom')).toBe(false);
  });
});

describe('requiresCustomProviderRoute', () => {
  it('pins a custom-bound session to the custom endpoint', () => {
    expect(requiresCustomProviderRoute('local', 'custom')).toBe(true);
    expect(requiresCustomProviderRoute(undefined, 'custom')).toBe(true);
  });

  it('leaves Izzi-native personas and non-custom picks on their own routes', () => {
    expect(requiresCustomProviderRoute('izzi', 'custom')).toBe(false);
    expect(requiresCustomProviderRoute('local', 'izzi')).toBe(false);
  });
});
