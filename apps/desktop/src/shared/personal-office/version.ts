/**
 * Personal Office OS — schema versioning.
 *
 * Every aggregate root and every serialized envelope carries a `schemaVersion`
 * so on-disk / on-wire data can be migrated forward without a big-bang rewrite
 * (design constraint: "Schema phải version được", "Có adapter path").
 *
 * Pure, dependency-free module. No renderer, no provider, no legacy-store imports.
 * Importable from BOTH the Electron main process (commonjs) and the React
 * renderer (esnext / bundler / isolatedModules).
 *
 * @module shared/personal-office/version
 */

/** The current Personal Office OS contract version. Bump on any breaking shape change. */
export const PERSONAL_OFFICE_SCHEMA_VERSION = 1 as const;

/** Union of schema versions this build understands (for migration guards). */
export type SchemaVersion = 1;

/** A value tagged with the schema version that produced it. */
export interface Versioned {
  readonly schemaVersion: SchemaVersion;
}

/** True when `value` carries the exact current schema version. */
export function isCurrentSchemaVersion(value: unknown): value is Versioned {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { schemaVersion?: unknown }).schemaVersion === PERSONAL_OFFICE_SCHEMA_VERSION
  );
}

/** Thrown when a payload's schemaVersion is missing or unsupported. */
export class SchemaVersionError extends Error {
  constructor(
    readonly found: unknown,
    readonly expected: SchemaVersion = PERSONAL_OFFICE_SCHEMA_VERSION,
  ) {
    super(`Unsupported Personal Office schemaVersion: found ${String(found)}, expected ${expected}`);
    this.name = 'SchemaVersionError';
  }
}

/**
 * Assert a payload is at the current schema version. Returns the payload
 * narrowed to `Versioned` so callers can proceed, or throws `SchemaVersionError`.
 * This is the single choke point every deserializer routes through.
 */
export function assertSchemaVersion(value: unknown): asserts value is Versioned {
  const version = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version !== PERSONAL_OFFICE_SCHEMA_VERSION) {
    throw new SchemaVersionError(version);
  }
}
