/**
 * Personal Office OS — serialization & versioned migration.
 *
 * Every persisted/transported aggregate is wrapped in an `Envelope` carrying the
 * schema version. Decoding routes through `assertSchemaVersion` (single choke
 * point) and an explicit, ordered migration registry — the "adapter path, không
 * big-bang rewrite" the design mandates.
 *
 * Pure, dependency-free module.
 *
 * @module shared/personal-office/serialization
 */

import type { SchemaVersion, Versioned } from './version';
import {
  PERSONAL_OFFICE_SCHEMA_VERSION,
  SchemaVersionError,
  assertSchemaVersion,
} from './version';

/** A versioned wrapper around any aggregate payload. */
export interface Envelope<T> {
  readonly schemaVersion: SchemaVersion;
  /** Discriminator, e.g. "WorkRun" — lets a reader route to the right decoder. */
  readonly kind: string;
  readonly data: T;
}

/** Wrap a payload in a current-version envelope. */
export function encode<T>(kind: string, data: T): Envelope<T> {
  return { schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION, kind, data };
}

/** Serialize an envelope to a JSON string. */
export function serialize<T>(kind: string, data: T): string {
  return JSON.stringify(encode(kind, data));
}

/**
 * A migration lifts a payload from one schema version to the next. Registered in
 * order; `decode` chains them until the payload reaches the current version.
 */
export interface Migration {
  readonly from: number;
  readonly to: number;
  readonly migrate: (data: unknown) => unknown;
}

/**
 * Ordered migration registry. Empty at v1 (nothing to migrate yet). Future loops
 * append `{ from: 1, to: 2, migrate }` here — no reader rewrite required.
 */
export const MIGRATIONS: readonly Migration[] = Object.freeze([]);

/** Apply any registered migrations to bring a raw envelope up to current. */
function upgrade(rawVersion: number, data: unknown): { version: number; data: unknown } {
  let version = rawVersion;
  let current = data;
  // Deterministic forward chain: find the migration whose `from` matches.
  for (;;) {
    if (version === PERSONAL_OFFICE_SCHEMA_VERSION) break;
    const step = MIGRATIONS.find((m) => m.from === version);
    if (!step) break; // no path forward — assertSchemaVersion will reject below
    current = step.migrate(current);
    version = step.to;
  }
  return { version, data: current };
}

/**
 * Decode a serialized envelope: parse → migrate forward → assert current version
 * → return the payload. Throws `SchemaVersionError` when no migration path
 * reaches the current version. `kind` is validated when provided.
 */
export function decode<T>(json: string, expectedKind?: string): T {
  const parsed = JSON.parse(json) as Partial<Envelope<unknown>>;
  if (typeof parsed !== 'object' || parsed === null || typeof parsed.kind !== 'string') {
    throw new SchemaVersionError((parsed as { schemaVersion?: unknown })?.schemaVersion);
  }
  if (expectedKind !== undefined && parsed.kind !== expectedKind) {
    throw new Error(`Envelope kind mismatch: expected "${expectedKind}", got "${parsed.kind}"`);
  }
  const rawVersion = Number((parsed as { schemaVersion?: unknown }).schemaVersion);
  const upgraded = upgrade(rawVersion, parsed.data);
  // Re-wrap so the version guard sees a single, canonical shape.
  const candidate: Versioned & { data: unknown } = {
    schemaVersion: upgraded.version as SchemaVersion,
    data: upgraded.data,
  };
  assertSchemaVersion(candidate);
  return upgraded.data as T;
}

/** Round-trip helper used by tests: encode then decode, asserting identity. */
export function roundTrip<T>(kind: string, data: T): T {
  return decode<T>(serialize(kind, data), kind);
}
