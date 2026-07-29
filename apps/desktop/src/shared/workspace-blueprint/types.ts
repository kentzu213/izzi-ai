import type {
  DataClassification,
  TrustZone,
  WorkspaceBlueprintId,
  WorkspaceInstanceId,
} from '../personal-office';

export const WORKSPACE_BLUEPRINT_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_BLUEPRINT_DESCRIPTOR_VERSION = '1.0.0' as const;
export const WORKSPACE_PROVISIONING_PLAN_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_PROVISIONING_PLAN_VERSION = '1.0.0' as const;

export type WorkspaceBlueprintAvailability =
  | 'host_verified'
  | 'demo'
  | 'offline'
  | 'unavailable';

export type WorkspaceBlueprintAppSideEffect =
  | 'external_action'
  | 'local_read'
  | 'local_write'
  | 'network_egress'
  | 'process_execution'
  | 'secret_access'
  | 'ui_mutation';

export type WorkspaceProvisioningExpectedSideEffect =
  | WorkspaceBlueprintAppSideEffect
  | 'workspace_instance_record'
  | 'package_reference'
  | 'integration_grant_reference';

export interface WorkspaceBlueprintAppDescriptor {
  readonly appId: string;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly displayName: string;
  readonly trustZone: TrustZone;
  readonly dataClassifications: readonly DataClassification[];
  readonly expectedSideEffects: readonly WorkspaceBlueprintAppSideEffect[];
}

export interface WorkspaceBlueprintIntegrationGrantRequirement {
  readonly integration: string;
  readonly grantRef: string;
}

export interface WorkspaceBlueprintDescriptor {
  readonly schemaVersion: typeof WORKSPACE_BLUEPRINT_SCHEMA_VERSION;
  readonly descriptorVersion: typeof WORKSPACE_BLUEPRINT_DESCRIPTOR_VERSION;
  readonly id: WorkspaceBlueprintId;
  readonly blueprintVersion: string;
  readonly name: string;
  readonly description: string;
  readonly availability: WorkspaceBlueprintAvailability;
  readonly evidenceDigest?: string;
  readonly apps: readonly WorkspaceBlueprintAppDescriptor[];
  readonly requiredIntegrationGrants:
    readonly WorkspaceBlueprintIntegrationGrantRequirement[];
}

export type WorkspaceBlueprintProvenance =
  | {
      readonly boundary: 'host_validated';
      readonly expectedEvidenceDigest: string;
    }
  | {
      readonly boundary: 'demo' | 'offline' | 'unavailable';
    };

export interface WorkspaceProvisioningScope {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceInstanceId: WorkspaceInstanceId;
}

export interface WorkspaceProvisioningScopeInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceInstanceId: string;
}

export interface WorkspaceProvisioningPlan {
  readonly schemaVersion: typeof WORKSPACE_PROVISIONING_PLAN_SCHEMA_VERSION;
  readonly planVersion: typeof WORKSPACE_PROVISIONING_PLAN_VERSION;
  readonly planId: string;
  readonly plannedAt: string;
  readonly scope: WorkspaceProvisioningScope;
  readonly blueprint: {
    readonly id: WorkspaceBlueprintId;
    readonly version: string;
  };
  readonly requestedApps: readonly string[];
  readonly requestedPackages: readonly string[];
  readonly requiredIntegrationGrantRefs: readonly string[];
  readonly dataClassifications: readonly DataClassification[];
  readonly trustZones: readonly TrustZone[];
  readonly expectedSideEffects: readonly WorkspaceProvisioningExpectedSideEffect[];
  readonly requiresApproval: boolean;
  readonly effect: 'plan_only';
}

export type WorkspaceBlueprintValidationCode =
  | 'AMBIGUOUS_SCOPE'
  | 'INVALID_BLUEPRINT'
  | 'INVALID_PLAN'
  | 'INVALID_VALUE'
  | 'RAW_SECRET'
  | 'UNTRUSTED_METADATA'
  | 'UNKNOWN_FIELD'
  | 'UNSUPPORTED_VERSION';

export interface WorkspaceBlueprintValidationIssue {
  readonly code: WorkspaceBlueprintValidationCode;
  readonly path: string;
  readonly message: string;
}

export class WorkspaceBlueprintValidationError extends Error {
  constructor(readonly issues: readonly WorkspaceBlueprintValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
    this.name = 'WorkspaceBlueprintValidationError';
  }
}
