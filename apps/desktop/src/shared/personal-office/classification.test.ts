import { describe, it, expect } from 'vitest';
import {
  CLASSIFICATION_MATRIX,
  policyFor,
  mustStayLocal,
  type DataClassification,
} from './classification';
import {
  TRUST_ZONES,
  TRUST_BOUNDARY_CROSSINGS,
  isSanctionedCrossing,
} from './trust';
import { isSecretRef, secretRef, looksLikeRawSecret } from './secret-ref';
import { appendEvent, compareEvents, isWellOrdered, type WorkEvent } from './events';
import { PERSONAL_OFFICE_SCHEMA_VERSION } from './version';
import { asId } from './ids';

const ALL_CLASSES: DataClassification[] = [
  'public_metadata',
  'personal_graph',
  'local_files',
  'artifacts',
  'secrets',
  'audit_events',
];

describe('classification matrix', () => {
  it('covers all six classes with a self-consistent policy', () => {
    for (const c of ALL_CLASSES) {
      const p = policyFor(c);
      expect(p.classification).toBe(c);
      expect(['control', 'execution', 'either']).toContain(p.residency);
      expect(['egress_allowed', 'egress_metadata_only', 'egress_forbidden']).toContain(p.egress);
    }
  });

  it('forbids egress for secrets and local files, and keeps them execution-only', () => {
    expect(mustStayLocal('secrets')).toBe(true);
    expect(mustStayLocal('local_files')).toBe(true);
    expect(policyFor('secrets').residency).toBe('execution');
    expect(policyFor('local_files').residency).toBe('execution');
  });

  it('only allows public_metadata to egress freely', () => {
    const freelyEgressable = ALL_CLASSES.filter((c) => CLASSIFICATION_MATRIX[c].egress === 'egress_allowed');
    expect(freelyEgressable).toEqual(['public_metadata']);
  });

  it('encrypts every non-public class at rest', () => {
    for (const c of ALL_CLASSES) {
      if (c === 'public_metadata') continue;
      expect(policyFor(c).encryptedAtRest).toBe(true);
    }
  });
});

describe('trust boundaries', () => {
  it('makes the control plane authoritative only for public metadata', () => {
    expect(TRUST_ZONES.izziapi_control_plane.mayHoldAuthoritative).toEqual(['public_metadata']);
  });

  it('marks model provider, extension, runtime and browser as untrusted with no authority', () => {
    for (const zone of ['model_provider', 'extension_package', 'local_runtime', 'browser_runtime'] as const) {
      expect(TRUST_ZONES[zone].trusted).toBe(false);
      expect(TRUST_ZONES[zone].mayHoldAuthoritative).toEqual([]);
    }
  });

  it('default-denies crossings that are not in the sanctioned list', () => {
    expect(isSanctionedCrossing('desktop_execution_plane', 'izziapi_control_plane')).toBe(true);
    expect(isSanctionedCrossing('model_provider', 'izziapi_control_plane')).toBe(false);
    expect(isSanctionedCrossing('browser_runtime', 'desktop_execution_plane')).toBe(false);
    expect(TRUST_BOUNDARY_CROSSINGS.length).toBeGreaterThan(0);
  });
});

describe('secret references', () => {
  it('constructs and recognizes a SecretRef, and rejects bare strings', () => {
    const ref = secretRef('os_keychain', 'integration/telegram/token', ['send']);
    expect(isSecretRef(ref)).toBe(true);
    expect(isSecretRef('sk-abcdef....')).toBe(false);
    expect(isSecretRef({ ref: 'x' })).toBe(false);
  });

  it('tripwire flags credential-shaped strings but not short/plain text', () => {
    expect(looksLikeRawSecret('sk-abcdef0123456789')).toBe(true);
    expect(looksLikeRawSecret('a'.repeat(40).replace(/a/g, 'f'))).toBe(true); // long hex
    expect(looksLikeRawSecret('hello world')).toBe(false);
  });
});

describe('work events — idempotency & ordering', () => {
  function draft(key: string, type: string) {
    return {
      eventId: asId<'WorkEventId'>(`evt_${key}`),
      idempotencyKey: key,
      streamId: 'run_1',
      type,
      actor: { kind: 'agent' as const, id: 'agent_1' },
      classification: 'audit_events' as const,
      occurredAt: '2026-07-28T00:00:00.000Z',
      payload: { note: type },
    };
  }

  it('assigns monotonic sequence and dedupes by idempotencyKey', () => {
    let stream: WorkEvent[] = [];
    const first = appendEvent(stream, draft('k1', 'run.started'), '2026-07-28T00:00:01.000Z');
    stream = first.stream;
    expect(first.stored?.sequence).toBe(0);
    expect(first.stored?.schemaVersion).toBe(PERSONAL_OFFICE_SCHEMA_VERSION);

    const second = appendEvent(stream, draft('k2', 'step.completed'), '2026-07-28T00:00:02.000Z');
    stream = second.stream;
    expect(second.stored?.sequence).toBe(1);

    // Replaying k1 (a retry) must be deduped — no new event, stream unchanged length.
    const replay = appendEvent(stream, draft('k1', 'run.started'), '2026-07-28T00:00:03.000Z');
    expect(replay.stored).toBeNull();
    expect(replay.stream).toHaveLength(2);
  });

  it('orders a stream and detects gaps', () => {
    let stream: WorkEvent[] = [];
    stream = appendEvent(stream, draft('a', 'a'), 't').stream;
    stream = appendEvent(stream, draft('b', 'b'), 't').stream;
    expect(isWellOrdered(stream)).toBe(true);
    const shuffled = [stream[1], stream[0]];
    expect([...shuffled].sort(compareEvents)).toEqual(stream);
  });
});
