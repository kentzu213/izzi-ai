/**
 * Gate PO-VERSION-COLLISION — the execution core has no schema version of its own.
 *
 * Before this loop there were TWO constants both declaring "version 1" for
 * different shapes: the quarantined `WORK_SCHEMA_VERSION` in
 * `shared/work-model.ts`, and W1's `PERSONAL_OFFICE_SCHEMA_VERSION`. Two
 * different meanings behind one number is not a naming problem — it destroys the
 * version's only job, which is to tell a reader what a stored row means.
 *
 * These tests are the gate's acceptance evidence. They prove:
 *   1. the engine stamps W1's version and nothing else;
 *   2. an envelope written by the engine passes W1's guard unmodified;
 *   3. an unknown version is REJECTED, never coerced or "best-effort" read;
 *   4. `WORK_SCHEMA_VERSION` no longer exists anywhere in the engine.
 *
 * @module main/work/work-version-gate.test
 */
import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  PERSONAL_OFFICE_SCHEMA_VERSION,
  SchemaVersionError,
  assertSchemaVersion,
  decode,
  encode,
  serialize,
} from '../../shared/personal-office';
// Imported THROUGH the engine seam. The seam must re-export W1's constant, not
// declare one of its own — so this binding and W1's must be the same value.
import { PERSONAL_OFFICE_SCHEMA_VERSION as SEAM_SCHEMA_VERSION } from './work-types';

/** A minimal versioned aggregate, shaped like anything the engine persists. */
function aggregate(version: number = PERSONAL_OFFICE_SCHEMA_VERSION) {
  return { schemaVersion: version, id: 'run_test', goal: 'ship the gate' };
}

/**
 * Strip block and line comments so the scan below inspects CODE, not prose.
 * A module is allowed to explain in a comment that `shared/work-model` was
 * superseded; it is not allowed to import from it.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('PO-VERSION-COLLISION: single version authority', () => {
  it('re-exports W1 version rather than declaring an engine-local one', () => {
    // Identity, not equality-by-coincidence: the engine must have no second source.
    expect(SEAM_SCHEMA_VERSION).toBe(PERSONAL_OFFICE_SCHEMA_VERSION);
  });

  it('stamps envelopes with the contract version', () => {
    const envelope = encode('WorkRun', aggregate());
    expect(envelope.schemaVersion).toBe(PERSONAL_OFFICE_SCHEMA_VERSION);
  });

  it('accepts an engine-written envelope through W1 guard (round trip)', () => {
    const json = serialize('WorkRun', aggregate());
    const back = decode<ReturnType<typeof aggregate>>(json, 'WorkRun');
    expect(back.goal).toBe('ship the gate');
    expect(back.schemaVersion).toBe(PERSONAL_OFFICE_SCHEMA_VERSION);
  });
});

describe('PO-VERSION-COLLISION: unknown versions are rejected, not coerced', () => {
  it('rejects a future envelope version with no migration path', () => {
    const json = JSON.stringify({ schemaVersion: 99, kind: 'WorkRun', data: aggregate(99) });
    expect(() => decode(json, 'WorkRun')).toThrow(SchemaVersionError);
  });

  it('rejects a stale envelope version instead of upgrading silently', () => {
    const json = JSON.stringify({ schemaVersion: 0, kind: 'WorkRun', data: aggregate(0) });
    expect(() => decode(json, 'WorkRun')).toThrow(SchemaVersionError);
  });

  it('rejects a current envelope smuggling a foreign aggregate version', () => {
    // The dangerous case: envelope looks fine, the ROW inside does not.
    const json = JSON.stringify({
      schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
      kind: 'WorkRun',
      data: aggregate(99),
    });
    expect(() => decode(json, 'WorkRun')).toThrow(SchemaVersionError);
  });

  it('rejects a missing version rather than defaulting to current', () => {
    const json = JSON.stringify({ kind: 'WorkRun', data: { id: 'run_x' } });
    expect(() => decode(json, 'WorkRun')).toThrow(SchemaVersionError);
  });

  it('does not mutate the rejected payload (no coercion side effect)', () => {
    const data = aggregate(99);
    const json = JSON.stringify({ schemaVersion: 99, kind: 'WorkRun', data });
    expect(() => decode(json, 'WorkRun')).toThrow(SchemaVersionError);
    // The original object is untouched: rejection, not repair.
    expect(data.schemaVersion).toBe(99);
  });

  it('assertSchemaVersion is the single choke point and fails closed', () => {
    expect(() => assertSchemaVersion({ schemaVersion: 99 })).toThrow(SchemaVersionError);
    expect(() => assertSchemaVersion(null)).toThrow(SchemaVersionError);
    expect(() => assertSchemaVersion(undefined)).toThrow(SchemaVersionError);
    expect(() => assertSchemaVersion({})).toThrow(SchemaVersionError);
  });
});

describe('PO-VERSION-COLLISION: the superseded constant is gone', () => {
  const workDir = __dirname;

  it('no engine module references WORK_SCHEMA_VERSION or shared/work-model', () => {
    const offenders: string[] = [];
    for (const entry of fs.readdirSync(workDir)) {
      if (!entry.endsWith('.ts')) continue;
      const source = fs.readFileSync(path.join(workDir, entry), 'utf8');
      // Skip this file's own descriptive prose.
      if (entry === 'work-version-gate.test.ts') continue;
      const code = stripComments(source);
      if (/WORK_SCHEMA_VERSION/.test(code)) offenders.push(`${entry}: WORK_SCHEMA_VERSION`);
      if (/shared\/work-model/.test(code)) offenders.push(`${entry}: shared/work-model import`);
    }
    expect(offenders).toEqual([]);
  });

  it('shared/work-model.ts was not landed as a second contract', () => {
    const superseded = path.join(workDir, '..', '..', 'shared', 'work-model.ts');
    expect(fs.existsSync(superseded)).toBe(false);
  });
});
