import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MEMORY_TRACE_CLASSIFICATIONS,
  MEMORY_TRACE_CLASSIFICATION_POLICY,
  mayEgressPayload,
  mustStayLocal,
} from './classification';
import {
  createLiveProfile,
  liveProfileSourceId,
  nextLiveProfileRevision,
  parseLiveProfile,
  serializeLiveProfile,
} from './live-profile';
import {
  parseTraceProvenance,
  parseTraceUnit,
  traceCitation,
  type TraceUnit,
} from './trace-unit';

const NOW = '2026-08-05T09:30:00.000Z';

function unit(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'trace-1',
    text: 'Alice không ăn thịt từ tháng 5.',
    actor: 'user',
    classification: 'interaction_trace',
    provenance: {
      sourceId: 'chat-msg-42',
      sourceKind: 'chat_message',
      boundaryId: 'session-7',
      observedAt: NOW,
    },
    ...overrides,
  };
}

describe('CMR-224 classification and egress', () => {
  it('keeps the live profile and secret references on the machine', () => {
    expect(mustStayLocal('live_profile')).toBe(true);
    expect(mustStayLocal('secret_reference')).toBe(true);
    expect(mayEgressPayload('live_profile')).toBe(false);
  });

  it('allows only public metadata to egress as a payload', () => {
    const allowed = MEMORY_TRACE_CLASSIFICATIONS
      .filter((value) => mayEgressPayload(value));
    expect(allowed).toEqual(['public_metadata']);
  });

  it('treats an interaction trace as metadata-only, never fully sendable', () => {
    expect(MEMORY_TRACE_CLASSIFICATION_POLICY.interaction_trace.egress).toBe('metadata_only');
    expect(mayEgressPayload('interaction_trace')).toBe(false);
    expect(mustStayLocal('interaction_trace')).toBe(false);
  });

  it('fails closed for anything it cannot classify', () => {
    fc.assert(
      fc.property(
        fc.anything().filter((value) => (
          typeof value !== 'string'
          || !(MEMORY_TRACE_CLASSIFICATIONS as readonly string[]).includes(value)
        )),
        (value) => mustStayLocal(value) === true && mayEgressPayload(value) === false,
      ),
      { numRuns: 100 },
    );
  });

  it('never marks an execution-resident class as freely sendable', () => {
    for (const value of MEMORY_TRACE_CLASSIFICATIONS) {
      const policy = MEMORY_TRACE_CLASSIFICATION_POLICY[value];
      if (policy.residency === 'execution') expect(policy.egress).not.toBe('allowed');
    }
  });
});

describe('CMR-224 trace unit', () => {
  it('accepts a complete unit and exposes a stable citation', () => {
    const parsed = parseTraceUnit(unit());
    expect(parsed).not.toBeNull();
    expect(traceCitation(parsed as TraceUnit)).toBe('chat_message:chat-msg-42');
  });

  it('rejects a unit without resolvable provenance', () => {
    for (const provenance of [
      undefined,
      null,
      {},
      { sourceId: 'x', sourceKind: 'chat_message', boundaryId: 'b' },
      { sourceId: '', sourceKind: 'chat_message', boundaryId: 'b', observedAt: NOW },
      { sourceId: 'x', sourceKind: 'invented_kind', boundaryId: 'b', observedAt: NOW },
      { sourceId: 'x', sourceKind: 'chat_message', boundaryId: 'b', observedAt: '2026-08-05' },
      { sourceId: 'x', sourceKind: 'chat_message', boundaryId: 'b', observedAt: 'yesterday' },
    ]) {
      expect(parseTraceUnit(unit({ provenance }))).toBeNull();
    }
  });

  it('rejects an unknown schema version rather than guessing', () => {
    expect(parseTraceUnit(unit({ schemaVersion: 2 }))).toBeNull();
    expect(parseTraceUnit(unit({ schemaVersion: '1' }))).toBeNull();
  });

  it('rejects extra or missing keys', () => {
    const extra = { ...unit(), smuggled: true };
    expect(parseTraceUnit(extra)).toBeNull();
    const { text: _omitted, ...missing } = unit();
    expect(parseTraceUnit(missing)).toBeNull();
  });

  it('does not read fields off the prototype chain', () => {
    const base = unit();
    const proto = { text: 'inherited text' };
    const child = Object.create(proto) as Record<string, unknown>;
    for (const [key, value] of Object.entries(base)) {
      if (key === 'text') continue;
      child[key] = value;
    }
    expect(parseTraceUnit(child)).toBeNull();
  });

  it('rejects empty text and control characters in identifiers', () => {
    expect(parseTraceUnit(unit({ text: '' }))).toBeNull();
    expect(parseTraceUnit(unit({ id: 'trace\u00001' }))).toBeNull();
    expect(parseTraceUnit(unit({ id: ' padded ' }))).toBeNull();
  });

  it('rejects an actor or classification outside the contract', () => {
    expect(parseTraceUnit(unit({ actor: 'manager' }))).toBeNull();
    expect(parseTraceUnit(unit({ classification: 'anything' }))).toBeNull();
  });

  it('accepts every declared source kind and actor', () => {
    for (const sourceKind of [
      'chat_message',
      'agent_run_entry',
      'scheduled_run',
      'approval_receipt',
      'session_log',
      'live_profile',
    ]) {
      expect(parseTraceProvenance({
        sourceId: 'src-1',
        sourceKind,
        boundaryId: 'b-1',
        observedAt: NOW,
      })).not.toBeNull();
    }
    for (const actor of ['user', 'agent', 'tool', 'system']) {
      expect(parseTraceUnit(unit({ actor }))).not.toBeNull();
    }
  });
});

describe('CMR-224 Live.md', () => {
  it('round-trips through serialize and parse', () => {
    const created = createLiveProfile('# Live\n\nTôi bán API.\n', NOW);
    const parsed = parseLiveProfile(serializeLiveProfile(created));
    expect(parsed).toEqual(created);
  });

  it('preserves an arbitrary body across a round trip', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2_000 }), (body) => {
        const profile = createLiveProfile(body.replace(/\r\n/g, '\n'), NOW);
        const parsed = parseLiveProfile(serializeLiveProfile(profile));
        return parsed !== null && parsed.body === profile.body;
      }),
      { numRuns: 100 },
    );
  });

  it('reads a hand-edited file with CRLF endings and a BOM', () => {
    const created = createLiveProfile('# Live\n\nDòng của tôi.\n', NOW);
    const handEdited = '\uFEFF' + serializeLiveProfile(created).replace(/\n/g, '\r\n');
    const parsed = parseLiveProfile(handEdited);
    expect(parsed?.body).toBe(created.body);
  });

  it('refuses a file it cannot understand instead of guessing', () => {
    for (const raw of [
      '',
      'no frontmatter at all',
      '---\nschemaVersion: 1\nrevision: 1\n',
      '---\nschemaVersion: 2\nrevision: 1\nupdatedAt: ' + NOW + '\n---\nbody',
      '---\nschemaVersion: 1\nrevision: 0\nupdatedAt: ' + NOW + '\n---\nbody',
      '---\nschemaVersion: 1\nrevision: -1\nupdatedAt: ' + NOW + '\n---\nbody',
      '---\nschemaVersion: 1\nrevision: abc\nupdatedAt: ' + NOW + '\n---\nbody',
      '---\nschemaVersion: 1\nrevision: 1\nupdatedAt: 2026-08-05\n---\nbody',
      '---\nschemaVersion: 1\nrevision: 1\n---\nbody',
    ]) {
      expect(parseLiveProfile(raw)).toBeNull();
    }
    expect(parseLiveProfile(undefined)).toBeNull();
    expect(parseLiveProfile(42)).toBeNull();
  });

  it('refuses a duplicated frontmatter key as ambiguous', () => {
    const raw = [
      '---',
      'schemaVersion: 1',
      'revision: 1',
      'revision: 9',
      `updatedAt: ${NOW}`,
      '---',
      'body',
    ].join('\n');
    expect(parseLiveProfile(raw)).toBeNull();
  });

  it('increments the revision monotonically and cites the exact revision', () => {
    const first = createLiveProfile('one', NOW);
    const second = nextLiveProfileRevision(first, 'two', NOW);
    expect(second?.revision).toBe(2);
    expect(liveProfileSourceId(first)).toBe('Live.md#rev1');
    expect(liveProfileSourceId(second!)).toBe('Live.md#rev2');
  });

  it('rejects a body beyond the size limit rather than truncating it', () => {
    const first = createLiveProfile('one', NOW);
    expect(nextLiveProfileRevision(first, 'x'.repeat(256_001), NOW)).toBeNull();
  });
});
