import { describe, expect, it } from 'vitest';
import {
  WorkspaceBlueprintValidationError,
  createWorkspaceProvisioningPlan,
  parseWorkspaceBlueprintDescriptor,
  parseWorkspaceProvisioningPlan,
} from '.';
import { trustedBlueprintInput } from './workspace-blueprint.test';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const SCOPE = {
  tenantId: 'tenant:izzi',
  userId: 'user:owner',
  workspaceInstanceId: 'workspace:personal',
};

function trustedBlueprint() {
  return parseWorkspaceBlueprintDescriptor(
    trustedBlueprintInput(),
    { boundary: 'host_validated', expectedEvidenceDigest: DIGEST },
  );
}

describe('workspace provisioning plan', () => {
  it('is deterministic, exact-scoped and derives review fields', () => {
    const blueprint = trustedBlueprint();
    const first = createWorkspaceProvisioningPlan(
      blueprint,
      SCOPE,
      '2026-07-29T12:00:00.000Z',
    );
    const second = createWorkspaceProvisioningPlan(
      blueprint,
      SCOPE,
      '2026-07-29T12:00:00.000Z',
    );

    expect(first).toEqual(second);
    expect(first.effect).toBe('plan_only');
    expect(first.scope).toEqual(SCOPE);
    expect(first.blueprint).toEqual({
      id: blueprint.id,
      version: blueprint.blueprintVersion,
    });
    expect(first.requestedApps).toEqual(['app:documents']);
    expect(first.requestedPackages).toEqual(['ocx_extension:documents@1.2.0']);
    expect(first.requiredIntegrationGrantRefs).toEqual([
      'integration-grant:google-drive',
    ]);
    expect(first.dataClassifications).toEqual(['artifacts', 'local_files']);
    expect(first.trustZones).toEqual(['extension_package']);
    expect(first.expectedSideEffects).toEqual([
      'integration_grant_reference',
      'local_write',
      'package_reference',
      'workspace_instance_record',
    ]);
    expect(first.requiresApproval).toBe(true);
  });

  it('rejects ambiguous scope and untrusted availability', () => {
    expect(() => createWorkspaceProvisioningPlan(
      trustedBlueprint(),
      { ...SCOPE, tenantId: '*' },
      '2026-07-29T12:00:00.000Z',
    )).toThrow(/non-wildcard/);

    const demo = parseWorkspaceBlueprintDescriptor(
      {
        ...trustedBlueprintInput(),
        availability: 'demo',
        evidenceDigest: undefined,
      },
      { boundary: 'demo' },
    );
    expect(() => createWorkspaceProvisioningPlan(
      demo,
      SCOPE,
      '2026-07-29T12:00:00.000Z',
    )).toThrow(/host-verified/);
  });

  it('rejects execution, persistence, grant, activation and success fields', () => {
    const blueprint = trustedBlueprint();
    const plan = createWorkspaceProvisioningPlan(
      blueprint,
      SCOPE,
      '2026-07-29T12:00:00.000Z',
    );

    for (const field of [
      'command',
      'environment',
      'downloadUrl',
      'execute',
      'grant',
      'activated',
      'persistedState',
      'provisioned',
      'success',
    ]) {
      expect(() => parseWorkspaceProvisioningPlan(
        { ...plan, [field]: true },
        blueprint,
      )).toThrow(/not supported/);
    }
  });

  it('rejects serialized tampering by re-deriving identity and authority', () => {
    const blueprint = trustedBlueprint();
    const plan = createWorkspaceProvisioningPlan(
      blueprint,
      SCOPE,
      '2026-07-29T12:00:00.000Z',
    );
    const mutations = [
      { planId: `${plan.planId}:tampered` },
      { requestedApps: [] },
      { requestedPackages: ['ocx_extension:other@1.0.0'] },
      { requiredIntegrationGrantRefs: [] },
      { dataClassifications: ['public_metadata'] },
      { trustZones: ['browser_runtime'] },
      { expectedSideEffects: [] },
      { requiresApproval: false },
      { effect: 'executed' },
      { blueprint: { ...plan.blueprint, version: '2.2.0' } },
    ];

    for (const mutation of mutations) {
      expect(() => parseWorkspaceProvisioningPlan(
        { ...plan, ...mutation },
        blueprint,
      )).toThrowError(WorkspaceBlueprintValidationError);
    }
  });
});
