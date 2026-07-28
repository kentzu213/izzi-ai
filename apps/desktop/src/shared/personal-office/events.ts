/**
 * Personal Office OS — WorkEvent (the durable event log).
 *
 * Design constraints honored here:
 *   - "Chat không phải source of truth của Run" → the Run's truth is this ordered
 *     event stream, not any chat transcript.
 *   - "Event phải có idempotency/ordering fields" → every event carries a unique
 *     `eventId`, a dedupe `idempotencyKey`, a `streamId`, and a monotonic
 *     `sequence` for total ordering within its stream.
 *
 * Pure, dependency-free module.
 *
 * @module shared/personal-office/events
 */

import type { WorkEventId, WorkRunId } from './ids';
import type { DataClassification } from './classification';
import type { SchemaVersion } from './version';
import { PERSONAL_OFFICE_SCHEMA_VERSION } from './version';

/** Who/what produced an event. Providers/extensions are actors, not owners. */
export type EventActorKind = 'user' | 'agent' | 'extension' | 'system' | 'provider';

export interface EventActor {
  readonly kind: EventActorKind;
  /** Opaque actor id (agentId, extensionId, ...). Never PII. */
  readonly id: string;
}

/**
 * A single append-only fact about a Run (or other stream). Ordering within a
 * stream is by `sequence`; global replay uses (`streamId`, `sequence`).
 */
export interface WorkEvent<TPayload = unknown> {
  readonly schemaVersion: SchemaVersion;
  /** Globally unique id for this event record. */
  readonly eventId: WorkEventId;
  /**
   * Dedupe key: a producer that retries MUST reuse the same key so the log
   * stays exactly-once. Consumers drop a second event with a seen key.
   */
  readonly idempotencyKey: string;
  /** The stream this event belongs to (typically the WorkRunId). */
  readonly streamId: WorkRunId | string;
  /** Monotonic, gap-free-per-stream ordering position (0-based). */
  readonly sequence: number;
  /** Domain event type, e.g. "run.started", "step.completed", "approval.requested". */
  readonly type: string;
  readonly actor: EventActor;
  /** Classification of the payload (drives egress/redaction). */
  readonly classification: DataClassification;
  /** When the fact occurred (producer clock). */
  readonly occurredAt: string;
  /** When it was durably recorded (store clock). */
  readonly recordedAt: string;
  readonly payload: TPayload;
}

/** Fields a producer supplies; the log assigns `sequence` + `recordedAt`. */
export type WorkEventDraft<TPayload = unknown> = Omit<
  WorkEvent<TPayload>,
  'schemaVersion' | 'sequence' | 'recordedAt'
>;

/** Total order comparator for events within (and across) streams. */
export function compareEvents(a: WorkEvent, b: WorkEvent): number {
  if (a.streamId !== b.streamId) return a.streamId < b.streamId ? -1 : 1;
  return a.sequence - b.sequence;
}

/**
 * Append a drafted event to an in-memory stream: assigns the next sequence,
 * stamps `recordedAt` + `schemaVersion`, and drops duplicates by
 * `idempotencyKey`. Returns the (possibly unchanged) stream and the stored
 * event (or `null` when deduped). Pure — takes and returns arrays.
 */
export function appendEvent<TPayload>(
  stream: readonly WorkEvent<TPayload>[],
  draft: WorkEventDraft<TPayload>,
  now: string,
): { stream: WorkEvent<TPayload>[]; stored: WorkEvent<TPayload> | null } {
  if (stream.some((e) => e.idempotencyKey === draft.idempotencyKey)) {
    return { stream: [...stream], stored: null };
  }
  const sequence = stream.reduce((max, e) => Math.max(max, e.sequence), -1) + 1;
  const stored: WorkEvent<TPayload> = {
    ...draft,
    schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
    sequence,
    recordedAt: now,
  };
  return { stream: [...stream, stored], stored };
}

/** True when a stream is gap-free and strictly increasing from 0. */
export function isWellOrdered(stream: readonly WorkEvent[]): boolean {
  const sorted = [...stream].sort((a, b) => a.sequence - b.sequence);
  return sorted.every((e, i) => e.sequence === i);
}
