import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_ADAPTER_VERSION,
  CAPABILITY_REGISTRY_SCHEMA_VERSION,
  CapabilityValidationError,
  parseCapabilityManifestEnvelope,
  validateCapabilityPolicy,
  type CapabilityManifestEnvelope,
  type CapabilityPolicy,
} from './index';

function envelope(
  declarations: CapabilityManifestEnvelope['declarations'] = [
    { kind: 'tool', key: 'web', manifestPath: 'agent.tools[0]' },
  ],
): CapabilityManifestEnvelope {
  return {
    schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
    source: {
      kind: 'agent_bundle',
      manifestName: 'research-agent',
      manifestVersion: '1.2.3',
      observedAt: '2026-07-29T08:00:00.000Z',
      adapterVersion: CAPABILITY_ADAPTER_VERSION,
    },
    package: {
      displayName: 'Research Agent',
      description: 'Researches public sources.',
      signatureDigest: `sha256:${'a'.repeat(64)}`,
    },
    declarations,
    unsupportedDeclarations: [],
  };
}

describe('capability manifest envelope contract', () => {
  it('normalizes declaration order and freezes the result', () => {
    const parsed = parseCapabilityManifestEnvelope(envelope([
      { kind: 'tool', key: 'web', manifestPath: 'agent.tools[1]' },
      { kind: 'permission', key: 'ui.panel', manifestPath: 'permissions[0]' },
    ]));

    expect(parsed.declarations.map((declaration) => declaration.key)).toEqual([
      'ui.panel',
      'web',
    ]);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.declarations)).toBe(true);
  });

  it('rejects unknown fields, unsupported versions and duplicates', () => {
    expect(() => parseCapabilityManifestEnvelope({
      ...envelope(),
      ambientAuthority: true,
    })).toThrowError(CapabilityValidationError);

    expect(() => parseCapabilityManifestEnvelope({
      ...envelope(),
      schemaVersion: 2,
    })).toThrow(/expected 1/);

    expect(() => parseCapabilityManifestEnvelope(envelope([
      { kind: 'tool', key: 'web', manifestPath: 'agent.tools[0]' },
      { kind: 'tool', key: 'web', manifestPath: 'agent.tools[1]' },
    ]))).toThrow(/duplicate declaration/);
  });

  it('rejects credential-shaped public metadata', () => {
    expect(() => parseCapabilityManifestEnvelope({
      ...envelope(),
      package: {
        displayName: 'Research Agent',
        description: 'sk-abcdef012345678901234567890123456789',
      },
    })).toThrow(/credential-shaped/);
  });
});

describe('capability policy validation', () => {
  function policy(overrides: Partial<CapabilityPolicy> = {}): CapabilityPolicy {
    return {
      schemaVersion: 1,
      policyVersion: '1.0.0',
      sourceKind: 'agent_bundle',
      declarationKind: 'tool',
      declarationKey: 'web',
      requiredPermission: 'net.http',
      trustZone: 'extension_package',
      dataClassifications: ['public_metadata'],
      sideEffects: ['network_egress'],
      permissionRisk: 'medium',
      description: 'Host-mediated public HTTP.',
      status: 'allowed',
      ...overrides,
    };
  }

  it('accepts exact least-privilege policy', () => {
    expect(() => validateCapabilityPolicy(policy())).not.toThrow();
  });

  it('rejects wildcard authority and trust-zone escalation', () => {
    expect(() => validateCapabilityPolicy(policy({
      requiredPermission: 'net.*',
    }))).toThrow(/non-wildcard/);
    expect(() => validateCapabilityPolicy(policy({
      trustZone: 'desktop_execution_plane' as CapabilityPolicy['trustZone'],
    }))).toThrow(/extension_package/);
  });
});
