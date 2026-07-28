/**
 * Personal Office OS — domain entities (the unified work model).
 *
 * The 15 glossary entities as minimal, versioned, renderer-agnostic interfaces.
 * Each aggregate root carries `schemaVersion`. No two entities share a meaning
 * (acceptance: "Domain glossary không có hai thực thể trùng nghĩa"):
 *
 *   - WorkspaceBlueprint : the reusable template ("what an office can be").
 *   - WorkspaceInstance  : a provisioned office from a blueprint ("this office").
 *   - WorkRun            : one execution of work toward a goal.
 *   - WorkStep           : one unit inside a run (Step and Task are the SAME thing).
 *   - Artifact           : a durable output of a run.
 *   - Approval           : a human decision gate.
 *   - Checkpoint         : a resumable saved run position.
 *   - ContextSnapshot    : immutable input context captured for a run/step.
 *   - LiveProfile        : the evolving Live.md working state (mutable, latest-wins).
 *   - AgentDefinition    : a declared agent (persona + capabilities), not a runtime.
 *   - SkillPackage       : a distributable bundle of skills (.oab-shaped).
 *   - ToolDefinition     : a single invocable capability with a permission need.
 *   - IntegrationGrant   : a scoped, revocable authorization to act on an integration.
 *   - RuntimeInstance    : a running execution environment (container/process/browser).
 *   - WorkEvent          : see ./events (the run's source of truth).
 *
 * Pure, dependency-free module.
 *
 * @module shared/personal-office/entities
 */

import type {
  AgentDefinitionId,
  ApprovalId,
  ArtifactId,
  CheckpointId,
  ContextSnapshotId,
  IntegrationGrantId,
  LiveProfileId,
  OwnerId,
  RuntimeInstanceId,
  SkillPackageId,
  ToolDefinitionId,
  WorkRunId,
  WorkStepId,
  WorkspaceBlueprintId,
  WorkspaceInstanceId,
} from './ids';
import type { SchemaVersion } from './version';
import type { SecretRef } from './secret-ref';
import type { DataClassification } from './classification';
import type { Plane } from './trust';
import type {
  ApprovalState,
  ProvisioningState,
  RunState,
  WorkspaceState,
} from './state-machine';

/** Common timestamps every aggregate root carries. */
export interface Timestamps {
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** ── WorkspaceBlueprint ─────────────────────────────────────────────────── */
export interface WorkspaceBlueprint extends Timestamps {
  readonly schemaVersion: SchemaVersion;
  readonly id: WorkspaceBlueprintId;
  readonly name: string;
  readonly description: string;
  /** Semver of the blueprint definition itself. */
  readonly blueprintVersion: string;
  /** Agents/skills/tools the office is composed of (by definition id). */
  readonly agentDefinitionIds: readonly AgentDefinitionId[];
  readonly skillPackageIds: readonly SkillPackageId[];
  readonly requiredToolIds: readonly ToolDefinitionId[];
  /** Integrations the blueprint expects (grants requested at provision time). */
  readonly requiredIntegrations: readonly string[];
  /** Blueprint metadata is publishable. */
  readonly classification: Extract<DataClassification, 'public_metadata'>;
}

/** ── WorkspaceInstance ──────────────────────────────────────────────────── */
export interface WorkspaceInstance extends Timestamps {
  readonly schemaVersion: SchemaVersion;
  readonly id: WorkspaceInstanceId;
  readonly blueprintId: WorkspaceBlueprintId;
  readonly ownerId: OwnerId;
  readonly displayName: string;
  readonly state: WorkspaceState;
  /** Bring-up sub-state (see provisioning lifecycle). */
  readonly provisioning: ProvisioningState;
  /** Runtime bound to this office once provisioned. */
  readonly runtimeInstanceId?: RuntimeInstanceId;
}

/** ── WorkRun ────────────────────────────────────────────────────────────── */
export interface WorkRun extends Timestamps {
  readonly schemaVersion: SchemaVersion;
  readonly id: WorkRunId;
  readonly workspaceInstanceId: WorkspaceInstanceId;
  readonly goal: string;
  readonly state: RunState;
  /** Monotonic count of events applied — the run is rebuilt from its WorkEvents. */
  readonly appliedEventSequence: number;
  /** Optional chat session that DROVE the run — reference only, never the source of truth. */
  readonly originChatSessionId?: string;
}

/** ── WorkStep (Step and Task are one concept) ───────────────────────────── */
export type WorkStepStatus = 'todo' | 'in_progress' | 'blocked' | 'done';

export interface WorkStep extends Timestamps {
  readonly schemaVersion: SchemaVersion;
  readonly id: WorkStepId;
  readonly runId: WorkRunId;
  readonly title: string;
  readonly status: WorkStepStatus;
  /** Ordering within the run. */
  readonly ordinal: number;
  /** True when this step is gated by an Approval before it may complete. */
  readonly requiresApproval: boolean;
  /** Agent/tool responsible, by definition id (provenance, not ownership). */
  readonly assigneeAgentId?: AgentDefinitionId;
}

/** ── Artifact ───────────────────────────────────────────────────────────── */
export interface Artifact extends Timestamps {
  readonly schemaVersion: SchemaVersion;
  readonly id: ArtifactId;
  readonly runId: WorkRunId;
  readonly producedByStepId?: WorkStepId;
  readonly name: string;
  readonly mimeType: string;
  /** Content-addressed digest; the bytes stay on the execution plane. */
  readonly sha256: string;
  readonly sizeBytes: number;
  /** Local pointer (path/handle) — never uploaded wholesale. */
  readonly localRef: string;
  readonly classification: Extract<DataClassification, 'artifacts' | 'local_files'>;
}

/** ── Approval ───────────────────────────────────────────────────────────── */
export interface Approval extends Timestamps {
  readonly schemaVersion: SchemaVersion;
  readonly id: ApprovalId;
  readonly runId: WorkRunId;
  readonly stepId?: WorkStepId;
  readonly title: string;
  readonly summary: string;
  readonly risk: 'low' | 'medium' | 'high';
  readonly state: ApprovalState;
  /** Digest of the exact evidence the decision was made against (tamper-evident). */
  readonly evidenceDigest?: string;
  readonly reviewedBy?: OwnerId;
  readonly reviewedAt?: string;
}

/** ── Checkpoint ─────────────────────────────────────────────────────────── */
export interface Checkpoint extends Timestamps {
  readonly schemaVersion: SchemaVersion;
  readonly id: CheckpointId;
  readonly runId: WorkRunId;
  /** Event sequence this checkpoint resumes from. */
  readonly atEventSequence: number;
  /** Snapshot bound to this checkpoint (immutable context at that position). */
  readonly contextSnapshotId: ContextSnapshotId;
  readonly label: string;
}

/** ── ContextSnapshot (immutable) ────────────────────────────────────────── */
export interface ContextSnapshot extends Timestamps {
  readonly schemaVersion: SchemaVersion;
  readonly id: ContextSnapshotId;
  readonly runId: WorkRunId;
  /** Content-addressed digest of the captured context bundle. */
  readonly digest: string;
  /** Ordered refs to the material captured (graph nodes, artifacts, files). */
  readonly sourceRefs: readonly string[];
  readonly classification: DataClassification;
}

/** ── LiveProfile / Live.md (mutable, latest-wins working state) ─────────── */
export interface LiveProfile extends Timestamps {
  readonly schemaVersion: SchemaVersion;
  readonly id: LiveProfileId;
  readonly workspaceInstanceId: WorkspaceInstanceId;
  /** Monotonic revision — latest-wins, distinct from immutable ContextSnapshot. */
  readonly revision: number;
  /** Local pointer to the Live.md document. */
  readonly documentRef: string;
  readonly classification: Extract<DataClassification, 'personal_graph' | 'local_files'>;
}

/** ── AgentDefinition (declaration, not a runtime) ───────────────────────── */
export interface AgentDefinition extends Timestamps {
  readonly schemaVersion: SchemaVersion;
  readonly id: AgentDefinitionId;
  readonly name: string;
  readonly persona: string;
  readonly skillPackageIds: readonly SkillPackageId[];
  readonly toolIds: readonly ToolDefinitionId[];
  /** Provider is a routing hint, NOT an owner of state. */
  readonly preferredProvider?: string;
  readonly classification: Extract<DataClassification, 'public_metadata'>;
}

/** ── SkillPackage (distributable bundle) ────────────────────────────────── */
export interface SkillPackage extends Timestamps {
  readonly schemaVersion: SchemaVersion;
  readonly id: SkillPackageId;
  readonly name: string;
  readonly packageVersion: string;
  /** Permissions the package requests (least privilege; granted per install). */
  readonly requestedPermissions: readonly string[];
  /** Publisher signature digest for trust (verified on the execution plane). */
  readonly signatureDigest?: string;
  readonly classification: Extract<DataClassification, 'public_metadata'>;
}

/** ── ToolDefinition (single invocable capability) ───────────────────────── */
export interface ToolDefinition extends Timestamps {
  readonly schemaVersion: SchemaVersion;
  readonly id: ToolDefinitionId;
  readonly name: string;
  readonly description: string;
  /** The permission this tool needs to run (maps to a grant). */
  readonly requiredPermission: string;
  /** True when invoking this tool performs an external, side-effecting action. */
  readonly hasExternalEffect: boolean;
  readonly classification: Extract<DataClassification, 'public_metadata'>;
}

/** ── IntegrationGrant (scoped, revocable authorization) ─────────────────── */
export interface IntegrationGrant extends Timestamps {
  readonly schemaVersion: SchemaVersion;
  readonly id: IntegrationGrantId;
  readonly workspaceInstanceId: WorkspaceInstanceId;
  readonly integration: string;
  /** Least-privilege scopes this grant authorizes. */
  readonly scopes: readonly string[];
  /** Credential is referenced only — never inlined (design constraint). */
  readonly secret: SecretRef;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
}

/** ── RuntimeInstance (a running execution environment) ──────────────────── */
export type RuntimeKind = 'container' | 'process' | 'browser' | 'inproc';

export interface RuntimeInstance extends Timestamps {
  readonly schemaVersion: SchemaVersion;
  readonly id: RuntimeInstanceId;
  readonly workspaceInstanceId: WorkspaceInstanceId;
  readonly kind: RuntimeKind;
  /** Always the execution plane for a runtime. */
  readonly plane: Extract<Plane, 'execution'>;
  readonly provisioning: ProvisioningState;
  /** For managed local services: the izzi-svc- project name (loopback only). */
  readonly serviceProject?: string;
}
