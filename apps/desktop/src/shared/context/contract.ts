import { LIVE_CONTEXT_PRECEDENCE, type LiveProfileScope } from '../live-profile';
import {
  PERSONAL_OFFICE_SCHEMA_VERSION,
  type DataClassification,
  type SecretRef,
} from '../personal-office';

export const PERSONAL_OFFICE_CONTEXT_ARTIFACT_KIND = 'personal-office-context' as const;
export const PERSONAL_OFFICE_CONTEXT_HASH_PREFIX = 'sha256:' as const;
export const PERSONAL_OFFICE_CONTEXT_SEGMENT_START =
  '<<<START_PERSONAL_OFFICE_CONTEXT>>>' as const;
export const PERSONAL_OFFICE_CONTEXT_SEGMENT_END =
  '<<<END_PERSONAL_OFFICE_CONTEXT>>>' as const;
export const PERSONAL_OFFICE_CONTEXT_LIMITS = Object.freeze({
  maxSources: 256,
  maxSourceBytes: 32 * 1024,
  maxRenderedItems: 128,
  maxPackageItems: 130,
  maxDecisions: 1024,
  minBytes: 512,
  maxBytes: 128 * 1024,
});

export type ContextLayer = (typeof LIVE_CONTEXT_PRECEDENCE)[number];
export type ContextMessageRole = 'system' | 'user';
export type ContextSystemLayer = Exclude<
  ContextLayer,
  'safety-system' | 'current-user-request'
>;
export type ContextSourceLayer =
  | 'safety-system'
  | 'current-user-request'
  | 'workspace-policy'
  | 'model-default';

export interface ContextBudget {
  readonly maxItems: number;
  readonly maxBytes: number;
}

export interface ContextProvenance {
  readonly sourceType:
    | 'base-system'
    | 'current-request'
    | 'workspace-policy'
    | 'live-profile'
    | 'model-default';
  readonly sourceId: string;
  readonly sourceRef?: string;
  readonly authoredBy?: string;
  readonly revision?: number;
}

export interface ContextSourceInput {
  readonly id: string;
  readonly layer: ContextSourceLayer;
  readonly role: ContextMessageRole;
  readonly scope: LiveProfileScope;
  readonly classification: DataClassification;
  readonly content: string;
  readonly provenance: ContextProvenance;
  readonly expiresAt?: string;
  readonly secretRefs?: readonly SecretRef[];
}

export interface CompileWorkspaceContextInput {
  readonly schemaVersion: typeof PERSONAL_OFFICE_SCHEMA_VERSION;
  readonly scope: LiveProfileScope;
  readonly compiledAt: string;
  readonly budget: ContextBudget;
  readonly sources: readonly ContextSourceInput[];
  readonly liveProfile?: unknown;
}

export interface CompiledContextItem {
  readonly id: string;
  readonly layer: ContextLayer;
  readonly role: ContextMessageRole;
  readonly scope: LiveProfileScope;
  readonly classification: DataClassification;
  readonly contentHash: string;
  readonly content?: string;
  readonly provenance: ContextProvenance;
  readonly expiresAt?: string;
  readonly secretRefs: readonly SecretRef[];
  readonly redactions: readonly string[];
  readonly renderedInSystemSegment: boolean;
}

export type ContextDecisionStatus =
  | 'included'
  | 'expired'
  | 'not-effective'
  | 'item-budget'
  | 'byte-budget';

export interface ContextCompileDecision {
  readonly id: string;
  readonly layer: ContextLayer;
  readonly status: ContextDecisionStatus;
  readonly expiresAt?: string;
}

export interface ContextBudgetResult extends ContextBudget {
  readonly usedItems: number;
  readonly usedBytes: number;
  readonly truncatedItemIds: readonly string[];
}

export interface UnsignedCompiledWorkspaceContext {
  readonly schemaVersion: typeof PERSONAL_OFFICE_SCHEMA_VERSION;
  readonly artifactKind: typeof PERSONAL_OFFICE_CONTEXT_ARTIFACT_KIND;
  readonly scope: LiveProfileScope;
  readonly compiledAt: string;
  readonly precedence: readonly ContextLayer[];
  readonly items: readonly CompiledContextItem[];
  readonly decisions: readonly ContextCompileDecision[];
  readonly budget: ContextBudgetResult;
  readonly systemSegment: string;
}

export interface CompiledWorkspaceContext extends UnsignedCompiledWorkspaceContext {
  readonly contentHash: string;
}

export interface ContextKernelInput {
  readonly scope: LiveProfileScope;
  readonly compiled: CompiledWorkspaceContext;
}
