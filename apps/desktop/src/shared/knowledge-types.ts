/**
 * Selective Knowledge Store shared types — mirrors the Obsidian `project-memory`
 * (`memory_store.py`) quality filter inside Izzi AI App.
 *
 * Every captured item enters as `candidate` with `sensitivity: 'local'` by default.
 * Promotion to `active` requires either explicit user approval in the Review Inbox
 * or verifiable artifact/user-instruction evidence (never agent self-promotion of
 * inferences). Only `active + shareable + fresh + non-conflicting` records may sync
 * to the cloud MyGraph (`user_nodes`).
 *
 * @module shared/knowledge-types
 */

export const KNOWLEDGE_SCOPES = [
  'project',
  'role',
  'user',
  'task',
  'policy-reference',
] as const;
export type KnowledgeScope = (typeof KNOWLEDGE_SCOPES)[number];

export const KNOWLEDGE_KINDS = [
  'fact',
  'decision',
  'preference',
  'procedure',
  'lesson',
  'pitfall',
  'question',
] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export const KNOWLEDGE_SOURCE_TYPES = [
  'user',
  'artifact',
  'test',
  'documentation',
  'inference',
] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export const KNOWLEDGE_EVIDENCE_TYPES = ['direct', 'derived'] as const;
export type KnowledgeEvidenceType = (typeof KNOWLEDGE_EVIDENCE_TYPES)[number];

export const KNOWLEDGE_SENSITIVITIES = ['local', 'shareable'] as const;
export type KnowledgeSensitivity = (typeof KNOWLEDGE_SENSITIVITIES)[number];

export const KNOWLEDGE_RELATION_TYPES = [
  'depends_on',
  'supports',
  'conflicts_with',
  'derived_from',
] as const;
export type KnowledgeRelationType = (typeof KNOWLEDGE_RELATION_TYPES)[number];

export const KNOWLEDGE_STATES = ['candidate', 'active', 'superseded', 'retracted'] as const;
export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];

export interface KnowledgeRelation {
  type: KnowledgeRelationType;
  target: string;
}

export interface KnowledgeSource {
  type: KnowledgeSourceType;
  uri: string;
  sha256?: string;
}

export interface KnowledgeCaptureInput {
  scope: KnowledgeScope;
  workspaceId?: string | null;
  agent?: string | null;
  kind: KnowledgeKind;
  title: string;
  summary: string;
  topicKey: string;
  source: KnowledgeSource;
  author: string;
  evidence: KnowledgeEvidenceType;
  confidence: number;
  sensitivity?: KnowledgeSensitivity;
  reviewAfter?: string;
  relations?: KnowledgeRelation[];
}

export interface KnowledgeRecord {
  id: string;
  digest: string;
  scope: KnowledgeScope;
  workspaceId: string | null;
  agent: string | null;
  kind: KnowledgeKind;
  title: string;
  summary: string;
  topicKey: string;
  source: KnowledgeSource;
  author: string;
  evidence: KnowledgeEvidenceType;
  confidence: number;
  sensitivity: KnowledgeSensitivity;
  reviewAfter: string;
  relations: KnowledgeRelation[];
  state: KnowledgeState;
  sourceCurrent: boolean;
  expired: boolean;
  conflicts: string[];
  cloudNodeId: string | null;
  createdAt: string;
  updatedAt: string;
  promotedAt: string | null;
  reviewer: string | null;
  basis: string | null;
  supersededBy: string | null;
  retractedBy: string | null;
  retractedReason: string | null;
}

export interface KnowledgePromoteInput {
  id: string;
  reviewer: 'user' | 'root' | 'orchestrator';
  basis: 'user_approval' | 'user_instruction' | 'verified_artifact';
  /** Only honored when reviewer === 'user' (explicit user consent for cloud sync). */
  sensitivity?: KnowledgeSensitivity;
}

export interface KnowledgeStats {
  total: number;
  candidate: number;
  active: number;
  shareable: number;
  conflicts: number;
  expired: number;
  events: number;
}
