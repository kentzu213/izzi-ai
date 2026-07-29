import { describe, expect, it } from 'vitest';
import {
  parseWorkspaceBlueprintDescriptor,
} from '../../shared/workspace-blueprint';
import { planWorkspaceBlueprint } from './workspace-blueprint-planner';

describe('main workspace blueprint planner', () => {
  it('returns a plan-only receipt without executing a side effect', () => {
    const digest = `sha256:${'c'.repeat(64)}`;
    const blueprint = parseWorkspaceBlueprintDescriptor({
      schemaVersion: 1,
      descriptorVersion: '1.0.0',
      id: 'blueprint:focus',
      blueprintVersion: '1.0.0',
      name: 'Focus office',
      description: 'Reviewed office descriptor.',
      availability: 'host_verified',
      evidenceDigest: digest,
      apps: [{
        appId: 'app:notes',
        packageId: 'ocx_extension:notes@1.0.0',
        packageVersion: '1.0.0',
        displayName: 'Notes',
        trustZone: 'extension_package',
        dataClassifications: ['local_files'],
        expectedSideEffects: ['local_write'],
      }],
      requiredIntegrationGrants: [],
    }, {
      boundary: 'host_validated',
      expectedEvidenceDigest: digest,
    });

    const plan = planWorkspaceBlueprint(
      blueprint,
      {
        tenantId: 'tenant:izzi',
        userId: 'user:owner',
        workspaceInstanceId: 'workspace:focus',
      },
      '2026-07-29T12:00:00.000Z',
    );

    expect(plan.effect).toBe('plan_only');
    expect(Object.keys(plan)).not.toContain('execute');
    expect(Object.keys(plan)).not.toContain('success');
  });
});
