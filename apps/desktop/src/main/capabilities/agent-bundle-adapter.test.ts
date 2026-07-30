import { describe, expect, it } from 'vitest';
import type { AgentBundleManifest } from '../../../../../packages/agent-bundle/src/manifest';
import {
  AgentBundleCapabilityAdapterError,
  adaptAgentBundleManifestToCapabilityEnvelope,
} from '../../../../../packages/agent-bundle/src/adapters';
import { buildCapabilityRegistry } from './registry';

function manifest(
  overrides: Partial<AgentBundleManifest> = {},
): AgentBundleManifest {
  return {
    name: 'research-agent',
    version: '1.0.0',
    displayName: 'Research Agent',
    description: 'Researches public sources.',
    icon: 'assets/icon.png',
    category: 'productivity',
    author: { name: 'Starizzi Team' },
    agent: {
      soul: 'SOUL.md',
      skills: ['research'],
      tools: ['web'],
      provider: { default: 'izziapi', model: 'smart-router' },
    },
    automation: { cronJobs: [], workflows: [], triggers: [] },
    connections: { platforms: [], apis: [], webhooks: [] },
    setup: {
      steps: [{
        id: 'ready',
        title: 'Ready',
        description: 'No setup required.',
        type: 'info',
      }],
      requiredSecrets: [],
      optionalConfig: [],
    },
    marketplace: { pricing: 'free', screenshots: ['assets/screenshot.png'] },
    requirements: {
      openclawVersion: '>=1.14.0',
      hermesVersion: '>=1.0.0',
    },
    ...overrides,
  };
}

describe('.oab capability adapter', () => {
  it('emits deterministic tool declarations accepted by the registry', () => {
    const envelope = adaptAgentBundleManifestToCapabilityEnvelope(manifest(), {
      observedAt: '2026-07-29T08:00:00.000Z',
    });
    expect(envelope.declarations).toEqual([{
      kind: 'tool',
      key: 'web',
      manifestPath: 'agent.tools[0]',
    }]);
    expect(buildCapabilityRegistry([envelope]).packages[0]?.skillPackage)
      .toMatchObject({ requestedPermissions: ['net.http'] });
  });

  it('rejects duplicate tools and blocks broad terminal authority', () => {
    expect(() => adaptAgentBundleManifestToCapabilityEnvelope(manifest({
      agent: {
        ...manifest().agent,
        tools: ['web', 'web'],
      },
    }), {
      observedAt: '2026-07-29T08:00:00.000Z',
    })).toThrowError(AgentBundleCapabilityAdapterError);

    const terminal = adaptAgentBundleManifestToCapabilityEnvelope(manifest({
      agent: {
        ...manifest().agent,
        tools: ['terminal'],
      },
    }), {
      observedAt: '2026-07-29T08:00:00.000Z',
    });
    expect(() => buildCapabilityRegistry([terminal])).toThrow(/lacks command, path and environment scopes/);
  });

  it('retains automation and integration needs as fail-closed unsupported declarations', () => {
    const envelope = adaptAgentBundleManifestToCapabilityEnvelope(manifest({
      automation: {
        cronJobs: [{
          name: 'daily',
          schedule: '0 9 * * *',
          skills: ['research'],
          prompt: 'Research updates',
          enabled: true,
        }],
        workflows: [],
        triggers: [],
      },
      connections: {
        platforms: [{
          platform: 'slack',
          required: true,
          description: 'Post updates',
          scopes: ['chat:write'],
        }],
        apis: [],
        webhooks: [],
      },
    }), {
      observedAt: '2026-07-29T08:00:00.000Z',
    });

    expect(envelope.unsupportedDeclarations).toHaveLength(2);
    expect(() => buildCapabilityRegistry([envelope])).toThrow(/unsupported capability declarations/);
  });
});
