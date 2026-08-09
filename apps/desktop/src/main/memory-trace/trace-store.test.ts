// CMR-224 Slice 3 — trace persistence.
//
// These tests run against a real SQLite engine built by the app's own schema, so
// the CHECK constraint and the ordering are exercised rather than mocked. The
// keychain is faked, because a unit test must be able to say "encryption is
// unavailable" without touching the OS.
//
// The engine here is Node's built-in `node:sqlite`, not the app's better-sqlite3:
// that native binding is compiled against Electron's ABI and cannot load under
// the Node that runs vitest. Same SQL, same constraints, no rebuild.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type Database from 'better-sqlite3';

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => { throw new Error('not available in unit tests'); },
    decryptString: () => { throw new Error('not available in unit tests'); },
  },
}));

import { ensureSqliteSchema } from '../db/sqlite-schema';
import { TraceStore, type TraceEncryption, type TraceRowStore } from './trace-store';
import type { MemoryTraceUnitRow } from './trace-record';
import { MEMORY_TRACE_SCHEMA_VERSION } from '../../shared/memory-trace/trace-unit';

/** A fake keychain: reversible, obviously not real encryption, and switchable. */
function fakeEncryption(available = true): TraceEncryption & { available: boolean } {
  return {
    available,
    isEncryptionAvailable() { return this.available; },
    encryptString(value: string) { return Buffer.from(`sealed:${value}`, 'utf8'); },
    decryptString(value: Buffer) {
      const raw = value.toString('utf8');
      if (!raw.startsWith('sealed:')) throw new Error('not our ciphertext');
      return raw.slice('sealed:'.length);
    },
  };
}

let db: DatabaseSync;
let rows: TraceRowStore;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  // The schema helper is typed for better-sqlite3; the two APIs agree on the
  // methods it actually uses (`exec`, `prepare().all()`).
  ensureSqliteSchema(db as unknown as Database.Database);
  rows = {
    insertMemoryTraceUnit(row: MemoryTraceUnitRow) {
      const result = db
        .prepare(
          `INSERT INTO memory_trace_units (
             id, schema_version, actor, classification, text_plain, text_cipher,
             source_id, source_kind, boundary_id, observed_at, recorded_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
        )
        .run(
          row.id, row.schema_version, row.actor, row.classification,
          row.text_plain, row.text_cipher, row.source_id, row.source_kind,
          row.boundary_id, row.observed_at, row.recorded_at,
        );
      return result.changes > 0 ? 'stored' : 'duplicate';
    },
    listMemoryTraceUnits(boundaryId: string, limit = 200) {
      return db
        .prepare(
          `SELECT id, schema_version, actor, classification, text_plain, text_cipher,
                  source_id, source_kind, boundary_id, observed_at, recorded_at
           FROM memory_trace_units
           WHERE boundary_id = ?
           ORDER BY observed_at ASC, id ASC
           LIMIT ?`,
        )
        .all(boundaryId, limit) as MemoryTraceUnitRow[];
    },
    countMemoryTraceUnits(boundaryId: string) {
      const row = db
        .prepare('SELECT COUNT(*) AS count FROM memory_trace_units WHERE boundary_id = ?')
        .get(boundaryId) as { count: number } | undefined;
      return row?.count ?? 0;
    },
  };
});

afterEach(() => {
  db.close();
});

function unit(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: MEMORY_TRACE_SCHEMA_VERSION,
    id: 'chat:m-1',
    text: 'Tôi muốn báo cáo ngắn.',
    actor: 'user',
    classification: 'public_metadata',
    provenance: {
      sourceId: 'm-1',
      sourceKind: 'chat_message',
      boundaryId: 'session-1',
      observedAt: '2026-08-05T10:00:00.000Z',
    },
    ...overrides,
  };
}

describe('TraceStore.append', () => {
  it('stores an admissible unit and reads it back unchanged', () => {
    const store = new TraceStore(rows, fakeEncryption());

    expect(store.append(unit())).toBe('stored');

    const result = store.list('session-1');
    expect(result.unreadable).toBe(0);
    expect(result.units).toHaveLength(1);
    expect(result.units[0]).toEqual({
      schemaVersion: MEMORY_TRACE_SCHEMA_VERSION,
      id: 'chat:m-1',
      text: 'Tôi muốn báo cáo ngắn.',
      actor: 'user',
      classification: 'public_metadata',
      provenance: {
        sourceId: 'm-1',
        sourceKind: 'chat_message',
        boundaryId: 'session-1',
        observedAt: '2026-08-05T10:00:00.000Z',
      },
    });
  });

  it('treats a repeated id as a duplicate instead of overwriting', () => {
    const store = new TraceStore(rows, fakeEncryption());
    store.append(unit());

    expect(store.append(unit({ text: 'rewritten by a later run' }))).toBe('duplicate');

    const result = store.list('session-1');
    expect(result.units).toHaveLength(1);
    expect(result.units[0].text).toBe('Tôi muốn báo cáo ngắn.');
  });

  it('rejects anything that is not a complete unit', () => {
    const store = new TraceStore(rows, fakeEncryption());

    const candidates = [
      null,
      'a string',
      unit({ provenance: undefined }),
      unit({ actor: 'stranger' }),
      unit({ classification: 'made_up' }),
      unit({ text: '' }),
      unit({ provenance: { sourceId: 'm', sourceKind: 'chat_message', boundaryId: 'b', observedAt: '2026-08-05' } }),
    ];

    for (const candidate of candidates) {
      expect(store.append(candidate)).toBe('rejected');
    }
    expect(store.count('session-1')).toBe(0);
  });

  it('does not let a crafted object smuggle fields through the prototype chain', () => {
    const store = new TraceStore(rows, fakeEncryption());
    const hostile = JSON.parse(
      '{"__proto__":{"classification":"public_metadata"},"schemaVersion":1,"id":"x","text":"t","actor":"user","provenance":{"sourceId":"s","sourceKind":"chat_message","boundaryId":"b","observedAt":"2026-08-05T10:00:00.000Z"}}',
    );

    expect(store.append(hostile)).toBe('rejected');
    expect(store.count('b')).toBe(0);
  });

  it('orders reads by when the interaction happened, with a stable tie-break', () => {
    const store = new TraceStore(rows, fakeEncryption());
    store.append(unit({ id: 'c', provenance: { ...unit().provenance, observedAt: '2026-08-05T12:00:00.000Z' } }));
    store.append(unit({ id: 'a', provenance: { ...unit().provenance, observedAt: '2026-08-05T11:00:00.000Z' } }));
    store.append(unit({ id: 'b', provenance: { ...unit().provenance, observedAt: '2026-08-05T11:00:00.000Z' } }));

    expect(store.list('session-1').units.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps boundaries apart', () => {
    const store = new TraceStore(rows, fakeEncryption());
    store.append(unit({ id: 'in-1' }));
    store.append(unit({ id: 'out-1', provenance: { ...unit().provenance, boundaryId: 'session-2' } }));

    expect(store.count('session-1')).toBe(1);
    expect(store.count('session-2')).toBe(1);
    expect(store.list('session-1').units.map((entry) => entry.id)).toEqual(['in-1']);
  });

  it('tallies a batch by outcome', () => {
    const store = new TraceStore(rows, fakeEncryption());

    const tally = store.appendMany([unit({ id: 'k-1' }), unit({ id: 'k-1' }), 'nonsense']);

    expect(tally).toEqual({ stored: 1, duplicate: 1, rejected: 1, encryption_unavailable: 0 });
  });
});

describe('TraceStore encryption at rest', () => {
  const trace = () => unit({ id: 'trace:1', classification: 'interaction_trace', text: 'điều tôi vừa nói' });

  it('never writes a plaintext column for a class that must be encrypted', () => {
    const store = new TraceStore(rows, fakeEncryption());

    expect(store.append(trace())).toBe('stored');

    const stored = db
      .prepare('SELECT text_plain, text_cipher FROM memory_trace_units WHERE id = ?')
      .get('trace:1') as { text_plain: string | null; text_cipher: string | null };
    expect(stored.text_plain).toBeNull();
    expect(stored.text_cipher).not.toBeNull();
    // The whole file is searched, not just the row, so a stray copy elsewhere fails too.
    const everything = JSON.stringify(db.prepare('SELECT * FROM memory_trace_units').all());
    expect(everything).not.toContain('điều tôi vừa nói');
  });

  it('round-trips the text through the keychain', () => {
    const store = new TraceStore(rows, fakeEncryption());
    store.append(trace());

    expect(store.list('session-1').units[0].text).toBe('điều tôi vừa nói');
  });

  it('refuses to store rather than falling back to plaintext', () => {
    const store = new TraceStore(rows, fakeEncryption(false));

    expect(store.append(trace())).toBe('encryption_unavailable');
    expect(store.count('session-1')).toBe(0);
  });

  it('reports a row it cannot decrypt instead of dropping it silently', () => {
    const keychain = fakeEncryption();
    const store = new TraceStore(rows, keychain);
    store.append(trace());

    keychain.available = false;
    const result = store.list('session-1');

    expect(result.units).toHaveLength(0);
    expect(result.unreadable).toBe(1);
  });

  it('will not hand back a must-encrypt row that someone stored in the clear', () => {
    const smuggled: MemoryTraceUnitRow = {
      id: 'smuggled:1',
      schema_version: MEMORY_TRACE_SCHEMA_VERSION,
      actor: 'user',
      classification: 'interaction_trace',
      text_plain: 'plaintext that should not be here',
      text_cipher: null,
      source_id: 's',
      source_kind: 'chat_message',
      boundary_id: 'session-9',
      observed_at: '2026-08-05T10:00:00.000Z',
      recorded_at: '2026-08-05T10:00:01.000Z',
    };
    // Model a legacy or corrupted storage adapter that bypassed the current
    // SQLite CHECK. The read layer must still refuse the plaintext row.
    const bypassedRows: TraceRowStore = {
      ...rows,
      listMemoryTraceUnits: () => [smuggled],
      countMemoryTraceUnits: () => 1,
    };

    const result = new TraceStore(bypassedRows, fakeEncryption()).list('session-9');

    expect(result.units).toHaveLength(0);
    expect(result.unreadable).toBe(1);
  });
});

describe('memory_trace_units schema', () => {
  it('refuses a row that carries its text in both places, or in neither', () => {
    const insert = (plain: string | null, cipher: string | null) => () =>
      db
        .prepare(
          `INSERT INTO memory_trace_units (
             id, schema_version, actor, classification, text_plain, text_cipher,
             source_id, source_kind, boundary_id, observed_at, recorded_at
           ) VALUES (?, 1, 'user', 'public_metadata', ?, ?, 's', 'chat_message', 'b', '2026-08-05T10:00:00.000Z', '2026-08-05T10:00:00.000Z')`,
        )
        .run(`id-${String(plain)}-${String(cipher)}`, plain, cipher);

    expect(insert('both', 'both')).toThrow();
    expect(insert(null, null)).toThrow();
    expect(insert('only plain', null)).not.toThrow();
  });

  it('does not disguise a constraint violation as a duplicate id', () => {
    expect(() => rows.insertMemoryTraceUnit({
      id: 'invalid-both-columns',
      schema_version: MEMORY_TRACE_SCHEMA_VERSION,
      actor: 'user',
      classification: 'public_metadata',
      text_plain: 'plain',
      text_cipher: 'cipher',
      source_id: 'source-1',
      source_kind: 'chat_message',
      boundary_id: 'boundary-1',
      observed_at: '2026-08-05T10:00:00.000Z',
      recorded_at: '2026-08-05T10:00:01.000Z',
    })).toThrow();
  });

  it('enforces the classification encryption policy at the SQLite boundary', () => {
    const insert = (classification: string, plain: string | null, cipher: string | null) => () =>
      rows.insertMemoryTraceUnit({
        id: `policy-${classification}-${String(plain)}-${String(cipher)}`,
        schema_version: MEMORY_TRACE_SCHEMA_VERSION,
        actor: 'user',
        classification,
        text_plain: plain,
        text_cipher: cipher,
        source_id: 'source-1',
        source_kind: 'live_profile',
        boundary_id: 'boundary-1',
        observed_at: '2026-08-05T10:00:00.000Z',
        recorded_at: '2026-08-05T10:00:01.000Z',
      });

    expect(insert('live_profile', 'private text', null)).toThrow();
    expect(insert('interaction_trace', 'private text', null)).toThrow();
    expect(insert('secret_reference', 'private text', null)).toThrow();
    expect(insert('public_metadata', null, 'cipher')).toThrow();
    expect(insert('unknown_class', 'plain', null)).toThrow();
    expect(insert('live_profile', null, 'cipher')).not.toThrow();
    expect(insert('public_metadata', 'plain', null)).not.toThrow();
  });

  it('exposes no way to change or remove a recorded unit', () => {
    // Append-only is a property of the surface, so assert on the surface itself.
    const surface = Object.getOwnPropertyNames(TraceStore.prototype);
    expect(surface).toEqual(
      expect.arrayContaining(['append', 'appendMany', 'list', 'count']),
    );
    expect(surface.filter((name) => /update|delete|remove|clear|drop/i.test(name))).toEqual([]);
  });
});
