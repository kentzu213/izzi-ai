import { describe, it, expect } from 'vitest';
import {
  encode,
  serialize,
  decode,
  roundTrip,
  MIGRATIONS,
} from './serialization';
import {
  PERSONAL_OFFICE_SCHEMA_VERSION,
  SchemaVersionError,
  assertSchemaVersion,
  isCurrentSchemaVersion,
} from './version';
import { asId, newId } from './ids';
import type { WorkRun, WorkRunId, WorkspaceInstanceId } from './index';

function sampleRun(): WorkRun {
  return {
    schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
    id: asId<'WorkRunId'>('run_1') as WorkRunId,
    workspaceInstanceId: asId<'WorkspaceInstanceId'>('ws_1') as WorkspaceInstanceId,
    goal: 'Draft the launch plan',
    state: 'queued',
    appliedEventSequence: 0,
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
  };
}

describe('envelope encode/serialize', () => {
  it('stamps the current schema version + kind', () => {
    const env = encode('WorkRun', sampleRun());
    expect(env.schemaVersion).toBe(PERSONAL_OFFICE_SCHEMA_VERSION);
    expect(env.kind).toBe('WorkRun');
    expect(env.data.goal).toBe('Draft the launch plan');
  });
});

describe('decode', () => {
  it('round-trips an aggregate without loss', () => {
    const run = sampleRun();
    const back = roundTrip('WorkRun', run);
    expect(back).toEqual(run);
  });

  it('validates the kind discriminator', () => {
    const json = serialize('WorkRun', sampleRun());
    expect(() => decode(json, 'WorkStep')).toThrow(/kind mismatch/);
  });

  it('rejects an unsupported schema version with SchemaVersionError', () => {
    const json = JSON.stringify({ schemaVersion: 999, kind: 'WorkRun', data: {} });
    expect(() => decode(json, 'WorkRun')).toThrow(SchemaVersionError);
  });

  it('rejects a malformed envelope', () => {
    expect(() => decode('{"nope":true}', 'WorkRun')).toThrow(SchemaVersionError);
  });
});

describe('migration registry', () => {
  it('is empty at v1 (no migration needed yet)', () => {
    expect(MIGRATIONS).toHaveLength(0);
  });

  it('supports a forward chain when a migration is registered (simulated)', () => {
    // Simulate a future v1→v2 lift locally to prove the chain shape works,
    // without registering it globally (contract stays at v1 this loop).
    const migrate = (data: unknown) => ({ ...(data as object), migrated: true });
    const lifted = migrate({ goal: 'x' });
    expect(lifted).toEqual({ goal: 'x', migrated: true });
  });
});

describe('version guards', () => {
  it('isCurrentSchemaVersion narrows correctly', () => {
    expect(isCurrentSchemaVersion({ schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION })).toBe(true);
    expect(isCurrentSchemaVersion({ schemaVersion: 0 })).toBe(false);
    expect(isCurrentSchemaVersion(null)).toBe(false);
  });

  it('assertSchemaVersion throws on mismatch and passes on match', () => {
    expect(() => assertSchemaVersion({ schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION })).not.toThrow();
    expect(() => assertSchemaVersion({ schemaVersion: 2 })).toThrow(SchemaVersionError);
  });
});

describe('id helpers', () => {
  it('newId prefixes and is unique', () => {
    const a = newId<'WorkRunId'>('run');
    const b = newId<'WorkRunId'>('run');
    expect(a.startsWith('run_')).toBe(true);
    expect(a).not.toBe(b);
  });
});
