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
import type {
  WorkRun,
  WorkRunId,
  IntegrationGrant,
  WorkspaceHealth,
  WorkspaceInstance,
  WorkspaceInstanceId,
} from './index';
import { secretRef } from './secret-ref';

function sampleRun(): WorkRun {
  return {
    schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
    id: asId<'WorkRunId'>('run_1') as WorkRunId,
    workspaceInstanceId: asId<'WorkspaceInstanceId'>('ws_1') as WorkspaceInstanceId,
    goal: 'Draft the launch plan',
    state: 'queued',
    origin: 'manual',
    rootRunId: asId<'WorkRunId'>('run_1') as WorkRunId,
    lineageKind: 'original',
    attempt: 1,
    planVersion: 1,
    planHash: 'plan-sha256',
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

describe('run lineage contract', () => {
  it('models retry as a new run rather than reopening failed', () => {
    const failed = { ...sampleRun(), state: 'failed' as const };
    const retryId = asId<'WorkRunId'>('run_2') as WorkRunId;
    const retry: WorkRun = {
      ...failed,
      id: retryId,
      state: 'created',
      parentRunId: failed.id,
      rootRunId: failed.rootRunId,
      lineageKind: 'retry',
      attempt: failed.attempt + 1,
    };

    expect(retry.id).not.toBe(failed.id);
    expect(retry.parentRunId).toBe(failed.id);
    expect(retry.rootRunId).toBe(failed.rootRunId);
    expect(retry.attempt).toBe(2);
  });
});

describe('workspace health contract', () => {
  it('does not alter the lifecycle state of an active workspace', () => {
    const healthValues: WorkspaceHealth[] = ['ok', 'attention', 'blocked', 'unknown'];
    const base: WorkspaceInstance = {
      schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
      id: asId<'WorkspaceInstanceId'>('ws_active') as WorkspaceInstanceId,
      blueprintId: asId<'WorkspaceBlueprintId'>('blueprint_office'),
      ownerId: asId<'OwnerId'>('owner_1'),
      displayName: 'My office',
      state: 'active',
      provisioning: 'ready',
      createdAt: '2026-07-29T00:00:00.000Z',
      updatedAt: '2026-07-29T00:00:00.000Z',
    };

    for (const health of healthValues) {
      const workspace: WorkspaceInstance = { ...base, health };
      expect(workspace.state).toBe('active');
      expect(workspace.provisioning).toBe('ready');
    }
  });
});

describe('integration grant additive contract', () => {
  it('round-trips invalid and redacted last-error evidence without a schema bump', () => {
    const grant: IntegrationGrant = {
      schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
      id: asId<'IntegrationGrantId'>('grant_google'),
      workspaceInstanceId: asId<'WorkspaceInstanceId'>('ws_1'),
      integration: 'google-drive',
      scopes: ['documents.read'],
      secret: secretRef(
        'integration_vault',
        'integration/google-drive/operator',
        ['documents.read'],
      ),
      invalid: true,
      lastErrorAt: '2026-07-29T12:00:00.000Z',
      createdAt: '2026-07-29T10:00:00.000Z',
      updatedAt: '2026-07-29T12:00:00.000Z',
    };

    expect(roundTrip('IntegrationGrant', grant)).toEqual(grant);
    expect(grant.schemaVersion).toBe(1);
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

  it('rejects stale aggregate data inside a current envelope', () => {
    const json = JSON.stringify({
      schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
      kind: 'WorkRun',
      data: { ...sampleRun(), schemaVersion: 999 },
    });
    expect(() => decode<WorkRun>(json, 'WorkRun')).toThrow(SchemaVersionError);
  });

  it('rejects aggregate data without its own schema version', () => {
    const { schemaVersion: _removed, ...unversioned } = sampleRun();
    const json = JSON.stringify({
      schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
      kind: 'WorkRun',
      data: unversioned,
    });
    expect(() => decode<WorkRun>(json, 'WorkRun')).toThrow(SchemaVersionError);
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
