import type {
  IntegrationGrant,
  IntegrationGrantId,
  WorkspaceInstanceId,
} from '../personal-office';

export const INTEGRATION_GRANT_READ_MODEL_SCHEMA_VERSION = 1 as const;
export const INTEGRATION_GRANT_READ_MODEL_VERSION = '1.0.0' as const;

export type IntegrationGrantState =
  | 'active'
  | 'disconnected'
  | 'pending'
  | 'error'
  | 'locked'
  | 'invalid';

export type IntegrationGrantVaultResolution = 'resolvable' | 'missing' | 'unavailable';

export type LegacyIntegrationGrantStatus =
  | 'connected'
  | 'disconnected'
  | 'pending'
  | 'error'
  | 'locked'
  | 'invalid';

export type IntegrationGrantReasonCode =
  | 'active'
  | 'disconnected_absent'
  | 'disconnected_revoked'
  | 'grant_expired'
  | 'grant_invalid'
  | 'grant_missing'
  | 'legacy_status_inconsistent'
  | 'legacy_error_redacted'
  | 'pending_activation'
  | 'vault_locked'
  | 'vault_secret_missing';

export interface IntegrationGrantScope {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceInstanceId: WorkspaceInstanceId;
  readonly grantId: IntegrationGrantId;
  readonly integration: string;
  readonly scopes: readonly string[];
}

export interface IntegrationGrantReadModel {
  readonly schemaVersion: typeof INTEGRATION_GRANT_READ_MODEL_SCHEMA_VERSION;
  readonly modelVersion: typeof INTEGRATION_GRANT_READ_MODEL_VERSION;
  readonly observedAt: string;
  readonly state: IntegrationGrantState;
  readonly reasonCode: IntegrationGrantReasonCode;
  readonly vaultResolution: IntegrationGrantVaultResolution;
  readonly scope: IntegrationGrantScope;
  readonly grant?: IntegrationGrant;
  readonly requestedAt?: string;
  readonly lastErrorAt?: string;
}

export interface LegacyIntegrationGrantEvidence {
  readonly status: LegacyIntegrationGrantStatus;
  readonly observedAt: string;
  readonly scope: IntegrationGrantScope;
  readonly grant?: IntegrationGrant;
  readonly requestedAt?: string;
  readonly lastErrorAt?: string;
  readonly vaultState: 'ready' | 'locked';
  readonly secretResolvable: boolean;
}

export interface IntegrationGrantRevocationPlan {
  readonly schemaVersion: typeof INTEGRATION_GRANT_READ_MODEL_SCHEMA_VERSION;
  readonly planVersion: typeof INTEGRATION_GRANT_READ_MODEL_VERSION;
  readonly planId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly scope: IntegrationGrantScope;
  readonly effect: 'plan_only';
}

export interface IntegrationGrantRevocationResult {
  readonly schemaVersion: typeof INTEGRATION_GRANT_READ_MODEL_SCHEMA_VERSION;
  readonly planId: string;
  readonly status: 'planned' | 'rejected';
  readonly reasonCode: 'revocation_planned' | 'already_disconnected' | 'scope_invalid';
  readonly observedAt: string;
}
