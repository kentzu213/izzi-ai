// CMR-224 Slice 1 — the trace unit contract.
//
// A trace unit is an append-only observation that keeps a path back to where it
// came from. It is not a summary and never rewrites what happened, so no LLM is
// involved in producing or reading one. That is the whole point: memory
// operations stay deterministic, and every answer built on a trace can cite it.
//
// Relationship to what already exists:
// - `main/infra/memory-system.ts` (MemorySystem) is a mutable key-value store
//   with latest-wins semantics and an optional free-text `source`. It answers
//   "what is currently true". A trace unit answers "what was observed, where,
//   and when". They are different jobs; this contract does not replace it.
// - The live profile (Live.md) is the mutable operator-authored counterpart and
//   is represented here only as one possible trace source.

import {
  isMemoryTraceClassification,
  type MemoryTraceClassification,
} from './classification';

export const MEMORY_TRACE_SCHEMA_VERSION = 1 as const;

export const TRACE_SOURCE_KINDS = [
  'chat_message',
  'agent_run_entry',
  'scheduled_run',
  'approval_receipt',
  'session_log',
  'live_profile',
] as const;

export type TraceSourceKind = (typeof TRACE_SOURCE_KINDS)[number];

export const TRACE_ACTORS = ['user', 'agent', 'tool', 'system'] as const;

export type TraceActor = (typeof TRACE_ACTORS)[number];

/**
 * Where a trace unit came from. Every field is required: a unit without a
 * resolvable origin is not admissible evidence, so it is rejected rather than
 * stored with a gap.
 */
export interface TraceProvenance {
  /** Identifier of the originating row, file revision, or receipt. */
  readonly sourceId: string;
  readonly sourceKind: TraceSourceKind;
  /** Session, run, or workspace scope this unit belongs to. */
  readonly boundaryId: string;
  /** ISO-8601 instant the interaction was observed. */
  readonly observedAt: string;
}

export interface TraceUnit {
  readonly schemaVersion: typeof MEMORY_TRACE_SCHEMA_VERSION;
  readonly id: string;
  readonly text: string;
  readonly actor: TraceActor;
  readonly classification: MemoryTraceClassification;
  readonly provenance: TraceProvenance;
}

const UNIT_KEYS = [
  'schemaVersion',
  'id',
  'text',
  'actor',
  'classification',
  'provenance',
] as const;

const PROVENANCE_KEYS = ['sourceId', 'sourceKind', 'boundaryId', 'observedAt'] as const;

const SOURCE_KINDS = new Set<string>(TRACE_SOURCE_KINDS);
const ACTORS = new Set<string>(TRACE_ACTORS);
const IDENTIFIER_MAX_LENGTH = 256;
const TEXT_MAX_LENGTH = 64_000;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

/**
 * Reads only own enumerable data properties and requires an exact key set, so a
 * crafted object cannot smuggle fields through the prototype chain.
 */
function exactPlainDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> | null {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
  ) return null;

  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.length
    || ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) return null;

  const normalized: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
    normalized[key] = descriptor.value;
  }
  return normalized;
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= IDENTIFIER_MAX_LENGTH
    && value === value.trim()
    && !CONTROL_CHARACTER_PATTERN.test(value);
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 40) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  // Reject loose forms such as "2026-08-05" that Date.parse would still accept,
  // so the recorded instant is unambiguous across time zones.
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value);
}

export function parseTraceProvenance(value: unknown): TraceProvenance | null {
  const record = exactPlainDataRecord(value, PROVENANCE_KEYS);
  if (!record) return null;
  if (
    !isIdentifier(record.sourceId)
    || typeof record.sourceKind !== 'string'
    || !SOURCE_KINDS.has(record.sourceKind)
    || !isIdentifier(record.boundaryId)
    || !isIsoInstant(record.observedAt)
  ) return null;

  return {
    sourceId: record.sourceId,
    sourceKind: record.sourceKind as TraceSourceKind,
    boundaryId: record.boundaryId,
    observedAt: record.observedAt,
  };
}

/**
 * Returns null for anything that is not a complete, well-formed trace unit.
 * Callers treat null as "not admissible", never as "store it anyway".
 */
export function parseTraceUnit(value: unknown): TraceUnit | null {
  const record = exactPlainDataRecord(value, UNIT_KEYS);
  if (!record) return null;

  const provenance = parseTraceProvenance(record.provenance);
  if (!provenance) return null;

  if (
    record.schemaVersion !== MEMORY_TRACE_SCHEMA_VERSION
    || !isIdentifier(record.id)
    || typeof record.text !== 'string'
    || record.text.length === 0
    || record.text.length > TEXT_MAX_LENGTH
    || typeof record.actor !== 'string'
    || !ACTORS.has(record.actor)
    || !isMemoryTraceClassification(record.classification)
  ) return null;

  return {
    schemaVersion: MEMORY_TRACE_SCHEMA_VERSION,
    id: record.id,
    text: record.text,
    actor: record.actor as TraceActor,
    classification: record.classification,
    provenance,
  };
}

/**
 * A stable, content-independent citation for a unit. Used so an answer can point
 * at its evidence without copying the payload around.
 */
export function traceCitation(unit: TraceUnit): string {
  return `${unit.provenance.sourceKind}:${unit.provenance.sourceId}`;
}
