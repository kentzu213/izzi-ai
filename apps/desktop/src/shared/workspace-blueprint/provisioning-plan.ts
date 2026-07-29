import {
  canonicalJson,
  type DataClassification,
  type TrustZone,
} from '../personal-office';
import {
  WORKSPACE_PROVISIONING_PLAN_SCHEMA_VERSION,
  WORKSPACE_PROVISIONING_PLAN_VERSION,
  WorkspaceBlueprintValidationError,
  type WorkspaceBlueprintDescriptor,
  type WorkspaceBlueprintProvenance,
  type WorkspaceProvisioningExpectedSideEffect,
  type WorkspaceProvisioningPlan,
  type WorkspaceProvisioningScope,
  type WorkspaceProvisioningScopeInput,
} from './types';
import {
  assertExactDerived,
  exactIso,
  parseClassificationArray,
  parseExactStringArray,
  parsePlanRecord,
  parsePlanText,
  parseTrustZoneArray,
  parseWorkspaceBlueprintDescriptor,
  parseWorkspaceProvisioningScope,
} from './validation';

const SIDE_EFFECTS: readonly WorkspaceProvisioningExpectedSideEffect[] = [
  'external_action',
  'integration_grant_reference',
  'local_read',
  'local_write',
  'network_egress',
  'package_reference',
  'process_execution',
  'secret_access',
  'ui_mutation',
  'workspace_instance_record',
];
const APPROVAL_EFFECTS = new Set<WorkspaceProvisioningExpectedSideEffect>([
  'external_action',
  'integration_grant_reference',
  'local_write',
  'network_egress',
  'process_execution',
  'secret_access',
  'workspace_instance_record',
]);

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort()) as readonly T[];
}

function derived(blueprint: WorkspaceBlueprintDescriptor) {
  const requestedApps = uniqueSorted(blueprint.apps.map((app) => app.appId));
  const requestedPackages = uniqueSorted(blueprint.apps.map((app) => app.packageId));
  const requiredIntegrationGrantRefs = uniqueSorted(
    blueprint.requiredIntegrationGrants.map((grant) => grant.grantRef),
  );
  const dataClassifications = uniqueSorted(
    blueprint.apps.flatMap((app) => app.dataClassifications),
  ) as readonly DataClassification[];
  const trustZones = uniqueSorted(
    blueprint.apps.map((app) => app.trustZone),
  ) as readonly TrustZone[];
  const expectedSideEffects = uniqueSorted([
    'workspace_instance_record',
    ...(requestedPackages.length > 0 ? ['package_reference' as const] : []),
    ...(requiredIntegrationGrantRefs.length > 0
      ? ['integration_grant_reference' as const]
      : []),
    ...blueprint.apps.flatMap((app) => app.expectedSideEffects),
  ]) as readonly WorkspaceProvisioningExpectedSideEffect[];
  return {
    requestedApps,
    requestedPackages,
    requiredIntegrationGrantRefs,
    dataClassifications,
    trustZones,
    expectedSideEffects,
    requiresApproval: expectedSideEffects.some((effect) => APPROVAL_EFFECTS.has(effect)),
  };
}

function encoded(value: string): string {
  return encodeURIComponent(value);
}

export function workspaceProvisioningPlanId(
  blueprint: WorkspaceBlueprintDescriptor,
  scope: WorkspaceProvisioningScope,
): string {
  const material = derived(blueprint);
  return `workspace-provision-plan:${WORKSPACE_PROVISIONING_PLAN_VERSION}:${encoded(
    canonicalJson({
      blueprintId: blueprint.id,
      blueprintVersion: blueprint.blueprintVersion,
      dataClassifications: material.dataClassifications,
      evidenceDigest: blueprint.evidenceDigest,
      expectedSideEffects: material.expectedSideEffects,
      requestedApps: material.requestedApps,
      requestedPackages: material.requestedPackages,
      requiredIntegrationGrantRefs: material.requiredIntegrationGrantRefs,
      requiresApproval: material.requiresApproval,
      scope,
      trustZones: material.trustZones,
    }),
  )}`;
}

function ensureTrusted(blueprint: WorkspaceBlueprintDescriptor): void {
  if (blueprint.availability !== 'host_verified' || !blueprint.evidenceDigest) {
    throw new WorkspaceBlueprintValidationError([{
      code: 'UNTRUSTED_METADATA',
      path: 'blueprint.availability',
      message: 'only a host-verified blueprint can create a provisioning plan',
    }]);
  }
}

export function createWorkspaceProvisioningPlan(
  blueprintInput: unknown,
  provenance: WorkspaceBlueprintProvenance,
  scopeInput: WorkspaceProvisioningScopeInput,
  plannedAt: string,
): WorkspaceProvisioningPlan {
  const blueprint = parseWorkspaceBlueprintDescriptor(blueprintInput, provenance);
  ensureTrusted(blueprint);
  const scope = parseWorkspaceProvisioningScope(scopeInput);
  const values = derived(blueprint);
  return parseWorkspaceProvisioningPlan({
    schemaVersion: WORKSPACE_PROVISIONING_PLAN_SCHEMA_VERSION,
    planVersion: WORKSPACE_PROVISIONING_PLAN_VERSION,
    planId: workspaceProvisioningPlanId(blueprint, scope),
    plannedAt,
    scope,
    blueprint: {
      id: blueprint.id,
      version: blueprint.blueprintVersion,
    },
    ...values,
    effect: 'plan_only',
  }, blueprint, provenance);
}

export function parseWorkspaceProvisioningPlan(
  value: unknown,
  blueprintInput: unknown,
  provenance: WorkspaceBlueprintProvenance,
): WorkspaceProvisioningPlan {
  const blueprint = parseWorkspaceBlueprintDescriptor(blueprintInput, provenance);
  ensureTrusted(blueprint);
  const plan = parsePlanRecord(value);
  if (plan.schemaVersion !== WORKSPACE_PROVISIONING_PLAN_SCHEMA_VERSION) {
    throw new WorkspaceBlueprintValidationError([{
      code: 'UNSUPPORTED_VERSION',
      path: 'plan.schemaVersion',
      message: `expected ${WORKSPACE_PROVISIONING_PLAN_SCHEMA_VERSION}`,
    }]);
  }
  if (plan.planVersion !== WORKSPACE_PROVISIONING_PLAN_VERSION) {
    throw new WorkspaceBlueprintValidationError([{
      code: 'UNSUPPORTED_VERSION',
      path: 'plan.planVersion',
      message: `expected ${WORKSPACE_PROVISIONING_PLAN_VERSION}`,
    }]);
  }
  if (plan.effect !== 'plan_only') {
    throw new WorkspaceBlueprintValidationError([{
      code: 'INVALID_PLAN',
      path: 'plan.effect',
      message: 'must remain plan_only',
    }]);
  }
  const scope = parseWorkspaceProvisioningScope(plan.scope, 'plan.scope');
  const blueprintBinding = plan.blueprint;
  if (typeof blueprintBinding !== 'object' || blueprintBinding === null || Array.isArray(blueprintBinding)) {
    throw new WorkspaceBlueprintValidationError([{
      code: 'INVALID_VALUE',
      path: 'plan.blueprint',
      message: 'must be an exact blueprint binding',
    }]);
  }
  const binding = blueprintBinding as Record<string, unknown>;
  const keys = Object.keys(binding).sort();
  if (keys.length !== 2 || keys[0] !== 'id' || keys[1] !== 'version') {
    throw new WorkspaceBlueprintValidationError([{
      code: 'UNKNOWN_FIELD',
      path: 'plan.blueprint',
      message: 'must contain only id and version',
    }]);
  }
  const blueprintId = parsePlanText(binding.id, 'plan.blueprint.id', 256);
  const blueprintVersion = parsePlanText(binding.version, 'plan.blueprint.version', 64);
  if (blueprintId !== blueprint.id || blueprintVersion !== blueprint.blueprintVersion) {
    throw new WorkspaceBlueprintValidationError([{
      code: 'INVALID_PLAN',
      path: 'plan.blueprint',
      message: 'does not match the reviewed blueprint identity',
    }]);
  }
  const expected = derived(blueprint);
  const requestedApps = parseExactStringArray(plan.requestedApps, 'plan.requestedApps');
  const requestedPackages = parseExactStringArray(plan.requestedPackages, 'plan.requestedPackages');
  const grantRefs = parseExactStringArray(
    plan.requiredIntegrationGrantRefs,
    'plan.requiredIntegrationGrantRefs',
  );
  const classifications = parseClassificationArray(
    plan.dataClassifications,
    'plan.dataClassifications',
  );
  const trustZones = parseTrustZoneArray(plan.trustZones, 'plan.trustZones');
  const expectedSideEffects = parseExactStringArray(
    plan.expectedSideEffects,
    'plan.expectedSideEffects',
  ) as readonly WorkspaceProvisioningExpectedSideEffect[];
  if (expectedSideEffects.some((effect) => !SIDE_EFFECTS.includes(effect))) {
    throw new WorkspaceBlueprintValidationError([{
      code: 'INVALID_VALUE',
      path: 'plan.expectedSideEffects',
      message: 'contains an unsupported side effect',
    }]);
  }
  assertExactDerived(requestedApps, expected.requestedApps, 'plan.requestedApps');
  assertExactDerived(requestedPackages, expected.requestedPackages, 'plan.requestedPackages');
  assertExactDerived(grantRefs, expected.requiredIntegrationGrantRefs, 'plan.requiredIntegrationGrantRefs');
  assertExactDerived(classifications, expected.dataClassifications, 'plan.dataClassifications');
  assertExactDerived(trustZones, expected.trustZones, 'plan.trustZones');
  assertExactDerived(expectedSideEffects, expected.expectedSideEffects, 'plan.expectedSideEffects');
  if (plan.requiresApproval !== expected.requiresApproval) {
    throw new WorkspaceBlueprintValidationError([{
      code: 'INVALID_PLAN',
      path: 'plan.requiresApproval',
      message: 'must match the reviewed expected side effects',
    }]);
  }
  const planId = parsePlanText(plan.planId, 'plan.planId', 65_536);
  if (planId !== workspaceProvisioningPlanId(blueprint, scope)) {
    throw new WorkspaceBlueprintValidationError([{
      code: 'INVALID_PLAN',
      path: 'plan.planId',
      message: 'must bind exact blueprint and scope',
    }]);
  }
  return Object.freeze({
    schemaVersion: WORKSPACE_PROVISIONING_PLAN_SCHEMA_VERSION,
    planVersion: WORKSPACE_PROVISIONING_PLAN_VERSION,
    planId,
    plannedAt: exactIso(plan.plannedAt, 'plan.plannedAt'),
    scope,
    blueprint: Object.freeze({ id: blueprint.id, version: blueprint.blueprintVersion }),
    requestedApps,
    requestedPackages,
    requiredIntegrationGrantRefs: grantRefs,
    dataClassifications: classifications,
    trustZones,
    expectedSideEffects,
    requiresApproval: expected.requiresApproval,
    effect: 'plan_only',
  });
}
