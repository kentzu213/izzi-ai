/**
 * Content hashing for the unified work model (Loop 03).
 *
 * Hashing lives in the main process because it needs `node:crypto`. The canonical
 * BYTE STRINGS it hashes are defined by the contract of record in
 * `shared/personal-office/canonical.ts`, so the renderer can display the same
 * fields while being structurally unable to mint a hash.
 *
 * Salvaged from the quarantine snapshot, retargeted off the superseded
 * quarantine model per the W0 PQ-08 ruling.
 *
 * @module main/work/work-hash
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  canonicalActionPayload,
  canonicalJson,
  canonicalPlanPayload,
  type ApprovalActionBinding,
} from '../../shared/personal-office';
import type { WorkApprovalReceipt } from './work-types';

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * The immutable identity of an approvable action. Any change to target, input,
 * artifact version, estimated effect, idempotency key, expiry, plan hash or
 * context snapshot yields a different hash — which is exactly how a stale
 * approval is detected rather than honoured.
 */
export function computeActionHash(binding: ApprovalActionBinding): string {
  return sha256Hex(canonicalActionPayload(binding));
}

/** Hash of the run's plan. A changed plan invalidates approvals bound to the old one. */
export function computePlanHash(
  steps: ReadonlyArray<{ readonly key: string; readonly label: string }>,
): string {
  return sha256Hex(canonicalPlanPayload(steps));
}

/** Hash of a stored artifact body — its content provenance. */
export function computeArtifactDigest(body: string): string {
  return sha256Hex(body);
}

export function computeReceiptDigest(receipt: WorkApprovalReceipt): string {
  return sha256Hex(canonicalJson(receipt));
}

/** Stable id helpers, so ids read as what they are in a debug session. */
export function newWorkId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/**
 * Deterministic id for an adapted legacy record. Re-importing the same legacy row
 * must resolve to the same unified row, or "idempotent import" would be a lie.
 */
export function deterministicWorkId(prefix: string, ...parts: string[]): string {
  return `${prefix}-${sha256Hex(parts.join('\u0000')).slice(0, 32)}`;
}
