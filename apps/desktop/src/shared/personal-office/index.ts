/**
 * Personal Office OS — shared contracts barrel.
 *
 * The single public entry point for the Personal Office domain contracts. These
 * types + pure helpers are the versioned source of truth for the unified work
 * model, importable from BOTH the Electron main process and the React renderer.
 *
 * PROVISIONAL — pinned to v1.14.0-beta.3 / 84a57b3; requires Loop 00
 * revalidation before integration.
 *
 * Guarantees (see the ADRs under docs/architecture/adr/):
 *   - no renderer, provider, or legacy-store imports;
 *   - secrets only ever appear as SecretRef;
 *   - every aggregate is versioned (schemaVersion);
 *   - re-exports are `export type` where type-only, to satisfy isolatedModules.
 *
 * @module shared/personal-office
 */

// Versioning
export {
  PERSONAL_OFFICE_SCHEMA_VERSION,
  SchemaVersionError,
  assertSchemaVersion,
  isCurrentSchemaVersion,
} from './version';
export type { SchemaVersion, Versioned } from './version';

// Identifiers
export { asId, newId } from './ids';
export type {
  Branded,
  OwnerId,
  AgentDefinitionId,
  ApprovalId,
  ArtifactId,
  CheckpointId,
  ContextSnapshotId,
  IntegrationGrantId,
  LiveProfileId,
  RuntimeInstanceId,
  SkillPackageId,
  ToolDefinitionId,
  WorkEventId,
  WorkRunId,
  WorkStepId,
  WorkspaceBlueprintId,
  WorkspaceInstanceId,
} from './ids';

// Secret references
export { isSecretRef, secretRef, looksLikeRawSecret } from './secret-ref';
export type { SecretRef, SecretStore } from './secret-ref';

// Data classification
export { CLASSIFICATION_MATRIX, policyFor, mustStayLocal } from './classification';
export type {
  DataClassification,
  ClassificationPolicy,
  EgressRule,
  ResidencyPlane,
} from './classification';

// Trust boundaries
export { TRUST_ZONES, TRUST_BOUNDARY_CROSSINGS, isSanctionedCrossing } from './trust';
export type { Plane, TrustZone, TrustZoneSpec, TrustBoundaryCrossing } from './trust';

// State machines
export {
  WORKSPACE_TRANSITIONS,
  PROVISIONING_TRANSITIONS,
  RUN_TRANSITIONS,
  APPROVAL_TRANSITIONS,
  InvalidTransitionError,
  canTransition,
  assertTransition,
  isTerminal,
  canTransitionWorkspace,
  canTransitionProvisioning,
  canTransitionRun,
  canTransitionApproval,
} from './state-machine';
export type {
  WorkspaceState,
  ProvisioningState,
  RunState,
  ApprovalState,
  TransitionTable,
} from './state-machine';

// Events
export { compareEvents, appendEvent, isWellOrdered } from './events';
export type { WorkEvent, WorkEventDraft, EventActor, EventActorKind } from './events';

// Entities
export type {
  Timestamps,
  WorkspaceBlueprint,
  WorkspaceInstance,
  WorkRun,
  WorkStep,
  WorkStepStatus,
  Artifact,
  Approval,
  Checkpoint,
  ContextSnapshot,
  LiveProfile,
  AgentDefinition,
  SkillPackage,
  ToolDefinition,
  IntegrationGrant,
  RuntimeInstance,
  RuntimeKind,
} from './entities';

// Serialization & migration
export { encode, serialize, decode, roundTrip, MIGRATIONS } from './serialization';
export type { Envelope, Migration } from './serialization';
