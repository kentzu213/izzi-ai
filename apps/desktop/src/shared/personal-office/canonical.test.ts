import { describe, expect, it } from 'vitest';
import {
  canonicalActionPayload,
  canonicalJson,
  canonicalPlanPayload,
} from './canonical';
import type { ApprovalActionBinding } from './entities';

describe('canonicalJson', () => {
  it('is stable across object key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it('normalizes supported non-JSON values and removes unsafe keys', () => {
    const hostile = JSON.parse('{"__proto__":"drop","safe":1}') as Record<string, unknown>;
    hostile.undefinedValue = undefined;
    hostile.date = new Date('2026-07-28T00:00:00.000Z');
    hostile.big = 9n;
    hostile.infinity = Number.POSITIVE_INFINITY;

    expect(canonicalJson(hostile)).toBe(
      '{"big":"9","date":"2026-07-28T00:00:00.000Z","infinity":null,"safe":1}',
    );
  });
});

describe('approval action binding', () => {
  const binding: ApprovalActionBinding = {
    target: 'provider/resource',
    input: { body: 'redacted preview' },
    artifactId: null,
    artifactVersion: null,
    estimatedSideEffect: 'Publish one approved draft',
    idempotencyKey: 'publish-run-1-step-2',
    expiresAt: '2026-07-29T00:00:00.000Z',
    planHash: 'plan-sha256',
    contextSnapshotId: null,
  };

  it('is stable regardless of property insertion order', () => {
    const reordered: ApprovalActionBinding = {
      contextSnapshotId: null,
      planHash: 'plan-sha256',
      expiresAt: '2026-07-29T00:00:00.000Z',
      idempotencyKey: 'publish-run-1-step-2',
      estimatedSideEffect: 'Publish one approved draft',
      artifactVersion: null,
      artifactId: null,
      input: { body: 'redacted preview' },
      target: 'provider/resource',
    };
    expect(canonicalActionPayload(binding)).toBe(canonicalActionPayload(reordered));
  });

  it('changes when any side-effect binding changes', () => {
    expect(
      canonicalActionPayload({ ...binding, idempotencyKey: 'different-side-effect' }),
    ).not.toBe(canonicalActionPayload(binding));
  });

  it('hashes only stable plan identity fields', () => {
    expect(canonicalPlanPayload([{ key: 'draft', label: 'Draft' }])).toBe(
      canonicalPlanPayload([{ label: 'Draft', key: 'draft' }]),
    );
  });
});
