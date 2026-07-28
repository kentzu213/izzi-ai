/**
 * Personal Office OS — data classification.
 *
 * Six classes govern where data may reside and whether it may leave the local
 * machine. This is the SECURITY GATE artifact for the loop: every entity/field
 * maps to exactly one class, and each class has a fixed residency + egress rule.
 *
 * Pure, dependency-free module. The matrix here is the machine-readable twin of
 * the table in docs/architecture/personal-office-os.md.
 *
 * @module shared/personal-office/classification
 */

/** The plane a piece of data is allowed to be authoritative on. */
export type ResidencyPlane = 'control' | 'execution' | 'either';

/** Whether data of a class may cross the machine boundary to the cloud. */
export type EgressRule =
  | 'egress_allowed' // may sync to control plane freely
  | 'egress_metadata_only' // only non-content metadata may sync
  | 'egress_forbidden'; // must never leave the execution plane

/** The six data classes. */
export type DataClassification =
  | 'public_metadata'
  | 'personal_graph'
  | 'local_files'
  | 'artifacts'
  | 'secrets'
  | 'audit_events';

export interface ClassificationPolicy {
  readonly classification: DataClassification;
  /** Where the authoritative copy lives. */
  readonly residency: ResidencyPlane;
  /** Whether/how it may leave the local machine. */
  readonly egress: EgressRule;
  /** At-rest protection expectation on the execution plane. */
  readonly encryptedAtRest: boolean;
  /** One-line human rationale (kept in sync with the doc matrix). */
  readonly note: string;
}

/**
 * The classification matrix. Frozen so it cannot be mutated at runtime — the
 * policy is a constant, not state.
 */
export const CLASSIFICATION_MATRIX: Readonly<
  Record<DataClassification, ClassificationPolicy>
> = Object.freeze({
  public_metadata: {
    classification: 'public_metadata',
    residency: 'either',
    egress: 'egress_allowed',
    encryptedAtRest: false,
    note: 'Blueprint/package catalog metadata, capability descriptors — non-sensitive, publishable.',
  },
  personal_graph: {
    classification: 'personal_graph',
    residency: 'either',
    egress: 'egress_metadata_only',
    encryptedAtRest: true,
    note: 'User knowledge graph (nodes/links). Content is personal; only structural metadata may sync.',
  },
  local_files: {
    classification: 'local_files',
    residency: 'execution',
    egress: 'egress_forbidden',
    encryptedAtRest: true,
    note: 'Files on the user machine touched by a run. Never uploaded wholesale.',
  },
  artifacts: {
    classification: 'artifacts',
    residency: 'execution',
    egress: 'egress_metadata_only',
    encryptedAtRest: true,
    note: 'Run outputs. The bytes stay local; a digest + descriptor may sync for provenance.',
  },
  secrets: {
    classification: 'secrets',
    residency: 'execution',
    egress: 'egress_forbidden',
    encryptedAtRest: true,
    note: 'Tokens/credentials. Only ever referenced (SecretRef); resolved locally at use time.',
  },
  audit_events: {
    classification: 'audit_events',
    residency: 'either',
    egress: 'egress_metadata_only',
    encryptedAtRest: true,
    note: 'WorkEvent log. Redacted event metadata may sync for audit; payload bodies stay local.',
  },
});

/** Look up the fixed policy for a class. */
export function policyFor(classification: DataClassification): ClassificationPolicy {
  return CLASSIFICATION_MATRIX[classification];
}

/** True when data of this class may never leave the execution plane. */
export function mustStayLocal(classification: DataClassification): boolean {
  return CLASSIFICATION_MATRIX[classification].egress === 'egress_forbidden';
}
