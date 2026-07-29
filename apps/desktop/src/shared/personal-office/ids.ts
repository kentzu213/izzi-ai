/**
 * Personal Office OS — branded identifier types.
 *
 * Each aggregate has its own nominal id type so a `WorkRunId` can never be
 * silently passed where a `WorkspaceInstanceId` is expected. Branding is
 * compile-time only (zero runtime cost); at runtime an id is a plain string.
 *
 * Pure, dependency-free module.
 *
 * @module shared/personal-office/ids
 */

declare const __brand: unique symbol;

/** Nominal-typing helper: a string tagged with a unique brand `B`. */
export type Branded<B extends string> = string & { readonly [__brand]: B };

export type WorkspaceBlueprintId = Branded<'WorkspaceBlueprintId'>;
export type WorkspaceInstanceId = Branded<'WorkspaceInstanceId'>;
export type WorkRunId = Branded<'WorkRunId'>;
export type WorkStepId = Branded<'WorkStepId'>;
export type ArtifactId = Branded<'ArtifactId'>;
export type ApprovalId = Branded<'ApprovalId'>;
export type WorkEventId = Branded<'WorkEventId'>;
export type CheckpointId = Branded<'CheckpointId'>;
export type ContextSnapshotId = Branded<'ContextSnapshotId'>;
export type LiveProfileId = Branded<'LiveProfileId'>;
export type AgentDefinitionId = Branded<'AgentDefinitionId'>;
export type SkillPackageId = Branded<'SkillPackageId'>;
export type ToolDefinitionId = Branded<'ToolDefinitionId'>;
export type IntegrationGrantId = Branded<'IntegrationGrantId'>;
export type RuntimeInstanceId = Branded<'RuntimeInstanceId'>;

/** Opaque reference to a user/owner (never a PII bundle — just the identity key). */
export type OwnerId = Branded<'OwnerId'>;

/**
 * Cast a raw string to a branded id. Trivial at runtime; the value is trusted to
 * already be a well-formed id (e.g. produced by `newId` or read back from store).
 */
export function asId<B extends string>(raw: string): Branded<B> {
  return raw as Branded<B>;
}

/**
 * Mint a new prefixed id. Uses `crypto.randomUUID` when present (both Electron
 * main and modern renderers expose it), with a non-crypto fallback for older
 * environments so this module stays runnable everywhere.
 */
export function newId<B extends string>(prefix: string): Branded<B> {
  // Access `crypto` structurally so this compiles under any lib target (the main
  // tsconfig ships ES2022 without DOM). Falls back for older environments.
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  const uuid =
    typeof g.crypto?.randomUUID === 'function'
      ? g.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${uuid}` as Branded<B>;
}
