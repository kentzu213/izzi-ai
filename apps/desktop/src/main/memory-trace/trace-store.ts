// CMR-224 Slice 3 — append-only persistence for trace units.
//
// Two rules drive every decision here:
//
// 1. Append-only. There is no update and no delete on this surface, and a repeat
//    of the same id is a no-op rather than an overwrite. A correction is a new
//    observation with its own provenance, so history stays legible after the fact.
//
// 2. Fail closed on encryption. The classification policy in
//    `shared/memory-trace/classification.ts` marks interaction traces, the live
//    profile and secret references as `encryptedAtRest`. When the OS keychain is
//    unavailable, this store REFUSES to write rather than quietly falling back to
//    plaintext: losing an observation is recoverable, leaking one is not.
//
// The store never sends anything anywhere. Egress decisions belong to whoever
// reads a unit, guided by `mustStayLocal`.

import { safeStorage } from 'electron';
import {
  MEMORY_TRACE_CLASSIFICATION_POLICY,
  isMemoryTraceClassification,
} from '../../shared/memory-trace/classification';
import { parseTraceUnit, type TraceUnit } from '../../shared/memory-trace/trace-unit';
import type { MemoryTraceUnitRow } from './trace-record';

/** The slice of the database this store needs. */
export interface TraceRowStore {
  insertMemoryTraceUnit(row: MemoryTraceUnitRow): 'stored' | 'duplicate';
  listMemoryTraceUnits(boundaryId: string, limit?: number): MemoryTraceUnitRow[];
  countMemoryTraceUnits(boundaryId: string): number;
}

/** The slice of Electron's safeStorage this store needs. */
export interface TraceEncryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export type TraceAppendResult =
  /** Written for the first time. */
  | 'stored'
  /** A unit with this id is already recorded; nothing changed. */
  | 'duplicate'
  /** Not an admissible trace unit, so it was not stored. */
  | 'rejected'
  /** Policy requires encryption at rest and the keychain could not provide it. */
  | 'encryption_unavailable';

export interface TraceAppendTally {
  readonly stored: number;
  readonly duplicate: number;
  readonly rejected: number;
  readonly encryption_unavailable: number;
}

export interface TraceListResult {
  readonly units: readonly TraceUnit[];
  /**
   * Rows that exist but could not be turned back into a unit — a failed decrypt
   * or a row this build cannot validate. Reported rather than hidden, because a
   * silent gap in evidence is worse than a visible one.
   */
  readonly unreadable: number;
}

export class TraceStore {
  constructor(
    private readonly rows: TraceRowStore,
    private readonly encryption: TraceEncryption = safeStorage,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  append(candidate: unknown): TraceAppendResult {
    const unit = parseTraceUnit(candidate);
    if (!unit) return 'rejected';

    const policy = MEMORY_TRACE_CLASSIFICATION_POLICY[unit.classification];
    let textPlain: string | null = unit.text;
    let textCipher: string | null = null;

    if (policy.encryptedAtRest) {
      const sealed = this.seal(unit.text);
      if (!sealed) return 'encryption_unavailable';
      textPlain = null;
      textCipher = sealed;
    }

    return this.rows.insertMemoryTraceUnit({
      id: unit.id,
      schema_version: unit.schemaVersion,
      actor: unit.actor,
      classification: unit.classification,
      text_plain: textPlain,
      text_cipher: textCipher,
      source_id: unit.provenance.sourceId,
      source_kind: unit.provenance.sourceKind,
      boundary_id: unit.provenance.boundaryId,
      observed_at: unit.provenance.observedAt,
      recorded_at: this.now(),
    });
  }

  appendMany(candidates: readonly unknown[]): TraceAppendTally {
    const tally = { stored: 0, duplicate: 0, rejected: 0, encryption_unavailable: 0 };
    for (const candidate of candidates) {
      tally[this.append(candidate)] += 1;
    }
    return tally;
  }

  list(boundaryId: string, limit?: number): TraceListResult {
    const units: TraceUnit[] = [];
    let unreadable = 0;

    for (const row of this.rows.listMemoryTraceUnits(boundaryId, limit)) {
      const unit = this.rehydrate(row);
      if (unit) units.push(unit);
      else unreadable += 1;
    }

    return { units, unreadable };
  }

  count(boundaryId: string): number {
    return this.rows.countMemoryTraceUnits(boundaryId);
  }

  private seal(text: string): string | null {
    if (!this.encryption.isEncryptionAvailable()) return null;
    try {
      const ciphertext = this.encryption.encryptString(text);
      if (!Buffer.isBuffer(ciphertext) || ciphertext.length === 0) return null;
      return ciphertext.toString('base64');
    } catch {
      return null;
    }
  }

  private open(cipher: string): string | null {
    if (!this.encryption.isEncryptionAvailable()) return null;
    try {
      const text = this.encryption.decryptString(Buffer.from(cipher, 'base64'));
      return typeof text === 'string' && text.length > 0 ? text : null;
    } catch {
      return null;
    }
  }

  /**
   * Rebuilds a unit from a row and re-validates it. Anything that fails is
   * counted as unreadable rather than returned half-formed.
   */
  private rehydrate(row: MemoryTraceUnitRow): TraceUnit | null {
    if (!isMemoryTraceClassification(row.classification)) return null;

    const text = row.text_cipher !== null ? this.open(row.text_cipher) : row.text_plain;
    if (text === null) return null;

    // A row whose stored text should have been encrypted but is not was written
    // by something that bypassed this store. Treat it as unreadable rather than
    // handing it back as if it were sound.
    const expectsCipher = MEMORY_TRACE_CLASSIFICATION_POLICY[row.classification].encryptedAtRest;
    if (expectsCipher && row.text_cipher === null) return null;

    return parseTraceUnit({
      schemaVersion: row.schema_version,
      id: row.id,
      text,
      actor: row.actor,
      classification: row.classification,
      provenance: {
        sourceId: row.source_id,
        sourceKind: row.source_kind,
        boundaryId: row.boundary_id,
        observedAt: row.observed_at,
      },
    });
  }
}
