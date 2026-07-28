/**
 * Deterministic serialization for hashes and approval bindings.
 *
 * This module is dependency-free so both Electron main and renderer consumers
 * calculate the exact same byte string. Cryptographic hashing remains on the
 * execution plane; this module only defines canonical inputs.
 */

import type { ApprovalActionBinding } from './entities';

function canonicalise(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') {
    return typeof value === 'number' && !Number.isFinite(value) ? null : value;
  }

  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(source).sort()) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const child = source[key];
    if (child === undefined) continue;
    output[key] = canonicalise(child);
  }
  return output;
}

/** Stable JSON: sorted keys, undefined removed, hostile prototype keys ignored. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

/** Exact bytes covered by an immutable approval action hash. */
export function canonicalActionPayload(binding: ApprovalActionBinding): string {
  return canonicalJson({
    artifactId: binding.artifactId,
    artifactVersion: binding.artifactVersion,
    contextSnapshotId: binding.contextSnapshotId,
    estimatedSideEffect: binding.estimatedSideEffect,
    expiresAt: binding.expiresAt,
    idempotencyKey: binding.idempotencyKey,
    input: binding.input,
    planHash: binding.planHash,
    target: binding.target,
  });
}

/** Exact bytes covered by a plan hash. */
export function canonicalPlanPayload(
  steps: ReadonlyArray<{ readonly key: string; readonly label: string }>,
): string {
  return canonicalJson(steps.map(({ key, label }) => ({ key, label })));
}
