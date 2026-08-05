// CMR-224 Slice 1 — data classification for the memory trace layer.
//
// Scope is deliberately narrow: only the classes this slice actually stores.
// It is not a replacement for the redaction helpers already spread across the
// app; widening it is a separate, audited refactor.
//
// The rule that matters: an interaction trace and the live profile never leave
// the machine. Only their redacted metadata may.

export const MEMORY_TRACE_CLASSIFICATIONS = [
  'interaction_trace',
  'live_profile',
  'public_metadata',
  'secret_reference',
] as const;

export type MemoryTraceClassification = (typeof MEMORY_TRACE_CLASSIFICATIONS)[number];

export type EgressRule = 'forbidden' | 'metadata_only' | 'allowed';

export interface ClassificationPolicy {
  /** Where the authoritative copy lives. */
  readonly residency: 'execution' | 'either';
  readonly egress: EgressRule;
  readonly encryptedAtRest: boolean;
}

export const MEMORY_TRACE_CLASSIFICATION_POLICY: Readonly<
  Record<MemoryTraceClassification, ClassificationPolicy>
> = Object.freeze({
  // Raw interaction traces: the source of record. Payload stays local; a
  // redacted metadata index may sync.
  interaction_trace: Object.freeze({
    residency: 'execution',
    egress: 'metadata_only',
    encryptedAtRest: true,
  }),
  // Live.md: what the operator says about themselves and their work. Never
  // leaves the machine, not even as metadata.
  live_profile: Object.freeze({
    residency: 'execution',
    egress: 'forbidden',
    encryptedAtRest: true,
  }),
  // Catalog-shaped descriptors only.
  public_metadata: Object.freeze({
    residency: 'either',
    egress: 'allowed',
    encryptedAtRest: false,
  }),
  // A pointer to a secret, never the secret. Still must not leave.
  secret_reference: Object.freeze({
    residency: 'execution',
    egress: 'forbidden',
    encryptedAtRest: true,
  }),
});

const CLASSIFICATIONS = new Set<string>(MEMORY_TRACE_CLASSIFICATIONS);

export function isMemoryTraceClassification(
  value: unknown,
): value is MemoryTraceClassification {
  return typeof value === 'string' && CLASSIFICATIONS.has(value);
}

/**
 * True when no part of the payload may cross the machine edge. Unknown input
 * returns true: an unclassifiable payload is treated as local-only.
 */
export function mustStayLocal(value: unknown): boolean {
  if (!isMemoryTraceClassification(value)) return true;
  return MEMORY_TRACE_CLASSIFICATION_POLICY[value].egress === 'forbidden';
}

/**
 * True when the full payload may be sent as-is. Unknown input returns false.
 */
export function mayEgressPayload(value: unknown): boolean {
  if (!isMemoryTraceClassification(value)) return false;
  return MEMORY_TRACE_CLASSIFICATION_POLICY[value].egress === 'allowed';
}
